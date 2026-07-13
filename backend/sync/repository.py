"""SQL primitives shared by synchronization write services."""

DELETED_RECORD_UPSERT_SQL = """
    INSERT INTO deleted_records (table_name, record_id, owner_id, deleted_at, delete_version)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(owner_id, table_name, record_id) DO UPDATE SET
        deleted_at = excluded.deleted_at,
        delete_version = MAX(COALESCE(deleted_records.delete_version, 0), COALESCE(excluded.delete_version, 0))
"""


def next_sync_version(cursor, owner_id):
    cursor.execute(
        "INSERT OR IGNORE INTO sync_metadata (owner_id, current_version) VALUES (?, 0)",
        (owner_id,),
    )
    cursor.execute(
        "UPDATE sync_metadata SET current_version = current_version + 1, "
        "updated_at = datetime('now', 'localtime') WHERE owner_id = ?",
        (owner_id,),
    )
    cursor.execute("SELECT current_version FROM sync_metadata WHERE owner_id = ?", (owner_id,))
    row = cursor.fetchone()
    return int(row[0] if row else 0)


def get_current_sync_version(cursor, owner_id):
    cursor.execute("SELECT current_version FROM sync_metadata WHERE owner_id = ?", (owner_id,))
    row = cursor.fetchone()
    return int(row[0] if row else 0)

