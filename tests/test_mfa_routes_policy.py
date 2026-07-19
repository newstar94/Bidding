import asyncio
import json
from types import SimpleNamespace

import pytest
from starlette.responses import JSONResponse

from backend.auth import mfa_routes
from backend.auth.mfa_service import MfaConfigurationError, MfaStateError
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError


def _body(response):
    return json.loads(response.body.decode("utf-8"))


def _request():
    return SimpleNamespace(
        cookies={"session_token": "session-token"},
        headers={},
        state=SimpleNamespace(),
        method="POST",
        url=SimpleNamespace(path="/api/auth/mfa"),
    )


def _role(platform_role="employee"):
    return SimpleNamespace(
        user_id="user-1",
        session_id="session-1",
        __str__=lambda self: platform_role,
    )


class _Cursor:
    def __init__(self, row=None, rowcount=1):
        self.row = row
        self.rowcount = rowcount
        self.calls = []

    def execute(self, sql, params=()):
        self.calls.append((" ".join(str(sql).split()), tuple(params)))
        return self

    def fetchone(self):
        return self.row


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


def test_mfa_database_helpers_close_connections(monkeypatch):
    cursor = _Cursor(("hash", "owner@example.test", "Owner", "employee"))
    connection = _Connection(cursor)
    monkeypatch.setattr(
        mfa_routes.database, "get_connection", lambda: connection
    )
    monkeypatch.setattr(
        mfa_routes,
        "get_mfa_status",
        lambda _cursor, user_id, role: {"user": user_id, "role": role},
    )

    assert mfa_routes._load_mfa_status("user-1", "employee") == {
        "user": "user-1",
        "role": "employee",
    }
    assert mfa_routes._load_account_password("user-1") == (
        "hash",
        "owner@example.test",
        "Owner",
        "employee",
    )
    cursor.row = None
    assert mfa_routes._load_account_password("missing") is None
    assert connection.closed == 3


def test_mfa_transaction_helpers_commit_audit_and_rollback(monkeypatch):
    cursor = _Cursor(rowcount=1)
    connection = _Connection(cursor)
    monkeypatch.setattr(
        mfa_routes.database, "get_connection", lambda: connection
    )
    audits = []
    monkeypatch.setattr(
        mfa_routes,
        "log_audit",
        lambda event, **kwargs: audits.append((event, kwargs)),
    )
    monkeypatch.setattr(
        mfa_routes,
        "begin_mfa_enrollment",
        lambda *args, **kwargs: {"secret": "safe"},
    )
    monkeypatch.setattr(
        mfa_routes,
        "confirm_mfa_enrollment",
        lambda *args, **kwargs: ["RECOVERY"],
    )
    monkeypatch.setattr(mfa_routes.time, "time", lambda: 1000)

    assert mfa_routes._begin_enrollment(
        "user-1", "owner@example.test", _request()
    ) == {"secret": "safe"}
    assert mfa_routes._confirm_enrollment(
        "user-1", "session-1", "123456", _request()
    ) == ["RECOVERY"]
    assert connection.commits == 2
    assert [event for event, _ in audits] == [
        "auth.mfa_enrollment_started",
        "auth.mfa_enabled",
    ]

    cursor.rowcount = 0
    with pytest.raises(MfaStateError, match="Phiên đăng nhập"):
        mfa_routes._confirm_enrollment(
            "user-1", "revoked-session", "123456", _request()
        )
    assert connection.rollbacks == 1

    monkeypatch.setattr(
        mfa_routes,
        "begin_mfa_enrollment",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            MfaConfigurationError("missing key")
        ),
    )
    with pytest.raises(MfaConfigurationError):
        mfa_routes._begin_enrollment(
            "user-1", "owner@example.test", _request()
        )
    assert connection.rollbacks == 2
    assert connection.closed == 4


def test_disable_mfa_requires_single_use_code_and_revokes_sessions(monkeypatch):
    cursor = _Cursor()
    connection = _Connection(cursor)
    monkeypatch.setattr(
        mfa_routes.database, "get_connection", lambda: connection
    )
    monkeypatch.setattr(mfa_routes, "consume_mfa_code", lambda *args, **kwargs: False)

    with pytest.raises(MfaStateError, match="không đúng"):
        mfa_routes._disable_mfa("user-1", "bad-code", _request())
    assert connection.rollbacks == 1

    disabled = []
    monkeypatch.setattr(mfa_routes, "consume_mfa_code", lambda *args, **kwargs: True)
    monkeypatch.setattr(
        mfa_routes,
        "disable_mfa",
        lambda _cursor, user_id: disabled.append(user_id),
    )
    monkeypatch.setattr(mfa_routes, "log_audit", lambda *args, **kwargs: None)
    monkeypatch.setattr(mfa_routes.time, "time", lambda: 1234)
    mfa_routes._disable_mfa("user-1", "123456", _request())

    assert disabled == ["user-1"]
    assert connection.commits == 1
    assert any(
        "UPDATE auth_sessions SET revoked_at" in sql
        and params == (1234, "user-1")
        for sql, params in cursor.calls
    )


def test_mfa_notification_escapes_untrusted_account_content():
    assert mfa_routes._security_notification(
        "", "Owner", "Subject", "message"
    ) is None
    email, subject, content = mfa_routes._security_notification(
        "owner@example.test",
        "<script>alert(1)</script>",
        "Subject",
        "<img src=x onerror=alert(1)>",
    )
    assert email == "owner@example.test"
    assert subject == "Subject"
    assert "<script>" not in content
    assert "<img src=x" not in content
    assert "&lt;script&gt;" in content
    assert "&lt;img" in content


@pytest.mark.parametrize(
    "handler",
    [
        mfa_routes.mfa_status_api,
        mfa_routes.mfa_setup_api,
        mfa_routes.mfa_confirm_api,
        mfa_routes.mfa_disable_api,
    ],
)
def test_mfa_routes_require_live_session(monkeypatch, handler):
    monkeypatch.setattr(
        mfa_routes,
        "verify_session",
        lambda _request: (False, "Phiên hết hạn"),
    )

    response = asyncio.run(handler(_request()))

    assert response.status_code == 401
    assert _body(response)["error"] == "Phiên hết hạn"


def test_mfa_status_success_and_failure_are_non_cacheable(monkeypatch):
    monkeypatch.setattr(
        mfa_routes, "verify_session", lambda _request: (True, _role())
    )

    async def read_ok(*args, **kwargs):
        return {"enabled": True}

    monkeypatch.setattr(mfa_routes, "run_database_read", read_ok)
    response = asyncio.run(mfa_routes.mfa_status_api(_request()))
    assert _body(response) == {"enabled": True}
    assert response.headers["cache-control"] == "no-store"

    async def read_error(*args, **kwargs):
        raise RuntimeError("database detail")

    logs = []
    monkeypatch.setattr(mfa_routes, "run_database_read", read_error)
    monkeypatch.setattr(
        mfa_routes, "log_error", lambda exc, context: logs.append((exc, context))
    )
    response = asyncio.run(mfa_routes.mfa_status_api(_request()))
    assert response.status_code == 500
    assert _body(response)["error"] == "Không thể đọc trạng thái MFA."
    assert logs[0][1] == "mfa_status_api"


def _install_json(monkeypatch, payload, *, validation_response=None):
    async def read(_request):
        return payload, None

    monkeypatch.setattr(mfa_routes, "read_json_object", read)
    monkeypatch.setattr(
        mfa_routes,
        "validate_or_response",
        lambda *args, **kwargs: validation_response,
    )


@pytest.mark.parametrize(
    "handler",
    [
        mfa_routes.mfa_setup_api,
        mfa_routes.mfa_confirm_api,
        mfa_routes.mfa_disable_api,
    ],
)
def test_mfa_json_and_schema_errors_short_circuit(monkeypatch, handler):
    monkeypatch.setattr(
        mfa_routes, "verify_session", lambda _request: (True, _role())
    )
    json_error = JSONResponse({"error": "bad json"}, status_code=400)

    async def invalid_json(_request):
        return None, json_error

    monkeypatch.setattr(mfa_routes, "read_json_object", invalid_json)
    assert asyncio.run(handler(_request())) is json_error

    schema_error = JSONResponse({"error": "bad schema"}, status_code=422)
    _install_json(monkeypatch, {}, validation_response=schema_error)
    assert asyncio.run(handler(_request())) is schema_error


def test_mfa_setup_success_and_expected_failures(monkeypatch):
    monkeypatch.setattr(
        mfa_routes, "verify_session", lambda _request: (True, _role())
    )
    _install_json(monkeypatch, {"password": "correct"})

    async def read_account(*args, **kwargs):
        return ("hash", "owner@example.test", "Owner", "employee")

    async def cpu_ok(*args, **kwargs):
        return True

    async def write_ok(*args, **kwargs):
        return {"secret": "TOTP", "otpauth_uri": "otpauth://safe"}

    monkeypatch.setattr(mfa_routes, "run_database_read", read_account)
    monkeypatch.setattr(mfa_routes, "run_cpu_bound", cpu_ok)
    monkeypatch.setattr(mfa_routes, "run_database_write", write_ok)

    response = asyncio.run(mfa_routes.mfa_setup_api(_request()))
    assert response.status_code == 200
    assert _body(response)["success"] is True
    assert response.headers["cache-control"] == "no-store"

    async def missing(*args, **kwargs):
        return None

    monkeypatch.setattr(mfa_routes, "run_database_read", missing)
    assert asyncio.run(mfa_routes.mfa_setup_api(_request())).status_code == 404

    monkeypatch.setattr(mfa_routes, "run_database_read", read_account)

    async def cpu_bad(*args, **kwargs):
        return False

    monkeypatch.setattr(mfa_routes, "run_cpu_bound", cpu_bad)
    assert asyncio.run(mfa_routes.mfa_setup_api(_request())).status_code == 403

    async def raise_error(error):
        raise error

    monkeypatch.setattr(
        mfa_routes,
        "run_database_read",
        lambda *args, **kwargs: raise_error(BlockingIOBusyError("busy")),
    )
    assert asyncio.run(mfa_routes.mfa_setup_api(_request())).status_code == 503
    monkeypatch.setattr(
        mfa_routes,
        "run_database_read",
        lambda *args, **kwargs: raise_error(MfaStateError("state")),
    )
    assert asyncio.run(mfa_routes.mfa_setup_api(_request())).status_code == 409
    monkeypatch.setattr(
        mfa_routes,
        "run_database_read",
        lambda *args, **kwargs: raise_error(RuntimeError("secret")),
    )
    assert asyncio.run(mfa_routes.mfa_setup_api(_request())).status_code == 500


def test_mfa_confirm_success_notification_and_failures(monkeypatch):
    monkeypatch.setattr(
        mfa_routes, "verify_session", lambda _request: (True, _role())
    )
    _install_json(monkeypatch, {"code": "123456"})

    async def write_ok(*args, **kwargs):
        return ["RECOVERY-1"]

    async def account(*args, **kwargs):
        return ("hash", "owner@example.test", "Owner", "employee")

    monkeypatch.setattr(mfa_routes, "run_database_write", write_ok)
    monkeypatch.setattr(mfa_routes, "run_database_read", account)
    response = asyncio.run(mfa_routes.mfa_confirm_api(_request()))
    assert _body(response)["recovery_codes"] == ["RECOVERY-1"]
    assert response.headers["cache-control"] == "no-store"
    assert response.background is not None

    async def no_account(*args, **kwargs):
        return None

    monkeypatch.setattr(mfa_routes, "run_database_read", no_account)
    assert asyncio.run(mfa_routes.mfa_confirm_api(_request())).status_code == 200

    async def fail_state(*args, **kwargs):
        raise MfaStateError("invalid")

    monkeypatch.setattr(mfa_routes, "run_database_write", fail_state)
    assert asyncio.run(mfa_routes.mfa_confirm_api(_request())).status_code == 400

    async def fail_unknown(*args, **kwargs):
        raise RuntimeError("secret")

    monkeypatch.setattr(mfa_routes, "run_database_write", fail_unknown)
    assert asyncio.run(mfa_routes.mfa_confirm_api(_request())).status_code == 500


def test_mfa_disable_enforces_role_password_code_and_busy_paths(monkeypatch):
    monkeypatch.setattr(
        mfa_routes, "verify_session", lambda _request: (True, _role())
    )
    _install_json(monkeypatch, {"password": "correct", "code": "123456"})

    async def result(value):
        return value

    monkeypatch.setattr(
        mfa_routes,
        "run_database_read",
        lambda *args, **kwargs: result(None),
    )
    assert asyncio.run(mfa_routes.mfa_disable_api(_request())).status_code == 404

    monkeypatch.setattr(
        mfa_routes,
        "run_database_read",
        lambda *args, **kwargs: result(
            ("hash", "owner@example.test", "Owner", "super_admin")
        ),
    )
    assert asyncio.run(mfa_routes.mfa_disable_api(_request())).status_code == 403

    monkeypatch.setattr(
        mfa_routes,
        "run_database_read",
        lambda *args, **kwargs: result(
            ("hash", "owner@example.test", "Owner", "employee")
        ),
    )
    monkeypatch.setattr(
        mfa_routes, "run_cpu_bound", lambda *args, **kwargs: result(False)
    )
    assert asyncio.run(mfa_routes.mfa_disable_api(_request())).status_code == 403

    monkeypatch.setattr(
        mfa_routes, "run_cpu_bound", lambda *args, **kwargs: result(True)
    )
    monkeypatch.setattr(
        mfa_routes, "run_database_write", lambda *args, **kwargs: result(None)
    )
    response = asyncio.run(mfa_routes.mfa_disable_api(_request()))
    assert response.status_code == 200
    assert _body(response)["success"] is True
    assert "session_token=" in response.headers["set-cookie"]

    async def fail(error):
        raise error

    monkeypatch.setattr(
        mfa_routes,
        "run_database_read",
        lambda *args, **kwargs: fail(BlockingIOTimeoutError("timeout")),
    )
    assert asyncio.run(mfa_routes.mfa_disable_api(_request())).status_code == 503
    monkeypatch.setattr(
        mfa_routes,
        "run_database_read",
        lambda *args, **kwargs: fail(MfaConfigurationError("key")),
    )
    assert asyncio.run(mfa_routes.mfa_disable_api(_request())).status_code == 400
    monkeypatch.setattr(
        mfa_routes,
        "run_database_read",
        lambda *args, **kwargs: fail(RuntimeError("secret")),
    )
    assert asyncio.run(mfa_routes.mfa_disable_api(_request())).status_code == 500
