import pytest

from backend.auth import auth_routes
from backend.auth.auth_helper import SessionRole
from backend.auth.session_store import hash_session_token
from backend.db.db_helper import SQLiteDatabase


class _Request:
    def __init__(self, payload=None, token="token-old"):
        self._payload = payload or {}
        self.cookies = {"session_token": token}

    async def json(self):
        return self._payload


def _database(path):
    database = SQLiteDatabase(path)
    connection = database.get_connection()
    connection.executescript(
        """
        CREATE TABLE tai_khoan (
            id TEXT PRIMARY KEY,
            mat_khau TEXT
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
        "INSERT INTO tai_khoan VALUES ('user-a', 'hash-old')"
    )
    connection.execute(
        """
        INSERT INTO auth_sessions (
            id, user_id, token_hash, created_at, last_seen_at,
            idle_expires_at, absolute_expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        ("session-a", "user-a", hash_session_token("token-old"), 1, 1, 9999999999, 9999999999),
    )
    connection.commit()
    connection.close()
    return database


def _patch_common(monkeypatch, database, revoked):
    monkeypatch.setattr(auth_routes, "database", database)
    monkeypatch.setattr(auth_routes, "log_audit", lambda *args, **kwargs: None)
    monkeypatch.setattr(auth_routes, "_session_cache_invalidate", lambda _token: None)
    monkeypatch.setattr(auth_routes, "disconnect_user_websockets", revoked.append)


@pytest.mark.anyio
async def test_password_change_disconnects_all_existing_sockets(monkeypatch, tmp_path):
    database = _database(tmp_path / "password-revoke.db")
    revoked = []
    _patch_common(monkeypatch, database, revoked)
    monkeypatch.setattr(
        auth_routes,
        "verify_session",
        lambda _request: (True, SessionRole("user", "user-a", "session-a")),
    )
    monkeypatch.setattr(auth_routes, "verify_password", lambda _hash, password: password == "old password")
    monkeypatch.setattr(auth_routes, "hash_password", lambda password: f"hash:{password}")

    response = await auth_routes.change_password_api(_Request({
        "old_password": "old password",
        "new_password": "new password",
    }))

    assert response.status_code == 200
    assert revoked == ["user-a"]


@pytest.mark.anyio
async def test_logout_disconnects_socket_before_clearing_session(monkeypatch, tmp_path):
    database = _database(tmp_path / "logout-revoke.db")
    revoked = []
    _patch_common(monkeypatch, database, revoked)

    response = await auth_routes.logout_api(_Request())

    assert response.status_code == 200
    assert revoked == ["user-a"]
    connection = database.get_connection()
    assert connection.execute(
        "SELECT revoked_at FROM auth_sessions WHERE id = 'session-a'"
    ).fetchone()[0] is not None
    connection.close()
