import asyncio
import signal
import socket
from pathlib import Path

import httpx
import pytest

from scripts import load_test
from scripts import process_utils
from scripts import run_load_rehearsal
from scripts.run_load_rehearsal import (
    _assert_port_available,
    _collect_worker_metrics,
    _resolve_application_root,
    _summarize_statement_rows,
    _validate_rehearsal_database_identity,
)


class _Response:
    status_code = 200

    def raise_for_status(self):
        return None

    def json(self):
        return {}


class _AsyncClient:
    workload_cookie_snapshots = []
    workload_warmups = []

    def __init__(self, *args, cookies=None, **kwargs):
        self.cookies = dict(cookies or {})
        if cookies is not None:
            self.workload_cookie_snapshots.append(dict(cookies))

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def get(self, path, *args, **kwargs):
        if self.cookies:
            self.workload_warmups.append((path, kwargs.get("headers")))
        return _Response()

    async def request(self, *args, **kwargs):
        return _Response()


def test_benchmark_logs_in_once_and_shares_one_browser_session(monkeypatch):
    login_calls = []
    _AsyncClient.workload_cookie_snapshots = []
    _AsyncClient.workload_warmups = []

    async def fake_login(client):
        login_calls.append(client)
        client.cookies.update({
            "session_token": f"session-{len(login_calls)}",
            "csrf_token": "csrf-shared",
        })
        return {"active_org_id": "org-1"}, {
            "X-CSRF-Token": "csrf-shared",
            "X-Active-Org": "org-1",
        }

    monkeypatch.setattr(load_test.httpx, "AsyncClient", _AsyncClient)
    monkeypatch.setattr(load_test, "_login", fake_login)

    result = asyncio.run(load_test.run_benchmark("http://benchmark", 4, 0))

    assert result["errors"] == {}
    assert len(login_calls) == 1
    assert _AsyncClient.workload_cookie_snapshots == [
        {"session_token": "session-1", "csrf_token": "csrf-shared"}
    ] * 4
    assert _AsyncClient.workload_warmups == [
        (
            "/api/sync-version",
            {"X-CSRF-Token": "csrf-shared", "X-Active-Org": "org-1"},
        )
    ] * 4


def test_rehearsal_database_must_be_disposable_and_distinct_from_runtime():
    runtime = ("biddingflow_dev", "127.0.0.1", 55432)

    with pytest.raises(RuntimeError, match="runtime database"):
        _validate_rehearsal_database_identity(runtime, runtime)

    with pytest.raises(RuntimeError, match="disposable"):
        _validate_rehearsal_database_identity(
            ("customer_production", "127.0.0.1", 55432),
            runtime,
        )

    _validate_rehearsal_database_identity(
        ("biddingflow_load_test", "127.0.0.1", 55432),
        runtime,
    )


def test_rehearsal_refuses_to_reuse_an_existing_listener():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen(1)
        port = listener.getsockname()[1]
        with pytest.raises(RuntimeError, match="already in use"):
            _assert_port_available("127.0.0.1", port)


def test_rehearsal_requires_a_runnable_application_tree(tmp_path: Path):
    with pytest.raises(RuntimeError, match="runnable production tree"):
        _resolve_application_root(tmp_path)

    (tmp_path / "backend").mkdir()
    (tmp_path / "backend" / "app.py").write_text("", encoding="utf-8")
    (tmp_path / "dist").mkdir()
    (tmp_path / "dist" / "secure-build.json").write_text("{}", encoding="utf-8")
    (tmp_path / "views").mkdir()

    assert _resolve_application_root(tmp_path) == tmp_path.resolve()


def test_worker_metric_collection_tolerates_one_slow_response(monkeypatch):
    class MetricsResponse:
        status_code = 200

        def __init__(self, process_id):
            self.text = (
                "# TYPE biddingflow_process_id gauge\n"
                f"biddingflow_process_id {process_id}\n"
            )

        def raise_for_status(self):
            return None

    class FlakyMetricsClient:
        request_count = 0

        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, *args, **kwargs):
            self.__class__.request_count += 1
            if self.request_count == 1:
                raise httpx.ReadTimeout("one worker is still draining")
            return MetricsResponse(100 + (self.request_count % 2))

    monkeypatch.setattr(run_load_rehearsal.httpx, "AsyncClient", FlakyMetricsClient)

    snapshots = asyncio.run(_collect_worker_metrics("http://benchmark", 2))

    assert len(snapshots) == 2


def test_statement_summary_separates_observability_and_application_queries():
    rows = [
        (
            "101", 4, 12.5, 3.125, 4, 20, 2, 0, 3, 640,
            "UPDATE sync_metadata SET current_version = current_version + $1",
        ),
        (
            "102", 10, 2.0, 0.2, 10, 5, 0, 0, 0, 0,
            "SELECT * FROM pg_stat_activity WHERE datname = current_database()",
        ),
    ]

    summary = _summarize_statement_rows(rows)

    assert summary["applicationStatementCount"] == 1
    assert summary["applicationCalls"] == 4
    assert summary["applicationTotalExecMs"] == 12.5
    assert summary["applicationWalBytes"] == 640
    assert summary["applicationTempBlocks"] == 0
    assert summary["observabilityStatementCount"] == 1
    assert summary["topApplicationStatements"][0]["queryId"] == "101"
    assert summary["topWalStatements"][0]["walBytes"] == 640


def test_windows_teardown_does_not_taskkill_after_supervisor_exits(monkeypatch):
    events = []

    class Process:
        pid = 4242

        def __init__(self):
            self.poll_results = iter((None, 0))

        def poll(self):
            return next(self.poll_results, 0)

        def send_signal(self, sent_signal):
            assert sent_signal == signal.CTRL_BREAK_EVENT
            raise OSError("console signal unavailable")

    monkeypatch.setattr(process_utils.os, "name", "nt")
    monkeypatch.setattr(
        process_utils.subprocess,
        "run",
        lambda *args, **kwargs: events.append((args, kwargs)),
    )

    process_utils.terminate_process_tree(Process())

    assert events == []


def test_windows_teardown_targets_only_the_owned_process_tree(monkeypatch):
    events = []

    class Process:
        pid = 4242

        def __init__(self):
            self.exited = False

        def poll(self):
            return 0 if self.exited else None

        def send_signal(self, sent_signal):
            events.append(("signal", sent_signal))

        def wait(self, timeout=None):
            events.append(("wait", timeout))
            return 0

        def kill(self):
            events.append(("kill",))

    process = Process()

    def targeted_taskkill(command, **kwargs):
        events.append(("taskkill", command))
        process.exited = True

    monkeypatch.setattr(process_utils.os, "name", "nt")
    monkeypatch.setattr(process_utils.subprocess, "run", targeted_taskkill)

    process_utils.terminate_process_tree(process)

    assert not any(event[0] == "signal" for event in events)
    assert ("taskkill", ["taskkill", "/PID", "4242", "/T", "/F"]) in events
