import asyncio
import json

import pytest

from backend.auth.auth_helper import hash_password, verify_password
from backend.auth import otp_routes
from backend.auth.password_reset_service import (
    InvalidResetToken,
    RESET_TOKEN_TTL_SECONDS,
    create_password_reset,
    redeem_password_reset,
)
from backend.auth.session_store import hash_session_token
from backend.db.db_helper import SQLiteDatabase


def _password_reset_database(path):
    database = SQLiteDatabase(path)
    conn = database.get_connection()
    try:
        conn.executescript(
            """
            CREATE TABLE tai_khoan (
                id TEXT PRIMARY KEY,
                ten_dang_nhap TEXT NOT NULL,
                username_norm TEXT NOT NULL UNIQUE,
                ho_ten TEXT NOT NULL,
                email TEXT NOT NULL,
                email_norm TEXT NOT NULL UNIQUE,
                mat_khau TEXT NOT NULL
            );
            CREATE TABLE auth_sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                token_hash TEXT NOT NULL UNIQUE,
                created_at INTEGER NOT NULL,
                last_seen_at INTEGER NOT NULL,
                idle_expires_at INTEGER NOT NULL,
                absolute_expires_at INTEGER NOT NULL,
                revoked_at INTEGER,
                remember_me INTEGER NOT NULL DEFAULT 0,
                device_info TEXT,
                privileged_reauth_at INTEGER
            );
            CREATE TABLE password_reset_tokens (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                token_hash TEXT NOT NULL UNIQUE,
                expires_at INTEGER NOT NULL,
                used_at INTEGER,
                requested_ip TEXT,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE
            );
            """
        )
        conn.execute(
            """
            INSERT INTO tai_khoan (
                id, ten_dang_nhap, username_norm, ho_ten, email, email_norm, mat_khau
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "user-1",
                "alice",
                "alice",
                "Alice",
                "alice@example.com",
                "alice@example.com",
                hash_password("old-password-value"),
            ),
        )
        conn.execute(
            """
            INSERT INTO auth_sessions (
                id, user_id, token_hash, created_at, last_seen_at,
                idle_expires_at, absolute_expires_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            ("session-1", "user-1", hash_session_token("active-session"), 1, 1, 9999999999, 9999999999),
        )
        conn.commit()
    finally:
        conn.close()
    return database


def test_request_does_not_change_password_and_stores_only_token_hash(tmp_path):
    database = _password_reset_database(tmp_path / "request.db")

    reset = create_password_reset(
        database,
        "Alice",
        "ALICE@example.com",
        "127.0.0.1",
        now=1000,
    )

    assert reset is not None
    conn = database.get_connection()
    try:
        user = conn.execute(
            "SELECT mat_khau FROM tai_khoan WHERE id = 'user-1'"
        ).fetchone()
        revoked_at = conn.execute(
            "SELECT revoked_at FROM auth_sessions WHERE id = 'session-1'"
        ).fetchone()[0]
        stored_token = conn.execute(
            "SELECT token_hash, expires_at FROM password_reset_tokens"
        ).fetchone()
    finally:
        conn.close()

    assert verify_password(user["mat_khau"], "old-password-value")
    assert revoked_at is None
    assert stored_token["token_hash"] != reset["token"]
    assert reset["token"] not in stored_token["token_hash"]
    assert stored_token["expires_at"] == 1000 + RESET_TOKEN_TTL_SECONDS


def test_redeem_changes_password_revokes_session_and_is_one_time(tmp_path):
    database = _password_reset_database(tmp_path / "redeem.db")
    reset = create_password_reset(
        database,
        "alice",
        "alice@example.com",
        "127.0.0.1",
        now=2000,
    )

    user_id = redeem_password_reset(
        database,
        reset["token"],
        "a-new-password-value",
        now=2100,
    )

    assert user_id == "user-1"
    conn = database.get_connection()
    try:
        user = conn.execute(
            "SELECT mat_khau FROM tai_khoan WHERE id = 'user-1'"
        ).fetchone()
        revoked_at = conn.execute(
            "SELECT revoked_at FROM auth_sessions WHERE id = 'session-1'"
        ).fetchone()[0]
        used_at = conn.execute(
            "SELECT used_at FROM password_reset_tokens"
        ).fetchone()[0]
    finally:
        conn.close()

    assert verify_password(user["mat_khau"], "a-new-password-value")
    assert not verify_password(user["mat_khau"], "old-password-value")
    assert revoked_at == 2100
    assert used_at == 2100

    with pytest.raises(InvalidResetToken):
        redeem_password_reset(
            database,
            reset["token"],
            "another-password-value",
            now=2200,
        )


def test_expired_token_cannot_change_password(tmp_path):
    database = _password_reset_database(tmp_path / "expired.db")
    reset = create_password_reset(
        database,
        "alice",
        "alice@example.com",
        "127.0.0.1",
        now=3000,
    )

    with pytest.raises(InvalidResetToken):
        redeem_password_reset(
            database,
            reset["token"],
            "new-password-after-expiry",
            now=3000 + RESET_TOKEN_TTL_SECONDS,
        )

    conn = database.get_connection()
    try:
        password_hash = conn.execute(
            "SELECT mat_khau FROM tai_khoan WHERE id = 'user-1'"
        ).fetchone()[0]
    finally:
        conn.close()
    assert verify_password(password_hash, "old-password-value")


def test_unknown_identity_does_not_create_reset_token(tmp_path):
    database = _password_reset_database(tmp_path / "unknown.db")

    result = create_password_reset(
        database,
        "unknown",
        "unknown@example.com",
        "127.0.0.1",
        now=4000,
    )

    assert result is None
    conn = database.get_connection()
    try:
        count = conn.execute("SELECT COUNT(*) FROM password_reset_tokens").fetchone()[0]
    finally:
        conn.close()
    assert count == 0


class _Request:
    def __init__(self, payload):
        self.payload = payload

    async def json(self):
        return self.payload


def test_forgot_password_response_does_not_enumerate_accounts(monkeypatch):
    monkeypatch.setattr(otp_routes, "get_client_ip", lambda _request: "127.0.0.1")
    monkeypatch.setattr(
        otp_routes,
        "get_rate_limit_decision",
        lambda _key: type("Decision", (), {"allowed": True})(),
    )

    monkeypatch.setattr(otp_routes, "create_password_reset", lambda *_args: None)
    missing_response = asyncio.run(
        otp_routes.forgot_password_api(
            _Request({"username": "missing", "email": "missing@example.com"})
        )
    )

    monkeypatch.setattr(
        otp_routes,
        "create_password_reset",
        lambda *_args: {
            "token": "raw-reset-token",
            "email": "alice@example.com",
            "name": "Alice",
            "username": "alice",
        },
    )
    existing_response = asyncio.run(
        otp_routes.forgot_password_api(
            _Request({"username": "alice", "email": "alice@example.com"})
        )
    )

    assert missing_response.status_code == 200
    assert existing_response.status_code == 200
    assert json.loads(missing_response.body) == json.loads(existing_response.body)
