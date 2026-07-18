import sqlite3

import pytest

from backend.db import db_utils
from backend.db import migration_runner
from backend.db.db_helper import SQLiteDatabase
from backend.db.schema import SCHEMA_DINH_NGHIA


class _MigrationOne:
    VERSION = 1
    NAME = "0001_test"

    @staticmethod
    def apply(cursor, _context):
        cursor.execute("CREATE TABLE future_upgrade (id INTEGER PRIMARY KEY)")


class _MigrationTwo:
    VERSION = 2
    NAME = "0002_test"

    @staticmethod
    def apply(cursor, _context):
        cursor.execute("ALTER TABLE future_upgrade ADD COLUMN label TEXT NOT NULL DEFAULT ''")


def _configure_clean_database(monkeypatch, tmp_path, name="baseline.db"):
    database = SQLiteDatabase(tmp_path / name)
    monkeypatch.setattr(db_utils, "database", database)
    monkeypatch.setenv("ADMIN_PASSWORD", "a sufficiently long initial password")
    monkeypatch.setenv("ADMIN_EMAIL", "admin@example.com")
    monkeypatch.setenv("DEFAULT_ORG_NAME", "Tổ chức kiểm thử")
    return database


def test_clean_baseline_is_transactional_versioned_and_idempotent(monkeypatch, tmp_path):
    database = _configure_clean_database(monkeypatch, tmp_path)
    db_utils.khoi_tao_va_di_tru_he_thong()

    connection = database.get_connection()
    try:
        tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        }
        assert set(SCHEMA_DINH_NGHIA) <= tables
        assert connection.execute("PRAGMA user_version").fetchone()[0] == db_utils.DB_SCHEMA_VERSION
        migrations = connection.execute(
            "SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version"
        ).fetchall()
        assert [row[0] for row in migrations] == list(range(1, db_utils.DB_SCHEMA_VERSION + 1))
        assert migrations[0][1] == "0001_clean_baseline"
        assert migrations[3][1] == "0004_pending_email_changes"
        assert migrations[4][1] == "0005_selective_fts_updates"
        assert migrations[5][1] == "0006_document_export_capabilities"
        assert migrations[6][1] == "0007_audit_chain_single_successor"
        assert migrations[7][1] == "0008_package_pagination_index"
        assert all(len(row[2]) == 64 and row[3] for row in migrations)
        assert "record_edit_ownership" in tables
        assert "goi_thau_moc_tien_do" in tables
        assert "pending_email_changes" in tables
        assert "document_export_capabilities" in tables
        audit_indexes = {
            row[1]: row[2]
            for row in connection.execute("PRAGMA index_list(audit_log)")
        }
        assert audit_indexes["idx_audit_log_single_successor"] == 1
        package_indexes = {
            row[1] for row in connection.execute("PRAGMA index_list(goi_thau)")
        }
        assert "idx_goi_thau_owner_code_id" in package_indexes
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        assert connection.execute("SELECT count(*) FROM tai_khoan").fetchone()[0] == 1
        assert connection.execute("SELECT count(*) FROM goi_dich_vu").fetchone()[0] == 3
    finally:
        connection.close()

    db_utils.khoi_tao_va_di_tru_he_thong()
    connection = database.get_connection()
    try:
        assert connection.execute("SELECT count(*) FROM schema_migrations").fetchone()[0] == db_utils.DB_SCHEMA_VERSION
        assert connection.execute("SELECT count(*) FROM tai_khoan").fetchone()[0] == 1
    finally:
        connection.close()


def test_checksum_drift_stops_startup_without_mutating_business_data(monkeypatch, tmp_path):
    database = _configure_clean_database(monkeypatch, tmp_path, "checksum.db")
    db_utils.khoi_tao_va_di_tru_he_thong()
    connection = database.get_connection()
    connection.execute("UPDATE schema_migrations SET checksum = 'tampered'")
    connection.commit()
    connection.close()

    with pytest.raises(RuntimeError, match="checksum mismatch"):
        db_utils.khoi_tao_va_di_tru_he_thong()

    connection = database.get_connection()
    try:
        assert connection.execute("SELECT count(*) FROM tai_khoan").fetchone()[0] == 1
    finally:
        connection.close()


def test_partial_unversioned_schema_fails_without_runtime_rebuild(monkeypatch, tmp_path):
    database = _configure_clean_database(monkeypatch, tmp_path, "partial.db")
    connection = database.get_connection()
    connection.execute("CREATE TABLE tai_khoan (id TEXT PRIMARY KEY, legacy TEXT)")
    connection.execute("INSERT INTO tai_khoan VALUES ('legacy', 'preserve')")
    connection.commit()
    connection.close()

    with pytest.raises(RuntimeError, match="requires an empty database"):
        db_utils.khoi_tao_va_di_tru_he_thong()

    connection = database.get_connection()
    try:
        assert connection.execute("SELECT legacy FROM tai_khoan").fetchone()[0] == "preserve"
        assert connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'goi_thau'"
        ).fetchone() is None
    finally:
        connection.close()


def test_schema_drift_fails_instead_of_being_repaired_at_runtime(monkeypatch, tmp_path):
    database = _configure_clean_database(monkeypatch, tmp_path, "drift.db")
    db_utils.khoi_tao_va_di_tru_he_thong()
    connection = database.get_connection()
    connection.execute("DROP TABLE rate_limit_buckets")
    connection.commit()
    connection.close()

    with pytest.raises(RuntimeError, match="Schema drift: missing table rate_limit_buckets"):
        db_utils.khoi_tao_va_di_tru_he_thong()


def test_missing_audit_successor_index_fails_startup(monkeypatch, tmp_path):
    database = _configure_clean_database(monkeypatch, tmp_path, "audit-index-drift.db")
    db_utils.khoi_tao_va_di_tru_he_thong()
    connection = database.get_connection()
    connection.execute("DROP INDEX idx_audit_log_single_successor")
    connection.commit()
    connection.close()

    with pytest.raises(RuntimeError, match="audit-chain successor index is missing"):
        db_utils.khoi_tao_va_di_tru_he_thong()


def test_runner_applies_future_versions_once_in_order(monkeypatch):
    monkeypatch.setattr(migration_runner, "MIGRATIONS", (_MigrationOne, _MigrationTwo))
    monkeypatch.setattr(
        migration_runner,
        "calculate_migration_checksum",
        lambda migration, _context=None: f"checksum:{migration.NAME}",
    )
    connection = sqlite3.connect(":memory:")
    cursor = connection.cursor()
    assert migration_runner.run_migrations(cursor, context=None) == 2
    assert [row[1] for row in cursor.execute("PRAGMA table_info(future_upgrade)")] == ["id", "label"]
    assert migration_runner.run_migrations(cursor, context=None) == 2
    assert cursor.execute("SELECT count(*) FROM schema_migrations").fetchone()[0] == 2
    connection.close()
