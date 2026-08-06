from types import SimpleNamespace

import pytest
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

import backend.contractor_risk.routes as routes_module
from backend.contractor_risk.routes import (
    ContractorRiskRouteError,
    _resolve_blocking,
    contractor_risk_routes,
)


def test_contractor_risk_route_is_registered():
    routes = contractor_risk_routes(Route)
    assert len(routes) == 1
    assert routes[0].path == "/api/packages/{package_id}/bid-opening/contractors/resolve"
    assert routes[0].methods == {"POST"}


def test_api_rejects_frontend_supplied_violation_status(monkeypatch):
    called = False

    async def should_not_run(*_args, **_kwargs):
        nonlocal called
        called = True

    monkeypatch.setattr(routes_module, "run_database_write", should_not_run)
    app = Starlette(routes=contractor_risk_routes(Route))
    with TestClient(app) as client:
        response = client.post(
            "/api/packages/pkg-1/bid-opening/contractors/resolve",
            json={
                "contractorIdentifier": "vn001",
                "violationStatus": "VIOLATION_CONFIRMED",
            },
        )
    assert response.status_code == 400
    assert called is False


def test_api_response_exposes_only_minimal_ui_status(monkeypatch):
    async def fake_write(_function, _request, _package_id, _payload):
        return {
            "contractor": {
                "id": "contractor-1",
                "identifier": "vn001",
                "taxCode": "0012345678",
                "name": "Nhà thầu A",
            },
            "violationStatus": "VIOLATION_CONFIRMED",
            "bidClosingAt": "2026-06-01T00:00:00+07:00",
        }

    monkeypatch.setattr(routes_module, "run_database_write", fake_write)
    app = Starlette(routes=contractor_risk_routes(Route))
    with TestClient(app) as client:
        response = client.post(
            "/api/packages/pkg-1/bid-opening/contractors/resolve",
            json={
                "contractorIdentifier": "vn001",
                "lotId": None,
                "bidOpeningRecordId": None,
                "jointVentureId": None,
                "jointVentureMemberId": None,
            },
        )
    assert response.status_code == 200
    assert response.json()["violationStatus"] == "VIOLATION_CONFIRMED"
    assert "violations" not in response.json()
    assert "decisionNumber" not in response.json()


def test_blocking_route_requires_authentication(monkeypatch):
    monkeypatch.setattr(routes_module, "verify_session", lambda _request: (False, "invalid"))
    with pytest.raises(ContractorRiskRouteError) as raised:
        _resolve_blocking(
            SimpleNamespace(),
            "pkg-1",
            {"contractorIdentifier": "vn001"},
        )
    assert raised.value.status_code == 401


def test_blocking_route_enforces_package_write_permission(monkeypatch):
    class Connection:
        def cursor(self):
            return self

        def execute(self, *_args):
            return self

        def rollback(self):
            pass

        def close(self):
            pass

    connection = Connection()
    session = SimpleNamespace(user_id="user-1")
    monkeypatch.setattr(routes_module, "verify_session", lambda _request: (True, session))
    monkeypatch.setattr(routes_module.database, "get_connection", lambda: connection)
    monkeypatch.setattr(routes_module, "get_active_org", lambda *_args, **_kwargs: "org-1")
    monkeypatch.setattr(
        routes_module,
        "authorize_record_write",
        lambda *_args, **_kwargs: SimpleNamespace(allowed=False),
    )

    with pytest.raises(ContractorRiskRouteError) as raised:
        _resolve_blocking(
            SimpleNamespace(),
            "pkg-foreign",
            {"contractorIdentifier": "vn001"},
        )
    assert raised.value.code == "BID_OPENING_WRITE_DENIED"
    assert raised.value.status_code == 403
