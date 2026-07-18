import asyncio
import json

from starlette.requests import Request
from starlette.responses import JSONResponse

from backend.auth import admin_user_routes
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError


def _request(method="GET"):
    return Request(
        {
            "type": "http",
            "method": method,
            "path": "/api/auth/users",
            "headers": [],
            "query_string": b"",
            "client": ("127.0.0.1", 12345),
            "server": ("testserver", 80),
            "scheme": "http",
        }
    )


def _payload(response):
    return json.loads(response.body.decode("utf-8"))


def test_list_users_runs_entire_sync_handler_in_read_lane(monkeypatch):
    request = _request()
    expected = JSONResponse([{"id": "user-1"}])
    calls = []

    def sync_handler(received_request):
        assert received_request is request
        return expected

    async def read_lane(function, *args, **kwargs):
        calls.append((function, args, kwargs))
        return function(*args, **kwargs)

    monkeypatch.setattr(admin_user_routes, "_list_users_sync", sync_handler)
    monkeypatch.setattr(admin_user_routes, "run_database_read", read_lane)

    response = asyncio.run(admin_user_routes.list_users_api(request))

    assert response is expected
    assert calls == [(sync_handler, (request,), {})]


def test_list_users_returns_stable_overload_errors(monkeypatch):
    async def run_with(error):
        async def reject(*args, **kwargs):
            raise error

        monkeypatch.setattr(admin_user_routes, "run_database_read", reject)
        return await admin_user_routes.list_users_api(_request())

    busy = asyncio.run(run_with(BlockingIOBusyError("full")))
    timed_out = asyncio.run(run_with(BlockingIOTimeoutError("slow")))

    assert busy.status_code == 503
    assert busy.headers["Retry-After"] == "1"
    assert _payload(busy)["code"] == "DATABASE_READ_QUEUE_FULL"
    assert timed_out.status_code == 503
    assert _payload(timed_out)["code"] == "DATABASE_READ_TIMEOUT"


def test_delete_user_runs_entire_transaction_in_write_lane(monkeypatch):
    request = _request("DELETE")
    expected = JSONResponse({"success": True})
    calls = []

    def sync_handler(received_request):
        assert received_request is request
        return expected

    async def write_lane(function, *args, **kwargs):
        calls.append((function, args, kwargs))
        return function(*args, **kwargs)

    monkeypatch.setattr(admin_user_routes, "_delete_user_sync", sync_handler)
    monkeypatch.setattr(admin_user_routes, "run_database_write", write_lane)

    response = asyncio.run(admin_user_routes.delete_user_api(request))

    assert response is expected
    assert calls == [(sync_handler, (request,), {})]


def test_delete_user_rejects_when_write_lane_is_full(monkeypatch):
    async def reject(*args, **kwargs):
        raise BlockingIOBusyError("full")

    monkeypatch.setattr(admin_user_routes, "run_database_write", reject)

    response = asyncio.run(admin_user_routes.delete_user_api(_request("DELETE")))

    assert response.status_code == 503
    assert response.headers["Retry-After"] == "1"
    assert _payload(response)["code"] == "DATABASE_WRITE_QUEUE_FULL"
