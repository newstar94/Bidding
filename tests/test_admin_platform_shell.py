from starlette.testclient import TestClient
from starlette.applications import Starlette
from starlette.routing import Route

from backend import app as app_module


def _client(monkeypatch, *, authorized):
    monkeypatch.setattr(
        app_module,
        "verify_session",
        lambda _request, required_role=None: (
            (True, "super_admin") if authorized and required_role == "super_admin"
            else (False, "forbidden")
        ),
    )
    monkeypatch.setattr(app_module, "_frontend_bundle_enabled", lambda: False)

    async def run_database_read(_function, _request):
        return {
            "valid": True,
            "user": {"id": "admin-1", "name": "Admin", "platform_role": "super_admin"},
        }

    monkeypatch.setattr(app_module, "run_database_read", run_database_read)
    return TestClient(Starlette(routes=[
        Route("/admin", app_module.admin_index),
        Route("/admin/{admin_path:path}", app_module.admin_index),
    ]))


def test_admin_shell_denies_unauthorized_user_server_side(monkeypatch):
    with _client(monkeypatch, authorized=False) as client:
        response = client.get("/admin/users")
    assert response.status_code == 403
    assert "bf-admin-session" not in response.text
    assert response.headers["cache-control"] == "private, no-store"


def test_admin_shell_serves_authorized_deep_link(monkeypatch):
    with _client(monkeypatch, authorized=True) as client:
        response = client.get("/admin/system/jobs")
    assert response.status_code == 200
    assert 'id="bf-admin-session"' in response.text
    assert '"platform_role":"super_admin"' in response.text
    assert "/frontend/admin-platform/AdminApp.js" in response.text
    assert response.headers["x-robots-tag"] == "noindex, nofollow"
    assert response.headers["cache-control"] == "private, no-store"
