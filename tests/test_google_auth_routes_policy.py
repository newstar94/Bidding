import asyncio
import json
import time
import urllib.error
from types import SimpleNamespace

import pytest
from starlette.responses import JSONResponse

from backend.auth import google_auth_routes
from backend.auth.auth_service import RateLimitDecision
from backend.auth.profile_validation import ProfileValidationError
from backend.db.db_helper import DatabaseError, IntegrityError
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError


def _body(response):
    return json.loads(response.body.decode("utf-8"))


def _request():
    return SimpleNamespace(
        headers={
            "User-Agent": "Browser/1.0",
            "X-Active-Org": "org%2D1",
        },
        cookies={},
        state=SimpleNamespace(),
        method="POST",
        url=SimpleNamespace(path="/api/auth/google"),
    )


class _TokenResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        if isinstance(self.payload, bytes):
            return self.payload
        return json.dumps(self.payload).encode()


class _GoogleCursor:
    def __init__(self, *, identity_user=None, email_user=None, new_user=None):
        self.identity_user = identity_user
        self.email_user = email_user
        self.new_user = new_user
        self.last_sql = ""
        self.calls = []

    def execute(self, sql, params=()):
        self.last_sql = " ".join(str(sql).split())
        self.calls.append((self.last_sql, tuple(params)))
        return self

    def fetchone(self):
        if "FROM dinh_danh_ngoai" in self.last_sql:
            return self.identity_user
        if "WHERE email_norm = ?" in self.last_sql:
            return self.email_user
        if "WHERE id = ?" in self.last_sql:
            return self.new_user
        return None


class _Connection:
    def __init__(self, cursor, *, close_error=False):
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


def _google_payload(**overrides):
    payload = {
        "aud": "client-id",
        "iss": "https://accounts.google.com",
        "exp": int(time.time()) + 3600,
        "sub": "google-subject",
        "email": "owner@example.test",
        "email_verified": True,
        "name": "Owner",
        "picture": "https://images.example.test/avatar.png",
    }
    payload.update(overrides)
    return payload


def _user(**overrides):
    user = {
        "id": "user-1",
        "ten_dang_nhap": "owner",
        "mat_khau": "hash",
        "ho_ten": "Owner",
        "vai_tro": "user",
        "email": "owner@example.test",
        "email_norm": "owner@example.test",
        "anh_dai_dien": "",
        "da_xac_minh": 1,
        "username_da_dat": 1,
    }
    user.update(overrides)
    return user


def test_verify_google_token_enforces_configuration_issuer_audience_and_expiry(
    monkeypatch,
):
    monkeypatch.setattr(google_auth_routes, "GOOGLE_CLIENT_ID", "")
    assert google_auth_routes._verify_google_token("token") is None

    monkeypatch.setattr(google_auth_routes, "GOOGLE_CLIENT_ID", "client-id")
    monkeypatch.setattr(
        google_auth_routes,
        "open_allowlisted_https",
        lambda *args, **kwargs: _TokenResponse(_google_payload()),
    )
    assert google_auth_routes._verify_google_token("token")["sub"] == "google-subject"

    for payload in (
        _google_payload(aud="other-client"),
        _google_payload(iss="https://attacker.example"),
        _google_payload(exp=0),
        _google_payload(exp="not-a-number"),
    ):
        monkeypatch.setattr(
            google_auth_routes,
            "open_allowlisted_https",
            lambda *args, _payload=payload, **kwargs: _TokenResponse(_payload),
        )
        assert google_auth_routes._verify_google_token("token") is None

    for failure in (
        urllib.error.URLError("network"),
        urllib.error.HTTPError("https://x", 500, "bad", {}, None),
    ):
        monkeypatch.setattr(
            google_auth_routes,
            "open_allowlisted_https",
            lambda *args, _failure=failure, **kwargs: (_ for _ in ()).throw(
                _failure
            ),
        )
        assert google_auth_routes._verify_google_token("token") is None
    monkeypatch.setattr(
        google_auth_routes,
        "open_allowlisted_https",
        lambda *args, **kwargs: _TokenResponse(b"{broken"),
    )
    assert google_auth_routes._verify_google_token("token") is None


def test_google_rate_limit_fails_closed_when_write_queue_is_busy(monkeypatch):
    async def busy(*args, **kwargs):
        raise BlockingIOBusyError("busy")

    monkeypatch.setattr(google_auth_routes, "run_database_write", busy)
    decision = asyncio.run(
        google_auth_routes._rate_limit_decision(
            "google:ip", window_seconds=90
        )
    )
    assert decision.allowed is False
    assert decision.retry_after == 90
    assert decision.storage_failed is True

    async def allowed(*args, **kwargs):
        return RateLimitDecision(True, 0, 4)

    monkeypatch.setattr(google_auth_routes, "run_database_write", allowed)
    assert asyncio.run(
        google_auth_routes._rate_limit_decision("google:ip")
    ).allowed is True


def test_temporary_password_email_and_background_audit_escape_content(monkeypatch):
    subject, body = google_auth_routes._temporary_password_email(
        "<script>alert(1)</script>",
        "owner+<tag>@example.test",
        "<unsafe-password>",
    )
    assert "Mật khẩu tạm" in subject
    assert "<script>" not in body
    assert "<unsafe-password>" not in body
    assert "&lt;script&gt;" in body
    assert "&lt;unsafe-password&gt;" in body

    tasks = google_auth_routes._add_background_audit(
        None, "auth.test", actor_user_id="user-1"
    )
    same = google_auth_routes._add_background_audit(
        tasks, "auth.test.2", actor_user_id="user-1"
    )
    assert same is tasks
    assert len(tasks.tasks) == 2


def _install_common(
    monkeypatch,
    *,
    token_payload=None,
    connection=None,
    delivery_result=True,
):
    monkeypatch.setattr(google_auth_routes, "GOOGLE_CLIENT_ID", "client-id")
    monkeypatch.setattr(google_auth_routes, "get_client_ip", lambda request: "203.0.113.1")

    async def allowed(*args, **kwargs):
        return RateLimitDecision(True, 0, 4)

    async def read_json(_request):
        return {"credential": "google-token"}, None

    async def blocking(function, *args, **kwargs):
        if function is google_auth_routes._verify_google_token:
            return token_payload or _google_payload()
        if function is google_auth_routes.deliver_email_once:
            return delivery_result
        return function(*args)

    monkeypatch.setattr(google_auth_routes, "_rate_limit_decision", allowed)
    monkeypatch.setattr(google_auth_routes, "read_json_object", read_json)
    monkeypatch.setattr(
        google_auth_routes, "validate_or_response", lambda *args, **kwargs: None
    )
    monkeypatch.setattr(google_auth_routes, "run_blocking_io", blocking)
    monkeypatch.setattr(
        google_auth_routes,
        "validate_profile_fields",
        lambda name, email, picture: (str(name), str(email), str(picture)),
    )
    monkeypatch.setattr(google_auth_routes, "is_mfa_enabled", lambda *args: False)
    monkeypatch.setattr(
        google_auth_routes,
        "device_fingerprint",
        lambda user_agent: "fingerprint",
    )
    monkeypatch.setattr(google_auth_routes, "is_new_device", lambda *args: False)
    monkeypatch.setattr(google_auth_routes, "create_session", lambda *args, **kwargs: "session")
    monkeypatch.setattr(
        google_auth_routes,
        "_session_cache_invalidate_by_user_id",
        lambda *_args: None,
    )
    monkeypatch.setattr(
        google_auth_routes,
        "build_user_access_payload",
        lambda cursor, user_id, role, hint, name: {
            "active_org_id": hint or f"personal:{user_id}",
            "organizations": [],
            "role": role,
        },
    )
    monkeypatch.setattr(
        google_auth_routes, "clear_rate_limit_buckets", lambda *args: None
    )
    monkeypatch.setattr(
        google_auth_routes,
        "generate_suggested_username",
        lambda *args: "owner1",
    )
    monkeypatch.setattr(
        google_auth_routes,
        "build_security_notification_tasks",
        lambda **kwargs: None,
    )
    monkeypatch.setattr(
        google_auth_routes, "log_audit", lambda *args, **kwargs: None
    )
    if connection is not None:
        monkeypatch.setattr(
            google_auth_routes.database,
            "get_connection",
            lambda: connection,
        )


def test_google_login_preconditions_and_untrusted_token_fail_closed(monkeypatch):
    request = _request()
    _install_common(monkeypatch)

    async def denied(*args, **kwargs):
        return RateLimitDecision(False, 30, 0)

    monkeypatch.setattr(google_auth_routes, "_rate_limit_decision", denied)
    assert asyncio.run(google_auth_routes.google_login_api(request)).status_code == 429

    _install_common(monkeypatch)
    monkeypatch.setattr(google_auth_routes, "GOOGLE_CLIENT_ID", "")
    assert asyncio.run(google_auth_routes.google_login_api(request)).status_code == 503

    _install_common(monkeypatch)
    json_error = JSONResponse({"error": "bad json"}, status_code=400)

    async def bad_json(_request):
        return None, json_error

    monkeypatch.setattr(google_auth_routes, "read_json_object", bad_json)
    assert asyncio.run(google_auth_routes.google_login_api(request)) is json_error

    _install_common(monkeypatch)
    schema_error = JSONResponse({"error": "schema"}, status_code=422)
    monkeypatch.setattr(
        google_auth_routes,
        "validate_or_response",
        lambda *args, **kwargs: schema_error,
    )
    assert asyncio.run(google_auth_routes.google_login_api(request)) is schema_error

    _install_common(monkeypatch)

    async def empty(_request):
        return {"credential": "   "}, None

    monkeypatch.setattr(google_auth_routes, "read_json_object", empty)
    assert asyncio.run(google_auth_routes.google_login_api(request)).status_code == 400

    _install_common(monkeypatch)

    async def upstream_busy(*args, **kwargs):
        raise BlockingIOTimeoutError("timeout")

    monkeypatch.setattr(google_auth_routes, "run_blocking_io", upstream_busy)
    response = asyncio.run(google_auth_routes.google_login_api(request))
    assert response.status_code == 503
    assert _body(response)["code"] == "GOOGLE_AUTH_UPSTREAM_BUSY"

    _install_common(monkeypatch, token_payload={})

    async def invalid_token(*args, **kwargs):
        return None

    monkeypatch.setattr(google_auth_routes, "run_blocking_io", invalid_token)
    assert asyncio.run(google_auth_routes.google_login_api(request)).status_code == 401


@pytest.mark.parametrize(
    "payload",
    [
        _google_payload(sub=""),
        _google_payload(email=""),
        _google_payload(email_verified=False),
        _google_payload(sub="x" * 256),
    ],
)
def test_google_claim_validation_rejects_invalid_identity(monkeypatch, payload):
    _install_common(monkeypatch, token_payload=payload)

    response = asyncio.run(google_auth_routes.google_login_api(_request()))

    assert response.status_code == 400


def test_google_profile_validation_error_is_stable(monkeypatch):
    _install_common(monkeypatch)
    monkeypatch.setattr(
        google_auth_routes,
        "validate_profile_fields",
        lambda *args: (_ for _ in ()).throw(
            ProfileValidationError("bad profile", code="INVALID_PROFILE")
        ),
    )

    response = asyncio.run(google_auth_routes.google_login_api(_request()))

    assert response.status_code == 400
    assert _body(response)["code"] == "INVALID_PROFILE"


def test_existing_google_identity_logs_in_without_recreating_or_emailing(monkeypatch):
    cursor = _GoogleCursor(identity_user=_user(da_xac_minh=0))
    connection = _Connection(cursor)
    _install_common(monkeypatch, connection=connection)
    sessions = []
    monkeypatch.setattr(
        google_auth_routes,
        "create_session",
        lambda *args, **kwargs: sessions.append(kwargs),
    )

    response = asyncio.run(google_auth_routes.google_login_api(_request()))
    payload = _body(response)

    assert response.status_code == 200
    assert payload["is_new_account"] is False
    assert payload["account_linked"] is False
    assert payload["temporary_password_sent"] is False
    assert payload["active_org_id"] == "org-1"
    assert "session_token=" in response.headers["set-cookie"]
    assert sessions[0]["user_id"] == "user-1"
    assert connection.commits == 1
    assert any("SET da_xac_minh = 1" in sql for sql, _ in cursor.calls)


@pytest.mark.parametrize("username", ["existing", None])
def test_google_email_match_links_existing_account(monkeypatch, username):
    existing = _user(
        ten_dang_nhap=username,
        username_da_dat=0,
        anh_dai_dien="",
    )
    cursor = _GoogleCursor(identity_user=None, email_user=existing)
    connection = _Connection(cursor)
    _install_common(monkeypatch, connection=connection)

    response = asyncio.run(google_auth_routes.google_login_api(_request()))
    payload = _body(response)

    assert response.status_code == 200
    assert payload["account_linked"] is True
    assert payload["is_new_account"] is False
    assert payload["needs_username"] is (username is None)
    assert any("INSERT INTO dinh_danh_ngoai" in sql for sql, _ in cursor.calls)
    assert any("UPDATE tai_khoan SET anh_dai_dien" in sql for sql, _ in cursor.calls)


def test_new_google_account_hashes_and_sends_temporary_password_once(monkeypatch):
    new_user = _user(
        id="new-user",
        ten_dang_nhap=None,
        username_da_dat=0,
        anh_dai_dien="https://images.example.test/avatar.png",
    )
    cursor = _GoogleCursor(new_user=new_user)
    connection = _Connection(cursor)
    _install_common(monkeypatch, connection=connection, delivery_result=True)
    clear_passwords = []
    deliveries = []

    async def hash_password(function, password, **kwargs):
        clear_passwords.append(password)
        return "argon2-hash"

    monkeypatch.setattr(google_auth_routes, "run_cpu_bound", hash_password)
    monkeypatch.setattr(
        google_auth_routes,
        "generate_record_id",
        lambda prefix: "new-user",
    )

    def create_delivery(cursor, **kwargs):
        deliveries.append(kwargs)
        return "delivery-1"

    monkeypatch.setattr(
        google_auth_routes, "create_email_delivery", create_delivery
    )

    response = asyncio.run(google_auth_routes.google_login_api(_request()))
    payload = _body(response)

    assert response.status_code == 200
    assert payload["is_new_account"] is True
    assert payload["temporary_password_sent"] is True
    assert payload["needs_username"] is True
    assert payload["suggested_username"] == "owner1"
    assert clear_passwords and len(clear_passwords[0]) >= 12
    assert clear_passwords[0] in deliveries[0]["html_body"]
    assert clear_passwords[0] not in response.body.decode()
    insert_account = next(
        params for sql, params in cursor.calls if "INSERT INTO tai_khoan" in sql
    )
    assert insert_account[1] == "argon2-hash"
    assert connection.commits == 1


@pytest.mark.parametrize(
    "delivery_error",
    [BlockingIOBusyError("busy"), BlockingIOTimeoutError("timeout")],
)
def test_temporary_password_delivery_queue_failure_does_not_rollback_account(
    monkeypatch, delivery_error
):
    new_user = _user(id="new-user", ten_dang_nhap=None)
    cursor = _GoogleCursor(new_user=new_user)
    connection = _Connection(cursor)
    _install_common(monkeypatch, connection=connection)

    async def blocking(function, *args, **kwargs):
        if function is google_auth_routes._verify_google_token:
            return _google_payload()
        raise delivery_error

    async def hash_password(*args, **kwargs):
        return "hash"

    monkeypatch.setattr(google_auth_routes, "run_blocking_io", blocking)
    monkeypatch.setattr(google_auth_routes, "run_cpu_bound", hash_password)
    monkeypatch.setattr(google_auth_routes, "generate_record_id", lambda prefix: "new-user")
    monkeypatch.setattr(
        google_auth_routes, "create_email_delivery", lambda *args, **kwargs: "delivery-1"
    )

    response = asyncio.run(google_auth_routes.google_login_api(_request()))

    assert response.status_code == 200
    assert _body(response)["temporary_password_sent"] is False
    assert connection.commits == 1
    assert connection.rollbacks == 0


def test_password_cpu_queue_failure_rolls_back_new_account(monkeypatch):
    cursor = _GoogleCursor(new_user=_user(id="new-user", ten_dang_nhap=None))
    connection = _Connection(cursor)
    _install_common(monkeypatch, connection=connection)

    async def busy(*args, **kwargs):
        raise BlockingIOBusyError("busy")

    monkeypatch.setattr(google_auth_routes, "run_cpu_bound", busy)
    response = asyncio.run(google_auth_routes.google_login_api(_request()))

    assert response.status_code == 503
    assert response.headers["retry-after"] == "1"
    assert connection.rollbacks == 1


@pytest.mark.parametrize(
    ("policy_required", "mfa_enabled", "expected_status"),
    [
        (True, False, 403),
        (False, True, 403),
        (False, False, 200),
    ],
)
def test_google_login_requires_password_flow_for_mfa_accounts(
    monkeypatch, policy_required, mfa_enabled, expected_status
):
    user = _user(vai_tro="super_admin" if policy_required else "user")
    cursor = _GoogleCursor(identity_user=user)
    connection = _Connection(cursor)
    _install_common(monkeypatch, connection=connection)
    monkeypatch.setattr(
        google_auth_routes,
        "is_mfa_enabled",
        lambda *args: mfa_enabled,
    )
    monkeypatch.setattr(
        google_auth_routes,
        "is_mfa_required_for_role",
        lambda *args: policy_required,
    )

    response = asyncio.run(google_auth_routes.google_login_api(_request()))

    assert response.status_code == expected_status
    if expected_status == 403:
        assert _body(response)["code"] == "MFA_PASSWORD_LOGIN_REQUIRED"
        assert connection.rollbacks == 1
    else:
        assert _body(response)["success"] is True
        assert connection.commits == 1


def test_new_device_notification_is_added_without_exposing_identity(monkeypatch):
    cursor = _GoogleCursor(identity_user=_user())
    connection = _Connection(cursor)
    _install_common(monkeypatch, connection=connection)
    monkeypatch.setattr(google_auth_routes, "is_new_device", lambda *args: True)
    notification = google_auth_routes.BackgroundTasks()
    notification.add_task(lambda: None)
    monkeypatch.setattr(
        google_auth_routes,
        "build_security_notification_tasks",
        lambda **kwargs: notification,
    )

    response = asyncio.run(google_auth_routes.google_login_api(_request()))

    assert response.status_code == 200
    assert response.background is not None
    assert len(response.background.tasks) >= 2


def test_google_login_conflicts_and_unexpected_errors_are_rollback_safe(monkeypatch):
    cursor = _GoogleCursor(identity_user=_user())
    connection = _Connection(cursor, close_error=True)
    _install_common(monkeypatch, connection=connection)
    logs = []
    monkeypatch.setattr(
        google_auth_routes, "log_error", lambda exc, context: logs.append(context)
    )
    monkeypatch.setattr(
        google_auth_routes,
        "create_session",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            IntegrityError("unique conflict")
        ),
    )
    monkeypatch.setattr(
        google_auth_routes,
        "identity_conflict_code",
        lambda exc: "EMAIL_ALREADY_LINKED",
    )
    monkeypatch.setattr(
        google_auth_routes,
        "conflict_payload",
        lambda code: {"error": "conflict", "code": code},
    )
    response = asyncio.run(google_auth_routes.google_login_api(_request()))
    assert response.status_code == 409
    assert _body(response)["code"] == "EMAIL_ALREADY_LINKED"
    assert connection.rollbacks == 1

    connection.close_error = False
    monkeypatch.setattr(
        google_auth_routes, "identity_conflict_code", lambda exc: None
    )
    response = asyncio.run(google_auth_routes.google_login_api(_request()))
    assert response.status_code == 409
    assert "google_login_api_integrity" in logs

    monkeypatch.setattr(
        google_auth_routes,
        "create_session",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            RuntimeError("database secret")
        ),
    )
    response = asyncio.run(google_auth_routes.google_login_api(_request()))
    assert response.status_code == 500
    assert "database secret" not in response.body.decode()
    assert "google_login_api" in logs
