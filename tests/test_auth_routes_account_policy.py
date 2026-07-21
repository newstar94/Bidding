import asyncio
import json
import time
from types import SimpleNamespace

import pytest
from starlette.responses import JSONResponse

from backend.auth import auth_routes
from backend.auth.auth_service import RateLimitDecision
from backend.auth.profile_validation import ProfileValidationError
from backend.db.db_helper import IntegrityError
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError
from backend.shared.helpers import OrgPermissionError


def _body(response):
    return json.loads(response.body.decode("utf-8"))


class _Role(str):
    def __new__(cls, value="user", *, user_id="user-1", session_id="session-1"):
        instance = super().__new__(cls, value)
        instance.user_id = user_id
        instance.session_id = session_id
        return instance


class _Request:
    def __init__(self, data=None, *, token="session-token", path_params=None):
        self._data = {} if data is None else data
        self.cookies = {"session_token": token} if token else {}
        self.headers = {"User-Agent": "Browser/1.0", "X-Active-Org": "org-1"}
        self.query_params = {}
        self.path_params = path_params or {}
        self.state = SimpleNamespace()
        self.method = "POST"
        self.url = SimpleNamespace(path="/api/auth/account")

    async def json(self):
        return self._data


class _Answer:
    def __init__(self, one=None, all_rows=None, rowcount=1):
        self.one = one
        self.all_rows = [] if all_rows is None else all_rows
        self.rowcount = rowcount


class _Cursor:
    def __init__(self, handler=None):
        self.handler = handler or (lambda _sql, _params: _Answer())
        self.answer = _Answer()
        self.rowcount = 1
        self.calls = []

    def execute(self, sql, params=()):
        normalized = " ".join(str(sql).split())
        self.calls.append((normalized, tuple(params)))
        self.answer = self.handler(normalized, tuple(params)) or _Answer()
        self.rowcount = self.answer.rowcount
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


def _account(**overrides):
    row = {
        "id": "user-1",
        "ten_dang_nhap": "owner",
        "mat_khau": "stored-hash",
        "ho_ten": "Owner",
        "email": "old@example.test",
        "email_norm": "old@example.test",
        "anh_dai_dien": "",
    }
    row.update(overrides)
    return row


def _install_json(monkeypatch, payload):
    async def read_json(_request):
        return payload, None

    monkeypatch.setattr(auth_routes, "read_json_object", read_json)
    monkeypatch.setattr(auth_routes, "validate_or_response", lambda *_args, **_kwargs: None)


def _allow_session(monkeypatch, role=None):
    value = role or _Role()
    monkeypatch.setattr(auth_routes, "verify_session", lambda *_args, **_kwargs: (True, value))
    return value


def _install_profile_defaults(monkeypatch, connection, payload=None):
    _allow_session(monkeypatch)
    _install_json(
        monkeypatch,
        payload or {
            "name": "New Name",
            "email": "old@example.test",
            "avatar": "",
        },
    )
    monkeypatch.setattr(
        auth_routes,
        "validate_profile_fields",
        lambda name, email, avatar: (name, email.lower(), avatar),
    )
    monkeypatch.setattr(auth_routes.database, "get_connection", lambda: connection)
    monkeypatch.setattr(auth_routes, "get_client_ip", lambda _request: "203.0.113.1")
    monkeypatch.setattr(auth_routes, "log_audit", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(auth_routes, "_session_cache_invalidate_by_user_id", lambda *_args: None)


def test_update_profile_rejects_auth_json_schema_readonly_and_profile_validation(monkeypatch):
    monkeypatch.setattr(auth_routes, "verify_session", lambda *_args: (False, "denied"))
    assert asyncio.run(auth_routes.update_profile_api(_Request())).status_code == 403

    _allow_session(monkeypatch)
    marker = JSONResponse({"error": "json"}, status_code=422)

    async def bad_json(_request):
        return None, marker

    monkeypatch.setattr(auth_routes, "read_json_object", bad_json)
    assert asyncio.run(auth_routes.update_profile_api(_Request())) is marker

    _install_json(monkeypatch, {"organization_name": "Forbidden"})
    response = asyncio.run(auth_routes.update_profile_api(_Request()))
    assert _body(response)["code"] == "ORGANIZATION_NAME_READ_ONLY"

    _install_json(monkeypatch, {"name": "A", "email": "a@example.test"})
    schema = JSONResponse({"error": "schema"}, status_code=422)
    monkeypatch.setattr(auth_routes, "validate_or_response", lambda *_args, **_kwargs: schema)
    assert asyncio.run(auth_routes.update_profile_api(_Request())) is schema

    monkeypatch.setattr(auth_routes, "validate_or_response", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        auth_routes,
        "validate_profile_fields",
        lambda *_args: (_ for _ in ()).throw(ProfileValidationError("bad", "PROFILE_BAD")),
    )
    response = asyncio.run(auth_routes.update_profile_api(_Request()))
    assert response.status_code == 400
    assert _body(response)["code"] == "PROFILE_BAD"


def test_update_profile_without_email_change_updates_name_and_avatar(monkeypatch):
    reads = 0

    def handler(sql, _params):
        nonlocal reads
        if "SELECT id, ten_dang_nhap, mat_khau" in sql:
            reads += 1
            return _Answer(one=_account())
        if sql.startswith("SELECT ten_dang_nhap AS username"):
            return _Answer(one={
                "username": "owner",
                "name": "New Name",
                "email": "old@example.test",
                "avatar": "data:image/png;base64,abc",
            })
        return _Answer()

    connection = _Connection(_Cursor(handler))
    _install_profile_defaults(
        monkeypatch,
        connection,
        {"name": "New Name", "email": "old@example.test", "avatar": "data:image/png;base64,abc"},
    )
    response = asyncio.run(auth_routes.update_profile_api(_Request()))
    assert response.status_code == 200
    assert _body(response)["profile"]["name"] == "New Name"
    assert reads == 2
    assert connection.commits == 1
    assert connection.closed == 1
    assert any("anh_dai_dien = ?" in sql for sql, _ in connection._cursor.calls)


def test_update_profile_email_change_is_reauthenticated_atomic_and_notified(monkeypatch):
    now = int(time.time())

    def handler(sql, _params):
        if "SELECT id, ten_dang_nhap, mat_khau" in sql:
            return _Answer(one=_account())
        if sql.startswith("SELECT id FROM tai_khoan WHERE email_norm"):
            return _Answer(one=None)
        if sql.startswith("SELECT user_id FROM pending_email_changes"):
            return _Answer(one=None)
        if sql.startswith("SELECT ten_dang_nhap AS username"):
            return _Answer(one={
                "username": "owner", "name": "New Name",
                "email": "old@example.test", "avatar": "",
            })
        return _Answer()

    connection = _Connection(_Cursor(handler))
    _install_profile_defaults(
        monkeypatch,
        connection,
        {
            "name": "New Name",
            "email": "new@example.test",
            "avatar": "",
            "password": "current-password",
        },
    )
    monkeypatch.setattr(auth_routes, "generate_otp", lambda: "654321")

    async def allowed(*_args, **_kwargs):
        return RateLimitDecision(True, 0, 2)

    async def cpu(*_args, **_kwargs):
        return True, "otp-hash", "replacement-hash"

    monkeypatch.setattr(auth_routes, "_get_rate_limit_decision_off_event_loop", allowed)
    monkeypatch.setattr(auth_routes, "validate_password_input", lambda value: bool(value))
    monkeypatch.setattr(auth_routes, "run_cpu_bound", cpu)
    monkeypatch.setattr(auth_routes.time, "time", lambda: now)
    response = asyncio.run(auth_routes.update_profile_api(_Request()))
    payload = _body(response)
    assert response.status_code == 200
    assert payload["emailChangePending"] is True
    assert payload["pendingEmail"] == "new@example.test"
    assert response.background is not None
    assert connection.commits == 1
    assert any("INSERT INTO pending_email_changes" in sql for sql, _ in connection._cursor.calls)
    assert any("SET mat_khau = ?" in sql for sql, _ in connection._cursor.calls)


@pytest.mark.parametrize(
    "scenario, expected_status",
    [
        ("missing-initial", 404),
        ("rate-limit", 429),
        ("missing-password", 403),
        ("bad-password", 403),
        ("missing-locked", 404),
        ("credentials-changed", 409),
        ("active-conflict", 409),
        ("pending-conflict", 409),
        ("missing-updated", 404),
    ],
)
def test_update_profile_email_change_rejects_races_and_conflicts(
    monkeypatch, scenario, expected_status
):
    account_reads = 0

    def handler(sql, _params):
        nonlocal account_reads
        if "SELECT id, ten_dang_nhap, mat_khau" in sql:
            account_reads += 1
            if scenario == "missing-initial" and account_reads == 1:
                return _Answer()
            if scenario == "missing-locked" and account_reads == 2:
                return _Answer()
            password = "changed-hash" if scenario == "credentials-changed" and account_reads == 2 else "stored-hash"
            return _Answer(one=_account(mat_khau=password))
        if sql.startswith("SELECT id FROM tai_khoan WHERE email_norm"):
            return _Answer(one=("other",) if scenario == "active-conflict" else None)
        if sql.startswith("SELECT user_id FROM pending_email_changes"):
            return _Answer(one=("other",) if scenario == "pending-conflict" else None)
        if sql.startswith("SELECT ten_dang_nhap AS username"):
            return _Answer(one=None if scenario == "missing-updated" else {"username": "owner"})
        return _Answer()

    connection = _Connection(_Cursor(handler))
    password = "" if scenario == "missing-password" else "current"
    _install_profile_defaults(
        monkeypatch,
        connection,
        {"name": "Owner", "email": "new@example.test", "avatar": "", "password": password},
    )

    async def rate(*_args, **_kwargs):
        return RateLimitDecision(scenario != "rate-limit", 5, 0)

    async def cpu(*_args, **_kwargs):
        return scenario != "bad-password", "otp-hash", None

    monkeypatch.setattr(auth_routes, "_get_rate_limit_decision_off_event_loop", rate)
    monkeypatch.setattr(auth_routes, "validate_password_input", lambda value: bool(value))
    monkeypatch.setattr(auth_routes, "generate_otp", lambda: "123456")
    monkeypatch.setattr(auth_routes, "run_cpu_bound", cpu)
    response = asyncio.run(auth_routes.update_profile_api(_Request()))
    assert response.status_code == expected_status
    assert connection.closed == 1
    if scenario in {"missing-locked", "credentials-changed", "active-conflict", "pending-conflict", "missing-updated"}:
        assert connection.rollbacks == 1


@pytest.mark.parametrize("error_type", [BlockingIOBusyError, BlockingIOTimeoutError])
def test_update_profile_password_cpu_backpressure(monkeypatch, error_type):
    connection = _Connection(_Cursor(lambda sql, _params: _Answer(
        one=_account() if "SELECT id, ten_dang_nhap, mat_khau" in sql else None
    )))
    _install_profile_defaults(
        monkeypatch,
        connection,
        {"name": "Owner", "email": "new@example.test", "password": "current"},
    )
    monkeypatch.setattr(auth_routes, "validate_password_input", lambda value: bool(value))
    monkeypatch.setattr(auth_routes, "generate_otp", lambda: "123456")

    async def allowed(*_args, **_kwargs):
        return RateLimitDecision(True, 0, 1)

    async def unavailable(*_args, **_kwargs):
        raise error_type("busy")

    monkeypatch.setattr(auth_routes, "_get_rate_limit_decision_off_event_loop", allowed)
    monkeypatch.setattr(auth_routes, "run_cpu_bound", unavailable)
    assert asyncio.run(auth_routes.update_profile_api(_Request())).status_code == 503
    assert connection.closed == 1


@pytest.mark.parametrize("kind", ["known-integrity", "unknown-integrity", "runtime"])
def test_update_profile_masks_database_failures(monkeypatch, kind):
    error = IntegrityError("conflict") if "integrity" in kind else RuntimeError("secret")
    monkeypatch.setattr(auth_routes, "verify_session", lambda *_args: (_ for _ in ()).throw(error))
    monkeypatch.setattr(
        auth_routes,
        "identity_conflict_code",
        lambda _exc: "EMAIL_ALREADY_EXISTS" if kind == "known-integrity" else None,
    )
    monkeypatch.setattr(auth_routes, "log_error", lambda *_args: None)
    response = asyncio.run(auth_routes.update_profile_api(_Request()))
    assert response.status_code == (409 if "integrity" in kind else 500)


def _email_change(**overrides):
    row = {
        "user_id": "user-1",
        "current_email_norm": "old@example.test",
        "pending_email": "new@example.test",
        "pending_email_norm": "new@example.test",
        "otp_hash": "otp-hash",
        "requested_at": 100,
        "expires_at": 10_000,
        "current_email": "old@example.test",
        "account_email_norm": "old@example.test",
    }
    row.update(overrides)
    return row


def _install_verify_email_defaults(monkeypatch, connection, *, code="123456"):
    _allow_session(monkeypatch)
    _install_json(monkeypatch, {"code": code})
    monkeypatch.setattr(auth_routes, "get_client_ip", lambda _request: "203.0.113.1")

    async def allowed(*_args, **_kwargs):
        return RateLimitDecision(True, 0, 3)

    async def cpu(*_args, **_kwargs):
        return True

    monkeypatch.setattr(auth_routes, "_get_rate_limit_decision_off_event_loop", allowed)
    monkeypatch.setattr(auth_routes, "run_cpu_bound", cpu)
    monkeypatch.setattr(auth_routes.database, "get_connection", lambda: connection)
    monkeypatch.setattr(auth_routes.time, "time", lambda: 1_000)
    monkeypatch.setattr(auth_routes, "log_audit", lambda *_args, **_kwargs: None)


def test_verify_email_change_rejects_auth_json_schema_rate_limit_and_format(monkeypatch):
    monkeypatch.setattr(auth_routes, "verify_session", lambda *_args: (False, "denied"))
    assert asyncio.run(auth_routes.verify_email_change_api(_Request())).status_code == 403

    _allow_session(monkeypatch)
    marker = JSONResponse({"error": "json"}, status_code=422)

    async def bad_json(_request):
        return None, marker

    monkeypatch.setattr(auth_routes, "read_json_object", bad_json)
    assert asyncio.run(auth_routes.verify_email_change_api(_Request())) is marker

    _install_json(monkeypatch, {"code": "123456"})
    schema = JSONResponse({"error": "schema"}, status_code=422)
    monkeypatch.setattr(auth_routes, "validate_or_response", lambda *_args, **_kwargs: schema)
    assert asyncio.run(auth_routes.verify_email_change_api(_Request())) is schema

    monkeypatch.setattr(auth_routes, "validate_or_response", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(auth_routes, "get_client_ip", lambda _request: "ip")

    async def denied(*_args, **_kwargs):
        return RateLimitDecision(False, 8, 0)

    monkeypatch.setattr(auth_routes, "_get_rate_limit_decision_off_event_loop", denied)
    monkeypatch.setattr(auth_routes, "log_audit", lambda *_args, **_kwargs: None)
    assert asyncio.run(auth_routes.verify_email_change_api(_Request())).status_code == 429

    async def allowed(*_args, **_kwargs):
        return RateLimitDecision(True, 0, 3)

    monkeypatch.setattr(auth_routes, "_get_rate_limit_decision_off_event_loop", allowed)
    _install_json(monkeypatch, {"code": "abcdef"})
    response = asyncio.run(auth_routes.verify_email_change_api(_Request()))
    assert _body(response)["code"] == "EMAIL_CHANGE_OTP_INVALID"


@pytest.mark.parametrize(
    "scenario, expected_status, expected_code",
    [
        ("missing", 400, "EMAIL_CHANGE_NOT_PENDING"),
        ("expired-initial", 400, "EMAIL_CHANGE_OTP_EXPIRED"),
        ("bad-otp", 400, "EMAIL_CHANGE_OTP_INVALID"),
        ("locked-missing", 409, "EMAIL_CHANGE_NOT_PENDING"),
        ("replaced", 409, "EMAIL_CHANGE_REQUEST_REPLACED"),
        ("expired-locked", 400, "EMAIL_CHANGE_OTP_EXPIRED"),
        ("stale", 409, "EMAIL_CHANGE_REQUEST_STALE"),
        ("conflict", 409, "EMAIL_ALREADY_EXISTS"),
        ("verify-race", 409, "EMAIL_CHANGE_NOT_PENDING"),
        ("update-race", 409, "EMAIL_CHANGE_REQUEST_STALE"),
    ],
)
def test_verify_email_change_rejects_expiry_replay_and_races(
    monkeypatch, scenario, expected_status, expected_code
):
    change_reads = 0

    def handler(sql, _params):
        nonlocal change_reads
        if sql.startswith("SELECT change.user_id"):
            change_reads += 1
            if scenario == "missing" and change_reads == 1:
                return _Answer()
            if scenario == "locked-missing" and change_reads == 2:
                return _Answer()
            overrides = {}
            if scenario == "expired-initial" and change_reads == 1:
                overrides["expires_at"] = 999
            if scenario == "replaced" and change_reads == 2:
                overrides["otp_hash"] = "replacement"
            if scenario == "expired-locked" and change_reads == 2:
                overrides["expires_at"] = 999
            if scenario == "stale" and change_reads == 2:
                overrides["account_email_norm"] = "other@example.test"
            return _Answer(one=_email_change(**overrides))
        if sql.startswith("SELECT id FROM tai_khoan WHERE email_norm"):
            return _Answer(one=("other",) if scenario == "conflict" else None)
        if sql.startswith("SELECT organization_id"):
            return _Answer(all_rows=[])
        if sql.startswith("UPDATE pending_email_changes"):
            return _Answer(rowcount=0 if scenario == "verify-race" else 1)
        if sql.startswith("UPDATE tai_khoan"):
            return _Answer(rowcount=0 if scenario == "update-race" else 1)
        return _Answer()

    connection = _Connection(_Cursor(handler))
    _install_verify_email_defaults(monkeypatch, connection)

    async def cpu(*_args, **_kwargs):
        return scenario != "bad-otp"

    monkeypatch.setattr(auth_routes, "run_cpu_bound", cpu)
    response = asyncio.run(auth_routes.verify_email_change_api(_Request()))
    assert response.status_code == expected_status
    assert _body(response)["code"] == expected_code
    assert connection.closed == 1


@pytest.mark.parametrize("error_type", [BlockingIOBusyError, BlockingIOTimeoutError])
def test_verify_email_change_cpu_backpressure(monkeypatch, error_type):
    connection = _Connection(_Cursor(lambda sql, _params: _Answer(
        one=_email_change() if sql.startswith("SELECT change.user_id") else None
    )))
    _install_verify_email_defaults(monkeypatch, connection)

    async def unavailable(*_args, **_kwargs):
        raise error_type("busy")

    monkeypatch.setattr(auth_routes, "run_cpu_bound", unavailable)
    assert asyncio.run(auth_routes.verify_email_change_api(_Request())).status_code == 503
    assert connection.closed == 1


def test_verify_email_change_success_revokes_sessions_and_broadcasts(monkeypatch):
    def handler(sql, _params):
        if sql.startswith("SELECT change.user_id"):
            return _Answer(one=_email_change())
        if sql.startswith("SELECT id FROM tai_khoan WHERE email_norm"):
            return _Answer(one=None)
        if sql.startswith("SELECT organization_id"):
            return _Answer(all_rows=[("org-1",), ("org-2",)])
        return _Answer(rowcount=1)

    connection = _Connection(_Cursor(handler))
    _install_verify_email_defaults(monkeypatch, connection)
    events = []
    monkeypatch.setattr(
        auth_routes, "revoke_user_sessions", lambda *args, **kwargs: events.append("revoke")
    )
    monkeypatch.setattr(
        auth_routes, "_session_cache_invalidate_by_user_id", lambda user_id: events.append(("cache", user_id))
    )
    monkeypatch.setattr(
        auth_routes, "disconnect_user_websockets", lambda user_id: events.append(("socket", user_id))
    )
    monkeypatch.setattr(
        auth_routes,
        "broadcast_websocket_event",
        lambda org_id, payload: events.append((org_id, payload)),
    )
    response = asyncio.run(auth_routes.verify_email_change_api(_Request()))
    assert response.status_code == 200
    assert _body(response)["reauthenticationRequired"] is True
    assert "session_token=" in response.headers["set-cookie"]
    assert connection.commits == 1
    assert "revoke" in events
    assert {item[0] for item in events if isinstance(item, tuple) and item[0].startswith("org-")} == {"org-1", "org-2"}


@pytest.mark.parametrize("kind", ["known-integrity", "unknown-integrity", "runtime"])
def test_verify_email_change_masks_database_failures(monkeypatch, kind):
    error = IntegrityError("conflict") if "integrity" in kind else RuntimeError("secret")
    _allow_session(monkeypatch)
    _install_json(monkeypatch, {"code": "123456"})
    monkeypatch.setattr(auth_routes, "get_client_ip", lambda _request: (_ for _ in ()).throw(error))
    monkeypatch.setattr(
        auth_routes,
        "identity_conflict_code",
        lambda _exc: "EMAIL_ALREADY_EXISTS" if kind == "known-integrity" else None,
    )
    monkeypatch.setattr(auth_routes, "log_error", lambda *_args: None)
    response = asyncio.run(auth_routes.verify_email_change_api(_Request()))
    assert response.status_code == (409 if "integrity" in kind else 500)


def _install_change_password_defaults(monkeypatch, connection, payload=None):
    _allow_session(monkeypatch)
    _install_json(
        monkeypatch,
        payload or {"old_password": "current-password", "new_password": "new-password"},
    )
    monkeypatch.setattr(auth_routes, "validate_password_input", lambda value: bool(value))
    monkeypatch.setattr(auth_routes, "validate_new_password", lambda value: (bool(value), "weak"))
    monkeypatch.setattr(auth_routes.database, "get_connection", lambda: connection)
    monkeypatch.setattr(auth_routes, "log_audit", lambda *_args, **_kwargs: None)


def test_change_password_rejects_auth_json_schema_and_policy(monkeypatch):
    monkeypatch.setattr(auth_routes, "verify_session", lambda *_args: (False, "denied"))
    assert asyncio.run(auth_routes.change_password_api(_Request())).status_code == 403
    _allow_session(monkeypatch)
    marker = JSONResponse({"error": "json"}, status_code=422)

    async def bad_json(_request):
        return None, marker

    monkeypatch.setattr(auth_routes, "read_json_object", bad_json)
    assert asyncio.run(auth_routes.change_password_api(_Request())) is marker
    _install_json(monkeypatch, {})
    schema = JSONResponse({"error": "schema"}, status_code=422)
    monkeypatch.setattr(auth_routes, "validate_or_response", lambda *_args, **_kwargs: schema)
    assert asyncio.run(auth_routes.change_password_api(_Request())) is schema
    monkeypatch.setattr(auth_routes, "validate_or_response", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(auth_routes, "validate_password_input", lambda _value: False)
    assert asyncio.run(auth_routes.change_password_api(_Request())).status_code == 400
    _install_json(monkeypatch, {"old_password": "old", "new_password": "weak"})
    monkeypatch.setattr(auth_routes, "validate_password_input", lambda _value: True)
    monkeypatch.setattr(auth_routes, "validate_new_password", lambda _value: (False, "weak"))
    response = asyncio.run(auth_routes.change_password_api(_Request()))
    assert _body(response)["code"] == "PASSWORD_POLICY_FAILED"


def test_change_password_success_rotates_session_atomically(monkeypatch):
    connection = _Connection(_Cursor(lambda sql, _params: _Answer(
        one={
            "mat_khau": "stored", "id": "user-1",
            "email": "owner@example.test", "ho_ten": "Owner",
        } if sql.startswith("SELECT mat_khau") else None
    )))
    _install_change_password_defaults(monkeypatch, connection)

    async def cpu(*_args, **_kwargs):
        return True, "new-hash"

    events = []
    monkeypatch.setattr(auth_routes, "run_cpu_bound", cpu)
    monkeypatch.setattr(auth_routes.uuid, "uuid4", lambda: "new-token")
    monkeypatch.setattr(auth_routes, "revoke_user_sessions", lambda *_args: events.append("revoke"))
    monkeypatch.setattr(auth_routes, "create_session", lambda *_args, **_kwargs: events.append("create"))
    monkeypatch.setattr(auth_routes, "_session_cache_invalidate", lambda token: events.append(("cache", token)))
    monkeypatch.setattr(auth_routes, "disconnect_user_websockets", lambda user_id: events.append(("socket", user_id)))
    response = asyncio.run(auth_routes.change_password_api(_Request()))
    assert response.status_code == 200
    assert connection.commits == 1
    assert connection.closed == 1
    assert {"revoke", "create"}.issubset(events)
    assert "session_token=new-token" in response.headers["set-cookie"]
    assert response.background is not None


@pytest.mark.parametrize("scenario", ["missing", "bad-old", "cpu-busy", "runtime"])
def test_change_password_handles_missing_user_bad_password_and_failures(monkeypatch, scenario):
    def handler(sql, _params):
        if scenario == "runtime":
            raise RuntimeError("boom")
        if sql.startswith("SELECT mat_khau"):
            return _Answer(one=None if scenario == "missing" else {
                "mat_khau": "stored", "id": "user-1", "email": "", "ho_ten": "Owner"
            })
        return _Answer()

    connection = _Connection(_Cursor(handler))
    _install_change_password_defaults(monkeypatch, connection)
    monkeypatch.setattr(auth_routes, "log_error", lambda *_args: None)

    async def cpu(*_args, **_kwargs):
        if scenario == "cpu-busy":
            raise BlockingIOTimeoutError("busy")
        return scenario != "bad-old", "new-hash"

    monkeypatch.setattr(auth_routes, "run_cpu_bound", cpu)
    response = asyncio.run(auth_routes.change_password_api(_Request()))
    assert response.status_code == (503 if scenario == "cpu-busy" else 500 if scenario == "runtime" else 400)
    assert connection.closed == 1
    if scenario == "runtime":
        assert connection.rollbacks == 1


def test_logout_revokes_server_session_audits_and_always_clears_cookies(monkeypatch):
    connection = _Connection(_Cursor())
    events = []
    monkeypatch.setattr(auth_routes.database, "get_connection", lambda: connection)
    monkeypatch.setattr(auth_routes, "revoke_session", lambda _cursor, token: "user-1")
    monkeypatch.setattr(auth_routes, "_session_cache_invalidate", lambda token: events.append(("cache", token)))
    monkeypatch.setattr(auth_routes, "disconnect_user_websockets", lambda user_id: events.append(("socket", user_id)))
    monkeypatch.setattr(auth_routes, "log_audit", lambda event, **kwargs: events.append((event, kwargs)))
    response = asyncio.run(auth_routes.logout_api(_Request()))
    assert response.status_code == 200
    assert connection.commits == 1
    assert connection.closed == 1
    audit = next(value for key, value in events if key == "auth.logout")
    assert audit["actor_user_id"] == "user-1"
    assert audit["required"] is True
    assert "session_token=" in response.headers.getlist("set-cookie")[0]

    events.clear()
    response = asyncio.run(auth_routes.logout_api(_Request(token="")))
    assert response.status_code == 200
    assert next(value for key, value in events if key == "auth.logout")["actor_user_id"] is None


def test_logout_masks_storage_failure_but_clears_client_cookie(monkeypatch):
    monkeypatch.setattr(auth_routes, "_session_cache_invalidate", lambda _token: None)
    monkeypatch.setattr(
        auth_routes.database,
        "get_connection",
        lambda: (_ for _ in ()).throw(RuntimeError("database down")),
    )
    monkeypatch.setattr(auth_routes, "log_error", lambda *_args: None)
    response = asyncio.run(auth_routes.logout_api(_Request()))
    assert response.status_code == 200
    assert "session_token=" in response.headers.getlist("set-cookie")[0]


def _install_reauth_defaults(monkeypatch, connection, *, password="correct"):
    role = _allow_session(monkeypatch)
    _install_json(monkeypatch, {"password": password})
    monkeypatch.setattr(auth_routes, "get_client_ip", lambda _request: "203.0.113.1")

    async def allowed(*_args, **_kwargs):
        return RateLimitDecision(True, 0, 3)

    monkeypatch.setattr(auth_routes, "_get_rate_limit_decision_off_event_loop", allowed)
    monkeypatch.setattr(auth_routes.database, "get_connection", lambda: connection)
    monkeypatch.setattr(auth_routes, "get_effective_roles", lambda value: {str(value)})
    monkeypatch.setattr(auth_routes, "log_audit", lambda *_args, **_kwargs: None)
    return role


def test_privileged_reauth_success_is_atomic_and_invalidates_cached_session(monkeypatch):
    cursor = _Cursor(lambda sql, _params: _Answer(one={
        "id": "user-1", "vai_tro": "user", "mat_khau": "stored"
    } if sql.startswith("SELECT id, vai_tro") else None))
    connection = _Connection(cursor)
    _install_reauth_defaults(monkeypatch, connection)

    async def cpu(*_args, **_kwargs):
        return True

    audits = []
    monkeypatch.setattr(auth_routes, "run_cpu_bound", cpu)
    monkeypatch.setattr(auth_routes, "set_session_reauthentication", lambda *_args: True)
    monkeypatch.setattr(auth_routes, "clear_rate_limit_buckets", lambda *_args: None)
    monkeypatch.setattr(auth_routes, "_session_cache_invalidate_by_user_id", lambda *_args: None)
    monkeypatch.setattr(auth_routes, "log_audit", lambda event, **kwargs: audits.append((event, kwargs)))
    response = asyncio.run(auth_routes.privileged_reauth_api(_Request()))
    assert response.status_code == 200
    assert connection.commits == 1
    assert audits[-1][1]["required"] is True
    assert audits[-1][1]["cursor"] is cursor


@pytest.mark.parametrize(
    "scenario, expected_status",
    [
        ("auth", 403),
        ("rate", 429),
        ("json", 422),
        ("schema", 422),
        ("missing-user", 403),
        ("controls", 403),
        ("bad-password", 400),
        ("session-gone", 403),
        ("cpu-busy", 503),
        ("runtime", 500),
    ],
)
def test_privileged_reauth_rejects_unsafe_states(monkeypatch, scenario, expected_status):
    if scenario == "auth":
        monkeypatch.setattr(auth_routes, "verify_session", lambda *_args: (False, "denied"))
        assert asyncio.run(auth_routes.privileged_reauth_api(_Request())).status_code == 403
        return

    row = {
        "id": "user-1",
        "vai_tro": "super_admin" if scenario == "controls" else "user",
        "mat_khau": "stored",
    }

    def handler(sql, _params):
        if scenario == "runtime":
            raise RuntimeError("boom")
        if sql.startswith("SELECT id, vai_tro"):
            return _Answer(one=None if scenario == "missing-user" else row)
        return _Answer()

    connection = _Connection(_Cursor(handler))
    _install_reauth_defaults(monkeypatch, connection, password="" if scenario == "bad-password" else "correct")
    monkeypatch.setattr(auth_routes, "log_error", lambda *_args: None)
    if scenario == "rate":
        async def denied(*_args, **_kwargs):
            return RateLimitDecision(False, 5, 0)
        monkeypatch.setattr(auth_routes, "_get_rate_limit_decision_off_event_loop", denied)
    if scenario == "json":
        async def bad_json(_request):
            return None, JSONResponse({"error": "json"}, status_code=422)
        monkeypatch.setattr(auth_routes, "read_json_object", bad_json)
    if scenario == "schema":
        monkeypatch.setattr(
            auth_routes,
            "validate_or_response",
            lambda *_args, **_kwargs: JSONResponse({"error": "schema"}, status_code=422),
        )
    monkeypatch.setattr(auth_routes, "_load_user_by_session_token", lambda _token: {})
    monkeypatch.setattr(
        auth_routes,
        "verify_super_admin_controls",
        lambda *_args, **_kwargs: (False, "controls required") if scenario == "controls" else (True, ""),
    )

    async def cpu(*_args, **_kwargs):
        if scenario == "cpu-busy":
            raise BlockingIOBusyError("busy")
        return scenario != "bad-password"

    monkeypatch.setattr(auth_routes, "run_cpu_bound", cpu)
    monkeypatch.setattr(
        auth_routes,
        "set_session_reauthentication",
        lambda *_args: scenario != "session-gone",
    )
    monkeypatch.setattr(auth_routes, "clear_rate_limit_buckets", lambda *_args: None)
    monkeypatch.setattr(auth_routes, "_session_cache_invalidate_by_user_id", lambda *_args: None)
    response = asyncio.run(auth_routes.privileged_reauth_api(_Request()))
    assert response.status_code == expected_status
    if connection.closed:
        assert connection.closed == 1


def _install_role_update_defaults(monkeypatch, connection, payload, *, actor_role="super_admin"):
    role = _Role(actor_role, user_id="actor-user")
    _allow_session(monkeypatch, role)
    _install_json(monkeypatch, payload)
    monkeypatch.setattr(auth_routes, "get_effective_roles", lambda value: {str(value)})
    monkeypatch.setattr(auth_routes, "_load_user_by_session_token", lambda _token: {})
    monkeypatch.setattr(auth_routes, "verify_super_admin_controls", lambda *_args, **_kwargs: (True, ""))
    monkeypatch.setattr(auth_routes, "verify_recent_reauthentication", lambda *_args: (True, ""))
    monkeypatch.setattr(auth_routes.database, "get_connection", lambda: connection)
    monkeypatch.setattr(auth_routes, "log_audit", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(auth_routes, "_session_cache_invalidate_by_user_id", lambda *_args: None)
    monkeypatch.setattr(auth_routes, "_org_cache_invalidate_by_user_id", lambda *_args: None)
    monkeypatch.setattr(auth_routes, "disconnect_user_websockets", lambda *_args: None)


def test_update_platform_role_success_and_last_admin_protection(monkeypatch):
    def handler(sql, _params):
        if sql.startswith("SELECT email, ho_ten"):
            return _Answer(one=("target@example.test", "Target"))
        if sql.startswith("SELECT 1 FROM tai_khoan"):
            return _Answer(one=(1,))
        if sql.startswith("SELECT vai_tro FROM tai_khoan"):
            return _Answer(one=("user",))
        return _Answer()

    connection = _Connection(_Cursor(handler))
    _install_role_update_defaults(
        monkeypatch,
        connection,
        {"user_id": "target-user", "role": "super_admin", "scope": "platform"},
    )
    response = asyncio.run(auth_routes.update_user_role_api(_Request()))
    assert response.status_code == 200
    assert connection.commits == 1
    assert response.background is None

    def last_admin(sql, _params):
        if sql.startswith("SELECT email, ho_ten"):
            return _Answer(one=("target@example.test", "Target"))
        if sql.startswith("SELECT 1 FROM tai_khoan"):
            return _Answer(one=(1,))
        if sql.startswith("SELECT vai_tro FROM tai_khoan"):
            return _Answer(one=("super_admin",))
        if "count(*) FROM tai_khoan" in sql:
            return _Answer(one=(1,))
        return _Answer()

    connection = _Connection(_Cursor(last_admin))
    _install_role_update_defaults(
        monkeypatch,
        connection,
        {"user_id": "target-user", "role": "user", "scope": "platform"},
    )
    assert asyncio.run(auth_routes.update_user_role_api(_Request())).status_code == 409
    assert connection.rollbacks == 1


@pytest.mark.parametrize(
    "scenario, expected_status",
    [
        ("not-admin-platform", 403),
        ("bad-platform-role", 400),
        ("self-platform", 409),
        ("missing-platform", 404),
        ("personal", 409),
        ("not-manager", 403),
        ("bad-org-role", 400),
        ("missing-member", 404),
        ("self-org", 409),
        ("hierarchy", 403),
        ("last-manager", 409),
        ("bad-scope", 400),
    ],
)
def test_update_user_role_enforces_scope_and_hierarchy(monkeypatch, scenario, expected_status):
    scope = "platform" if scenario in {"not-admin-platform", "bad-platform-role", "self-platform", "missing-platform"} else (
        "invalid" if scenario == "bad-scope" else "organization"
    )
    actor_role = "user" if scenario in {"not-admin-platform", "not-manager", "hierarchy"} else "super_admin"
    user_id = "actor-user" if scenario in {"self-platform", "self-org"} else "target-user"
    new_role = "owner" if scenario in {"bad-platform-role", "bad-org-role"} else (
        "user" if scenario in {"self-platform", "missing-platform"} else
        "employee" if scenario in {"self-org", "last-manager"} else "manager"
    )
    membership_reads = 0

    def handler(sql, _params):
        nonlocal membership_reads
        if sql.startswith("SELECT email, ho_ten"):
            return _Answer(one=("target@example.test", "Target"))
        if sql.startswith("SELECT 1 FROM tai_khoan"):
            return _Answer(one=None if scenario == "missing-platform" else (1,))
        if sql.startswith("SELECT lower(trim(vai_tro_trong_to_chuc))"):
            membership_reads += 1
            if membership_reads == 1:
                return _Answer(one=("employee" if scenario == "not-manager" else "manager",))
            if scenario == "missing-member":
                return _Answer()
            target = "manager" if scenario in {"self-org", "hierarchy", "last-manager"} else "employee"
            return _Answer(one=(target,))
        if "count(*) FROM thanh_vien_to_chuc" in sql:
            return _Answer(one=(1,))
        return _Answer()

    connection = _Connection(_Cursor(handler))
    _install_role_update_defaults(
        monkeypatch,
        connection,
        {"user_id": user_id, "role": new_role, "scope": scope},
        actor_role=actor_role,
    )
    monkeypatch.setattr(auth_routes, "get_active_org", lambda *_args: "org-1")
    monkeypatch.setattr(
        auth_routes,
        "is_business_organization",
        lambda *_args: scenario != "personal",
    )
    response = asyncio.run(auth_routes.update_user_role_api(_Request()))
    assert response.status_code == expected_status
    if connection.closed:
        assert connection.closed == 1


def test_update_organization_role_success_and_error_boundaries(monkeypatch):
    membership_reads = 0

    def handler(sql, _params):
        nonlocal membership_reads
        if sql.startswith("SELECT email, ho_ten"):
            return _Answer(one=None)
        if sql.startswith("SELECT lower(trim(vai_tro_trong_to_chuc))"):
            membership_reads += 1
            return _Answer(one=("manager" if membership_reads == 1 else "employee",))
        return _Answer()

    connection = _Connection(_Cursor(handler))
    _install_role_update_defaults(
        monkeypatch,
        connection,
        {"user_id": "target-user", "role": "manager", "scope": "organization"},
    )
    monkeypatch.setattr(auth_routes, "get_active_org", lambda *_args: "org-1")
    monkeypatch.setattr(auth_routes, "is_business_organization", lambda *_args: True)
    assert asyncio.run(auth_routes.update_user_role_api(_Request())).status_code == 200

    # Missing recent reauthentication is rejected before opening a connection.
    connection2 = _Connection(_Cursor())
    _install_role_update_defaults(
        monkeypatch,
        connection2,
        {"user_id": "target-user", "role": "employee", "scope": "organization"},
        actor_role="user",
    )
    monkeypatch.setattr(auth_routes, "verify_recent_reauthentication", lambda *_args: (False, "reauth"))
    assert asyncio.run(auth_routes.update_user_role_api(_Request())).status_code == 403
    assert connection2.closed == 0


def test_update_user_role_rejects_auth_json_schema_controls_and_malformed_role(monkeypatch):
    monkeypatch.setattr(auth_routes, "verify_session", lambda *_args: (False, "denied"))
    assert asyncio.run(auth_routes.update_user_role_api(_Request())).status_code == 403
    _allow_session(monkeypatch)
    marker = JSONResponse({"error": "json"}, status_code=422)

    async def bad_json(_request):
        return None, marker

    monkeypatch.setattr(auth_routes, "read_json_object", bad_json)
    assert asyncio.run(auth_routes.update_user_role_api(_Request())) is marker
    _install_json(monkeypatch, {})
    schema = JSONResponse({"error": "schema"}, status_code=422)
    monkeypatch.setattr(auth_routes, "validate_or_response", lambda *_args, **_kwargs: schema)
    assert asyncio.run(auth_routes.update_user_role_api(_Request())) is schema
    monkeypatch.setattr(auth_routes, "validate_or_response", lambda *_args, **_kwargs: None)
    assert asyncio.run(auth_routes.update_user_role_api(_Request())).status_code == 400
    _install_json(monkeypatch, {"user_id": "u", "role": "manager,employee"})
    assert asyncio.run(auth_routes.update_user_role_api(_Request())).status_code == 400

    role = _Role("super_admin")
    _allow_session(monkeypatch, role)
    _install_json(monkeypatch, {"user_id": "u", "role": "user", "scope": "platform"})
    monkeypatch.setattr(auth_routes, "get_effective_roles", lambda _value: {"super_admin"})
    monkeypatch.setattr(auth_routes, "_load_user_by_session_token", lambda _token: {})
    monkeypatch.setattr(auth_routes, "verify_super_admin_controls", lambda *_args, **_kwargs: (False, "denied"))
    assert asyncio.run(auth_routes.update_user_role_api(_Request())).status_code == 403


def test_update_user_role_handles_org_permission_and_unexpected_error(monkeypatch):
    connection = _Connection(_Cursor(lambda sql, _params: _Answer(
        one=("target@example.test", "Target") if sql.startswith("SELECT email") else None
    )))
    _install_role_update_defaults(
        monkeypatch,
        connection,
        {"user_id": "target", "role": "employee", "scope": "organization"},
    )
    monkeypatch.setattr(
        auth_routes,
        "get_active_org",
        lambda *_args: (_ for _ in ()).throw(OrgPermissionError("denied")),
    )
    assert asyncio.run(auth_routes.update_user_role_api(_Request())).status_code == 403
    assert connection.rollbacks == 1

    monkeypatch.setattr(
        auth_routes, "get_active_org", lambda *_args: (_ for _ in ()).throw(RuntimeError("boom"))
    )
    monkeypatch.setattr(auth_routes, "log_error", lambda *_args: None)
    assert asyncio.run(auth_routes.update_user_role_api(_Request())).status_code == 500


def test_update_user_metadata_sync_validates_target_and_closes_once(monkeypatch):
    monkeypatch.setattr(
        auth_routes.database,
        "get_connection",
        lambda: pytest.fail("invalid field must not open database"),
    )
    response = auth_routes._update_user_metadata_sync(
        _Request(), "admin", "target", "email", "new@example.test"
    )
    assert response.status_code == 400

    connection = _Connection(_Cursor(lambda _sql, _params: _Answer(rowcount=0)))
    monkeypatch.setattr(auth_routes.database, "get_connection", lambda: connection)
    response = auth_routes._update_user_metadata_sync(
        _Request(), "admin", "missing", "name", "Name"
    )
    assert response.status_code == 404
    assert connection.rollbacks == 1
    assert connection.closed == 1

    connection = _Connection(_Cursor(lambda _sql, _params: _Answer(rowcount=1)))
    events = []
    monkeypatch.setattr(auth_routes.database, "get_connection", lambda: connection)
    monkeypatch.setattr(auth_routes, "log_audit", lambda event, **kwargs: events.append((event, kwargs)))
    monkeypatch.setattr(
        auth_routes, "_session_cache_invalidate_by_user_id", lambda user_id: events.append(("session", user_id))
    )
    monkeypatch.setattr(
        auth_routes, "_org_cache_invalidate_by_user_id", lambda user_id: events.append(("org", user_id))
    )
    response = auth_routes._update_user_metadata_sync(
        _Request(), "admin", "target", "name", "Name"
    )
    assert response.status_code == 200
    assert connection.commits == 1
    assert connection.closed == 1
    assert events[0][0] == "admin.user_metadata_updated"


@pytest.mark.parametrize("kind", ["known-integrity", "unknown-integrity", "runtime"])
def test_update_user_metadata_sync_masks_failures(monkeypatch, kind):
    error = IntegrityError("conflict") if "integrity" in kind else RuntimeError("boom")
    connection = _Connection(_Cursor(lambda *_args: (_ for _ in ()).throw(error)))
    monkeypatch.setattr(auth_routes.database, "get_connection", lambda: connection)
    monkeypatch.setattr(
        auth_routes,
        "identity_conflict_code",
        lambda _exc: "USERNAME_ALREADY_EXISTS" if kind == "known-integrity" else None,
    )
    monkeypatch.setattr(auth_routes, "log_error", lambda *_args: None)
    response = auth_routes._update_user_metadata_sync(
        _Request(), "admin", "target", "name", "Name"
    )
    assert response.status_code == (409 if "integrity" in kind else 500)
    assert connection.rollbacks == 1
    assert connection.closed == 1


def test_update_user_metadata_api_validates_and_dispatches(monkeypatch):
    async def denied(*_args, **_kwargs):
        return False, "denied"

    monkeypatch.setattr(auth_routes, "run_database_read", denied)
    assert asyncio.run(auth_routes.update_user_metadata_api(_Request())).status_code == 403

    async def allowed(*_args, **_kwargs):
        return True, _Role("super_admin", user_id="admin")

    monkeypatch.setattr(auth_routes, "run_database_read", allowed)
    marker = JSONResponse({"error": "json"}, status_code=422)

    async def bad_json(_request):
        return None, marker

    monkeypatch.setattr(auth_routes, "read_json_object", bad_json)
    assert asyncio.run(auth_routes.update_user_metadata_api(_Request())) is marker

    _install_json(monkeypatch, {})
    schema = JSONResponse({"error": "schema"}, status_code=422)
    monkeypatch.setattr(auth_routes, "validate_or_response", lambda *_args, **_kwargs: schema)
    assert asyncio.run(auth_routes.update_user_metadata_api(_Request())) is schema
    monkeypatch.setattr(auth_routes, "validate_or_response", lambda *_args, **_kwargs: None)
    assert asyncio.run(auth_routes.update_user_metadata_api(_Request())).status_code == 400

    _install_json(monkeypatch, {"user_id": "target", "field": "email", "value": "new@example.test"})
    response = asyncio.run(auth_routes.update_user_metadata_api(_Request()))
    assert _body(response)["code"] == "EMAIL_CHANGE_VERIFICATION_REQUIRED"

    _install_json(monkeypatch, {"user_id": "target", "field": "name", "value": "Name"})

    async def write(function, request, actor, user_id, field, value):
        assert function is auth_routes._update_user_metadata_sync
        assert (actor, user_id, field, value) == ("admin", "target", "name", "Name")
        return JSONResponse({"success": True})

    monkeypatch.setattr(auth_routes, "run_database_write", write)
    assert asyncio.run(auth_routes.update_user_metadata_api(_Request())).status_code == 200


@pytest.mark.parametrize("error_type", [BlockingIOBusyError, BlockingIOTimeoutError])
def test_update_user_metadata_api_handles_read_and_write_backpressure(monkeypatch, error_type):
    async def unavailable(*_args, **_kwargs):
        raise error_type("busy")

    monkeypatch.setattr(auth_routes, "run_database_read", unavailable)
    assert asyncio.run(auth_routes.update_user_metadata_api(_Request())).status_code == 503

    async def allowed(*_args, **_kwargs):
        return True, _Role("super_admin")

    _install_json(monkeypatch, {"user_id": "target", "field": "name", "value": "Name"})
    monkeypatch.setattr(auth_routes, "run_database_read", allowed)
    monkeypatch.setattr(auth_routes, "run_database_write", unavailable)
    assert asyncio.run(auth_routes.update_user_metadata_api(_Request())).status_code == 503


def test_package_list_helpers_shape_money_cache_and_close(monkeypatch):
    rows = [
        {"id": "silver", "name": "Silver", "price": "1000", "quota": 2, "description": "", "status": "active"},
        {"id": "gold", "name": "Gold", "price": "2000", "quota": 5, "description": "", "status": "inactive"},
    ]
    connection = _Connection(_Cursor(lambda _sql, _params: _Answer(all_rows=rows)))
    monkeypatch.setattr(auth_routes, "verify_session", lambda _request: (True, _Role()))
    monkeypatch.setattr(auth_routes.database, "get_connection", lambda: connection)
    monkeypatch.setattr(auth_routes, "money_json_value", lambda value: int(value))
    response = auth_routes._list_system_packages_sync(_Request())
    payload = _body(response)
    assert response.status_code == 200
    assert payload[0]["price"] == 1000
    assert payload[0]["isLocked"] is False
    assert payload[1]["isLocked"] is True
    assert connection.closed == 1

    public_connection = _Connection(_Cursor(lambda _sql, _params: _Answer(all_rows=rows[:1])))
    monkeypatch.setattr(auth_routes.database, "get_connection", lambda: public_connection)
    response = auth_routes._list_public_packages_sync(_Request())
    assert _body(response)["packages"][0]["price"] == 1000
    assert response.headers["Cache-Control"] == "public, max-age=300"
    assert public_connection.closed == 1


def test_package_list_helpers_reject_auth_and_close_on_failure(monkeypatch):
    monkeypatch.setattr(auth_routes, "verify_session", lambda _request: (False, "denied"))
    assert auth_routes._list_system_packages_sync(_Request()).status_code == 403

    connection = _Connection(_Cursor(lambda *_args: (_ for _ in ()).throw(RuntimeError("boom"))))
    monkeypatch.setattr(auth_routes, "verify_session", lambda _request: (True, _Role()))
    monkeypatch.setattr(auth_routes.database, "get_connection", lambda: connection)
    monkeypatch.setattr(auth_routes, "log_error", lambda *_args: None)
    assert auth_routes._list_system_packages_sync(_Request()).status_code == 500
    assert connection.closed == 1

    public_connection = _Connection(_Cursor(lambda *_args: (_ for _ in ()).throw(RuntimeError("boom"))))
    monkeypatch.setattr(auth_routes.database, "get_connection", lambda: public_connection)
    assert auth_routes._list_public_packages_sync(_Request()).status_code == 500
    assert public_connection.closed == 1


@pytest.mark.parametrize("route_name", ["list_system_packages_api", "list_public_packages_api"])
@pytest.mark.parametrize("error_type", [BlockingIOBusyError, BlockingIOTimeoutError])
def test_package_list_async_wrappers_handle_backpressure(monkeypatch, route_name, error_type):
    async def unavailable(*_args, **_kwargs):
        raise error_type("busy")

    monkeypatch.setattr(auth_routes, "run_database_read", unavailable)
    response = asyncio.run(getattr(auth_routes, route_name)(_Request()))
    assert response.status_code == 503


def test_package_list_async_wrappers_dispatch(monkeypatch):
    seen = []

    async def read(function, request, **kwargs):
        seen.append((function, kwargs["timeout_seconds"]))
        return JSONResponse({"success": True})

    monkeypatch.setattr(auth_routes, "run_database_read", read)
    assert asyncio.run(auth_routes.list_system_packages_api(_Request())).status_code == 200
    assert asyncio.run(auth_routes.list_public_packages_api(_Request())).status_code == 200
    assert [item[0] for item in seen] == [
        auth_routes._list_system_packages_sync,
        auth_routes._list_public_packages_sync,
    ]


def test_update_system_package_sync_checks_rowcount_and_audits(monkeypatch):
    missing = _Connection(_Cursor(lambda _sql, _params: _Answer(rowcount=0)))
    monkeypatch.setattr(auth_routes.database, "get_connection", lambda: missing)
    response = auth_routes._update_system_package_sync(
        _Request(), "admin", "missing", "Name", 1000, 2, "Description", "active"
    )
    assert response.status_code == 404
    assert missing.rollbacks == 1
    assert missing.closed == 1

    success = _Connection(_Cursor(lambda _sql, _params: _Answer(rowcount=1)))
    audits = []
    monkeypatch.setattr(auth_routes.database, "get_connection", lambda: success)
    monkeypatch.setattr(auth_routes, "log_audit", lambda event, **kwargs: audits.append((event, kwargs)))
    response = auth_routes._update_system_package_sync(
        _Request(), "admin", "gold", "Gold", 2000, 5, "Description", "inactive"
    )
    assert response.status_code == 200
    assert success.commits == 1
    assert success.closed == 1
    assert audits[0][0] == "admin.system_package_updated"

    failed = _Connection(_Cursor(lambda *_args: (_ for _ in ()).throw(RuntimeError("boom"))))
    monkeypatch.setattr(auth_routes.database, "get_connection", lambda: failed)
    monkeypatch.setattr(auth_routes, "log_error", lambda *_args: None)
    assert auth_routes._update_system_package_sync(
        _Request(), "admin", "gold", "Gold", 1, 1, "", "active"
    ).status_code == 500
    assert failed.rollbacks == 1
    assert failed.closed == 1


def test_update_system_package_api_validates_and_dispatches(monkeypatch):
    async def denied(*_args, **_kwargs):
        return False, "denied"

    monkeypatch.setattr(auth_routes, "run_database_read", denied)
    assert asyncio.run(auth_routes.update_system_package_api(_Request())).status_code == 403

    async def allowed(*_args, **_kwargs):
        return True, _Role("super_admin", user_id="admin")

    monkeypatch.setattr(auth_routes, "run_database_read", allowed)
    marker = JSONResponse({"error": "json"}, status_code=422)

    async def bad_json(_request):
        return None, marker

    monkeypatch.setattr(auth_routes, "read_json_object", bad_json)
    assert asyncio.run(auth_routes.update_system_package_api(_Request())) is marker

    payload = {"id": "gold", "name": "Gold", "price": "1000", "quota": 5, "status": "active"}
    _install_json(monkeypatch, payload)
    schema = JSONResponse({"error": "schema"}, status_code=422)
    monkeypatch.setattr(auth_routes, "validate_or_response", lambda *_args, **_kwargs: schema)
    assert asyncio.run(auth_routes.update_system_package_api(_Request())) is schema
    monkeypatch.setattr(auth_routes, "validate_or_response", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(auth_routes, "parse_vnd_amount", lambda _value: None)
    assert asyncio.run(auth_routes.update_system_package_api(_Request())).status_code == 400

    monkeypatch.setattr(auth_routes, "parse_vnd_amount", lambda _value: 1000)

    async def write(function, request, actor, *args):
        assert function is auth_routes._update_system_package_sync
        assert actor == "admin"
        assert args[:3] == ("gold", "Gold", 1000)
        return JSONResponse({"success": True})

    monkeypatch.setattr(auth_routes, "run_database_write", write)
    assert asyncio.run(auth_routes.update_system_package_api(_Request())).status_code == 200


@pytest.mark.parametrize("error_type", [BlockingIOBusyError, BlockingIOTimeoutError])
def test_update_system_package_api_handles_backpressure(monkeypatch, error_type):
    async def unavailable(*_args, **_kwargs):
        raise error_type("busy")

    monkeypatch.setattr(auth_routes, "run_database_read", unavailable)
    assert asyncio.run(auth_routes.update_system_package_api(_Request())).status_code == 503

    async def allowed(*_args, **_kwargs):
        return True, _Role("super_admin")

    _install_json(
        monkeypatch,
        {"id": "gold", "name": "Gold", "price": "1000", "quota": 5, "status": "active"},
    )
    monkeypatch.setattr(auth_routes, "parse_vnd_amount", lambda _value: 1000)
    monkeypatch.setattr(auth_routes, "run_database_read", allowed)
    monkeypatch.setattr(auth_routes, "run_database_write", unavailable)
    assert asyncio.run(auth_routes.update_system_package_api(_Request())).status_code == 503


@pytest.mark.parametrize("scenario, expected", [("missing", 404), ("already", 400), ("conflict", 409), ("success", 200)])
def test_set_username_sync_is_single_use_and_atomic(monkeypatch, scenario, expected):
    def handler(sql, _params):
        if sql.startswith("SELECT id, ten_dang_nhap"):
            if scenario == "missing":
                return _Answer()
            return _Answer(one={
                "id": "user-1",
                "ten_dang_nhap": "existing" if scenario == "already" else "",
                "username_da_dat": 1 if scenario == "already" else 0,
            })
        if sql.startswith("SELECT 1 FROM tai_khoan"):
            return _Answer(one=(1,) if scenario == "conflict" else None)
        return _Answer()

    connection = _Connection(_Cursor(handler))
    monkeypatch.setattr(auth_routes.database, "get_connection", lambda: connection)
    monkeypatch.setattr(auth_routes, "log_audit", lambda *_args, **_kwargs: None)
    invalidated = []
    monkeypatch.setattr(auth_routes, "_session_cache_invalidate_by_user_id", invalidated.append)
    response = auth_routes._set_username_sync(_Request(), _Role(), "newuser")
    assert response.status_code == expected
    assert connection.closed == 1
    if scenario == "success":
        assert connection.commits == 1
        assert invalidated == ["user-1"]
    else:
        assert connection.rollbacks == 1


@pytest.mark.parametrize("kind", ["known-integrity", "unknown-integrity", "runtime"])
def test_set_username_sync_handles_integrity_and_runtime_failures(monkeypatch, kind):
    error = IntegrityError("conflict") if "integrity" in kind else RuntimeError("boom")
    connection = _Connection(_Cursor(lambda *_args: (_ for _ in ()).throw(error)))
    monkeypatch.setattr(auth_routes.database, "get_connection", lambda: connection)
    monkeypatch.setattr(
        auth_routes,
        "identity_conflict_code",
        lambda _exc: "USERNAME_ALREADY_EXISTS" if kind == "known-integrity" else None,
    )
    monkeypatch.setattr(auth_routes, "log_error", lambda *_args: None)
    response = auth_routes._set_username_sync(_Request(), _Role(), "newuser")
    assert response.status_code == (409 if "integrity" in kind else 500)
    assert connection.rollbacks == 1
    assert connection.closed == 1


def test_set_username_api_validates_and_dispatches(monkeypatch):
    async def denied(*_args, **_kwargs):
        return False, "denied"

    monkeypatch.setattr(auth_routes, "run_database_read", denied)
    assert asyncio.run(auth_routes.set_username_api(_Request())).status_code == 403

    async def allowed(*_args, **_kwargs):
        return True, _Role()

    monkeypatch.setattr(auth_routes, "run_database_read", allowed)
    marker = JSONResponse({"error": "json"}, status_code=422)

    async def bad_json(_request):
        return None, marker

    monkeypatch.setattr(auth_routes, "read_json_object", bad_json)
    assert asyncio.run(auth_routes.set_username_api(_Request())) is marker
    _install_json(monkeypatch, {"username": "newuser"})
    schema = JSONResponse({"error": "schema"}, status_code=422)
    monkeypatch.setattr(auth_routes, "validate_or_response", lambda *_args, **_kwargs: schema)
    assert asyncio.run(auth_routes.set_username_api(_Request())) is schema
    monkeypatch.setattr(auth_routes, "validate_or_response", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(auth_routes, "normalize_username", lambda value: value)
    monkeypatch.setattr(auth_routes, "validate_username", lambda _value: (False, "invalid"))
    assert asyncio.run(auth_routes.set_username_api(_Request())).status_code == 400

    monkeypatch.setattr(auth_routes, "validate_username", lambda _value: (True, ""))

    async def write(function, request, role, username):
        assert function is auth_routes._set_username_sync
        assert username == "newuser"
        return JSONResponse({"success": True})

    monkeypatch.setattr(auth_routes, "run_database_write", write)
    assert asyncio.run(auth_routes.set_username_api(_Request())).status_code == 200


@pytest.mark.parametrize("error_type", [BlockingIOBusyError, BlockingIOTimeoutError])
def test_set_username_api_handles_backpressure(monkeypatch, error_type):
    async def unavailable(*_args, **_kwargs):
        raise error_type("busy")

    monkeypatch.setattr(auth_routes, "run_database_read", unavailable)
    assert asyncio.run(auth_routes.set_username_api(_Request())).status_code == 503

    async def allowed(*_args, **_kwargs):
        return True, _Role()

    _install_json(monkeypatch, {"username": "newuser"})
    monkeypatch.setattr(auth_routes, "normalize_username", lambda value: value)
    monkeypatch.setattr(auth_routes, "validate_username", lambda _value: (True, ""))
    monkeypatch.setattr(auth_routes, "run_database_read", allowed)
    monkeypatch.setattr(auth_routes, "run_database_write", unavailable)
    assert asyncio.run(auth_routes.set_username_api(_Request())).status_code == 503
