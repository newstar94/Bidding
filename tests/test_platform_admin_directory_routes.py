import sqlite3

from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from backend.admin import platform_directory_routes
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


def _database():
    connection = sqlite3.connect(":memory:", check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        CREATE TABLE tai_khoan (
            id TEXT PRIMARY KEY,
            ten_dang_nhap TEXT,
            ho_ten TEXT,
            vai_tro TEXT NOT NULL,
            email TEXT NOT NULL,
            anh_dai_dien TEXT,
            trang_thai TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE to_chuc (
            id TEXT PRIMARY KEY,
            ten_to_chuc TEXT NOT NULL,
            trang_thai TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE thanh_vien_to_chuc (
            user_id TEXT NOT NULL,
            organization_id TEXT NOT NULL,
            vai_tro_trong_to_chuc TEXT NOT NULL,
            ten_nhan_su TEXT,
            so_dien_thoai TEXT,
            trang_thai_thanh_vien TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
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
        """
    )
    connection.executemany(
        """INSERT INTO tai_khoan VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)""",
        (
            ("user-3", "charlie", "Charlie", "user", "charlie@example.test", "inactive", "2026-01-03", "2026-01-03"),
            ("admin-1", "admin", "Admin", "super_admin", "admin@example.test", "active", "2026-01-01", "2026-01-01"),
            ("user-2", "bravo", "Bravo", "user", "bravo@example.test", "active", "2026-01-02", "2026-01-02"),
        ),
    )
    connection.executemany(
        "INSERT INTO to_chuc VALUES (?, ?, ?, ?, ?)",
        (
            ("org-b", "Bravo Org", "suspended", "2026-01-02", "2026-01-02"),
            ("org-a", "Alpha Org", "active", "2026-01-01", "2026-01-01"),
        ),
    )
    connection.executemany(
        "INSERT INTO thanh_vien_to_chuc VALUES (?, ?, ?, ?, ?, 'active', '2026-01-01', '2026-01-01')",
        (
            ("admin-1", "org-a", "manager", "Admin", "0901"),
            ("user-2", "org-a", "employee", "Bravo", "0902"),
            ("user-2", "org-b", "manager", "Bravo", "0902"),
        ),
    )
    connection.executemany(
        "INSERT INTO organization_subscriptions VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            ("org-a", "business", "active", 100, 4102444800, 20, 2),
            ("org-b", "starter", "expired", 100, 200, 5, 1),
        ),
    )
    connection.commit()
    return connection


def _client(monkeypatch, connection, *, allowed=True):
    role = SessionRole("super_admin", "admin-1", platform_role="super_admin")
    calls = []

    def verify_session(_request, required_role=None):
        calls.append(required_role)
        return (True, role) if allowed else (False, "denied")

    async def run_database_read(function, *args, **kwargs):
        return function(*args, **kwargs)

    monkeypatch.setattr(platform_directory_routes, "verify_session", verify_session)
    monkeypatch.setattr(platform_directory_routes, "run_database_read", run_database_read)
    monkeypatch.setattr(platform_directory_routes, "database", _DatabaseProxy(connection))
    app = Starlette(routes=platform_directory_routes.platform_admin_directory_routes(Route))
    return TestClient(app), calls


def test_users_are_server_paginated_filtered_sorted_and_include_memberships(monkeypatch):
    connection = _database()
    try:
        client, calls = _client(monkeypatch, connection)
        with client:
            response = client.get(
                "/api/admin/users?page=1&pageSize=1&status=active&role=user&sortBy=name&sortDir=desc"
            )

        assert response.status_code == 200
        assert calls == ["super_admin"]
        assert response.json() == {
            "items": [
                {
                    "id": "user-2",
                    "username": "bravo",
                    "name": "Bravo",
                    "role": "user",
                    "email": "bravo@example.test",
                    "avatar": None,
                    "status": "active",
                    "createdAt": "2026-01-02",
                    "updatedAt": "2026-01-02",
                    "organizationCount": 2,
                    "organizations": [
                        {
                            "id": "org-a",
                            "name": "Alpha Org",
                            "role": "employee",
                            "employeeName": "Bravo",
                            "employeePhone": "0902",
                            "status": "active",
                        },
                        {
                            "id": "org-b",
                            "name": "Bravo Org",
                            "role": "manager",
                            "employeeName": "Bravo",
                            "employeePhone": "0902",
                            "status": "active",
                        },
                    ],
                }
            ],
            "pagination": {"page": 1, "pageSize": 1, "totalRows": 1, "totalPages": 1},
            "sort": {"by": "name", "direction": "desc"},
            "filters": {"search": "", "role": "user", "status": "active", "organizationId": ""},
        }
    finally:
        connection.close()


def test_organizations_are_server_paginated_and_expose_real_subscription(monkeypatch):
    connection = _database()
    try:
        client, _calls = _client(monkeypatch, connection)
        with client:
            response = client.get(
                "/api/admin/organizations?search=alpha&status=active&sortBy=member_count&sortDir=desc"
            )

        assert response.status_code == 200
        payload = response.json()
        assert payload["pagination"] == {"page": 1, "pageSize": 25, "totalRows": 1, "totalPages": 1}
        assert payload["items"] == [
            {
                "id": "org-a",
                "name": "Alpha Org",
                "status": "active",
                "createdAt": "2026-01-01",
                "updatedAt": "2026-01-01",
                "memberCount": 2,
                "subscription": {
                    "packageId": "business",
                    "status": "active",
                    "startsAt": 100,
                    "expiresAt": 4102444800,
                    "memberQuota": 20,
                    "revision": 2,
                },
            }
        ]
    finally:
        connection.close()


def test_directory_routes_require_server_side_super_admin(monkeypatch):
    connection = _database()
    try:
        client, calls = _client(monkeypatch, connection, allowed=False)
        with client:
            users = client.get("/api/admin/users")
            organizations = client.get("/api/admin/organizations")

        assert users.status_code == 403
        assert organizations.status_code == 403
        assert calls == ["super_admin", "super_admin"]
    finally:
        connection.close()


def test_directory_query_allowlists_reject_unbounded_or_injected_values(monkeypatch):
    connection = _database()
    try:
        client, _calls = _client(monkeypatch, connection)
        with client:
            oversized = client.get("/api/admin/users?pageSize=101")
            injected_sort = client.get("/api/admin/organizations?sortBy=name%20DESC%3B%20DROP%20TABLE%20to_chuc")
            invalid_filter = client.get("/api/admin/users?role=manager")

        assert oversized.status_code == 400
        assert injected_sort.status_code == 400
        assert invalid_filter.status_code == 400
        assert connection.execute("SELECT count(*) FROM to_chuc").fetchone()[0] == 2
    finally:
        connection.close()
