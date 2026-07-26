from __future__ import annotations

from backend.shared import audit_monitor
from backend.shared.audit_chain import AuditChainVerification


def _verification(valid=True, failure=None):
    return AuditChainVerification(
        valid=valid,
        row_count=2,
        first_id=1,
        first_previous_hash="0" * 64,
        last_id=2,
        last_hash="a" * 64,
        failure=failure,
        heads=(),
    )


class _Cursor:
    def execute(self, _statement, _parameters=()):
        return self

    def fetchone(self):
        return ("installation-1",)


class _Connection:
    def __init__(self):
        self.closed = False
        self.commits = 0

    def cursor(self):
        return _Cursor()

    def commit(self):
        self.commits += 1

    def close(self):
        self.closed = True


class _Database:
    def __init__(self):
        self.connection = _Connection()

    def get_connection(self):
        return self.connection


def test_monitor_path_uses_incremental_verification_between_exports(monkeypatch) -> None:
    database = _Database()
    calls = []
    monkeypatch.setattr(
        audit_monitor,
        "_latest_checkpoint",
        lambda *_args: {"installationId": "installation-1"},
    )
    monkeypatch.setattr(
        audit_monitor,
        "inspect_audit_chain_incremental",
        lambda *_args, **_kwargs: calls.append("incremental") or _verification(),
    )
    monkeypatch.setattr(
        audit_monitor,
        "inspect_audit_chain_against_checkpoint",
        lambda *_args, **_kwargs: calls.append("full") or _verification(),
    )

    verification, checkpoint_path = audit_monitor._inspect_database(
        database,
        "checkpoint-directory",
        incremental=True,
    )

    assert verification.valid
    assert checkpoint_path is None
    assert calls == ["incremental"]
    assert database.connection.closed


def test_incremental_failure_falls_back_to_checkpoint_protected_full_scan(
    monkeypatch,
) -> None:
    database = _Database()
    calls = []
    monkeypatch.setattr(
        audit_monitor,
        "_latest_checkpoint",
        lambda *_args: {"installationId": "installation-1"},
    )
    monkeypatch.setattr(
        audit_monitor,
        "inspect_audit_chain_incremental",
        lambda *_args, **_kwargs: calls.append("incremental")
        or _verification(False, "materialized_head_mismatch"),
    )
    monkeypatch.setattr(
        audit_monitor,
        "inspect_audit_chain_against_checkpoint",
        lambda *_args, **_kwargs: calls.append("full") or _verification(),
    )

    verification, _path = audit_monitor._inspect_database(
        database,
        "checkpoint-directory",
        incremental=True,
    )

    assert verification.valid
    assert calls == ["incremental", "full"]


def test_startup_path_keeps_full_checkpoint_verification(monkeypatch) -> None:
    database = _Database()
    calls = []
    monkeypatch.setattr(
        audit_monitor,
        "_latest_checkpoint",
        lambda *_args: {"installationId": "installation-1"},
    )
    monkeypatch.setattr(
        audit_monitor,
        "inspect_audit_chain_incremental",
        lambda *_args, **_kwargs: calls.append("incremental") or _verification(),
    )
    monkeypatch.setattr(
        audit_monitor,
        "inspect_audit_chain_against_checkpoint",
        lambda *_args, **_kwargs: calls.append("full") or _verification(),
    )

    verification, _path = audit_monitor._inspect_database(
        database,
        "checkpoint-directory",
    )

    assert verification.valid
    assert calls == ["full"]
