from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

import backend.procurement_lookup.routes as routes_module
from backend.procurement_lookup.config import ProcurementLookupSettings
from backend.procurement_lookup.routes import procurement_lookup_routes
from backend.shared.async_io import BlockingIOTimeoutError


def test_procurement_lookup_route_is_registered_as_on_demand_post():
    routes = procurement_lookup_routes(Route)
    assert [(route.path, route.methods) for route in routes] == [
        ("/api/procurement/lookup", {"POST"}),
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
                "browserMode": "standard",
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
                "browserMode": "research-stealth",
                "canonicalData": {"planNo": "untrusted"},
            },
        )

    assert response.status_code == 400
    assert response.json()["code"] == "PROCUREMENT_CODE_INVALID"
    assert called is False


def test_browser_driver_and_extractor_flags_are_server_owned(monkeypatch):
    monkeypatch.setenv("MUASAMCONG_DRIVER_VUE2", "false")
    monkeypatch.setenv("MUASAMCONG_DRIVER_GENERIC", "true")
    monkeypatch.setenv("MUASAMCONG_EXTRACT_NETWORK", "true")
    monkeypatch.setenv("MUASAMCONG_EXTRACT_VUE", "false")
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

    config = ProcurementLookupSettings.from_environ()

    assert config.driver_flags == {"vue2": False, "generic": True}
    assert config.extractor_flags == {
        "network": True, "vue": False, "dom": True,
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
