import asyncio
import json

from starlette.requests import Request
from starlette.responses import JSONResponse

from backend import app as app_module
from backend.api import org_routes
from backend.auth import auth_routes
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError


def _request(path="/api/auth/logout", method="POST"):
    return Request(
        {
            "type": "http",
            "method": method,
            "path": path,
            "path_params": {"file_path": "nha_thau/seal.png"},
            "headers": [],
            "query_string": b"",
            "client": ("127.0.0.1", 12345),
            "server": ("testserver", 80),
            "scheme": "http",
        }
    )


def _payload(response):
    return json.loads(response.body.decode("utf-8"))


def test_logout_runs_session_revoke_and_audit_in_write_lane(monkeypatch):
    request = _request()
    expected = JSONResponse({"success": True})
    calls = []

    def sync_handler(received_request):
        assert received_request is request
        return expected

    async def write_lane(function, *args, **kwargs):
        calls.append((function, args, kwargs))
        return function(*args, **kwargs)

    monkeypatch.setattr(auth_routes, "_logout_sync", sync_handler)
    monkeypatch.setattr(auth_routes, "run_database_write", write_lane)

    response = asyncio.run(auth_routes.logout_api(request))

    assert response is expected
    assert calls == [(sync_handler, (request,), {})]


def test_logout_returns_stable_overload_response(monkeypatch):
    async def reject(*args, **kwargs):
        raise BlockingIOBusyError("full")

    monkeypatch.setattr(auth_routes, "run_database_write", reject)

    response = asyncio.run(auth_routes.logout_api(_request()))

    assert response.status_code == 503
    assert response.headers["Retry-After"] == "1"
    assert _payload(response)["code"] == "DATABASE_WRITE_QUEUE_FULL"


def test_protected_image_authorization_runs_in_read_lane(monkeypatch):
    request = _request("/images/nha_thau/seal.png", "GET")
    expected = JSONResponse({"allowed": True})
    calls = []

    def sync_handler(received_request):
        assert received_request is request
        return expected

    async def read_lane(function, *args, **kwargs):
        calls.append((function, args, kwargs))
        return function(*args)

    monkeypatch.setattr(app_module, "_protected_image_response_sync", sync_handler)
    monkeypatch.setattr(app_module, "run_database_read", read_lane)

    response = asyncio.run(app_module.protected_image_api(request))

    assert response is expected
    assert calls == [(sync_handler, (request,), {"timeout_seconds": 10.0})]


def test_protected_image_authorization_reports_read_timeout(monkeypatch):
    async def reject(*args, **kwargs):
        raise BlockingIOTimeoutError("slow")

    monkeypatch.setattr(app_module, "run_database_read", reject)

    response = asyncio.run(app_module.protected_image_api(_request("/images/nha_thau/seal.png", "GET")))

    assert response.status_code == 503
    assert response.headers["Retry-After"] == "1"
    assert _payload(response)["code"] == "DATABASE_READ_TIMEOUT"


def test_document_export_capability_read_runs_in_read_lane(monkeypatch):
    request = _request("/api/organizations/org-a/document-export-capabilities/user-1", "GET")
    expected = JSONResponse({"success": True})
    calls = []

    def sync_handler(received_request):
        assert received_request is request
        return expected

    async def read_lane(function, *args, **kwargs):
        calls.append((function, args, kwargs))
        return function(*args)

    monkeypatch.setattr(org_routes, "_get_document_export_capabilities_sync", sync_handler)
    monkeypatch.setattr(org_routes, "run_database_read", read_lane)

    response = asyncio.run(org_routes.get_document_export_capabilities_api(request))

    assert response is expected
    assert calls == [(sync_handler, (request,), {"timeout_seconds": 10.0})]


def test_personal_subscription_transaction_runs_in_write_lane(monkeypatch):
    request = _request("/api/organizations/personal-subscription", "POST")
    expected = JSONResponse({"success": True})
    request._body = b'{"user_id":"user-1","package_id":"package-1","duration_days":365}'
    calls = []

    monkeypatch.setattr(
        org_routes,
        "verify_session",
        lambda _request, required_role=None: (True, type("Role", (), {"user_id": "admin-1"})()),
    )

    def sync_handler(*args):
        return expected

    async def write_lane(function, *args, **kwargs):
        calls.append((function, args, kwargs))
        return function(*args)

    monkeypatch.setattr(org_routes, "_activate_personal_subscription_sync", sync_handler)
    monkeypatch.setattr(org_routes, "run_database_write", write_lane)

    response = asyncio.run(org_routes.activate_personal_subscription_api(request))

    assert response is expected
    assert calls == [(
        sync_handler,
        (request, "admin-1", "user-1", "package-1", 365),
        {},
    )]
