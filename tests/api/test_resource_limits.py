import asyncio
import json
import threading
from types import SimpleNamespace

import pytest
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.testclient import TestClient

from backend.app import BodySizeLimitMiddleware, app
from backend.documents import routes_excel
from backend.documents import export_routes
from backend.auth.auth_service import RateLimitDecision
from backend.partners import address_routes
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError, _BlockingIOPool
from backend.sync import service as sync_service


def _scope(path="/api/test", headers=None):
    return {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode("ascii"),
        "query_string": b"",
        "headers": headers or [],
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 80),
        "state": {},
    }


def _run_asgi(middleware, scope, incoming):
    messages = list(incoming)
    sent = []

    async def receive():
        return messages.pop(0)

    async def send(message):
        sent.append(message)

    asyncio.run(middleware(scope, receive, send))
    return sent


def _response_json(messages):
    body = b"".join(
        message.get("body", b"")
        for message in messages
        if message["type"] == "http.response.body"
    )
    return json.loads(body.decode("utf-8"))


def test_stream_limit_rejects_chunked_body_without_content_length(monkeypatch):
    monkeypatch.setenv("REQUEST_MAX_JSON_BYTES", "65536")
    endpoint_called = False

    async def endpoint(scope, receive, send):
        nonlocal endpoint_called
        endpoint_called = True
        response = JSONResponse({"ok": True})
        await response(scope, receive, send)

    sent = _run_asgi(
        BodySizeLimitMiddleware(endpoint),
        _scope(),
        [
            {"type": "http.request", "body": b"a" * 40_000, "more_body": True},
            {"type": "http.request", "body": b"b" * 30_000, "more_body": False},
        ],
    )

    assert endpoint_called is False
    assert sent[0]["status"] == 413
    assert _response_json(sent)["code"] == "REQUEST_BODY_TOO_LARGE"


def test_stream_limit_replays_valid_chunks_to_endpoint(monkeypatch):
    monkeypatch.setenv("REQUEST_MAX_JSON_BYTES", "65536")

    async def endpoint(scope, receive, send):
        body = await Request(scope, receive).body()
        response = JSONResponse({"size": len(body), "value": body.decode("ascii")})
        await response(scope, receive, send)

    sent = _run_asgi(
        BodySizeLimitMiddleware(endpoint),
        _scope(),
        [
            {"type": "http.request", "body": b"hello", "more_body": True},
            {"type": "http.request", "body": b"-world", "more_body": False},
        ],
    )

    assert sent[0]["status"] == 200
    assert _response_json(sent) == {"size": 11, "value": "hello-world"}


def test_bounded_io_pool_rejects_excess_work_and_tracks_timeout():
    pool = _BlockingIOPool(workers=1, queue_size=0)
    started = threading.Event()
    release = threading.Event()

    def blocking_operation():
        started.set()
        release.wait(1)
        return "done"

    async def exercise_capacity():
        first = asyncio.create_task(
            pool.run(blocking_operation, timeout_seconds=1)
        )
        while not started.is_set():
            await asyncio.sleep(0.001)
        with pytest.raises(BlockingIOBusyError):
            await pool.run(lambda: None, timeout_seconds=1)
        release.set()
        assert await first == "done"

        with pytest.raises(BlockingIOTimeoutError):
            await pool.run(lambda: threading.Event().wait(0.2), timeout_seconds=0.1)
        await asyncio.sleep(0.22)

    try:
        asyncio.run(exercise_capacity())
        stats = pool.stats()
        assert stats.rejected == 1
        assert stats.timed_out == 1
        assert stats.completed == 2
        assert stats.in_flight == 0
    finally:
        pool._executor.shutdown(wait=True)


def test_address_catalog_fetch_runs_through_bounded_executor(monkeypatch):
    calls = []

    async def fake_run(function, *args, **kwargs):
        calls.append((function, args, kwargs))
        return [{"code": "01", "name": "Hà Nội"}]

    monkeypatch.setattr(address_routes, "_provinces_cache", None)
    monkeypatch.setattr(address_routes, "run_blocking_io", fake_run)
    request = SimpleNamespace(headers={}, state=SimpleNamespace())

    response = asyncio.run(address_routes.get_provinces_api(request))

    assert response.status_code == 200
    assert calls[0][0] is address_routes._fetch_json
    assert calls[0][2]["timeout_seconds"] == 12


def test_excel_import_rejects_excess_rows(monkeypatch):
    class Upload:
        filename = "rows.xlsx"
        content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

        async def read(self):
            return b"PK\x03\x04"

    class ExcelRequest:
        headers = {}
        state = SimpleNamespace()

        async def form(self):
            return {"file": Upload(), "type": "contractor"}

    async def fake_worker(*_args, **_kwargs):
        return [{} for _ in range(101)]

    monkeypatch.setattr(
        routes_excel,
        "verify_session",
        lambda _request: (True, SimpleNamespace(user_id="user-1")),
    )
    monkeypatch.setattr(routes_excel, "run_document_job_async", fake_worker)
    monkeypatch.setattr(routes_excel, "MAX_EXCEL_IMPORT_ROWS", 100)

    response = asyncio.run(routes_excel.import_excel_api(ExcelRequest()))
    payload = json.loads(response.body)

    assert response.status_code == 413
    assert payload["code"] == "EXCEL_ROW_LIMIT_EXCEEDED"
    assert payload["fields"] == {"maxRows": 100, "receivedRows": 101}


def test_sync_batch_limit_rejects_before_opening_database(monkeypatch):
    class SyncRequest:
        headers = {}
        state = SimpleNamespace()

        async def json(self):
            return {"custompaperstatuses": [{} for _ in range(101)]}

    monkeypatch.setenv("SYNC_MAX_BATCH_ITEMS", "100")
    monkeypatch.setattr(
        sync_service,
        "verify_session",
        lambda _request: (True, SimpleNamespace(user_id="user-1")),
    )
    monkeypatch.setattr(
        sync_service.database,
        "get_connection",
        lambda: (_ for _ in ()).throw(AssertionError("Database must not be opened")),
    )

    response = asyncio.run(sync_service.process_sync_request(SyncRequest()))
    payload = json.loads(response.body)

    assert response.status_code == 413
    assert payload["code"] == "SYNC_BATCH_TOO_LARGE"
    assert payload["fields"] == {"maxItems": 100, "receivedItems": 101}


def test_readiness_exposes_resource_pressure_headers():
    with TestClient(app) as client:
        response = client.get("/health/ready")

    assert response.status_code == 200
    assert float(response.headers["X-Event-Loop-Lag-Ms"]) >= 0
    assert int(response.headers["X-Blocking-IO-In-Flight"]) >= 0
    assert int(response.headers["X-Blocking-IO-Queue-Depth"]) >= 0


def test_heavy_document_exports_are_rate_limited_before_loading_export_module(monkeypatch):
    calls = []

    async def fake_run(function, *args, **kwargs):
        calls.append((function, args, kwargs))
        return RateLimitDecision(False, 17, 0)

    monkeypatch.setattr(export_routes, "run_blocking_io", fake_run)
    monkeypatch.setattr(
        export_routes,
        "import_module",
        lambda *_args: (_ for _ in ()).throw(AssertionError("export module must not load")),
    )
    request = SimpleNamespace(client=SimpleNamespace(host="127.0.0.1"), headers={})

    response = asyncio.run(export_routes.export_plan_api(request))

    assert response.status_code == 429
    assert response.headers["Retry-After"] == "17"
    assert calls[0][2]["max_attempts"] == 20
