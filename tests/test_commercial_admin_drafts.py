from copy import deepcopy
import json
from types import SimpleNamespace

import pytest

from backend.commercial_policy.admin_drafts import load_legacy_export_capabilities, prepare_admin_draft
from backend.commercial_policy.document import SUPPORTED_EXPORT_CAPABILITIES, build_initial_draft_document, validate_document
from backend.commercial_policy.errors import CommercialPolicyError
from backend.commercial_policy import routes


LEGACY_EXPORTS = {
    tier: {capability: (index + tier_index) % 2 == 0
           for index, capability in enumerate(SUPPORTED_EXPORT_CAPABILITIES)}
    for tier_index, tier in enumerate(("silver", "gold", "diamond"))
}


def test_complete_templates_are_valid_without_a_seed_and_do_not_generate_monthly_prices():
    document = prepare_admin_draft(
        template_mode="complete_templates", legacy_capabilities_by_tier=LEGACY_EXPORTS
    )
    assert validate_document(document)["errors"] == []
    assert len(document["offers"]) == 8
    for offer in document["offers"]:
        assert offer["price"]["period"] == "yearly"
        assert offer["price"]["total"] > 0
        if offer["tier"] != "personal":
            assert offer["exportCapabilities"] == LEGACY_EXPORTS[offer["tier"]]
        if offer["variant"] == "internal":
            assert offer["includedProcurementQuota"] == 0


def test_complete_templates_fill_old_blockers_and_preserve_customized_source_configuration():
    source = build_initial_draft_document(LEGACY_EXPORTS)
    source["extra"] = {"keep": True}
    source["offers"][0]["exportCapabilities"] = {
        capability: False for capability in SUPPORTED_EXPORT_CAPABILITIES
    }
    source["offers"][1]["exportCapabilities"] = None
    source["offers"][2]["price"]["total"] = None
    source["policies"]["baseTerm"] = {"kind": "blocked_decision"}
    source["policies"]["renewalAnchor"] = {"kind": "end_of_term"}
    source["policies"]["partialBatch"] = {"kind": "blocked_decision"}
    source["policies"]["graceDays"] = 7
    before = deepcopy(source)
    document = prepare_admin_draft(
        source, template_mode="complete_templates", legacy_capabilities_by_tier=LEGACY_EXPORTS
    )
    assert source == before
    assert validate_document(document)["errors"] == []
    for key in ("providerProfiles", "creditPacks", "taxInvoice", "externalReadiness", "extra"):
        assert document[key] == before[key]
    assert document["policies"]["graceDays"] == 7
    assert document["policies"]["baseTerm"] == {"kind": "fixed_days", "days": 365}
    assert document["policies"]["partialBatch"] == {"kind": "process_affordable_in_stable_order"}
    assert document["offers"][0]["exportCapabilities"] == before["offers"][0]["exportCapabilities"]
    assert all(document["offers"][1]["exportCapabilities"].values())


def test_complete_templates_keep_unmapped_organization_exports_as_a_validation_blocker():
    document = prepare_admin_draft(template_mode="complete_templates")
    assert any(error["code"] == "BLOCKED_DECISION" for error in validate_document(document)["errors"])
    assert document["offers"][2]["exportCapabilities"] is None


def test_legacy_capability_loader_preserves_actual_db_values():
    import sqlite3

    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("CREATE TABLE goi_dich_vu (id TEXT, document_export_word INT, document_export_excel INT, document_export_award_result_excel INT)")
        connection.executemany("INSERT INTO goi_dich_vu VALUES (?, ?, ?, ?)", [
            ("silver", 0, 1, 0), ("gold", 1, 0, 1), ("diamond", 0, 0, 0), ("free", 1, 1, 1),
        ])
        assert load_legacy_export_capabilities(connection.cursor()) == {
            "silver": dict(zip(SUPPORTED_EXPORT_CAPABILITIES, (False, True, False))),
            "gold": dict(zip(SUPPORTED_EXPORT_CAPABILITIES, (True, False, True))),
            "diamond": dict(zip(SUPPORTED_EXPORT_CAPABILITIES, (False, False, False))),
        }
    finally:
        connection.close()


def test_templates_have_no_prices_or_guessed_entitlements_and_preserve_common_config():
    source = build_initial_draft_document()
    source["extra"] = {"keep": True}
    before = deepcopy(source)
    document = prepare_admin_draft(source, template_mode="blank_templates")
    assert source == before
    for key in ("policies", "providerProfiles", "creditPacks", "taxInvoice", "externalReadiness", "extra"):
        assert document[key] == source[key]
    assert len(document["offers"]) == 8
    for offer in document["offers"]:
        assert offer["price"]["total"] is None
        assert offer["price"]["tax"] is None
        assert offer["exportCapabilities"] is None
        assert offer["salesState"] == "non_sellable"
    codes = {error["code"] for error in validate_document(document)["errors"]}
    assert "MONEY_INTEGER_REQUIRED" in codes
    assert "BLOCKED_DECISION" in codes


def test_empty_draft_preserves_source_and_cannot_pass_existing_release_matrix():
    source = build_initial_draft_document()
    document = prepare_admin_draft(source, template_mode="empty")
    assert document["offers"] == []
    assert len(source["offers"]) == 8
    assert document["policies"] == source["policies"]
    assert any(error["code"] == "OFFER_MATRIX_INCOMPLETE" for error in validate_document(document)["errors"])
    assert prepare_admin_draft(source) == source
    with pytest.raises(CommercialPolicyError):
        prepare_admin_draft(source, template_mode="unsafe")


def _route_fixture(monkeypatch, *, authorized=True, source=None, audit_fails=False):
    seen = {"commit": False, "rollback": False, "audit": [], "outbox": []}

    class Connection:
        def execute(self, statement):
            seen["begin"] = statement

        def cursor(self):
            return self

        def commit(self):
            seen["commit"] = True

        def rollback(self):
            seen["rollback"] = True

        def close(self):
            seen["closed"] = True

    class Repository:
        def __init__(self, cursor):
            pass

        def get_draft(self, draft_id):
            return None

        def effective_release(self, **kwargs):
            return {"id": "existing", "snapshot": source} if source else None

        def create_draft(self, document, actor, **kwargs):
            seen["document"] = document
            seen["base"] = kwargs.get("base_release_id")
            return {"id": "new", "document": document, "revision": 1, "status": "draft", "checksum": "fixture"}

        def insert_outbox(self, *args):
            seen["outbox"].append(args)

    def audit(*args, **kwargs):
        seen["audit"].append(kwargs)
        if audit_fails:
            raise RuntimeError("audit unavailable")

    monkeypatch.setattr(routes.database, "get_connection", Connection)
    monkeypatch.setattr(routes, "CommercialRepository", Repository)
    monkeypatch.setattr(routes, "verify_session_in_transaction", lambda *a, **k: (authorized, SimpleNamespace(user_id="admin") if authorized else "Không có quyền"))
    monkeypatch.setattr(routes, "log_audit", audit)
    monkeypatch.setattr(routes, "log_error", lambda *a, **k: None)
    return seen


def test_create_first_package_draft_succeeds_without_seed_or_effective_release(monkeypatch):
    seen = _route_fixture(monkeypatch)
    response = routes._create_commercial_draft_sync(SimpleNamespace(), {"templateMode": "empty"})
    assert response.status_code == 201
    assert json.loads(response.body)["document"]["offers"] == []
    assert seen["commit"] and not seen["rollback"]
    assert seen["audit"][0]["required"] is True
    assert len(seen["outbox"]) == 1


def test_create_complete_package_samples_without_seed_commits_valid_annual_document(monkeypatch):
    seen = _route_fixture(monkeypatch)
    monkeypatch.setattr(routes, "load_legacy_export_capabilities", lambda cursor: LEGACY_EXPORTS)
    response = routes._create_commercial_draft_sync(SimpleNamespace(), {"templateMode": "complete_templates"})
    assert response.status_code == 201
    assert validate_document(seen["document"])["errors"] == []
    assert len(seen["document"]["offers"]) == 8
    assert seen["base"] is None
    assert seen["commit"] and not seen["rollback"]
    assert seen["audit"][0]["required"] is True
    assert len(seen["outbox"]) == 1


def test_complete_template_authorization_precedes_reading_legacy_capabilities(monkeypatch):
    seen = _route_fixture(monkeypatch, authorized=False)

    def unauthorized_read(cursor):
        raise AssertionError("An unauthorized request cannot read the legacy configuration")

    monkeypatch.setattr(routes, "load_legacy_export_capabilities", unauthorized_read)
    response = routes._create_commercial_draft_sync(SimpleNamespace(), {"templateMode": "complete_templates"})
    assert response.status_code == 403
    assert "document" not in seen
    assert seen["rollback"] and not seen["commit"]


def test_default_draft_creation_keeps_existing_release_snapshot_unchanged(monkeypatch):
    source = build_initial_draft_document()
    before = deepcopy(source)
    seen = _route_fixture(monkeypatch, source=source)
    response = routes._create_commercial_draft_sync(SimpleNamespace(), {})
    assert response.status_code == 201
    assert seen["document"] == before
    assert source == before
    assert seen["base"] == "existing"


def test_admin_draft_creation_denies_unauthorized_sessions_and_rolls_back_audit_failure(monkeypatch):
    seen = _route_fixture(monkeypatch, authorized=False)
    response = routes._create_commercial_draft_sync(SimpleNamespace(), {"templateMode": "empty"})
    assert response.status_code == 403
    assert "document" not in seen
    assert seen["rollback"] and not seen["commit"]
    seen = _route_fixture(monkeypatch, audit_fails=True)
    response = routes._create_commercial_draft_sync(SimpleNamespace(), {"templateMode": "empty"})
    assert response.status_code == 500
    assert seen["rollback"] and not seen["commit"]
    assert not seen["outbox"]


def test_admin_draft_archive_requires_authorization_and_commits_audit(monkeypatch):
    seen = _route_fixture(monkeypatch)

    class Repository:
        def __init__(self, cursor):
            pass

        def archive_draft(self, draft_id, revision, actor):
            seen["archive"] = (draft_id, revision, actor)
            return {
                "id": draft_id,
                "status": "archived",
                "revision": revision + 1,
                "checksum": "fixture",
                "validation_digest": None,
                "validation_revision": None,
                "readiness_expires_at": None,
                "validation": None,
                "document": {},
                "created_at": 1,
                "updated_at": 2,
            }

        def insert_outbox(self, *args):
            seen["outbox"].append(args)

    monkeypatch.setattr(routes, "CommercialRepository", Repository)
    request = SimpleNamespace(path_params={"draft_id": "draft-1"}, headers={})
    response = routes._archive_commercial_draft_sync(request, {"expectedRevision": 3}, 3)
    assert response.status_code == 200
    assert json.loads(response.body)["status"] == "archived"
    assert seen["archive"] == ("draft-1", 3, "admin")
    assert seen["commit"] and not seen["rollback"]
    assert seen["audit"][0]["required"] is True
    assert len(seen["outbox"]) == 1

    seen = _route_fixture(monkeypatch, authorized=False)
    monkeypatch.setattr(routes, "CommercialRepository", Repository)
    response = routes._archive_commercial_draft_sync(request, {"expectedRevision": 3}, 3)
    assert response.status_code == 403
    assert seen["rollback"] and not seen["commit"]
