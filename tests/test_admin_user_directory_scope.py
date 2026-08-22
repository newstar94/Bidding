import sqlite3

from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from backend.auth import admin_user_routes
from backend.auth.auth_helper import SessionRole


class _ConnectionProxy:
    def __init__(self, connection):
        self._connection = connection

    def cursor(self):
        return self._connection.cursor()

    def close(self):
        pass


class _DatabaseProxy:
    def __init__(self, connection):
        self._connection = connection

    def get_connection(self):
        return _ConnectionProxy(self._connection)


def _directory_database():
    connection = sqlite3.connect(":memory:", check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        CREATE TABLE tai_khoan (
            id TEXT PRIMARY KEY,
            ten_dang_nhap TEXT NOT NULL,
            ho_ten TEXT,
            vai_tro TEXT NOT NULL,
            email TEXT,
            email_norm TEXT,
            anh_dai_dien TEXT,
            trang_thai TEXT NOT NULL
        );
        CREATE TABLE to_chuc (
            id TEXT PRIMARY KEY,
            ten_to_chuc TEXT NOT NULL,
            trang_thai TEXT NOT NULL
        );
        CREATE TABLE thanh_vien_to_chuc (
            user_id TEXT NOT NULL,
            organization_id TEXT NOT NULL,
            vai_tro_trong_to_chuc TEXT NOT NULL,
            ten_nhan_su TEXT,
            so_dien_thoai TEXT,
            trang_thai_thanh_vien TEXT NOT NULL
        );
        CREATE TABLE goi_dich_vu (
            id TEXT PRIMARY KEY,
            trang_thai TEXT NOT NULL,
            document_export_word INTEGER NOT NULL,
            document_export_excel INTEGER NOT NULL,
            document_export_award_result_excel INTEGER NOT NULL
        );
        CREATE TABLE organization_subscriptions (
            organization_id TEXT PRIMARY KEY,
            package_id TEXT NOT NULL,
            status TEXT NOT NULL,
            starts_at INTEGER,
            expires_at INTEGER,
            member_quota INTEGER NOT NULL,
            revision INTEGER NOT NULL
        );
        CREATE TABLE account_subscriptions (
            user_id TEXT PRIMARY KEY,
            package_id TEXT NOT NULL,
            status TEXT NOT NULL,
            starts_at INTEGER,
            expires_at INTEGER,
            revision INTEGER NOT NULL
        );
        CREATE TABLE ma_tran_phan_quyen (
            organization_id TEXT NOT NULL,
            emp_id TEXT NOT NULL,
            kehoach TEXT,
            goithau TEXT,
            chudautu TEXT,
            nhathau TEXT,
            chuyengia TEXT,
            hopdong TEXT
        );
        CREATE TABLE document_export_capabilities (
            organization_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            financial INTEGER NOT NULL,
            identity INTEGER NOT NULL,
            signature INTEGER NOT NULL
        );
        """
    )
    connection.executemany(
        """INSERT INTO tai_khoan
               (id, ten_dang_nhap, ho_ten, vai_tro, email, email_norm,
                anh_dai_dien, trang_thai)
           VALUES (?, ?, ?, 'user', ?, ?, NULL, 'active')""",
        (
            ("manager-a", "manager-a", "Manager A", "manager-a@example.test", "manager-a@example.test"),
            ("shared-user", "shared", "Shared User", "shared@example.test", "shared@example.test"),
        ),
    )
    connection.executemany(
        "INSERT INTO to_chuc (id, ten_to_chuc, trang_thai) VALUES (?, ?, 'active')",
        (("org-a", "Organization A"), ("org-b", "Organization B")),
    )
    connection.executemany(
        """INSERT INTO thanh_vien_to_chuc
               (user_id, organization_id, vai_tro_trong_to_chuc,
                ten_nhan_su, so_dien_thoai, trang_thai_thanh_vien)
           VALUES (?, ?, ?, ?, ?, 'active')""",
        (
            ("manager-a", "org-a", "manager", "Manager A", "0900000001"),
            ("shared-user", "org-a", "employee", "Shared in A", "0900000002"),
            ("shared-user", "org-b", "manager", "Shared in B", "0900000003"),
        ),
    )
    connection.executemany(
        """INSERT INTO goi_dich_vu
               (id, trang_thai, document_export_word, document_export_excel,
                document_export_award_result_excel)
           VALUES (?, 'active', 1, 1, 1)""",
        (("org-package",), ("personal-package",)),
    )
    connection.executemany(
        """INSERT INTO organization_subscriptions
               (organization_id, package_id, status, starts_at, expires_at,
                member_quota, revision)
           VALUES (?, 'org-package', 'active', 100, 4102444800, 20, 1)""",
        (("org-a",), ("org-b",)),
    )
    connection.execute(
        """INSERT INTO account_subscriptions
               (user_id, package_id, status, starts_at, expires_at, revision)
           VALUES ('shared-user', 'personal-package', 'active', 100, 4102444800, 1)"""
    )
    connection.executemany(
        """INSERT INTO ma_tran_phan_quyen
               (organization_id, emp_id, kehoach, goithau, chudautu,
                nhathau, chuyengia, hopdong)
           VALUES (?, 'shared-user', ?, ?, ?, ?, ?, ?)""",
        (
            ("org-a", "read", "read", "", "", "", ""),
            ("org-b", "write", "write", "write", "write", "write", "write"),
        ),
    )
    connection.executemany(
        """INSERT INTO document_export_capabilities
               (organization_id, user_id, financial, identity, signature)
           VALUES (?, 'shared-user', ?, ?, ?)""",
        (("org-a", 0, 0, 0), ("org-b", 1, 1, 1)),
    )
    connection.commit()
    return connection


def _client(monkeypatch, connection, role):
    monkeypatch.setattr(
        admin_user_routes,
        "database",
        _DatabaseProxy(connection),
    )
    monkeypatch.setattr(
        admin_user_routes,
        "verify_session",
        lambda _request, required_role=None: (True, role),
    )
    monkeypatch.setattr(
        admin_user_routes,
        "get_active_org",
        lambda _request, _user_id: "org-a",
    )

    async def run_database_read(function, *args, **kwargs):
        return function(*args, **kwargs)

    monkeypatch.setattr(
        admin_user_routes,
        "run_database_read",
        run_database_read,
    )
    app = Starlette(routes=[Route("/api/auth/users", admin_user_routes.list_users_api)])
    return TestClient(app)


def test_organization_manager_directory_is_scoped_to_active_organization(monkeypatch):
    connection = _directory_database()
    role = SessionRole(
        "manager",
        "manager-a",
        platform_role="user",
        active_role="manager",
        active_role_organization_id="org-a",
    )
    try:
        with _client(monkeypatch, connection, role) as client:
            response = client.get("/api/auth/users")
        payload = response.json()
        shared_user = next(item for item in payload if item["id"] == "shared-user")

        assert response.status_code == 200
        assert [organization["id"] for organization in shared_user["organizations"]] == ["org-a"]
        assert "account_subscription" not in shared_user
        assert shared_user["organizations"][0]["permissions"]["kehoach"] == "read"
        assert shared_user["organizations"][0]["document_capabilities"] == {
            "financial": False,
            "identity": False,
            "signature": False,
        }
    finally:
        connection.close()


def test_employee_persona_does_not_expand_directory_from_manager_membership(monkeypatch):
    connection = _directory_database()
    role = SessionRole(
        "employee",
        "manager-a",
        platform_role="user",
        active_role="employee",
        active_role_organization_id="org-a",
    )
    try:
        with _client(monkeypatch, connection, role) as client:
            response = client.get("/api/auth/users")
        payload = response.json()

        assert response.status_code == 200
        assert [item["id"] for item in payload] == ["manager-a"]
        assert [organization["id"] for organization in payload[0]["organizations"]] == ["org-a"]
        assert "account_subscription" not in payload[0]
    finally:
        connection.close()
