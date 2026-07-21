import asyncio
import json
import time
from types import SimpleNamespace

import pytest
from starlette.responses import JSONResponse

from backend.auth import admin_user_routes
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError
from backend.shared.helpers import OrgPermissionError


def _body(response):
    return json.loads(response.body.decode("utf-8"))


def _request(*, email="", user_id="target-user"):
    return SimpleNamespace(
        query_params={"email": email} if email else {},
        path_params={"user_id": user_id},
        headers={},
        cookies={},
        state=SimpleNamespace(),
        method="GET",
        url=SimpleNamespace(path="/api/auth/users"),
    )


def _role(user_id="actor-user"):
    return SimpleNamespace(user_id=user_id)


class _Answer:
    def __init__(self, one=None, all_rows=None):
        self.one = one
        self.all_rows = [] if all_rows is None else all_rows


class _Cursor:
    def __init__(self, handler=None):
        self.handler = handler or (lambda _sql, _params: _Answer())
        self.answer = _Answer()
        self.calls = []

    def execute(self, sql, params=()):
        normalized = " ".join(str(sql).split())
        self.calls.append((normalized, tuple(params)))
        self.answer = self.handler(normalized, tuple(params)) or _Answer()
        return self

    def fetchone(self):
        return self.answer.one

    def fetchall(self):
        return self.answer.all_rows


class _Connection:
    def __init__(self, cursor):
        self._cursor = cursor
        self.commits = 0
        self.rollbacks = 0
        self.closed = 0

    def cursor(self):
        return self._cursor

    def execute(self, sql, params=()):
        return self._cursor.execute(sql, params)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def close(self):
        self.closed += 1


def _user(user_id="target-user", *, platform_role="user"):
    return {
        "id": user_id,
        "username": user_id,
        "name": "Người dùng",
        "role": platform_role,
        "platform_role": platform_role,
        "email": f"{user_id}@example.test",
        "avatar": "",
    }


def _organization_row(**overrides):
    row = {
        "user_id": "target-user",
        "id": "org-1",
        "ten_to_chuc": "Tổ chức",
        "organization_status": "active",
        "vai_tro_trong_to_chuc": "employee",
        "ten_nhan_su": "Nhân viên",
        "so_dien_thoai": "",
        "package_id": "business",
        "subscription_status": "active",
        "starts_at": 100,
        "expires_at": int(time.time()) + 3600,
        "member_quota": 10,
        "revision": 2,
        "package_status": "active",
        "member_count": 3,
        "financial": 1,
        "identity": 0,
        "signature": 1,
        "kehoach": "edit",
        "goithau": "view",
        "chudautu": "",
        "nhathau": "",
        "chuyengia": "",
        "hopdong": "",
    }
    row.update(overrides)
    return row


def test_database_lane_responses_have_stable_codes_and_retry_header():
    request = _request()
    read_busy = admin_user_routes._database_lane_unavailable_response(request)
    read_timeout = admin_user_routes._database_lane_unavailable_response(
        request, timed_out=True
    )
    write_busy = admin_user_routes._database_lane_unavailable_response(
        request, write=True
    )

    assert [_body(item)["code"] for item in (read_busy, read_timeout, write_busy)] == [
        "DATABASE_READ_QUEUE_FULL",
        "DATABASE_READ_TIMEOUT",
        "DATABASE_WRITE_QUEUE_FULL",
    ]
    assert all(item.status_code == 503 for item in (read_busy, read_timeout, write_busy))
    assert write_busy.headers["Retry-After"] == "1"


def test_list_users_rejects_invalid_session_and_missing_requester(monkeypatch):
    monkeypatch.setattr(
        admin_user_routes, "verify_session", lambda _request: (False, "denied")
    )
    response = admin_user_routes._list_users_sync(_request())
    assert response.status_code == 403

    cursor = _Cursor(lambda _sql, _params: _Answer(one=None))
    connection = _Connection(cursor)
    monkeypatch.setattr(
        admin_user_routes, "verify_session", lambda _request: (True, _role())
    )
    monkeypatch.setattr(
        admin_user_routes.database, "get_connection", lambda: connection
    )
    response = admin_user_routes._list_users_sync(_request())
    assert response.status_code == 404
    assert connection.closed == 1


def test_list_users_super_admin_shapes_subscription_and_personal_scope(monkeypatch):
    users = [_user("admin", platform_role="super_admin"), _user()]
    organizations = [
        _organization_row(),
        _organization_row(
            id="org-2",
            package_id="expired",
            expires_at=int(time.time()) - 1,
        ),
        _organization_row(
            id="org-3",
            package_id=None,
            subscription_status=None,
            starts_at=None,
            expires_at=None,
            organization_status="suspended",
        ),
    ]

    def handler(sql, _params):
        if sql.startswith("SELECT vai_tro FROM tai_khoan"):
            return _Answer(one={"vai_tro": "super_admin"})
        if sql.startswith("SELECT id, ten_dang_nhap"):
            return _Answer(all_rows=users)
        if sql.startswith("SELECT tvtc.user_id"):
            return _Answer(all_rows=organizations)
        return _Answer()

    connection = _Connection(_Cursor(handler))
    monkeypatch.setattr(
        admin_user_routes, "verify_session", lambda _request: (True, _role("admin"))
    )
    monkeypatch.setattr(
        admin_user_routes, "get_effective_roles", lambda _role_name: {"super_admin"}
    )
    monkeypatch.setattr(
        admin_user_routes.database, "get_connection", lambda: connection
    )
    monkeypatch.setattr(
        admin_user_routes,
        "get_account_subscription",
        lambda _cursor, user_id: {"status": "active", "user": user_id},
    )

    response = admin_user_routes._list_users_sync(_request(email="TARGET@EXAMPLE.TEST"))
    payload = _body(response)
    target = next(item for item in payload if item["id"] == "target-user")
    assert response.status_code == 200
    assert len(target["organizations"]) == 4
    assert target["organizations"][0]["entitlements"]["word_export"] is True
    assert target["organizations"][1]["subscription"]["status"] == "expired"
    assert target["organizations"][2]["subscription"] is None
    assert target["organizations"][2]["status"] == "suspended"
    assert target["organizations"][-1]["name"] == "Cá nhân"
    assert payload[0]["organizations"] == []
    assert connection.closed == 1
    assert any(params == ("target@example.test",) for _, params in connection._cursor.calls)


@pytest.mark.parametrize("membership_role, expected_count", [("employee", 1), ("manager", 2)])
def test_list_users_scopes_organization_members_by_membership_role(
    monkeypatch, membership_role, expected_count
):
    users = [_user(), _user("peer-user")]

    def handler(sql, _params):
        if sql.startswith("SELECT vai_tro FROM tai_khoan"):
            return _Answer(one={"vai_tro": "user"})
        if sql.startswith("SELECT lower(trim(vai_tro_trong_to_chuc))"):
            return _Answer(one=(membership_role,))
        if "JOIN thanh_vien_to_chuc" in sql and "SELECT tvtc.user_id" not in sql:
            selected = users if membership_role == "manager" else users[:1]
            return _Answer(all_rows=selected)
        if sql.startswith("SELECT tvtc.user_id"):
            return _Answer(all_rows=[])
        return _Answer()

    connection = _Connection(_Cursor(handler))
    monkeypatch.setattr(
        admin_user_routes, "verify_session", lambda _request: (True, _role("target-user"))
    )
    monkeypatch.setattr(admin_user_routes, "get_effective_roles", lambda _role: {"user"})
    monkeypatch.setattr(admin_user_routes, "get_active_org", lambda *_args: "org-1")
    monkeypatch.setattr(
        admin_user_routes.database, "get_connection", lambda: connection
    )
    monkeypatch.setattr(
        admin_user_routes, "get_account_subscription", lambda *_args: None
    )

    response = admin_user_routes._list_users_sync(_request(email="user@example.test"))
    assert response.status_code == 200
    assert len(_body(response)) == expected_count
    assert connection.closed == 1


def test_list_users_closes_connection_on_permission_and_unexpected_errors(monkeypatch):
    connection = _Connection(_Cursor(lambda sql, _params: _Answer(
        one={"vai_tro": "user"} if sql.startswith("SELECT vai_tro") else None
    )))
    monkeypatch.setattr(
        admin_user_routes, "verify_session", lambda _request: (True, _role())
    )
    monkeypatch.setattr(admin_user_routes, "get_effective_roles", lambda _role: {"user"})
    monkeypatch.setattr(
        admin_user_routes.database, "get_connection", lambda: connection
    )
    monkeypatch.setattr(
        admin_user_routes,
        "get_active_org",
        lambda *_args: (_ for _ in ()).throw(OrgPermissionError("denied")),
    )
    response = admin_user_routes._list_users_sync(_request())
    assert response.status_code == 403
    assert connection.closed == 1

    monkeypatch.setattr(
        admin_user_routes.database,
        "get_connection",
        lambda: (_ for _ in ()).throw(RuntimeError("database down")),
    )
    monkeypatch.setattr(admin_user_routes, "log_error", lambda *_args: None)
    response = admin_user_routes._list_users_sync(_request())
    assert response.status_code == 500


@pytest.mark.parametrize(
    "payload, message",
    [
        ({}, "vai trò hệ thống"),
        ({"user_id": "u", "platform_role": "root"}, "vai trò hệ thống"),
        (
            {"user_id": "u", "platform_role": "user", "document_capabilities": []},
            "quyền xuất Word",
        ),
        (
            {
                "user_id": "u",
                "platform_role": "user",
                "document_capabilities": {"financial": 1},
            },
            "financial",
        ),
    ],
)
def test_update_access_rejects_malformed_policy_before_database(monkeypatch, payload, message):
    monkeypatch.setattr(
        admin_user_routes.database,
        "get_connection",
        lambda: pytest.fail("database must not be opened"),
    )
    response = admin_user_routes._update_user_access_settings_sync(
        _request(), "actor-user", payload
    )
    assert response.status_code == 400
    assert message in _body(response)["error"]


@pytest.mark.parametrize("permissions", [[], {}, {"kehoach": "edit"}])
def test_super_admin_cannot_change_organization_module_permissions(monkeypatch, permissions):
    monkeypatch.setattr(
        admin_user_routes.database,
        "get_connection",
        lambda: pytest.fail("database must not be opened"),
    )
    response = admin_user_routes._update_user_access_settings_sync(
        _request(),
        "actor-user",
        {"user_id": "target-user", "platform_role": "user", "permissions": permissions},
    )

    assert response.status_code == 403
    assert "Quản lý tổ chức" in _body(response)["error"]


def _valid_update(**overrides):
    payload = {
        "user_id": "target-user",
        "platform_role": "user",
        "account_package_id": "none",
        "organization_id": "",
        "organization_role": "",
        "organization_package_id": "none",
    }
    payload.update(overrides)
    return payload


@pytest.mark.parametrize(
    "scenario, expected_status",
    [
        ("missing", 404),
        ("self-role", 409),
        ("last-admin", 409),
        ("bad-account-package", 400),
        ("missing-membership", 404),
        ("bad-org-role", 400),
        ("last-manager", 409),
        ("bad-org-package", 400),
    ],
)
def test_update_access_enforces_role_package_and_membership_invariants(
    monkeypatch, scenario, expected_status
):
    def handler(sql, _params):
        if sql.startswith("SELECT vai_tro, email, ho_ten"):
            if scenario == "missing":
                return _Answer()
            role = "super_admin" if scenario in {"self-role", "last-admin"} else "user"
            return _Answer(one=(role, "target@example.test", "Target"))
        if "count(*) FROM tai_khoan" in sql:
            return _Answer(one=(1,))
        if "SELECT 1 FROM goi_dich_vu" in sql:
            return _Answer(one=None if scenario == "bad-account-package" else (1,))
        if sql.startswith("SELECT lower(trim(vai_tro_trong_to_chuc))"):
            if scenario == "missing-membership":
                return _Answer()
            return _Answer(one=("manager" if scenario == "last-manager" else "employee",))
        if "count(*) FROM thanh_vien_to_chuc" in sql:
            return _Answer(one=(1,))
        if sql.startswith("SELECT han_muc_nhan_su"):
            return _Answer(one=None if scenario == "bad-org-package" else (10,))
        return _Answer()

    connection = _Connection(_Cursor(handler))
    monkeypatch.setattr(
        admin_user_routes.database, "get_connection", lambda: connection
    )
    payload = _valid_update()
    actor = "actor-user"
    if scenario == "self-role":
        payload.update(user_id="actor-user", platform_role="user")
        actor = "actor-user"
    elif scenario == "last-admin":
        payload["platform_role"] = "user"
    elif scenario == "bad-account-package":
        payload["account_package_id"] = "invalid"
    elif scenario in {"missing-membership", "bad-org-role", "last-manager", "bad-org-package"}:
        payload.update(
            organization_id="org-1",
            organization_role="owner" if scenario == "bad-org-role" else "employee",
            organization_package_id="invalid" if scenario == "bad-org-package" else "none",
        )

    response = admin_user_routes._update_user_access_settings_sync(
        _request(), actor, payload
    )
    assert response.status_code == expected_status
    assert connection.rollbacks == 1
    assert connection.closed == 1


def test_update_access_success_updates_both_scopes_and_invalidates_members(monkeypatch):
    now = int(time.time())

    def handler(sql, _params):
        if sql.startswith("SELECT vai_tro, email, ho_ten"):
            return _Answer(one=("user", "target@example.test", "<Target>"))
        if "SELECT 1 FROM goi_dich_vu" in sql:
            return _Answer(one=(1,))
        if sql.startswith("SELECT starts_at, expires_at FROM account_subscriptions"):
            return _Answer(one=(10, now - 1))
        if sql.startswith("SELECT lower(trim(vai_tro_trong_to_chuc))"):
            return _Answer(one=("employee",))
        if sql.startswith("SELECT han_muc_nhan_su"):
            return _Answer(one=(25,))
        if sql.startswith("SELECT starts_at, expires_at FROM organization_subscriptions"):
            return _Answer(one=None)
        if sql.startswith("SELECT user_id FROM thanh_vien_to_chuc"):
            return _Answer(all_rows=[("target-user",), ("peer-user",)])
        return _Answer()

    cursor = _Cursor(handler)
    connection = _Connection(cursor)
    invalidated_sessions = []
    invalidated_orgs = []
    disconnected = []
    broadcasts = []
    audits = []
    monkeypatch.setattr(
        admin_user_routes.database, "get_connection", lambda: connection
    )
    monkeypatch.setattr(
        admin_user_routes, "log_audit", lambda event, **kwargs: audits.append((event, kwargs))
    )
    monkeypatch.setattr(
        admin_user_routes, "_session_cache_invalidate_by_user_id", invalidated_sessions.append
    )
    monkeypatch.setattr(
        admin_user_routes, "_org_cache_invalidate_by_user_id", invalidated_orgs.append
    )
    monkeypatch.setattr(admin_user_routes, "disconnect_user_websockets", disconnected.append)
    monkeypatch.setattr(
        admin_user_routes,
        "broadcast_websocket_event",
        lambda org_id, event: broadcasts.append((org_id, event)),
    )

    capabilities = {field: True for field in admin_user_routes._DOCUMENT_CAPABILITY_FIELDS}
    response = admin_user_routes._update_user_access_settings_sync(
        _request(),
        "actor-user",
        _valid_update(
            account_package_id="personal-pro",
            organization_id="org-1",
            organization_role="manager",
            organization_package_id="business",
            document_capabilities=capabilities,
        ),
    )

    assert response.status_code == 200
    assert connection.commits == 1
    assert connection.rollbacks == 0
    assert connection.closed == 1
    assert set(invalidated_sessions) == {"target-user", "peer-user"}
    assert set(invalidated_orgs) == {"target-user", "peer-user"}
    assert disconnected == ["target-user"]
    assert broadcasts == [("org-1", {"event": "user_access_settings_changed"})]
    assert audits[0][0] == "admin.user_access_settings_updated"
    assert response.background is not None
    assert any("INSERT INTO account_subscriptions" in sql for sql, _ in cursor.calls)
    assert any("INSERT INTO organization_subscriptions" in sql for sql, _ in cursor.calls)
    assert not any("ma_tran_phan_quyen" in sql for sql, _ in cursor.calls)
    assert any("INSERT INTO document_export_capabilities" in sql for sql, _ in cursor.calls)


def test_update_access_removes_subscriptions_and_rolls_back_unexpected_error(monkeypatch):
    def handler(sql, _params):
        if sql.startswith("SELECT vai_tro, email, ho_ten"):
            return _Answer(one=("user", "", "Target"))
        if sql.startswith("SELECT lower(trim(vai_tro_trong_to_chuc))"):
            return _Answer(one=("employee",))
        if sql.startswith("SELECT user_id FROM thanh_vien_to_chuc"):
            return _Answer(all_rows=[])
        return _Answer()

    cursor = _Cursor(handler)
    connection = _Connection(cursor)
    monkeypatch.setattr(
        admin_user_routes.database, "get_connection", lambda: connection
    )
    monkeypatch.setattr(admin_user_routes, "log_audit", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(admin_user_routes, "disconnect_user_websockets", lambda *_args: None)
    monkeypatch.setattr(admin_user_routes, "broadcast_websocket_event", lambda *_args: None)
    response = admin_user_routes._update_user_access_settings_sync(
        _request(),
        "actor-user",
        _valid_update(organization_id="org-1", organization_role="employee"),
    )
    assert response.status_code == 200
    assert sum("DELETE FROM" in sql for sql, _ in cursor.calls) == 2

    failing = _Connection(_Cursor(lambda *_args: (_ for _ in ()).throw(RuntimeError("boom"))))
    monkeypatch.setattr(admin_user_routes.database, "get_connection", lambda: failing)
    monkeypatch.setattr(admin_user_routes, "log_error", lambda *_args: None)
    response = admin_user_routes._update_user_access_settings_sync(
        _request(), "actor-user", _valid_update()
    )
    assert response.status_code == 500
    assert failing.rollbacks == 1
    assert failing.closed == 1


def _delete_connection(*, target_role="user", admin_count=2, sole_manager=False, personal=0):
    counts = {
        "thanh_vien_to_chuc": 2,
        "phan_cong_nhan_su": 3,
        "ma_tran_phan_quyen": 1,
        "password_reset_tokens": 4,
    }

    def handler(sql, _params):
        if sql.startswith("SELECT vai_tro FROM tai_khoan"):
            return _Answer(one=None if target_role is None else (target_role,))
        if "count(*) FROM tai_khoan" in sql:
            return _Answer(one=(admin_count,))
        if sql.startswith("SELECT membership.organization_id"):
            return _Answer(one=("org-1",) if sole_manager else None)
        if sql.startswith("SELECT COUNT(*) FROM personal_records"):
            return _Answer(one=(personal,))
        for table_name, value in counts.items():
            if f"SELECT COUNT(*) FROM {table_name}" in sql:
                return _Answer(one=(value,))
        return _Answer()

    return _Connection(_Cursor(handler))


def test_delete_user_enforces_identity_and_last_owner_invariants(monkeypatch):
    monkeypatch.setattr(admin_user_routes, "SCHEMA_DINH_NGHIA", {
        "personal_records": {"columns": {"owner_type": {}}},
        "cau_hinh_bien_word": {"columns": {"owner_type": {}}},
    })
    monkeypatch.setattr(
        admin_user_routes, "verify_session", lambda *_args, **_kwargs: (False, "denied")
    )
    assert admin_user_routes._delete_user_sync(_request()).status_code == 403

    monkeypatch.setattr(
        admin_user_routes, "verify_session", lambda *_args, **_kwargs: (True, _role("same"))
    )
    assert admin_user_routes._delete_user_sync(_request(user_id="same")).status_code == 409

    scenarios = [
        (_delete_connection(target_role=None), 404),
        (_delete_connection(target_role="super_admin", admin_count=1), 409),
        (_delete_connection(sole_manager=True), 409),
        (_delete_connection(personal=1), 409),
    ]
    monkeypatch.setattr(
        admin_user_routes, "verify_session", lambda *_args, **_kwargs: (True, _role())
    )
    for connection, expected in scenarios:
        monkeypatch.setattr(admin_user_routes.database, "get_connection", lambda c=connection: c)
        response = admin_user_routes._delete_user_sync(_request())
        assert response.status_code == expected
        assert connection.rollbacks == 1
        assert connection.closed == 1


def test_delete_user_success_reports_impact_and_invalidates_access(monkeypatch):
    connection = _delete_connection()
    invalidated = []
    audits = []
    monkeypatch.setattr(admin_user_routes, "SCHEMA_DINH_NGHIA", {
        "personal_records": {"columns": {"owner_type": {}}},
        "ignored": {"columns": {}},
        "cau_hinh_bien_word": {"columns": {"owner_type": {}}},
    })
    monkeypatch.setattr(
        admin_user_routes, "verify_session", lambda *_args, **_kwargs: (True, _role())
    )
    monkeypatch.setattr(admin_user_routes.database, "get_connection", lambda: connection)
    monkeypatch.setattr(
        admin_user_routes, "log_audit", lambda event, **kwargs: audits.append((event, kwargs))
    )
    monkeypatch.setattr(
        admin_user_routes,
        "_session_cache_invalidate_by_user_id",
        lambda user_id: invalidated.append(("session", user_id)),
    )
    monkeypatch.setattr(
        admin_user_routes,
        "_org_cache_invalidate_by_user_id",
        lambda user_id: invalidated.append(("org", user_id)),
    )
    monkeypatch.setattr(
        admin_user_routes,
        "disconnect_user_websockets",
        lambda user_id: invalidated.append(("socket", user_id)),
    )
    response = admin_user_routes._delete_user_sync(_request())
    payload = _body(response)
    assert response.status_code == 200
    assert payload["deleteImpact"]["totalCount"] == 11
    assert connection.commits == 1
    assert connection.closed == 1
    assert audits[0][0] == "admin.user_deleted"
    assert {kind for kind, _ in invalidated} == {"session", "org", "socket"}


def test_delete_user_rolls_back_unexpected_error(monkeypatch):
    connection = _Connection(
        _Cursor(lambda *_args: (_ for _ in ()).throw(RuntimeError("boom")))
    )
    monkeypatch.setattr(
        admin_user_routes, "verify_session", lambda *_args, **_kwargs: (True, _role())
    )
    monkeypatch.setattr(admin_user_routes.database, "get_connection", lambda: connection)
    monkeypatch.setattr(admin_user_routes, "log_error", lambda *_args: None)
    response = admin_user_routes._delete_user_sync(_request())
    assert response.status_code == 500
    assert connection.rollbacks == 1
    assert connection.closed == 1


@pytest.mark.parametrize("error_type", [BlockingIOBusyError, BlockingIOTimeoutError])
def test_async_route_wrappers_fail_closed_when_database_lane_is_unavailable(
    monkeypatch, error_type
):
    async def unavailable(*_args, **_kwargs):
        raise error_type("unavailable")

    monkeypatch.setattr(admin_user_routes, "run_database_read", unavailable)
    assert asyncio.run(admin_user_routes.list_users_api(_request())).status_code == 503

    monkeypatch.setattr(admin_user_routes, "run_database_write", unavailable)
    response = asyncio.run(admin_user_routes.delete_user_api(_request()))
    assert response.status_code == 503
    assert _body(response)["code"] == "DATABASE_WRITE_QUEUE_FULL"


def test_update_async_wrapper_requires_super_admin_and_valid_json(monkeypatch):
    async def denied(*_args, **_kwargs):
        return False, "denied"

    monkeypatch.setattr(admin_user_routes, "run_database_read", denied)
    response = asyncio.run(admin_user_routes.update_user_access_settings_api(_request()))
    assert response.status_code == 403

    async def allowed(*_args, **_kwargs):
        return True, _role()

    async def invalid_json(_request):
        return None, JSONResponse({"error": "invalid"}, status_code=400)

    monkeypatch.setattr(admin_user_routes, "run_database_read", allowed)
    monkeypatch.setattr(admin_user_routes, "read_json_object", invalid_json)
    response = asyncio.run(admin_user_routes.update_user_access_settings_api(_request()))
    assert response.status_code == 400


@pytest.mark.parametrize("error_type", [BlockingIOBusyError, BlockingIOTimeoutError])
def test_update_async_wrapper_handles_read_and_write_backpressure(monkeypatch, error_type):
    async def unavailable(*_args, **_kwargs):
        raise error_type("unavailable")

    monkeypatch.setattr(admin_user_routes, "run_database_read", unavailable)
    response = asyncio.run(admin_user_routes.update_user_access_settings_api(_request()))
    assert response.status_code == 503

    async def allowed(*_args, **_kwargs):
        return True, _role()

    async def valid_json(_request):
        return _valid_update(), None

    monkeypatch.setattr(admin_user_routes, "run_database_read", allowed)
    monkeypatch.setattr(admin_user_routes, "read_json_object", valid_json)
    monkeypatch.setattr(admin_user_routes, "run_database_write", unavailable)
    response = asyncio.run(admin_user_routes.update_user_access_settings_api(_request()))
    assert response.status_code == 503
    assert _body(response)["code"] == "DATABASE_WRITE_QUEUE_FULL"


def test_update_async_wrapper_dispatches_valid_payload(monkeypatch):
    actor = _role("admin")

    async def allowed(*_args, **_kwargs):
        return True, actor

    async def valid_json(_request):
        return _valid_update(), None

    async def write(function, request, actor_user_id, payload):
        assert function is admin_user_routes._update_user_access_settings_sync
        assert actor_user_id == "admin"
        assert payload["user_id"] == "target-user"
        return JSONResponse({"success": True})

    monkeypatch.setattr(admin_user_routes, "run_database_read", allowed)
    monkeypatch.setattr(admin_user_routes, "read_json_object", valid_json)
    monkeypatch.setattr(admin_user_routes, "run_database_write", write)
    response = asyncio.run(admin_user_routes.update_user_access_settings_api(_request()))
    assert response.status_code == 200
