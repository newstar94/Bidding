"""Single-file registry for database upgrades after the clean schema baseline.

Fresh installations are created directly from ``backend.db.schema`` at the
latest registered version without replaying historical upgrades.
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


def _upgrade_to_v2_remove_mfa(cursor, context):
    """Remove persisted state belonging to the retired MFA feature."""

    del context
    cursor.execute("DROP TABLE IF EXISTS account_mfa")
    cursor.execute(
        "ALTER TABLE auth_sessions DROP COLUMN IF EXISTS mfa_verified_at"
    )


def _upgrade_to_v3_reconcile_retired_mfa_schema(cursor, context):
    """Repair installations that recorded v2 before MFA cleanup completed.

    Released upgrade versions are immutable.  A database can therefore report
    v2 while still carrying the retired objects.  Repeating this idempotent
    cleanup in v3 repairs that state while preserving strict drift detection.
    """

    del context
    cursor.execute("DROP TABLE IF EXISTS account_mfa")
    cursor.execute(
        "ALTER TABLE auth_sessions DROP COLUMN IF EXISTS mfa_verified_at"
    )


def _upgrade_to_v4_enforce_single_active_session(cursor, context):
    """Keep the newest session and enforce one active session per account."""

    del context
    cursor.execute(
        """
        WITH ranked_sessions AS (
            SELECT id,
                   ROW_NUMBER() OVER (
                       PARTITION BY user_id
                       ORDER BY created_at DESC, id DESC
                   ) AS active_rank
            FROM auth_sessions
            WHERE revoked_at IS NULL
        )
        UPDATE auth_sessions AS sessions
        SET revoked_at = EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::BIGINT
        FROM ranked_sessions AS ranked
        WHERE sessions.id = ranked.id AND ranked.active_rank > 1
        """
    )
    cursor.execute(
        """CREATE UNIQUE INDEX IF NOT EXISTS
           idx_auth_sessions_one_active_per_user
           ON auth_sessions (user_id)
           WHERE revoked_at IS NULL"""
    )


def _upgrade_to_v5_add_package_expert_updated_at(cursor, context):
    """Add the timestamp written by package expert relation upserts."""

    del context
    cursor.execute(
        """ALTER TABLE goi_thau_chuyen_gia
           ADD COLUMN IF NOT EXISTS updated_at
           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP"""
    )


def _upgrade_to_v6_reconcile_record_ownership_constraint(cursor, context):
    """Reconcile the creator-lineage compatibility constraint from v6.

    Version 6 was already applied to some installations. The lineage table is
    retained for compatibility, while authorization still enforces manager-only
    deletion and assignment-scoped employee edits.
    """

    del context
    cursor.execute(
        """ALTER TABLE record_edit_ownership
           DROP CONSTRAINT IF EXISTS record_edit_ownership_table_name_check"""
    )
    cursor.execute(
        """ALTER TABLE record_edit_ownership
           ADD CONSTRAINT record_edit_ownership_table_name_check
           CHECK (table_name IN (
               'chu_dau_tu', 'ke_hoach_lcnt', 'goi_thau',
               'thong_tin_mo_thau', 'hop_dong', 'nha_thau', 'chuyen_gia'
           ))"""
    )


UPGRADES = (
    DatabaseUpgrade(2, "remove_mfa", _upgrade_to_v2_remove_mfa),
    DatabaseUpgrade(
        3,
        "reconcile_retired_mfa_schema",
        _upgrade_to_v3_reconcile_retired_mfa_schema,
    ),
    DatabaseUpgrade(
        4,
        "enforce_single_active_session",
        _upgrade_to_v4_enforce_single_active_session,
    ),
    DatabaseUpgrade(
        5,
        "add_package_expert_updated_at",
        _upgrade_to_v5_add_package_expert_updated_at,
    ),
    DatabaseUpgrade(
        6,
        "reconcile_record_ownership_constraint",
        _upgrade_to_v6_reconcile_record_ownership_constraint,
    ),
)


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
