from copy import deepcopy
import asyncio
import json
import sqlite3
from types import SimpleNamespace

import pytest

from backend.billing.runtime import PaymentProviderRegistry, build_payos_environment_credential_resolver
from backend.commercial_policy import routes
from backend.commercial_policy.document import build_initial_draft_document, SUPPORTED_EXPORT_CAPABILITIES, validate_document
from backend.commercial_policy.errors import CommercialPolicyError
from backend.commercial_policy.publication import prepare_publication_document


def configured_document():
    doc = build_initial_draft_document({
        tier: dict.fromkeys(SUPPORTED_EXPORT_CAPABILITIES, True)
        for tier in ("silver", "gold", "diamond")
    })
    doc["rollout"]["mode"] = "production"
    doc.pop("externalReadiness", None)
    doc["taxInvoice"].pop("approvalReference", None)
    return doc


@pytest.fixture
def profile_cursor():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("""CREATE TABLE payment_provider_profiles (
        id TEXT, provider TEXT, environment TEXT, credential_reference TEXT, mode TEXT,
        readiness_status TEXT, routing_priority INT, version INT, min_amount INT,
        max_amount INT, checkout_ttl_seconds INT, timeout_ms INT)""")
    conn.execute("INSERT INTO payment_provider_profiles VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                 ("actual", "payos", "production", "configured-ref", "live", "ready",
                  1, 2, 1, 100000000, 900, 5000))
    yield conn.cursor()
    conn.close()


def registry(reference="configured-ref", **extra):
    env = {"PAYOS_CREDENTIAL_REFERENCE": reference, "PAYOS_CLIENT_ID": "fixture-client",
           "PAYOS_API_KEY": "fixture-api", "PAYOS_CHECKSUM_KEY": "fixture-checksum", **extra}
    return PaymentProviderRegistry(environment=env,
        credential_resolver=build_payos_environment_credential_resolver(env))


def test_public_save_resolves_actual_reference_without_manual_approvals_or_source_mutation(profile_cursor):
    source = configured_document()
    before = deepcopy(source)
    result = prepare_publication_document(profile_cursor, source, registry=registry())
    assert source == before
    assert validate_document(result)["errors"] == []
    payos = next(p for p in result["providerProfiles"] if p["provider"] == "payos")
    assert payos["credentialReference"] == "configured-ref"
    assert payos["mode"] == "live" and payos["readiness"] == "ready"
    for key in ("offers", "creditPacks", "policies", "taxInvoice"):
        assert result[key] == before[key]
    assert "fixture-api" not in json.dumps(result)


@pytest.mark.parametrize("runtime", [registry("different-ref"), registry(PAYOS_API_KEY="")])
def test_unresolvable_actual_keys_cannot_be_marked_ready(profile_cursor, runtime):
    source = configured_document()
    before = deepcopy(source)
    with pytest.raises(CommercialPolicyError) as error:
        prepare_publication_document(profile_cursor, source, registry=runtime)
    assert error.value.code == "NO_HEALTHY_PROVIDER"
    assert error.value.details["errors"][0]["path"] == "providerProfiles"
    assert source == before


def test_missing_actual_profile_is_rejected_and_internal_mode_needs_no_profile(profile_cursor):
    profile_cursor.execute("DELETE FROM payment_provider_profiles")
    with pytest.raises(CommercialPolicyError):
        prepare_publication_document(profile_cursor, configured_document(), registry=registry())
    source = configured_document()
    source["rollout"]["mode"] = "shadow"
    assert prepare_publication_document(None, source, registry=registry()) == source


def test_append_actual_profile_preserves_legacy_metadata_and_malformed_profiles(profile_cursor):
    source = configured_document()
    source["providerProfiles"] = [{"provider": "fake", "opaque": "keep"}]
    source["externalReadiness"] = {"termsRefund": "historic"}
    result = prepare_publication_document(profile_cursor, source, registry=registry())
    assert result["providerProfiles"][0] == source["providerProfiles"][0]
    assert result["providerProfiles"][1]["checkoutTtlSeconds"] == 900
    assert result["externalReadiness"] == source["externalReadiness"]
    source["providerProfiles"] = "bad"
    result = prepare_publication_document(profile_cursor, source, registry=registry())
    assert any(e["code"] == "NO_HEALTHY_PROVIDER" for e in validate_document(result)["errors"])


def save_fixture(monkeypatch, failure=None, authorized=True):
    seen = {"calls": [], "commits": 0, "rollbacks": 0}
    def note(kind):
        seen["calls"].append(kind)
        if failure == kind:
            raise CommercialPolicyError("CONFLICT", "rejected", status_code=409)
    class Connection:
        def execute(self, sql): note("begin")
        def cursor(self): return self
        def commit(self): seen["commits"] += 1
        def rollback(self): seen["rollbacks"] += 1
        def close(self): note("close")
    class Repository:
        def __init__(self, cursor): pass
        def save_draft(self, draft_id, revision, document, actor):
            note("save")
            assert revision == 4
            return {"id": draft_id, "revision": 5, "document": document, "checksum": "checksum", "status": "draft"}
        def insert_outbox(self, *args): note("outbox")
    class Policy:
        def __init__(self, cursor): pass
        def validate_draft(self, draft_id, revision):
            note("validate")
            assert revision == 5
            return {"validationDigest": "a" * 64,
                    "errors": [{"path": "offers", "message": "Invalid prices"}] if failure == "invalid" else []}
        def publish_draft(self, draft_id, revision, digest, effective, reason, actor):
            note("publish")
            assert revision == 5 and digest == "a" * 64
            assert reason == "Lưu cấu hình gói dịch vụ"
            return {"id": "release", "version_label": "v2", "checksum": "checksum", "mode": "production",
                    "scope_key": "global", "effective_from": effective, "non_sellable": False, "reason": reason}
    def prepare(cursor, document):
        note("prepare")
        return document
    monkeypatch.setattr(routes.database, "get_connection", Connection)
    monkeypatch.setattr(routes, "CommercialRepository", Repository)
    monkeypatch.setattr(routes, "CommercialPolicy", Policy)
    monkeypatch.setattr(routes, "prepare_publication_document", prepare)
    monkeypatch.setattr(routes, "verify_session_in_transaction",
        lambda *a, **k: (authorized, SimpleNamespace(user_id="admin") if authorized else "forbidden"))
    monkeypatch.setattr(routes, "log_audit", lambda *a, **k: note("audit"))
    monkeypatch.setattr(routes, "log_error", lambda *a, **k: None)
    request = SimpleNamespace(path_params={"draft_id": "draft"})
    return seen, request


def test_single_save_uses_saved_revision_and_digest_and_commits_once(monkeypatch):
    seen, request = save_fixture(monkeypatch)
    response = routes._save_commercial_draft_sync(request, {"publish": True}, 4, {})
    assert response.status_code == 200 and json.loads(response.body)["id"] == "release"
    assert "document" not in json.loads(response.body)
    assert seen["commits"] == 1 and seen["rollbacks"] == 0
    assert seen["calls"].count("audit") == seen["calls"].count("outbox") == 3
    assert seen["calls"].index("save") < seen["calls"].index("validate") < seen["calls"].index("publish")


@pytest.mark.parametrize("failure", ["prepare", "save", "audit", "outbox", "validate", "invalid", "publish"])
def test_single_save_rolls_back_all_stages_on_failure(monkeypatch, failure):
    seen, request = save_fixture(monkeypatch, failure)
    response = routes._save_commercial_draft_sync(request, {"publish": True}, 4, {})
    assert response.status_code == 409
    assert seen["commits"] == 0 and seen["rollbacks"] == 1
    if failure in {"save", "prepare", "invalid"}:
        assert "publish" not in seen["calls"]


def test_unauthorized_save_cannot_read_provider_or_save_and_legacy_patch_remains_draft_only(monkeypatch):
    seen, request = save_fixture(monkeypatch, authorized=False)
    assert routes._save_commercial_draft_sync(request, {"publish": True}, 4, {}).status_code == 403
    assert "prepare" not in seen["calls"] and "save" not in seen["calls"]
    seen, request = save_fixture(monkeypatch)
    response = routes._save_commercial_draft_sync(request, {}, 4, {})
    assert json.loads(response.body)["revision"] == 5
    assert not ({"prepare", "validate", "publish"} & set(seen["calls"]))
    assert seen["commits"] == 1


@pytest.mark.parametrize("fields", [{"publish": "true"}, {"publish": 1}, {"publish": True, "effectiveAt": True},
    {"publish": True, "effectiveAt": -1}, {"publish": True, "effectiveAt": "later"}])
def test_save_rejects_bad_input_before_database_write(monkeypatch, fields):
    async def body(): return {"expectedRevision": 4, "document": {}, **fields}
    async def unexpected(*a): raise AssertionError("Invalid input reached database")
    monkeypatch.setattr(routes, "run_database_write", unexpected)
    response = asyncio.run(routes.save_commercial_draft_api(SimpleNamespace(json=body, headers={})))
    assert response.status_code == 400
