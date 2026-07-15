import json
import time
from types import SimpleNamespace

import pytest

from backend.auth import auth_routes
from backend.auth.auth_helper import (
    PRIVILEGED_REAUTH_REQUIRED,
    SessionRole,
    hash_password,
    verify_super_admin_controls,
)
from backend.auth.auth_service import RateLimitDecision
from backend.auth.session_store import hash_session_token
from backend.db.db_helper import SQLiteDatabase


class _Request:
    method = "POST"

    def __init__(self, password=""):
        self._payload = {"password": password}
        self.cookies = {"session_token": "session-1"}
        self.headers = {}
        self.client = SimpleNamespace(host="127.0.0.1")

    async def json(self):
        return self._payload


def _database(path, role="super_admin"):
    database = SQLiteDatabase(path)
    connection = database.get_connection()
    connection.executescript(
        """
        CREATE TABLE tai_khoan (
            id TEXT PRIMARY KEY,
            vai_tro TEXT NOT NULL,
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
        """
    )
    connection.execute(
        "INSERT INTO tai_khoan VALUES (?, ?, ?)",
        ("admin-1", role, hash_password("correct-password")),
    )
    connection.execute(
        """
        INSERT INTO auth_sessions (
            id, user_id, token_hash, created_at, last_seen_at,
            idle_expires_at, absolute_expires_at
        ) VALUES ('session-id-1', 'admin-1', ?, 1, 1, 9999999999, 9999999999)
        """,
        (hash_session_token("session-1"),),
    )
    connection.commit()
    connection.close()
    return database


def _payload(response):
    return json.loads(response.body.decode("utf-8"))


def test_sensitive_super_admin_action_requires_recent_password(monkeypatch):
    monkeypatch.setenv("SUPER_ADMIN_IP_ALLOWLIST", "127.0.0.1/32")
    request = _Request()

    allowed, error = verify_super_admin_controls(
        request,
        {"privileged_reauth_at": None},
    )

    assert allowed is False
    assert error == PRIVILEGED_REAUTH_REQUIRED

    allowed, error = verify_super_admin_controls(
        request,
        {"privileged_reauth_at": int(time.time())},
    )
    assert allowed is True
    assert error is None


def test_super_admin_network_allowlist_remains_defense_in_depth(monkeypatch):
    monkeypatch.setenv("SUPER_ADMIN_IP_ALLOWLIST", "203.0.113.0/24")

    allowed, error = verify_super_admin_controls(
        _Request(),
        {"privileged_reauth_at": int(time.time())},
    )

    assert allowed is False
    assert "mạng hiện tại" in error


@pytest.mark.anyio
async def test_password_reauth_enables_short_lived_privileged_access(monkeypatch, tmp_path):
    database = _database(tmp_path / "reauth.db")
    monkeypatch.setenv("SUPER_ADMIN_IP_ALLOWLIST", "127.0.0.1/32")
    monkeypatch.setattr(auth_routes, "database", database)
    monkeypatch.setattr(
        auth_routes,
        "verify_session",
        lambda _request: (True, SessionRole("super_admin", "admin-1", "session-id-1")),
    )
    monkeypatch.setattr(
        auth_routes,
        "get_rate_limit_decision",
        lambda *_args, **_kwargs: RateLimitDecision(True, 0, 5),
    )
    monkeypatch.setattr(auth_routes, "log_audit", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(auth_routes, "_session_cache_invalidate_by_user_id", lambda _user: None)

    response = await auth_routes.privileged_reauth_api(_Request("correct-password"))

    assert response.status_code == 200
    assert _payload(response)["success"] is True
    connection = database.get_connection()
    reauthenticated_at = connection.execute(
        "SELECT privileged_reauth_at FROM auth_sessions WHERE id = 'session-id-1'"
    ).fetchone()[0]
    connection.close()
    assert abs(int(time.time()) - reauthenticated_at) < 5


@pytest.mark.anyio
async def test_wrong_reauth_password_is_counted(monkeypatch, tmp_path):
    database = _database(tmp_path / "wrong-reauth.db")
    failures = []
    monkeypatch.setenv("SUPER_ADMIN_IP_ALLOWLIST", "127.0.0.1/32")
    monkeypatch.setattr(auth_routes, "database", database)
    monkeypatch.setattr(
        auth_routes,
        "verify_session",
        lambda _request: (True, SessionRole("super_admin", "admin-1", "session-id-1")),
    )
    monkeypatch.setattr(
        auth_routes,
        "get_rate_limit_decision",
        lambda *_args, **_kwargs: RateLimitDecision(True, 0, 5),
    )
    monkeypatch.setattr(auth_routes, "record_rate_limit_failure", failures.append)
    monkeypatch.setattr(auth_routes, "log_audit", lambda *_args, **_kwargs: None)

    response = await auth_routes.privileged_reauth_api(_Request("wrong-password"))

    assert response.status_code == 400
    assert len(failures) == 2


@pytest.mark.anyio
async def test_organization_manager_can_password_reauth_without_admin_ip_allowlist(
    monkeypatch, tmp_path
):
    database = _database(tmp_path / "manager-reauth.db", role="user")
    monkeypatch.setenv("SUPER_ADMIN_IP_ALLOWLIST", "203.0.113.0/24")
    monkeypatch.setattr(auth_routes, "database", database)
    monkeypatch.setattr(
        auth_routes,
        "verify_session",
        lambda _request: (True, SessionRole("user", "admin-1", "session-id-1")),
    )
    monkeypatch.setattr(
        auth_routes,
        "get_rate_limit_decision",
        lambda *_args, **_kwargs: RateLimitDecision(True, 0, 5),
    )
    monkeypatch.setattr(auth_routes, "log_audit", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(auth_routes, "_session_cache_invalidate_by_user_id", lambda _user: None)

    response = await auth_routes.privileged_reauth_api(_Request("correct-password"))

    assert response.status_code == 200
    connection = database.get_connection()
    assert connection.execute(
        "SELECT privileged_reauth_at FROM auth_sessions WHERE id = 'session-id-1'"
    ).fetchone()[0]
    connection.close()
