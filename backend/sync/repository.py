"""SQL primitives shared by synchronization write services."""

VERSIONED_TABLES = frozenset({
    "chu_dau_tu",
    "ke_hoach_lcnt",
    "goi_thau",
    "nha_thau",
    "chuyen_gia",
    "hop_dong",
})

ARCHIVED_TABLES = VERSIONED_TABLES | {"thong_tin_mo_thau"}

DELETED_RECORD_UPSERT_SQL = """
    INSERT INTO deleted_records (table_name, record_id, organization_id, deleted_at, delete_version)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(organization_id, table_name, record_id) DO UPDATE SET
        deleted_at = excluded.deleted_at,
        delete_version = MAX(COALESCE(deleted_records.delete_version, 0), COALESCE(excluded.delete_version, 0))
"""


def defer_version_latest_flag(table_name, row_data):
    """Avoid two latest rows while a version family is being upserted.

    The sync service recalculates ``is_latest`` after every versioned batch.
    Staging incoming rows as non-latest prevents partial unique indexes from
    rejecting a new version before the previous version has been demoted.
    """
    if table_name in VERSIONED_TABLES:
        row_data["is_latest"] = 0
    return row_data


def next_sync_version(cursor, organization_id):
    cursor.execute(
        "INSERT OR IGNORE INTO sync_metadata (organization_id, current_version) VALUES (?, 0)",
        (organization_id,),
    )
    cursor.execute(
        "UPDATE sync_metadata SET current_version = current_version + 1, "
        "updated_at = datetime('now', 'localtime') WHERE organization_id = ?",
        (organization_id,),
    )
    cursor.execute("SELECT current_version FROM sync_metadata WHERE organization_id = ?", (organization_id,))
    row = cursor.fetchone()
    return int(row[0] if row else 0)


def get_current_sync_version(cursor, organization_id):
    cursor.execute("SELECT current_version FROM sync_metadata WHERE organization_id = ?", (organization_id,))
    row = cursor.fetchone()
    return int(row[0] if row else 0)
