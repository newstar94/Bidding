"""Transactional, checksum-verified SQLite migration runner."""

import hashlib
import inspect
from dataclasses import dataclass

from backend.db.migrations import MIGRATIONS


MIGRATION_COLUMNS = ["version", "name", "checksum", "applied_at"]


@dataclass(frozen=True)
class MigrationContext:
    build_create_table_sql: object
    create_indexes_and_triggers: object
    assert_foreign_key_integrity: object


def calculate_migration_checksum(migration, context=None):
    material = inspect.getsource(migration)
    if hasattr(migration, "checksum_material"):
        material += "\n" + str(migration.checksum_material())
    if context is not None:
        material += "\n" + inspect.getsource(context.build_create_table_sql)
        material += "\n" + inspect.getsource(context.create_indexes_and_triggers)
        material += "\n" + inspect.getsource(context.assert_foreign_key_integrity)
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def _ensure_migration_table(cursor):
    exists = cursor.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'"
    ).fetchone()
    if not exists:
        cursor.execute(
            """
            CREATE TABLE schema_migrations (
                version INTEGER PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                checksum TEXT NOT NULL,
                applied_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
            """
        )
        return
    actual_columns = [row[1] for row in cursor.execute("PRAGMA table_info(schema_migrations)").fetchall()]
    if actual_columns != MIGRATION_COLUMNS:
        raise RuntimeError(
            "schema_migrations has an incompatible legacy shape; use a clean database for this baseline."
        )


def run_migrations(cursor, context):
    _ensure_migration_table(cursor)
    applied = {
        int(row[0]): {"name": row[1], "checksum": row[2]}
        for row in cursor.execute(
            "SELECT version, name, checksum FROM schema_migrations ORDER BY version"
        ).fetchall()
    }
    known_versions = {migration.VERSION for migration in MIGRATIONS}
    unknown_versions = sorted(set(applied) - known_versions)
    if unknown_versions:
        raise RuntimeError(f"Database contains unknown migration versions: {unknown_versions}")

    previous_version = 0
    for migration in MIGRATIONS:
        if migration.VERSION != previous_version + 1:
            raise RuntimeError("Migration versions must be contiguous and start at 1.")
        previous_version = migration.VERSION
        checksum = calculate_migration_checksum(migration, context)
        recorded = applied.get(migration.VERSION)
        if recorded:
            if recorded["name"] != migration.NAME or recorded["checksum"] != checksum:
                raise RuntimeError(f"Migration checksum mismatch: {migration.NAME}")
            continue

        migration.apply(cursor, context)
        cursor.execute(
            "INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)",
            (migration.VERSION, migration.NAME, checksum),
        )

    latest_version = MIGRATIONS[-1].VERSION if MIGRATIONS else 0
    cursor.execute(f"PRAGMA user_version = {latest_version}")
    return latest_version
