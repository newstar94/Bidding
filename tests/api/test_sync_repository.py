import sqlite3

from backend.app import app  # noqa: F401 - initializes backend import paths
from backend.sync.repository import (
    DELETED_RECORD_UPSERT_SQL,
    defer_version_latest_flag,
    get_current_sync_version,
    next_sync_version,
)


def _connection():
    connection = sqlite3.connect(":memory:")
    connection.execute("""
        CREATE TABLE sync_metadata (
            organization_id TEXT PRIMARY KEY,
            current_version INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT
        )
    """)
    connection.execute("""
        CREATE TABLE deleted_records (
            table_name TEXT,
            record_id TEXT,
            organization_id TEXT,
            deleted_at TEXT,
            delete_version INTEGER,
            UNIQUE(organization_id, table_name, record_id)
        )
    """)
    connection.commit()
    return connection


def test_sync_version_transaction_can_commit_and_rollback():
    connection = _connection()
    cursor = connection.cursor()

    cursor.execute("BEGIN")
    assert next_sync_version(cursor, "org-1") == 1
    connection.rollback()
    assert get_current_sync_version(cursor, "org-1") == 0

    cursor.execute("BEGIN")
    assert next_sync_version(cursor, "org-1") == 1
    connection.commit()
    assert get_current_sync_version(cursor, "org-1") == 1


def test_deleted_record_upsert_keeps_the_highest_version():
    connection = _connection()
    cursor = connection.cursor()
    cursor.execute(DELETED_RECORD_UPSERT_SQL, ("goi_thau", "gt-1", "org-1", "2026-07-13", 5))
    cursor.execute(DELETED_RECORD_UPSERT_SQL, ("goi_thau", "gt-1", "org-1", "2026-07-14", 3))
    connection.commit()

    row = cursor.execute(
        "SELECT deleted_at, delete_version FROM deleted_records WHERE record_id = 'gt-1'"
    ).fetchone()
    assert row == ("2026-07-14", 5)


def test_versioned_upsert_defers_latest_flag_until_family_recalculation():
    connection = sqlite3.connect(":memory:")
    connection.execute("""
        CREATE TABLE ke_hoach_lcnt (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            id_goc TEXT,
            ma_ke_hoach TEXT,
            phien_ban TEXT,
            is_latest INTEGER NOT NULL
        )
    """)
    connection.execute("""
        CREATE UNIQUE INDEX plan_latest_code
        ON ke_hoach_lcnt(organization_id, ma_ke_hoach)
        WHERE is_latest = 1
    """)
    connection.execute(
        "INSERT INTO ke_hoach_lcnt VALUES (?, ?, ?, ?, ?, ?)",
        ("kh-00", "org-1", "kh-00", "PL-1", "00", 1),
    )

    new_version = {
        "id": "kh-01",
        "organization_id": "org-1",
        "id_goc": "kh-00",
        "ma_ke_hoach": "PL-1",
        "phien_ban": "01",
        "is_latest": 1,
    }
    defer_version_latest_flag("ke_hoach_lcnt", new_version)
    connection.execute(
        "INSERT INTO ke_hoach_lcnt VALUES (:id, :organization_id, :id_goc, :ma_ke_hoach, :phien_ban, :is_latest)",
        new_version,
    )

    assert new_version["is_latest"] == 0
    assert connection.execute("SELECT COUNT(*) FROM ke_hoach_lcnt").fetchone()[0] == 2
    connection.close()
