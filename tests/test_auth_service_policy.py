from __future__ import annotations

import asyncio
from collections import deque
import json
import time

import pytest

from backend.auth import auth_service
from backend.shared.async_io import BlockingIOBusyError


class _Cursor:
    def __init__(self, *, one=(), many=(), error=None, rollback_error=None):
        self.one = deque(one)
        self.many = deque(many)
        self.error = error
        self.rollback_error = rollback_error
        self.calls = []
        self.committed = False
        self.rolled_back = False
        self.closed = False

    def execute(self, sql, parameters=()):
        self.calls.append((sql, parameters))
        if self.error:
            raise self.error
        return self

    def fetchone(self):
        return self.one.popleft() if self.one else None

    def fetchall(self):
        return self.many.popleft() if self.many else []

    def commit(self):
        self.committed = True

    def rollback(self):
        if self.rollback_error:
            raise self.rollback_error
        self.rolled_back = True

    def close(self):
        self.closed = True


class _Database:
    def __init__(self, connection):
        self.connection = connection

    def get_connection(self):
        return self.connection


@pytest.mark.parametrize(
    ("attempts", "expires", "allowed", "retry", "remaining"),
    [
        (None, None, True, 0, 3),
        (2, 150, True, 0, 1),
        (4, 150, False, 50, 0),
    ],
)
def test_rate_limit_decision_is_atomic_and_bounded(
    monkeypatch: pytest.MonkeyPatch,
    attempts,
    expires,
    allowed: bool,
    retry: int,
    remaining: int,
) -> None:
    row = None if attempts is None else (attempts, expires)
    connection = _Cursor(one=[row])
    monkeypatch.setattr(
        auth_service, "_get_rate_limit_database", lambda: _Database(connection)
    )
    monkeypatch.setattr(auth_service.time, "time", lambda: 100)
    decision = auth_service.get_rate_limit_decision(
        "login:user", max_attempts=3, window_seconds=60
    )
    assert decision.allowed is allowed
    assert decision.retry_after == retry
    assert decision.remaining == remaining
    assert connection.committed and connection.closed
    assert connection.calls[0][1][0] == auth_service.rate_limit_bucket_hash(
        "login:user"
    )


def test_rate_limit_peek_and_fail_closed_storage_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = _Cursor(one=[(1, 200)])
    monkeypatch.setattr(
        auth_service, "_get_rate_limit_database", lambda: _Database(connection)
    )
    decision = auth_service.get_rate_limit_decision(
        "bucket",
        consume_attempt=False,
        max_attempts=2,
        window_seconds=0,
    )
    assert decision.allowed
    assert "SELECT attempt_count" in connection.calls[0][0]

    logged = []
    connection = _Cursor(error=RuntimeError("database"))
    monkeypatch.setattr(
        auth_service, "_get_rate_limit_database", lambda: _Database(connection)
    )
    monkeypatch.setattr(
        "backend.shared.logging_utils.log_error",
        lambda *args, **kwargs: logged.append((args, kwargs)),
    )
    decision = auth_service.get_rate_limit_decision(
        "bucket", max_attempts=2, window_seconds=10
    )
    assert not decision.allowed
    assert decision.storage_failed
    assert decision.retry_after == 10
    assert connection.rolled_back and connection.closed
    assert logged


def test_rate_limit_response_helpers_and_bucket_cleanup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        auth_service,
        "get_rate_limit_decision",
        lambda *_args, **_kwargs: auth_service.RateLimitDecision(True, 0, 1),
    )
    assert auth_service.check_rate_limit("bucket")
    assert auth_service.record_rate_limit_failure("bucket")
    response = auth_service.rate_limit_response(
        "slow down", auth_service.RateLimitDecision(False, 7, 0)
    )
    assert response.status_code == 429
    assert response.headers["retry-after"] == "7"
    assert json.loads(response.body)["retry_after"] == 7
    assert auth_service.rate_limit_bucket_hash("") == auth_service.rate_limit_bucket_hash(
        "unknown"
    )
    cursor = _Cursor()
    auth_service.clear_rate_limit_buckets(
        cursor, "one", "two", "one", ""
    )
    assert len(cursor.calls) == 2


def test_async_rate_limiter_success_busy_and_failure_recording(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def exercise():
        async def run_success(*_args, **_kwargs):
            return auth_service.RateLimitDecision(True, 0, 1)

        monkeypatch.setattr(
            "backend.shared.database_io.run_database_write", run_success
        )
        decision = await auth_service.get_rate_limit_decision_async("bucket")
        assert decision.allowed
        assert await auth_service.record_rate_limit_failure_async("bucket")

        async def run_busy(*_args, **_kwargs):
            raise BlockingIOBusyError("busy")

        monkeypatch.setattr(
            "backend.shared.database_io.run_database_write", run_busy
        )
        decision = await auth_service.get_rate_limit_decision_async(
            "bucket", window_seconds=9
        )
        assert not decision.allowed
        assert decision.storage_failed
        assert decision.retry_after == 9

    asyncio.run(exercise())


def test_otp_is_six_digit_and_cryptographically_bounded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(auth_service.secrets, "randbelow", lambda _bound: 0)
    assert auth_service.generate_otp() == "100000"
    monkeypatch.setattr(auth_service.secrets, "randbelow", lambda _bound: 899_999)
    assert auth_service.generate_otp() == "999999"


def _organization_row(**overrides):
    row = {
        "id": "org-1",
        "ten_to_chuc": "Organization",
        "organization_status": "active",
        "vai_tro_trong_to_chuc": "employee",
        "package_id": "diamond",
        "subscription_status": "active",
        "starts_at": 1_700_000_000,
        "expires_at": int(time.time()) + 3_600,
        "member_quota": 10,
        "revision": 2,
        "package_status": "active",
        "member_count": 3,
    }
    row.update(overrides)
    return row


def test_user_organizations_skip_invalid_roles_and_compute_entitlements() -> None:
    cursor = _Cursor(
        many=[
            [
                _organization_row(vai_tro_trong_to_chuc="owner"),
                _organization_row(),
                _organization_row(
                    id="org-2",
                    organization_status="suspended",
                    package_id=None,
                    subscription_status=None,
                    starts_at=None,
                    expires_at=None,
                    member_quota=None,
                    revision=None,
                    package_status=None,
                ),
                _organization_row(
                    id="org-3",
                    expires_at=int(time.time()) - 1,
                ),
                _organization_row(
                    id="org-4",
                    package_status="inactive",
                ),
            ]
        ]
    )
    organizations = auth_service.get_user_organizations(cursor, "user")
    assert [item["id"] for item in organizations] == [
        "org-1",
        "org-2",
        "org-3",
        "org-4",
    ]
    assert organizations[0]["entitlements"]["word_export"]
    assert organizations[0]["subscription"]["member_count"] == 3
    assert organizations[1]["status"] == "suspended"
    assert organizations[1]["subscription"] is None
    assert organizations[2]["subscription"]["status"] == "expired"
    assert not organizations[2]["entitlements"]["word_export"]
    assert not organizations[3]["entitlements"]["word_export"]


def test_build_access_payload_adds_virtual_personal_scope_and_honors_hint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    organization = {
        "id": "org-1",
        "name": "Org",
        "scope_type": "organization",
        "role": "manager",
        "status": "active",
        "subscription": {
            "package_id": "diamond",
            "start_date": "01/01/2026",
            "end_date": "01/01/2027",
        },
        "entitlements": {"word_export": True},
    }
    monkeypatch.setattr(
        auth_service, "get_user_organizations", lambda *_args: [organization]
    )
    monkeypatch.setattr(
        "backend.documents.word_defaults.ensure_default_word_mappings",
        lambda *_args: None,
    )
    monkeypatch.setattr(
        auth_service,
        "get_account_subscription",
        lambda *_args: {"package_id": "personal", "status": "active"},
    )
    cursor = _Cursor()
    payload = auth_service.build_user_access_payload(
        cursor,
        "user-1",
        "user",
        active_org_hint="personal:user-1",
        display_name="User",
    )
    assert payload["active_org_id"] == "personal:user-1"
    assert payload["role"] == "employee"
    assert payload["package_id"] == "personal"
    assert len(payload["organizations"]) == 2
    assert cursor.calls[0][1] == ("personal:user-1",)


def test_build_access_payload_super_admin_uses_only_platform_scope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    organization = {
        "id": "org-1",
        "name": "Org",
        "scope_type": "organization",
        "role": "manager",
        "status": "active",
        "subscription": None,
        "entitlements": {},
    }
    monkeypatch.setattr(
        auth_service, "get_user_organizations", lambda *_args: [organization]
    )
    cursor = _Cursor()
    payload = auth_service.build_user_access_payload(
        cursor, "admin", "super_admin", active_org_hint="missing"
    )
    assert not cursor.calls
    assert payload["active_org_id"] == "org-1"
    assert payload["role"] == "super_admin"
    assert payload["entitlements"] == {
        "word_export": True,
        "source": "platform",
    }
    assert payload["package_id"] is None


def test_build_access_payload_handles_no_active_workspace(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(auth_service, "get_user_organizations", lambda *_args: [])
    payload = auth_service.build_user_access_payload(
        _Cursor(), "admin", "super_admin"
    )
    assert payload["active_org_id"] is None
    assert payload["membership_role"] is None
    assert payload["role"] == "super_admin"
