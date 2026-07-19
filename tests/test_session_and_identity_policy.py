from __future__ import annotations

import pytest

from backend.auth import identity, roles, session_store
from backend.db.db_helper import IntegrityError, OperationalError


class _Cursor:
    def __init__(self, rows=(), rowcount=1):
        self.rows = list(rows)
        self.rowcount = rowcount
        self.calls = []

    def execute(self, sql, parameters=()):
        self.calls.append((sql, parameters))
        return self

    def fetchone(self):
        return self.rows.pop(0) if self.rows else None


class _Connection(_Cursor):
    def __init__(self, rows=(), *, execute_error=None):
        super().__init__(rows)
        self.execute_error = execute_error
        self.committed = False
        self.rolled_back = False
        self.closed = False

    def execute(self, sql, parameters=()):
        if self.execute_error:
            raise self.execute_error
        return super().execute(sql, parameters)

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def close(self):
        self.closed = True


class _Database:
    def __init__(self, connection):
        self.connection = connection

    def get_connection(self):
        return self.connection


def test_session_token_hash_and_creation_bounds_idle_expiry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(session_store.uuid, "uuid4", lambda: "session-id")
    cursor = _Cursor()
    session_id = session_store.create_session(
        cursor,
        user_id="user-1",
        token="secret-token",
        absolute_expires_at=1_000,
        idle_timeout_seconds=10,
        remember=True,
        device_info="browser",
        now=100,
    )
    assert session_id == "session-id"
    parameters = cursor.calls[0][1]
    assert parameters[0] == "session-id"
    assert parameters[1] == "user-1"
    assert parameters[2] == session_store.hash_session_token("secret-token")
    assert parameters[5] == 160
    assert parameters[-1] == "browser"

    cursor = _Cursor()
    session_store.create_session(
        cursor,
        user_id="user-1",
        token="token",
        absolute_expires_at=120,
        idle_timeout_seconds=9_999,
        now=100,
    )
    assert cursor.calls[0][1][5] == 120
    assert cursor.calls[0][1][-1] is None


def test_replace_user_session_locks_account_revokes_old_and_creates_new(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events = []
    cursor = _Cursor()
    monkeypatch.setattr(
        session_store,
        "revoke_user_sessions",
        lambda target, user_id, **kwargs: events.append(
            ("revoke", target, user_id, kwargs)
        ),
    )
    monkeypatch.setattr(
        session_store,
        "create_session",
        lambda target, **kwargs: events.append(("create", target, kwargs))
        or "new-session",
    )

    session_id = session_store.replace_user_session(
        cursor,
        user_id="user-1",
        token="new-token",
        absolute_expires_at=1_000,
        idle_timeout_seconds=300,
        remember=True,
        device_info="browser",
        now=100,
    )

    assert session_id == "new-session"
    assert "FOR UPDATE" in cursor.calls[0][0]
    assert cursor.calls[0][1] == ("user-1",)
    assert events[0] == ("revoke", cursor, "user-1", {"now": 100})
    assert events[1][0] == "create"
    assert events[1][2]["now"] == 100
    assert events[1][2]["token"] == "new-token"


def test_load_session_user_handles_empty_found_missing_and_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert session_store.load_session_user(_Database(_Connection()), "") is None
    metrics = []
    monkeypatch.setattr(
        session_store,
        "record_database_phase",
        lambda *args, **kwargs: metrics.append((args, kwargs)),
    )
    row = {
        "id": "user-1",
        "vai_tro": "user",
        "absolute_expires_at": 1_000,
    }
    connection = _Connection(rows=[row])
    assert session_store.load_session_user(_Database(connection), " token ") == row
    assert connection.closed
    assert metrics[-1][1]["outcome"] == "ok"
    assert connection.calls[0][1] == (
        session_store.hash_session_token("token"),
    )

    connection = _Connection(rows=[None])
    assert session_store.load_session_user(_Database(connection), "missing") is None
    assert metrics[-1][1]["outcome"] == "not_found"

    connection = _Connection(execute_error=RuntimeError("database failed"))
    with pytest.raises(RuntimeError):
        session_store.load_session_user(_Database(connection), "token")
    assert connection.closed
    assert metrics[-1][1]["outcome"] == "error"


@pytest.mark.parametrize(
    ("user", "now", "reason"),
    [
        (None, 100, "user_not_found"),
        ({"revoked_at": 1}, 100, "session_revoked"),
        (
            {"revoked_at": None, "absolute_expires_at": 100, "idle_expires_at": 200},
            100,
            "token_expired",
        ),
        (
            {"revoked_at": None, "absolute_expires_at": 200, "idle_expires_at": 100},
            100,
            "session_idle_expired",
        ),
        (
            {"revoked_at": None, "absolute_expires_at": 200, "idle_expires_at": 150},
            100,
            None,
        ),
    ],
)
def test_session_invalid_reason(user, now: int, reason: str | None) -> None:
    assert session_store.session_invalid_reason(user, now) == reason


def test_touch_session_commits_and_updates_local_state() -> None:
    connection = _Connection()
    user = {"session_id": "session", "absolute_expires_at": 1_000}
    assert session_store.touch_session(
        _Database(connection), user, idle_timeout_seconds=10, now=100
    )
    assert connection.committed
    assert connection.closed
    assert user["last_seen_at"] == 100
    assert user["idle_expires_at"] == 160


def test_touch_session_retries_only_transient_operational_errors() -> None:
    transient = OperationalError("lock")
    transient.sqlstate = "55P03"
    connection = _Connection(execute_error=transient)
    assert not session_store.touch_session(
        _Database(connection),
        {"session_id": "session", "absolute_expires_at": 1_000},
        idle_timeout_seconds=60,
        now=100,
    )
    assert connection.rolled_back
    assert connection.closed

    permanent = OperationalError("broken")
    permanent.sqlstate = "08006"
    connection = _Connection(execute_error=permanent)
    with pytest.raises(OperationalError):
        session_store.touch_session(
            _Database(connection),
            {"session_id": "session", "absolute_expires_at": 1_000},
            idle_timeout_seconds=60,
            now=100,
        )
    assert connection.closed


def test_session_revocation_and_step_up_updates_are_hash_bound() -> None:
    cursor = _Cursor(rows=[("user-1",)])
    assert session_store.revoke_session(cursor, "token", now=100) == "user-1"
    assert cursor.calls[0][1] == (session_store.hash_session_token("token"),)
    assert cursor.calls[1][1] == (
        100,
        session_store.hash_session_token("token"),
    )
    assert session_store.revoke_session(_Cursor(rows=[None]), "missing", now=100) is None

    cursor = _Cursor()
    session_store.revoke_user_sessions(
        cursor, "user-1", except_session_id="keep", now=100
    )
    assert cursor.calls[0][1] == (100, "user-1", "keep")
    cursor = _Cursor()
    session_store.revoke_user_sessions(cursor, "user-1", now=100)
    assert cursor.calls[0][1] == (100, "user-1")

    assert session_store.set_session_reauthentication(
        _Cursor(rowcount=1), "token", 123
    )
    assert not session_store.set_session_reauthentication(
        _Cursor(rowcount=0), "token", 123
    )


def test_identity_normalization_and_conflict_payloads() -> None:
    assert identity.normalize_username(" User ") == "user"
    assert identity.normalize_email(" User@Example.COM ") == "user@example.com"
    assert identity.identity_conflict_code(ValueError("not database")) is None

    cases = {
        "tai_khoan_username_norm_key": "USERNAME_ALREADY_EXISTS",
        "tai_khoan_email_norm_key": "EMAIL_ALREADY_EXISTS",
        "dinh_danh_ngoai_pkey": "EXTERNAL_IDENTITY_ALREADY_LINKED",
        "dinh_danh_ngoai_user_id_issuer_key": "EXTERNAL_PROVIDER_ALREADY_LINKED",
    }
    for constraint, expected in cases.items():
        error = IntegrityError(constraint)
        code = identity.identity_conflict_code(error)
        assert code == expected
        assert identity.conflict_payload(code)["code"] == expected

    error = IntegrityError("unrelated")
    assert identity.identity_conflict_code(error) is None
    assert identity.conflict_payload("UNKNOWN")["code"] == "UNKNOWN"


def test_role_normalization_never_promotes_unknown_values() -> None:
    assert roles.normalize_platform_role(" SUPER_ADMIN ") == "super_admin"
    assert roles.normalize_platform_role("manager") == "user"
    assert roles.normalize_organization_role(" MANAGER ") == "manager"
    assert roles.normalize_organization_role("super_admin") is None
    assert roles.effective_access_roles("super_admin") == [
        "super_admin",
        "manager",
        "employee",
    ]
    assert roles.effective_access_roles("user", "manager") == [
        "manager",
        "employee",
    ]
    assert roles.effective_access_roles("user", "employee") == ["employee"]
    assert roles.effective_access_roles("user", None) == ["employee"]
