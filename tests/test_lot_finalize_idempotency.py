import asyncio
import json
import os
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import psycopg
import pytest
from starlette.responses import JSONResponse

from backend import lot_lifecycle_routes
from backend.db.db_helper import PostgresCursor, compat_row_factory
from backend.lot_lifecycle_routes import (
    LotFinalizeIdempotencyConflict,
    _lot_finalize_idempotency_replay,
    _lot_finalize_operation,
    _store_lot_finalize_idempotency,
    lot_finalize_request_digest,
)


class _IdempotencyCursor:
    def __init__(self):
        self.rows = {}
        self.websocket_events = []
        self.current = None
        self.statements = []

    def execute(self, statement, params=()):
        compact = " ".join(str(statement).split())
        self.statements.append((compact, tuple(params)))
        if compact.startswith("SELECT pg_advisory_xact_lock"):
            self.current = (None,)
        elif compact.startswith("SELECT response_json FROM api_idempotency"):
            self.current = self.rows.get(tuple(params))
        elif compact.startswith("INSERT INTO api_idempotency"):
            actor_user_id, operation, key, response_json, _created_at = params
            self.rows[(actor_user_id, operation, key)] = (response_json,)
            self.current = None
        elif compact.startswith("INSERT INTO websocket_events"):
            self.websocket_events.append(tuple(params))
            self.current = (len(self.websocket_events),)
        else:
            self.current = None
        return self

    def fetchone(self):
        return self.current


def _command_payload(*, decision_number="QD-01"):
    return {
        "outcomes": {"lot-2": "NOT_AWARDED", "lot-1": "AWARDED"},
        "packageAward": {
            "expectedVersion": 7,
            "decisionNumber": decision_number,
            "decisionDate": "2026-08-09",
            "metadata": {"technical": {"score": 90}},
            "lotResults": [
                {"lotId": "lot-1", "winnerId": "bidder-1", "awardPrice": 10},
                {"lotId": "lot-2", "winnerId": "", "awardPrice": 0},
            ],
        },
    }


def test_lot_finalize_digest_is_order_stable_and_payload_sensitive():
    payload = _command_payload()
    reordered = {
        "packageAward": {
            **payload["packageAward"],
            "metadata": {"technical": {"score": 90}},
        },
        "outcomes": {"lot-1": "AWARDED", "lot-2": "NOT_AWARDED"},
    }

    digest = lot_finalize_request_digest(payload)

    assert len(digest) == 64
    assert digest == lot_finalize_request_digest(reordered)
    assert digest != lot_finalize_request_digest(
        _command_payload(decision_number="QD-02")
    )
    assert _lot_finalize_operation("org:a", "package", "batch") != (
        _lot_finalize_operation("org", "a:package", "batch")
    )


def test_lot_finalize_idempotency_replays_exact_stored_result():
    cursor = _IdempotencyCursor()
    operation = _lot_finalize_operation("org-1", "package-1", "batch-1")
    digest = lot_finalize_request_digest(_command_payload())
    arguments = {
        "actor_user_id": "user-1",
        "operation": operation,
        "idempotency_key": "lot-finalize:v7",
        "request_digest": digest,
    }

    assert _lot_finalize_idempotency_replay(cursor, **arguments) is None
    _store_lot_finalize_idempotency(
        cursor,
        **arguments,
        payload={"success": True, "packageRowVersion": 8},
    )

    assert _lot_finalize_idempotency_replay(cursor, **arguments) == {
        "success": True,
        "packageRowVersion": 8,
    }


def test_lot_finalize_idempotency_rejects_same_key_with_different_payload():
    cursor = _IdempotencyCursor()
    operation = _lot_finalize_operation("org-1", "package-1", "batch-1")
    original_digest = lot_finalize_request_digest(_command_payload())
    arguments = {
        "actor_user_id": "user-1",
        "operation": operation,
        "idempotency_key": "lot-finalize:v7",
    }
    _store_lot_finalize_idempotency(
        cursor,
        **arguments,
        request_digest=original_digest,
        payload={"success": True, "packageRowVersion": 8},
    )

    with pytest.raises(LotFinalizeIdempotencyConflict):
        _lot_finalize_idempotency_replay(
            cursor,
            **arguments,
            request_digest=lot_finalize_request_digest(
                _command_payload(decision_number="QD-DIFFERENT")
            ),
        )


class _Request:
    def __init__(self, payload, key="lot-finalize:v7"):
        self.payload = payload
        self.headers = {"Idempotency-Key": key} if key else {}
        self.path_params = {"package_id": "package-1", "batch_id": "batch-1"}


class _Connection:
    def __init__(self, cursor, events):
        self._cursor = cursor
        self.events = events

    def execute(self, statement):
        self.events.append("begin")
        return self

    def cursor(self):
        return self._cursor

    def commit(self):
        self.events.append("commit")

    def rollback(self):
        self.events.append("rollback")

    def close(self):
        self.events.append("close")


def _response_json(response):
    return json.loads(bytes(response.body).decode("utf-8"))


def test_finalize_route_replays_committed_result_after_response_path_fails(
    monkeypatch,
):
    cursor = _IdempotencyCursor()
    events = []
    finalize_calls = []
    audit_calls = []
    response_failures = []

    async def read_json(request):
        return request.payload, None

    monkeypatch.setattr(lot_lifecycle_routes, "read_json_object", read_json)
    monkeypatch.setattr(
        lot_lifecycle_routes,
        "verify_session",
        lambda _request: (True, SimpleNamespace(user_id="user-1")),
    )
    monkeypatch.setattr(lot_lifecycle_routes, "get_active_org", lambda *_: "org-1")
    monkeypatch.setattr(
        lot_lifecycle_routes,
        "authorize_record_write",
        lambda *_args, **_kwargs: SimpleNamespace(allowed=True, reason=""),
    )
    monkeypatch.setattr(
        lot_lifecycle_routes.database,
        "get_connection",
        lambda: _Connection(cursor, events),
    )

    def finalize(*_args, **_kwargs):
        finalize_calls.append("finalize")
        return {"packageRowVersion": 8, "packageStatus": "COMPLETED"}

    monkeypatch.setattr(lot_lifecycle_routes, "finalize_batch_award", finalize)
    monkeypatch.setattr(
        lot_lifecycle_routes,
        "log_audit",
        lambda *_args, **_kwargs: audit_calls.append("audit"),
    )

    def flaky_json_response(payload, *args, **kwargs):
        if payload.get("success") is True and not response_failures:
            response_failures.append("failed-after-commit")
            raise RuntimeError("simulated response-path failure after commit")
        return JSONResponse(payload, *args, **kwargs)

    monkeypatch.setattr(lot_lifecycle_routes, "JSONResponse", flaky_json_response)
    monkeypatch.setattr(
        lot_lifecycle_routes,
        "log_and_error",
        lambda *_args, **_kwargs: JSONResponse(
            {"error": "simulated lost response"}, status_code=500
        ),
    )

    request = _Request(_command_payload())
    first = asyncio.run(lot_lifecycle_routes.finalize_lot_batch_api(request))
    second = asyncio.run(lot_lifecycle_routes.finalize_lot_batch_api(request))
    third = asyncio.run(
        lot_lifecycle_routes.finalize_lot_batch_api(
            _Request(_command_payload(decision_number="QD-DIFFERENT"))
        )
    )

    assert first.status_code == 500
    assert second.status_code == 200
    assert third.status_code == 409
    assert _response_json(third)["code"] == "IDEMPOTENCY_KEY_REUSED"
    assert _response_json(second) == {
        "success": True,
        "packageRowVersion": 8,
        "packageStatus": "COMPLETED",
    }
    assert finalize_calls == ["finalize"]
    assert audit_calls == ["audit"]
    assert len(cursor.websocket_events) == 1
    assert json.loads(cursor.websocket_events[0][3]) == {"event": "db_changed"}
    assert events.count("commit") == 2


def test_finalize_route_requires_an_idempotency_key_before_mutating(monkeypatch):
    async def read_json(request):
        return request.payload, None

    monkeypatch.setattr(lot_lifecycle_routes, "read_json_object", read_json)
    monkeypatch.setattr(
        lot_lifecycle_routes,
        "verify_session",
        lambda _request: (True, SimpleNamespace(user_id="user-1")),
    )

    response = asyncio.run(
        lot_lifecycle_routes.finalize_lot_batch_api(
            _Request(_command_payload(), key="")
        )
    )

    assert response.status_code == 400
    assert _response_json(response)["code"] == "INVALID_IDEMPOTENCY_KEY"


def _test_database_url():
    if value := os.environ.get("TEST_DATABASE_URL"):
        return value
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.is_file():
        return None
    for line in env_path.read_text(encoding="utf-8-sig").splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() == "TEST_DATABASE_URL":
            return value.strip().strip('"').strip("'") or None
    return None


def test_real_postgres_lot_finalize_result_survives_commit_for_replay():
    database_url = _test_database_url()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    operation = f"lot_batch_finalize:org:package:{uuid4().hex}"
    idempotency_key = "lot-finalize:v7"
    digest = lot_finalize_request_digest(_command_payload())
    actor_user_id = None
    try:
        first_connection = psycopg.connect(
            database_url,
            connect_timeout=5,
            row_factory=compat_row_factory,
        )
    except psycopg.Error as error:
        pytest.skip(f"PostgreSQL test database is unavailable: {type(error).__name__}")
    try:
        with first_connection:
            cursor = PostgresCursor(first_connection.cursor())
            actor_row = cursor.execute(
                "SELECT id FROM tai_khoan ORDER BY id LIMIT 1"
            ).fetchone()
            if not actor_row:
                pytest.skip("PostgreSQL test database has no account fixture")
            actor_user_id = str(actor_row[0])
            arguments = {
                "actor_user_id": actor_user_id,
                "operation": operation,
                "idempotency_key": idempotency_key,
                "request_digest": digest,
            }
            assert _lot_finalize_idempotency_replay(cursor, **arguments) is None
            _store_lot_finalize_idempotency(
                cursor,
                **arguments,
                payload={"success": True, "packageRowVersion": 8},
            )
            first_connection.commit()

        with psycopg.connect(
            database_url,
            connect_timeout=5,
            row_factory=compat_row_factory,
        ) as retry_connection:
            cursor = PostgresCursor(retry_connection.cursor())
            assert _lot_finalize_idempotency_replay(cursor, **arguments) == {
                "success": True,
                "packageRowVersion": 8,
            }
            with pytest.raises(LotFinalizeIdempotencyConflict):
                _lot_finalize_idempotency_replay(
                    cursor,
                    **{
                        **arguments,
                        "request_digest": lot_finalize_request_digest(
                            _command_payload(decision_number="QD-DIFFERENT")
                        ),
                    },
                )
            retry_connection.rollback()
    finally:
        if actor_user_id:
            with psycopg.connect(database_url, connect_timeout=5) as cleanup:
                cleanup.execute(
                    """DELETE FROM api_idempotency
                       WHERE actor_user_id = %s AND operation = %s
                         AND idempotency_key = %s""",
                    (actor_user_id, operation, idempotency_key),
                )
                cleanup.commit()
