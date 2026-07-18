import sqlite3
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest

from backend.db.migrations import m0007_audit_chain_single_successor
from backend.shared.audit_chain import (
    AuditChainUnavailableError,
    EMPTY_AUDIT_HASH,
    append_audit_row,
    build_audit_checkpoint,
    insert_audit_row,
    inspect_audit_chain,
    inspect_audit_chain_against_checkpoint,
    set_audit_chain_health,
    verify_audit_chain,
    verify_audit_checkpoint,
)
from backend.shared.logging_utils import log_audit
from backend.shared.audit_monitor import _inspect_database


def _connection():
    connection = sqlite3.connect(":memory:")
    connection.execute(
        """
        CREATE TABLE audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            actor_user_id TEXT,
            organization_id TEXT,
            action TEXT NOT NULL,
            target_type TEXT,
            target_id TEXT,
            ip_address TEXT,
            metadata_json TEXT,
            created_at TEXT NOT NULL,
            previous_hash TEXT NOT NULL,
            entry_hash TEXT NOT NULL UNIQUE
        )
        """
    )
    return connection


def test_audit_rows_form_a_verifiable_hash_chain():
    connection = _connection()
    cursor = connection.cursor()
    first_hash = insert_audit_row(
        cursor,
        actor_user_id="user-1",
        organization_id="org-1",
        action="record.created",
        target_type="goi_thau",
        target_id="package-1",
        metadata_json='{"field":"value"}',
        created_at="2026-07-15T10:00:00+00:00",
    )
    second_hash = insert_audit_row(
        cursor,
        actor_user_id="user-1",
        organization_id="org-1",
        action="record.updated",
        target_type="goi_thau",
        target_id="package-1",
        created_at="2026-07-15T10:01:00+00:00",
    )
    connection.commit()

    rows = connection.execute(
        "SELECT previous_hash, entry_hash FROM audit_log ORDER BY id"
    ).fetchall()
    assert rows[0] == (EMPTY_AUDIT_HASH, first_hash)
    assert rows[1] == (first_hash, second_hash)
    assert verify_audit_chain(cursor) is True

    connection.execute("UPDATE audit_log SET target_id = 'tampered' WHERE id = 1")
    assert verify_audit_chain(cursor) is False
    connection.close()


def test_retention_can_remove_an_old_prefix_without_breaking_remaining_chain():
    connection = _connection()
    cursor = connection.cursor()
    for index in range(3):
        insert_audit_row(
            cursor,
            action=f"event-{index}",
            created_at=f"2026-07-15T10:0{index}:00+00:00",
        )
    connection.execute("DELETE FROM audit_log WHERE id = 1")

    assert verify_audit_chain(cursor) is True
    connection.close()


def test_chain_inspection_streams_rows_without_fetchall():
    connection = _connection()
    cursor = connection.cursor()
    for index in range(100):
        insert_audit_row(
            cursor,
            action=f"streamed-{index}",
            created_at=f"2026-07-15 10:{index // 60:02d}:{index % 60:02d}",
        )

    class StreamingOnlyCursor:
        def __init__(self, inner):
            self.inner = inner

        def execute(self, sql, parameters=()):
            self.inner.execute(sql, parameters)
            return self

        def fetchone(self):
            return self.inner.fetchone()

        def fetchall(self):
            raise AssertionError("audit verification must not buffer all rows")

        def __iter__(self):
            return iter(self.inner)

    verification = inspect_audit_chain(StreamingOnlyCursor(connection.cursor()))
    assert verification.valid is True
    assert verification.row_count == 100
    connection.close()


def _migration_context():
    return SimpleNamespace(assert_foreign_key_integrity=lambda _cursor: None)


def test_audit_migration_refuses_existing_tamper():
    connection = _connection()
    insert_audit_row(connection.cursor(), action="event", created_at="2026-07-15 10:00:00")
    connection.execute("UPDATE audit_log SET target_id = 'tampered'")

    with pytest.raises(RuntimeError, match="existing chain is invalid"):
        m0007_audit_chain_single_successor.apply(
            connection.cursor(), _migration_context()
        )
    assert connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_audit_log_single_successor'"
    ).fetchone() is None
    connection.close()


def test_audit_migration_refuses_existing_fork():
    connection = _connection()
    cursor = connection.cursor()
    insert_audit_row(cursor, action="first", created_at="2026-07-15 10:00:00")
    # Simulate a legacy race: a second event also points at genesis.
    cursor.execute(
        """INSERT INTO audit_log (
               action, created_at, previous_hash, entry_hash
           ) VALUES (?, ?, ?, ?)""",
        ("fork", "2026-07-15 10:01:00", EMPTY_AUDIT_HASH, "f" * 64),
    )

    with pytest.raises(RuntimeError, match="existing chain is forked"):
        m0007_audit_chain_single_successor.apply(cursor, _migration_context())
    connection.close()


def test_concurrent_standalone_appends_remain_one_chain(tmp_path):
    database_path = tmp_path / "audit-concurrency.db"
    connection = sqlite3.connect(database_path)
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA busy_timeout = 5000")
    connection.execute(
        """CREATE TABLE audit_log (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               actor_user_id TEXT,
               organization_id TEXT,
               action TEXT NOT NULL,
               target_type TEXT,
               target_id TEXT,
               ip_address TEXT,
               metadata_json TEXT,
               created_at TEXT NOT NULL,
               previous_hash TEXT NOT NULL,
               entry_hash TEXT NOT NULL UNIQUE
           )"""
    )
    m0007_audit_chain_single_successor.apply(
        connection.cursor(), _migration_context()
    )
    connection.commit()
    connection.close()

    def append(index):
        worker = sqlite3.connect(database_path, timeout=5)
        worker.execute("PRAGMA busy_timeout = 5000")
        try:
            return append_audit_row(
                worker,
                action=f"concurrent-{index}",
                created_at=f"2026-07-15 10:{index:02d}:00",
            )
        finally:
            worker.close()

    with ThreadPoolExecutor(max_workers=8) as executor:
        hashes = list(executor.map(append, range(24)))

    connection = sqlite3.connect(database_path)
    rows = connection.execute(
        "SELECT previous_hash, entry_hash FROM audit_log ORDER BY id"
    ).fetchall()
    assert len(rows) == len(hashes) == 24
    assert len({row[0] for row in rows}) == 24
    assert verify_audit_chain(connection.cursor()) is True
    connection.close()


def test_required_transactional_audit_failure_rolls_back_mutation():
    connection = _connection()
    connection.execute("CREATE TABLE protected_setting (value TEXT NOT NULL)")
    connection.execute("INSERT INTO protected_setting VALUES ('before')")
    connection.execute(
        """CREATE TRIGGER reject_audit_insert
           BEFORE INSERT ON audit_log
           BEGIN
               SELECT RAISE(ABORT, 'audit storage unavailable');
           END"""
    )
    connection.commit()

    connection.execute("BEGIN IMMEDIATE")
    cursor = connection.cursor()
    cursor.execute("UPDATE protected_setting SET value = 'after'")
    with pytest.raises(sqlite3.IntegrityError, match="audit storage unavailable"):
        log_audit("admin.setting_updated", cursor=cursor, required=True)
    connection.rollback()

    assert connection.execute("SELECT value FROM protected_setting").fetchone()[0] == "before"
    assert connection.execute("SELECT count(*) FROM audit_log").fetchone()[0] == 0
    connection.close()


def test_required_audit_write_is_blocked_after_verifier_failure():
    connection = _connection()
    try:
        set_audit_chain_health("invalid")
        with pytest.raises(AuditChainUnavailableError, match="verification failed"):
            log_audit(
                "admin.blocked",
                cursor=connection.cursor(),
                required=True,
            )
        assert connection.execute("SELECT count(*) FROM audit_log").fetchone()[0] == 0
    finally:
        set_audit_chain_health("unknown")
        connection.close()


def test_checkpoint_detects_valid_looking_rollback_and_allows_extension():
    connection = _connection()
    cursor = connection.cursor()
    first_hash = insert_audit_row(
        cursor, action="first", created_at="2026-07-15 10:00:00"
    )
    checkpoint = build_audit_checkpoint(cursor, hmac_key="checkpoint-secret")
    assert verify_audit_checkpoint(
        checkpoint, hmac_key="checkpoint-secret"
    ) is True

    insert_audit_row(cursor, action="second", created_at="2026-07-15 10:01:00")
    assert inspect_audit_chain_against_checkpoint(
        cursor, checkpoint, hmac_key="checkpoint-secret"
    ).valid is True

    connection.execute("DELETE FROM audit_log")
    insert_audit_row(cursor, action="replacement", created_at="2026-07-15 10:02:00")
    rolled_back = inspect_audit_chain_against_checkpoint(
        cursor, checkpoint, hmac_key="checkpoint-secret"
    )
    assert rolled_back.valid is False
    assert rolled_back.failure in {"checkpoint_head_mismatch", "checkpoint_head_missing"}
    assert first_hash == checkpoint["head"]["entryHash"]

    checkpoint["rowCount"] = 999
    assert verify_audit_checkpoint(
        checkpoint, hmac_key="checkpoint-secret"
    ) is False
    connection.close()


def test_periodic_inspector_checks_previous_checkpoint_before_export(tmp_path):
    database_path = tmp_path / "checkpoint-monitor.db"
    connection = sqlite3.connect(database_path)
    connection.execute(
        """CREATE TABLE audit_log (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               actor_user_id TEXT,
               organization_id TEXT,
               action TEXT NOT NULL,
               target_type TEXT,
               target_id TEXT,
               ip_address TEXT,
               metadata_json TEXT,
               created_at TEXT NOT NULL,
               previous_hash TEXT NOT NULL,
               entry_hash TEXT NOT NULL UNIQUE
           )"""
    )
    insert_audit_row(
        connection.cursor(), action="anchored", created_at="2026-07-15 10:00:00"
    )
    connection.commit()
    connection.close()

    class Database:
        @staticmethod
        def get_connection():
            return sqlite3.connect(database_path)

    checkpoint_directory = tmp_path / "checkpoints"
    valid, checkpoint_path = _inspect_database(
        Database(), checkpoint_directory, "checkpoint-secret", True
    )
    assert valid.valid is True
    assert checkpoint_path.is_file()

    connection = sqlite3.connect(database_path)
    connection.execute("DELETE FROM audit_log")
    insert_audit_row(
        connection.cursor(), action="rolled-back", created_at="2026-07-15 10:01:00"
    )
    connection.commit()
    connection.close()

    rolled_back, new_checkpoint = _inspect_database(
        Database(), checkpoint_directory, "checkpoint-secret", True
    )
    assert rolled_back.valid is False
    assert rolled_back.failure in {"checkpoint_head_mismatch", "checkpoint_head_missing"}
    assert new_checkpoint is None
    assert len(list(checkpoint_directory.glob("audit-checkpoint-*.json"))) == 1
