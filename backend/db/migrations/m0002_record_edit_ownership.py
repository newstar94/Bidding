"""Track the employee who created organization-scoped partner data."""


VERSION = 2
NAME = "0002_record_edit_ownership"


def apply(cursor, context):
    cursor.execute(
        """
        CREATE TABLE record_edit_ownership (
            organization_id TEXT NOT NULL,
            table_name TEXT NOT NULL CHECK(table_name IN ('chu_dau_tu', 'nha_thau')),
            record_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (organization_id, table_name, record_id),
            FOREIGN KEY (organization_id) REFERENCES to_chuc(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE
        )
        """
    )
    cursor.execute(
        """CREATE INDEX idx_record_edit_ownership_user
           ON record_edit_ownership (organization_id, user_id, table_name)"""
    )
    context.assert_foreign_key_integrity(cursor)
