import sqlite3

from backend.auth.auth_service import (
    activate_personal_subscription,
    build_user_access_payload,
)
from backend.auth.roles import effective_access_roles, normalize_platform_role
from backend.db.schema import SCHEMA_DINH_NGHIA


def _access_connection():
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        CREATE TABLE to_chuc (
            id TEXT PRIMARY KEY,
            ten_to_chuc TEXT NOT NULL,
            trang_thai TEXT NOT NULL,
            scope_type TEXT NOT NULL DEFAULT 'organization',
            personal_owner_user_id TEXT
        );
        CREATE TABLE thanh_vien_to_chuc (
            user_id TEXT NOT NULL,
            organization_id TEXT NOT NULL,
            vai_tro_trong_to_chuc TEXT NOT NULL
        );
        CREATE TABLE sync_metadata (
            organization_id TEXT PRIMARY KEY,
            current_version INTEGER NOT NULL
        );
        CREATE TABLE goi_dich_vu (
            id TEXT PRIMARY KEY,
            han_muc_nhan_su INTEGER NOT NULL DEFAULT 5,
            trang_thai TEXT NOT NULL
        );
        CREATE TABLE organization_subscriptions (
            organization_id TEXT PRIMARY KEY,
            package_id TEXT NOT NULL,
            status TEXT NOT NULL,
            starts_at INTEGER NOT NULL,
            expires_at INTEGER,
            member_quota INTEGER NOT NULL,
            revision INTEGER NOT NULL DEFAULT 1
        );
        INSERT INTO goi_dich_vu VALUES ('silver', 5, 'active');
        INSERT INTO to_chuc (id, ten_to_chuc, trang_thai) VALUES ('org-a', 'Công ty A, Miền Nam', 'active');
        INSERT INTO to_chuc (id, ten_to_chuc, trang_thai) VALUES ('org-b', 'Organization B', 'active');
        INSERT INTO organization_subscriptions VALUES ('org-a', 'silver', 'active', 1, 4102444800, 5, 1);
        INSERT INTO organization_subscriptions VALUES ('org-b', 'silver', 'active', 1, 4102444800, 5, 1);
        INSERT INTO thanh_vien_to_chuc VALUES ('user-1', 'org-a', 'manager');
        INSERT INTO thanh_vien_to_chuc VALUES ('user-1', 'org-b', 'employee');
        """
    )
    return connection


def test_account_schema_only_accepts_platform_roles():
    role_definition = SCHEMA_DINH_NGHIA["tai_khoan"]["columns"]["vai_tro"]

    assert "super_admin" in role_definition
    assert "user" in role_definition
    assert "manager" not in role_definition
    assert "employee" not in role_definition


def test_active_membership_controls_effective_roles():
    connection = _access_connection()
    cursor = connection.cursor()

    manager_payload = build_user_access_payload(cursor, "user-1", "user", "org-a")
    employee_payload = build_user_access_payload(cursor, "user-1", "user", "org-b")

    assert manager_payload["platform_role"] == "user"
    assert manager_payload["membership_role"] == "manager"
    assert "manager" in manager_payload["effective_roles"]
    assert employee_payload["membership_role"] == "employee"
    assert "manager" not in employee_payload["effective_roles"]
    assert employee_payload["active_org_id"] == "org-b"
    assert manager_payload["organizations"][0]["name"] == "Công ty A, Miền Nam"
    assert "organization_name" not in manager_payload


def test_legacy_business_account_role_normalizes_to_user():
    assert normalize_platform_role("manager") == "user"
    assert effective_access_roles("manager", "employee") == ["employee"]


def test_account_without_membership_has_no_organization():
    connection = _access_connection()
    cursor = connection.cursor()
    access_payload = build_user_access_payload(cursor, "user-new", "user")
    assert access_payload["active_org_id"] is None
    assert access_payload["organizations"] == []
    assert access_payload["membership_role"] is None
    assert access_payload["effective_roles"] == ["employee"]
    assert access_payload["package_id"] is None
    assert access_payload["subscription"] is None


def test_personal_workspace_is_created_only_when_a_package_is_activated(monkeypatch):
    connection = _access_connection()
    cursor = connection.cursor()
    monkeypatch.setattr("backend.auth.auth_service.stable_org_id", lambda _value: "personal-new")
    organization_id = activate_personal_subscription(
        cursor, "user-new", "New User", "silver", duration_days=30
    )
    membership = cursor.execute(
        "SELECT vai_tro_trong_to_chuc FROM thanh_vien_to_chuc WHERE user_id = 'user-new'"
    ).fetchone()
    subscription = cursor.execute(
        "SELECT package_id, status FROM organization_subscriptions WHERE organization_id = ?",
        (organization_id,),
    ).fetchone()
    access_payload = build_user_access_payload(cursor, "user-new", "user", organization_id)

    assert organization_id == "personal-new"
    assert membership[0] == "employee"
    assert tuple(subscription) == ("silver", "active")
    assert access_payload["active_org_id"] == "personal-new"
    assert access_payload["membership_role"] == "employee"
    assert access_payload["effective_roles"] == ["employee"]


def test_personal_workspace_is_never_exposed_as_an_organization():
    connection = _access_connection()
    cursor = connection.cursor()
    cursor.execute(
        "INSERT INTO to_chuc VALUES ('personal-1', 'Không gian cá nhân', 'active', 'personal', 'user-1')"
    )
    cursor.execute(
        "INSERT INTO organization_subscriptions VALUES ('personal-1', 'silver', 'active', 1, 4102444800, 5, 1)"
    )
    cursor.execute(
        "INSERT INTO thanh_vien_to_chuc VALUES ('user-1', 'personal-1', 'employee')"
    )

    payload = build_user_access_payload(cursor, "user-1", "user")

    assert payload["active_org_id"] == "org-a"
    assert {workspace["id"] for workspace in payload["organizations"]} == {"org-a", "org-b"}


def test_organization_owner_has_one_canonical_source():
    organization_columns = SCHEMA_DINH_NGHIA["to_chuc"]["columns"]

    assert "quan_ly_id" not in organization_columns
    assert "vai_tro_trong_to_chuc" in SCHEMA_DINH_NGHIA["thanh_vien_to_chuc"]["columns"]


def test_platform_admin_capabilities_do_not_depend_on_membership():
    assert effective_access_roles("super_admin", "employee")[0] == "super_admin"
