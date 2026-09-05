from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

import backend.procurement_lookup.routes as routes_module
from backend.procurement_lookup.config import ProcurementLookupSettings
from backend.procurement_lookup.routes import procurement_lookup_routes
from backend.procurement_lookup.service import ProcurementLookupService
from backend.shared.async_io import BlockingIOTimeoutError


def test_procurement_lookup_route_is_registered_as_on_demand_post():
    routes = procurement_lookup_routes(Route)
    assert [(route.path, route.methods) for route in routes] == [
        ("/api/procurement/lookup", {"POST"}),
        ("/api/procurement/health", {"GET", "HEAD"}),
    ]


def test_lookup_route_returns_only_stable_normalized_contract(monkeypatch):
    async def fake_run(_function, _request, payload, **_kwargs):
        assert payload == {
            "code": "PL2600000001",
            "workspaceLease": "org-1",
        }
        return {
            "schemaVersion": "biddingflow-procurement-preview-v1",
            "found": True,
            "kind": "PLAN",
            "inputCode": "PL2600000001",
            "canonicalCode": "PL2600000001",
            "source": {
                "provider": "MUASAMCONG_BROWSER",
                "driver": "vue2",
                "driverVersion": "2026.1",
                "extractionStrategy": "network-json",
                "parserVersion": "2026.1",
                "retrievedAt": "2026-08-11T00:00:00+00:00",
            },
            "data": {"planNo": "PL2600000001", "packages": []},
            "metrics": {"totalMs": 100},
        }

    monkeypatch.setattr(routes_module, "run_blocking_io", fake_run)
    app = Starlette(routes=procurement_lookup_routes(Route))
    with TestClient(app) as client:
        response = client.post(
            "/api/procurement/lookup",
            json={"code": "PL2600000001", "workspaceLease": "org-1"},
        )

    assert response.status_code == 200
    assert response.json()["schemaVersion"] == (
        "biddingflow-procurement-preview-v1"
    )
    assert "raw" not in response.json()


def test_lookup_route_accepts_complete_all_without_changing_legacy_defaults(
    monkeypatch,
):
    calls = []

    async def fake_run(function, request, payload, **_kwargs):
        calls.append(payload)
        return {
            "schemaVersion": "biddingflow-procurement-preview-v1",
            "found": True,
            "kind": "PLAN",
            "canonicalCode": "PL2600244105",
            "detailLevel": payload.get("detailLevel", "CANONICAL"),
            "revisionMode": payload.get("revisionMode", "LATEST"),
            "data": {},
            "rawBundle": {"schemaVersion": "biddingflow-muasamcong-raw-bundle-v2"},
        }

    monkeypatch.setattr(routes_module, "run_blocking_io", fake_run)
    app = Starlette(routes=procurement_lookup_routes(Route))
    with TestClient(app) as client:
        legacy = client.post(
            "/api/procurement/lookup",
            json={"code": "PL2600244105"},
        )
        complete = client.post(
            "/api/procurement/lookup",
            json={
                "code": "PL2600244105",
                "detailLevel": "COMPLETE",
                "revisionMode": "ALL",
            },
        )

    assert legacy.status_code == 200
    assert complete.status_code == 200
    assert calls[0] == {"code": "PL2600244105"}
    assert calls[1] == {
        "code": "PL2600244105",
        "detailLevel": "COMPLETE",
        "revisionMode": "ALL",
    }
    assert "rawBundle" in complete.json()


def test_lookup_route_rejects_invalid_detail_or_revision_modes(monkeypatch):
    called = False

    async def should_not_run(*_args, **_kwargs):
        nonlocal called
        called = True

    monkeypatch.setattr(routes_module, "run_blocking_io", should_not_run)
    app = Starlette(routes=procurement_lookup_routes(Route))
    with TestClient(app) as client:
        invalid_detail = client.post(
            "/api/procurement/lookup",
            json={"code": "PL2600244105", "detailLevel": "EVERYTHING"},
        )
        invalid_revision = client.post(
            "/api/procurement/lookup",
            json={"code": "PL2600244105", "revisionMode": "OLDEST"},
        )

    assert invalid_detail.status_code == 400
    assert invalid_revision.status_code == 400
    assert called is False


def test_lookup_timeout_explains_the_server_egress_action(monkeypatch):
    async def timeout(*_args, **_kwargs):
        raise BlockingIOTimeoutError

    monkeypatch.setattr(routes_module, "run_blocking_io", timeout)
    app = Starlette(routes=procurement_lookup_routes(Route))
    with TestClient(app) as client:
        response = client.post(
            "/api/procurement/lookup",
            json={"code": "PL2600000001", "workspaceLease": "org-1"},
        )

    assert response.status_code == 504
    assert response.json()["code"] == "PROCUREMENT_TIMEOUT"
    assert response.json()["message"] == (
        "Kết nối máy chủ tới Mua Sắm Công quá thời gian; "
        "hãy kiểm tra proxy, VPN hoặc allowlist egress."
    )


def test_lookup_route_rejects_browser_or_canonical_payload_from_client(
    monkeypatch,
):
    called = False

    async def should_not_run(*_args, **_kwargs):
        nonlocal called
        called = True

    monkeypatch.setattr(routes_module, "run_blocking_io", should_not_run)
    app = Starlette(routes=procurement_lookup_routes(Route))
    with TestClient(app) as client:
        response = client.post(
            "/api/procurement/lookup",
            json={
                "code": "PL2600000001",
                "canonicalData": {"planNo": "untrusted"},
            },
        )

    assert response.status_code == 400
    assert response.json()["code"] == "PROCUREMENT_CODE_INVALID"
    assert called is False


def test_health_response_uses_closed_contract_and_never_exposes_secrets(monkeypatch):
    class Source:
        def health(self):
            return {
                "profile": "2026.08",
                "status": "UP",
                "token": "top-secret-token",
                "cookie": "top-secret-cookie",
                "session": {
                    "status": "UP",
                    "cached": True,
                    "refreshing": False,
                    "refreshCount": 2,
                    "browserStartupMs": 10,
                    "lastError": None,
                    "token": "nested-token",
                },
                "api": {"status": "UP", "lastFailure": None, "cookie": "nested-cookie"},
            }

    async def inline(function, *args, **kwargs):
        kwargs.pop("timeout_seconds", None)
        kwargs.pop("lane", None)
        return function(*args, **kwargs)

    monkeypatch.setattr(routes_module, "run_blocking_io", inline)
    monkeypatch.setattr(
        routes_module,
        "_request_context",
        lambda _request, _lease: (type("Session", (), {"user_id": "user-1"})(), "org-1"),
    )
    monkeypatch.setattr(routes_module, "_enforce_rate_limit", lambda *_args: None)
    monkeypatch.setattr(routes_module, "get_muasamcong_source", Source)
    app = Starlette(routes=procurement_lookup_routes(Route))

    with TestClient(app) as client:
        response = client.get("/api/procurement/health")

    assert response.status_code == 200
    encoded = response.text.casefold()
    assert "token" not in encoded
    assert "cookie" not in encoded
    assert response.json()["session"]["refreshCount"] == 2


def test_browser_driver_and_extractor_flags_are_server_owned(monkeypatch):
    monkeypatch.setenv("MUASAMCONG_DRIVER_VUE2", "false")
    monkeypatch.setenv("MUASAMCONG_DRIVER_GENERIC", "true")
    monkeypatch.setenv("MUASAMCONG_EXTRACT_NETWORK", "true")
    monkeypatch.setenv("MUASAMCONG_EXTRACT_VUE", "false")
    monkeypatch.setenv("MUASAMCONG_EXTRACT_VUE3", "true")
    monkeypatch.setenv("MUASAMCONG_EXTRACT_REACT", "true")
    monkeypatch.setenv("MUASAMCONG_EXTRACT_DOM", "true")
    monkeypatch.setenv("PROCUREMENT_BROWSER_IDLE_TTL_SECONDS", "720")
    monkeypatch.setenv("PROCUREMENT_BROWSER_WORKER_TIMEOUT_SECONDS", "18")
    monkeypatch.setenv("MUASAMCONG_MAX_RESPONSE_BYTES", "524288")
    monkeypatch.setenv("MUASAMCONG_NAVIGATION_TIMEOUT_MS", "17000")
    monkeypatch.setenv("MUASAMCONG_ACTION_TIMEOUT_MS", "12000")
    monkeypatch.setenv("PROCUREMENT_LOOKUP_SHARED_CACHE_ENABLED", "true")
    monkeypatch.setenv("PROCUREMENT_LOOKUP_PLAN_CACHE_TTL_SECONDS", "600")
    monkeypatch.setenv("PROCUREMENT_LOOKUP_OPEN_PACKAGE_CACHE_TTL_SECONDS", "120")
    monkeypatch.setenv("PROCUREMENT_LOOKUP_CLOSED_PACKAGE_CACHE_TTL_SECONDS", "3600")
    monkeypatch.setenv("PROCUREMENT_BROWSER_QUEUE_TIMEOUT_MS", "400")
    monkeypatch.setenv("PROCUREMENT_RAW_CACHE_TTL_SECONDS", "450")

    config = ProcurementLookupSettings.from_environ()

    assert config.driver_flags == {"vue2": False, "generic": True}
    assert config.extractor_flags == {
        "network": True, "vue": False, "dom": True,
        "vue3": True, "react": True,
    }
    assert config.idle_ttl_seconds == 720
    assert config.worker_timeout_seconds == 18
    assert config.max_response_bytes == 524288
    assert config.navigation_timeout_ms == 17000
    assert config.action_timeout_ms == 12000
    assert config.shared_cache_enabled is True
    assert config.ttl_by_kind == {
        "PLAN": 600,
        "OPEN_PACKAGE": 120,
        "CLOSED_PACKAGE": 3600,
    }
    assert config.worker_queue_timeout_ms == 400
    assert config.raw_cache_ttl_seconds == 450


def test_revision_metadata_is_listed_without_fetching_payload_and_is_stable():
    class Source:
        name = "MUASAMCONG"
        parser_version = "test"

        def list_revision_metadata(self, code, kind):
            assert (code, kind) == ("PL2600244105", "PLAN")
            return [
                {"revisionId": "revision-2", "revisionNumber": "2"},
                {"revisionId": "revision-1", "revisionNumber": "01"},
                {"revisionId": "duplicate", "revisionNumber": "02"},
            ]

        def lookup(self, *_args, **_kwargs):
            raise AssertionError("metadata listing must not fetch revision payload")

    rows = ProcurementLookupService(Source()).list_revision_metadata(
        "PL2600244105", lookup_request_id="req-metadata"
    )

    assert rows == [
        {"revisionId": "revision-1", "revisionNumber": "01"},
        {"revisionId": "revision-2", "revisionNumber": "02"},
    ]


def test_selected_metadata_rejects_unknown_revision_before_payload_fetch():
    try:
        routes_module._select_revision_metadata(
            [{"revisionId": "revision-1", "revisionNumber": "01"}],
            "SELECTED",
            ["02"],
        )
    except Exception as error:  # noqa: BLE001 - assertion accepts the route's stable domain error
        assert str(error) == "PROCUREMENT_REVISION_INVALID"
    else:
        raise AssertionError("unknown revision must be rejected")


def test_blocking_lookup_wires_tenant_raw_cache_and_skips_duplicate_save(
    monkeypatch,
):
    captured = {}

    class Service:
        def lookup(self, code, **options):
            captured.update({"code": code, **options})
            bundle = options["raw_bundle_loader"]()
            return {
                "schemaVersion": "biddingflow-procurement-preview-v1",
                "kind": "PLAN",
                "canonicalCode": code,
                "rawBundle": bundle,
                "metrics": {
                    "cache": {"hit": True, "layer": "RAW_SNAPSHOT"},
                },
            }

    class RawRepository:
        def __init__(self, *, database):
            captured["database"] = database

        def load_fresh_plan_bundle(self, organization_id, code, **options):
            captured["rawLoad"] = (organization_id, code, options)
            return {
                "schemaVersion": "biddingflow-muasamcong-raw-bundle-v2",
                "entity": {"kind": "PLAN", "planNo": code},
            }

        def save_bundle(self, *_args):
            raise AssertionError("raw-cache hit must not save the same bundle")

    monkeypatch.setattr(
        routes_module,
        "_request_context",
        lambda *_args: (
            type("Session", (), {"user_id": "user-1"})(), "org-1"
        ),
    )
    monkeypatch.setattr(routes_module, "_enforce_rate_limit", lambda *_: None)
    monkeypatch.setattr(routes_module, "build_lookup_service", Service)
    monkeypatch.setattr(
        routes_module, "ProcurementRawSnapshotRepository", RawRepository
    )
    monkeypatch.setattr(routes_module, "get_request_id", lambda _: "req-1")

    result = routes_module._lookup_blocking(
        object(),
        {
            "code": "PL2600244105",
            "detailLevel": "COMPLETE",
            "revisionMode": "SELECTED",
            "revisionNumbers": ["00"],
        },
    )

    assert result["metrics"]["cache"]["layer"] == "RAW_SNAPSHOT"
    assert captured["cache_scope"] == "org-1"
    assert captured["lookup_request_id"] == "req-1"
    assert captured["rawLoad"][0:2] == ("org-1", "PL2600244105")
    assert captured["rawLoad"][2]["revision_mode"] == "SELECTED"
    assert captured["rawLoad"][2]["revision_numbers"] == ["00"]


def test_snapshot_and_usage_settlement_share_one_transaction(monkeypatch):
    events = []

    class Connection:
        def execute(self, statement, _parameters=None):
            events.append("begin" if statement == "BEGIN" else "execute")

        def commit(self): events.append("commit")
        def rollback(self): events.append("rollback")
        def close(self): events.append("close")

    connection = Connection()

    class Database:
        def get_connection(self):
            events.append("connection")
            return connection

    class RawRepository:
        def __init__(self, *, database): self.database = database
        def load_fresh_plan_bundle(self, *_args, **_kwargs): return None
        def save_bundle(self, _organization_id, _bundle, *, connection=None):
            events.append(("save", connection))
            return {"inserted": 1, "duplicates": 0}

    class Service:
        def lookup(self, *_args, **_kwargs):
            return {
                "rawBundle": {"complete": True},
                "metrics": {"cache": {"layer": "NONE"}},
            }

    monkeypatch.setattr(routes_module, "database", Database())
    monkeypatch.setattr(routes_module, "ProcurementRawSnapshotRepository", RawRepository)
    monkeypatch.setattr(routes_module, "build_lookup_service", Service)
    monkeypatch.setattr(
        routes_module,
        "_request_context",
        lambda *_args: (type("Session", (), {"user_id": "user-1"})(), "org-1"),
    )
    monkeypatch.setattr(routes_module, "_enforce_rate_limit", lambda *_args: None)
    monkeypatch.setattr(
        routes_module,
        "_reserve_procurement_usage",
        lambda *_args, **_kwargs: [{"id": "reservation-1"}],
    )
    monkeypatch.setattr(
        routes_module,
        "_finish_procurement_usage",
        lambda _reservations, *, consume, reason, connection=None: events.append(
            ("settle", consume, reason, connection)
        ),
    )
    monkeypatch.setattr(routes_module, "get_request_id", lambda _request: "req-1")

    result = routes_module._lookup_blocking(
        object(),
        {"code": "PL2600244105", "detailLevel": "COMPLETE"},
    )

    assert result["rawSnapshot"]["inserted"] == 1
    assert ("save", connection) in events
    assert ("settle", True, "committed", connection) in events
    assert events.index(("save", connection)) < events.index(
        ("settle", True, "committed", connection)
    ) < events.index("commit")
