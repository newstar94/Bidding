import json
from types import SimpleNamespace

from backend.admin import security_routes
from backend.shared import logging_utils


class _Result:
    def __init__(self, row=None, rows=None):
        self.row = row
        self.rows = rows or []

    def fetchone(self):
        return self.row

    def fetchall(self):
        return self.rows


class _Cursor:
    def __init__(self, detail_row):
        self.detail_row = detail_row
        self.calls = []
        self.result = None

    def execute(self, statement, params=()):
        self.calls.append((statement, params))
        if "COUNT(*) AS total_rows" in statement:
            self.result = _Result(row={"total_rows": 1})
        else:
            self.result = _Result(rows=[self.detail_row])
        return self

    def fetchone(self):
        return self.result.fetchone()

    def fetchall(self):
        return self.result.fetchall()


class _Connection:
    def __init__(self, cursor):
        self._cursor = cursor
        self.closed = False

    def cursor(self):
        return self._cursor

    def close(self):
        self.closed = True


class _Database:
    def __init__(self, connection):
        self.connection = connection

    def get_connection(self):
        return self.connection


def _request(**query):
    return SimpleNamespace(query_params=query)


def _payload(response):
    return json.loads(response.body)


def _allow(monkeypatch):
    monkeypatch.setattr(security_routes, "_forbidden_or_role", lambda _request: (None, "super_admin"))


def test_audit_endpoint_is_bounded_parameterized_and_excludes_sensitive_columns(monkeypatch):
    _allow(monkeypatch)
    cursor = _Cursor(
        {
            "id": 7,
            "chain_id": "global",
            "sequence": 12,
            "actor_user_id": "admin-1",
            "organization_id": "org-1",
            "action": "admin.user_updated",
            "target_type": "user",
            "target_id": "user-2",
            "created_at": "2026-09-10 08:00:00",
            "metadata_json": json.dumps({
                "requestId": "req-123",
                "reason": "approved correction for user@example.test",
                "password": "must-not-leak",
            }),
            "result": "success",
        }
    )
    connection = _Connection(cursor)
    monkeypatch.setattr(security_routes, "database", _Database(connection))

    response = security_routes._list_admin_audit_sync(
        _request(
            page="2",
            pageSize="25",
            search="user",
            action="admin.user_updated",
            targetType="user",
            actorUserId="admin-1",
            organizationId="org-1",
            result="success",
            requestId="req-123",
            **{"from": "2026-09-01", "to": "2026-09-10"},
            sortBy="sequence",
            sortDir="asc",
        )
    )
    payload = _payload(response)

    assert response.status_code == 200
    assert response.headers["cache-control"] == "private, no-store"
    assert len(cursor.calls) == 2
    assert cursor.calls[1][1][-2:] == (25, 25)
    assert "LIMIT ? OFFSET ?" in cursor.calls[1][0]
    assert "admin.user_updated" not in cursor.calls[1][0]
    assert "audit.metadata_json" in cursor.calls[1][0]
    assert "ip_address" not in cursor.calls[1][0]
    assert "entry_hash" not in cursor.calls[1][0]
    assert payload["items"][0] == {
        "id": 7,
        "chainId": "global",
        "sequence": 12,
        "actorUserId": "admin-1",
        "organizationId": "org-1",
        "action": "admin.user_updated",
        "targetType": "user",
        "targetId": "user-2",
        "createdAt": "2026-09-10 08:00:00",
        "result": "success",
        "requestId": "req-123",
        "details": {"reason": "approved correction for [REDACTED_EMAIL]"},
    }
    assert connection.closed is True


def test_session_endpoint_joins_accounts_once_and_never_selects_tokens_or_devices(monkeypatch):
    _allow(monkeypatch)
    monkeypatch.setattr(security_routes.time, "time", lambda: 2_000)
    cursor = _Cursor(
        {
            "id": "session-1",
            "user_id": "user-1",
            "created_at": 1_000,
            "last_seen_at": 1_900,
            "idle_expires_at": 2_500,
            "absolute_expires_at": 3_000,
            "revoked_at": None,
            "remember_me": 1,
            "active_role": "manager",
            "active_role_organization_id": "org-1",
            "user_name": "Minh An",
            "username": "minhan",
            "email": "an@example.test",
            "platform_role": "user",
            "account_status": "active",
        }
    )
    monkeypatch.setattr(security_routes, "database", _Database(_Connection(cursor)))

    response = security_routes._list_admin_sessions_sync(
        _request(status="active", pageSize="50", sortBy="last_seen_at")
    )
    payload = _payload(response)

    assert response.status_code == 200
    assert len(cursor.calls) == 2
    detail_sql = cursor.calls[1][0]
    assert "JOIN tai_khoan account" in detail_sql
    assert "LIMIT ? OFFSET ?" in detail_sql
    assert "token_hash" not in detail_sql
    assert "device_info" not in detail_sql
    assert "privileged_reauth_at" not in detail_sql
    assert payload["items"][0]["status"] == "active"
    assert payload["items"][0]["user"]["email"] == "an@example.test"
    assert "token" not in json.dumps(payload).lower()


def test_security_queries_reject_unknown_unbounded_or_invalid_controls(monkeypatch):
    _allow(monkeypatch)

    assert security_routes._list_admin_audit_sync(_request(pageSize="101")).status_code == 400
    assert security_routes._list_admin_audit_sync(_request(sortBy="metadata_json")).status_code == 400
    assert security_routes._list_admin_audit_sync(_request(result="unknown")).status_code == 400
    assert security_routes._list_admin_audit_sync(_request(requestId="bad request id")).status_code == 400
    assert security_routes._list_admin_audit_sync(_request(**{"from": "10/09/2026"})).status_code == 400
    assert security_routes._list_admin_audit_sync(
        _request(**{"from": "2026-09-11", "to": "2026-09-10"})
    ).status_code == 400
    assert security_routes._list_admin_sessions_sync(_request(status="unknown")).status_code == 400
    assert security_routes._list_admin_sessions_sync(_request(raw="secret")).status_code == 400


def test_security_endpoints_stop_before_queries_when_authorization_fails(monkeypatch):
    denied = security_routes._response({"error": "forbidden"}, status_code=403)
    monkeypatch.setattr(security_routes, "_forbidden_or_role", lambda _request: (denied, None))
    monkeypatch.setattr(
        security_routes,
        "database",
        SimpleNamespace(get_connection=lambda: (_ for _ in ()).throw(AssertionError())),
    )

    assert security_routes._list_admin_audit_sync(_request()).status_code == 403
    assert security_routes._list_admin_sessions_sync(_request()).status_code == 403


def test_security_routes_are_get_only():
    class _Route:
        def __init__(self, path, endpoint, methods):
            self.path = path
            self.endpoint = endpoint
            self.methods = methods

    routes = security_routes.platform_admin_security_routes(_Route)

    assert [route.path for route in routes] == [
        "/api/admin/audit",
        "/api/admin/security/sessions",
    ]
    assert all(route.methods == ["GET"] for route in routes)


def test_audit_write_adds_safe_request_correlation_without_mutating_metadata(monkeypatch):
    observed = {}
    metadata = {"reason": "approved correction"}
    request = SimpleNamespace(
        state=SimpleNamespace(request_id="req-audit-123"),
        headers={},
    )
    monkeypatch.setattr(logging_utils, "require_audit_chain_available", lambda: None)
    monkeypatch.setattr(logging_utils, "get_client_ip", lambda _request: "192.0.2.1")
    monkeypatch.setattr(
        logging_utils,
        "insert_audit_row",
        lambda _cursor, **event: observed.update(event) or 17,
    )

    result = logging_utils.log_audit(
        "admin.user_updated",
        request=request,
        metadata=metadata,
        cursor=object(),
        required=True,
    )

    assert result == 17
    assert metadata == {"reason": "approved correction"}
    assert json.loads(observed["metadata_json"]) == {
        "reason": "approved correction",
        "requestId": "req-audit-123",
    }
