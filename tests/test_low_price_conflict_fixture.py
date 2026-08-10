import os
from pathlib import Path
import uuid

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict

from scripts import low_price_conflict_fixture as fixture


BUSINESS_TABLES = (
    "ket_qua_danh_gia_nha_thau",
    "thong_tin_mo_thau",
    "goi_thau",
    "nha_thau",
    "ke_hoach_lcnt",
    "chu_dau_tu",
    "sync_metadata",
)
MUTABLE_FIXTURE_TABLES = BUSINESS_TABLES + ("deleted_records",)


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


def _fixture_data():
    run_id = f"lp25-cleanup-{uuid.uuid4().hex}"
    accounts = [
        {
            "id": f"{run_id}-{label}-id",
            "username": f"{run_id}-{label}",
            "email": f"{run_id}-{label}@example.test",
            "name": f"LP25 {label}",
        }
        for label in ("first", "second")
    ]
    return {
        "runId": run_id,
        "organizationId": f"{run_id}-org",
        "password": "Test-only!LowPrice25Password",
        "accounts": accounts,
    }


def _mutable_fixture_row_count(database_url, organization_id):
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            return sum(
                cursor.execute(
                    sql.SQL(
                        "SELECT count(*) FROM {} WHERE organization_id = %s"
                    ).format(sql.Identifier(table)),
                    (organization_id,),
                ).fetchone()[0]
                for table in MUTABLE_FIXTURE_TABLES
            )


def _force_cleanup(database_url, data):
    account_ids = [account["id"] for account in data["accounts"]]
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            for table in BUSINESS_TABLES:
                cursor.execute(
                    sql.SQL("DELETE FROM {} WHERE organization_id = %s").format(
                        sql.Identifier(table)
                    ),
                    (data["organizationId"],),
                )
            cursor.execute(
                "DELETE FROM deleted_records WHERE organization_id = %s",
                (data["organizationId"],),
            )
            cursor.execute(
                "DELETE FROM to_chuc WHERE id = %s",
                (data["organizationId"],),
            )
            cursor.execute(
                "DELETE FROM tai_khoan WHERE id = ANY(%s)",
                (account_ids,),
            )


def test_fixture_database_guard_requires_test_environment(monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql://fixture:secret@localhost/biddingflow_test",
    )

    with pytest.raises(RuntimeError, match="APP_ENV=test"):
        fixture._database_url()


def test_fixture_database_guard_rejects_database_outside_allowlist(monkeypatch):
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql://fixture:secret@localhost/biddingflow_production",
    )
    monkeypatch.delenv("LP25_DATABASE_ALLOWLIST", raising=False)

    with pytest.raises(RuntimeError, match="allowlist"):
        fixture._database_url()


def test_fixture_database_guard_accepts_explicitly_allowlisted_database(monkeypatch):
    database_url = "postgresql://fixture:secret@localhost/lp25_local_fixture"
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setenv("LP25_DATABASE_ALLOWLIST", "lp25_local_fixture")

    assert fixture._database_url() == database_url


def test_isolated_audit_runner_uses_test_environment_for_guarded_fixtures():
    runner = (
        Path(__file__).resolve().parents[1]
        / "scripts"
        / "run_isolated_audit_e2e.ps1"
    ).read_text(encoding="utf-8")

    assert '$env:DATABASE_URL = $testUrl' in runner
    assert '$env:APP_ENV = "test"' in runner


def test_cleanup_removes_all_lp25_business_rows(monkeypatch):
    database_url = _test_database_url()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    data = _fixture_data()
    database_name = str(conninfo_to_dict(database_url).get("dbname") or "")
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setenv("LP25_DATABASE_ALLOWLIST", database_name)
    try:
        fixture._setup(data)
        assert _mutable_fixture_row_count(database_url, data["organizationId"]) == 7

        cleanup = fixture._cleanup(data)

        assert cleanup["remainingRows"] == 0
        assert cleanup["deletedRows"] >= 12
        assert _mutable_fixture_row_count(database_url, data["organizationId"]) == 0
    finally:
        _force_cleanup(database_url, data)
