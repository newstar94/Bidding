from __future__ import annotations

import sqlite3

import pytest

from backend.db.schema import SCHEMA_DINH_NGHIA
from backend.db.upgrades import DB_SCHEMA_VERSION, UPGRADES
from backend.shared.subscription_policy import can_use_document_export
from backend.shared.workspace_scope import personal_workspace_payload


def _database(*, word=1, excel=1, award=1):
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        CREATE TABLE goi_dich_vu (
            id TEXT PRIMARY KEY,
            trang_thai TEXT,
            document_export_word INTEGER,
            document_export_excel INTEGER,
            document_export_award_result_excel INTEGER
        );
        CREATE TABLE to_chuc (id TEXT PRIMARY KEY, trang_thai TEXT);
        CREATE TABLE thanh_vien_to_chuc (
            user_id TEXT, organization_id TEXT, trang_thai_thanh_vien TEXT
        );
        CREATE TABLE organization_subscriptions (
            organization_id TEXT, package_id TEXT, status TEXT,
            starts_at INTEGER, expires_at INTEGER, member_quota INTEGER,
            revision INTEGER
        );
        CREATE TABLE account_subscriptions (
            user_id TEXT, package_id TEXT, status TEXT,
            starts_at INTEGER, expires_at INTEGER, revision INTEGER
        );
        INSERT INTO to_chuc VALUES ('org', 'active');
        INSERT INTO thanh_vien_to_chuc VALUES ('manager', 'org', 'active');
        INSERT INTO thanh_vien_to_chuc VALUES ('employee', 'org', 'active');
        INSERT INTO organization_subscriptions
        VALUES ('org', 'plan', 'active', 1, NULL, 10, 1);
        INSERT INTO account_subscriptions
        VALUES ('personal-user', 'plan', 'active', 1, NULL, 1);
        """
    )
    connection.execute(
        "INSERT INTO goi_dich_vu VALUES ('plan', 'active', ?, ?, ?)",
        (word, excel, award),
    )
    return connection


@pytest.mark.parametrize("role", ["manager", "employee"])
def test_organization_roles_use_format_specific_capabilities(role):
    connection = _database(word=1, excel=0, award=1)
    try:
        cursor = connection.cursor()
        assert can_use_document_export(
            cursor, role, role, "org", format="docx"
        ) is True
        assert can_use_document_export(
            cursor, role, role, "org", format="xlsx"
        ) is False
        assert can_use_document_export(
            cursor,
            role,
            role,
            "org",
            format="xlsx",
            feature="award_result",
        ) is True
    finally:
        connection.close()


def test_excel_can_be_granted_without_award_result_and_personal_scope_is_supported():
    connection = _database(word=0, excel=1, award=0)
    try:
        cursor = connection.cursor()
        assert can_use_document_export(
            cursor, "employee", "employee", "org", format="xlsx"
        ) is True
        assert can_use_document_export(
            cursor,
            "employee",
            "employee",
            "org",
            format="xlsx",
            feature="award_result",
        ) is False
        assert can_use_document_export(
            cursor,
            "user",
            "personal-user",
            "personal:personal-user",
            format="xlsx",
        ) is True
    finally:
        connection.close()


def test_super_admin_bypasses_plan_but_cross_organization_member_does_not():
    connection = _database(word=0, excel=0, award=0)
    try:
        cursor = connection.cursor()
        assert can_use_document_export(
            cursor, "super_admin", "admin", "org", format="xlsx"
        ) is True
        assert can_use_document_export(
            cursor, "employee", "outsider", "org", format="docx"
        ) is False
    finally:
        connection.close()


def test_v37_legacy_backfill_and_schema_capabilities_are_registered():
    statements = []

    class Cursor:
        def execute(self, statement, params=None):
            statements.append((" ".join(statement.split()), params))
            return self

    upgrade = next(item for item in UPGRADES if item.version == 37)
    upgrade.apply(Cursor(), None)
    sql = "\n".join(statement for statement, _ in statements)

    assert DB_SCHEMA_VERSION >= 37
    assert upgrade.name == "add_document_export_capabilities"
    for column in (
        "document_export_word",
        "document_export_excel",
        "document_export_award_result_excel",
    ):
        assert column in SCHEMA_DINH_NGHIA["goi_dich_vu"]["columns"]
        assert f"SET {column} = 1 WHERE {column} IS NULL" in sql


def test_personal_workspace_projects_format_specific_export_entitlements():
    subscription = {
        "status": "active",
        "entitlements": {
            "document.export.word": False,
            "document.export.excel": True,
            "document.export.award_result_excel": False,
        },
    }

    payload = personal_workspace_payload("user", "User", subscription)

    assert payload["entitlements"] == {
        "word_export": False,
        "excel_export": True,
        "award_result_excel_export": False,
        "source": "account_subscription",
    }
