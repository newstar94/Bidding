import re
from pathlib import Path

import pytest

from backend.db.schema import SCHEMA_DINH_NGHIA
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


def test_organization_ownership_registry_covers_schema_without_manual_allowlist():
    registry = organization_ownership_registry()
    expected_tables = {
        table_name
        for table_name, table_spec in SCHEMA_DINH_NGHIA.items()
        if "organization_id" in table_spec.get("columns", {})
    }

    assert {entry.table_name for entry in registry} == expected_tables
    assert len(registry) == 62
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
