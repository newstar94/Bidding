import asyncio
import json
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.testclient import TestClient

from backend.app import BodySizeLimitMiddleware, app, health_live_api
from backend.documents import routes_excel
from backend.documents import export_routes
from backend.auth import otp_routes
from backend.auth.auth_service import RateLimitDecision
from backend.partners import address_routes
from backend.observability import metrics
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError, _BlockingIOPool
from backend.shared.database_io import run_database_write
from backend.db.db_helper import SQLiteDatabase
from backend.sync import read_service
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
        await Request(scope, receive).body()
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

    assert endpoint_called is True
    assert sent[0]["status"] == 413
    assert _response_json(sent)["code"] == "REQUEST_BODY_TOO_LARGE"


def test_stream_limit_passes_valid_chunks_to_endpoint(monkeypatch):
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


def test_stream_limit_does_not_prefetch_or_replay_request_body(monkeypatch):
    monkeypatch.setenv("REQUEST_MAX_JSON_BYTES", "65536")
    events = []
    incoming = [
        {"type": "http.request", "body": b"hello", "more_body": True},
        {"type": "http.request", "body": b"-world", "more_body": False},
    ]
    sent = []

    async def receive():
        events.append("receive")
        return incoming.pop(0)

    async def send(message):
        sent.append(message)

    async def endpoint(scope, endpoint_receive, endpoint_send):
        events.append("endpoint")
        body = await Request(scope, endpoint_receive).body()
        response = JSONResponse({"value": body.decode("ascii")})
        await response(scope, endpoint_receive, endpoint_send)

    asyncio.run(BodySizeLimitMiddleware(endpoint)(_scope(), receive, send))

    assert events == ["endpoint", "receive", "receive"]
    assert _response_json(sent) == {"value": "hello-world"}


def test_slow_request_body_does_not_block_liveness(monkeypatch):
    monkeypatch.setenv("REQUEST_MAX_JSON_BYTES", "65536")
    body_requested = asyncio.Event()
    release_body = asyncio.Event()
    sent = []

    async def receive():
        body_requested.set()
        await release_body.wait()
        return {"type": "http.request", "body": b"{}", "more_body": False}

    async def send(message):
        sent.append(message)

    async def endpoint(scope, endpoint_receive, endpoint_send):
        await Request(scope, endpoint_receive).body()
        await JSONResponse({"ok": True})(scope, endpoint_receive, endpoint_send)

    async def exercise():
        slow_request = asyncio.create_task(
            BodySizeLimitMiddleware(endpoint)(_scope(), receive, send)
        )
        await asyncio.wait_for(body_requested.wait(), timeout=0.1)
        live = await asyncio.wait_for(
            health_live_api(SimpleNamespace()),
            timeout=0.1,
        )
        assert live.status_code == 200
        release_body.set()
        await asyncio.wait_for(slow_request, timeout=0.1)

    asyncio.run(exercise())
    assert sent[0]["status"] == 200


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


def test_database_write_lane_does_not_report_ambiguous_timeout():
    completed = threading.Event()

    def mutation():
        completed.set()
        return "committed"

    assert asyncio.run(run_database_write(mutation)) == "committed"
    assert completed.is_set()


def test_idempotent_database_write_deadline_returns_control_while_worker_finishes():
    started = threading.Event()
    release = threading.Event()
    completed = threading.Event()

    def mutation():
        started.set()
        release.wait(1)
        completed.set()
        return "committed"

    async def exercise():
        pending = asyncio.create_task(
            run_database_write(mutation, timeout_seconds=0.1)
        )
        while not started.is_set():
            await asyncio.sleep(0.001)
        with pytest.raises(BlockingIOTimeoutError):
            await pending
        assert not completed.is_set()
        release.set()
        for _ in range(100):
            if completed.is_set():
                break
            await asyncio.sleep(0.005)
        assert completed.is_set()

    asyncio.run(exercise())


def test_database_write_lane_serializes_mutations():
    first_started = threading.Event()
    release_first = threading.Event()
    second_started = threading.Event()

    def first_mutation():
        first_started.set()
        release_first.wait(1)
        return "first"

    def second_mutation():
        second_started.set()
        return "second"

    async def exercise():
        first = asyncio.create_task(run_database_write(first_mutation))
        while not first_started.is_set():
            await asyncio.sleep(0.001)
        second = asyncio.create_task(run_database_write(second_mutation))
        await asyncio.sleep(0.02)
        assert not second_started.is_set()

        live = await asyncio.wait_for(
            health_live_api(SimpleNamespace()),
            timeout=0.1,
        )
        assert live.status_code == 200

        release_first.set()
        assert await first == "first"
        assert await second == "second"

    asyncio.run(exercise())


def test_liveness_remains_responsive_while_sqlite_writer_waits_for_lock(tmp_path):
    test_database = SQLiteDatabase(tmp_path / "locked-writer.db")
    blocker = test_database.get_connection()
    blocker.execute("CREATE TABLE lock_probe (id INTEGER PRIMARY KEY, value TEXT)")
    blocker.execute("INSERT INTO lock_probe (id, value) VALUES (1, 'before')")
    blocker.commit()
    blocker.execute("BEGIN IMMEDIATE")
    blocker.execute("UPDATE lock_probe SET value = 'held' WHERE id = 1")
    worker_started = threading.Event()

    def waiting_mutation():
        connection = test_database.get_connection()
        try:
            worker_started.set()
            connection.execute("BEGIN IMMEDIATE")
            connection.execute("UPDATE lock_probe SET value = 'after' WHERE id = 1")
            connection.commit()
        finally:
            connection.close()

    async def exercise():
        pending = asyncio.create_task(run_database_write(waiting_mutation))
        while not worker_started.is_set():
            await asyncio.sleep(0.001)
        await asyncio.sleep(0.02)

        live = await asyncio.wait_for(
            health_live_api(SimpleNamespace()),
            timeout=0.1,
        )
        assert live.status_code == 200

        blocker.commit()
        await asyncio.wait_for(pending, timeout=1)

    try:
        asyncio.run(exercise())
        verification = test_database.get_connection()
        try:
            assert verification.execute(
                "SELECT value FROM lock_probe WHERE id = 1"
            ).fetchone()[0] == "after"
        finally:
            verification.close()
    finally:
        blocker.close()


def test_sync_read_returns_stable_503_when_database_queue_is_full(monkeypatch):
    async def reject(*_args, **_kwargs):
        raise BlockingIOBusyError("full")

    monkeypatch.setattr(read_service, "run_database_read", reject)
    request = SimpleNamespace(headers={}, state=SimpleNamespace())

    response = asyncio.run(read_service.read_sync_data(request))
    payload = json.loads(response.body)

    assert response.status_code == 503
    assert response.headers["Retry-After"] == "1"
    assert payload["code"] == "DATABASE_READ_QUEUE_FULL"


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


def test_upstream_timeout_fails_fast_with_stable_gateway_response(monkeypatch):
    async def time_out(*_args, **_kwargs):
        raise BlockingIOTimeoutError("upstream timed out")

    monkeypatch.setattr(address_routes, "_provinces_cache", None)
    monkeypatch.setattr(address_routes, "run_blocking_io", time_out)
    request = SimpleNamespace(headers={}, state=SimpleNamespace())

    response = asyncio.run(address_routes.get_provinces_api(request))
    payload = json.loads(response.body)

    assert response.status_code == 502
    assert payload["code"] == "PROVINCES_UPSTREAM_UNAVAILABLE"


def test_nearly_full_disk_is_exposed_to_the_configured_alert(monkeypatch, tmp_path):
    from backend.shared import helpers

    usage = SimpleNamespace(total=1_000, used=900, free=100)
    database_path = tmp_path / "database" / "bidding.db"
    backup_path = tmp_path / "backups"
    database_path.parent.mkdir()
    backup_path.mkdir()
    monkeypatch.setattr(helpers, "database", SimpleNamespace(db_path=database_path))
    monkeypatch.setenv("BIDDING_BACKUP_DIR", str(backup_path))
    monkeypatch.setattr(metrics.shutil, "disk_usage", lambda _path: usage)
    monkeypatch.setattr(
        metrics,
        "_verified_artifact_timestamps",
        lambda _path: (None, None, 0.0),
    )

    state = metrics._filesystem_metrics()
    assert state["disk"] == {
        "database": {"free": 100, "total": 1_000},
        "backup": {"free": 100, "total": 1_000},
    }

    rules = Path("deploy/prometheus/biddingflow-alerts.yml").read_text(
        encoding="utf-8"
    )
    assert "biddingflow_disk_free_bytes" in rules
    assert "< 0.15" in rules


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


def test_sync_mutation_runs_through_serialized_write_lane(monkeypatch):
    calls = []

    class SyncRequest:
        headers = {}
        state = SimpleNamespace()

        async def json(self):
            return {}

    async def fake_write_lane(function, *args, **kwargs):
        calls.append((function, args, kwargs))
        return JSONResponse({"success": True})

    monkeypatch.setattr(sync_service, "run_database_write", fake_write_lane)

    response = asyncio.run(sync_service.process_sync_request(SyncRequest()))

    assert response.status_code == 200
    assert calls[0][0] is sync_service._process_sync_request_blocking
    assert calls[0][1][1] == {}
    assert calls[0][2]["timeout_seconds"] is None


def test_production_sync_mutation_requires_idempotency_key(monkeypatch):
    class SyncRequest:
        headers = {}
        state = SimpleNamespace()

        async def json(self):
            return {"custompaperstatuses": [{"id": "status-1"}]}

    async def must_not_run(*_args, **_kwargs):
        raise AssertionError("write lane must not receive a non-idempotent production mutation")

    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setattr(sync_service, "run_database_write", must_not_run)

    response = asyncio.run(sync_service.process_sync_request(SyncRequest()))
    payload = json.loads(response.body)

    assert response.status_code == 400
    assert payload["code"] == "SYNC_MUTATION_ID_REQUIRED"


def test_idempotent_sync_write_has_deadline_and_stable_retry_response(monkeypatch):
    class SyncRequest:
        headers = {}
        state = SimpleNamespace()

        async def json(self):
            return {
                "clientMutationId": "mutation-deadline-1",
                "custompaperstatuses": [{"id": "status-1"}],
            }

    observed = []

    async def time_out(*args, **kwargs):
        observed.append((args, kwargs))
        raise BlockingIOTimeoutError("slow idempotent mutation")

    monkeypatch.setenv("DATABASE_WRITE_TIMEOUT_SECONDS", "7")
    monkeypatch.setattr(sync_service, "run_database_write", time_out)

    response = asyncio.run(sync_service.process_sync_request(SyncRequest()))
    payload = json.loads(response.body)

    assert response.status_code == 503
    assert response.headers["Retry-After"] == "1"
    assert payload["code"] == "DATABASE_WRITE_TIMEOUT"
    assert observed[0][1]["timeout_seconds"] == 7.0
    assert observed[0][0][2]["clientMutationId"] == "mutation-deadline-1"


def test_sync_write_returns_stable_503_when_database_queue_is_full(monkeypatch):
    class SyncRequest:
        headers = {}
        state = SimpleNamespace()

        async def json(self):
            return {}

    async def reject(*_args, **_kwargs):
        raise BlockingIOBusyError("full")

    monkeypatch.setattr(sync_service, "run_database_write", reject)

    response = asyncio.run(sync_service.process_sync_request(SyncRequest()))
    payload = json.loads(response.body)

    assert response.status_code == 503
    assert response.headers["Retry-After"] == "1"
    assert payload["code"] == "DATABASE_WRITE_QUEUE_FULL"


def test_registration_rejects_busy_password_cpu_queue_before_database(monkeypatch):
    class RegisterRequest:
        headers = {}
        client = SimpleNamespace(host="127.0.0.1")
        state = SimpleNamespace()

        async def json(self):
            return {
                "username": "bounded_user",
                "password": "A-valid-password-123!",
                "name": "Người dùng giới hạn",
                "email": "bounded@example.com",
            }

    async def reject(*_args, **_kwargs):
        raise BlockingIOBusyError("full")

    monkeypatch.setattr(
        otp_routes,
        "get_rate_limit_decision",
        lambda *_args, **_kwargs: RateLimitDecision(True, 0, 1),
    )
    monkeypatch.setattr(otp_routes, "run_cpu_bound", reject)
    monkeypatch.setattr(
        otp_routes.database,
        "get_connection",
        lambda: (_ for _ in ()).throw(AssertionError("Database must not be opened")),
    )

    response = asyncio.run(otp_routes.register_api(RegisterRequest()))
    payload = json.loads(response.body)

    assert response.status_code == 503
    assert response.headers["Retry-After"] == "1"
    assert payload["code"] == "PASSWORD_CPU_QUEUE_BUSY"


def test_readiness_exposes_resource_pressure_headers():
    with TestClient(app) as client:
        response = client.get("/health/ready")

    assert response.status_code == 200
    assert float(response.headers["X-Event-Loop-Lag-Ms"]) >= 0
    assert int(response.headers["X-Blocking-IO-In-Flight"]) >= 0
    assert int(response.headers["X-Blocking-IO-Queue-Depth"]) >= 0
    assert int(response.headers["X-Database-Read-In-Flight"]) >= 0
    assert int(response.headers["X-Database-Read-Queue-Depth"]) >= 0
    assert int(response.headers["X-Database-Write-In-Flight"]) >= 0
    assert int(response.headers["X-Database-Write-Queue-Depth"]) >= 0
    assert int(response.headers["X-CPU-Work-In-Flight"]) >= 0
    assert int(response.headers["X-CPU-Work-Queue-Depth"]) >= 0


def test_application_lifecycle_can_restart_and_reacquire_runtime_resources():
    for _attempt in range(2):
        with TestClient(app) as client:
            assert client.get("/health/live").status_code == 200
            assert client.get("/health/ready").status_code == 200


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
