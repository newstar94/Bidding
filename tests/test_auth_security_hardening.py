import sqlite3
import inspect
from pathlib import Path

import pytest

from backend.auth.google_auth_routes import _password_setup_email
from backend.auth import google_auth_routes
from backend.auth.otp_security import hash_registration_otp, verify_registration_otp
from backend.auth.password_reset_service import (
    InvalidResetToken,
    create_password_setup_token,
    redeem_password_reset,
)


class _SqliteDatabase:
    def __init__(self, path: Path):
        self.path = path

    def get_connection(self):
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        return connection


def _password_database(tmp_path):
    database = _SqliteDatabase(tmp_path / "password-reset.sqlite")
    connection = database.get_connection()
    connection.executescript(
        """
        CREATE TABLE tai_khoan (
            id TEXT PRIMARY KEY, mat_khau TEXT NOT NULL, trang_thai TEXT NOT NULL
        );
        CREATE TABLE auth_sessions (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL, revoked_at INTEGER
        );
        CREATE TABLE password_reset_tokens (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL,
            expires_at INTEGER NOT NULL, used_at INTEGER, requested_ip TEXT,
            created_at INTEGER NOT NULL
        );
        INSERT INTO tai_khoan VALUES ('user-1', '!google-external-only!', 'active');
        INSERT INTO auth_sessions VALUES ('session-1', 'user-1', NULL);
        """
    )
    connection.commit()
    connection.close()
    return database


def test_registration_otp_is_hmac_hashed_and_not_recoverable(monkeypatch):
    monkeypatch.setenv("OTP_HMAC_KEY", "otp-key-that-is-independent-and-at-least-32-bytes")

    stored = hash_registration_otp("123456", "user-1")

    assert stored.startswith("hmac-sha256$")
    assert "123456" not in stored
    assert verify_registration_otp(stored, "123456", "user-1") is True
    assert verify_registration_otp(stored, "123457", "user-1") is False
    assert verify_registration_otp(stored, "123456", "user-2") is False


def test_google_password_setup_token_expires_after_two_hours_and_is_one_time(tmp_path):
    database = _password_database(tmp_path)
    connection = database.get_connection()
    token = create_password_setup_token(
        connection,
        "user-1",
        requested_ip="127.0.0.1",
        now=1_000,
    )
    connection.commit()
    connection.close()

    assert token["expiresAt"] == 8_200
    assert redeem_password_reset(
        database,
        token["token"],
        "unused-clear-password",
        now=8_199,
        password_hash="new-password-hash",
        audit=lambda *_args, **_kwargs: "audit-1",
    ) == "user-1"
    with pytest.raises(InvalidResetToken):
        redeem_password_reset(
            database,
            token["token"],
            "unused-clear-password",
            now=8_199,
            password_hash="another-hash",
            audit=lambda *_args, **_kwargs: "audit-2",
        )


def test_password_reset_rolls_back_when_required_audit_fails(tmp_path):
    database = _password_database(tmp_path)
    connection = database.get_connection()
    token = create_password_setup_token(connection, "user-1", now=100)
    connection.commit()
    connection.close()

    def fail_audit(*_args, **_kwargs):
        raise RuntimeError("audit unavailable")

    with pytest.raises(RuntimeError, match="audit unavailable"):
        redeem_password_reset(
            database,
            token["token"],
            "unused-clear-password",
            now=101,
            password_hash="must-roll-back",
            audit=fail_audit,
        )

    connection = database.get_connection()
    assert connection.execute(
        "SELECT mat_khau FROM tai_khoan WHERE id = 'user-1'"
    ).fetchone()[0] == "!google-external-only!"
    assert connection.execute(
        "SELECT used_at FROM password_reset_tokens"
    ).fetchone()[0] is None
    connection.close()


def test_google_setup_email_contains_link_and_never_a_password():
    subject, body = _password_setup_email(
        "Người dùng",
        "user@example.test",
        "https://app.example.test/reset-password#token=one-time-token",
    )

    assert "đặt mật khẩu" in (subject + body).lower()
    assert "one-time-token" in body
    assert "mật khẩu tạm" not in body.lower()


def test_google_security_audits_are_required_before_commit():
    source = inspect.getsource(google_auth_routes.google_login_api)
    before_commit = source[:source.index("conn.commit()")]

    assert before_commit.count("required=True") >= 3
    assert "_add_background_audit" not in source
    assert "bg_tasks.add_task(log_audit" not in source
