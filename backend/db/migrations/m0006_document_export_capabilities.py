"""Tenant-scoped grants for exporting sensitive fields into documents."""


VERSION = 6
NAME = "0006_document_export_capabilities"


def apply(cursor, context):
    cursor.execute(
        """
        CREATE TABLE document_export_capabilities (
            organization_id TEXT NOT NULL CHECK(organization_id != ''),
            user_id TEXT NOT NULL CHECK(user_id != ''),
            financial INTEGER NOT NULL DEFAULT 0
                CHECK(typeof(financial) = 'integer' AND financial IN (0, 1)),
            identity INTEGER NOT NULL DEFAULT 0
                CHECK(typeof(identity) = 'integer' AND identity IN (0, 1)),
            signature INTEGER NOT NULL DEFAULT 0
                CHECK(typeof(signature) = 'integer' AND signature IN (0, 1)),
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (organization_id, user_id),
            FOREIGN KEY (user_id, organization_id)
                REFERENCES thanh_vien_to_chuc(user_id, organization_id)
                ON DELETE CASCADE
        )
        """
    )
    cursor.execute(
        """CREATE INDEX idx_document_export_capabilities_user
           ON document_export_capabilities (user_id, organization_id)"""
    )
    context.assert_foreign_key_integrity(cursor)
