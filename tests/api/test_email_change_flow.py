import hashlib
import json
import sqlite3
from types import SimpleNamespace

import pytest

from backend.auth import auth_routes
from backend.auth.auth_helper import SessionRole
from backend.auth.auth_service import RateLimitDecision
from backend.auth.auth_helper import verify_password
from backend.db.db_helper import SQLiteDatabase
from backend.db.migrations import m0004_pending_email_changes


def _fast_hash(value):
    salt = "email-change-test-salt"
    digest = hashlib.pbkdf2_hmac(
        "sha256", str(value).encode("utf-8"), salt.encode("utf-8"), 1_000
    )
    return f"pbkdf2_sha256$1000${salt}${digest.hex()}"


class _MigrationContext:
    @staticmethod
    def assert_foreign_key_integrity(cursor):
        assert cursor.execute("PRAGMA foreign_key_check").fetchall() == []


class _Request:
    method = "POST"

    def __init__(self, payload):
        self._payload = payload
        self.cookies = {"session_token": "session-token"}
        self.headers = {}
        self.client = SimpleNamespace(host="198.51.100.20")

    async def json(self):
        return self._payload


def _database(path):
    database = SQLiteDatabase(path)
    connection = database.get_connection()
    connection.executescript(
        """
        CREATE TABLE tai_khoan (
            id TEXT PRIMARY KEY,
            ten_dang_nhap TEXT NOT NULL,
            mat_khau TEXT NOT NULL,
            ho_ten TEXT NOT NULL,
            email TEXT NOT NULL,
            email_norm TEXT NOT NULL UNIQUE,
            anh_dai_dien TEXT,
            da_xac_minh INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE auth_sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            revoked_at INTEGER,
            FOREIGN KEY (user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE
        );
        """
    )
    connection.execute(
        """INSERT INTO tai_khoan (
               id, ten_dang_nhap, mat_khau, ho_ten, email, email_norm,
               anh_dai_dien, da_xac_minh
           ) VALUES ('actor', 'actor-name', ?, 'Old Name',
                     'old@example.com', 'old@example.com', 'old-avatar', 1)""",
        (_fast_hash("correct-password"),),
    )
    connection.execute(
        """INSERT INTO tai_khoan (
               id, ten_dang_nhap, mat_khau, ho_ten, email, email_norm,
               anh_dai_dien, da_xac_minh
           ) VALUES ('other', 'other-name', ?, 'Other User',
                     'used@example.com', 'used@example.com', '', 1)""",
        (_fast_hash("other-password"),),
    )
    connection.executemany(
        "INSERT INTO auth_sessions (id, user_id) VALUES (?, 'actor')",
        (("session-1",), ("session-2",)),
    )
    m0004_pending_email_changes.apply(connection.cursor(), _MigrationContext())
    connection.commit()
    connection.close()
    return database


def _payload(response):
    return json.loads(response.body.decode("utf-8"))


def _patch_common(monkeypatch, database):
    audits = []
    mails = []
    invalidated = []
    disconnected = []
    rate_buckets = []

    monkeypatch.setattr(auth_routes, "database", database)
    monkeypatch.setattr(
        auth_routes,
        "verify_session",
        lambda _request: (True, SessionRole("user", "actor", "session-1")),
    )

    def allow_rate_limit(bucket, *args, **kwargs):
        del args, kwargs
        rate_buckets.append(bucket)
        return RateLimitDecision(True, 0, 10)

    monkeypatch.setattr(auth_routes, "get_rate_limit_decision", allow_rate_limit)
    monkeypatch.setattr(auth_routes, "generate_otp", lambda: "123456")
    monkeypatch.setattr(auth_routes, "hash_password", _fast_hash)
    monkeypatch.setattr(auth_routes, "password_needs_rehash", lambda _value: False)
    monkeypatch.setattr(
        auth_routes,
        "log_audit",
        lambda action, *args, **kwargs: audits.append((action, args, kwargs)),
    )
    monkeypatch.setattr(
        auth_routes,
        "gui_email",
        lambda *args, **kwargs: mails.append((args, kwargs)) or True,
    )
    monkeypatch.setattr(
        auth_routes,
        "_session_cache_invalidate_by_user_id",
        invalidated.append,
    )
    monkeypatch.setattr(auth_routes, "disconnect_user_websockets", disconnected.append)
    return {
        "audits": audits,
        "mails": mails,
        "invalidated": invalidated,
        "disconnected": disconnected,
        "rate_buckets": rate_buckets,
    }


async def _request_change():
    return await auth_routes.update_profile_api(
        _Request({
            "name": "Updated Name",
            "email": "new@example.com",
            "avatar": "data:image/png;base64,iVBORw0KGgo=",
            "password": "correct-password",
        })
    )


@pytest.mark.anyio
async def test_request_keeps_old_login_email_and_sends_otp_plus_old_email_alert(
    monkeypatch, tmp_path
):
    database = _database(tmp_path / "email-change-request.db")
    observed = _patch_common(monkeypatch, database)

    response = await _request_change()
    body = _payload(response)

    assert response.status_code == 200
    assert body["emailChangePending"] is True
    assert body["pendingEmail"] == "new@example.com"
    assert body["profile"]["email"] == "old@example.com"

    connection = database.get_connection()
    account = connection.execute(
        "SELECT ho_ten, email, email_norm, anh_dai_dien FROM tai_khoan WHERE id = 'actor'"
    ).fetchone()
    pending = connection.execute(
        "SELECT pending_email_norm, otp_hash FROM pending_email_changes WHERE user_id = 'actor'"
    ).fetchone()
    revoked = connection.execute(
        "SELECT revoked_at FROM auth_sessions WHERE user_id = 'actor'"
    ).fetchall()
    connection.close()

    assert tuple(account) == (
        "Updated Name", "old@example.com", "old@example.com",
        "data:image/png;base64,iVBORw0KGgo="
    )
    assert pending[0] == "new@example.com"
    assert pending[1] != "123456"
    assert verify_password(pending[1], "123456") is True
    assert [row[0] for row in revoked] == [None, None]

    await response.background()
    recipients = [mail[0][0] for mail in observed["mails"]]
    assert recipients == ["new@example.com", "old@example.com"]
    assert "123456" in observed["mails"][0][0][2]
    assert "123456" not in observed["mails"][1][0][2]
    assert observed["mails"][0][0][3] is True
    assert observed["rate_buckets"] == [
        "email_change_request:198.51.100.20",
        "email_change_request_user:actor",
        "email_change_request_session:"
        + hashlib.sha256(b"session-token").hexdigest()[:24],
    ]
    requested_audit = next(
        entry for entry in observed["audits"] if entry[0] == "auth.email_change_requested"
    )
    assert "email" not in requested_audit[2]["metadata"]


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("password", "expected_code"),
    ((None, "EMAIL_CHANGE_REAUTH_REQUIRED"), ("wrong-password", "EMAIL_CHANGE_REAUTH_FAILED")),
)
async def test_email_change_requires_current_password(
    monkeypatch, tmp_path, password, expected_code
):
    database = _database(tmp_path / f"email-change-reauth-{expected_code}.db")
    observed = _patch_common(monkeypatch, database)
    request_payload = {
        "name": "Should Not Change",
        "email": "new@example.com",
        "avatar": "data:image/png;base64,iVBORw0KGgo=",
    }
    if password is not None:
        request_payload["password"] = password

    response = await auth_routes.update_profile_api(_Request(request_payload))

    assert response.status_code == 403
    assert _payload(response)["code"] == expected_code
    connection = database.get_connection()
    account = connection.execute(
        "SELECT ho_ten, email FROM tai_khoan WHERE id = 'actor'"
    ).fetchone()
    assert tuple(account) == ("Old Name", "old@example.com")
    assert connection.execute("SELECT count(*) FROM pending_email_changes").fetchone()[0] == 0
    connection.close()
    if password is not None:
        assert any(action == "auth.email_change_reauth_failed" for action, *_ in observed["audits"])


@pytest.mark.anyio
async def test_valid_otp_changes_email_once_and_revokes_every_session(monkeypatch, tmp_path):
    database = _database(tmp_path / "email-change-verify.db")
    observed = _patch_common(monkeypatch, database)
    request_response = await _request_change()
    assert request_response.status_code == 200

    response = await auth_routes.verify_email_change_api(_Request({"code": "123456"}))
    body = _payload(response)

    assert response.status_code == 200
    assert body["reauthenticationRequired"] is True
    assert "session_token=" in response.headers["set-cookie"]
    connection = database.get_connection()
    account_email = connection.execute(
        "SELECT email, email_norm, da_xac_minh FROM tai_khoan WHERE id = 'actor'"
    ).fetchone()
    pending_count = connection.execute(
        "SELECT count(*) FROM pending_email_changes WHERE user_id = 'actor'"
    ).fetchone()[0]
    revoked = connection.execute(
        "SELECT revoked_at FROM auth_sessions WHERE user_id = 'actor' ORDER BY id"
    ).fetchall()
    connection.close()

    assert tuple(account_email) == ("new@example.com", "new@example.com", 1)
    assert pending_count == 0
    assert all(row[0] is not None for row in revoked)
    assert observed["invalidated"] == ["actor", "actor"]
    assert observed["disconnected"] == ["actor"]
    assert any(action == "auth.email_changed" for action, *_ in observed["audits"])

    await response.background()
    completion_recipients = [mail[0][0] for mail in observed["mails"]]
    assert completion_recipients == ["old@example.com", "new@example.com"]

    replay = await auth_routes.verify_email_change_api(_Request({"code": "123456"}))
    assert replay.status_code == 400
    assert _payload(replay)["code"] == "EMAIL_CHANGE_NOT_PENDING"


@pytest.mark.anyio
async def test_invalid_or_expired_otp_never_changes_active_email(monkeypatch, tmp_path):
    database = _database(tmp_path / "email-change-invalid.db")
    observed = _patch_common(monkeypatch, database)
    assert (await _request_change()).status_code == 200

    invalid = await auth_routes.verify_email_change_api(_Request({"code": "654321"}))
    assert invalid.status_code == 400
    assert _payload(invalid)["code"] == "EMAIL_CHANGE_OTP_INVALID"

    connection = database.get_connection()
    assert connection.execute(
        "SELECT email FROM tai_khoan WHERE id = 'actor'"
    ).fetchone()[0] == "old@example.com"
    assert connection.execute(
        "SELECT count(*) FROM pending_email_changes WHERE user_id = 'actor'"
    ).fetchone()[0] == 1
    connection.execute(
        "UPDATE pending_email_changes SET requested_at = 1, expires_at = 2 WHERE user_id = 'actor'"
    )
    connection.commit()
    connection.close()

    expired = await auth_routes.verify_email_change_api(_Request({"code": "123456"}))
    assert expired.status_code == 400
    assert _payload(expired)["code"] == "EMAIL_CHANGE_OTP_EXPIRED"
    connection = database.get_connection()
    assert connection.execute(
        "SELECT email FROM tai_khoan WHERE id = 'actor'"
    ).fetchone()[0] == "old@example.com"
    assert connection.execute("SELECT count(*) FROM pending_email_changes").fetchone()[0] == 0
    assert connection.execute(
        "SELECT count(*) FROM auth_sessions WHERE revoked_at IS NOT NULL"
    ).fetchone()[0] == 0
    connection.close()
    reasons = [
        kwargs.get("metadata", {}).get("reason")
        for _action, _args, kwargs in observed["audits"]
    ]
    assert "invalid_otp" in reasons
    assert "expired" in reasons


@pytest.mark.anyio
async def test_email_change_rate_limit_fails_before_creating_pending_request(monkeypatch, tmp_path):
    database = _database(tmp_path / "email-change-rate-limit.db")
    _patch_common(monkeypatch, database)
    monkeypatch.setattr(
        auth_routes,
        "get_rate_limit_decision",
        lambda *_args, **_kwargs: RateLimitDecision(False, 120, 0),
    )

    response = await _request_change()

    assert response.status_code == 429
    assert response.headers["retry-after"] == "120"
    connection = database.get_connection()
    assert connection.execute("SELECT count(*) FROM pending_email_changes").fetchone()[0] == 0
    assert connection.execute(
        "SELECT email FROM tai_khoan WHERE id = 'actor'"
    ).fetchone()[0] == "old@example.com"
    connection.close()


@pytest.mark.anyio
async def test_verification_rate_limit_preserves_pending_request_and_sessions(monkeypatch, tmp_path):
    database = _database(tmp_path / "email-change-verify-rate-limit.db")
    _patch_common(monkeypatch, database)
    assert (await _request_change()).status_code == 200
    monkeypatch.setattr(
        auth_routes,
        "get_rate_limit_decision",
        lambda *_args, **_kwargs: RateLimitDecision(False, 90, 0),
    )

    response = await auth_routes.verify_email_change_api(_Request({"code": "123456"}))

    assert response.status_code == 429
    assert response.headers["retry-after"] == "90"
    connection = database.get_connection()
    assert connection.execute(
        "SELECT email FROM tai_khoan WHERE id = 'actor'"
    ).fetchone()[0] == "old@example.com"
    assert connection.execute(
        "SELECT count(*) FROM pending_email_changes WHERE user_id = 'actor'"
    ).fetchone()[0] == 1
    assert connection.execute(
        "SELECT count(*) FROM auth_sessions WHERE revoked_at IS NOT NULL"
    ).fetchone()[0] == 0
    connection.close()


@pytest.mark.anyio
async def test_email_change_rejects_active_email_owned_by_another_account(monkeypatch, tmp_path):
    database = _database(tmp_path / "email-change-conflict.db")
    _patch_common(monkeypatch, database)

    response = await auth_routes.update_profile_api(
        _Request({
            "name": "Actor",
            "email": "used@example.com",
            "avatar": "",
            "password": "correct-password",
        })
    )

    assert response.status_code == 409
    assert _payload(response)["code"] == "EMAIL_ALREADY_EXISTS"
    connection = database.get_connection()
    assert connection.execute("SELECT count(*) FROM pending_email_changes").fetchone()[0] == 0
    assert connection.execute(
        "SELECT email FROM tai_khoan WHERE id = 'actor'"
    ).fetchone()[0] == "old@example.com"
    connection.close()


@pytest.mark.anyio
async def test_admin_metadata_route_cannot_bypass_verified_email_change(monkeypatch):
    class _UnexpectedDatabase:
        @staticmethod
        def get_connection():
            raise AssertionError("A rejected admin email override must not open the database")

    monkeypatch.setattr(auth_routes, "database", _UnexpectedDatabase())
    monkeypatch.setattr(
        auth_routes,
        "verify_session",
        lambda _request, required_role=None: (
            True,
            SessionRole("super_admin", "admin", "admin-session"),
        ),
    )

    response = await auth_routes.update_user_metadata_api(
        _Request({"user_id": "actor", "field": "email", "value": "bypass@example.com"})
    )

    assert response.status_code == 403
    assert _payload(response)["code"] == "EMAIL_CHANGE_VERIFICATION_REQUIRED"


def test_database_trigger_rejects_unverified_direct_email_update(tmp_path):
    database = _database(tmp_path / "email-change-trigger.db")
    connection = database.get_connection()

    with pytest.raises(sqlite3.IntegrityError, match="verified email change required"):
        connection.execute(
            """UPDATE tai_khoan
               SET email = 'bypass@example.com', email_norm = 'bypass@example.com'
               WHERE id = 'actor'"""
        )

    connection.rollback()
    assert connection.execute(
        "SELECT email FROM tai_khoan WHERE id = 'actor'"
    ).fetchone()[0] == "old@example.com"
    connection.close()
