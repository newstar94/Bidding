import asyncio
from types import SimpleNamespace
from pathlib import Path
import shutil
import json
from datetime import datetime, timezone

import pytest

from backend.shared import audit_monitor as monitor


@pytest.mark.parametrize("valid,checkpoint", [(True, None), (True, "checkpoint.json"), (False, None)])
def test_startup_verification_controls_readiness_and_records_outcome(monkeypatch, valid, checkpoint):
    health, metrics, exports = [], [], []
    verification = SimpleNamespace(valid=valid, row_count=7, failure="anchor_mismatch")
    async def read(operation, *args, **kwargs):
        assert operation is monitor._inspect_database
        assert kwargs["timeout_seconds"] == 60.0
        return verification, checkpoint
    monkeypatch.setattr(monitor, "run_database_read", read)
    monkeypatch.setattr(monitor, "_checkpoint_destination", lambda: "")
    monkeypatch.setattr(monitor, "set_audit_chain_health", health.append)
    monkeypatch.setattr(monitor, "record_audit_chain_verification", lambda *args: metrics.append(args))
    monkeypatch.setattr(monitor, "record_audit_checkpoint", exports.append)
    if valid:
        assert asyncio.run(monitor.verify_audit_chain_before_ready(object())) is verification
    else:
        with pytest.raises(RuntimeError, match="anchor_mismatch"):
            asyncio.run(monitor.verify_audit_chain_before_ready(object()))
    assert health == ["valid" if valid else "invalid"]
    assert metrics[0][0] == health[0]
    assert metrics[0][2] == 7
    assert exports == (["success"] if checkpoint else [])


def test_startup_verifier_error_propagates_and_marks_health_error(monkeypatch):
    events = []
    failure = OSError("unavailable")
    async def read(*args, **kwargs):
        raise failure
    monkeypatch.setattr(monitor, "run_database_read", read)
    monkeypatch.setattr(monitor, "_checkpoint_destination", lambda: "")
    monkeypatch.setattr(monitor, "set_audit_chain_health", events.append)
    monkeypatch.setattr(monitor, "record_audit_chain_verification", lambda outcome, duration, rows: events.append((outcome, rows)))
    with pytest.raises(OSError) as caught:
        asyncio.run(monitor.verify_audit_chain_before_ready(object()))
    assert caught.value is failure
    assert events == ["error", ("error", 0)]


@pytest.mark.parametrize("outcome,startup,ready,reason", [
    ("valid", True, True, None),
    ("valid", False, False, None),
    ("invalid", True, False, "AUDIT_CHAIN_INVALID"),
    ("error", True, False, "AUDIT_VERIFIER_ERROR"),
])
def test_periodic_verifier_updates_readiness_and_sanitizes_errors(monkeypatch, outcome, startup, ready, reason):
    application = SimpleNamespace(state=SimpleNamespace(startup_complete=startup, ready=True))
    health, metrics, logs = [], [], []
    async def read(*args, **kwargs):
        if outcome == "error":
            raise OSError("private connection secret")
        return SimpleNamespace(valid=outcome == "valid", row_count=9, failure="anchor"), None
    async def stop(interval):
        assert interval >= 30
        raise asyncio.CancelledError
    monkeypatch.setattr(monitor, "run_database_read", read)
    monkeypatch.setattr(monitor.asyncio, "sleep", stop)
    monkeypatch.setattr(monitor, "_checkpoint_destination", lambda: "")
    monkeypatch.setattr(monitor, "set_audit_chain_health", health.append)
    monkeypatch.setattr(monitor, "record_audit_chain_verification", lambda *args: metrics.append(args))
    monkeypatch.setattr(monitor, "log_structured_event", lambda event, **kwargs: logs.append((event, kwargs)))
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(monitor.monitor_audit_chain(object(), application))
    assert application.state.ready is ready
    assert application.state.readiness_reason == reason
    assert health == [outcome]
    assert metrics[0][0] == outcome
    assert metrics[0][2] == (0 if outcome == "error" else 9)
    if outcome == "error":
        assert logs[0][1]["fields"] == {"exceptionType": "OSError"}
    elif outcome == "invalid":
        assert logs[0][1]["level"] == "CRITICAL"
    else:
        assert logs == []


@pytest.mark.parametrize("incremental_valid", [True, False])
def test_incremental_verification_keeps_checkpoint_on_fallback(monkeypatch, incremental_valid):
    events = []
    checkpoint = {"version": 3, "installationId": "installation"}
    initial = SimpleNamespace(valid=incremental_valid)
    fallback = SimpleNamespace(valid=False)
    class Connection:
        def execute(self, statement):
            events.append(statement)
            return self
        def cursor(self): return self
        def fetchone(self): return ("installation",)
        def commit(self): events.append("commit")
        def close(self): events.append("close")
    connection = Connection()
    monkeypatch.setattr(monitor, "_latest_checkpoint", lambda *args: checkpoint)
    def incremental(cursor, anchor, **kwargs):
        assert anchor is checkpoint
        assert kwargs["hmac_key"] == "test-key"
        events.append("incremental")
        return initial
    def full(cursor, anchor, **kwargs):
        assert anchor is checkpoint
        events.append("anchored-full")
        return fallback
    monkeypatch.setattr(monitor, "inspect_audit_chain_incremental", incremental)
    monkeypatch.setattr(monitor, "inspect_audit_chain_against_checkpoint", full)
    result, path = monitor._inspect_database(
        SimpleNamespace(get_connection=lambda: connection), "unused", "test-key", incremental=True,
    )
    assert result is (initial if incremental_valid else fallback)
    assert path is None
    assert events[0] == "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"
    assert ("anchored-full" in events) is (not incremental_valid)
    assert events[-2:] == ["commit", "close"]


@pytest.mark.parametrize("raw,expected", [("bad", 300), ("-1", 30), ("999999", 86400), ("60", 60)])
def test_monitor_interval_is_bounded(monkeypatch, raw, expected):
    monkeypatch.setenv("AUDIT_TEST_INTERVAL", raw)
    assert monitor._bounded_seconds("AUDIT_TEST_INTERVAL", 300, 30, 86400) == expected


@pytest.mark.parametrize("identity", ["", "..", "../outside"])
def test_checkpoint_directory_rejects_unsafe_installation_identity(tmp_path, identity):
    with pytest.raises(RuntimeError):
        monitor._installation_checkpoint_destination(tmp_path, identity)


def test_checkpoint_directory_is_bound_to_installation(tmp_path):
    assert monitor._installation_checkpoint_destination(tmp_path, "installation-a") == tmp_path / "installation-a"


def test_no_checkpoint_directory_returns_no_anchor(tmp_path):
    assert monitor._latest_checkpoint(tmp_path / "missing", "installation-a") is None
    assert monitor._latest_checkpoint(tmp_path, "installation-a") is None


def test_latest_checkpoint_skips_foreign_installation_and_legacy_format(tmp_path):
    fixtures = Path(__file__).parent / "fixtures"
    for day in (12, 13, 14):
        name = f"audit-checkpoint-202609{day}.json"
        shutil.copyfile(fixtures / name, tmp_path / name)
    selected = monitor._latest_checkpoint(tmp_path, "installation-a")
    assert selected["installationId"] == "installation-a"
    assert selected["createdAt"] == "2026-09-12T00:00:00Z"
    assert monitor._latest_checkpoint(tmp_path, "missing-installation") is None


def test_oversized_checkpoint_is_rejected_before_reading_content(monkeypatch, tmp_path):
    source = Path(__file__).parent / "fixtures" / "audit-checkpoint-20260912.json"
    target = tmp_path / source.name
    shutil.copyfile(source, target)
    original_stat = Path.stat
    def stat(path, *args, **kwargs):
        if path == target:
            return SimpleNamespace(st_size=65537)
        return original_stat(path, *args, **kwargs)
    def forbidden_read(*args, **kwargs):
        pytest.fail("Oversized checkpoint content must not be read")
    monkeypatch.setattr(Path, "stat", stat)
    monkeypatch.setattr(Path, "read_text", forbidden_read)
    with pytest.raises(RuntimeError, match="size limit"):
        monitor._latest_checkpoint(tmp_path, "installation-a")


def test_malformed_checkpoint_is_not_silently_ignored(monkeypatch, tmp_path):
    source = Path(__file__).parent / "fixtures" / "audit-checkpoint-20260912.json"
    shutil.copyfile(source, tmp_path / source.name)
    monkeypatch.setattr(Path, "read_text", lambda *args, **kwargs: "{broken")
    with pytest.raises(json.JSONDecodeError):
        monitor._latest_checkpoint(tmp_path, "installation-a")


@pytest.mark.parametrize("leader,write_fails", [(True, False), (True, True), (False, False)])
def test_checkpoint_export_commits_before_io_and_always_releases_ownership(monkeypatch, tmp_path, leader, write_fails):
    events = []
    verification = SimpleNamespace(valid=True)
    checkpoint = {"installationId": "installation-a"}
    class Connection:
        statement = ""
        def execute(self, statement):
            self.statement = statement
            events.append(statement)
            return self
        def cursor(self): return self
        def fetchone(self):
            return (leader,) if "pg_try_advisory_lock" in self.statement else ("installation-a",)
        def commit(self): events.append("commit")
        def close(self): events.append("close")
    connection = Connection()
    monkeypatch.setattr(monitor, "_latest_checkpoint", lambda *args: None)
    monkeypatch.setattr(monitor, "inspect_audit_chain", lambda cursor: verification)
    def build(cursor, **kwargs):
        assert kwargs["verification"] is verification
        events.append("build")
        return checkpoint
    def write(value, destination):
        assert value is checkpoint
        assert destination == str(tmp_path / "installation-a")
        assert events[-1] == "commit"
        events.append("write")
        if write_fails:
            raise OSError("disk unavailable")
        return "checkpoint.json"
    monkeypatch.setattr(monitor, "build_audit_checkpoint", build)
    monkeypatch.setattr(monitor, "write_audit_checkpoint", write)
    def inspect():
        return monitor._inspect_database(SimpleNamespace(get_connection=lambda: connection), str(tmp_path), export_checkpoint=True)
    if write_fails:
        with pytest.raises(OSError, match="disk unavailable"):
            inspect()
    else:
        result, path = inspect()
        assert result is verification
        assert path == ("checkpoint.json" if leader else None)
    assert ("write" in events) is leader
    assert ("build" in events) is leader
    assert any("pg_advisory_unlock" in event for event in events) is leader
    assert events[-1] == "close"


@pytest.mark.parametrize("timestamp,should_export", [
    ("fresh-aware", False), ("fresh-naive", False), ("invalid", True),
])
def test_checkpoint_age_controls_export_without_skipping_verification(monkeypatch, tmp_path, timestamp, should_export):
    now = datetime.now(timezone.utc)
    created = now.isoformat() if timestamp == "fresh-aware" else now.replace(tzinfo=None).isoformat() if timestamp == "fresh-naive" else "invalid"
    anchor = {"createdAt": created}
    events = []
    class Connection:
        statement = ""
        def execute(self, statement):
            self.statement = statement
            return self
        def fetchone(self):
            return (True,) if "pg_try_advisory_lock" in self.statement else ("installation",)
        def cursor(self): return self
        def commit(self): events.append("commit")
        def close(self): events.append("close")
    verification = SimpleNamespace(valid=True)
    def verify(cursor, checkpoint, **kwargs):
        assert checkpoint is anchor
        events.append("verify")
        return verification
    monkeypatch.setattr(monitor, "_latest_checkpoint", lambda *args: anchor)
    monkeypatch.setattr(monitor, "inspect_audit_chain_against_checkpoint", verify)
    monkeypatch.setattr(monitor, "build_audit_checkpoint", lambda *args, **kwargs: {"new": True})
    def write(*args):
        events.append("write")
        return "new.json"
    monkeypatch.setattr(monitor, "write_audit_checkpoint", write)
    result, path = monitor._inspect_database(
        SimpleNamespace(get_connection=Connection), str(tmp_path), export_checkpoint=True,
        checkpoint_min_age_seconds=86400,
    )
    assert result is verification
    assert "verify" in events
    assert ("write" in events) is should_export
    assert path == ("new.json" if should_export else None)
    assert events[-1] == "close"
