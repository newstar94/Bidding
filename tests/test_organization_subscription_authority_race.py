from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from backend.api import org_routes
from backend.auth.auth_helper import SessionRole


class _Connection:
    def __init__(self):
        self.rolled_back = False
        self.closed = False

    def execute(self, _sql, _params=()):
        return self

    def cursor(self):
        return self

    def rollback(self):
        self.rolled_back = True

    def close(self):
        self.closed = True


class _Database:
    def __init__(self, connection):
        self.connection = connection

    def get_connection(self):
        return self.connection


def test_subscription_mutation_rechecks_super_admin_inside_transaction(monkeypatch):
    connection = _Connection()
    stale_actor = SessionRole("super_admin", "admin-1", platform_role="super_admin")
    monkeypatch.setattr(org_routes, "database", _Database(connection))
    monkeypatch.setattr(org_routes, "verify_session", lambda *_args, **_kwargs: (True, stale_actor))
    monkeypatch.setattr(
        org_routes,
        "verify_session_in_transaction",
        lambda *_args, **_kwargs: (False, "Phiên quản trị đã bị thu hồi."),
    )
    app = Starlette(routes=[Route("/api/organizations/subscription", org_routes.update_organization_subscription_api, methods=["POST"])])

    with TestClient(app) as client:
        response = client.post(
            "/api/organizations/subscription",
            headers={"Idempotency-Key": "race-check-12345678"},
            json={"organization_id": "org-1", "action": "lock"},
        )

    assert response.status_code == 403
    assert response.json()["error"] == "Phiên quản trị đã bị thu hồi."
    assert connection.rolled_back is True
    assert connection.closed is True
