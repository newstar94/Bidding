import time
from types import SimpleNamespace

from backend.auth import auth_helper
from backend.auth.session_store import (
    create_session,
    hash_session_token,
    load_session_user,
    revoke_session,
    revoke_user_sessions,
    session_invalid_reason,
    touch_session,
)
from backend.db.db_helper import SQLiteDatabase


def _database(path):
    database = SQLiteDatabase(path)
    connection = database.get_connection()
    connection.executescript(
        """
        CREATE TABLE tai_khoan (
            id TEXT PRIMARY KEY,
            vai_tro TEXT NOT NULL
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
        INSERT INTO tai_khoan (id, vai_tro) VALUES ('user-1', 'user');
        """
    )
    connection.commit()
    connection.close()
    return database


def _create(database, token, *, now=None, absolute=None, remember=False):
    current = int(time.time()) if now is None else now
    absolute_expiry = current + 1000 if absolute is None else absolute
    connection = database.get_connection()
    try:
        session_id = create_session(
            connection.cursor(),
            user_id="user-1",
            token=token,
            absolute_expires_at=absolute_expiry,
            idle_timeout_seconds=300,
            remember=remember,
            device_info=f"device:{token}",
            now=current,
        )
        connection.commit()
        return session_id
    finally:
        connection.close()


def test_multiple_devices_store_only_token_hash_and_revoke_independently(tmp_path):
    database = _database(tmp_path / "multi-device.db")
    first_id = _create(database, "token-first", now=100, absolute=1000)
    second_id = _create(database, "token-second", now=100, absolute=1000, remember=True)

    connection = database.get_connection()
    try:
        rows = connection.execute(
            "SELECT id, token_hash, remember_me FROM auth_sessions ORDER BY remember_me"
        ).fetchall()
        assert [row["id"] for row in rows] == [first_id, second_id]
        assert [row["token_hash"] for row in rows] == [
            hash_session_token("token-first"),
            hash_session_token("token-second"),
        ]
        assert all(row["token_hash"] not in {"token-first", "token-second"} for row in rows)

        assert revoke_session(connection.cursor(), "token-first", now=200) == "user-1"
        connection.commit()
    finally:
        connection.close()

    assert session_invalid_reason(load_session_user(database, "token-first"), now=201) == "session_revoked"
    assert session_invalid_reason(load_session_user(database, "token-second"), now=201) is None


def test_revoke_all_sessions_and_authorization_observe_it_immediately(monkeypatch, tmp_path):
    database = _database(tmp_path / "revoke-all.db")
    _create(database, "token-one")
    _create(database, "token-two")
    monkeypatch.setattr(auth_helper, "database", database)
    request = SimpleNamespace(
        cookies={"session_token": "token-one"},
        method="GET",
        headers={},
        client=SimpleNamespace(host="127.0.0.1"),
    )

    valid, role = auth_helper.verify_session(request)
    assert valid is True
    assert role.user_id == "user-1"

    connection = database.get_connection()
    try:
        revoke_user_sessions(connection.cursor(), "user-1", now=250)
        connection.commit()
    finally:
        connection.close()

    valid, _error = auth_helper.verify_session(request)
    assert valid is False
    assert session_invalid_reason(load_session_user(database, "token-two"), now=251) == "session_revoked"


def test_idle_activity_moves_only_idle_expiry_not_absolute_expiry(tmp_path):
    database = _database(tmp_path / "expiry.db")
    _create(database, "token-expiry", now=100, absolute=500)
    user = load_session_user(database, "token-expiry")

    touch_session(database, user, idle_timeout_seconds=300, now=250)

    refreshed = load_session_user(database, "token-expiry")
    assert refreshed["last_seen_at"] == 250
    assert refreshed["idle_expires_at"] == 500
    assert refreshed["absolute_expires_at"] == 500
    assert session_invalid_reason(refreshed, now=499) is None
    assert session_invalid_reason(refreshed, now=500) == "token_expired"


def test_session_touch_skips_quickly_when_another_writer_holds_sqlite(tmp_path):
    database = _database(tmp_path / "locked-touch.db")
    _create(database, "token-locked", now=100, absolute=500)
    user = load_session_user(database, "token-locked")
    writer = database.get_connection()
    writer.execute("BEGIN IMMEDIATE")

    started_at = time.perf_counter()
    try:
        touched = touch_session(database, user, idle_timeout_seconds=300, now=250)
    finally:
        writer.rollback()
        writer.close()

    assert touched is False
    assert time.perf_counter() - started_at < 1
    refreshed = load_session_user(database, "token-locked")
    assert refreshed["last_seen_at"] == 100
