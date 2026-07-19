import asyncio
import json
from types import SimpleNamespace

import pytest
from starlette.responses import JSONResponse

from backend.auth import auth_routes
from backend.auth.auth_service import RateLimitDecision
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError


def _body(response):
    return json.loads(response.body.decode("utf-8"))


class _Request:
    def __init__(self, data=None, *, token="session-token", headers=None):
        self._data = {} if data is None else data
        self.cookies = {"session_token": token} if token else {}
        self.headers = headers or {"User-Agent": "Browser/1.0"}
        self.query_params = {}
        self.path_params = {}
        self.state = SimpleNamespace()
        self.method = "POST"
        self.url = SimpleNamespace(path="/api/auth/login")

    async def json(self):
        if isinstance(self._data, Exception):
            raise self._data
        return self._data


class _Cursor:
    def __init__(self, handler=None):
        self.handler = handler or (lambda _sql, _params: (None, []))
        self.one = None
        self.all_rows = []
        self.calls = []

    def execute(self, sql, params=()):
        normalized = " ".join(str(sql).split())
        self.calls.append((normalized, tuple(params)))
        result = self.handler(normalized, tuple(params))
        if result is None:
            result = (None, [])
        self.one, self.all_rows = result
        return self

    def fetchone(self):
        return self.one

    def fetchall(self):
        return self.all_rows


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


def _user(**overrides):
    user = {
        "id": "user-1",
        "ten_dang_nhap": "owner",
        "mat_khau": "stored-hash",
        "ho_ten": "Owner",
        "vai_tro": "user",
        "email": "owner@example.test",
        "anh_dai_dien": "avatar.png",
        "da_xac_minh": 1,
        "last_seen_at": 0,
        "device_info": "{}",
    }
    user.update(overrides)
    return user


def test_password_helpers_verify_rehash_and_prepare_email_change(monkeypatch):
    monkeypatch.setattr(auth_routes, "verify_password", lambda stored, value: value == "correct")
    monkeypatch.setattr(auth_routes, "password_needs_rehash", lambda stored: stored == "old")
    monkeypatch.setattr(auth_routes, "hash_password", lambda value: f"hash:{value}")

    assert auth_routes._verify_and_maybe_rehash("old", "correct") == (
        True,
        "hash:correct",
    )
    assert auth_routes._verify_and_maybe_rehash("new", "wrong") == (False, None)
    assert auth_routes._prepare_email_change_credentials("old", "wrong", "123") == (
        False,
        None,
        None,
    )
    assert auth_routes._prepare_email_change_credentials("old", "correct", "123") == (
        True,
        "hash:123",
        "hash:correct",
    )
    assert auth_routes._verify_and_hash_replacement("old", "wrong", "new") == (
        False,
        None,
    )
    assert auth_routes._verify_and_hash_replacement("old", "correct", "new") == (
        True,
        "hash:new",
    )


def test_email_change_notifications_escape_stored_and_submitted_values():
    tasks = auth_routes._email_change_request_tasks(
        old_email="old@example.test",
        new_email="new@example.test",
        display_name="<script>alert(1)</script>",
        code="<123456>",
    )
    assert len(tasks.tasks) == 2
    first_args = tasks.tasks[0].args
    second_args = tasks.tasks[1].args
    assert "<script>" not in first_args[2]
    assert "&lt;script&gt;" in first_args[2]
    assert "&lt;123456&gt;" in first_args[2]
    assert "new@example.test" in second_args[2]
    completed = auth_routes._email_change_completed_tasks(
        old_email="old@example.test", new_email="new@example.test"
    )
    assert len(completed.tasks) == 2


def test_small_database_loaders_close_connections(monkeypatch):
    cursor = _Cursor(lambda sql, _params: (
        ({"id": "user-1"}, []) if "FROM tai_khoan" in sql else (None, [])
    ))
    connection = _Connection(cursor)
    monkeypatch.setattr(auth_routes.database, "get_connection", lambda: connection)
    assert auth_routes._load_login_user("owner") == {"id": "user-1"}
    assert connection.closed == 1


@pytest.mark.parametrize("error_type", [BlockingIOBusyError, BlockingIOTimeoutError])
def test_rate_limit_database_backpressure_fails_closed(monkeypatch, error_type):
    async def unavailable(*_args, **_kwargs):
        raise error_type("busy")

    monkeypatch.setattr(auth_routes, "run_database_write", unavailable)
    decision = asyncio.run(
        auth_routes._get_rate_limit_decision_off_event_loop(
            "bucket", window_seconds=77
        )
    )
    assert decision.allowed is False
    assert decision.storage_failed is True
    assert decision.retry_after == 77


def test_rate_limit_helper_dispatches_to_database_lane(monkeypatch):
    expected = RateLimitDecision(True, 0, 3)

    async def allowed(function, *args, **kwargs):
        assert function is auth_routes.get_rate_limit_decision
        assert args == ("bucket",)
        assert kwargs["consume_attempt"] is False
        return expected

    monkeypatch.setattr(auth_routes, "run_database_write", allowed)
    assert asyncio.run(
        auth_routes._get_rate_limit_decision_off_event_loop(
            "bucket", consume_attempt=False
        )
    ) is expected


def test_commit_successful_login_is_atomic(monkeypatch):
    cursor = _Cursor()
    connection = _Connection(cursor)
    events = []
    monkeypatch.setattr(auth_routes.database, "get_connection", lambda: connection)
    monkeypatch.setattr(
        auth_routes,
        "replace_user_session",
        lambda *args, **kwargs: events.append(("session", kwargs)),
    )
    monkeypatch.setattr(
        auth_routes,
        "build_user_access_payload",
        lambda *_args: {"active_org_id": "org-1", "roles": ["employee"]},
    )
    monkeypatch.setattr(
        auth_routes, "log_audit", lambda event, **kwargs: events.append((event, kwargs))
    )
    monkeypatch.setattr(
        auth_routes, "clear_rate_limit_buckets", lambda *args: events.append(("clear", args))
    )
    monkeypatch.setattr(
        auth_routes,
        "_session_cache_invalidate_by_user_id",
        lambda user_id: events.append(("invalidate", user_id)),
    )

    access = auth_routes._commit_successful_login(
        _user(),
        "replacement-hash",
        "token",
        9999,
        True,
        "{broken-json",
        "org-1",
        _Request(),
        "ip-key",
        "user-key",
    )
    assert access["active_org_id"] == "org-1"
    assert connection.commits == 1
    assert connection.rollbacks == 0
    assert connection.closed == 1
    assert any(sql.startswith("UPDATE tai_khoan SET mat_khau") for sql, _ in cursor.calls)
    session = next(value for key, value in events if key == "session")
    assert "mfa_verified" not in session


def _install_login_defaults(monkeypatch, *, data=None, user=None, verified=True):
    payload = data or {"username": "owner", "password": "correct", "remember": False}
    loaded_user = _user() if user is None else user

    monkeypatch.setattr(auth_routes, "get_client_ip", lambda _request: "203.0.113.9")

    async def read_json(_request):
        return payload, None

    monkeypatch.setattr(auth_routes, "read_json_object", read_json)
    monkeypatch.setattr(auth_routes, "validate_or_response", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(auth_routes, "normalize_username", lambda value: str(value or "").strip())
    monkeypatch.setattr(auth_routes, "validate_password_input", lambda value: bool(value))
    monkeypatch.setattr(auth_routes, "_record_failed_login", lambda *_args: None)

    async def read(function, *args, **_kwargs):
        if function is auth_routes._load_login_user:
            return loaded_user
        raise AssertionError(function)

    async def write(function, *args, **_kwargs):
        if function is auth_routes.get_rate_limit_decision:
            return RateLimitDecision(True, 0, 4)
        if function is auth_routes._commit_successful_login:
            return {"role": "employee", "active_org_id": None}
        raise AssertionError(function)

    async def cpu(*_args, **_kwargs):
        return verified, "new-hash" if verified else None

    monkeypatch.setattr(auth_routes, "run_database_read", read)
    monkeypatch.setattr(auth_routes, "run_database_write", write)
    monkeypatch.setattr(auth_routes, "run_cpu_bound", cpu)
    monkeypatch.setattr(auth_routes, "disconnect_user_websockets", lambda *_args: None)
    return payload


def test_login_success_sets_secure_session_without_device_alert(monkeypatch):
    _install_login_defaults(
        monkeypatch,
        data={"username": "owner", "password": "correct", "remember": True},
    )
    monkeypatch.setattr(auth_routes.uuid, "uuid4", lambda: "session-id")
    disconnected = []
    monkeypatch.setattr(
        auth_routes,
        "disconnect_user_websockets",
        disconnected.append,
    )
    response = asyncio.run(
        auth_routes.login_api(_Request(headers={"User-Agent": "X" * 300, "X-Active-Org": "org%2D1"}))
    )
    payload = _body(response)
    assert response.status_code == 200
    assert "mfa_enrollment_required" not in payload
    assert "mfa_enabled" not in payload
    assert "session_token=session-id" in response.headers["set-cookie"]
    assert response.background is None
    assert disconnected == ["user-1"]


@pytest.mark.parametrize(
    "mode, expected_status",
    [
        ("ip-limit", 429),
        ("json", 422),
        ("schema", 422),
        ("empty", 400),
        ("user-limit", 429),
        ("missing-user", 400),
        ("bad-password", 400),
        ("unverified", 400),
    ],
)
def test_login_rejects_invalid_or_unsafe_states(monkeypatch, mode, expected_status):
    _install_login_defaults(monkeypatch)

    if mode == "json":
        async def json_error(_request):
            return None, JSONResponse({"error": "json"}, status_code=422)
        monkeypatch.setattr(auth_routes, "read_json_object", json_error)
    elif mode == "schema":
        monkeypatch.setattr(
            auth_routes,
            "validate_or_response",
            lambda *_args, **_kwargs: JSONResponse({"error": "schema"}, status_code=422),
        )
    elif mode == "empty":
        monkeypatch.setattr(auth_routes, "normalize_username", lambda _value: "")
    elif mode == "missing-user":
        async def missing(function, *_args, **_kwargs):
            if function is auth_routes._load_login_user:
                return None
            raise AssertionError(function)
        monkeypatch.setattr(auth_routes, "run_database_read", missing)
    elif mode == "bad-password":
        async def bad(*_args, **_kwargs):
            return False, None
        monkeypatch.setattr(auth_routes, "run_cpu_bound", bad)
    elif mode == "unverified":
        async def unverified(function, *_args, **_kwargs):
            if function is auth_routes._load_login_user:
                return _user(da_xac_minh=0)
            raise AssertionError(function)
        monkeypatch.setattr(auth_routes, "run_database_read", unverified)
    elif mode in {"ip-limit", "user-limit"}:
        calls = 0
        async def write(function, *_args, **_kwargs):
            nonlocal calls
            if function is auth_routes.get_rate_limit_decision:
                calls += 1
                allowed = not (mode == "ip-limit" and calls == 1) and not (
                    mode == "user-limit" and calls == 2
                )
                return RateLimitDecision(allowed, 9, 0)
            return {"active_org_id": None}
        monkeypatch.setattr(auth_routes, "run_database_write", write)

    response = asyncio.run(auth_routes.login_api(_Request()))
    assert response.status_code == expected_status
    if mode == "unverified":
        assert _body(response)["unverified"] is True


@pytest.mark.parametrize("stage", ["ip", "user", "read-user", "cpu", "commit"])
@pytest.mark.parametrize("error_type", [BlockingIOBusyError, BlockingIOTimeoutError])
def test_login_handles_all_bounded_executor_backpressure(monkeypatch, stage, error_type):
    _install_login_defaults(monkeypatch)
    write_calls = 0

    async def write(function, *_args, **_kwargs):
        nonlocal write_calls
        if function is auth_routes.get_rate_limit_decision:
            write_calls += 1
            if stage == "ip" and write_calls == 1:
                raise error_type("busy")
            if stage == "user" and write_calls == 2:
                raise error_type("busy")
            return RateLimitDecision(True, 0, 3)
        if stage == "commit":
            raise error_type("busy")
        return {"active_org_id": None}

    async def read(function, *_args, **_kwargs):
        if stage == "read-user" and function is auth_routes._load_login_user:
            raise error_type("busy")
        if function is auth_routes._load_login_user:
            return _user()
        raise AssertionError(function)

    async def cpu(*_args, **_kwargs):
        if stage == "cpu":
            raise error_type("busy")
        return True, None

    monkeypatch.setattr(auth_routes, "run_database_write", write)
    monkeypatch.setattr(auth_routes, "run_database_read", read)
    monkeypatch.setattr(auth_routes, "run_cpu_bound", cpu)
    response = asyncio.run(auth_routes.login_api(_Request()))
    assert response.status_code == 503
    expected = "PASSWORD_CPU_QUEUE_BUSY" if stage == "cpu" else (
        "DATABASE_READ_QUEUE_FULL" if stage.startswith("read") else "DATABASE_WRITE_QUEUE_FULL"
    )
    assert _body(response)["code"] == expected


def test_login_masks_unexpected_exception(monkeypatch):
    monkeypatch.setattr(
        auth_routes,
        "get_client_ip",
        lambda _request: (_ for _ in ()).throw(RuntimeError("secret")),
    )
    logs = []
    monkeypatch.setattr(auth_routes, "log_error", lambda exc, context: logs.append((str(exc), context)))
    response = asyncio.run(auth_routes.login_api(_Request()))
    assert response.status_code == 500
    assert "secret" not in response.body.decode()
    assert logs[0][1] == "login_api"


def test_failed_login_log_uses_irreversible_bucket_identifiers(monkeypatch):
    events = []
    monkeypatch.setattr(
        auth_routes,
        "log_structured_event",
        lambda event, **kwargs: events.append((event, kwargs)),
    )
    auth_routes._record_failed_login("203.0.113.1", "owner@example.test", _Request())
    fields = events[0][1]["fields"]
    assert fields["ipBucket"] != "203.0.113.1"
    assert fields["accountBucket"] != "owner@example.test"
    assert len(fields["ipBucket"]) == 16


def test_session_helpers_load_validate_touch_and_close(monkeypatch):
    user = _user(last_seen_at=0)
    monkeypatch.setattr(auth_routes, "load_session_user", lambda db, token: (db, token))
    monkeypatch.setattr(auth_routes, "session_invalid_reason", lambda value: "expired" if value is None else None)
    assert auth_routes._load_user_by_session_token("token")[1] == "token"
    assert auth_routes._validate_token_expiry("unused", None) == "expired"

    monkeypatch.setattr(auth_routes.time, "time", lambda: 10_000)
    monkeypatch.setattr(auth_routes, "touch_session", lambda *args, **kwargs: kwargs["now"] == 10_000)
    assert auth_routes._extend_session_if_needed(user) is True
    user["last_seen_at"] = 10_000
    assert auth_routes._extend_session_if_needed(user) is False

    connection = _Connection(_Cursor())
    monkeypatch.setattr(auth_routes.database, "get_connection", lambda: connection)
    monkeypatch.setattr(auth_routes, "build_user_access_payload", lambda *_args: {"role": "employee"})
    assert auth_routes._get_access_for_session(user, _Request())["role"] == "employee"
    assert connection.commits == 1
    assert connection.closed == 1


def test_username_setup_state_handles_existing_and_external_accounts(monkeypatch):
    assert auth_routes._get_username_setup_state(_user()) == (False, "", False)
    connection = _Connection(_Cursor())
    monkeypatch.setattr(auth_routes.database, "get_connection", lambda: connection)
    import backend.auth.username_validator as username_validator
    monkeypatch.setattr(username_validator, "generate_suggested_username", lambda *_args: "owner2")
    state = auth_routes._get_username_setup_state(
        _user(ten_dang_nhap="", has_external_identity=True)
    )
    assert state == (True, "owner2", True)
    assert connection.closed == 1


def test_session_bootstrap_and_check_session_cover_valid_invalid_and_error(monkeypatch):
    request = _Request(token="")
    assert auth_routes.build_session_bootstrap(request) == {"valid": False, "reason": "missing_auth"}

    request = _Request()
    monkeypatch.setattr(auth_routes, "_load_user_by_session_token", lambda _token: None)
    monkeypatch.setattr(auth_routes, "_validate_token_expiry", lambda _token, user: "expired" if user is None else None)
    assert auth_routes.build_session_bootstrap(request)["reason"] == "expired"
    assert _body(auth_routes._check_session_sync(request, {}, 0))["reason"] == "expired"

    user = _user()
    cache_sets = []
    monkeypatch.setattr(auth_routes, "_load_user_by_session_token", lambda _token: user)
    monkeypatch.setattr(auth_routes, "_validate_token_expiry", lambda *_args: None)
    monkeypatch.setattr(auth_routes, "_get_username_setup_state", lambda _user: (False, "", False))
    monkeypatch.setattr(auth_routes, "_get_access_for_session", lambda *_args: {"role": "employee"})
    monkeypatch.setattr(auth_routes, "_session_cache_set", lambda *args: cache_sets.append(args))
    monkeypatch.setattr(auth_routes, "_extend_session_if_needed", lambda _user: True)
    bootstrap = auth_routes.build_session_bootstrap(request)
    assert bootstrap["valid"] is True
    response = auth_routes._check_session_sync(request, {}, auth_routes.time.perf_counter())
    assert response.status_code == 200
    assert "session-check;dur=" in response.headers["Server-Timing"]
    assert len(cache_sets) == 2

    request_without_token = _Request(token="")
    assert _body(auth_routes._check_session_sync(request_without_token, {}, 0))["reason"] == "missing_auth"
    monkeypatch.setattr(
        auth_routes,
        "_load_user_by_session_token",
        lambda _token: (_ for _ in ()).throw(RuntimeError("boom")),
    )
    monkeypatch.setattr(auth_routes, "log_error", lambda *_args: None)
    assert auth_routes._check_session_sync(request, {}, 0).status_code == 500


def test_check_session_async_handles_bad_json_validation_and_backpressure(monkeypatch):
    request = _Request(ValueError("bad json"))
    monkeypatch.setattr(auth_routes, "validate_or_response", lambda *_args, **_kwargs: None)

    async def read(function, *args, **kwargs):
        assert function is auth_routes._check_session_sync
        assert args[1] == {}
        return JSONResponse({"valid": True})

    monkeypatch.setattr(auth_routes, "run_database_read", read)
    assert asyncio.run(auth_routes.check_session_api(request)).status_code == 200

    monkeypatch.setattr(
        auth_routes,
        "validate_or_response",
        lambda *_args, **_kwargs: JSONResponse({"error": "bad"}, status_code=422),
    )
    assert asyncio.run(auth_routes.check_session_api(_Request())).status_code == 422

    monkeypatch.setattr(auth_routes, "validate_or_response", lambda *_args, **_kwargs: None)
    for error_type in (BlockingIOBusyError, BlockingIOTimeoutError):
        async def unavailable(*_args, _error=error_type, **_kwargs):
            raise _error("busy")
        monkeypatch.setattr(auth_routes, "run_database_read", unavailable)
        response = asyncio.run(auth_routes.check_session_api(_Request()))
        assert response.status_code == 503
        assert _body(response)["code"] == "DATABASE_READ_QUEUE_FULL"


def test_active_org_hint_decodes_header_and_database_error_messages_are_utf8():
    assert auth_routes._active_org_hint(_Request(headers={"X-Active-Org": "org%2D1"})) == "org-1"
    assert auth_routes._active_org_hint(_Request(headers={})) is None
    response = auth_routes._database_lane_unavailable_response(_Request(), write=False)
    assert "Hệ thống đang xử lý" in _body(response)["message"]
    assert response.headers["Retry-After"] == "1"
