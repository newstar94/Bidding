from pathlib import Path

from backend.auth.session_store import session_invalid_reason
from backend.db.schema import SCHEMA_DINH_NGHIA
from backend.db.upgrades import (
    DB_SCHEMA_VERSION,
    UPGRADES,
    _upgrade_to_v48_add_account_status,
)


class _RecordingCursor:
    def __init__(self):
        self.statements = []

    def execute(self, sql, params=()):
        self.statements.append((sql, params))
        return self

    def fetchone(self):
        return None


def test_account_status_uses_a_forward_only_v48_migration():
    assert DB_SCHEMA_VERSION >= 48
    assert any(
        upgrade.version == 48 and upgrade.name == "add_account_status"
        for upgrade in UPGRADES
    )
    assert UPGRADES[-1].version == DB_SCHEMA_VERSION == 61
    assert any(
        upgrade.version == 50
        and upgrade.name == "version_procurement_binding_snapshots"
        for upgrade in UPGRADES
    )
    assert any(
        upgrade.version == 51 and upgrade.name == "add_unknown_package_status"
        for upgrade in UPGRADES
    )
    assert any(
        upgrade.version == 52 and upgrade.name == "add_muasamcong_provider"
        for upgrade in UPGRADES
    )
    assert any(
        upgrade.version == 55
        and upgrade.name == "add_procurement_import_sessions"
        for upgrade in UPGRADES
    )
    assert any(
        upgrade.version == 56
        and upgrade.name == "separate_sensitive_record_read_capabilities"
        for upgrade in UPGRADES
    )
    assert any(
        upgrade.version == 57
        and upgrade.name == "repair_sensitive_record_read_capability_fk"
        for upgrade in UPGRADES
    )
    assert any(
        upgrade.version == 58
        and upgrade.name == "add_document_job_authorization_policy"
        for upgrade in UPGRADES
    )
    assert any(
        upgrade.version == 59
        and upgrade.name == "rename_websocket_delivery_to_dispatch"
        for upgrade in UPGRADES
    )
    assert UPGRADES[-1].name == "rename_default_workspace"
    assert "trang_thai" in SCHEMA_DINH_NGHIA["tai_khoan"]["columns"]
    definition = SCHEMA_DINH_NGHIA["tai_khoan"]["columns"]["trang_thai"]
    assert "DEFAULT 'active'" in definition
    assert "'inactive'" in definition

    cursor = _RecordingCursor()
    _upgrade_to_v48_add_account_status(cursor, None)
    migration_sql = "\n".join(sql for sql, _params in cursor.statements)
    assert "ALTER TABLE tai_khoan" in migration_sql
    assert "ADD COLUMN IF NOT EXISTS trang_thai" in migration_sql
    assert "tai_khoan_trang_thai_check" in migration_sql


def test_inactive_account_invalidates_even_an_unrevoked_session_snapshot():
    user = {
        "account_status": "inactive",
        "revoked_at": None,
        "absolute_expires_at": 2_000,
        "idle_expires_at": 2_000,
    }

    assert session_invalid_reason(user, now=1_000) == "account_inactive"


def test_runtime_account_deactivation_contains_no_root_account_delete():
    source = (
        Path(__file__).resolve().parents[1]
        / "backend"
        / "auth"
        / "admin_user_routes.py"
    ).read_text(encoding="utf-8")

    assert "DELETE FROM tai_khoan" not in source
    assert "admin.user_deactivated" in source
    assert "ACCOUNT_DEACTIVATED" in source

    frontend = (
        Path(__file__).resolve().parents[1]
        / "frontend"
        / "admin"
        / "AdminUserController.js"
    ).read_text(encoding="utf-8")
    assert "xóa vĩnh viễn tài khoản" not in frontend.casefold()
    assert "ngừng hoạt động tài khoản" in frontend.casefold()
