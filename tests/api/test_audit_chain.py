import sqlite3

from backend.shared.audit_chain import EMPTY_AUDIT_HASH, insert_audit_row, verify_audit_chain


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
