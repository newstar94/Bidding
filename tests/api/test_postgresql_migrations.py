import contextlib

import pytest

from backend.db.postgresql_migrations import (
    POSTGRESQL_BASELINE_NAME,
    POSTGRESQL_SCHEMA_VERSION,
    initialize_postgresql_database,
    postgresql_baseline_checksum,
)
from backend.db.postgresql_schema import compile_postgresql_baseline


class _RecordingCursor:
    def __init__(self, connection, rows=None):
        self.connection = connection
        self.rows = [] if rows is None else rows

    def fetchall(self):
        return self.rows


class _RecordingConnection:
    def __init__(self, applied=None):
        self.applied = [] if applied is None else applied
        self.statements = []
        self.closed = False

    def execute(self, sql, parameters=None):
        normalized = " ".join(str(sql).split())
        self.statements.append((normalized, parameters))
        rows = self.applied if normalized.startswith("SELECT version") else []
        return _RecordingCursor(self, rows)

    def executemany(self, sql, parameters):
        normalized = " ".join(str(sql).split())
        self.statements.append((normalized, list(parameters)))
        return _RecordingCursor(self)

    def cursor(self):
        return self

    def fetchone(self):
        return None

    def fetchall(self):
        return []

    def close(self):
        self.closed = True


class _RecordingDatabase:
    def __init__(self, applied=None):
        self.connection = _RecordingConnection(applied)

    def get_connection(self):
        return self.connection

    @staticmethod
    @contextlib.contextmanager
    def transaction(connection):
        yield connection


def test_postgresql_clean_baseline_is_applied_and_recorded_once():
    database = _RecordingDatabase()
    environment = {
        "ADMIN_PASSWORD": "Production-PG-Test-123!",
        "ADMIN_USERNAME": "admin",
        "ADMIN_NAME": "Administrator",
        "ADMIN_EMAIL": "admin@example.com",
        "DEFAULT_ORG_NAME": "BiddingFlow Test",
    }
    assert initialize_postgresql_database(database, environment) == POSTGRESQL_SCHEMA_VERSION
    compiled = compile_postgresql_baseline()
    statements = database.connection.statements
    assert len([sql for sql, _params in statements if sql.startswith("CREATE TABLE")]) == 46
    assert len([sql for sql, _params in statements if sql.startswith("ALTER TABLE")]) == len(
        compiled["foreignKeys"]
    )
    insert = next(item for item in statements if item[0].startswith("INSERT INTO schema_migrations"))
    assert insert[1] == (
        POSTGRESQL_SCHEMA_VERSION,
        POSTGRESQL_BASELINE_NAME,
        postgresql_baseline_checksum(),
    )
    assert database.connection.closed is True


def test_postgresql_clean_baseline_accepts_matching_history_without_reapplying():
    applied = [
        (
            POSTGRESQL_SCHEMA_VERSION,
            POSTGRESQL_BASELINE_NAME,
            postgresql_baseline_checksum(),
        )
    ]
    database = _RecordingDatabase(applied)
    assert initialize_postgresql_database(database, {}) == POSTGRESQL_SCHEMA_VERSION
    create_tables = [
        sql
        for sql, _params in database.connection.statements
        if sql.startswith("CREATE TABLE") and "schema_migrations" not in sql
    ]
    assert create_tables == []


def test_postgresql_clean_baseline_rejects_checksum_drift():
    database = _RecordingDatabase(
        [(POSTGRESQL_SCHEMA_VERSION, POSTGRESQL_BASELINE_NAME, "wrong")]
    )
    with pytest.raises(RuntimeError, match="checksum"):
        initialize_postgresql_database(database, {})
    assert database.connection.closed is True
