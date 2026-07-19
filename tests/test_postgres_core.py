from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import os
from zoneinfo import ZoneInfo

import psycopg
import pytest

from backend.db.db_helper import PostgresDatabase, _convert_qmark_parameters
from backend.db.postgres_schema import (
    assert_foreign_key_integrity,
    assert_schema_contract,
    initialize_postgres_database,
)
from backend.db.schema import SCHEMA_DINH_NGHIA
from backend.shared.audit_chain import insert_audit_row, inspect_audit_chain
from backend.sync.repository import next_sync_version
from backend.shared.date_utils import VIETNAM_TIMEZONE_NAME, vietnam_now


@pytest.fixture(scope="session")
def postgres_database() -> PostgresDatabase:
    database_url = os.environ.get("TEST_DATABASE_URL", "").strip()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    with psycopg.connect(database_url, autocommit=True) as connection:
        connection.execute("DROP SCHEMA IF EXISTS public CASCADE")
        connection.execute("CREATE SCHEMA public")
    database = PostgresDatabase(database_url)
    initialize_postgres_database(database)
    yield database
    database.close()


def test_qmark_conversion_preserves_literals_and_comments() -> None:
    statement = "SELECT '?', \"?\" FROM demo WHERE id = ? -- ?\nAND note = 'it''s ?'"
    converted = _convert_qmark_parameters(statement)
    assert converted == "SELECT '?', \"?\" FROM demo WHERE id = %s -- ?\nAND note = 'it''s ?'"


def test_fresh_schema_contract(postgres_database: PostgresDatabase) -> None:
    with postgres_database.get_connection() as connection:
        cursor = connection.cursor()
        assert_schema_contract(cursor)
        assert_foreign_key_integrity(cursor)
        table_count = cursor.execute(
            """SELECT count(*) FROM information_schema.tables
               WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'"""
        ).fetchone()[0]
        assert table_count == len(SCHEMA_DINH_NGHIA)
        assert cursor.execute(
            "SELECT schema_version FROM database_metadata WHERE id = 1"
        ).fetchone()[0] == 1


def test_sql_and_api_timestamps_use_vietnam_timezone(
    postgres_database: PostgresDatabase,
) -> None:
    with postgres_database.get_connection() as connection:
        cursor = connection.cursor()
        assert cursor.execute("SHOW TIME ZONE").fetchone()[0] == VIETNAM_TIMEZONE_NAME
        row = cursor.execute(
            "SELECT CAST(? AS TIMESTAMPTZ), EXTRACT(EPOCH FROM CAST(? AS TIMESTAMPTZ))",
            ("2026-07-20 09:00:00", "2026-07-20 09:00:00"),
        ).fetchone()
        assert row[0] == "2026-07-20 09:00:00"
        expected_epoch = int(
            datetime(2026, 7, 20, 9, 0, tzinfo=ZoneInfo(VIETNAM_TIMEZONE_NAME)).timestamp()
        )
        assert int(row[1]) == expected_epoch

    with psycopg.connect(postgres_database.database_url) as raw_connection:
        assert raw_connection.execute("SHOW TIME ZONE").fetchone()[0] == VIETNAM_TIMEZONE_NAME

    assert vietnam_now().utcoffset().total_seconds() == 7 * 60 * 60


def test_initialization_is_idempotent(postgres_database: PostgresDatabase) -> None:
    assert initialize_postgres_database(postgres_database) == 1


def test_transaction_rollback(postgres_database: PostgresDatabase) -> None:
    connection = postgres_database.get_connection()
    try:
        connection.execute("BEGIN")
        connection.execute(
            "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (?, ?)",
            ("org-rollback-test", "Rollback test"),
        )
        connection.rollback()
    finally:
        connection.close()
    with postgres_database.get_connection() as verification:
        assert verification.execute(
            "SELECT 1 FROM to_chuc WHERE id = ?", ("org-rollback-test",)
        ).fetchone() is None


def test_workspace_trigger_rejects_invalid_personal_owner(
    postgres_database: PostgresDatabase,
) -> None:
    connection = postgres_database.get_connection()
    try:
        connection.execute("BEGIN")
        with pytest.raises(psycopg.errors.CheckViolation):
            connection.execute(
                """INSERT INTO chu_dau_tu
                   (id, organization_id, owner_type, ten_chu_dau_tu, ngay_ap_dung)
                   VALUES (?, ?, 'personal', ?, ?)""",
                ("cdt-invalid-owner", "personal:missing-user", "Invalid", "2026-07-19"),
            )
        connection.rollback()
    finally:
        connection.close()


def test_sync_versions_are_unique_under_concurrency(
    postgres_database: PostgresDatabase,
) -> None:
    organization_id = "org-concurrency-sync"
    with postgres_database.get_connection() as connection:
        connection.execute(
            "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (?, ?) ON CONFLICT DO NOTHING",
            (organization_id, "Concurrency sync"),
        )
        connection.execute(
            """INSERT INTO sync_metadata (organization_id, current_version)
               VALUES (?, 0) ON CONFLICT DO NOTHING""",
            (organization_id,),
        )

    def allocate(_: int) -> int:
        connection = postgres_database.get_connection()
        try:
            connection.execute("BEGIN")
            value = next_sync_version(connection.cursor(), organization_id)
            connection.commit()
            return value
        finally:
            connection.close()

    with ThreadPoolExecutor(max_workers=16) as executor:
        values = list(executor.map(allocate, range(64)))
    assert len(set(values)) == 64
    assert sorted(values) == list(range(min(values), max(values) + 1))


def test_audit_chain_has_no_forks_under_concurrency(
    postgres_database: PostgresDatabase,
) -> None:
    chain_id = "org-concurrency-audit"

    def append(index: int) -> None:
        connection = postgres_database.get_connection()
        try:
            connection.execute("BEGIN")
            insert_audit_row(
                connection.cursor(),
                organization_id=chain_id,
                action="test.concurrent",
                target_type="test",
                target_id=str(index),
            )
            connection.commit()
        finally:
            connection.close()

    with ThreadPoolExecutor(max_workers=16) as executor:
        list(executor.map(append, range(64)))

    with postgres_database.get_connection() as connection:
        verification = inspect_audit_chain(connection.cursor())
        assert verification.valid, verification.failure
        rows = connection.execute(
            "SELECT sequence FROM audit_log WHERE chain_id = ? ORDER BY sequence",
            (chain_id,),
        ).fetchall()
        assert [row[0] for row in rows] == list(range(1, 65))


def test_audit_rows_are_immutable(postgres_database: PostgresDatabase) -> None:
    connection = postgres_database.get_connection()
    try:
        connection.execute("BEGIN")
        row = connection.execute("SELECT id FROM audit_log LIMIT 1").fetchone()
        assert row is not None
        with pytest.raises(psycopg.errors.CheckViolation):
            connection.execute("DELETE FROM audit_log WHERE id = ?", (row[0],))
        connection.rollback()
    finally:
        connection.close()


def test_configured_runtime_role_has_no_ddl_privilege() -> None:
    runtime_url = os.environ.get("RUNTIME_DATABASE_URL", "").strip()
    if not runtime_url:
        pytest.skip("RUNTIME_DATABASE_URL is not configured")
    with psycopg.connect(runtime_url) as connection:
        assert connection.execute("SELECT 1").fetchone()[0] == 1
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute("CREATE TABLE runtime_role_must_not_create(id int)")
        connection.rollback()
