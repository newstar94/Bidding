from copy import deepcopy
import json
from types import SimpleNamespace

import pytest

from backend.commercial_policy.admin_drafts import prepare_admin_draft
from backend.commercial_policy.document import build_initial_draft_document, validate_document
from backend.commercial_policy.errors import CommercialPolicyError
from backend.commercial_policy import routes


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
