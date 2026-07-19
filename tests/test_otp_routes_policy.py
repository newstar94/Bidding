import asyncio
import json
from types import SimpleNamespace

import pytest
from starlette.responses import JSONResponse

from backend.auth import otp_routes
from backend.auth.auth_service import RateLimitDecision
from backend.auth.password_reset_service import InvalidResetToken
from backend.auth.profile_validation import ProfileValidationError
from backend.db.db_helper import DatabaseError, IntegrityError
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError


def _body(response):
    return json.loads(response.body.decode("utf-8"))


def _request():
    return SimpleNamespace(
        headers={},
        cookies={},
        state=SimpleNamespace(),
        method="POST",
        url=SimpleNamespace(path="/api/auth/otp"),
    )


class _Cursor:
    def __init__(self, rows=()):
        self.rows = list(rows)
        self.calls = []

    def execute(self, sql, params=()):
        self.calls.append((" ".join(str(sql).split()), tuple(params)))
        return self

    def fetchone(self):
        return self.rows.pop(0) if self.rows else None


class _Connection:
    def __init__(self, cursor, close_error=False):
        self._cursor = cursor
        self.commits = 0
        self.rollbacks = 0
        self.closed = 0
        self.close_error = close_error

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
        if self.close_error:
            raise DatabaseError("close failed")


def _allowed():
    return RateLimitDecision(True, 0, 4)


def _install_json(monkeypatch, payload, *, validation=None):
    async def read(_request):
        return payload, None

    monkeypatch.setattr(otp_routes, "read_json_object", read)
    monkeypatch.setattr(
        otp_routes,
        "validate_or_response",
        lambda *args, **kwargs: validation,
    )


def _install_limits(monkeypatch, decisions=None):
    queue = list(decisions or [])

    async def decide(*args, **kwargs):
        return queue.pop(0) if queue else _allowed()

    monkeypatch.setattr(otp_routes, "_rate_limit_decision", decide)
    monkeypatch.setattr(otp_routes, "get_client_ip", lambda request: "203.0.113.1")


def test_otp_helpers_fail_closed_and_close_database(monkeypatch):
    cursor = _Cursor([("owner@example.test", "Owner")])
    connection = _Connection(cursor)
    monkeypatch.setattr(otp_routes.database, "get_connection", lambda: connection)
    assert otp_routes._load_security_recipient("user-1") == (
        "owner@example.test",
        "Owner",
    )
    assert connection.closed == 1

    async def busy(*args, **kwargs):
        raise BlockingIOBusyError("busy")

    monkeypatch.setattr(otp_routes, "run_database_write", busy)
    decision = asyncio.run(
        otp_routes._rate_limit_decision("bucket", window_seconds=120)
    )
    assert decision.allowed is False
    assert decision.retry_after == 120
    assert decision.storage_failed is True

    for response, code in (
        (otp_routes._password_work_unavailable_response(), "PASSWORD_CPU_QUEUE_BUSY"),
        (otp_routes._database_write_unavailable_response(), "DATABASE_WRITE_QUEUE_FULL"),
    ):
        assert response.status_code == 503
        assert response.headers["retry-after"] == "1"
        assert _body(response)["code"] == code


@pytest.mark.parametrize(
    "handler",
    [
        otp_routes.register_api,
        otp_routes.verify_email_api,
        otp_routes.resend_code_api,
        otp_routes.forgot_password_api,
        otp_routes.reset_password_api,
    ],
)
def test_otp_routes_short_circuit_json_and_schema_errors(monkeypatch, handler):
    _install_limits(monkeypatch)
    json_error = JSONResponse({"error": "bad json"}, status_code=400)

    async def bad_json(_request):
        return None, json_error

    monkeypatch.setattr(otp_routes, "read_json_object", bad_json)
    assert asyncio.run(handler(_request())) is json_error

    schema_error = JSONResponse({"error": "bad schema"}, status_code=422)
    _install_json(monkeypatch, {}, validation=schema_error)
    assert asyncio.run(handler(_request())) is schema_error


def test_register_enforces_rate_profile_password_and_username(monkeypatch):
    payload = {
        "username": "owner",
        "password": "A very long safe password!",
        "name": "Owner",
        "email": "owner@example.test",
    }
    _install_json(monkeypatch, payload)
    _install_limits(monkeypatch, [RateLimitDecision(False, 30, 0)])
    assert asyncio.run(otp_routes.register_api(_request())).status_code == 429

    _install_limits(monkeypatch)
    monkeypatch.setattr(
        otp_routes,
        "validate_profile_fields",
        lambda *args: (_ for _ in ()).throw(
            ProfileValidationError("bad profile", code="INVALID_PROFILE")
        ),
    )
    response = asyncio.run(otp_routes.register_api(_request()))
    assert response.status_code == 400
    assert _body(response)["code"] == "INVALID_PROFILE"

    monkeypatch.setattr(
        otp_routes,
        "validate_profile_fields",
        lambda name, email, avatar: (name, email, avatar),
    )
    _install_json(monkeypatch, {**payload, "username": ""})
    assert asyncio.run(otp_routes.register_api(_request())).status_code == 400

    _install_json(monkeypatch, payload)
    monkeypatch.setattr(
        otp_routes,
        "validate_new_password",
        lambda password: (False, "weak"),
    )
    response = asyncio.run(otp_routes.register_api(_request()))
    assert _body(response)["code"] == "PASSWORD_POLICY_FAILED"

    monkeypatch.setattr(
        otp_routes, "validate_new_password", lambda password: (True, None)
    )
    _install_limits(monkeypatch, [_allowed(), RateLimitDecision(False, 30, 0)])
    assert asyncio.run(otp_routes.register_api(_request())).status_code == 429

    _install_limits(monkeypatch)
    monkeypatch.setattr(
        otp_routes, "validate_username", lambda username: (False, "reserved")
    )
    assert asyncio.run(otp_routes.register_api(_request())).status_code == 400


def test_register_success_hashes_password_and_escapes_email_content(monkeypatch):
    payload = {
        "username": "owner",
        "password": "A very long safe password!",
        "name": "<script>alert(1)</script>",
        "email": "owner@example.test",
    }
    _install_json(monkeypatch, payload)
    _install_limits(monkeypatch)
    monkeypatch.setattr(
        otp_routes,
        "validate_profile_fields",
        lambda name, email, avatar: (name, email, avatar),
    )
    monkeypatch.setattr(
        otp_routes, "validate_new_password", lambda password: (True, None)
    )
    monkeypatch.setattr(
        otp_routes, "validate_username", lambda username: (True, None)
    )

    async def hash_password(*args, **kwargs):
        return "argon2-hash"

    monkeypatch.setattr(otp_routes, "run_cpu_bound", hash_password)
    monkeypatch.setattr(otp_routes, "generate_record_id", lambda prefix: "user-1")
    monkeypatch.setattr(otp_routes, "generate_otp", lambda: "123456")
    monkeypatch.setattr(otp_routes.time, "time", lambda: 1000)
    cursor = _Cursor([None, None])
    connection = _Connection(cursor)
    monkeypatch.setattr(otp_routes.database, "get_connection", lambda: connection)

    response = asyncio.run(otp_routes.register_api(_request()))

    assert response.status_code == 200
    assert response.background is not None
    email_args = response.background.tasks[0].args
    assert "<script>" not in email_args[2]
    assert "&lt;script&gt;" in email_args[2]
    insert = next(params for sql, params in cursor.calls if "INSERT INTO tai_khoan" in sql)
    assert insert[3] == "argon2-hash"
    assert insert[-2:] == ("123456", 1600)
    assert connection.commits == 1


@pytest.mark.parametrize(
    ("rows", "code"),
    [
        ([("existing",)], "USERNAME_ALREADY_EXISTS"),
        ([None, ("existing",)], "EMAIL_ALREADY_EXISTS"),
    ],
)
def test_register_detects_identity_conflicts_before_insert(monkeypatch, rows, code):
    payload = {
        "username": "owner",
        "password": "A very long safe password!",
        "name": "Owner",
        "email": "owner@example.test",
    }
    _install_json(monkeypatch, payload)
    _install_limits(monkeypatch)
    monkeypatch.setattr(
        otp_routes,
        "validate_profile_fields",
        lambda name, email, avatar: (name, email, avatar),
    )
    monkeypatch.setattr(
        otp_routes, "validate_new_password", lambda password: (True, None)
    )
    monkeypatch.setattr(
        otp_routes, "validate_username", lambda username: (True, None)
    )

    async def hash_password(*args, **kwargs):
        return "hash"

    monkeypatch.setattr(otp_routes, "run_cpu_bound", hash_password)
    cursor = _Cursor(rows)
    connection = _Connection(cursor)
    monkeypatch.setattr(otp_routes.database, "get_connection", lambda: connection)
    monkeypatch.setattr(
        otp_routes,
        "conflict_payload",
        lambda conflict_code: {"code": conflict_code},
    )

    response = asyncio.run(otp_routes.register_api(_request()))

    assert response.status_code == 409
    assert _body(response)["code"] == code
    assert connection.rollbacks == 1


def test_register_handles_cpu_integrity_and_unknown_failures(monkeypatch):
    payload = {
        "username": "owner",
        "password": "A very long safe password!",
        "name": "Owner",
        "email": "owner@example.test",
    }
    _install_json(monkeypatch, payload)
    _install_limits(monkeypatch)
    monkeypatch.setattr(
        otp_routes,
        "validate_profile_fields",
        lambda name, email, avatar: (name, email, avatar),
    )
    monkeypatch.setattr(
        otp_routes, "validate_new_password", lambda password: (True, None)
    )
    monkeypatch.setattr(
        otp_routes, "validate_username", lambda username: (True, None)
    )

    async def busy(*args, **kwargs):
        raise BlockingIOTimeoutError("timeout")

    monkeypatch.setattr(otp_routes, "run_cpu_bound", busy)
    assert asyncio.run(otp_routes.register_api(_request())).status_code == 503

    async def hashed(*args, **kwargs):
        return "hash"

    monkeypatch.setattr(otp_routes, "run_cpu_bound", hashed)
    cursor = _Cursor([None, None])
    connection = _Connection(cursor, close_error=True)
    monkeypatch.setattr(otp_routes.database, "get_connection", lambda: connection)
    monkeypatch.setattr(
        otp_routes,
        "generate_record_id",
        lambda prefix: (_ for _ in ()).throw(IntegrityError("conflict")),
    )
    monkeypatch.setattr(
        otp_routes, "identity_conflict_code", lambda exc: "EMAIL_ALREADY_EXISTS"
    )
    monkeypatch.setattr(
        otp_routes, "conflict_payload", lambda code: {"code": code}
    )
    assert asyncio.run(otp_routes.register_api(_request())).status_code == 409

    connection.close_error = False
    monkeypatch.setattr(otp_routes, "identity_conflict_code", lambda exc: None)
    assert asyncio.run(otp_routes.register_api(_request())).status_code == 409

    monkeypatch.setattr(
        otp_routes,
        "generate_record_id",
        lambda prefix: (_ for _ in ()).throw(RuntimeError("secret")),
    )
    assert asyncio.run(otp_routes.register_api(_request())).status_code == 500


@pytest.mark.parametrize(
    ("row", "code", "expected_status"),
    [
        (None, "123456", 400),
        ({"id": "u1", "ma_xac_minh": "654321", "han_xac_minh": 2000}, "123456", 400),
        ({"id": "u1", "ma_xac_minh": "123456", "han_xac_minh": 999}, "123456", 400),
        ({"id": "u1", "ma_xac_minh": "123456", "han_xac_minh": 2000}, "123456", 200),
    ],
)
def test_verify_email_uses_constant_time_code_and_expiry(
    monkeypatch, row, code, expected_status
):
    _install_json(monkeypatch, {"username": "owner", "code": code})
    _install_limits(monkeypatch)
    monkeypatch.setattr(otp_routes.time, "time", lambda: 1000)
    cursor = _Cursor([row])
    connection = _Connection(cursor)
    monkeypatch.setattr(otp_routes.database, "get_connection", lambda: connection)

    response = asyncio.run(otp_routes.verify_email_api(_request()))

    assert response.status_code == expected_status
    if expected_status == 200:
        assert connection.commits == 1
        assert any("SET da_xac_minh = 1" in sql for sql, _ in cursor.calls)


def test_verify_and_resend_rate_limits_and_errors(monkeypatch):
    _install_json(monkeypatch, {"username": "", "code": ""})
    _install_limits(monkeypatch)
    assert asyncio.run(otp_routes.verify_email_api(_request())).status_code == 400
    _install_json(monkeypatch, {"username": ""})
    assert asyncio.run(otp_routes.resend_code_api(_request())).status_code == 400

    _install_json(monkeypatch, {"username": "owner", "code": "123456"})
    _install_limits(monkeypatch, [RateLimitDecision(False, 10, 0), _allowed()])
    assert asyncio.run(otp_routes.verify_email_api(_request())).status_code == 429
    _install_json(monkeypatch, {"username": "owner"})
    _install_limits(monkeypatch, [_allowed(), RateLimitDecision(False, 10, 0)])
    assert asyncio.run(otp_routes.resend_code_api(_request())).status_code == 429

    _install_limits(monkeypatch)
    monkeypatch.setattr(
        otp_routes.database,
        "get_connection",
        lambda: (_ for _ in ()).throw(RuntimeError("secret")),
    )
    assert asyncio.run(otp_routes.resend_code_api(_request())).status_code == 500
    _install_json(monkeypatch, {"username": "owner", "code": "123456"})
    assert asyncio.run(otp_routes.verify_email_api(_request())).status_code == 500


@pytest.mark.parametrize(
    ("row", "expected_status"),
    [
        (None, 400),
        ({"id": "u1", "ho_ten": "Owner", "email": "o@example.test", "da_xac_minh": 1}, 400),
        ({"id": "u1", "ho_ten": "<b>Owner</b>", "email": "o@example.test", "da_xac_minh": 0}, 200),
    ],
)
def test_resend_otp_only_for_unverified_account_and_escapes_name(
    monkeypatch, row, expected_status
):
    _install_json(monkeypatch, {"username": "owner"})
    _install_limits(monkeypatch)
    cursor = _Cursor([row])
    connection = _Connection(cursor)
    monkeypatch.setattr(otp_routes.database, "get_connection", lambda: connection)
    monkeypatch.setattr(otp_routes, "generate_otp", lambda: "123456")
    monkeypatch.setattr(otp_routes.time, "time", lambda: 1000)

    response = asyncio.run(otp_routes.resend_code_api(_request()))

    assert response.status_code == expected_status
    if expected_status == 200:
        body = response.background.tasks[0].args[2]
        assert "<b>Owner</b>" not in body
        assert "&lt;b&gt;Owner&lt;/b&gt;" in body
        assert connection.commits == 1


def test_forgot_password_is_indistinguishable_and_escapes_reset_email(monkeypatch):
    _install_json(
        monkeypatch,
        {"username": "owner", "email": "owner@example.test"},
    )
    _install_limits(monkeypatch)

    async def reset(*args, **kwargs):
        return {
            "token": "token with spaces",
            "name": "<script>",
            "username": "<owner>",
            "email": "owner@example.test",
        }

    monkeypatch.setattr(otp_routes, "run_database_write", reset)
    monkeypatch.setenv("APP_PUBLIC_URL", "https://app.example.test")
    response = asyncio.run(otp_routes.forgot_password_api(_request()))
    assert response.status_code == 200
    assert _body(response)["message"] == otp_routes.PASSWORD_RESET_REQUEST_MESSAGE
    email_body = response.background.tasks[0].args[2]
    assert "<script>" not in email_body
    assert "token%20with%20spaces" in email_body

    async def unknown(*args, **kwargs):
        return None

    monkeypatch.setattr(otp_routes, "run_database_write", unknown)
    response = asyncio.run(otp_routes.forgot_password_api(_request()))
    assert response.status_code == 200
    assert response.background.tasks == []

    async def busy(*args, **kwargs):
        raise BlockingIOBusyError("busy")

    monkeypatch.setattr(otp_routes, "run_database_write", busy)
    assert asyncio.run(otp_routes.forgot_password_api(_request())).status_code == 503


def test_password_reset_revokes_sessions_websockets_and_notifies(monkeypatch):
    token = "x" * 32
    _install_json(
        monkeypatch,
        {"token": token, "new_password": "A long new safe password!"},
    )
    _install_limits(monkeypatch)
    monkeypatch.setattr(
        otp_routes, "validate_new_password", lambda password: (True, None)
    )

    async def hashed(*args, **kwargs):
        return "argon2-hash"

    async def write(*args, **kwargs):
        return "user-1"

    async def recipient(*args, **kwargs):
        return ("owner@example.test", "Owner")

    monkeypatch.setattr(otp_routes, "run_cpu_bound", hashed)
    monkeypatch.setattr(otp_routes, "run_database_write", write)
    monkeypatch.setattr(otp_routes, "run_database_read", recipient)
    invalidated = []
    audits = []
    monkeypatch.setattr(
        otp_routes,
        "_session_cache_invalidate_by_user_id",
        lambda user_id: invalidated.append(user_id),
    )
    monkeypatch.setattr(
        otp_routes,
        "log_audit",
        lambda event, **kwargs: audits.append((event, kwargs)),
    )
    import backend.sync.websocket as websocket

    disconnected = []
    monkeypatch.setattr(
        websocket,
        "disconnect_user_websockets",
        lambda user_id: disconnected.append(user_id),
    )
    monkeypatch.setattr(
        otp_routes,
        "build_security_notification_tasks",
        lambda **kwargs: SimpleNamespace(notification=kwargs),
    )

    response = asyncio.run(otp_routes.reset_password_api(_request()))

    assert response.status_code == 200
    assert invalidated == ["user-1"]
    assert disconnected == ["user-1"]
    assert audits[0][0] == "auth.password_reset"
    assert response.background.notification["email"] == "owner@example.test"


def test_reset_password_expected_and_unexpected_failures(monkeypatch):
    _install_json(
        monkeypatch,
        {"token": "x" * 32, "new_password": "new password"},
    )
    _install_limits(monkeypatch)
    monkeypatch.setattr(
        otp_routes, "validate_new_password", lambda password: (False, "weak")
    )
    assert asyncio.run(otp_routes.reset_password_api(_request())).status_code == 400

    monkeypatch.setattr(
        otp_routes, "validate_new_password", lambda password: (True, None)
    )

    async def fail(error):
        raise error

    monkeypatch.setattr(
        otp_routes,
        "run_cpu_bound",
        lambda *args, **kwargs: fail(BlockingIOBusyError("busy")),
    )
    assert asyncio.run(otp_routes.reset_password_api(_request())).status_code == 503

    async def hashed(*args, **kwargs):
        return "hash"

    monkeypatch.setattr(otp_routes, "run_cpu_bound", hashed)
    monkeypatch.setattr(
        otp_routes,
        "run_database_write",
        lambda *args, **kwargs: fail(InvalidResetToken("bad")),
    )
    response = asyncio.run(otp_routes.reset_password_api(_request()))
    assert _body(response)["code"] == "RESET_TOKEN_INVALID"

    monkeypatch.setattr(
        otp_routes,
        "run_database_write",
        lambda *args, **kwargs: fail(BlockingIOBusyError("busy")),
    )
    assert asyncio.run(otp_routes.reset_password_api(_request())).status_code == 503

    monkeypatch.setattr(
        otp_routes,
        "run_database_write",
        lambda *args, **kwargs: fail(RuntimeError("secret")),
    )
    response = asyncio.run(otp_routes.reset_password_api(_request()))
    assert response.status_code == 500
    assert "secret" not in response.body.decode()
