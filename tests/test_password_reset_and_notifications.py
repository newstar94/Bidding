from __future__ import annotations

from collections import deque

import pytest

from backend.auth import password_reset_service as reset
from backend.auth import security_notifications as notifications


class _Result:
    def __init__(self, row=None, rowcount=1):
        self.row = row
        self.rowcount = rowcount

    def fetchone(self):
        return self.row


class _Connection:
    def __init__(self, responses=(), error=None):
        self.responses = deque(responses)
        self.error = error
        self.calls = []
        self.committed = False
        self.rolled_back = False
        self.closed = False

    def execute(self, sql, parameters=()):
        self.calls.append((sql, parameters))
        if self.error:
            raise self.error
        if self.responses:
            value = self.responses.popleft()
            return value if isinstance(value, _Result) else _Result(value)
        return _Result()

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


def test_password_reset_creation_is_indistinguishable_for_unknown_identity() -> None:
    connection = _Connection(responses=[_Result(), _Result(), None])
    assert (
        reset.create_password_reset(
            _Database(connection),
            " Unknown ",
            " Unknown@Example.com ",
            "127.0.0.1",
            now=100,
        )
        is None
    )
    assert connection.calls[2][1] == ("unknown", "unknown@example.com")
    assert connection.committed and connection.closed


def test_password_reset_stores_only_hash_and_bounds_request_ip(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = {
        "id": "user-1",
        "ho_ten": "User",
        "ten_dang_nhap": "user",
        "email": "user@example.com",
    }
    connection = _Connection(
        responses=[_Result(), _Result(), user, _Result(), _Result()]
    )
    monkeypatch.setattr(reset.secrets, "token_urlsafe", lambda _size: "raw-token")
    monkeypatch.setattr(reset.uuid, "uuid4", lambda: "reset-id")
    payload = reset.create_password_reset(
        _Database(connection),
        "user",
        "user@example.com",
        "x" * 200,
        now=100,
    )
    assert payload == {
        "token": "raw-token",
        "email": "user@example.com",
        "name": "User",
        "username": "user",
    }
    insert_parameters = connection.calls[4][1]
    assert insert_parameters[0] == "reset-id"
    assert insert_parameters[2] == reset._token_hash("raw-token")
    assert "raw-token" not in repr(insert_parameters)
    assert len(insert_parameters[4]) == 128
    assert connection.committed and connection.closed


def test_password_reset_creation_rolls_back_on_database_error() -> None:
    connection = _Connection(error=RuntimeError("database"))
    with pytest.raises(RuntimeError):
        reset.create_password_reset(
            _Database(connection), "user", "user@example.com", "", now=100
        )
    assert connection.rolled_back and connection.closed


@pytest.mark.parametrize("token", ["", None, "x" * 513])
def test_reset_redemption_rejects_unbounded_tokens_before_database(token) -> None:
    with pytest.raises(reset.InvalidResetToken):
        reset.redeem_password_reset(_Database(None), token, "password")


@pytest.mark.parametrize(
    "row",
    [
        None,
        {"id": "reset", "user_id": "user", "expires_at": 99, "used_at": None},
        {"id": "reset", "user_id": "user", "expires_at": 200, "used_at": 50},
    ],
)
def test_reset_redemption_rejects_missing_expired_or_used_token(row) -> None:
    connection = _Connection(responses=[_Result(), row])
    with pytest.raises(reset.InvalidResetToken):
        reset.redeem_password_reset(
            _Database(connection), "token", "new password", now=100
        )
    assert connection.rolled_back and connection.closed


def test_reset_redemption_is_single_use_and_revokes_sessions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    row = {"id": "reset", "user_id": "user", "expires_at": 200, "used_at": None}
    connection = _Connection(
        responses=[
            _Result(),
            row,
            _Result(rowcount=1),
            _Result(rowcount=1),
            _Result(),
        ]
    )
    revoked = []
    monkeypatch.setattr(
        reset,
        "revoke_user_sessions",
        lambda cursor, user_id, now: revoked.append((cursor, user_id, now)),
    )
    assert (
        reset.redeem_password_reset(
            _Database(connection),
            "token",
            "unused plaintext",
            now=100,
            password_hash="precomputed-hash",
        )
        == "user"
    )
    assert connection.calls[3][1] == ("precomputed-hash", "user")
    assert revoked == [(connection, "user", 100)]
    assert connection.committed and connection.closed


def test_reset_redemption_detects_consume_race_and_deleted_user() -> None:
    row = {"id": "reset", "user_id": "user", "expires_at": 200, "used_at": None}
    connection = _Connection(
        responses=[_Result(), row, _Result(rowcount=0)]
    )
    with pytest.raises(reset.InvalidResetToken):
        reset.redeem_password_reset(
            _Database(connection), "token", "password", now=100
        )

    connection = _Connection(
        responses=[
            _Result(),
            row,
            _Result(rowcount=1),
            _Result(rowcount=0),
        ]
    )
    with pytest.raises(reset.InvalidResetToken):
        reset.redeem_password_reset(
            _Database(connection),
            "token",
            "password",
            now=100,
            password_hash="hash",
        )
    assert connection.rolled_back and connection.closed


def test_reset_redemption_rolls_back_unexpected_error() -> None:
    connection = _Connection(error=RuntimeError("database"))
    with pytest.raises(RuntimeError):
        reset.redeem_password_reset(
            _Database(connection), "token", "password", now=100
        )
    assert connection.rolled_back and connection.closed


def test_security_notification_escapes_untrusted_content() -> None:
    assert (
        notifications.build_security_notification_tasks(
            email="", display_name="User", subject="subject", message="message"
        )
        is None
    )
    tasks = notifications.build_security_notification_tasks(
        email="user@example.com",
        display_name="<script>alert(1)</script>",
        subject="subject",
        message="<img src=x onerror=alert(1)>",
    )
    assert tasks is not None
    task = tasks.tasks[0]
    body = task.args[2]
    assert "<script>" not in body
    assert "<img" not in body
    assert "&lt;script&gt;" in body


def test_notification_batch_deduplicates_bounds_and_skips_empty() -> None:
    recipients = [
        ("", "Empty"),
        ("One@Example.com", "One"),
        ("one@example.com", "Duplicate"),
        ("two@example.com", "Two"),
    ]
    tasks = notifications.build_security_notification_batch(
        recipients,
        subject="subject",
        message="message",
        max_recipients=3,
    )
    assert tasks is not None
    assert len(tasks.tasks) == 1
    assert (
        notifications.build_security_notification_batch(
            [], subject="subject", message="message"
        )
        is None
    )
