import asyncio
from types import SimpleNamespace

import pytest

from backend.ai import quota_service
from backend.ai.quota_service import TokenReservation
from backend.ai.service import _cancellation_safe_write, estimate_request_token_budget
from backend.auth.session_store import replace_user_session


class _Result:
    def __init__(self, row):
        self.row = row

    def fetchone(self):
        return self.row


class _ReserveConnection:
    def __init__(self, limit):
        self.limit = limit
        self.statements = []
        self.committed = False
        self.rolled_back = False

    def execute(self, statement, parameters=()):
        normalized = " ".join(statement.split())
        self.statements.append((normalized, parameters))
        if normalized.startswith("INSERT INTO ai_usage_daily"):
            amount = parameters[3]
            return _Result((amount,)) if amount <= self.limit else _Result(None)
        return _Result(None)

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def close(self):
        pass


def _context():
    return SimpleNamespace(organization_id="org-1", user_id="user-1")


def _config(limit=100):
    return SimpleNamespace(daily_token_limit=limit)


@pytest.mark.parametrize("amount,accepted", [(99, True), (100, True), (101, False)])
def test_first_reservation_enforces_hard_limit(monkeypatch, amount, accepted):
    connection = _ReserveConnection(100)
    monkeypatch.setattr(quota_service.database, "get_connection", lambda: connection)
    monkeypatch.setattr(quota_service, "_usage_date", lambda: "2026-09-19")

    if accepted:
        reservation = quota_service.reserve_tokens(_context(), amount, config=_config())
        assert reservation.reserved_tokens == amount
        assert connection.committed
    else:
        with pytest.raises(Exception) as error:
            quota_service.reserve_tokens(_context(), amount, config=_config())
        assert getattr(error.value, "code", None) == "AI_QUOTA_EXCEEDED"
        assert connection.rolled_back

    sql = connection.statements[0][0]
    assert "SELECT ?, ?, ?, ? WHERE ? <= ?" in sql
    assert "input_tokens + ai_usage_daily.output_tokens" in sql
    assert "ai_usage_daily.reserved_tokens" in sql


def test_reservation_carries_immutable_usage_date():
    reservation = TokenReservation("r1", "2026-09-19", "org-1", "user-1", 50)
    assert reservation.usage_date == "2026-09-19"
    with pytest.raises(AttributeError):
        reservation.usage_date = "2026-09-20"


def test_estimator_accounts_for_history_instructions_tools_and_output():
    base = estimate_request_token_budget(
        input_items=[{"role": "user", "content": "x"}],
        instructions="policy",
        tools=[],
        max_output_tokens=100,
    )
    expanded = estimate_request_token_budget(
        input_items=[{"role": "user", "content": "x"}, {"role": "assistant", "content": "y" * 100}],
        instructions="policy plus workspace context",
        tools=[{"name": "lookup", "parameters": {"type": "object"}}],
        max_output_tokens=100,
    )
    assert expanded > base > 100


def test_cancellation_safe_cleanup_finishes_before_propagating(monkeypatch):
    completed = asyncio.Event()

    async def write(_function, *_args, **_kwargs):
        await asyncio.sleep(0)
        completed.set()

    monkeypatch.setattr("backend.ai.service.run_database_write", write)

    async def scenario():
        task = asyncio.create_task(_cancellation_safe_write(object()))
        await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert completed.is_set()

    asyncio.run(scenario())


class _AuthCursor:
    def __init__(self, stored_hash="verified"):
        self.stored_hash = stored_hash
        self.events = []
        self.rowcount = 1

    def execute(self, statement, parameters=()):
        normalized = " ".join(statement.split())
        self.events.append((normalized, parameters))
        if normalized.startswith("UPDATE tai_khoan"):
            self.rowcount = int(parameters[2] == self.stored_hash)
        return self

    def fetchone(self):
        return ("user-1", self.stored_hash)


def test_password_rehash_is_cas_after_account_lock(monkeypatch):
    cursor = _AuthCursor()
    monkeypatch.setattr("backend.auth.session_store.revoke_user_sessions", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("backend.auth.session_store.create_session", lambda *_args, **_kwargs: "session-1")

    assert replace_user_session(
        cursor,
        user_id="user-1",
        token="token",
        absolute_expires_at=9999999999,
        idle_timeout_seconds=60,
        expected_password_hash="verified",
        replacement_password_hash="replacement",
    ) == "session-1"
    assert "FOR UPDATE" in cursor.events[0][0]
    assert "mat_khau = ?" in cursor.events[1][0]
    assert cursor.events[1][1] == ("replacement", "user-1", "verified")


def test_password_rehash_aborts_when_password_changed_before_lock(monkeypatch):
    cursor = _AuthCursor(stored_hash="changed")
    with pytest.raises(ValueError, match="credentials changed"):
        replace_user_session(
            cursor,
            user_id="user-1",
            token="token",
            absolute_expires_at=9999999999,
            idle_timeout_seconds=60,
            expected_password_hash="verified",
            replacement_password_hash="replacement",
        )
    assert len(cursor.events) == 1
