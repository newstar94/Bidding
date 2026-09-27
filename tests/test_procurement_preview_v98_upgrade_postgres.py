"""Verify the v97 to v98 upgrade with real PostgreSQL DDL in a transaction."""

import os

import pytest

from backend.db.db_helper import PostgresDatabase
from backend.db.upgrades import apply_database_upgrades


def test_v97_to_v98_adds_durable_preview_columns_without_rewriting_sessions():
    url = str(os.environ.get("TEST_DATABASE_URL") or "").strip()
    if not url:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL migration test")
    database = PostgresDatabase(url)
    connection = database.get_connection()
    try:
        # Temporary tables shadow production names only inside this connection.
        # The transaction is rolled back; the isolated test DB is left intact.
        connection.execute("""CREATE TEMP TABLE procurement_import_session (
            organization_id TEXT NOT NULL, id TEXT NOT NULL,
            status TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
            PRIMARY KEY (organization_id, id)
        )""")
        connection.execute("""CREATE TEMP TABLE database_metadata (
            id INTEGER PRIMARY KEY, schema_version INTEGER NOT NULL,
            baseline TEXT NOT NULL, installation_id TEXT NOT NULL,
            updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )""")
        connection.execute("""INSERT INTO procurement_import_session
            (organization_id, id, status, expires_at)
            VALUES ('org-1', 'session-1', 'READY', CURRENT_TIMESTAMP + INTERVAL '1 day')""")
        connection.execute("""INSERT INTO database_metadata
            (id, schema_version, baseline, installation_id)
            VALUES (1, 97, 'canonical_schema', 'migration-test')""")

        assert apply_database_upgrades(connection.cursor(), 97, None, target_version=98) == 98
        row = connection.execute("""SELECT id, status, preview_id, preview_bundle_json,
            preview_bundle_digest, preview_expires_at
            FROM procurement_import_session WHERE organization_id = 'org-1'""").fetchone()
        assert tuple(row) == ("session-1", "READY", None, None, None, None)
        assert connection.execute("SELECT schema_version FROM database_metadata WHERE id = 1").fetchone()[0] == 98
    finally:
        connection.rollback()
        connection.close()
        database.close()
