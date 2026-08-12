import re
import os
from pathlib import Path
import uuid

import psycopg
import pytest

from backend.db.schema import SCHEMA_DINH_NGHIA
from backend.db.db_helper import PostgresCursor, compat_row_factory
from backend.auth.auth_service import get_user_organizations
from backend.auth.session_utils import OrgPermissionError, get_active_org
from backend.shared.organization_decommission import (
    OrganizationDecommissionPostconditionError,
    assert_organization_decommission_postcondition,
    inspect_organization_ownership,
    organization_ownership_registry,
)


class _InventoryCursor:
    def __init__(self, counts=None, organization_exists=True):
        self.counts = counts or {}
        self.organization_exists = organization_exists
        self.statements = []
        self._row = None

    def execute(self, sql, params=()):
        self.statements.append((sql, params))
        table_match = re.search(r"FROM\s+([a-z_]+)", sql, flags=re.IGNORECASE)
        table_name = table_match.group(1) if table_match else ""
        if table_name == "to_chuc":
            self._row = (1,) if self.organization_exists else None
        else:
            self._row = (int(self.counts.get(table_name, 0)),)
        return self

    def fetchone(self):
        return self._row


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


def test_organization_ownership_registry_covers_schema_without_manual_allowlist():
    registry = organization_ownership_registry()
    expected_tables = {
        table_name
        for table_name, table_spec in SCHEMA_DINH_NGHIA.items()
        if "organization_id" in table_spec.get("columns", {})
    }

    assert {entry.table_name for entry in registry} == expected_tables
    assert len(registry) == 66
    assert sum(entry.polymorphic_owner for entry in registry) == 39


def test_organization_ownership_dry_run_is_count_only_and_parameterized():
    cursor = _InventoryCursor(
        counts={"goi_thau": 3, "deleted_records": 2},
        organization_exists=True,
    )

    result = inspect_organization_ownership(cursor, "org-a")

    assert result["organizationExists"] is True
    assert result["totalRows"] == 5
    assert result["tables"]["goi_thau"] == 3
    assert result["tables"]["deleted_records"] == 2
    assert all(params == ("org-a",) for _sql, params in cursor.statements)
    goi_thau_sql = next(sql for sql, _params in cursor.statements if "FROM goi_thau" in sql)
    assert "organization_id = ?" in goi_thau_sql
    deleted_sql = next(
        sql for sql, _params in cursor.statements if "FROM deleted_records" in sql
    )
    assert "organization_id = ?" in deleted_sql


def test_decommission_postcondition_fails_closed_on_any_unapproved_residue():
    cursor = _InventoryCursor(
        counts={"audit_log": 2, "goi_thau": 1},
        organization_exists=False,
    )

    with pytest.raises(OrganizationDecommissionPostconditionError) as captured:
        assert_organization_decommission_postcondition(
            cursor,
            "org-a",
            approved_retained_tables={"audit_log"},
        )

    assert captured.value.blockers == {"goi_thau": 1}


def test_decommission_postcondition_requires_root_removal():
    cursor = _InventoryCursor(organization_exists=True)

    with pytest.raises(OrganizationDecommissionPostconditionError) as captured:
        assert_organization_decommission_postcondition(cursor, "org-a")

    assert captured.value.organization_exists is True


def test_production_backend_has_no_direct_organization_delete_path():
    backend_root = Path(__file__).resolve().parents[1] / "backend"
    offenders = []
    pattern = re.compile(r"DELETE\s+FROM\s+to_chuc\b", flags=re.IGNORECASE)
    for path in backend_root.rglob("*.py"):
        if pattern.search(path.read_text(encoding="utf-8")):
            offenders.append(path.relative_to(backend_root).as_posix())

    assert offenders == []


def test_decommission_runbook_keeps_destructive_workflow_blocked():
    runbook = (
        Path(__file__).resolve().parents[1]
        / "deploy"
        / "runbooks"
        / "organization-decommission.md"
    ).read_text(encoding="utf-8").casefold()

    for required_contract in (
        "không phải feature đang được hỗ trợ",
        "ownership dry-run",
        "postcondition",
        "không thêm cascade FK",
        "retention/legal",
    ):
        assert required_contract.casefold() in runbook


class _SuspendedWorkspaceCursor:
    def __init__(self):
        self.statements = []

    def execute(self, sql, params=()):
        self.statements.append((sql, params))
        if "FROM tai_khoan" in sql:
            self._row = ("user", "active")
        elif "FROM thanh_vien_to_chuc" in sql and "organization_id = ?" in sql:
            self._row = {
                "id": "org-suspended",
                "trang_thai": "suspended",
                "vai_tro_trong_to_chuc": "manager",
            }
        else:
            self._row = None
        return self

    def fetchone(self):
        return self._row

    def fetchall(self):
        return []


def test_suspended_organization_is_hidden_from_normal_workspace_list():
    cursor = _SuspendedWorkspaceCursor()

    assert get_user_organizations(cursor, "user-a") == []
    query = next(
        sql for sql, _params in cursor.statements
        if "FROM thanh_vien_to_chuc AS tvtc" in sql
    )
    assert "tc.trang_thai = 'active'" in query


def test_suspended_organization_cannot_be_selected_for_new_writes():
    cursor = _SuspendedWorkspaceCursor()
    request = type(
        "Request",
        (),
        {"headers": {"X-Active-Org": "org-suspended"}, "state": object()},
    )()

    with pytest.raises(OrgPermissionError, match="tạm ngưng"):
        get_active_org(request, "user-a", cursor=cursor)


def test_canonical_workspace_trigger_rejects_suspended_organization_writes():
    source = (
        Path(__file__).resolve().parents[1]
        / "backend"
        / "db"
        / "postgres_schema.py"
    ).read_text(encoding="utf-8")

    workspace_function = source.split(
        "CREATE OR REPLACE FUNCTION bf_validate_workspace_owner()", 1
    )[1].split("CREATE OR REPLACE FUNCTION", 1)[0]
    assert "to_jsonb(to_chuc)->>'trang_thai'" in workspace_function
    assert "= 'active'" in workspace_function


def test_real_postgres_rejects_new_business_rows_for_suspended_organization():
    database_url = _test_database_url()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    try:
        connection = psycopg.connect(database_url, row_factory=compat_row_factory)
    except psycopg.Error as error:
        pytest.skip(f"PostgreSQL test database is unavailable: {type(error).__name__}")

    cursor = PostgresCursor(connection.cursor())
    organization_id = f"suspended-org-{uuid.uuid4().hex}"
    owner_id = f"suspended-owner-{uuid.uuid4().hex}"
    try:
        cursor.execute(
            "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (?, ?)",
            (organization_id, "Suspended Organization"),
        )
        cursor.execute(
            "UPDATE to_chuc SET trang_thai = 'suspended' WHERE id = ?",
            (organization_id,),
        )
        connection.commit()

        with pytest.raises(psycopg.errors.CheckViolation):
            cursor.execute(
                """INSERT INTO chu_dau_tu
                       (id, organization_id, owner_type, ma_chu_dau_tu, ten_chu_dau_tu)
                   VALUES (?, ?, 'organization', 'LOCKED', 'Blocked write')""",
                (owner_id, organization_id),
            )
        connection.rollback()
    finally:
        connection.rollback()
        cursor.execute("DELETE FROM to_chuc WHERE id = ?", (organization_id,))
        connection.commit()
        connection.close()
