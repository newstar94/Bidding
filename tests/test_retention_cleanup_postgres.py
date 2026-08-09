from pathlib import Path
import os
import threading
import time

import psycopg
import pytest
from psycopg import sql

import backend.lifecycle as lifecycle
from backend.db.db_helper import PostgresCursor, compat_row_factory
from backend.db.upgrades import UPGRADES


RETAINED_TABLES = (
    "deleted_records",
    "sync_mutations",
    "api_idempotency",
    "rate_limit_buckets",
    "partner_lookup_cache",
    "partner_enrichment_jobs",
    "auth_sessions",
)


def _test_database_url():
    if value := os.environ.get("TEST_DATABASE_URL"):
        return value
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.is_file():
        return None
    for line in env_path.read_text(encoding="utf-8-sig").splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() == "TEST_DATABASE_URL":
            return value.strip().strip('"').strip("'") or None
    return None


class _CleanupConnection:
    """Observe committed retention state while delegating to real PostgreSQL."""

    def __init__(self, connection, initial_tombstones):
        self._connection = connection
        self._initial_tombstones = initial_tombstones
        self.commit_snapshots = []
        self.closed = False

    def execute(self, statement, parameters=None):
        return PostgresCursor(self._connection.cursor()).execute(statement, parameters)

    def commit(self):
        cursor = self._connection.cursor()
        remaining = {
            str(row[0]): int(row[1])
            for row in cursor.execute(
                "SELECT record_id, delete_version FROM deleted_records"
            ).fetchall()
        }
        watermark = {
            str(row[0]): int(row[1])
            for row in cursor.execute(
                "SELECT organization_id, min_available_version FROM sync_metadata"
            ).fetchall()
        }
        for record_id, (organization_id, delete_version) in self._initial_tombstones.items():
            if record_id not in remaining:
                assert watermark[organization_id] >= delete_version

        counts = {
            table: int(
                cursor.execute(
                    sql.SQL("SELECT COUNT(*) FROM {}").format(sql.Identifier(table))
                ).fetchone()[0]
            )
            for table in RETAINED_TABLES
        }
        self.commit_snapshots.append(counts)
        self._connection.commit()

    def rollback(self):
        self._connection.rollback()

    @property
    def in_transaction(self):
        return self._connection.info.transaction_status != psycopg.pq.TransactionStatus.IDLE

    def close(self):
        self.closed = True


class _CleanupDatabase:
    def __init__(self, connection):
        self.connection = connection

    def get_connection(self):
        return self.connection


@pytest.fixture
def retention_database(monkeypatch):
    database_url = _test_database_url()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    try:
        raw_connection = psycopg.connect(
            database_url,
            connect_timeout=5,
            row_factory=compat_row_factory,
        )
    except psycopg.Error as error:
        pytest.skip(f"PostgreSQL test database is unavailable: {type(error).__name__}")

    now = int(time.time())
    cursor = PostgresCursor(raw_connection.cursor())
    try:
        cursor.execute(
            """CREATE TEMP TABLE deleted_records (
                   record_id TEXT PRIMARY KEY,
                   organization_id TEXT NOT NULL,
                   delete_version BIGINT NOT NULL,
                   deleted_at TIMESTAMPTZ NOT NULL
               )"""
        )
        cursor.execute(
            """CREATE TEMP TABLE sync_metadata (
                   organization_id TEXT PRIMARY KEY,
                   current_version BIGINT NOT NULL,
                   min_available_version BIGINT NOT NULL,
                   updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
               )"""
        )
        cursor.execute(
            """CREATE TEMP TABLE sync_mutations (
                   organization_id TEXT NOT NULL,
                   actor_user_id TEXT NOT NULL,
                   client_mutation_id TEXT NOT NULL,
                   created_at TIMESTAMPTZ NOT NULL
               )"""
        )
        cursor.execute(
            """CREATE TEMP TABLE api_idempotency (
                   idempotency_key TEXT PRIMARY KEY,
                   created_at BIGINT NOT NULL
               )"""
        )
        cursor.execute(
            """CREATE TEMP TABLE rate_limit_buckets (
                   bucket_key TEXT PRIMARY KEY,
                   expires_at BIGINT NOT NULL
               )"""
        )
        cursor.execute(
            """CREATE TEMP TABLE partner_lookup_cache (
                   cache_key TEXT PRIMARY KEY,
                   expires_at BIGINT NOT NULL
               )"""
        )
        cursor.execute(
            """CREATE TEMP TABLE partner_enrichment_jobs (
                   id TEXT PRIMARY KEY,
                   status TEXT NOT NULL,
                   updated_at BIGINT NOT NULL
               )"""
        )
        cursor.execute(
            """CREATE TEMP TABLE auth_sessions (
                   id TEXT PRIMARY KEY,
                   revoked_at BIGINT,
                   absolute_expires_at BIGINT NOT NULL,
                   idle_expires_at BIGINT NOT NULL
               )"""
        )

        cursor.execute(
            """INSERT INTO sync_metadata
                   (organization_id, current_version, min_available_version)
               VALUES ('org-a', 20, 0), ('org-b', 20, 0)"""
        )
        cursor.execute(
            """INSERT INTO deleted_records
                   (record_id, organization_id, delete_version, deleted_at)
               VALUES
                   ('a-1', 'org-a', 1, CURRENT_TIMESTAMP - INTERVAL '10 days'),
                   ('a-2', 'org-a', 2, CURRENT_TIMESTAMP - INTERVAL '9 days'),
                   ('a-3', 'org-a', 3, CURRENT_TIMESTAMP - INTERVAL '8 days'),
                   ('b-1', 'org-b', 1, CURRENT_TIMESTAMP - INTERVAL '7 days'),
                   ('b-2', 'org-b', 2, CURRENT_TIMESTAMP - INTERVAL '6 days'),
                   ('recent', 'org-a', 4, CURRENT_TIMESTAMP)"""
        )
        cursor.execute(
            """INSERT INTO sync_mutations
                   (organization_id, actor_user_id, client_mutation_id, created_at)
               SELECT 'org-a', 'actor', 'expired-' || value,
                      CURRENT_TIMESTAMP - INTERVAL '5 days'
                 FROM generate_series(1, 5) AS value"""
        )
        cursor.execute(
            """INSERT INTO sync_mutations
                   (organization_id, actor_user_id, client_mutation_id, created_at)
               VALUES ('org-a', 'actor', 'recent', CURRENT_TIMESTAMP)"""
        )
        cursor.execute(
            """INSERT INTO api_idempotency (idempotency_key, created_at)
               SELECT 'expired-' || value, ?
                 FROM generate_series(1, 5) AS value""",
            (now - 5 * 86400,),
        )
        cursor.execute(
            "INSERT INTO api_idempotency (idempotency_key, created_at) VALUES ('recent', ?)",
            (now + 86400,),
        )
        cursor.execute(
            """INSERT INTO rate_limit_buckets (bucket_key, expires_at)
               SELECT 'expired-' || value, ?
                 FROM generate_series(1, 5) AS value""",
            (now - 1,),
        )
        cursor.execute(
            "INSERT INTO rate_limit_buckets (bucket_key, expires_at) VALUES ('recent', ?)",
            (now + 86400,),
        )
        cursor.execute(
            """INSERT INTO partner_lookup_cache (cache_key, expires_at)
               SELECT 'expired-' || value, ?
                 FROM generate_series(1, 5) AS value""",
            (now - 1,),
        )
        cursor.execute(
            "INSERT INTO partner_lookup_cache (cache_key, expires_at) VALUES ('recent', ?)",
            (now + 86400,),
        )
        cursor.execute(
            """INSERT INTO partner_enrichment_jobs (id, status, updated_at)
               SELECT 'expired-' || value, 'completed', ?
                 FROM generate_series(1, 5) AS value""",
            (now - 5 * 86400,),
        )
        cursor.execute(
            """INSERT INTO partner_enrichment_jobs (id, status, updated_at)
               VALUES ('recent', 'completed', ?), ('pending-old', 'pending', ?)""",
            (now, now - 5 * 86400),
        )
        cursor.execute(
            """INSERT INTO auth_sessions
                   (id, revoked_at, absolute_expires_at, idle_expires_at)
               SELECT 'expired-' || value, NULL, ?, ?
                 FROM generate_series(1, 5) AS value""",
            (now - 5 * 86400, now - 5 * 86400),
        )
        cursor.execute(
            """INSERT INTO auth_sessions
                   (id, revoked_at, absolute_expires_at, idle_expires_at)
               VALUES ('recent', NULL, ?, ?)""",
            (now + 86400, now + 86400),
        )
        raw_connection.commit()

        initial_tombstones = {
            str(row[0]): (str(row[1]), int(row[2]))
            for row in raw_connection.execute(
                """SELECT record_id, organization_id, delete_version
                     FROM deleted_records
                    WHERE record_id != 'recent'"""
            ).fetchall()
        }
        raw_connection.commit()
        observed_connection = _CleanupConnection(raw_connection, initial_tombstones)

        for name in (
            "SYNC_TOMBSTONE_RETENTION_DAYS",
            "SYNC_MUTATION_RETENTION_DAYS",
            "API_IDEMPOTENCY_RETENTION_DAYS",
            "PARTNER_JOB_RETENTION_DAYS",
            "SESSION_RETENTION_DAYS",
        ):
            monkeypatch.setenv(name, "1")
        monkeypatch.setenv("RETENTION_CLEANUP_BATCH_SIZE", "2")
        monkeypatch.setattr(lifecycle, "fail_stale_email_deliveries", lambda *_: 0)
        monkeypatch.setattr(lifecycle, "purge_expired_durable_document_jobs", lambda *_: 0)
        monkeypatch.setattr(lifecycle, "reconcile_asset_journal", lambda *_: 0)

        yield _CleanupDatabase(observed_connection), observed_connection, raw_connection
    finally:
        raw_connection.close()


def test_retention_cleanup_commits_bounded_batches_and_preserves_fresh_rows(
    retention_database,
):
    database, observed_connection, raw_connection = retention_database
    before = {
        table: int(
            raw_connection.execute(
                sql.SQL("SELECT COUNT(*) FROM {}").format(sql.Identifier(table))
            ).fetchone()[0]
        )
        for table in RETAINED_TABLES
    }
    raw_connection.commit()

    lifecycle._purge_retained_rows(database)

    after = {
        table: int(
            raw_connection.execute(
                sql.SQL("SELECT COUNT(*) FROM {}").format(sql.Identifier(table))
            ).fetchone()[0]
        )
        for table in RETAINED_TABLES
    }
    assert after == {
        "deleted_records": 1,
        "sync_mutations": 1,
        "api_idempotency": 1,
        "rate_limit_buckets": 1,
        "partner_lookup_cache": 1,
        "partner_enrichment_jobs": 2,
        "auth_sessions": 1,
    }
    assert dict(
        raw_connection.execute(
            "SELECT organization_id, min_available_version FROM sync_metadata"
        ).fetchall()
    ) == {"org-a": 3, "org-b": 2}
    assert observed_connection.closed is True
    assert len(observed_connection.commit_snapshots) > 1

    previous = before
    for snapshot in observed_connection.commit_snapshots:
        drops = [previous[table] - snapshot[table] for table in RETAINED_TABLES]
        assert all(0 <= drop <= 2 for drop in drops)
        assert sum(drop > 0 for drop in drops) <= 1
        previous = snapshot


def test_retention_cleanup_keeps_single_leader_across_batch_commits(
    retention_database,
):
    database, observed_connection, _raw_connection = retention_database
    first_commit = threading.Event()
    release_cleanup = threading.Event()
    original_commit = observed_connection.commit

    def commit_then_pause():
        original_commit()
        if len(observed_connection.commit_snapshots) == 1:
            first_commit.set()
            assert release_cleanup.wait(timeout=5)

    observed_connection.commit = commit_then_pause
    worker = threading.Thread(
        target=lifecycle._purge_retained_rows,
        args=(database,),
        daemon=True,
    )
    worker.start()
    assert first_commit.wait(timeout=5)

    competitor = psycopg.connect(_test_database_url(), connect_timeout=5)
    try:
        assert competitor.execute(
            "SELECT pg_try_advisory_lock(hashtext('biddingflow-retention-cleanup'))"
        ).fetchone()[0] is False
        release_cleanup.set()
        worker.join(timeout=10)
        assert worker.is_alive() is False
        assert competitor.execute(
            "SELECT pg_try_advisory_lock(hashtext('biddingflow-retention-cleanup'))"
        ).fetchone()[0] is True
        assert competitor.execute(
            "SELECT pg_advisory_unlock(hashtext('biddingflow-retention-cleanup'))"
        ).fetchone()[0] is True
    finally:
        release_cleanup.set()
        worker.join(timeout=10)
        competitor.rollback()
        competitor.close()


def _plan_index_names(plan):
    names = set()

    def visit(node):
        if index_name := node.get("Index Name"):
            names.add(str(index_name))
        for child in node.get("Plans", ()):
            visit(child)

    visit(plan[0]["Plan"])
    return names


def test_v45_real_postgres_uses_cutoff_indexes_at_realistic_cardinality():
    database_url = _test_database_url()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    try:
        connection = psycopg.connect(
            database_url,
            connect_timeout=5,
            row_factory=compat_row_factory,
        )
    except psycopg.Error as error:
        pytest.skip(f"PostgreSQL test database is unavailable: {type(error).__name__}")

    cursor = PostgresCursor(connection.cursor())
    try:
        cursor.execute(
            """CREATE TEMP TABLE deleted_records (
                   organization_id TEXT NOT NULL,
                   delete_version BIGINT NOT NULL,
                   deleted_at TIMESTAMPTZ NOT NULL
               )"""
        )
        cursor.execute(
            """CREATE TEMP TABLE sync_mutations (
                   organization_id TEXT NOT NULL,
                   created_at TIMESTAMPTZ NOT NULL
               )"""
        )
        cursor.execute(
            """CREATE TEMP TABLE partner_enrichment_jobs (
                   status TEXT NOT NULL,
                   available_at BIGINT NOT NULL,
                   created_at BIGINT NOT NULL,
                   updated_at BIGINT NOT NULL
               )"""
        )
        cursor.execute(
            """CREATE INDEX idx_deleted_records_owner_deleted
                 ON deleted_records (organization_id, deleted_at)"""
        )
        cursor.execute(
            """CREATE INDEX idx_sync_mutations_owner_created
                 ON sync_mutations (organization_id, created_at)"""
        )
        cursor.execute(
            """CREATE INDEX idx_partner_enrichment_claim
                 ON partner_enrichment_jobs (status, available_at, created_at)"""
        )
        cursor.execute(
            """INSERT INTO deleted_records
                   (organization_id, delete_version, deleted_at)
               SELECT 'org-' || (value % 500), value,
                      CASE WHEN value % 20 = 0
                           THEN CURRENT_TIMESTAMP - INTERVAL '120 days'
                           ELSE CURRENT_TIMESTAMP END
                 FROM generate_series(1, 200000) AS value"""
        )
        cursor.execute(
            """INSERT INTO sync_mutations (organization_id, created_at)
               SELECT 'org-' || (value % 500),
                      CASE WHEN value % 20 = 0
                           THEN CURRENT_TIMESTAMP - INTERVAL '60 days'
                           ELSE CURRENT_TIMESTAMP END
                 FROM generate_series(1, 200000) AS value"""
        )
        cursor.execute(
            """INSERT INTO partner_enrichment_jobs
                   (status, available_at, created_at, updated_at)
               SELECT CASE WHEN value % 20 = 0 THEN 'completed' ELSE 'pending' END,
                      value, value,
                      CASE WHEN value % 20 = 0 THEN value ELSE 200000 + value END
                 FROM generate_series(1, 200000) AS value"""
        )

        upgrade = next(item for item in UPGRADES if item.version == 45)
        upgrade.apply(cursor, None)
        for table in (
            "deleted_records",
            "sync_mutations",
            "partner_enrichment_jobs",
        ):
            cursor.execute(
                sql.SQL("ANALYZE {}").format(sql.Identifier(table))
            )

        plans = {
            "idx_deleted_records_retention_cutoff": cursor.execute(
                """EXPLAIN (FORMAT JSON)
                   SELECT ctid
                     FROM deleted_records
                    WHERE deleted_at < CURRENT_TIMESTAMP - INTERVAL '90 days'
                    ORDER BY deleted_at, organization_id, delete_version
                    LIMIT 500
                    FOR UPDATE SKIP LOCKED"""
            ).fetchone()[0],
            "idx_sync_mutations_retention_cutoff": cursor.execute(
                """EXPLAIN (FORMAT JSON)
                   SELECT ctid
                     FROM sync_mutations
                    WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '30 days'
                    ORDER BY created_at
                    LIMIT 500
                    FOR UPDATE SKIP LOCKED"""
            ).fetchone()[0],
            "idx_partner_enrichment_terminal_cleanup": cursor.execute(
                """EXPLAIN (FORMAT JSON)
                   SELECT ctid
                     FROM partner_enrichment_jobs
                    WHERE status IN ('completed', 'failed')
                      AND updated_at <= 10000
                    ORDER BY updated_at
                    LIMIT 500
                    FOR UPDATE SKIP LOCKED"""
            ).fetchone()[0],
        }

        for expected_index, plan in plans.items():
            assert expected_index in _plan_index_names(plan)
    finally:
        connection.rollback()
        connection.close()


def test_v45_operator_runbook_covers_preflight_batching_and_rollback():
    runbook = (
        Path(__file__).resolve().parents[1]
        / "deploy"
        / "runbooks"
        / "database-upgrade-v45.md"
    ).read_text(encoding="utf-8")

    for required in (
        "--preflight",
        "--dry-run",
        "deletedRecordsRows",
        "syncMutationsRows",
        "terminalPartnerJobRows",
        "RETENTION_CLEANUP_BATCH_SIZE",
        "idx_deleted_records_retention_cutoff",
        "idx_sync_mutations_retention_cutoff",
        "idx_partner_enrichment_terminal_cleanup",
        "EXPLAIN",
        "maintenance",
        "backup",
        "DROP INDEX",
        "backward compatible",
    ):
        assert required.casefold() in runbook.casefold()
