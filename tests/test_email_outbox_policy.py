from __future__ import annotations

import asyncio
from collections import deque
from types import SimpleNamespace

from cryptography.fernet import Fernet
import pytest

from backend.auth import email_delivery_service as outbox
from backend.shared.async_io import BlockingIOBusyError


class _Result:
    def __init__(self, row=None, rowcount=1):
        self.row = row
        self.rowcount = rowcount

    def fetchone(self):
        return self.row


class _Connection:
    def __init__(self, responses=(), *, error=None):
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
            response = self.responses.popleft()
            return response if isinstance(response, _Result) else _Result(response)
        return _Result()

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def close(self):
        self.closed = True


class _Database:
    def __init__(self, connections):
        self.connections = deque(connections)

    def get_connection(self):
        return self.connections.popleft()


@pytest.fixture
def encryption_key(monkeypatch: pytest.MonkeyPatch) -> str:
    key = Fernet.generate_key().decode("ascii")
    monkeypatch.setenv("EMAIL_OUTBOX_ENCRYPTION_KEY", key)
    return key


def test_outbox_key_configuration_and_production_requirements(
    encryption_key: str,
) -> None:
    assert outbox._configured_key(
        {"EMAIL_OUTBOX_ENCRYPTION_KEY": encryption_key}
    ) == encryption_key
    assert outbox._configured_key({}) == ""

    outbox.validate_email_outbox_configuration(
        {"EMAIL_OUTBOX_ENCRYPTION_KEY": encryption_key}, required=True
    )
    outbox.validate_email_outbox_configuration({}, required=False)
    with pytest.raises(outbox.EmailOutboxConfigurationError):
        outbox.validate_email_outbox_configuration({}, required=True)
    with pytest.raises(outbox.EmailOutboxConfigurationError):
        outbox.validate_email_outbox_configuration(
            {"EMAIL_OUTBOX_ENCRYPTION_KEY": "invalid"}, required=True
        )


def test_outbox_authenticated_encryption_and_recipient_hash(
    encryption_key: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    ciphertext = outbox._encrypt("sensitive")
    assert "sensitive" not in ciphertext
    assert outbox._decrypt(ciphertext) == "sensitive"
    assert outbox._recipient_hash(" User@Example.com ") == outbox._recipient_hash(
        "user@example.COM"
    )
    with pytest.raises(outbox.EmailOutboxPayloadError):
        outbox._decrypt("tampered")
    monkeypatch.delenv("EMAIL_OUTBOX_ENCRYPTION_KEY")
    with pytest.raises(outbox.EmailOutboxConfigurationError):
        outbox._fernet()


def test_create_delivery_is_atomic_and_never_stores_plaintext(
    encryption_key: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(outbox.uuid, "uuid4", lambda: "delivery-id")
    cursor = _Connection()
    assert (
        outbox.create_email_delivery(
            cursor,
            user_id="user-1",
            purpose="google_temporary_password",
            recipient="user@example.com",
            subject="Temporary password",
            html_body="<b>secret</b>",
            now=100,
        )
        == "delivery-id"
    )
    parameters = cursor.calls[0][1]
    assert parameters[0:3] == (
        "delivery-id",
        "user-1",
        "google_temporary_password",
    )
    assert "user@example.com" not in repr(parameters)
    assert "Temporary password" not in repr(parameters)
    assert "<b>secret</b>" not in repr(parameters)
    assert parameters[-3:] == (100, 100, 100)

    cursor = _Connection()
    outbox.create_email_delivery(
        cursor,
        user_id="user",
        purpose="deferred",
        recipient="user@example.com",
        now=100,
    )
    assert cursor.calls[0][1][4:7] == (None, None, None)
    with pytest.raises(ValueError):
        outbox.create_email_delivery(
            _Connection(),
            user_id="user",
            purpose="bad",
            recipient="user@example.com",
            subject="subject only",
        )


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, "SMTP_DELIVERY_FAILED"),
        ("timeout", "TIMEOUT"),
        ("bad value!", "SMTP_DELIVERY_FAILED"),
        ("x" * 65, "SMTP_DELIVERY_FAILED"),
    ],
)
def test_error_codes_are_bounded(value, expected: str) -> None:
    assert outbox._safe_error_code(value) == expected


def test_store_payload_handles_missing_existing_and_rollback(
    encryption_key: str,
) -> None:
    connection = _Connection(
        responses=[
            _Result(),
            {"status": "pending", "recipient_ciphertext": None},
            _Result(),
        ]
    )
    outbox._store_payload_if_missing(
        _Database([connection]),
        "delivery",
        "user@example.com",
        "subject",
        "body",
        True,
    )
    assert connection.committed and connection.closed
    update_parameters = connection.calls[2][1]
    assert "user@example.com" not in repr(update_parameters)

    connection = _Connection(
        responses=[
            _Result(),
            {"status": "pending", "recipient_ciphertext": "already"},
        ]
    )
    outbox._store_payload_if_missing(
        _Database([connection]),
        "delivery",
        "user@example.com",
        "subject",
        "body",
        True,
    )
    assert len(connection.calls) == 2

    connection = _Connection(responses=[_Result(), None])
    with pytest.raises(outbox.EmailOutboxPayloadError):
        outbox._store_payload_if_missing(
            _Database([connection]),
            "missing",
            "user@example.com",
            "subject",
            "body",
            True,
        )
    assert connection.rolled_back and connection.closed

    connection = _Connection(error=RuntimeError("database"))
    with pytest.raises(RuntimeError):
        outbox._store_payload_if_missing(
            _Database([connection]),
            "delivery",
            "user@example.com",
            "subject",
            "body",
            True,
        )
    assert connection.rolled_back and connection.closed


def test_claim_delivery_handles_empty_claim_and_stale_setting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("EMAIL_OUTBOX_STALE_SECONDS", "invalid")
    connection = _Connection(responses=[_Result(), None])
    assert outbox._claim_email_delivery(_Database([connection])) is None
    assert connection.committed and connection.closed

    monkeypatch.setenv("EMAIL_OUTBOX_STALE_SECONDS", "1")
    row = {
        "id": "delivery",
        "recipient_ciphertext": "recipient",
        "subject_ciphertext": "subject",
        "body_ciphertext": "body",
        "sensitive_content": 1,
        "attempt_count": 1,
    }
    connection = _Connection(responses=[_Result(), row, _Result()])
    claimed = outbox._claim_email_delivery(
        _Database([connection]), delivery_id="delivery", max_attempts=3
    )
    assert claimed["attempt_count"] == 2
    assert claimed["lock_token"].startswith(f"{outbox._WORKER_ID}:")
    assert connection.committed and connection.closed

    connection = _Connection(error=RuntimeError("database"))
    with pytest.raises(RuntimeError):
        outbox._claim_email_delivery(_Database([connection]))
    assert connection.rolled_back and connection.closed


@pytest.mark.parametrize(
    ("accepted", "attempts", "expected_status", "expected_result"),
    [
        (True, 1, "sent", True),
        (False, 1, "retry", False),
        (False, 3, "failed", False),
    ],
)
def test_finish_delivery_transitions_are_lock_token_bound(
    accepted: bool,
    attempts: int,
    expected_status: str,
    expected_result: bool,
) -> None:
    connection = _Connection(responses=[_Result(rowcount=1)])
    result = SimpleNamespace(accepted=accepted, error_code="timeout")
    assert (
        outbox._finish_email_delivery(
            _Database([connection]),
            {"id": "delivery", "attempt_count": attempts, "lock_token": "lock"},
            result,
            max_attempts=3,
            now=100,
        )
        is expected_result
    )
    parameters = connection.calls[0][1]
    assert parameters[0] == expected_status
    assert parameters[-2:] == ("delivery", "lock")
    assert connection.committed and connection.closed


def test_finish_delivery_requires_successful_locked_update() -> None:
    connection = _Connection(responses=[_Result(rowcount=0)])
    assert not outbox._finish_email_delivery(
        _Database([connection]),
        {"id": "delivery", "attempt_count": 1, "lock_token": "wrong"},
        True,
        max_attempts=3,
        now=100,
    )
    connection = _Connection(error=RuntimeError("database"))
    with pytest.raises(RuntimeError):
        outbox._finish_email_delivery(
            _Database([connection]),
            {"id": "delivery", "attempt_count": 1, "lock_token": "lock"},
            True,
            max_attempts=3,
        )
    assert connection.rolled_back and connection.closed


def test_deliver_claimed_maps_payload_and_smtp_failures(
    encryption_key: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    claimed = {
        "id": "delivery",
        "recipient_ciphertext": outbox._encrypt("user@example.com"),
        "subject_ciphertext": outbox._encrypt("subject"),
        "body_ciphertext": outbox._encrypt("body"),
        "sensitive_content": 1,
        "attempt_count": 1,
        "lock_token": "lock",
    }
    captured = []
    monkeypatch.setattr(
        outbox,
        "gui_email",
        lambda *args: captured.append(args)
        or SimpleNamespace(accepted=True, error_code=None),
    )
    monkeypatch.setattr(
        outbox,
        "_finish_email_delivery",
        lambda _database, _claimed, result, **_kwargs: bool(result),
    )
    assert outbox._deliver_claimed(object(), claimed)
    assert captured[0] == ("user@example.com", "subject", "body", True)

    invalid = {**claimed, "recipient_ciphertext": "tampered"}
    results = []
    monkeypatch.setattr(
        outbox,
        "_finish_email_delivery",
        lambda _database, _claimed, result, **_kwargs: results.append(result)
        or False,
    )
    assert not outbox._deliver_claimed(object(), invalid)
    assert results[-1].error_code == "OUTBOX_PAYLOAD_INVALID"

    monkeypatch.setattr(
        outbox, "gui_email", lambda *_args: (_ for _ in ()).throw(OSError("smtp"))
    )
    assert not outbox._deliver_claimed(object(), claimed)
    assert results[-1].error_code == "SMTP_DELIVERY_FAILED"


def test_deliver_once_handles_compatibility_payload_and_terminal_status(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(ValueError):
        outbox.deliver_email_once(
            _Database([]), "delivery", recipient="user@example.com"
        )

    stored = []
    monkeypatch.setattr(
        outbox,
        "_store_payload_if_missing",
        lambda *args, **kwargs: stored.append((args, kwargs)),
    )
    monkeypatch.setattr(outbox, "_claim_email_delivery", lambda *_args, **_kwargs: None)
    sent_connection = _Connection(responses=[{"status": "sent"}])
    assert outbox.deliver_email_once(
        _Database([sent_connection]),
        "delivery",
        "user@example.com",
        "subject",
        "body",
    )
    assert stored
    pending_connection = _Connection(responses=[{"status": "pending"}])
    assert not outbox.deliver_email_once(_Database([pending_connection]), "delivery")

    monkeypatch.setattr(
        outbox,
        "_claim_email_delivery",
        lambda *_args, **_kwargs: {"id": "delivery"},
    )
    monkeypatch.setattr(
        outbox, "_deliver_claimed", lambda *_args, **_kwargs: True
    )
    assert outbox.deliver_email_once(_Database([]), "delivery")


def test_retry_delivery_terminal_attempt_and_success(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(ValueError):
        outbox.retry_email_delivery(
            _Database([]), "delivery", subject="subject"
        )
    assert outbox.retry_email_delivery(
        _Database([_Connection(responses=[{"status": "sent", "attempt_count": 1}])]),
        "delivery",
    )
    assert not outbox.retry_email_delivery(
        _Database([_Connection(responses=[None])]), "delivery"
    )
    assert not outbox.retry_email_delivery(
        _Database(
            [
                _Connection(
                    responses=[
                        {"status": "retry", "attempt_count": 3, "next_attempt_at": 0}
                    ]
                )
            ]
        ),
        "delivery",
        max_attempts=3,
    )

    monkeypatch.setattr(outbox.random, "uniform", lambda *_args: 0)
    monkeypatch.setattr(outbox.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(outbox, "deliver_email_once", lambda *_args, **_kwargs: True)
    assert outbox.retry_email_delivery(
        _Database(
            [
                _Connection(
                    responses=[
                        {"status": "retry", "attempt_count": 1, "next_attempt_at": 0}
                    ]
                )
            ]
        ),
        "delivery",
    )


def test_process_next_delivery_reports_work(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(outbox, "_claim_email_delivery", lambda *_args: None)
    assert not outbox.process_next_email_delivery(object())
    monkeypatch.setattr(outbox, "_claim_email_delivery", lambda *_args: {"id": "x"})
    delivered = []
    monkeypatch.setattr(
        outbox, "_deliver_claimed", lambda *_args: delivered.append(True)
    )
    assert outbox.process_next_email_delivery(object())
    assert delivered


def test_worker_poll_paths_and_cancellation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("WORKER_IDLE_POLL_JITTER_RATIO", "0")

    async def exercise() -> None:
        sleeps = []

        async def cancel_after_sleep(seconds):
            sleeps.append(seconds)
            raise asyncio.CancelledError

        async def processed(*_args, **_kwargs):
            return True

        monkeypatch.setattr(outbox, "run_blocking_io", processed)
        monkeypatch.setattr(outbox.asyncio, "sleep", cancel_after_sleep)
        with pytest.raises(asyncio.CancelledError):
            await outbox.run_email_delivery_worker(object())
        assert sleeps == [0.05]

        async def busy(*_args, **_kwargs):
            raise BlockingIOBusyError("busy")

        monkeypatch.setattr(outbox, "run_blocking_io", busy)
        monkeypatch.setenv("EMAIL_OUTBOX_POLL_SECONDS", "invalid")
        sleeps.clear()
        with pytest.raises(asyncio.CancelledError):
            await outbox.run_email_delivery_worker(object())
        assert sleeps == [5.0]

        async def cancelled(*_args, **_kwargs):
            raise asyncio.CancelledError

        monkeypatch.setattr(outbox, "run_blocking_io", cancelled)
        with pytest.raises(asyncio.CancelledError):
            await outbox.run_email_delivery_worker(object())

    asyncio.run(exercise())


def test_worker_idle_backoff_resets_after_a_delivery(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("EMAIL_OUTBOX_POLL_SECONDS", "2")
    monkeypatch.setenv("EMAIL_OUTBOX_MAX_POLL_SECONDS", "8")
    monkeypatch.setenv("WORKER_IDLE_POLL_JITTER_RATIO", "0")

    async def exercise() -> None:
        outcomes = iter([False, False, True, False])
        sleeps = []

        async def process(*_args, **_kwargs):
            return next(outcomes)

        async def record_sleep(seconds):
            sleeps.append(seconds)
            if len(sleeps) == 4:
                raise asyncio.CancelledError

        monkeypatch.setattr(outbox, "run_blocking_io", process)
        monkeypatch.setattr(outbox.asyncio, "sleep", record_sleep)
        with pytest.raises(asyncio.CancelledError):
            await outbox.run_email_delivery_worker(object())

        assert sleeps == [2.0, 4.0, 0.05, 2.0]

    asyncio.run(exercise())


def test_cleanup_uses_leader_lock_and_recovers_stale_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    logs = []
    monkeypatch.setattr(
        outbox, "log_structured_event", lambda *args, **kwargs: logs.append(args)
    )
    follower = _Connection(responses=[_Result(), (False,)])
    outbox.fail_stale_email_deliveries(_Database([follower]))
    assert follower.rolled_back and follower.closed
    assert not logs

    leader = _Connection(
        responses=[_Result(), (True,), _Result(), _Result(), _Result()]
    )
    outbox.fail_stale_email_deliveries(
        _Database([leader]), stale_after_seconds=1, retention_days=0
    )
    assert leader.committed and leader.closed
    assert logs[-1] == ("email.delivery_status_cleanup",)

    failed = _Connection(error=RuntimeError("database"))
    with pytest.raises(RuntimeError):
        outbox.fail_stale_email_deliveries(_Database([failed]))
    assert failed.rolled_back and failed.closed
