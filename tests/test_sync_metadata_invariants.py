from pathlib import Path
import os

import psycopg
import pytest

from backend.db.db_helper import PostgresCursor, compat_row_factory
from backend.db.postgres_schema import build_create_table_sql
from backend.db.schema import SCHEMA_DINH_NGHIA
from backend.db.upgrades import DB_SCHEMA_VERSION, UPGRADES


class _UpgradeCursor:
    def __init__(self, preflight_row):
        self.preflight_row = preflight_row
        self.statements = []

    def execute(self, statement, params=None):
        self.statements.append((" ".join(statement.split()), params))
        return self

    def fetchone(self):
        return self.preflight_row


def _upgrade_v44():
    return next(item for item in UPGRADES if item.version == 44)


@pytest.mark.parametrize("preflight_row", ((1, 0), (0, 1), (2, 3)))
def test_v44_fails_preflight_before_adding_constraints(preflight_row):
    cursor = _UpgradeCursor(preflight_row)

    with pytest.raises(RuntimeError, match="sync_metadata invariant preflight"):
        _upgrade_v44().apply(cursor, None)

    assert len(cursor.statements) == 1
    assert cursor.statements[0][0].startswith("SELECT")


def test_v44_adds_not_valid_constraints_then_validates_them():
    cursor = _UpgradeCursor((0, 0))

    _upgrade_v44().apply(cursor, None)

    executed = "\n".join(statement for statement, _ in cursor.statements)
    assert DB_SCHEMA_VERSION >= 44
    assert "sync_metadata_current_version_nonnegative_check" in executed
    assert "CHECK (current_version >= 0) NOT VALID" in executed
    assert "sync_metadata_available_version_order_check" in executed
    assert "CHECK (min_available_version <= current_version) NOT VALID" in executed
    assert executed.count("VALIDATE CONSTRAINT") == 2


def test_fresh_schema_declares_the_same_named_sync_metadata_constraints():
    create_sql = build_create_table_sql(
        "sync_metadata",
        SCHEMA_DINH_NGHIA["sync_metadata"],
    )

    assert (
        "CONSTRAINT sync_metadata_current_version_nonnegative_check "
        "CHECK(current_version >= 0)"
    ) in create_sql
    assert (
        "CONSTRAINT sync_metadata_available_version_order_check "
        "CHECK(min_available_version <= current_version)"
    ) in create_sql


def _test_database_url():
    if value := os.environ.get("TEST_DATABASE_URL"):
        return value
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.is_file():
        return None
    for line in env_path.read_text(encoding="utf-8-sig").splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() == "TEST_DATABASE_URL":
            return value.strip().strip('"').strip("'") or None
    return None


@pytest.fixture
def sync_metadata_upgrade_cursor():
    database_url = _test_database_url()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    try:
        connection = psycopg.connect(
            database_url,
            connect_timeout=5,
            row_factory=compat_row_factory,
        )
    except psycopg.Error as error:
        pytest.skip(f"PostgreSQL test database is unavailable: {type(error).__name__}")
    try:
        cursor = PostgresCursor(connection.cursor())
        cursor.execute(
            """CREATE TEMP TABLE sync_metadata (
                   organization_id TEXT PRIMARY KEY,
                   current_version BIGINT NOT NULL DEFAULT 0,
                   min_available_version BIGINT NOT NULL DEFAULT 0,
                   updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                   CHECK (min_available_version >= 0)
               )"""
        )
        cursor.execute(
            """INSERT INTO sync_metadata
                   (organization_id, current_version, min_available_version)
               SELECT 'org-' || value, value, value / 2
                 FROM generate_series(0, 500) AS value"""
        )
        yield cursor
    finally:
        connection.rollback()
        connection.close()


def test_v44_real_postgres_validates_constraints_and_rejects_future_corruption(
    sync_metadata_upgrade_cursor,
):
    _upgrade_v44().apply(sync_metadata_upgrade_cursor, None)

    constraints = {
        str(row[0]): (str(row[1]), bool(row[2]))
        for row in sync_metadata_upgrade_cursor.execute(
            """SELECT conname, pg_get_constraintdef(oid, true), convalidated
                 FROM pg_constraint
                WHERE conrelid = 'sync_metadata'::regclass
                  AND conname IN (
                    'sync_metadata_current_version_nonnegative_check',
                    'sync_metadata_available_version_order_check'
                  )"""
        ).fetchall()
    }
    assert constraints == {
        "sync_metadata_current_version_nonnegative_check": (
            "CHECK (current_version >= 0)",
            True,
        ),
        "sync_metadata_available_version_order_check": (
            "CHECK (min_available_version <= current_version)",
            True,
        ),
    }

    invalid_rows = (
        ("negative-current", -1, 0),
        ("minimum-ahead", 3, 4),
    )
    for index, row in enumerate(invalid_rows):
        savepoint = f"invalid_sync_metadata_{index}"
        sync_metadata_upgrade_cursor.execute(f"SAVEPOINT {savepoint}")
        with pytest.raises(psycopg.errors.CheckViolation):
            sync_metadata_upgrade_cursor.execute(
                """INSERT INTO sync_metadata
                       (organization_id, current_version, min_available_version)
                   VALUES (?, ?, ?)""",
                row,
            )
        sync_metadata_upgrade_cursor.execute(f"ROLLBACK TO SAVEPOINT {savepoint}")
