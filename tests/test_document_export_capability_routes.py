import sqlite3

from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from backend.api import org_routes
from backend.auth.auth_helper import SessionRole


class _ConnectionProxy:
    def __init__(self, connection):
        self._connection = connection

    def execute(self, statement, params=()):
        return self._connection.execute(statement, params)

    def cursor(self):
        return self._connection.cursor()

    def commit(self):
        self._connection.commit()

    def rollback(self):
        self._connection.rollback()

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
            vai_tro TEXT NOT NULL
        );
        CREATE TABLE thanh_vien_to_chuc (
            user_id TEXT NOT NULL,
            organization_id TEXT NOT NULL,
            vai_tro_trong_to_chuc TEXT NOT NULL,
            trang_thai_thanh_vien TEXT NOT NULL
        );
        CREATE TABLE document_export_capabilities (
            organization_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            financial INTEGER NOT NULL,
            identity INTEGER NOT NULL,
            signature INTEGER NOT NULL,
            updated_at TEXT,
            PRIMARY KEY (organization_id, user_id)
        );
        CREATE TABLE to_chuc (
            id TEXT PRIMARY KEY,
            trang_thai TEXT NOT NULL
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
        INSERT INTO tai_khoan VALUES ('manager', 'user');
        INSERT INTO tai_khoan VALUES ('employee', 'user');
        INSERT INTO thanh_vien_to_chuc
        VALUES ('manager', 'org', 'manager', 'active');
        INSERT INTO thanh_vien_to_chuc
        VALUES ('employee', 'org', 'employee', 'active');
        INSERT INTO document_export_capabilities
        VALUES ('org', 'employee', 0, 0, 0, NULL);
        INSERT INTO to_chuc VALUES ('org', 'active');
        INSERT INTO goi_dich_vu VALUES ('plan', 'active', 1, 1, 1);
        INSERT INTO organization_subscriptions
        VALUES ('org', 'plan', 'active', 100, 4102444800, 20, 1);
        """
    )
    connection.commit()
    return connection


def _client(monkeypatch, connection):
    role = SessionRole(
        "employee",
        "manager",
        platform_role="user",
        active_role="employee",
        active_role_organization_id="org",
    )
    monkeypatch.setattr(org_routes, "verify_session", lambda _request: (True, role))
    monkeypatch.setattr(
        org_routes,
        "get_active_org",
        lambda _request, _user_id: "org",
    )
    monkeypatch.setattr(org_routes, "database", _DatabaseProxy(connection))
    monkeypatch.setattr(org_routes, "log_audit", lambda *_args, **_kwargs: None)

    def raise_route_error(_request, error, *_args, **_kwargs):
        raise error

    monkeypatch.setattr(org_routes, "log_and_error", raise_route_error)
    app = Starlette(
        routes=[
            Route(
                "/api/organizations/members/{user_id}/document-export-capabilities",
                org_routes.get_document_export_capabilities_api,
                methods=["GET"],
            ),
            Route(
                "/api/organizations/members/{user_id}/document-export-capabilities",
                org_routes.update_document_export_capabilities_api,
                methods=["PUT"],
            ),
        ]
    )
    return TestClient(app)


def test_employee_persona_cannot_read_document_export_grants(monkeypatch):
    connection = _database()
    try:
        with _client(monkeypatch, connection) as client:
            response = client.get(
                "/api/organizations/members/employee/document-export-capabilities"
            )

        assert response.status_code == 403
        assert response.json()["code"] == "DOCUMENT_EXPORT_CAPABILITY_MANAGE_FORBIDDEN"
    finally:
        connection.close()


def test_employee_persona_cannot_update_document_export_grants(monkeypatch):
    connection = _database()
    try:
        with _client(monkeypatch, connection) as client:
            response = client.put(
                "/api/organizations/members/employee/document-export-capabilities",
                json={"financial": True, "identity": True, "signature": True},
            )

        assert response.status_code == 403
        assert response.json()["code"] == "DOCUMENT_EXPORT_CAPABILITY_MANAGE_FORBIDDEN"
    finally:
        connection.close()
