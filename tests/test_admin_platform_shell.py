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

    async def run_database_read(function, *args, **_kwargs):
        if function is app_module.verify_session:
            return function(*args)
        return {
            "valid": True,
            "user": {"id": "admin-1", "name": "Admin", "platform_role": "super_admin"},
        }

    monkeypatch.setattr(app_module, "run_database_read", run_database_read)
    return TestClient(Starlette(routes=[
        Route("/admin", app_module.admin_index),
        Route("/admin/{admin_path:path}", app_module.admin_index),
        *[
            Route(path, app_module.legacy_admin_redirect)
            for path in app_module._LEGACY_ADMIN_DESTINATIONS
        ],
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
    assert "/vendor/tabler/tabler.min.css" in response.text
    assert "/vendor/tabler/tabler.min.js" in response.text
    assert "__BF_ADMIN_" not in response.text
    assert response.headers["x-robots-tag"] == "noindex, nofollow"
    assert response.headers["cache-control"] == "private, no-store"


def test_legacy_admin_routes_redirect_authorized_admin_to_exact_tabler_destination(monkeypatch):
    with _client(monkeypatch, authorized=True) as client:
        for legacy, destination in app_module._LEGACY_ADMIN_DESTINATIONS.items():
            response = client.get(legacy, follow_redirects=False)
            assert response.status_code == 308
            assert response.headers["location"] == destination
            assert response.headers["cache-control"] == "private, no-store"


def test_legacy_admin_routes_deny_non_admin_before_redirect(monkeypatch):
    with _client(monkeypatch, authorized=False) as client:
        response = client.get("/tong-quan-admin", follow_redirects=False)
    assert response.status_code == 403
    assert "location" not in response.headers
    assert response.headers["cache-control"] == "private, no-store"
