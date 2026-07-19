"""Single-file registry for database upgrades after the clean schema baseline.

Fresh installations are created directly from ``backend.db.schema`` at version 1.
When a future release changes persisted data, add one upgrade function here and
append a ``DatabaseUpgrade`` entry to ``UPGRADES``. Upgrade versions must remain
contiguous and must never be rewritten after release.
"""

from dataclasses import dataclass
import uuid


BASELINE_SCHEMA_VERSION = 1
BASELINE_NAME = "canonical_schema"


@dataclass(frozen=True)
class DatabaseUpgrade:
    version: int
    name: str
    apply: object


@dataclass(frozen=True)
class DatabaseUpgradeContext:
    build_create_table_sql: object
    create_indexes_and_triggers: object
    assert_foreign_key_integrity: object


# Example for a future schema change:
#
# def _upgrade_to_v2(cursor, context):
#     cursor.execute("ALTER TABLE ...")
#
# UPGRADES = (
#     DatabaseUpgrade(2, "describe_change", _upgrade_to_v2),
# )
UPGRADES = ()


DB_SCHEMA_VERSION = (
    UPGRADES[-1].version if UPGRADES else BASELINE_SCHEMA_VERSION
)


def read_database_version(cursor):
    """Return the installed version, or ``None`` for a database without metadata."""
    metadata_exists = cursor.execute(
        """SELECT 1
           FROM information_schema.tables
           WHERE table_schema = current_schema()
             AND table_name = 'database_metadata'"""
    ).fetchone()
    if not metadata_exists:
        return None
    row = cursor.execute(
        "SELECT schema_version FROM database_metadata WHERE id = 1"
    ).fetchone()
    if not row:
        raise RuntimeError("database_metadata is missing its singleton version row.")
    return int(row[0])


def record_database_version(cursor, version, *, baseline=BASELINE_NAME):
    version = int(version)
    cursor.execute(
        """INSERT INTO database_metadata (id, schema_version, baseline, installation_id)
           VALUES (1, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
               schema_version = excluded.schema_version,
               baseline = excluded.baseline,
               updated_at = CURRENT_TIMESTAMP""",
        (version, baseline, str(uuid.uuid4())),
    )


def apply_database_upgrades(cursor, current_version, context):
    """Apply future upgrades registered in this file inside the caller transaction."""
    current_version = int(current_version)
    if current_version < BASELINE_SCHEMA_VERSION:
        raise RuntimeError(
            f"Unsupported database schema version: {current_version}."
        )
    if current_version > DB_SCHEMA_VERSION:
        raise RuntimeError(
            "Database schema is newer than this application version."
        )

    expected_version = BASELINE_SCHEMA_VERSION + 1
    for upgrade in UPGRADES:
        if upgrade.version != expected_version:
            raise RuntimeError(
                "Database upgrade versions must be contiguous after the baseline."
            )
        expected_version += 1
        if upgrade.version <= current_version:
            continue
        upgrade.apply(cursor, context)
        record_database_version(cursor, upgrade.version)
        current_version = upgrade.version

    if current_version != DB_SCHEMA_VERSION:
        raise RuntimeError(
            f"No upgrade path from schema version {current_version} "
            f"to {DB_SCHEMA_VERSION}."
        )
    return current_version
