"""Credential serialization against real PostgreSQL row locks.

Each test owns a UUID schema in an explicitly configured test database.
SQLite persistence controls live with the owning auth route tests.
"""

import os
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import psycopg
import pytest
from psycopg import sql

from backend.auth.auth_helper import verify_session_in_transaction
from backend.auth import password_reset_service, session_store
from backend.auth.password_reset_service import (
    InvalidResetToken,
    create_password_reset,
    create_password_setup_token,
    invalidate_password_reset_tokens,
    redeem_password_reset,
)
from backend.auth.session_store import create_session, replace_user_session
from backend.db.db_helper import PostgresCursor, compat_row_factory


class _Connection:
    def __init__(self, raw):
        self.raw = raw

    def cursor(self):
        return PostgresCursor(self.raw.cursor())

    def execute(self, statement, parameters=()):
        return self.cursor().execute(statement, parameters)

    def __getattr__(self, name):
        return getattr(self.raw, name)


class _Database:
    def __init__(self, url, schema):
        self.url, self.schema = url, schema
        self.connection_created = None

    def get_connection(self):
        raw = psycopg.connect(self.url, autocommit=True, row_factory=compat_row_factory)
        raw.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(self.schema)))
        raw.execute("SET statement_timeout = '8s'")
        raw.execute("SET lock_timeout = '5s'")
        if self.connection_created:
            self.connection_created(raw.info.backend_pid)
        return _Connection(raw)


@pytest.fixture
def credential_database():
    url = str(os.environ.get("TEST_DATABASE_URL") or "").strip()
    if not url:
        pytest.skip("TEST_DATABASE_URL is required for credential PostgreSQL races")
    schema = "auth_credential_" + uuid.uuid4().hex
    admin = psycopg.connect(url, autocommit=True)
    admin.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
    database = _Database(url, schema)
    connection = database.get_connection()
    try:
        connection.execute("""CREATE TABLE tai_khoan (
            id TEXT PRIMARY KEY, mat_khau TEXT, trang_thai TEXT,
            username_norm TEXT, email_norm TEXT, email TEXT,
            ho_ten TEXT, ten_dang_nhap TEXT, vai_tro TEXT
        )""")
        connection.execute("""CREATE TABLE auth_sessions (
            id TEXT PRIMARY KEY, user_id TEXT REFERENCES tai_khoan(id),
            token_hash TEXT UNIQUE, created_at BIGINT, last_seen_at BIGINT,
            idle_expires_at BIGINT, absolute_expires_at BIGINT,
            revoked_at BIGINT, remember_me INTEGER, device_info TEXT,
            privileged_reauth_at BIGINT, active_role TEXT,
            active_role_organization_id TEXT
        )""")
        connection.execute("""CREATE UNIQUE INDEX one_active_session
            ON auth_sessions (user_id) WHERE revoked_at IS NULL""")
        connection.execute("""CREATE TABLE password_reset_tokens (
            id TEXT PRIMARY KEY, user_id TEXT REFERENCES tai_khoan(id),
            token_hash TEXT UNIQUE, expires_at BIGINT, used_at BIGINT,
            requested_ip TEXT, created_at BIGINT
        )""")
        connection.execute("""INSERT INTO tai_khoan VALUES (
            'user-1', 'original-hash', 'active', 'owner',
            'owner@example.test', 'owner@example.test', 'Owner', 'owner', 'user'
        )""")
        create_session(
            connection, user_id="user-1", token="original-session",
            absolute_expires_at=int(time.time()) + 3_600, idle_timeout_seconds=3_600,
        )
        yield database
    finally:
        connection.close()
        admin.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))
        admin.close()


def _watch_worker(database):
    ready = threading.Event()
    worker = {}
    def record_pid(pid):
        worker["pid"] = pid
        ready.set()
    database.connection_created = record_pid
    return ready, worker


def _wait_for_account_block(observer, future, ready, worker, owner):
    assert ready.wait(5), "Worker did not connect"
    deadline = time.monotonic() + 5
    poll = threading.Event()
    while time.monotonic() < deadline:
        blockers = observer.execute("SELECT pg_blocking_pids(?)", (worker["pid"],)).fetchone()[0]
        if owner.raw.info.backend_pid in blockers:
            return
        assert not future.done(), "Credential writer completed before account lock was released"
        poll.wait(0.01)
    raise AssertionError("Credential writer did not wait for the locked account")


@pytest.mark.parametrize("rotation", ["password", "email"])
def test_reset_redemption_waits_for_account_then_rejects_rotated_link(credential_database, rotation):
    database = credential_database
    owner, observer = database.get_connection(), database.get_connection()
    token = create_password_setup_token(owner, "user-1")["token"]
    owner.execute("BEGIN")
    owner.execute("SELECT id FROM tai_khoan WHERE id = 'user-1' FOR UPDATE")
    ready, worker = _watch_worker(database)
    pool = ThreadPoolExecutor(max_workers=1)
    future = pool.submit(
        redeem_password_reset, database, token, "unused",
        password_hash="stolen-link-hash", audit=lambda *_args, **_kwargs: None,
    )
    try:
        _wait_for_account_block(observer, future, ready, worker, owner)
        owner.execute("SET LOCAL lock_timeout = '1s'")
        if rotation == "password":
            owner.execute("UPDATE tai_khoan SET mat_khau = 'rotated-hash' WHERE id = 'user-1'")
        else:
            owner.execute("""UPDATE tai_khoan SET email = 'new@example.test',
                email_norm = 'new@example.test' WHERE id = 'user-1'""")
        invalidate_password_reset_tokens(owner, "user-1")
        owner.commit()
        with pytest.raises(InvalidResetToken):
            future.result(timeout=5)
        assert observer.execute("SELECT mat_khau FROM tai_khoan").fetchone()[0] == (
            "rotated-hash" if rotation == "password" else "original-hash"
        )
    finally:
        owner.rollback()
        pool.shutdown(wait=True, cancel_futures=True)
        owner.close()
        observer.close()


def test_session_authority_account_lock_allows_login_replacement_to_finish(credential_database):
    database = credential_database
    owner, observer = database.get_connection(), database.get_connection()
    owner.execute("BEGIN")
    owner.execute("SELECT id FROM tai_khoan WHERE id = 'user-1' FOR UPDATE")
    ready, worker = _watch_worker(database)
    def check_authority():
        connection = database.get_connection()
        try:
            connection.execute("BEGIN")
            result = verify_session_in_transaction(connection, SimpleNamespace(
                cookies={"session_token": "original-session"}, headers={},
            ))
            connection.commit()
            return result
        finally:
            connection.close()
    pool = ThreadPoolExecutor(max_workers=1)
    future = pool.submit(check_authority)
    try:
        _wait_for_account_block(observer, future, ready, worker, owner)
        owner.execute("SET LOCAL lock_timeout = '1s'")
        replace_user_session(
            owner.cursor(), user_id="user-1", token="replacement-session",
            absolute_expires_at=int(time.time()) + 3_600, idle_timeout_seconds=3_600,
        )
        owner.commit()
        valid, _message = future.result(timeout=5)
        assert valid is False
        assert observer.execute("SELECT count(*) FROM auth_sessions WHERE revoked_at IS NULL").fetchone()[0] == 1
    finally:
        owner.rollback()
        pool.shutdown(wait=True, cancel_futures=True)
        owner.close()
        observer.close()


def test_recovery_issuance_waits_for_email_rotation_and_preserves_identity_match(credential_database):
    database = credential_database
    owner, observer = database.get_connection(), database.get_connection()
    create_password_setup_token(owner, "user-1")
    owner.execute("BEGIN")
    owner.execute("SELECT id FROM tai_khoan WHERE id = 'user-1' FOR UPDATE")
    ready, worker = _watch_worker(database)
    pool = ThreadPoolExecutor(max_workers=1)
    future = pool.submit(create_password_reset, database, "owner", "owner@example.test", "192.0.2.1")
    try:
        _wait_for_account_block(observer, future, ready, worker, owner)
        owner.execute("SET LOCAL lock_timeout = '1s'")
        owner.execute("""UPDATE tai_khoan SET email = 'new@example.test',
            email_norm = 'new@example.test' WHERE id = 'user-1'""")
        invalidate_password_reset_tokens(owner, "user-1")
        owner.commit()
        assert future.result(timeout=5) is None
        assert observer.execute("SELECT count(*) FROM password_reset_tokens WHERE used_at IS NULL").fetchone()[0] == 0
        database.connection_created = None
        legitimate = create_password_reset(database, "owner", "new@example.test", "192.0.2.1")
        assert legitimate["email"] == "new@example.test"
        assert redeem_password_reset(
            database, legitimate["token"], "unused", password_hash="legitimate-hash",
            audit=lambda *_args, **_kwargs: None,
        ) == "user-1"
    finally:
        owner.rollback()
        pool.shutdown(wait=True, cancel_futures=True)
        owner.close()
        observer.close()


def test_setup_issuance_waits_for_account_before_existing_token_invalidation(credential_database):
    database = credential_database
    owner, observer = database.get_connection(), database.get_connection()
    create_password_setup_token(owner, "user-1")
    owner.execute("BEGIN")
    owner.execute("SELECT id FROM tai_khoan WHERE id = 'user-1' FOR UPDATE")
    ready, worker = _watch_worker(database)
    def issue_setup():
        connection = database.get_connection()
        try:
            connection.execute("BEGIN")
            result = create_password_setup_token(connection, "user-1")
            connection.commit()
            return result
        finally:
            connection.close()
    pool = ThreadPoolExecutor(max_workers=1)
    future = pool.submit(issue_setup)
    try:
        _wait_for_account_block(observer, future, ready, worker, owner)
        owner.execute("SET LOCAL lock_timeout = '1s'")
        invalidate_password_reset_tokens(owner, "user-1")
        owner.commit()
        issued = future.result(timeout=5)
        assert issued["token"]
        assert observer.execute("SELECT count(*) FROM password_reset_tokens WHERE used_at IS NULL").fetchone()[0] == 1
    finally:
        owner.rollback()
        pool.shutdown(wait=True, cancel_futures=True)
        owner.close()
        observer.close()


def test_reset_expiry_is_rechecked_after_waiting_for_account_lock(credential_database, monkeypatch):
    database = credential_database
    owner, observer = database.get_connection(), database.get_connection()
    token = create_password_setup_token(owner, "user-1", now=1_000, ttl_seconds=1)["token"]
    clock = {"now": 1_000}
    monkeypatch.setattr(password_reset_service, "time", SimpleNamespace(time=lambda: clock["now"]))
    owner.execute("BEGIN")
    owner.execute("SELECT id FROM tai_khoan WHERE id = 'user-1' FOR UPDATE")
    ready, worker = _watch_worker(database)
    pool = ThreadPoolExecutor(max_workers=1)
    future = pool.submit(
        redeem_password_reset, database, token, "unused", password_hash="expired-hash",
        audit=lambda *_args, **_kwargs: None,
    )
    try:
        _wait_for_account_block(observer, future, ready, worker, owner)
        clock["now"] = 1_100
        owner.commit()
        with pytest.raises(InvalidResetToken):
            future.result(timeout=5)
        assert observer.execute("SELECT mat_khau FROM tai_khoan").fetchone()[0] == "original-hash"
        assert observer.execute("SELECT used_at FROM password_reset_tokens").fetchone()[0] is None
    finally:
        owner.rollback()
        pool.shutdown(wait=True, cancel_futures=True)
        owner.close()
        observer.close()


def test_session_expiry_is_rechecked_after_waiting_for_account_lock(credential_database, monkeypatch):
    database = credential_database
    owner, observer = database.get_connection(), database.get_connection()
    owner.execute("UPDATE auth_sessions SET idle_expires_at = 1001, absolute_expires_at = 1001")
    clock = {"now": 1_000}
    monkeypatch.setattr(session_store, "time", SimpleNamespace(time=lambda: clock["now"]))
    owner.execute("BEGIN")
    owner.execute("SELECT id FROM tai_khoan WHERE id = 'user-1' FOR UPDATE")
    ready, worker = _watch_worker(database)
    def check_authority():
        connection = database.get_connection()
        try:
            connection.execute("BEGIN")
            result = verify_session_in_transaction(connection, SimpleNamespace(
                cookies={"session_token": "original-session"}, headers={},
            ))
            connection.commit()
            return result
        finally:
            connection.close()
    pool = ThreadPoolExecutor(max_workers=1)
    future = pool.submit(check_authority)
    try:
        _wait_for_account_block(observer, future, ready, worker, owner)
        clock["now"] = 1_100
        owner.commit()
        valid, _message = future.result(timeout=5)
        assert valid is False
    finally:
        owner.rollback()
        pool.shutdown(wait=True, cancel_futures=True)
        owner.close()
        observer.close()
