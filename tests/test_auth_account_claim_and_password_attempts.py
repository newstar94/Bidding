import asyncio
import hashlib
import json
import re
import sqlite3
import time
from http.cookies import SimpleCookie

import pytest
from cryptography.fernet import Fernet
from starlette.requests import Request

from backend.auth import auth_helper, auth_routes, auth_service, google_auth_routes
from backend.auth.email_delivery_service import _decrypt
from backend.auth.password_reset_service import (
    InvalidResetToken,
    create_password_reset,
    create_password_setup_token,
    redeem_password_reset,
)
from backend.auth.session_store import create_session, load_session_user, session_invalid_reason


class _Cursor:
    def __init__(self, cursor):
        self.cursor = cursor

    def execute(self, sql, parameters=()):
        # SQLite exercises persistence and rollback, not PostgreSQL row-lock
        # concurrency; only the PostgreSQL lock syntax is removed here.
        sql = re.sub(r"\s+FOR UPDATE(?: OF [\w, ]+)?\s*$", "", sql)
        self.cursor.execute(sql, parameters)
        return self

    def __getattr__(self, name):
        return getattr(self.cursor, name)


class _Connection:
    def __init__(self, connection):
        self.connection = connection

    def execute(self, sql, parameters=()):
        return self.cursor().execute(sql, parameters)

    def cursor(self):
        return _Cursor(self.connection.cursor())

    def __getattr__(self, name):
        return getattr(self.connection, name)


class _Database:
    def __init__(self, path):
        self.path = path

    def get_connection(self):
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        connection.create_function("LEAST", 2, min)
        return _Connection(connection)

    def rows(self, sql, parameters=()):
        connection = self.get_connection()
        try:
            return [dict(row) for row in connection.execute(sql, parameters).fetchall()]
        finally:
            connection.close()


def _legacy_hash(password):
    salt = "regression-salt"
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000).hex()
    return f"pbkdf2_sha256$100000${salt}${digest}"


def _request(data, *, token=None, ip="192.0.2.1"):
    body = json.dumps(data).encode()
    headers = [(b"content-type", b"application/json")]
    if token:
        headers.append((b"cookie", f"session_token={token}".encode()))

    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    return Request(
        {
            "type": "http", "method": "POST", "scheme": "http", "path": "/auth-test",
            "query_string": b"", "headers": headers, "client": (ip, 12345),
            "server": ("testserver", 80),
        },
        receive,
    )


def _response_token(response):
    for header in response.headers.getlist("set-cookie"):
        cookie = SimpleCookie()
        cookie.load(header)
        if "session_token" in cookie:
            return cookie["session_token"].value
    raise AssertionError("Session cookie is missing")


@pytest.fixture
def auth_database(tmp_path, monkeypatch):
    database = _Database(tmp_path / "auth-boundaries.sqlite")
    connection = database.get_connection()
    connection.executescript(
        """
        CREATE TABLE tai_khoan (
            id TEXT PRIMARY KEY, ten_dang_nhap TEXT, username_norm TEXT,
            mat_khau TEXT NOT NULL, ho_ten TEXT, vai_tro TEXT DEFAULT 'user',
            email TEXT, email_norm TEXT UNIQUE, anh_dai_dien TEXT,
            da_xac_minh INTEGER DEFAULT 0, registration_verified_at INTEGER,
            username_da_dat INTEGER DEFAULT 0, trang_thai TEXT DEFAULT 'active'
        );
        CREATE TABLE dinh_danh_ngoai (
            issuer TEXT, subject TEXT, user_id TEXT, email_norm TEXT,
            UNIQUE(issuer, subject)
        );
        CREATE TABLE auth_sessions (
            id TEXT PRIMARY KEY, user_id TEXT, token_hash TEXT UNIQUE,
            created_at INTEGER, last_seen_at INTEGER, idle_expires_at INTEGER,
            absolute_expires_at INTEGER, revoked_at INTEGER, remember_me INTEGER,
            device_info TEXT, privileged_reauth_at INTEGER, active_role TEXT,
            active_role_organization_id TEXT
        );
        CREATE UNIQUE INDEX one_active_session ON auth_sessions(user_id)
            WHERE revoked_at IS NULL;
        CREATE TABLE password_reset_tokens (
            id TEXT PRIMARY KEY, user_id TEXT, token_hash TEXT, expires_at INTEGER,
            used_at INTEGER, requested_ip TEXT, created_at INTEGER
        );
        CREATE TABLE email_delivery_status (
            id TEXT PRIMARY KEY, user_id TEXT, purpose TEXT, recipient_hash TEXT,
            recipient_ciphertext TEXT, subject_ciphertext TEXT, body_ciphertext TEXT,
            sensitive_content INTEGER, status TEXT, attempt_count INTEGER,
            next_attempt_at INTEGER, created_at INTEGER, updated_at INTEGER
        );
        CREATE TABLE rate_limit_buckets (
            bucket_key TEXT PRIMARY KEY, window_started_at INTEGER,
            attempt_count INTEGER, expires_at INTEGER
        );
        CREATE TABLE audit_events (action TEXT, user_id TEXT);
        CREATE TABLE pending_email_changes (
            user_id TEXT PRIMARY KEY, current_email_norm TEXT, pending_email TEXT,
            pending_email_norm TEXT UNIQUE, otp_hash TEXT, requested_at INTEGER,
            expires_at INTEGER, verified_at INTEGER, requested_ip TEXT
        );
        CREATE TABLE thanh_vien_to_chuc (user_id TEXT, organization_id TEXT);
        """
    )
    connection.commit()
    connection.close()

    def audit(action, *, actor_user_id=None, cursor=None, required=False, **_kwargs):
        assert required is True
        cursor.execute("INSERT INTO audit_events VALUES (?, ?)", (action, actor_user_id))

    monkeypatch.setattr(auth_routes, "database", database)
    monkeypatch.setattr(google_auth_routes, "database", database)
    monkeypatch.setattr(auth_helper, "database", database)
    monkeypatch.setattr(auth_service, "_get_rate_limit_database", lambda: database)
    monkeypatch.setattr(auth_routes, "log_audit", audit)
    monkeypatch.setattr(google_auth_routes, "log_audit", audit)
    monkeypatch.setattr(auth_routes, "log_error", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(google_auth_routes, "log_error", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(auth_routes, "disconnect_user_websockets", lambda *_args: None)
    monkeypatch.setattr(google_auth_routes, "disconnect_user_websockets", lambda *_args: None)
    monkeypatch.setattr(auth_routes, "build_security_notification_tasks", lambda **_kwargs: None)
    monkeypatch.setattr(auth_routes, "enqueue_websocket_event", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(auth_routes, "_email_change_request_tasks", lambda **_kwargs: None)
    monkeypatch.setattr(auth_routes, "_email_change_completed_tasks", lambda **_kwargs: None)
    monkeypatch.setenv("EMAIL_OUTBOX_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("TRUSTED_PROXY_CIDRS", "")
    monkeypatch.setenv("APP_PUBLIC_URL", "https://app.example.test")
    monkeypatch.setattr(google_auth_routes, "GOOGLE_CLIENT_ID", "test-client")
    monkeypatch.setattr(google_auth_routes, "ensure_personal_word_workspace", lambda *_args: None)
    monkeypatch.setattr(google_auth_routes, "generate_suggested_username", lambda *_args: "suggested")
    monkeypatch.setattr(
        google_auth_routes, "build_user_access_payload", lambda *_args: {"active_org_id": None}
    )
    monkeypatch.setattr(
        google_auth_routes,
        "_verify_google_token",
        lambda _token: {
            "sub": "google-subject", "email": "owner@example.test", "name": "Owner",
            "picture": "", "email_verified": True,
        },
    )
    return database


def _add_account(database, *, user_id="user-1", verified=True, linked=False):
    connection = database.get_connection()
    try:
        connection.execute(
            """INSERT INTO tai_khoan (
                id, ten_dang_nhap, username_norm, mat_khau, ho_ten, email, email_norm,
                da_xac_minh, username_da_dat
            ) VALUES (?, ?, ?, ?, 'Owner', ?, ?, ?, 1)""",
            (user_id, user_id, user_id, _legacy_hash("preclaimed-password"),
             "owner@example.test" if user_id == "user-1" else f"{user_id}@example.test",
             "owner@example.test" if user_id == "user-1" else f"{user_id}@example.test",
             int(verified)),
        )
        if linked:
            connection.execute(
                "INSERT INTO dinh_danh_ngoai VALUES (?, ?, ?, ?)",
                ("https://accounts.google.com", "google-subject", user_id, "owner@example.test"),
            )
        create_session(
            connection, user_id=user_id, token=f"old-{user_id}",
            absolute_expires_at=int(time.time()) + 3_600, idle_timeout_seconds=3_600,
        )
        connection.commit()
    finally:
        connection.close()


def _setup_token_from_outbox(database):
    delivery = database.rows("SELECT * FROM email_delivery_status")[0]
    assert delivery["purpose"] == "google_password_setup"
    assert _decrypt(delivery["recipient_ciphertext"]) == "owner@example.test"
    return re.search(r"reset-password#token=([^\"<]+)", _decrypt(delivery["body_ciphertext"])).group(1)


@pytest.mark.parametrize("linked", [False, True])
def test_google_promotion_discards_preclaimed_password_and_rotates_recovery_and_session(
    auth_database, linked,
):
    _add_account(auth_database, verified=False, linked=linked)
    connection = auth_database.get_connection()
    old_reset = create_password_setup_token(connection, "user-1")
    connection.commit()
    connection.close()

    response = asyncio.run(google_auth_routes.google_login_api(_request({"credential": "google-proof"})))

    assert response.status_code == 200
    account = auth_database.rows("SELECT * FROM tai_khoan")[0]
    assert account["da_xac_minh"] == 1
    assert account["registration_verified_at"] is not None
    assert account["mat_khau"] == "!google-external-only!"
    assert auth_helper.verify_password(account["mat_khau"], "preclaimed-password") is False
    assert len(auth_database.rows("SELECT * FROM dinh_danh_ngoai")) == 1
    payload = json.loads(response.body)
    assert payload["account_linked"] is (not linked)
    assert payload["is_new_account"] is False
    assert payload["password_setup_queued"] is True
    assert len(response.background.tasks) == 1
    assert session_invalid_reason(load_session_user(auth_database, "old-user-1")) == "session_revoked"
    new_session = _response_token(response)
    assert session_invalid_reason(load_session_user(auth_database, new_session)) is None
    with pytest.raises(InvalidResetToken):
        redeem_password_reset(auth_database, old_reset["token"], "unused", password_hash="unused")

    setup_token = _setup_token_from_outbox(auth_database)
    assert redeem_password_reset(
        auth_database, setup_token, "unused", password_hash=_legacy_hash("owner-password"),
        audit=google_auth_routes.log_audit,
    ) == "user-1"
    assert session_invalid_reason(load_session_user(auth_database, new_session)) == "session_revoked"
    assert auth_helper.verify_password(
        auth_database.rows("SELECT mat_khau FROM tai_khoan")[0]["mat_khau"], "owner-password"
    ) is True
    with pytest.raises(InvalidResetToken):
        redeem_password_reset(auth_database, setup_token, "unused", password_hash="unused")


@pytest.mark.parametrize("linked", [False, True])
def test_google_verified_account_keeps_existing_password_and_recovery(auth_database, linked):
    _add_account(auth_database, linked=linked)
    existing_hash = auth_database.rows("SELECT mat_khau FROM tai_khoan")[0]["mat_khau"]
    connection = auth_database.get_connection()
    existing_reset = create_password_setup_token(connection, "user-1")
    connection.commit()
    connection.close()

    response = asyncio.run(google_auth_routes.google_login_api(_request({"credential": "google-proof"})))

    assert response.status_code == 200
    assert auth_database.rows("SELECT mat_khau FROM tai_khoan")[0]["mat_khau"] == existing_hash
    assert auth_database.rows("SELECT * FROM email_delivery_status") == []
    assert auth_database.rows("SELECT used_at FROM password_reset_tokens")[0]["used_at"] is None
    assert json.loads(response.body)["password_setup_queued"] is False
    assert existing_reset["token"]


def test_google_new_account_still_gets_password_setup_and_session(auth_database):
    response = asyncio.run(google_auth_routes.google_login_api(_request({"credential": "google-proof"})))

    assert response.status_code == 200
    account = auth_database.rows("SELECT * FROM tai_khoan")[0]
    assert account["da_xac_minh"] == 1
    assert account["mat_khau"] == "!google-external-only!"
    assert json.loads(response.body)["is_new_account"] is True
    assert json.loads(response.body)["password_setup_queued"] is True
    assert _setup_token_from_outbox(auth_database)
    assert session_invalid_reason(load_session_user(auth_database, _response_token(response))) is None


def test_google_promotion_setup_delivery_uses_matching_canonical_email(auth_database):
    _add_account(auth_database, verified=False)
    connection = auth_database.get_connection()
    connection.execute("UPDATE tai_khoan SET email = 'Owner@Example.Test' WHERE id = 'user-1'")
    connection.commit()
    connection.close()

    response = asyncio.run(google_auth_routes.google_login_api(_request({"credential": "google-proof"})))

    assert response.status_code == 200
    delivery = auth_database.rows("SELECT * FROM email_delivery_status")[0]
    assert _decrypt(delivery["recipient_ciphertext"]) == "Owner@Example.Test"
    assert json.loads(response.body)["email"] == "Owner@Example.Test"


def test_google_promotion_rolls_back_password_recovery_and_session_if_audit_fails(
    auth_database, monkeypatch,
):
    _add_account(auth_database, verified=False)
    original_audit = google_auth_routes.log_audit

    def fail_login_audit(action, **kwargs):
        if action == "auth.google_login_success":
            raise RuntimeError("audit unavailable")
        return original_audit(action, **kwargs)

    monkeypatch.setattr(google_auth_routes, "log_audit", fail_login_audit)
    response = asyncio.run(google_auth_routes.google_login_api(_request({"credential": "google-proof"})))

    assert response.status_code == 500
    account = auth_database.rows("SELECT * FROM tai_khoan")[0]
    assert account["da_xac_minh"] == 0
    assert auth_helper.verify_password(account["mat_khau"], "preclaimed-password") is True
    assert auth_database.rows("SELECT * FROM dinh_danh_ngoai") == []
    assert auth_database.rows("SELECT * FROM password_reset_tokens") == []
    assert auth_database.rows("SELECT * FROM email_delivery_status") == []
    assert session_invalid_reason(load_session_user(auth_database, "old-user-1")) is None


@pytest.fixture
def password_cpu_calls(monkeypatch):
    calls = []

    async def execute_cpu(function, *args, **_kwargs):
        calls.append(function)
        return function(*args)

    monkeypatch.setattr(auth_routes, "run_cpu_bound", execute_cpu)
    return calls


def _change_password(*, token="old-user-1", ip="192.0.2.1", old_password="wrong-password"):
    return asyncio.run(auth_routes.change_password_api(_request(
        {"old_password": old_password, "new_password": "owner-new-password"}, token=token, ip=ip,
    )))


def test_password_change_limits_account_before_cpu_even_when_ip_changes(auth_database, password_cpu_calls):
    _add_account(auth_database)
    for attempt in range(auth_service.RATE_LIMIT_MAX):
        response = _change_password(ip=f"192.0.2.{attempt + 1}")
        assert response.status_code == 400
        assert json.loads(response.body)["error"] == "Mật khẩu cũ không chính xác!"

    response = _change_password(ip="198.51.100.1")

    assert response.status_code == 429
    assert len(password_cpu_calls) == auth_service.RATE_LIMIT_MAX
    assert json.loads(response.body)["code"] == "rate_limit_exceeded"
    assert int(response.headers["Retry-After"]) > 0


def test_password_change_limits_ip_across_accounts_before_cpu(auth_database, password_cpu_calls):
    for attempt in range(auth_service.RATE_LIMIT_MAX + 1):
        user_id = f"user-{attempt + 1}"
        _add_account(auth_database, user_id=user_id)
        response = _change_password(token=f"old-{user_id}")
        assert response.status_code == (400 if attempt < auth_service.RATE_LIMIT_MAX else 429)

    assert len(password_cpu_calls) == auth_service.RATE_LIMIT_MAX


def test_password_change_success_clears_buckets_and_rotates_session(auth_database, password_cpu_calls):
    _add_account(auth_database)
    assert _change_password().status_code == 400

    response = _change_password(old_password="preclaimed-password")

    assert response.status_code == 200
    assert len(password_cpu_calls) == 2
    assert auth_database.rows("SELECT * FROM rate_limit_buckets") == []
    account = auth_database.rows("SELECT * FROM tai_khoan")[0]
    assert auth_helper.verify_password(account["mat_khau"], "owner-new-password") is True
    assert session_invalid_reason(load_session_user(auth_database, "old-user-1")) == "session_revoked"
    new_token = _response_token(response)
    assert session_invalid_reason(load_session_user(auth_database, new_token)) is None
    assert auth_database.rows("SELECT action FROM audit_events") == [{"action": "auth.password_changed"}]
    assert _change_password(token=new_token).status_code == 400


def test_password_change_bucket_storage_failure_stops_before_cpu(auth_database, password_cpu_calls):
    _add_account(auth_database)
    connection = auth_database.get_connection()
    connection.execute("DROP TABLE rate_limit_buckets")
    connection.commit()
    connection.close()

    response = _change_password(old_password="preclaimed-password")

    assert response.status_code == 429
    assert password_cpu_calls == []
    assert auth_helper.verify_password(
        auth_database.rows("SELECT mat_khau FROM tai_khoan")[0]["mat_khau"], "preclaimed-password"
    ) is True


def test_password_change_audit_failure_preserves_password_session_and_buckets(
    auth_database, password_cpu_calls, monkeypatch,
):
    _add_account(auth_database)

    def fail_audit(*_args, **_kwargs):
        raise RuntimeError("audit unavailable")

    monkeypatch.setattr(auth_routes, "log_audit", fail_audit)
    response = _change_password(old_password="preclaimed-password")

    assert response.status_code == 500
    assert len(password_cpu_calls) == 1
    assert auth_helper.verify_password(
        auth_database.rows("SELECT mat_khau FROM tai_khoan")[0]["mat_khau"], "preclaimed-password"
    ) is True
    assert session_invalid_reason(load_session_user(auth_database, "old-user-1")) is None
    assert sorted(row["attempt_count"] for row in auth_database.rows("SELECT * FROM rate_limit_buckets")) == [1, 1]


def test_password_change_compare_and_swap_conflict_preserves_attempts(
    auth_database, password_cpu_calls, monkeypatch,
):
    _add_account(auth_database)

    async def concurrent_change(function, *args, **_kwargs):
        password_cpu_calls.append(function)
        result = function(*args)
        connection = auth_database.get_connection()
        connection.execute("UPDATE tai_khoan SET mat_khau = ? WHERE id = ?", ("concurrent-hash", "user-1"))
        connection.commit()
        connection.close()
        return result

    monkeypatch.setattr(auth_routes, "run_cpu_bound", concurrent_change)
    response = _change_password(old_password="preclaimed-password")

    assert response.status_code == 409
    assert auth_database.rows("SELECT mat_khau FROM tai_khoan")[0]["mat_khau"] == "concurrent-hash"
    assert session_invalid_reason(load_session_user(auth_database, "old-user-1")) is None
    assert sorted(row["attempt_count"] for row in auth_database.rows("SELECT * FROM rate_limit_buckets")) == [1, 1]


def _recovery_token(database, kind):
    if kind == "reset":
        return create_password_reset(database, "user-1", "owner@example.test", "192.0.2.1")["token"]
    connection = database.get_connection()
    token = create_password_setup_token(connection, "user-1")["token"]
    connection.commit()
    connection.close()
    return token


def _pending_email(database, *, expired=False):
    now = int(time.time())
    connection = database.get_connection()
    connection.execute(
        """INSERT INTO pending_email_changes (
               user_id, current_email_norm, pending_email, pending_email_norm,
               otp_hash, requested_at, expires_at, requested_ip
           ) VALUES ('user-1', 'owner@example.test', 'new@example.test',
                     'new@example.test', ?, ?, ?, '192.0.2.1')""",
        (_legacy_hash("123456"), now, now - 1 if expired else now + 600),
    )
    connection.commit()
    connection.close()


def _revoke_current_session(database):
    connection = database.get_connection()
    connection.execute("UPDATE auth_sessions SET revoked_at = ?", (int(time.time()),))
    connection.commit()
    connection.close()


@pytest.mark.parametrize("kind", ["reset", "setup"])
@pytest.mark.parametrize("operation", ["password", "email"])
def test_credential_rotation_invalidates_unused_recovery_links(
    auth_database, password_cpu_calls, kind, operation,
):
    _add_account(auth_database)
    token = _recovery_token(auth_database, kind)
    _pending_email(auth_database)
    if operation == "password":
        response = _change_password(old_password="preclaimed-password")
        assert len(auth_database.rows("SELECT * FROM pending_email_changes")) == 1
    else:
        response = asyncio.run(auth_routes.verify_email_change_api(
            _request({"code": "123456"}, token="old-user-1")
        ))
        assert auth_database.rows("SELECT email FROM tai_khoan")[0]["email"] == "new@example.test"
    assert response.status_code == 200
    with pytest.raises(InvalidResetToken):
        redeem_password_reset(
            auth_database, token, "unused", password_hash="stolen-link-hash",
            audit=lambda *_args, **_kwargs: None,
        )


@pytest.mark.parametrize("operation", ["password", "email", "profile", "email_request", "expired_email"])
def test_revocation_during_async_work_prevents_account_write(
    auth_database, password_cpu_calls, monkeypatch, operation,
):
    _add_account(auth_database)
    token = _recovery_token(auth_database, "setup")
    if operation in {"email", "expired_email"}:
        _pending_email(auth_database, expired=operation == "expired_email")
    if operation == "expired_email":
        monkeypatch.setattr(auth_routes, "log_audit", lambda *_args, **_kwargs: None)
    original_read = auth_routes.read_json_object

    async def revoke_after_body(request):
        result = await original_read(request)
        _revoke_current_session(auth_database)
        return result

    async def revoke_after_cpu(function, *args, **_kwargs):
        result = function(*args)
        _revoke_current_session(auth_database)
        return result

    if operation in {"profile", "expired_email"}:
        monkeypatch.setattr(auth_routes, "read_json_object", revoke_after_body)
    else:
        monkeypatch.setattr(auth_routes, "run_cpu_bound", revoke_after_cpu)
    if operation == "password":
        response = _change_password(old_password="preclaimed-password")
    elif operation in {"email", "expired_email"}:
        response = asyncio.run(auth_routes.verify_email_change_api(
            _request({"code": "123456"}, token="old-user-1")
        ))
    else:
        response = asyncio.run(auth_routes.update_profile_api(_request({
            "name": "Changed name", "email": "new@example.test" if operation == "email_request" else "owner@example.test",
            "password": "preclaimed-password",
        }, token="old-user-1")))
    assert response.status_code == 403
    account = auth_database.rows("SELECT * FROM tai_khoan")[0]
    assert account["ho_ten"] == "Owner"
    assert account["email"] == "owner@example.test"
    assert auth_helper.verify_password(account["mat_khau"], "preclaimed-password")
    assert auth_database.rows("SELECT used_at FROM password_reset_tokens")[0]["used_at"] is None
    assert len(auth_database.rows("SELECT * FROM pending_email_changes")) == int(operation in {"email", "expired_email"})
    assert auth_database.rows("SELECT action FROM audit_events") == []
    assert token


@pytest.mark.parametrize("operation", ["password", "email"])
def test_credential_rotation_audit_failure_preserves_unused_recovery_link(
    auth_database, password_cpu_calls, monkeypatch, operation,
):
    _add_account(auth_database)
    token = _recovery_token(auth_database, "setup")
    _pending_email(auth_database)
    def fail_audit(*_args, **_kwargs):
        raise RuntimeError("audit unavailable")
    monkeypatch.setattr(auth_routes, "log_audit", fail_audit)
    response = _change_password(old_password="preclaimed-password") if operation == "password" else asyncio.run(
        auth_routes.verify_email_change_api(_request({"code": "123456"}, token="old-user-1"))
    )
    assert response.status_code == 500
    assert auth_database.rows("SELECT used_at FROM password_reset_tokens")[0]["used_at"] is None
    assert session_invalid_reason(load_session_user(auth_database, "old-user-1")) is None
    assert len(auth_database.rows("SELECT * FROM pending_email_changes")) == 1
    assert redeem_password_reset(auth_database, token, "unused", password_hash="legitimate-hash", audit=lambda *_args, **_kwargs: None) == "user-1"
    assert len(auth_database.rows("SELECT * FROM pending_email_changes")) == 1


def test_profile_email_request_rehash_preserves_recovery_link(auth_database, password_cpu_calls):
    _add_account(auth_database)
    _recovery_token(auth_database, "setup")
    response = asyncio.run(auth_routes.update_profile_api(_request({
        "name": "Changed name", "email": "new@example.test", "password": "preclaimed-password",
    }, token="old-user-1")))
    assert response.status_code == 200
    assert json.loads(response.body)["emailChangePending"] is True
    assert auth_database.rows("SELECT ho_ten FROM tai_khoan")[0]["ho_ten"] == "Changed name"
    assert auth_database.rows("SELECT used_at FROM password_reset_tokens")[0]["used_at"] is None
    assert auth_database.rows("SELECT mat_khau FROM tai_khoan")[0]["mat_khau"].startswith("$argon2")


@pytest.mark.parametrize("failure", ["revoke", "audit", "commit"])
def test_logout_persistence_failure_preserves_session_and_cookies(auth_database, monkeypatch, failure):
    _add_account(auth_database)
    def fail(*_args, **_kwargs):
        raise RuntimeError("logout persistence unavailable")
    if failure == "revoke":
        monkeypatch.setattr(auth_routes, "revoke_session", fail)
    elif failure == "audit":
        monkeypatch.setattr(auth_routes, "log_audit", fail)
    else:
        original_connection = auth_database.get_connection
        def failing_commit_connection():
            connection = original_connection()
            connection.commit = fail
            return connection
        monkeypatch.setattr(auth_database, "get_connection", failing_commit_connection)
    response = asyncio.run(auth_routes.logout_api(_request({}, token="old-user-1")))
    assert response.status_code == 503
    assert json.loads(response.body).get("success") is not True
    assert response.headers.getlist("set-cookie") == []
    assert session_invalid_reason(load_session_user(auth_database, "old-user-1")) is None
    assert auth_database.rows("SELECT action FROM audit_events") == []


def test_logout_disconnect_failure_after_commit_keeps_durable_success(auth_database, monkeypatch):
    _add_account(auth_database)
    def fail(*_args, **_kwargs):
        raise RuntimeError("websocket disconnect unavailable")
    monkeypatch.setattr(auth_routes, "disconnect_user_websockets", fail)
    response = asyncio.run(auth_routes.logout_api(_request({}, token="old-user-1")))
    assert response.status_code == 200
    assert json.loads(response.body)["success"] is True
    assert len(response.headers.getlist("set-cookie")) == 2
    assert session_invalid_reason(load_session_user(auth_database, "old-user-1")) == "session_revoked"
    assert auth_database.rows("SELECT action FROM audit_events") == [{"action": "auth.logout"}]


@pytest.mark.parametrize("kind,ttl", [("reset", 1_800), ("setup", 7_200)])
def test_recovery_link_ttl_and_one_time_controls(auth_database, kind, ttl):
    _add_account(auth_database)
    if kind == "reset":
        token = create_password_reset(auth_database, "user-1", "owner@example.test", "192.0.2.1", now=1_000)["token"]
    else:
        connection = auth_database.get_connection()
        token = create_password_setup_token(connection, "user-1", now=1_000)["token"]
        connection.commit()
        connection.close()
    with pytest.raises(InvalidResetToken):
        redeem_password_reset(auth_database, token, "unused", now=1_000 + ttl,
                              password_hash="expired-hash", audit=lambda *_args, **_kwargs: None)
    assert auth_database.rows("SELECT used_at FROM password_reset_tokens")[0]["used_at"] is None
    assert redeem_password_reset(auth_database, token, "unused", now=999 + ttl,
                                 password_hash="legitimate-hash", audit=lambda *_args, **_kwargs: None) == "user-1"
    with pytest.raises(InvalidResetToken):
        redeem_password_reset(auth_database, token, "unused", now=999 + ttl,
                              password_hash="replayed-hash", audit=lambda *_args, **_kwargs: None)


def test_profile_update_same_email_keeps_authorized_fields(auth_database, password_cpu_calls):
    _add_account(auth_database)
    _recovery_token(auth_database, "setup")
    response = asyncio.run(auth_routes.update_profile_api(_request({
        "name": "Changed name", "email": "owner@example.test",
    }, token="old-user-1")))
    assert response.status_code == 200
    assert json.loads(response.body)["profile"] == {
        "username": "user-1", "name": "Changed name", "email": "owner@example.test", "avatar": "",
    }
    assert auth_database.rows("SELECT used_at FROM password_reset_tokens")[0]["used_at"] is None
    assert password_cpu_calls == []


def test_logout_valid_session_commits_revocation_before_clearing_cookies(auth_database):
    _add_account(auth_database)
    response = asyncio.run(auth_routes.logout_api(_request({}, token="old-user-1")))
    assert response.status_code == 200
    assert json.loads(response.body)["success"] is True
    assert len(response.headers.getlist("set-cookie")) == 2
    assert session_invalid_reason(load_session_user(auth_database, "old-user-1")) == "session_revoked"


def test_password_change_disconnect_failure_keeps_committed_password_and_new_cookie(
    auth_database, password_cpu_calls, monkeypatch,
):
    _add_account(auth_database)
    _recovery_token(auth_database, "setup")
    def fail(*_args, **_kwargs):
        raise RuntimeError("websocket disconnect unavailable")
    monkeypatch.setattr(auth_routes, "disconnect_user_websockets", fail)
    response = _change_password(old_password="preclaimed-password")
    assert response.status_code == 200
    assert json.loads(response.body)["success"] is True
    assert auth_helper.verify_password(
        auth_database.rows("SELECT mat_khau FROM tai_khoan")[0]["mat_khau"], "owner-new-password"
    )
    assert session_invalid_reason(load_session_user(auth_database, "old-user-1")) == "session_revoked"
    assert session_invalid_reason(load_session_user(auth_database, _response_token(response))) is None
    assert auth_database.rows("SELECT used_at FROM password_reset_tokens")[0]["used_at"] is not None
