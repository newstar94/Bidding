import hashlib
import hmac
import json
import asyncio
from types import SimpleNamespace

from backend.integrations.chuan_hoa import (
    ChuanHoaAdminClient,
    ChuanHoaIntegrationError,
    ChuanHoaIntegrationSettings,
    integration_signature,
)
from backend.admin import platform_chuan_hoa_routes as routes


class _Response:
    def __enter__(self): return self
    def __exit__(self, *_): return False
    def read(self): return b'{"ok":true}'


def test_mutation_signs_exact_body_and_uses_single_request(monkeypatch):
    settings = ChuanHoaIntegrationSettings(
        "https://chuanhoa.example.test", "bidding-admin", "s" * 32, frozenset({"u-1"})
    )
    seen = []
    def fake_urlopen(request, **options):
        seen.append((request, options))
        return _Response()
    monkeypatch.setattr("backend.integrations.chuan_hoa.urlopen", fake_urlopen)
    payload = {"userId": "u-1", "productId": "p-1", "featureCodes": ["a"], "durationDays": 30, "reason": "support", "actorId": "u-admin", "correlationId": "00000000-0000-0000-0000-000000000001"}
    result = __import__("asyncio").run(ChuanHoaAdminClient(settings).extend_entitlement(payload, "idempotency-key-123456"))
    assert result == {"ok": True}
    assert len(seen) == 1
    request, options = seen[0]
    assert request.method == "POST"
    assert request.full_url.endswith("/v1/admin/integration/entitlements/extend")
    assert request.get_header("Idempotency-key") == "idempotency-key-123456"
    assert options["timeout"] == settings.timeout_seconds
    assert "context" not in options
    assert request.data == json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    timestamp = request.get_header("X-integration-timestamp")
    nonce = request.get_header("X-integration-nonce")
    signature = request.get_header("X-integration-signature")
    assert signature == integration_signature(settings.shared_secret, "POST", "/v1/admin/integration/entitlements/extend", timestamp, nonce, request.data)


def test_integration_settings_are_not_configured_without_https_and_secret(monkeypatch):
    monkeypatch.delenv("CHUAN_HOA_ADMIN_BASE_URL", raising=False)
    monkeypatch.delenv("CHUAN_HOA_ADMIN_CLIENT_ID", raising=False)
    monkeypatch.delenv("CHUAN_HOA_ADMIN_SHARED_SECRET", raising=False)
    assert not ChuanHoaIntegrationSettings.from_env().configured


def test_integration_signature_is_stable_for_contract():
    value = integration_signature(
        "s" * 32, "get", "/v1/admin/integration/capabilities", "1700000000", "nonce"
    )
    expected_body = hashlib.sha256(b"").hexdigest()
    canonical = f"GET\n/v1/admin/integration/capabilities\n1700000000\nnonce\n{expected_body}"
    expected = hmac.new(b"s" * 32, canonical.encode(), hashlib.sha256).hexdigest()
    assert value == expected


def test_collection_signature_covers_query_string(monkeypatch):
    settings = ChuanHoaIntegrationSettings(
        "https://chuanhoa.example.test", "bidding-admin", "s" * 32, frozenset({"u-1"})
    )
    seen = []
    class Response:
        def __enter__(self): return self
        def __exit__(self, *_): return False
        def read(self): return b'{"items":[],"page":2,"pageSize":25,"total":0}'
    def fake_urlopen(request, **_options):
        seen.append(request)
        return Response()
    monkeypatch.setattr("backend.integrations.chuan_hoa.urlopen", fake_urlopen)
    asyncio.run(ChuanHoaAdminClient(settings).read_collection("accounts", search="Đà Nẵng", page=2))
    request = seen[0]
    parsed = __import__("urllib.parse", fromlist=["urlparse"]).urlparse(request.full_url)
    signed_path = parsed.path + "?" + parsed.query
    assert request.get_header("X-integration-signature") == integration_signature(
        settings.shared_secret, "GET", signed_path,
        request.get_header("X-integration-timestamp"),
        request.get_header("X-integration-nonce"), request.data or b"",
    )


def test_mapped_admin_ids_are_explicit(monkeypatch):
    monkeypatch.setenv("CHUAN_HOA_ADMIN_BASE_URL", "https://chuanhoa.example.test")
    monkeypatch.setenv("CHUAN_HOA_ADMIN_CLIENT_ID", "bidding-admin")
    monkeypatch.setenv("CHUAN_HOA_ADMIN_SHARED_SECRET", "s" * 32)
    monkeypatch.setenv("CHUAN_HOA_ADMIN_MAPPED_USER_IDS", "u-1, u-2")
    monkeypatch.setenv("CHUAN_HOA_ADMIN_ENABLED", "true")
    settings = ChuanHoaIntegrationSettings.from_env()
    assert settings.configured
    assert settings.mapped_user_ids == frozenset({"u-1", "u-2"})


def test_feature_toggle_disables_even_fully_configured_integration(monkeypatch):
    monkeypatch.setenv("CHUAN_HOA_ADMIN_BASE_URL", "https://chuanhoa.example.test")
    monkeypatch.setenv("CHUAN_HOA_ADMIN_CLIENT_ID", "bidding-admin")
    monkeypatch.setenv("CHUAN_HOA_ADMIN_SHARED_SECRET", "s" * 32)
    monkeypatch.setenv("CHUAN_HOA_ADMIN_ENABLED", "false")
    assert not ChuanHoaIntegrationSettings.from_env().configured


def test_configured_ca_bundle_is_loaded_only_by_server_transport(monkeypatch):
    settings = ChuanHoaIntegrationSettings("https://localhost:7443", "bidding-admin", "s" * 32, frozenset(), enabled=True, ca_bundle="test-ca.pem")
    contexts = []
    monkeypatch.setattr("backend.integrations.chuan_hoa.ssl.create_default_context", lambda cafile: contexts.append(cafile) or object())
    def fake_urlopen(_request, **options):
        assert options["context"] is not None
        return _Response()
    monkeypatch.setattr("backend.integrations.chuan_hoa.urlopen", fake_urlopen)
    asyncio.run(ChuanHoaAdminClient(settings).capabilities())
    assert contexts == ["test-ca.pem"]


def _request():
    return SimpleNamespace(headers={}, query_params={}, state=SimpleNamespace())


def test_workspace_admin_cannot_access_cross_application_route(monkeypatch):
    async def auth(*_args, **_kwargs): return False, "Super Admin required"
    monkeypatch.setattr(routes, "run_database_read", auth)
    response = asyncio.run(routes.admin_chuan_hoa_capabilities_api(_request()))
    assert response.status_code == 403
    assert json.loads(response.body)["code"] == "SUPER_ADMIN_REQUIRED"


def test_unmapped_super_admin_is_denied_before_upstream_call(monkeypatch):
    actor = SimpleNamespace(user_id="admin-1")
    async def auth(*_args, **_kwargs): return True, actor
    async def write(_operation): return None
    monkeypatch.setattr(routes, "run_database_read", auth)
    monkeypatch.setattr(routes, "run_database_write", write)
    monkeypatch.setenv("CHUAN_HOA_ADMIN_MAPPED_USER_IDS", "admin-2")
    response = asyncio.run(routes.admin_chuan_hoa_capabilities_api(_request()))
    assert response.status_code == 403
    assert json.loads(response.body)["code"] == "CHUAN_HOA_ADMIN_NOT_MAPPED"


def test_mapped_super_admin_reaches_signed_upstream_adapter(monkeypatch):
    actor = SimpleNamespace(user_id="admin-1")
    calls = []
    async def auth(*_args, **_kwargs): return True, actor
    async def write(_operation): return None
    class Client:
        def __init__(self, settings): calls.append(settings)
        async def capabilities(self): return {"schema": "chuanhoa.admin.integration.v1", "application": "chuan-hoa", "status": "available", "capabilities": {}}
    monkeypatch.setattr(routes, "run_database_read", auth)
    monkeypatch.setattr(routes, "run_database_write", write)
    monkeypatch.setattr(routes, "ChuanHoaAdminClient", Client)
    monkeypatch.setenv("CHUAN_HOA_ADMIN_MAPPED_USER_IDS", "admin-1")
    response = asyncio.run(routes.admin_chuan_hoa_capabilities_api(_request()))
    payload = json.loads(response.body)
    assert response.status_code == 200
    assert payload["application"] == "chuan-hoa"
    assert len(calls) == 1


def test_mutation_overwrites_browser_actor_and_preserves_unknown_timeout(monkeypatch):
    actor = SimpleNamespace(user_id="admin-1")
    received = []
    async def auth(*_args, **_kwargs): return True, actor
    async def write(_operation): return None
    class Client:
        def __init__(self, _settings): pass
        async def extend_entitlement(self, payload, key):
            received.append((payload, key))
            raise ChuanHoaIntegrationError("CHUAN_HOA_INTEGRATION_TIMEOUT", "unknown result", 504)
    class Request:
        headers = {"Idempotency-Key": "idempotency-key-123456"}
        query_params = {}
        state = SimpleNamespace()
        async def json(self):
            return {"userId": "user-1", "productId": "product-1", "featureCodes": ["a"], "durationDays": 30, "reason": "support", "actorId": "browser-forged"}
    monkeypatch.setattr(routes, "run_database_read", auth)
    monkeypatch.setattr(routes, "run_database_write", write)
    monkeypatch.setattr(routes, "ChuanHoaAdminClient", Client)
    monkeypatch.setattr(routes, "get_request_id", lambda _request: "00000000-0000-0000-0000-000000000001")
    monkeypatch.setenv("CHUAN_HOA_ADMIN_MAPPED_USER_IDS", "admin-1")
    response = asyncio.run(routes.admin_chuan_hoa_extend_entitlement_api(Request()))
    assert response.status_code == 504
    assert json.loads(response.body)["code"] == "CHUAN_HOA_INTEGRATION_TIMEOUT"
    assert received[0][0]["actorId"] == "admin-1"
    assert received[0][0]["correlationId"] == "00000000-0000-0000-0000-000000000001"


def test_mutation_rechecks_authority_before_upstream_dispatch(monkeypatch):
    actor = SimpleNamespace(user_id="admin-1")
    calls = []
    async def auth(*_args, **kwargs):
        calls.append(kwargs.get("fresh", False))
        return (False, "Session revoked") if kwargs.get("fresh") else (True, actor)
    async def write(_operation): return None
    class Request:
        headers = {"Idempotency-Key": "idempotency-key-123456"}
        query_params = {}
        state = SimpleNamespace()
        async def json(self):
            return {"userId": "user-1", "productId": "product-1", "featureCodes": ["a"], "durationDays": 30, "reason": "support"}
    class Client:
        def __init__(self, _settings): pass
        async def extend_entitlement(self, *_args, **_kwargs):
            raise AssertionError("revoked authority must not dispatch upstream")
    monkeypatch.setattr(routes, "run_database_read", auth)
    monkeypatch.setattr(routes, "run_database_write", write)
    monkeypatch.setattr(routes, "ChuanHoaAdminClient", Client)
    monkeypatch.setenv("CHUAN_HOA_ADMIN_MAPPED_USER_IDS", "admin-1")
    response = asyncio.run(routes.admin_chuan_hoa_extend_entitlement_api(Request()))
    assert response.status_code == 403
    assert calls == [False, True]


def test_audit_resource_is_allowlisted_and_signed(monkeypatch):
    settings = ChuanHoaIntegrationSettings("https://chuanhoa.example.test", "bidding-admin", "s" * 32, frozenset({"u-1"}), enabled=True)
    seen = []
    class Response:
        def __enter__(self): return self
        def __exit__(self, *_): return False
        def read(self): return b'{"items":[],"page":1,"pageSize":25,"total":0}'
    def fake_urlopen(request, **_options):
        seen.append(request.full_url)
        return Response()
    monkeypatch.setattr("backend.integrations.chuan_hoa.urlopen", fake_urlopen)
    result = asyncio.run(ChuanHoaAdminClient(settings).read_collection("audit"))
    assert result["total"] == 0
    assert "/v1/admin/integration/audit?" in seen[0]


def test_upstream_envelope_is_validated_and_unwrapped_once():
    page = {"items": [], "page": 1, "pageSize": 25, "total": 0}
    envelope = {"schema": "chuanhoa.admin.integration.v1", "application": "chuan-hoa", "status": "available", "data": page}
    assert routes._unwrap_upstream(envelope) is page
    assert routes._unwrap_upstream(envelope, capabilities=True) is envelope
    for invalid in ({}, {**envelope, "application": "biddingflow"}, {**envelope, "schema": "unknown"}, {**envelope, "data": []}):
        try:
            routes._unwrap_upstream(invalid)
        except ChuanHoaIntegrationError as error:
            assert error.code == "CHUAN_HOA_INTEGRATION_INVALID_RESPONSE"
        else:
            raise AssertionError("invalid upstream envelope was accepted")


def test_collection_proxy_returns_page_not_nested_upstream_envelope(monkeypatch):
    actor = SimpleNamespace(user_id="admin-1")
    async def auth(*_args, **_kwargs): return True, actor
    async def write(_operation): return None
    class Client:
        def __init__(self, _settings): pass
        async def read_collection(self, resource, **_kwargs):
            return {"schema": "chuanhoa.admin.integration.v1", "application": "chuan-hoa", "status": "available", "data": {"items": [{"id": "audit-1"}], "page": 1, "pageSize": 25, "total": 1}}
    request = SimpleNamespace(query_params={"page": "1", "pageSize": "25"}, headers={}, state=SimpleNamespace())
    monkeypatch.setattr(routes, "run_database_read", auth)
    monkeypatch.setattr(routes, "run_database_write", write)
    monkeypatch.setattr(routes, "ChuanHoaAdminClient", Client)
    monkeypatch.setenv("CHUAN_HOA_ADMIN_MAPPED_USER_IDS", "admin-1")
    response = asyncio.run(routes.admin_chuan_hoa_audit_api(request))
    payload = json.loads(response.body)
    assert payload["data"]["items"] == [{"id": "audit-1"}]
    assert "data" not in payload["data"]
