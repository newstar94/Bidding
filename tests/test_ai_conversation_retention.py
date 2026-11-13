"""ADR 0101: AI conversations expire after AI_CONVERSATION_RETENTION_DAYS."""

from __future__ import annotations

from types import SimpleNamespace

import psycopg
import pytest

import backend.lifecycle as lifecycle
from backend.ai import conversation_repository
from backend.db.db_helper import PostgresCursor, compat_row_factory
from tests.test_retention_cleanup_postgres import _test_database_url


class _FakeConnection:
    def __init__(self, rowcounts):
        self.rowcounts = list(rowcounts)
        self.calls = []
        self.commits = 0
        self.closed = False

    def execute(self, statement, parameters=None):
        self.calls.append((statement, parameters))
        return SimpleNamespace(rowcount=self.rowcounts.pop(0))

    def commit(self):
        self.commits += 1

    def close(self):
        self.closed = True


class _FakeDatabase:
    def __init__(self, connection):
        self.connection = connection

    def get_connection(self):
        return self.connection


def test_cleanup_commits_bounded_batches_until_backlog_is_drained():
    connection = _FakeConnection([2, 2, 1])

    expired = conversation_repository.cleanup_expired_conversations(
        30, db=_FakeDatabase(connection), batch_size=2
    )

    assert expired == 5
    assert connection.commits == 3
    assert connection.closed is True
    assert [parameters for _sql, parameters in connection.calls] == [(30, 2)] * 3
    statement = connection.calls[0][0]
    assert "status = 'active'" in statement
    assert "SET status = 'deleted', deleted_at = CURRENT_TIMESTAMP" in statement
    assert "FOR UPDATE SKIP LOCKED" in statement


def test_cleanup_stops_after_an_empty_batch_and_clamps_inputs():
    connection = _FakeConnection([0])

    expired = conversation_repository.cleanup_expired_conversations(
        0, db=_FakeDatabase(connection), batch_size=0
    )

    assert expired == 0
    assert connection.calls[0][1] == (1, 1)
    assert connection.closed is True


@pytest.mark.parametrize(
    ("environment", "expected_days"),
    [({}, 30), ({"AI_CONVERSATION_RETENTION_DAYS": "45"}, 45)],
)
def test_lifecycle_uses_configured_retention_and_batch_size(
    monkeypatch, environment, expected_days
):
    monkeypatch.delenv("AI_CONVERSATION_RETENTION_DAYS", raising=False)
    for name, value in environment.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setenv("RETENTION_CLEANUP_BATCH_SIZE", "7")
    calls = []

    def cleanup(days, *, db, batch_size):
        calls.append((days, db, batch_size))
        return 0

    monkeypatch.setattr(lifecycle, "cleanup_expired_conversations", cleanup)
    database = object()

    lifecycle.expire_idle_ai_conversations(database)

    assert calls == [(expected_days, database, 7)]


class _LeaderConnection:
    def __init__(self):
        self.closed = False

    def execute(self, _statement, _parameters=None):
        # Leader lock granted; every batch query finds nothing to purge.
        return SimpleNamespace(fetchone=lambda: (True,), fetchall=lambda: [])

    def commit(self):
        pass

    def rollback(self):
        pass

    def close(self):
        self.closed = True


def test_retention_sweep_expires_ai_conversations_after_other_cleanups(monkeypatch):
    order = []
    monkeypatch.setattr(lifecycle, "_delete_retention_batches", lambda *_a, **_k: None)
    for name in (
        "fail_stale_email_deliveries",
        "purge_expired_durable_document_jobs",
        "reconcile_asset_journal",
        "expire_idle_ai_conversations",
    ):
        monkeypatch.setattr(lifecycle, name, lambda _db, name=name: order.append(name))

    lifecycle._purge_retained_rows(_FakeDatabase(_LeaderConnection()))

    assert order == [
        "fail_stale_email_deliveries",
        "purge_expired_durable_document_jobs",
        "reconcile_asset_journal",
        "expire_idle_ai_conversations",
    ]


class _PostgresDatabase:
    """Hand the cleanup a qmark-compatible view of one real connection."""

    def __init__(self, raw_connection):
        self.raw_connection = raw_connection

    def get_connection(self):
        raw = self.raw_connection
        return SimpleNamespace(
            execute=lambda statement, parameters=None: PostgresCursor(raw.cursor()).execute(
                statement, parameters
            ),
            commit=raw.commit,
            close=lambda: None,
        )


def test_real_postgres_soft_deletes_only_idle_active_conversations():
    database_url = _test_database_url()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    try:
        raw = psycopg.connect(database_url, connect_timeout=5, row_factory=compat_row_factory)
    except psycopg.Error as error:
        pytest.skip(f"PostgreSQL test database is unavailable: {type(error).__name__}")
    try:
        raw.execute(
            """CREATE TEMP TABLE ai_conversations (
                   id TEXT NOT NULL,
                   organization_id TEXT NOT NULL,
                   status TEXT NOT NULL,
                   updated_at TIMESTAMPTZ NOT NULL,
                   deleted_at TIMESTAMPTZ,
                   PRIMARY KEY (organization_id, id)
               )"""
        )
        raw.execute(
            """INSERT INTO ai_conversations (id, organization_id, status, updated_at, deleted_at)
               SELECT 'idle-' || value, 'org-a', 'active',
                      CURRENT_TIMESTAMP - INTERVAL '40 days', NULL
                 FROM generate_series(1, 5) AS value"""
        )
        raw.execute(
            """INSERT INTO ai_conversations (id, organization_id, status, updated_at, deleted_at)
               VALUES ('recent', 'org-a', 'active', CURRENT_TIMESTAMP - INTERVAL '2 days', NULL),
                      ('user-deleted', 'org-b', 'deleted',
                       CURRENT_TIMESTAMP - INTERVAL '90 days',
                       CURRENT_TIMESTAMP - INTERVAL '60 days')"""
        )
        raw.commit()

        expired = conversation_repository.cleanup_expired_conversations(
            30, db=_PostgresDatabase(raw), batch_size=2
        )

        assert expired == 5
        rows = {
            row[0]: (row[1], row[2])
            for row in raw.execute(
                """SELECT id, status,
                          deleted_at > CURRENT_TIMESTAMP - INTERVAL '1 hour'
                     FROM ai_conversations"""
            ).fetchall()
        }
        assert rows["recent"] == ("active", None)
        assert rows["user-deleted"] == ("deleted", False)
        assert all(rows[f"idle-{value}"] == ("deleted", True) for value in range(1, 6))
    finally:
        raw.rollback()
        raw.close()
