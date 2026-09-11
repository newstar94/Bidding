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
            plan_version_id TEXT,
            status TEXT NOT NULL,
            source TEXT NOT NULL,
            starts_at INTEGER,
            expires_at INTEGER,
            member_quota INTEGER NOT NULL,
            revision INTEGER NOT NULL
        );
        CREATE TABLE account_subscriptions (
            user_id TEXT PRIMARY KEY,
            package_id TEXT NOT NULL,
            plan_version_id TEXT,
            status TEXT NOT NULL,
            source TEXT NOT NULL,
            starts_at INTEGER,
            expires_at INTEGER,
            revision INTEGER NOT NULL
        );
        CREATE TABLE auth_sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            last_seen_at INTEGER NOT NULL,
            idle_expires_at INTEGER NOT NULL,
            absolute_expires_at INTEGER NOT NULL,
            revoked_at INTEGER
        );
        CREATE TABLE product_usage_hourly (
            user_id TEXT NOT NULL,
            organization_id TEXT NOT NULL,
            event_count INTEGER NOT NULL,
            last_seen_at INTEGER NOT NULL
        );
        CREATE TABLE audit_log (
            id INTEGER PRIMARY KEY,
            actor_user_id TEXT,
            organization_id TEXT,
            action TEXT NOT NULL,
            target_type TEXT,
            target_id TEXT,
            created_at TEXT NOT NULL
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
        "INSERT INTO organization_subscriptions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            ("org-a", "business", "plan-v2", "active", "order", 100, 4102444800, 20, 2),
            ("org-b", "starter", None, "expired", "legacy", 100, 200, 5, 1),
        ),
    )
    connection.execute(
        "INSERT INTO account_subscriptions VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ("user-2", "personal", "plan-v1", "active", "admin", 100, 4102444800, 3),
    )
    connection.executemany(
        "INSERT INTO auth_sessions VALUES (?, ?, ?, ?, ?, ?)",
        (
            ("session-active", "user-2", 200, 4102444800, 4102444800, None),
            ("session-revoked", "user-2", 300, 4102444800, 4102444800, 301),
            ("session-admin", "admin-1", 150, 4102444800, 4102444800, None),
        ),
    )
    connection.executemany(
        "INSERT INTO product_usage_hourly VALUES (?, ?, ?, ?)",
        (("user-2", "org-a", 4, 240), ("user-2", "org-b", 6, 250)),
    )
    connection.executemany(
        "INSERT INTO audit_log VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            (1, "user-2", "org-a", "user.updated", "user", "user-2", "2026-02-02"),
            (2, "admin-1", "org-a", "subscription.changed", "organization", "org-a", "2026-02-03"),
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
        assert response.headers["cache-control"] == "private, no-store"
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
                    "lastActiveAt": 300,
                    "subscription": {
                        "packageId": "personal",
                        "planVersionId": "plan-v1",
                        "status": "active",
                    },
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
            "filters": {
                "search": "", "role": "user", "status": "active",
                "organizationId": "", "packageId": "", "createdFrom": "",
                "createdTo": "", "lastActiveFrom": "", "lastActiveTo": "",
            },
        }
    finally:
        connection.close()


def test_users_apply_authoritative_package_and_date_filters(monkeypatch):
    connection = _database()
    try:
        client, _calls = _client(monkeypatch, connection)
        with client:
            response = client.get(
                "/api/admin/users?packageId=personal&createdFrom=2026-01-02"
                "&createdTo=2026-01-02&lastActiveFrom=1970-01-01"
                "&lastActiveTo=1970-01-01&sortBy=last_active_at&sortDir=desc"
            )

        assert response.status_code == 200
        payload = response.json()
        assert [item["id"] for item in payload["items"]] == ["user-2"]
        assert payload["items"][0]["subscription"]["packageId"] == "personal"
        assert payload["items"][0]["lastActiveAt"] == 300
        assert payload["filters"] == {
            "search": "", "role": "", "status": "", "organizationId": "",
            "packageId": "personal", "createdFrom": "2026-01-02",
            "createdTo": "2026-01-02", "lastActiveFrom": "1970-01-01",
            "lastActiveTo": "1970-01-01",
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
        assert response.headers["cache-control"] == "private, no-store"
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
                "lastActiveAt": 240,
                "primaryContact": {
                    "id": "admin-1", "name": "Admin",
                    "email": "admin@example.test", "phone": "0901",
                    "role": "manager",
                },
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


def test_organization_primary_contact_prefers_owner_then_stable_email(monkeypatch):
    connection = _database()
    try:
        connection.executemany(
            "INSERT INTO tai_khoan VALUES (?, ?, ?, 'user', ?, NULL, 'active', '2026-01-01', '2026-01-01')",
            (
                ("owner-z", "owner-z", "Owner Z", "zulu@example.test"),
                ("owner-a", "owner-a", "Owner A", "alpha@example.test"),
            ),
        )
        connection.executemany(
            "INSERT INTO thanh_vien_to_chuc VALUES (?, 'org-a', 'owner', ?, NULL, 'active', '2026-01-01', '2026-01-01')",
            (("owner-z", "Owner Z"), ("owner-a", "Owner A")),
        )
        connection.commit()
        client, _calls = _client(monkeypatch, connection)
        with client:
            response = client.get("/api/admin/organizations?search=alpha")

        assert response.status_code == 200
        assert response.json()["items"][0]["primaryContact"] == {
            "id": "owner-a", "name": "Owner A", "email": "alpha@example.test",
            "phone": None, "role": "owner",
        }
    finally:
        connection.close()


def test_directory_routes_require_server_side_super_admin(monkeypatch):
    connection = _database()
    try:
        client, calls = _client(monkeypatch, connection, allowed=False)
        with client:
            users = client.get("/api/admin/users")
            organizations = client.get("/api/admin/organizations")
            user_detail = client.get("/api/admin/users/user-2")
            organization_detail = client.get("/api/admin/organizations/org-a")

        assert users.status_code == 403
        assert organizations.status_code == 403
        assert user_detail.status_code == 403
        assert organization_detail.status_code == 403
        assert users.headers["cache-control"] == "private, no-store"
        assert organizations.headers["cache-control"] == "private, no-store"
        assert calls == ["super_admin", "super_admin", "super_admin", "super_admin"]
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
            unknown_filter = client.get("/api/admin/users?tenantId=tenant-1")
            malformed_date = client.get("/api/admin/users?createdFrom=2026-02-30")
            reversed_dates = client.get(
                "/api/admin/users?lastActiveFrom=2026-02-02&lastActiveTo=2026-02-01"
            )

        assert oversized.status_code == 400
        assert injected_sort.status_code == 400
        assert invalid_filter.status_code == 400
        assert unknown_filter.status_code == 400
        assert malformed_date.status_code == 400
        assert reversed_dates.status_code == 400
        assert connection.execute("SELECT count(*) FROM to_chuc").fetchone()[0] == 2
    finally:
        connection.close()


def test_user_detail_returns_bounded_activity_subscription_usage_and_encoded_links(monkeypatch):
    connection = _database()
    try:
        for index in range(25):
            organization_id = f"extra-{index:02d}"
            connection.execute(
                "INSERT INTO to_chuc VALUES (?, ?, 'active', '2026-01-01', '2026-01-01')",
                (organization_id, f"Extra {index:02d}"),
            )
            connection.execute(
                "INSERT INTO thanh_vien_to_chuc VALUES (?, ?, 'employee', 'Bravo', NULL, 'active', '2026-01-01', '2026-01-01')",
                ("user-2", organization_id),
            )
        for index in range(20):
            connection.execute(
                "INSERT INTO audit_log VALUES (?, 'user-2', 'org-a', ?, 'user', 'user-2', ?)",
                (100 + index, f"user.event.{index}", f"2026-03-{index + 1:02d}"),
            )
        connection.commit()
        client, _calls = _client(monkeypatch, connection)
        with client:
            response = client.get("/api/admin/users/user-2")

        assert response.status_code == 200
        payload = response.json()
        user = payload["user"]
        assert user["lastActiveAt"] == 300
        assert user["activeSessionCount"] == 1
        assert user["subscription"] == {
            "packageId": "personal", "planVersionId": "plan-v1", "status": "active",
            "source": "admin", "startsAt": 100, "expiresAt": 4102444800,
            "memberQuota": None, "revision": 3,
        }
        assert user["organizationCount"] == 27
        assert len(user["organizations"]) == 20
        assert user["usage"] == {"eventCount": 10, "lastSeenAt": 250}
        assert len(user["recentAudit"]) == 10
        assert payload["limits"] == {"organizations": 20, "audit": 10}
    finally:
        connection.close()


def test_organization_detail_returns_primary_contact_bounded_users_usage_and_security(monkeypatch):
    connection = _database()
    try:
        connection.execute(
            "UPDATE thanh_vien_to_chuc SET vai_tro_trong_to_chuc = 'owner' "
            "WHERE user_id = 'admin-1' AND organization_id = 'org-a'"
        )
        for index in range(25):
            user_id = f"member-{index:02d}"
            connection.execute(
                "INSERT INTO tai_khoan VALUES (?, ?, ?, 'user', ?, NULL, 'active', '2026-01-01', '2026-01-01')",
                (user_id, user_id, f"Member {index:02d}", f"{user_id}@example.test"),
            )
            connection.execute(
                "INSERT INTO thanh_vien_to_chuc VALUES (?, 'org-a', 'employee', ?, NULL, 'active', '2026-01-01', '2026-01-01')",
                (user_id, f"Member {index:02d}"),
            )
        connection.commit()
        client, _calls = _client(monkeypatch, connection)
        with client:
            response = client.get("/api/admin/organizations/org-a")

        assert response.status_code == 200
        payload = response.json()
        organization = payload["organization"]
        assert organization["primaryContact"]["id"] == "admin-1"
        assert organization["primaryContact"]["role"] == "owner"
        assert organization["memberCount"] == 27
        assert len(organization["users"]) == 20
        assert organization["users"][0]["role"] == "owner"
        assert organization["subscription"]["planVersionId"] == "plan-v2"
        assert organization["usage"] == {"eventCount": 4, "lastSeenAt": 240}
        assert organization["security"] == {"activeSessionCount": 2}
        assert len(organization["recentAudit"]) == 2
        assert payload["limits"] == {"users": 20, "audit": 10}
    finally:
        connection.close()


def test_detail_routes_return_not_found_and_encode_query_link_identifiers(monkeypatch):
    connection = _database()
    try:
        connection.execute(
            "INSERT INTO tai_khoan VALUES (?, 'encoded', 'Encoded', 'user', 'encoded@example.test', NULL, 'active', '2026-01-01', '2026-01-01')",
            ("user&scope=all",),
        )
        connection.commit()
        client, _calls = _client(monkeypatch, connection)
        with client:
            missing_user = client.get("/api/admin/users/missing")
            missing_organization = client.get("/api/admin/organizations/missing")
            encoded = client.get("/api/admin/users/user%26scope%3Dall")

        assert missing_user.status_code == 404
        assert missing_organization.status_code == 404
        assert encoded.status_code == 200
        assert encoded.json()["user"]["links"]["sessions"] == "/admin/security?userId=user%26scope%3Dall"
        assert encoded.json()["user"]["links"]["audit"] == "/admin/audit?actorUserId=user%26scope%3Dall"
    finally:
        connection.close()


def test_detail_routes_keep_unexpected_database_errors_private(monkeypatch):
    connection = _database()
    try:
        client, _calls = _client(monkeypatch, connection)

        async def fail_database_read(_function, *_args, **_kwargs):
            raise RuntimeError("private database detail")

        monkeypatch.setattr(platform_directory_routes, "run_database_read", fail_database_read)
        monkeypatch.setattr(platform_directory_routes, "log_error", lambda *_args: None)
        with client:
            user = client.get("/api/admin/users/user-2")
            organization = client.get("/api/admin/organizations/org-a")

        assert user.status_code == 500
        assert organization.status_code == 500
        assert "private database detail" not in user.text
        assert "private database detail" not in organization.text
    finally:
        connection.close()
