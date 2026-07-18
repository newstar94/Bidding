"""Verify the clean-install organization and implicit personal workspace model."""

import os
import pathlib
import sqlite3
import sys
import tempfile
import time
from types import SimpleNamespace


ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def _expect_integrity_error(cursor, sql, params):
    try:
        cursor.execute(sql, params)
    except sqlite3.IntegrityError:
        return
    raise AssertionError("The database accepted an invalid workspace owner")


def main():
    with tempfile.TemporaryDirectory(prefix="bidding-workspace-") as temp_dir:
        database_path = pathlib.Path(temp_dir, "fresh.db").resolve()
        os.environ["BIDDING_DB_PATH"] = str(database_path)
        os.environ["ADMIN_PASSWORD"] = "FreshInstall#2026!"

        from backend.auth.auth_service import build_user_access_payload
        from backend.db.db_helper import database
        from backend.db.db_utils import DB_SCHEMA_VERSION, khoi_tao_va_di_tru_he_thong
        from backend.startup import verify_database_readiness
        from backend.sync.ownership import get_owner_type
        from backend.shared.subscription_policy import can_use_word_export
        from backend.shared.access_policy import resolve_document_export_capabilities
        from backend.auth.session_utils import get_active_org

        khoi_tao_va_di_tru_he_thong()
        connection = database.get_connection()
        cursor = connection.cursor()

        assert cursor.execute("PRAGMA user_version").fetchone()[0] == DB_SCHEMA_VERSION
        assert cursor.execute(
            "SELECT schema_version FROM database_metadata WHERE id = 1"
        ).fetchone()[0] == DB_SCHEMA_VERSION
        assert cursor.execute(
            """SELECT 1 FROM sqlite_master
               WHERE type = 'table' AND name = 'schema_migrations'"""
        ).fetchone() is None

        organization_columns = {
            row[1] for row in cursor.execute("PRAGMA table_info(to_chuc)").fetchall()
        }
        assert "scope_type" not in organization_columns
        assert "personal_owner_user_id" not in organization_columns
        assert cursor.execute("SELECT count(*) FROM to_chuc").fetchone()[0] == 1

        admin = cursor.execute(
            "SELECT id, ho_ten, vai_tro FROM tai_khoan WHERE vai_tro = 'super_admin'"
        ).fetchone()
        admin_access = build_user_access_payload(
            cursor, admin["id"], admin["vai_tro"], display_name=admin["ho_ten"]
        )
        assert all(scope["scope_type"] == "organization" for scope in admin_access["organizations"])

        user_id = "user-fresh-install"
        cursor.execute(
            """
            INSERT INTO tai_khoan (
                id, ten_dang_nhap, username_norm, mat_khau, ho_ten, vai_tro,
                email, email_norm, da_xac_minh
            ) VALUES (?, ?, ?, ?, ?, 'user', ?, ?, 1)
            """,
            (
                user_id,
                "fresh.user",
                "fresh.user",
                "not-used-by-this-verifier",
                "Fresh User",
                "fresh.user@example.test",
                "fresh.user@example.test",
            ),
        )

        personal_scope = f"personal:{user_id}"
        personal_access = build_user_access_payload(
            cursor, user_id, "user", display_name="Fresh User"
        )
        assert personal_access["active_org_id"] == personal_scope
        assert [scope["scope_type"] for scope in personal_access["organizations"]] == ["personal"]
        assert personal_access["organizations"][0]["name"] == "Cá nhân"
        assert personal_access["subscription"] is None
        assert personal_access["entitlements"]["word_export"] is False
        assert cursor.execute(
            "SELECT count(*) FROM account_subscriptions WHERE user_id = ?", (user_id,)
        ).fetchone()[0] == 0
        assert can_use_word_export(cursor, "user", user_id, personal_scope) is False
        assert resolve_document_export_capabilities(
            cursor, "user", user_id, personal_scope
        ).as_dict() == {"financial": False, "identity": False, "signature": False}
        assert cursor.execute(
            "SELECT count(*) FROM to_chuc WHERE id = ?", (personal_scope,)
        ).fetchone()[0] == 0
        assert cursor.execute(
            "SELECT count(*) FROM thanh_vien_to_chuc WHERE organization_id = ?",
            (personal_scope,),
        ).fetchone()[0] == 0
        assert get_owner_type(cursor, personal_scope) == "personal"

        organization_id = cursor.execute("SELECT id FROM to_chuc LIMIT 1").fetchone()[0]
        cursor.execute(
            """
            INSERT INTO thanh_vien_to_chuc (
                user_id, organization_id, vai_tro_trong_to_chuc
            ) VALUES (?, ?, 'employee')
            """,
            (user_id, organization_id),
        )
        mixed_access = build_user_access_payload(cursor, user_id, "user")
        assert [scope["scope_type"] for scope in mixed_access["organizations"]] == [
            "organization",
            "personal",
        ]
        assert mixed_access["organizations"][1]["name"] == "Cá nhân"
        assert mixed_access["active_org_id"] == organization_id
        assert mixed_access["entitlements"]["word_export"] is True
        assert can_use_word_export(cursor, "user", user_id, organization_id) is True
        assert resolve_document_export_capabilities(
            cursor, "user", user_id, organization_id
        ).as_dict() == {"financial": False, "identity": False, "signature": False}
        selected_personal = build_user_access_payload(
            cursor, user_id, "user", active_org_hint=personal_scope
        )
        assert selected_personal["active_org_id"] == personal_scope
        assert selected_personal["entitlements"]["word_export"] is False

        now = int(time.time())
        cursor.execute(
            """INSERT INTO account_subscriptions (
                   user_id, package_id, status, starts_at, expires_at
               ) VALUES (?, 'silver', 'active', ?, ?)""",
            (user_id, now, now + 365 * 86400),
        )
        paid_personal = build_user_access_payload(
            cursor, user_id, "user", active_org_hint=personal_scope
        )
        assert paid_personal["entitlements"]["word_export"] is True
        assert can_use_word_export(cursor, "user", user_id, personal_scope) is True
        assert resolve_document_export_capabilities(
            cursor, "user", user_id, personal_scope
        ).as_dict() == {"financial": True, "identity": True, "signature": True}

        cursor.execute(
            "DELETE FROM organization_subscriptions WHERE organization_id = ?",
            (organization_id,),
        )
        free_organization = build_user_access_payload(
            cursor, user_id, "user", active_org_hint=organization_id
        )
        assert free_organization["active_org_id"] == organization_id
        assert free_organization["organizations"][0]["status"] == "active"
        assert free_organization["entitlements"]["word_export"] is False
        assert can_use_word_export(cursor, "user", user_id, organization_id) is False
        connection.commit()
        request = SimpleNamespace(
            headers={"X-Active-Org": organization_id},
            state=SimpleNamespace(),
        )
        assert get_active_org(request, user_id) == organization_id

        cursor.execute(
            """
            INSERT INTO record_edit_ownership (
                organization_id, table_name, record_id, user_id
            ) VALUES (?, 'chu_dau_tu', 'personal-record', ?)
            """,
            (personal_scope, user_id),
        )
        _expect_integrity_error(
            cursor,
            """
            INSERT INTO cau_hinh_bien_word (
                id, organization_id, owner_type, ten_bien, source_table, source_column
            ) VALUES (?, ?, 'personal', ?, ?, ?)
            """,
            (
                "invalid-personal-scope",
                "personal:missing-user",
                "invalid_scope",
                "tai_khoan",
                "id",
            ),
        )
        connection.rollback()
        assert cursor.execute("PRAGMA foreign_key_check").fetchall() == []
        connection.close()
        verify_database_readiness(database, DB_SCHEMA_VERSION)

    print("Workspace model verification passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
