from types import SimpleNamespace

from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from backend.api import org_routes


def test_add_member_dispatches_blocking_transaction_to_database_lane(monkeypatch):
    calls = []
    session = SimpleNamespace(user_id="manager-1", active_role="manager")

    async def database_write(operation, request, role, payload):
        calls.append((operation, request, role, payload))
        return JSONResponse({"success": True})

    monkeypatch.setattr(org_routes, "verify_session", lambda _request: (True, session))
    monkeypatch.setattr(org_routes, "run_database_write", database_write)
    app = Starlette(routes=[
        Route("/api/auth/users/add-to-org", org_routes.add_user_to_org_api, methods=["POST"]),
    ])

    with TestClient(app) as client:
        response = client.post("/api/auth/users/add-to-org", json={
            "user_id": "employee-1",
            "employee_name": "Nguyen Van A",
            "phone": "0900000000",
        })

    assert response.status_code == 200
    assert len(calls) == 1
    operation, _request, role, payload = calls[0]
    assert operation is org_routes._add_user_to_org_sync
    assert role is session
    assert payload == {
        "user_id": "employee-1",
        "employee_name": "Nguyen Van A",
        "phone": "0900000000",
    }
