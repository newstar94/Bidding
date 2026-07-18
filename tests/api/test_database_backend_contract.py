import os
import sqlite3
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import pytest

from backend.db.contracts import DatabaseBackend
from backend.db.errors import DatabasePoolTimeout
from backend.db.db_helper import SQLiteDatabase, database as configured_database
from backend.db.factory import configured_database_backend, create_database
from backend.db.postgresql import HybridRow, PostgreSQLDatabase
from backend.db.sql_adapter import (
    PostgreSQLConnectionAdapter,
    qmark_to_postgresql,
    sqlite_sql_to_postgresql,
)


class _FakeConnection:
    def __init__(self):
        self.closed = False
        from psycopg.pq import TransactionStatus

        self.info = type("Info", (), {"transaction_status": TransactionStatus.IDLE})()

    def execute(self, _sql, _params=None):
        return self

    def cursor(self):
        return self

    def fetchone(self):
        return (1,)

    def commit(self):
        return None

    def close(self):
        self.closed = True


class _FakePool:
    def __init__(self, **configuration):
        self.configuration = configuration
        self.open_calls = []
        self.closed = False

    def open(self, **configuration):
        self.open_calls.append(configuration)

    def getconn(self, **_configuration):
        return _FakeConnection()

    def close(self):
        self.closed = True

    @staticmethod
    def get_stats():
        return {"pool_size": 5, "pool_available": 3, "requests_waiting": 2}


def test_database_backend_selector_defaults_to_sqlite(tmp_path):
    environment = {"BIDDING_DB_PATH": str(tmp_path / "bidding.db")}
    assert configured_database_backend(environment) == ("sqlite", None)
    database = create_database(environment)
    assert isinstance(database, SQLiteDatabase)
    assert isinstance(database, DatabaseBackend)
    assert database.healthcheck() is True
    assert configured_database.backend_name == configured_database_backend(os.environ)[0]


def test_database_backend_selector_rejects_ambiguous_urls():
    with pytest.raises(ValueError, match="BIDDING_DB_PATH"):
        configured_database_backend({"DATABASE_URL": "sqlite:///tmp/bidding.db"})
    with pytest.raises(ValueError, match="Unsupported"):
        configured_database_backend({"DATABASE_URL": "mysql://db/app"})
    with pytest.raises(ValueError, match="host and database"):
        configured_database_backend({"DATABASE_URL": "postgresql:///"})


def test_postgresql_pool_configuration_is_bounded_and_lazy():
    environment = {
        "BIDDING_DATABASE_URL": "postgresql://app:secret@db/bidding",
        "POSTGRES_POOL_MIN_SIZE": "2",
        "POSTGRES_POOL_MAX_SIZE": "7",
        "POSTGRES_POOL_TIMEOUT_SECONDS": "3",
        "POSTGRES_POOL_MAX_WAITING": "11",
        "POSTGRES_STATEMENT_TIMEOUT_MS": "9000",
    }
    database = create_database(
        environment,
        postgresql_pool_factory=_FakePool,
    )
    assert isinstance(database, PostgreSQLDatabase)
    assert isinstance(database, DatabaseBackend)
    assert database._pool.configuration["min_size"] == 2
    assert database._pool.configuration["max_size"] == 7
    assert database._pool.configuration["max_waiting"] == 11
    assert database._pool.open_calls == []
    assert database.healthcheck() is True
    assert database._pool.open_calls == [{"wait": True, "timeout": 3.0}]
    stats = database.pool_stats()
    assert stats["size"] == 5
    assert stats["available"] == 3
    assert stats["in_use"] == 2
    assert stats["waiting"] == 2
    assert stats["acquire_count"] == 1
    database.close()
    assert database._pool.closed is True


def test_postgresql_pool_can_be_recreated_after_lifecycle_shutdown():
    database = PostgreSQLDatabase(
        "postgresql://app:secret@db/bidding",
        environ={"POSTGRES_POOL_MIN_SIZE": "0", "POSTGRES_POOL_MAX_SIZE": "2"},
        pool_factory=_FakePool,
    )
    assert database.healthcheck() is True
    first_pool = database._pool
    database.close()
    assert first_pool.closed is True

    assert database.healthcheck() is True
    assert database._pool is not first_pool
    assert database._pool.open_calls


def test_postgresql_pool_timeout_has_stable_cross_dialect_error():
    from psycopg_pool import PoolTimeout

    class TimeoutPool(_FakePool):
        def getconn(self, **_configuration):
            raise PoolTimeout("full")

    database = PostgreSQLDatabase(
        "postgresql://app:secret@db/bidding",
        environ={"POSTGRES_POOL_MIN_SIZE": "0", "POSTGRES_POOL_MAX_SIZE": "1"},
        pool_factory=TimeoutPool,
    )
    with pytest.raises(DatabasePoolTimeout) as captured:
        database.get_connection()
    assert captured.value.code == "DATABASE_POOL_TIMEOUT"
    assert database.pool_stats()["acquire_timeouts"] == 1


def test_hybrid_postgresql_row_matches_sqlite_lookup_contract():
    row = HybridRow(("id", "name"), (7, "BiddingFlow"))
    assert row[0] == row["id"] == 7
    assert row[1] == row["name"] == "BiddingFlow"
    assert row.keys() == ("id", "name")
    assert dict(row) == {"id": 7, "name": "BiddingFlow"}
    timestamp = datetime(
        2026, 7, 18, 14, 30, 45, 123456, tzinfo=timezone(timedelta(hours=7))
    )
    normalized = HybridRow(("created_at",), (timestamp,))
    assert normalized[0] == "2026-07-18 07:30:45"
    numeric = HybridRow(("ty_le",), (Decimal("12.3400"),))
    assert numeric[0] == numeric["ty_le"] == 12.34


def test_sqlite_error_classification(tmp_path):
    database = SQLiteDatabase(tmp_path / "classification.db")
    assert database.is_unique_violation(sqlite3.IntegrityError("UNIQUE constraint failed"))
    assert database.is_foreign_key_violation(sqlite3.IntegrityError("FOREIGN KEY constraint failed"))
    assert database.is_retryable_error(sqlite3.OperationalError("database is locked"))


def test_sqlite_transaction_and_savepoint_contract(tmp_path):
    database = SQLiteDatabase(tmp_path / "transactions.db")
    connection = database.get_connection()
    try:
        connection.execute("CREATE TABLE samples (id INTEGER PRIMARY KEY, value TEXT)")
        connection.commit()
        with database.transaction(connection):
            connection.execute("INSERT INTO samples VALUES (1, 'kept')")
            with pytest.raises(RuntimeError):
                with database.savepoint(connection, "nested_change"):
                    connection.execute("INSERT INTO samples VALUES (2, 'rolled-back')")
                    raise RuntimeError("rollback nested work")
        rows = connection.execute("SELECT id FROM samples ORDER BY id").fetchall()
        assert [row[0] for row in rows] == [1]
        with pytest.raises(ValueError, match="savepoint"):
            with database.savepoint(connection, "unsafe-name"):
                pass
    finally:
        connection.close()


def test_qmark_translation_ignores_literals_identifiers_and_comments():
    sql = """SELECT ?, '?' AS literal, "question?" AS identifier
             -- comment ?
             FROM sample /* block ? */ WHERE value = ? AND note = 'it''s ?'"""
    converted = qmark_to_postgresql(sql)
    assert converted.count("%s") == 2
    assert "'?' AS literal" in converted
    assert '"question?"' in converted
    assert "comment ?" in converted
    assert "block ?" in converted
    assert "'it''s ?'" in converted


def test_postgresql_connection_adapter_converts_execute_and_executemany():
    class RecordingCursor:
        def __init__(self):
            self.calls = []

        def execute(self, sql, parameters=None):
            self.calls.append(("execute", sql, parameters))

        def executemany(self, sql, parameters):
            self.calls.append(("executemany", sql, parameters))

    class RecordingConnection:
        def __init__(self):
            self.recording_cursor = RecordingCursor()

        def cursor(self):
            return self.recording_cursor

    raw = RecordingConnection()
    connection = PostgreSQLConnectionAdapter(raw)
    connection.execute("SELECT * FROM sample WHERE id = ?", (7,))
    connection.executemany("INSERT INTO sample VALUES (?, ?)", [(1, "a")])
    assert raw.recording_cursor.calls == [
        ("execute", "SELECT * FROM sample WHERE id = %s", (7,)),
        ("executemany", "INSERT INTO sample VALUES (%s, %s)", [(1, "a")]),
    ]


def test_postgresql_connection_adapter_rolls_back_read_transaction_before_close():
    from psycopg.pq import TransactionStatus

    class RecordingConnection:
        closed = False
        info = type("Info", (), {"transaction_status": TransactionStatus.INTRANS})()

        def __init__(self):
            self.calls = []

        def rollback(self):
            self.calls.append("rollback")

        def close(self):
            self.calls.append("close")
            self.closed = True

    raw = RecordingConnection()
    PostgreSQLConnectionAdapter(raw).close()
    assert raw.calls == ["rollback", "close"]


def test_postgresql_sql_adapter_converts_shared_time_and_ignore_insert():
    converted = sqlite_sql_to_postgresql(
        "INSERT OR IGNORE INTO sample (id, updated_at) VALUES (?, datetime('now'));"
    )
    assert converted == (
        "INSERT INTO sample (id, updated_at) VALUES (%s, CURRENT_TIMESTAMP) "
        "ON CONFLICT DO NOTHING;"
    )
    assert sqlite_sql_to_postgresql("BEGIN IMMEDIATE") == "BEGIN"
    assert sqlite_sql_to_postgresql("PRAGMA busy_timeout = 100") == "SELECT 1"
    assert "information_schema.tables" in sqlite_sql_to_postgresql(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
    )
    boolean_insert = sqlite_sql_to_postgresql(
        "INSERT INTO sample (id, is_latest) VALUES (?, ?);"
    )
    assert "CASE WHEN (%s)::text" in boolean_insert
    assert "is_latest = TRUE" in sqlite_sql_to_postgresql(
        "SELECT * FROM sample WHERE is_latest = 1"
    )
    assert "EXTRACT(MONTH FROM ngay_ky)" in sqlite_sql_to_postgresql(
        "SELECT * FROM hop_dong WHERE substr(ngay_ky, 6, 2) = ?"
    )


def test_shared_sync_service_does_not_reconfigure_sqlite_sessions_directly():
    service_source = Path("backend/sync/service.py").read_text(encoding="utf-8")

    assert "PRAGMA journal_mode" not in service_source
    assert "PRAGMA busy_timeout" not in service_source
