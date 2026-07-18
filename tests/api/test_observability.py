import asyncio
import json
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from starlette.requests import Request
from starlette.responses import JSONResponse

from backend.db.full_state_backup import FullStateBackupError
from backend.observability import metrics
from backend.shared import helpers, logging_utils
from backend.shared.async_io import _BlockingIOPool
from scripts import record_restore_drill


def _request(path="/metrics", *, client="127.0.0.1", headers=None, app=None):
    raw_headers = [
        (str(key).lower().encode("latin-1"), str(value).encode("latin-1"))
        for key, value in (headers or {}).items()
    ]
    return Request(
        {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": path,
            "raw_path": path.encode("ascii"),
            "query_string": b"",
            "headers": raw_headers,
            "client": (client, 12345),
            "server": ("testserver", 80),
            "state": {},
            "app": app or SimpleNamespace(state=SimpleNamespace(event_loop_lag_ms=0)),
        }
    )


def _run_asgi(app, scope):
    sent = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        sent.append(message)

    asyncio.run(app(scope, receive, send))
    return sent


def test_observability_middleware_uses_endpoint_name_not_raw_path(monkeypatch):
    metrics._reset_metrics_for_tests()
    monkeypatch.setenv("STRUCTURED_REQUEST_LOG_MODE", "off")

    async def account_endpoint(scope, receive, send):
        scope["endpoint"] = account_endpoint
        response = JSONResponse({"limited": True}, status_code=429)
        await response(scope, receive, send)

    scope = dict(_request("/api/accounts/private-customer-123").scope)
    messages = _run_asgi(metrics.ObservabilityMiddleware(account_endpoint), scope)
    output = metrics.render_prometheus(SimpleNamespace(state=SimpleNamespace(event_loop_lag_ms=0)))

    assert messages[0]["status"] == 429
    assert 'route="account_endpoint"' in output
    assert "private-customer-123" not in output
    assert "biddingflow_http_rate_limited_total" in output


def test_metrics_endpoint_requires_allowed_network_and_optional_token(monkeypatch):
    monkeypatch.setenv("METRICS_ENABLED", "true")
    monkeypatch.setenv("METRICS_ALLOWED_CIDRS", "127.0.0.1/32")
    monkeypatch.setenv("METRICS_BEARER_TOKEN", "metrics-secret")

    denied_network = asyncio.run(
        metrics.metrics_api(
            _request(client="203.0.113.10", headers={"Authorization": "Bearer metrics-secret"})
        )
    )
    denied_token = asyncio.run(metrics.metrics_api(_request()))
    allowed = asyncio.run(
        metrics.metrics_api(
            _request(headers={"Authorization": "Bearer metrics-secret"})
        )
    )

    assert denied_network.status_code == 403
    assert denied_token.status_code == 403
    assert allowed.status_code == 200
    assert allowed.headers["Cache-Control"] == "no-store"
    assert "biddingflow_http_requests_total" in allowed.body.decode("utf-8")
    assert "metrics-secret" not in allowed.body.decode("utf-8")


def test_metrics_endpoint_returns_retryable_503_when_io_pool_is_saturated(monkeypatch):
    from backend.shared import async_io

    async def busy(*_args, **_kwargs):
        raise async_io.BlockingIOBusyError("busy")

    monkeypatch.setattr(async_io, "run_blocking_io", busy)
    response = asyncio.run(metrics.metrics_api(_request()))

    assert response.status_code == 503
    assert response.headers["Retry-After"] == "1"
    assert response.headers["Cache-Control"] == "no-store"


def test_metrics_include_wal_disk_backup_restore_and_pool_timing(monkeypatch, tmp_path):
    database_path = tmp_path / "database" / "bidding.db"
    database_path.parent.mkdir()
    database_path.write_bytes(b"sqlite")
    (tmp_path / "database" / "bidding.db-wal").write_bytes(b"wal-data")
    backup_directory = tmp_path / "backups"
    snapshot = backup_directory / "biddingflow-full-state-20260718T000000.000000Z"
    snapshot.mkdir(parents=True)
    (snapshot / "manifest.json").write_text(
        json.dumps(
            {
                "format": "biddingflow-full-state",
                "createdAt": "2026-07-18T00:00:00Z",
            }
        ),
        encoding="utf-8",
    )
    restore_state = backup_directory / "last-restore-drill.json"
    restore_state.write_text(
        json.dumps({"recordedAt": "2026-07-18T01:00:00Z"}),
        encoding="utf-8",
    )
    monkeypatch.setattr(helpers.database, "db_path", str(database_path))
    monkeypatch.setenv("BIDDING_BACKUP_DIR", str(backup_directory))
    monkeypatch.setenv("BIDDING_RESTORE_DRILL_STATE_FILE", str(restore_state))
    assert metrics._latest_backup_timestamp(backup_directory) is None
    assert metrics._restore_drill_timestamp(backup_directory) is None
    monkeypatch.setattr(
        metrics,
        "_verified_artifact_timestamps",
        lambda _directory: (
            datetime(2026, 7, 18, tzinfo=timezone.utc).timestamp(),
            datetime(2026, 7, 18, 1, tzinfo=timezone.utc).timestamp(),
            datetime(2026, 7, 18, 1, 5, tzinfo=timezone.utc).timestamp(),
        ),
    )

    pool = _BlockingIOPool(workers=1, queue_size=0)
    try:
        assert asyncio.run(pool.run(lambda: "ok", timeout_seconds=1)) == "ok"
        stats = pool.stats()
    finally:
        pool._executor.shutdown(wait=True)
    output = metrics.render_prometheus(
        SimpleNamespace(state=SimpleNamespace(event_loop_lag_ms=25.0))
    )

    assert stats.queue_wait_seconds >= 0
    assert stats.execution_seconds >= 0
    assert "biddingflow_sqlite_wal_bytes 8" in output
    assert "biddingflow_backup_available 1" in output
    assert "biddingflow_restore_drill_available 1" in output
    assert "biddingflow_operational_artifact_last_check_timestamp_seconds" in output
    assert "biddingflow_disk_free_bytes" in output
    assert "biddingflow_event_loop_lag_seconds 0.025" in output
    assert "biddingflow_worker_pool_queue_wait_seconds_total" in output


def test_metrics_expose_audit_chain_health_without_event_labels():
    metrics._reset_metrics_for_tests()
    metrics.record_audit_chain_verification("invalid", 0.25, 42)
    metrics.record_audit_checkpoint("success")

    output = metrics.render_prometheus(
        SimpleNamespace(state=SimpleNamespace(event_loop_lag_ms=0))
    )

    assert "biddingflow_audit_chain_check_available 1" in output
    assert "biddingflow_audit_chain_valid 0" in output
    assert "biddingflow_audit_chain_rows 42" in output
    assert 'biddingflow_audit_chain_checks_total{outcome="invalid"} 1' in output
    assert 'biddingflow_audit_checkpoints_total{outcome="success"} 1' in output


def test_backup_directory_scan_is_bounded(monkeypatch, tmp_path):
    class FakeEntry:
        name = "unrelated"

        @staticmethod
        def is_dir(*, follow_symlinks):
            return False

    class BoundedScanner:
        def __init__(self):
            self.count = 0

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def __iter__(self):
            return self

        def __next__(self):
            self.count += 1
            if self.count > 10_000:
                raise AssertionError("backup scan exceeded its entry bound")
            return FakeEntry()

    scanner = BoundedScanner()
    monkeypatch.setattr(metrics.os, "scandir", lambda _path: scanner)

    assert metrics._latest_backup_timestamp(tmp_path) is None
    assert scanner.count == 10_000


def test_structured_runtime_log_has_context_and_redacts_pii(monkeypatch, tmp_path):
    monkeypatch.setattr(logging_utils, "LOG_DIR", tmp_path)
    monkeypatch.delenv("BIDDING_LOG_DIR", raising=False)
    monkeypatch.setenv("LOG_INCLUDE_EXCEPTION_DETAILS", "true")
    monkeypatch.setenv("APP_RELEASE_ID", "release-test-123")
    logging_utils.log_error(
        RuntimeError(
            "email=person@example.com password=top-secret cccd=012345678901 account=1234567890"
        ),
        "observability_test",
        request_id="request-1",
        actor_user_id="user-1",
        organization_id="org-1",
    )

    raw_line = (tmp_path / "runtime.jsonl").read_text(encoding="utf-8").strip()
    payload = json.loads(raw_line)

    assert payload["event"] == "application.error"
    assert payload["requestId"] == "request-1"
    assert payload["userId"] == "user-1"
    assert payload["organizationId"] == "org-1"
    assert payload["releaseId"] == "release-test-123"
    assert "person@example.com" not in raw_line
    assert "top-secret" not in raw_line
    assert "012345678901" not in raw_line
    assert "1234567890" not in raw_line
    assert "[REDACTED_EMAIL]" in raw_line
    assert "[REDACTED_SECRET]" in raw_line
    assert "[REDACTED_NUMBER]" in raw_line


def test_restore_drill_marker_requires_matching_verified_trees(monkeypatch, tmp_path):
    monkeypatch.setenv("BIDDING_RESTORE_DRILL_HMAC_KEY", "r" * 32)
    verification = {
        "format": "biddingflow-full-state",
        "version": 1,
        "fileCount": 3,
        "totalSizeBytes": 42,
        "database": {
            "integrity": "ok",
            "foreignKeyViolations": 0,
            "schemaVersion": 6,
        },
    }
    calls = []

    def verify(path):
        calls.append(path)
        return dict(verification)

    monkeypatch.setattr(record_restore_drill, "verify_full_state_snapshot", verify)
    snapshot = tmp_path / "snapshot"
    restored = tmp_path / "restored"
    snapshot.mkdir()
    restored.mkdir()
    manifest_bytes = b'{"format":"biddingflow-full-state","version":1}\n'
    (snapshot / "manifest.json").write_bytes(manifest_bytes)
    (restored / "manifest.json").write_bytes(manifest_bytes)
    state_file = tmp_path / "operations" / "last-restore-drill.json"
    payload = record_restore_drill.record_restore_drill(
        snapshot,
        restored,
        state_file,
        now=datetime(2026, 7, 18, 2, 0, tzinfo=timezone.utc),
    )

    assert len(calls) == 2
    assert payload["recordedAt"] == "2026-07-18T02:00:00Z"
    assert payload["integrity"]["algorithm"] == "HMAC-SHA-256"
    assert json.loads(state_file.read_text(encoding="utf-8"))["schemaVersion"] == 6
    assert not list(state_file.parent.glob(".*.partial-*"))

    (restored / "manifest.json").write_bytes(
        b'{"format":"biddingflow-full-state","version":2}\n'
    )
    with pytest.raises(FullStateBackupError, match="manifest does not match"):
        record_restore_drill.record_restore_drill(
            snapshot,
            restored,
            tmp_path / "operations" / "must-not-exist.json",
            now=datetime(2026, 7, 18, 3, 0, tzinfo=timezone.utc),
        )
