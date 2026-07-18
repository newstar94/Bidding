import sqlite3
import json
from types import SimpleNamespace

import pytest

from backend.auth import auth_routes
from backend.auth import session_utils
from backend.auth.auth_helper import SessionRole
from backend.db.db_helper import SQLiteDatabase
from backend.shared.access_policy import (
    authorize_record_write,
    can_manage_word_config,
    can_read_table,
    is_organization_manager,
)


def _policy_connection():
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        CREATE TABLE thanh_vien_to_chuc (
            user_id TEXT NOT NULL,
            organization_id TEXT NOT NULL,
            vai_tro_trong_to_chuc TEXT NOT NULL,
            PRIMARY KEY (user_id, organization_id)
        );
        CREATE TABLE ma_tran_phan_quyen (
            organization_id TEXT NOT NULL,
            emp_id TEXT NOT NULL,
            kehoach TEXT,
            goithau TEXT,
            chudautu TEXT,
            nhathau TEXT,
            hopdong TEXT
        );
        CREATE TABLE to_chuc (
            id TEXT PRIMARY KEY,
            scope_type TEXT NOT NULL,
            personal_owner_user_id TEXT
        );
        CREATE TABLE chu_dau_tu (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            id_goc TEXT
        );
        CREATE TABLE ke_hoach_lcnt (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            id_goc TEXT
        );
        CREATE TABLE goi_thau (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            id_goc TEXT,
            ke_hoach_id TEXT
        );
        CREATE TABLE phan_cong_nhan_su (
            organization_id TEXT NOT NULL,
            id_nhan_vien TEXT NOT NULL,
            id_muc_tieu TEXT NOT NULL,
            loai_doi_tuong TEXT NOT NULL
        );
        CREATE TABLE record_edit_ownership (
            organization_id TEXT NOT NULL,
            table_name TEXT NOT NULL,
            record_id TEXT NOT NULL,
            user_id TEXT NOT NULL
        );
        INSERT INTO thanh_vien_to_chuc VALUES ('user-1', 'org-a', 'manager');
        INSERT INTO thanh_vien_to_chuc VALUES ('user-1', 'org-b', 'employee');
        INSERT INTO to_chuc VALUES ('org-a', 'organization', NULL);
        INSERT INTO to_chuc VALUES ('org-b', 'organization', NULL);
        INSERT INTO to_chuc VALUES ('personal-1', 'personal', 'user-1');
        """
    )
    return connection


def test_account_manager_role_does_not_cross_organization_boundary():
    connection = _policy_connection()
    cursor = connection.cursor()

    assert is_organization_manager(cursor, "manager", "user-1", "org-a") is True
    assert is_organization_manager(cursor, "manager", "user-1", "org-b") is False

    decision = authorize_record_write(
        cursor,
        "manager",
        "user-1",
        "org-b",
        "assignments",
        "phan_cong_nhan_su",
        {"id": "assignment-1"},
    )
    assert decision.allowed is False


def test_user_without_membership_is_denied_by_default():
    connection = _policy_connection()
    cursor = connection.cursor()

    assert can_read_table(
        cursor,
        "employee",
        "outsider",
        "org-a",
        "chudautu",
        "chu_dau_tu",
    ) is False


def test_platform_super_admin_remains_platform_scoped():
    connection = _policy_connection()
    cursor = connection.cursor()

    assert is_organization_manager(cursor, "super_admin", "admin", "org-a") is True
    assert can_read_table(
        cursor,
        "super_admin",
        "admin",
        "org-a",
        "chudautu",
        "chu_dau_tu",
    ) is True


def test_personal_workspace_owner_can_create_and_read_business_data():
    connection = _policy_connection()
    cursor = connection.cursor()

    decision = authorize_record_write(
        cursor,
        "employee",
        "user-1",
        "personal-1",
        "chudautu",
        "chu_dau_tu",
        {"id": "cdt-personal-1"},
    )

    assert decision.allowed is True
    assert can_read_table(
        cursor,
        "employee",
        "user-1",
        "personal-1",
        "chudautu",
        "chu_dau_tu",
    ) is True
    assert can_read_table(
        cursor,
        "employee",
        "other-user",
        "personal-1",
        "chudautu",
        "chu_dau_tu",
    ) is False


def test_employee_with_related_edit_permission_can_manage_word_config():
    connection = _policy_connection()
    cursor = connection.cursor()
    cursor.execute(
        "INSERT INTO ma_tran_phan_quyen VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("org-b", "user-1", "view", "edit", "view", "view", "view"),
    )

    assert can_manage_word_config(cursor, "employee", "user-1", "org-b") is True
    cursor.execute("UPDATE ma_tran_phan_quyen SET goithau = 'view' WHERE organization_id = 'org-b'")
    assert can_manage_word_config(cursor, "employee", "user-1", "org-b") is False
    assert can_manage_word_config(cursor, "employee", "user-1", "personal-1") is True


def test_employee_cannot_version_an_unowned_partner_record():
    connection = _policy_connection()
    cursor = connection.cursor()
    cursor.execute(
        "INSERT INTO ma_tran_phan_quyen VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("org-b", "user-1", "view", "view", "edit", "view", "view"),
    )
    cursor.execute("INSERT INTO chu_dau_tu VALUES ('cdt-manager', 'org-b', 'cdt-manager')")

    decision = authorize_record_write(
        cursor,
        "employee",
        "user-1",
        "org-b",
        "chudautu",
        "chu_dau_tu",
        {"id": "cdt-version-1", "rootId": "cdt-manager"},
    )

    assert decision.allowed is False


def test_employee_can_version_a_partner_record_they_created():
    connection = _policy_connection()
    cursor = connection.cursor()
    cursor.execute(
        "INSERT INTO ma_tran_phan_quyen VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("org-b", "user-1", "view", "view", "edit", "view", "view"),
    )
    cursor.execute("INSERT INTO chu_dau_tu VALUES ('cdt-owned', 'org-b', 'cdt-owned')")
    cursor.execute(
        "INSERT INTO record_edit_ownership VALUES ('org-b', 'chu_dau_tu', 'cdt-owned', 'user-1')"
    )

    decision = authorize_record_write(
        cursor,
        "employee",
        "user-1",
        "org-b",
        "chudautu",
        "chu_dau_tu",
        {"id": "cdt-version-1", "rootId": "cdt-owned"},
    )

    assert decision.allowed is True


def test_employee_cannot_bypass_assignment_with_a_new_plan_version_id():
    connection = _policy_connection()
    cursor = connection.cursor()
    cursor.execute(
        "INSERT INTO ma_tran_phan_quyen VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("org-b", "user-1", "edit", "view", "view", "view", "view"),
    )
    cursor.execute("INSERT INTO ke_hoach_lcnt VALUES ('plan-manager', 'org-b', 'plan-manager')")

    denied = authorize_record_write(
        cursor,
        "employee",
        "user-1",
        "org-b",
        "kehoach",
        "ke_hoach_lcnt",
        {"id": "plan-version-1", "rootId": "plan-manager"},
    )
    cursor.execute(
        "INSERT INTO phan_cong_nhan_su VALUES ('org-b', 'user-1', 'plan-manager', 'kehoach')"
    )
    allowed = authorize_record_write(
        cursor,
        "employee",
        "user-1",
        "org-b",
        "kehoach",
        "ke_hoach_lcnt",
        {"id": "plan-version-1", "rootId": "plan-manager"},
    )

    assert denied.allowed is False
    assert allowed.allowed is True


def _role_database(path):
    database = SQLiteDatabase(path)
    connection = database.get_connection()
    connection.executescript(
        """
        CREATE TABLE tai_khoan (id TEXT PRIMARY KEY, vai_tro TEXT);
        CREATE TABLE to_chuc (
            id TEXT PRIMARY KEY,
            scope_type TEXT NOT NULL DEFAULT 'organization'
        );
        CREATE TABLE thanh_vien_to_chuc (
            user_id TEXT NOT NULL,
            organization_id TEXT NOT NULL,
            vai_tro_trong_to_chuc TEXT NOT NULL,
            updated_at TEXT,
            PRIMARY KEY (user_id, organization_id)
        );
        INSERT INTO tai_khoan VALUES ('actor', 'manager');
        INSERT INTO tai_khoan VALUES ('target', 'user');
        INSERT INTO to_chuc VALUES ('org-a', 'organization');
        INSERT INTO to_chuc VALUES ('org-b', 'organization');
        INSERT INTO thanh_vien_to_chuc VALUES ('actor', 'org-a', 'manager', NULL);
        INSERT INTO thanh_vien_to_chuc VALUES ('actor', 'org-b', 'employee', NULL);
        INSERT INTO thanh_vien_to_chuc VALUES ('target', 'org-a', 'employee', NULL);
        INSERT INTO thanh_vien_to_chuc VALUES ('target', 'org-b', 'employee', NULL);
        """
    )
    connection.commit()
    connection.close()
    return database


class _RoleRequest:
    def __init__(self, payload):
        self._payload = payload
        self.cookies = {}
        self.headers = {}
        self.client = SimpleNamespace(host="127.0.0.1")

    async def json(self):
        return self._payload


def _response_json(response):
    return json.loads(response.body.decode("utf-8"))


def _profile_database(path):
    database = SQLiteDatabase(path)
    connection = database.get_connection()
    connection.executescript(
        """
        CREATE TABLE tai_khoan (
            id TEXT PRIMARY KEY,
            ten_dang_nhap TEXT NOT NULL,
            username_norm TEXT NOT NULL UNIQUE,
            mat_khau TEXT NOT NULL,
            ho_ten TEXT NOT NULL,
            email TEXT NOT NULL,
            email_norm TEXT NOT NULL UNIQUE,
            anh_dai_dien TEXT
        );
        CREATE TABLE to_chuc (
            id TEXT PRIMARY KEY,
            ten_to_chuc TEXT NOT NULL
        );
        INSERT INTO tai_khoan VALUES (
            'actor', 'actor-name', 'actor-name', 'unused-password-hash', 'Old Name',
            'canonical@example.com', 'canonical@example.com', 'old-avatar'
        );
        INSERT INTO to_chuc VALUES ('org-a', 'Organization A');
        """
    )
    connection.commit()
    connection.close()
    return database


@pytest.mark.anyio
async def test_profile_organization_name_is_explicitly_read_only(monkeypatch, tmp_path):
    database = _profile_database(tmp_path / "profile-read-only.db")
    monkeypatch.setattr(auth_routes, "database", database)
    monkeypatch.setattr(
        auth_routes,
        "verify_session",
        lambda _request: (True, SessionRole("user", "actor")),
    )

    response = await auth_routes.update_profile_api(
        _RoleRequest({
            "name": "New Name",
            "email": "new@example.com",
            "organization_name": "Renamed Organization",
        })
    )

    payload = _response_json(response)
    assert response.status_code == 400
    assert payload["code"] == "ORGANIZATION_NAME_READ_ONLY"
    connection = database.get_connection()
    assert connection.execute("SELECT ten_to_chuc FROM to_chuc WHERE id = 'org-a'").fetchone()[0] == "Organization A"
    connection.close()


@pytest.mark.anyio
async def test_profile_update_returns_canonical_server_profile(monkeypatch, tmp_path):
    database = _profile_database(tmp_path / "profile-response.db")
    monkeypatch.setattr(auth_routes, "database", database)
    monkeypatch.setattr(
        auth_routes,
        "verify_session",
        lambda _request: (True, SessionRole("user", "actor")),
    )
    monkeypatch.setattr(auth_routes, "_session_cache_invalidate_by_user_id", lambda _user: None)

    response = await auth_routes.update_profile_api(
        _RoleRequest({
            "name": "  Canonical Name  ",
            "email": "  canonical@example.com  ",
            "avatar": "data:image/png;base64,iVBORw0KGgo=",
        })
    )

    payload = _response_json(response)
    assert response.status_code == 200
    assert payload["profile"] == {
        "username": "actor-name",
        "name": "Canonical Name",
        "email": "canonical@example.com",
        "avatar": "data:image/png;base64,iVBORw0KGgo=",
    }


@pytest.mark.anyio
async def test_global_manager_cannot_promote_member_in_other_org(monkeypatch, tmp_path):
    monkeypatch.setattr(auth_routes, "database", _role_database(tmp_path / "roles.db"))
    monkeypatch.setattr(
        auth_routes,
        "verify_session",
        lambda _request: (True, SessionRole("manager", "actor")),
    )
    monkeypatch.setattr(auth_routes, "get_active_org", lambda _request, _user: "org-b")

    response = await auth_routes.update_user_role_api(
        _RoleRequest({"user_id": "target", "role": "manager"})
    )

    assert response.status_code == 403
    assert "quản lý thành viên" in _response_json(response)["error"]


@pytest.mark.anyio
async def test_manager_cannot_promote_another_member_to_manager(monkeypatch, tmp_path):
    database = _role_database(tmp_path / "owner.db")
    monkeypatch.setattr(auth_routes, "database", database)
    monkeypatch.setattr(
        auth_routes,
        "verify_session",
        lambda _request: (True, SessionRole("manager", "actor")),
    )
    monkeypatch.setattr(auth_routes, "get_active_org", lambda _request, _user: "org-a")
    monkeypatch.setattr(auth_routes, "disconnect_user_websockets", lambda _user: None)
    monkeypatch.setattr(auth_routes, "log_audit", lambda *_args, **_kwargs: None)

    response = await auth_routes.update_user_role_api(
        _RoleRequest({"user_id": "target", "role": "manager"})
    )

    assert response.status_code == 403


def test_active_organization_context_comes_from_server_membership(monkeypatch, tmp_path):
    database = SQLiteDatabase(tmp_path / "context.db")
    connection = database.get_connection()
    connection.executescript(
        """
            CREATE TABLE to_chuc (
                id TEXT PRIMARY KEY,
                ten_to_chuc TEXT NOT NULL,
                trang_thai TEXT NOT NULL,
                scope_type TEXT NOT NULL DEFAULT 'organization'
        );
        CREATE TABLE thanh_vien_to_chuc (
            user_id TEXT NOT NULL,
            organization_id TEXT NOT NULL,
            vai_tro_trong_to_chuc TEXT NOT NULL
        );
        CREATE TABLE goi_dich_vu (
            id TEXT PRIMARY KEY,
            trang_thai TEXT NOT NULL
        );
        CREATE TABLE organization_subscriptions (
            organization_id TEXT PRIMARY KEY,
            package_id TEXT NOT NULL,
            status TEXT NOT NULL,
            expires_at INTEGER
        );
        INSERT INTO goi_dich_vu VALUES ('silver', 'active');
            INSERT INTO to_chuc (id, ten_to_chuc, trang_thai) VALUES ('org-a', 'Organization A', 'active');
        INSERT INTO organization_subscriptions VALUES ('org-a', 'silver', 'active', 4102444800);
        INSERT INTO thanh_vien_to_chuc VALUES ('user-1', 'org-a', 'employee');
        """
    )
    connection.commit()
    connection.close()
    monkeypatch.setattr(session_utils, "database", database)
    session_utils._org_cache.clear()
    request = SimpleNamespace(
        headers={"X-Active-Org": "org-a"},
        state=SimpleNamespace(),
    )

    active_org = session_utils.get_active_org(request, "user-1")

    assert active_org == "org-a"
    assert request.state.organization_context.active_org_id == "org-a"
    assert request.state.organization_context.membership_role == "employee"
    assert request.state.organization_context.organization_status == "active"

    session_utils._org_cache.clear()
    name_request = SimpleNamespace(
        headers={"X-Active-Org": "Organization A"},
        state=SimpleNamespace(),
    )
    with pytest.raises(session_utils.OrgPermissionError):
        session_utils.get_active_org(name_request, "user-1")
