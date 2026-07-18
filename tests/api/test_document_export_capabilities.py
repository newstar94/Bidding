import json
import sqlite3

import pytest

from backend.api import org_routes
from backend.auth.auth_helper import SessionRole
from backend.db.db_helper import SQLiteDatabase
from backend.db.db_utils import _build_create_table_sql
from backend.db.migrations import m0006_document_export_capabilities
from backend.db.schema import SCHEMA_DINH_NGHIA
from backend.shared.access_policy import (
    can_export_document_capability,
    resolve_document_export_capabilities,
)


class _MigrationContext:
    @staticmethod
    def assert_foreign_key_integrity(cursor):
        assert cursor.execute("PRAGMA foreign_key_check").fetchall() == []


class _Request:
    cookies = {}
    headers = {}

    def __init__(self, user_id, payload=None, method="GET"):
        self.path_params = {"user_id": user_id}
        self._payload = payload
        self.method = method

    async def json(self):
        return self._payload


def _payload(response):
    return json.loads(response.body.decode("utf-8"))


def _create_capability_schema(connection):
    for table_name in ("tai_khoan", "to_chuc", "thanh_vien_to_chuc"):
        connection.execute(
            _build_create_table_sql(table_name, SCHEMA_DINH_NGHIA[table_name])
        )
    m0006_document_export_capabilities.apply(
        connection.cursor(), _MigrationContext()
    )


def _insert_account(connection, user_id, role="user"):
    email = f"{user_id}@example.com"
    connection.execute(
        """INSERT INTO tai_khoan (
               id, ten_dang_nhap, username_norm, mat_khau,
               email, email_norm, vai_tro
           ) VALUES (?, ?, ?, 'test-hash', ?, ?, ?)""",
        (user_id, user_id, user_id, email, email, role),
    )


def _seed_capability_database(path):
    database = SQLiteDatabase(path)
    connection = database.get_connection()
    _create_capability_schema(connection)
    for user_id, role in (
        ("manager", "user"),
        ("employee", "user"),
        ("other-manager", "user"),
        ("outsider", "user"),
        ("platform-admin", "super_admin"),
        ("personal-owner", "user"),
    ):
        _insert_account(connection, user_id, role)
    connection.execute(
        "INSERT INTO to_chuc (id, ten_to_chuc) VALUES ('org-a', 'Organization A')"
    )
    connection.execute(
        "INSERT INTO to_chuc (id, ten_to_chuc) VALUES ('org-b', 'Organization B')"
    )
    connection.execute(
        """INSERT INTO to_chuc (
               id, ten_to_chuc, scope_type, personal_owner_user_id
           ) VALUES ('personal', 'Personal', 'personal', 'personal-owner')"""
    )
    connection.executemany(
        """INSERT INTO thanh_vien_to_chuc (
               user_id, organization_id, vai_tro_trong_to_chuc
           ) VALUES (?, ?, ?)""",
        (
            ("manager", "org-a", "manager"),
            ("employee", "org-a", "employee"),
            ("platform-admin", "org-a", "employee"),
            ("other-manager", "org-b", "manager"),
            ("outsider", "org-b", "employee"),
            ("personal-owner", "personal", "employee"),
        ),
    )
    connection.commit()
    connection.close()
    return database


def test_migration_enforces_tenant_membership_booleans_and_cascade():
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    _create_capability_schema(connection)
    for user_id in ("employee", "outsider"):
        _insert_account(connection, user_id)
    for organization_id in ("org-a", "org-b"):
        connection.execute(
            "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (?, ?)",
            (organization_id, organization_id),
        )
    connection.execute(
        """INSERT INTO thanh_vien_to_chuc (
               user_id, organization_id, vai_tro_trong_to_chuc
           ) VALUES ('employee', 'org-a', 'employee')"""
    )

    with pytest.raises(sqlite3.IntegrityError):
        connection.execute(
            """INSERT INTO document_export_capabilities (
                   organization_id, user_id, financial
               ) VALUES ('org-b', 'employee', 1)"""
        )
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute(
            """INSERT INTO document_export_capabilities (
                   organization_id, user_id, financial
               ) VALUES ('org-a', 'employee', 2)"""
        )

    connection.execute(
        """INSERT INTO document_export_capabilities (
               organization_id, user_id, financial
           ) VALUES ('org-a', 'employee', 1)"""
    )
    connection.execute(
        """DELETE FROM thanh_vien_to_chuc
           WHERE organization_id = 'org-a' AND user_id = 'employee'"""
    )
    assert connection.execute(
        "SELECT count(*) FROM document_export_capabilities"
    ).fetchone()[0] == 0
    connection.close()


def test_resolver_defaults_deny_and_honors_explicit_and_inherited_grants(tmp_path):
    database = _seed_capability_database(tmp_path / "resolver.db")
    connection = database.get_connection()
    cursor = connection.cursor()

    assert resolve_document_export_capabilities(
        cursor, "user", "employee", "org-a"
    ).as_dict() == {"financial": False, "identity": False, "signature": False}
    connection.execute(
        """INSERT INTO document_export_capabilities (
               organization_id, user_id, financial, identity, signature
           ) VALUES ('org-a', 'employee', 1, 0, 1)"""
    )
    assert resolve_document_export_capabilities(
        cursor, "user", "employee", "org-a"
    ).as_dict() == {"financial": True, "identity": False, "signature": True}
    assert can_export_document_capability(
        cursor, "user", "employee", "org-a", "identity"
    ) is False
    assert can_export_document_capability(
        cursor, "user", "employee", "org-a", "unknown"
    ) is False

    assert all(
        resolve_document_export_capabilities(
            cursor, "user", "manager", "org-a"
        ).as_dict().values()
    )
    assert all(
        resolve_document_export_capabilities(
            cursor, "super_admin", "platform-admin", "org-a"
        ).as_dict().values()
    )
    assert all(
        resolve_document_export_capabilities(
            cursor, "user", "personal-owner", "personal"
        ).as_dict().values()
    )
    connection.close()


def _patch_api(monkeypatch, database, actor="manager", active_org="org-a"):
    audits = []
    monkeypatch.setattr(org_routes, "database", database)
    monkeypatch.setattr(
        org_routes,
        "verify_session",
        lambda _request: (True, SessionRole("user", actor)),
    )
    monkeypatch.setattr(
        org_routes,
        "get_active_org",
        lambda _request, _user_id: active_org,
    )
    monkeypatch.setattr(
        org_routes,
        "log_audit",
        lambda action, *args, **kwargs: audits.append((action, args, kwargs)),
    )
    return audits


@pytest.mark.anyio
async def test_manager_get_put_replaces_grants_and_audits_identifiers_only(
    monkeypatch, tmp_path
):
    database = _seed_capability_database(tmp_path / "manager-api.db")
    audits = _patch_api(monkeypatch, database)

    before = await org_routes.get_document_export_capabilities_api(
        _Request("employee")
    )
    updated = await org_routes.update_document_export_capabilities_api(
        _Request(
            "employee",
            {"financial": True, "identity": False, "signature": True},
            method="PUT",
        )
    )
    after = await org_routes.get_document_export_capabilities_api(
        _Request("employee")
    )

    assert before.status_code == updated.status_code == after.status_code == 200
    assert _payload(before)["effectiveCapabilities"] == {
        "financial": False,
        "identity": False,
        "signature": False,
    }
    assert _payload(updated)["grants"] == {
        "financial": True,
        "identity": False,
        "signature": True,
    }
    assert _payload(after)["effectiveCapabilities"] == _payload(updated)["grants"]
    assert audits[0][0] == "document.export_capabilities_updated"
    assert audits[0][2]["target_id"] == "org-a:employee"
    assert audits[0][2]["metadata"] == {
        "organization_id": "org-a",
        "user_id": "employee",
        "enabled_capability_ids": ["financial", "signature"],
        "disabled_capability_ids": ["identity"],
    }


@pytest.mark.anyio
async def test_employee_cannot_manage_capabilities(monkeypatch, tmp_path):
    database = _seed_capability_database(tmp_path / "employee-denied.db")
    _patch_api(monkeypatch, database, actor="employee")

    response = await org_routes.get_document_export_capabilities_api(
        _Request("employee")
    )

    assert response.status_code == 403
    assert _payload(response)["code"] == "DOCUMENT_EXPORT_CAPABILITY_MANAGE_FORBIDDEN"


@pytest.mark.anyio
async def test_cross_tenant_target_is_not_exposed_or_modified(monkeypatch, tmp_path):
    database = _seed_capability_database(tmp_path / "cross-tenant.db")
    audits = _patch_api(monkeypatch, database)

    response = await org_routes.update_document_export_capabilities_api(
        _Request(
            "outsider",
            {"financial": True, "identity": True, "signature": True},
            method="PUT",
        )
    )

    assert response.status_code == 404
    assert _payload(response)["code"] == "DOCUMENT_EXPORT_CAPABILITY_TARGET_NOT_FOUND"
    connection = database.get_connection()
    assert connection.execute(
        "SELECT count(*) FROM document_export_capabilities"
    ).fetchone()[0] == 0
    connection.close()
    assert audits == []


@pytest.mark.anyio
async def test_put_requires_exact_boolean_contract_and_rejects_inherited_target(
    monkeypatch, tmp_path
):
    database = _seed_capability_database(tmp_path / "validation.db")
    _patch_api(monkeypatch, database)

    invalid = await org_routes.update_document_export_capabilities_api(
        _Request(
            "employee",
            {"financial": 1, "identity": False, "signature": False, "extra": True},
            method="PUT",
        )
    )
    inherited = await org_routes.update_document_export_capabilities_api(
        _Request(
            "platform-admin",
            {"financial": False, "identity": False, "signature": False},
            method="PUT",
        )
    )

    assert invalid.status_code == 400
    assert _payload(invalid)["code"] == "REQUEST_VALIDATION_FAILED"
    assert inherited.status_code == 409
    assert _payload(inherited)["code"] == "DOCUMENT_EXPORT_CAPABILITY_INHERITED"


@pytest.mark.anyio
async def test_required_audit_failure_rolls_back_capability_mutation(
    monkeypatch, tmp_path
):
    database = _seed_capability_database(tmp_path / "audit-required.db")
    _patch_api(monkeypatch, database)

    def fail_audit(*_args, **_kwargs):
        raise sqlite3.OperationalError("audit unavailable")

    monkeypatch.setattr(org_routes, "log_audit", fail_audit)
    response = await org_routes.update_document_export_capabilities_api(
        _Request(
            "employee",
            {"financial": True, "identity": True, "signature": True},
            method="PUT",
        )
    )

    assert response.status_code == 500
    connection = database.get_connection()
    assert connection.execute(
        "SELECT count(*) FROM document_export_capabilities"
    ).fetchone()[0] == 0
    connection.close()
