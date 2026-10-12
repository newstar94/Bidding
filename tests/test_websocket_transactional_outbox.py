import json
import ast
import asyncio
import os
import threading
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import psycopg
import pytest

from backend.db.db_helper import PostgresCursor, compat_row_factory
from backend.sync import websocket
from backend.sync.websocket import enqueue_websocket_event
from backend.db.upgrades import (
    DB_SCHEMA_VERSION,
    UPGRADES,
    _upgrade_to_v58_add_document_job_policy,
    _upgrade_to_v59_rename_websocket_delivery_to_dispatch,
)


class Cursor:
    def __init__(self):
        self.calls = []
        self.current = None

    def execute(self, statement, params=()):
        normalized = " ".join(statement.split())
        self.calls.append((normalized, tuple(params)))
        self.current = (42,) if normalized.startswith("INSERT INTO websocket_events") else None
        return self

    def fetchone(self):
        return self.current


def test_websocket_event_is_enqueued_with_bounded_payload_on_caller_cursor():
    cursor = Cursor()

    event_id = enqueue_websocket_event(
        cursor,
        "broadcast",
        organization_id="org-a",
        payload={"event": "db_changed", "secret": "must-not-pass"},
    )

    assert event_id == 42
    insert = cursor.calls[0]
    assert insert[1][1] == "org-a"
    assert json.loads(insert[1][3]) == {"event": "db_changed"}
    assert cursor.calls[1][0].startswith("SELECT pg_notify")


def test_websocket_event_has_no_independent_commit_side_effect():
    cursor = Cursor()
    enqueue_websocket_event(
        cursor,
        "broadcast",
        organization_id="org-a",
        payload={"event": "db_changed"},
    )

    assert all("COMMIT" not in statement for statement, _params in cursor.calls)


def test_websocket_delivery_state_uses_a_forward_only_migration():
    assert DB_SCHEMA_VERSION >= 32
    upgrade = next(item for item in UPGRADES if item.version == 32)
    assert upgrade.name == "add_websocket_delivery_state"


def test_local_hint_dispatch_never_claims_global_delivery():
    source = Path(websocket.__file__).read_text(encoding="utf-8")

    assert "status = 'delivered'" not in source
    assert "status = 'dispatched'" in source
    assert "dispatched_at" in source


def test_v58_and_v59_migrations_keep_their_table_changes_separate():
    class Cursor:
        def __init__(self):
            self.statements = []

        def execute(self, statement, _params=()):
            self.statements.append(" ".join(statement.split()))

    v58 = Cursor()
    v59 = Cursor()

    _upgrade_to_v58_add_document_job_policy(v58, None)
    _upgrade_to_v59_rename_websocket_delivery_to_dispatch(v59, None)

    assert len(v58.statements) == 2
    assert all("ALTER TABLE document_jobs" in statement for statement in v58.statements)
    assert any("policy_json" in statement for statement in v58.statements)
    assert any("policy_hash" in statement for statement in v58.statements)
    assert all("document_jobs" not in statement for statement in v59.statements)
    assert all("websocket_events" in statement for statement in v59.statements)


def test_legacy_broadcast_reports_durable_store_failure(monkeypatch):
    local = []
    logged = []

    monkeypatch.setattr(
        websocket,
        "_store_broker_event",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("outbox down")),
    )
    monkeypatch.setattr(
        websocket,
        "_schedule_local_broadcast",
        lambda organization_id, payload: local.append((organization_id, payload)),
    )
    monkeypatch.setattr(
        websocket,
        "log_error",
        lambda error, boundary, **kwargs: logged.append(
            (type(error).__name__, boundary, kwargs.get("level"))
        ),
    )

    stored = websocket.broadcast_websocket_event(
        "org-a",
        {"event": "db_changed"},
    )

    assert stored is False
    assert local == [("org-a", {"event": "db_changed"})]
    assert logged == [("RuntimeError", "websocket_broker_store", "WARN")]


def test_business_mutations_do_not_publish_realtime_after_commit():
    root = Path(__file__).resolve().parents[1]
    forbidden = {"broadcast_websocket_event"}
    offenders = []
    for path in (root / "backend").rglob("*.py"):
        if path.as_posix().endswith("backend/sync/websocket.py"):
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id in forbidden
            ):
                offenders.append(
                    f"{path.relative_to(root).as_posix()}:{node.lineno}:{node.func.id}"
                )

    assert offenders == []


def test_reviewed_business_mutations_enqueue_on_their_transaction_cursor():
    root = Path(__file__).resolve().parents[1]
    expected_minimums = {
        "backend/lot_lifecycle_routes.py": 1,
        "backend/api/org_routes.py": 6,
        "backend/auth/auth_routes.py": 2,
        "backend/auth/admin_user_routes.py": 3,
        "backend/documents/package_document_routes.py": 2,
        "backend/partners/partner_lookup_service.py": 1,
        "backend/sync/response.py": 1,
        "backend/sync/restore_service.py": 1,
    }
    actual = {}
    for relative_path in expected_minimums:
        path = root / relative_path
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        actual[relative_path] = sum(
            1
            for node in ast.walk(tree)
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "enqueue_websocket_event"
            )
        )

    assert all(
        actual[path] >= minimum
        for path, minimum in expected_minimums.items()
    ), actual


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


def test_real_postgres_websocket_event_commits_and_rolls_back_with_business_transaction():
    database_url = _test_database_url()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    try:
        connection = psycopg.connect(
            database_url,
            connect_timeout=5,
            row_factory=compat_row_factory,
        )
    except psycopg.Error as error:
        pytest.skip(f"PostgreSQL test database is unavailable: {type(error).__name__}")

    organization_id = f"outbox-transaction-{uuid4().hex}"
    committed_event_id = None
    try:
        cursor = PostgresCursor(connection.cursor())
        rolled_back_event_id = enqueue_websocket_event(
            cursor,
            "broadcast",
            organization_id=organization_id,
            payload={"event": "db_changed"},
        )
        connection.rollback()
        assert connection.execute(
            "SELECT COUNT(*) FROM websocket_events WHERE id = %s",
            (rolled_back_event_id,),
        ).fetchone()[0] == 0

        cursor = PostgresCursor(connection.cursor())
        committed_event_id = enqueue_websocket_event(
            cursor,
            "broadcast",
            organization_id=organization_id,
            payload={"event": "db_changed"},
        )
        connection.commit()
        stored = connection.execute(
            """SELECT organization_id, payload_json, status
                 FROM websocket_events WHERE id = %s""",
            (committed_event_id,),
        ).fetchone()
        assert tuple(stored) == (
            organization_id,
            '{"event": "db_changed"}',
            "pending",
        )
    finally:
        connection.rollback()
        if committed_event_id is not None:
            connection.execute(
                "DELETE FROM websocket_events WHERE id = %s",
                (committed_event_id,),
            )
            connection.commit()
        connection.close()


@pytest.fixture
def broker_database(monkeypatch):
    """Real independent consumers, with all committed fixtures in a private schema."""
    url = _test_database_url()
    if not url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    schema = f"websocket_broker_{uuid4().hex}"
    admin = psycopg.connect(url, autocommit=True)
    admin.execute(f'CREATE SCHEMA "{schema}"')
    admin.execute(
        f'''CREATE TABLE "{schema}".websocket_events (
            id BIGSERIAL PRIMARY KEY,
            event_type TEXT NOT NULL,
            organization_id TEXT, user_id TEXT, payload_json TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            attempt_count INTEGER NOT NULL DEFAULT 0,
            available_at INTEGER NOT NULL DEFAULT 0,
            dispatched_at INTEGER, last_error_code TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )'''
    )

    class Connection:
        def __init__(self):
            self.raw = psycopg.connect(
                url, options=f"-c search_path={schema}", row_factory=compat_row_factory
            )

        def execute(self, statement, params=()):
            return PostgresCursor(self.raw.cursor()).execute(statement, params)

        def commit(self):
            self.raw.commit()

        def rollback(self):
            self.raw.rollback()

        def close(self):
            self.raw.close()

    class Database:
        get_connection = Connection

    db = Database()
    monkeypatch.setattr(websocket, "database", db)
    try:
        yield db
    finally:
        admin.execute(f'DROP SCHEMA "{schema}" CASCADE')
        admin.close()


def _committed_hint(database, *, event_type="broadcast", user_id=None):
    conn = database.get_connection()
    try:
        event_id = enqueue_websocket_event(
            conn, event_type, organization_id="org-test", user_id=user_id,
            payload={"event": "db_changed"} if event_type == "broadcast" else None,
        )
        conn.commit()
        return event_id
    finally:
        conn.close()


@pytest.mark.parametrize("event_type", ["broadcast", "revoke_user"])
def test_real_postgres_each_consumer_sees_event_after_another_worker_acknowledges(
    broker_database, event_type
):
    first = websocket._pending_broker_start_id()
    second = websocket._pending_broker_start_id()
    event_id = _committed_hint(
        broker_database, event_type=event_type, user_id="user-test"
    )
    assert [row["id"] for row in websocket._load_broker_events(first)] == [event_id]
    websocket._record_broker_dispatch(event_id)
    assert [row["id"] for row in websocket._load_broker_events(second)] == [event_id]


def test_real_postgres_startup_skips_old_revokes_but_keeps_pending_history(broker_database):
    old_revoke = _committed_hint(broker_database, event_type="revoke_user", user_id="user-test")
    websocket._record_broker_dispatch(old_revoke)
    pending = _committed_hint(broker_database)
    consumer = websocket._pending_broker_start_id()
    # Completion by a different worker after this startup snapshot must not
    # turn the pending startup event into skipped historical state.
    websocket._record_broker_dispatch(pending)

    assert [row["id"] for row in websocket._load_broker_events(consumer)] == [pending]
    consumer.mark_dispatched(pending)
    websocket._record_broker_dispatch(pending)
    assert websocket._load_broker_events(consumer) == []


@pytest.mark.parametrize("start_before_slow_insert", [True, False])
def test_real_postgres_late_low_id_commit_is_delivered_after_higher_id_ack(
    broker_database, start_before_slow_insert
):
    first = websocket._pending_broker_start_id() if start_before_slow_insert else None
    second = websocket._pending_broker_start_id() if start_before_slow_insert else None
    slow = broker_database.get_connection()
    try:
        low_id = enqueue_websocket_event(
            slow, "broadcast", organization_id="org-test", payload={"event": "db_changed"}
        )
        high_id = _committed_hint(broker_database)
        websocket._record_broker_dispatch(high_id)
        if start_before_slow_insert:
            for consumer in (first, second):
                assert [row["id"] for row in websocket._load_broker_events(consumer)] == [high_id]
                consumer.mark_dispatched(high_id)
        else:
            # The low sequence ID is invisible in the atomic startup snapshot.
            first = websocket._pending_broker_start_id()
            second = websocket._pending_broker_start_id()
            assert first.last_event_id == high_id
        slow.commit()
        assert [row["id"] for row in websocket._load_broker_events(first)] == [low_id]
        first.mark_dispatched(low_id)
        websocket._record_broker_dispatch(low_id)
        assert [row["id"] for row in websocket._load_broker_events(second)] == [low_id]
        assert websocket._load_broker_events(first) == []
    finally:
        slow.rollback()
        slow.close()


def test_real_postgres_deferred_low_id_survives_later_local_delivery(
    broker_database, monkeypatch
):
    now = [1_800_000_000]
    monkeypatch.setattr(websocket.time, "time", lambda: now[0])
    low_id = _committed_hint(broker_database)
    high_id = _committed_hint(broker_database)
    conn = broker_database.get_connection()
    try:
        conn.execute(
            "UPDATE websocket_events SET status = 'retry', available_at = ? WHERE id = ?",
            (now[0] + 4, low_id),
        )
        conn.commit()
    finally:
        conn.close()
    consumer = websocket._pending_broker_start_id()
    assert [row["id"] for row in websocket._load_broker_events(consumer)] == [high_id]
    consumer.mark_dispatched(high_id)
    websocket._record_broker_dispatch(high_id)
    assert websocket._load_broker_events(consumer) == []
    now[0] += 4
    assert [row["id"] for row in websocket._load_broker_events(consumer)] == [low_id]


def test_real_postgres_local_failed_delivery_retries_after_other_worker_ack(
    broker_database, monkeypatch
):
    now = [1_800_000_000]
    monkeypatch.setattr(websocket.time, "time", lambda: now[0])
    first = websocket._pending_broker_start_id()
    second = websocket._pending_broker_start_id()
    event_id = _committed_hint(broker_database)
    assert [row["id"] for row in websocket._load_broker_events(first)] == [event_id]
    first.mark_failed(event_id)
    websocket._record_broker_dispatch(event_id, RuntimeError("local send failed"))
    websocket._record_broker_dispatch(event_id)
    second.mark_dispatched(event_id)
    assert websocket._load_broker_events(first) == []
    now[0] += 2
    assert [row["id"] for row in websocket._load_broker_events(first)] == [event_id]
    first.mark_dispatched(event_id)
    assert websocket._load_broker_events(first) == []
    assert websocket._load_broker_events(second) == []


def test_real_postgres_other_worker_backoff_does_not_delay_due_local_retry(
    broker_database, monkeypatch
):
    now = [1_800_000_000]
    monkeypatch.setattr(websocket.time, "time", lambda: now[0])
    consumer = websocket._pending_broker_start_id()
    event_id = _committed_hint(broker_database)
    consumer.mark_failed(event_id)
    for _ in range(4):
        websocket._record_broker_dispatch(event_id, RuntimeError("other worker failure"))
    now[0] += 2
    # Shared telemetry now has a 16-second delay; this worker's own due retry
    # still runs after its original 2 seconds.
    assert [row["id"] for row in websocket._load_broker_events(consumer)] == [event_id]


def test_local_retry_budget_is_five_per_consumer_and_does_not_block_other_events():
    consumer = websocket._BrokerConsumer()
    for attempt in range(1, 6):
        result = consumer.mark_failed(3, now=100)
        assert result == ("dead_letter" if attempt == 5 else "retry")
    assert 3 not in consumer.retries
    assert consumer.completed == [(3, 4)]
    consumer.mark_dispatched(5)
    assert consumer.completed == [(3, 4), (5, 6)]


def test_real_postgres_other_consumer_dispatches_even_after_shared_dead_letter(broker_database):
    failing = websocket._pending_broker_start_id()
    healthy = websocket._pending_broker_start_id()
    event_id = _committed_hint(broker_database)
    for attempt in range(5):
        websocket._record_broker_dispatch(event_id, RuntimeError("local delivery failed"))
        failing.mark_failed(event_id, now=100 + attempt)
    events = websocket._load_broker_events(healthy)
    assert [row["id"] for row in events] == [event_id]
    assert events[0]["status"] == "dead_letter"
    assert websocket._record_broker_dispatch(event_id) == "dispatched"
    healthy.mark_dispatched(event_id)
    assert websocket._load_broker_events(failing) == []
    assert websocket._load_broker_events(healthy) == []


def test_real_postgres_query_keeps_the_five_hundred_event_bound(broker_database):
    conn = broker_database.get_connection()
    try:
        conn.execute(
            """INSERT INTO websocket_events (event_type, payload_json)
               SELECT 'broadcast', '{"event":"db_changed"}' FROM generate_series(1, 501)"""
        )
        conn.commit()
    finally:
        conn.close()
    consumer = websocket._pending_broker_start_id()
    first = websocket._load_broker_events(consumer)
    assert len(first) == 500
    for event in first:
        consumer.mark_dispatched(event["id"])
    remaining = websocket._load_broker_events(consumer)
    assert len(remaining) == 1
    assert remaining[0]["id"] > first[-1]["id"]


def test_real_postgres_retention_prunes_receipts_and_local_retries(broker_database):
    deleted = _committed_hint(broker_database)
    retained = _committed_hint(broker_database)
    consumer = websocket._pending_broker_start_id()
    consumer.mark_dispatched(deleted)
    consumer.mark_failed(deleted + 100)
    consumer.mark_failed(deleted)
    conn = broker_database.get_connection()
    try:
        conn.execute(
            "UPDATE websocket_events SET created_at = CURRENT_TIMESTAMP - INTERVAL '2 days' WHERE id = ?",
            (deleted,),
        )
        conn.commit()
    finally:
        conn.close()
    cleaned, floor = websocket._cleanup_broker_events()
    assert cleaned is True
    assert floor == retained
    consumer.prune_before(floor)
    assert consumer.completed == []
    assert deleted not in consumer.retries
    assert deleted + 100 in consumer.retries
    consumer.prune_before(None)
    assert consumer.completed == []
    assert consumer.retries == {}


def test_real_postgres_broker_survives_failed_delivery_status_write(
    broker_database, monkeypatch
):
    now = [1_800_000_000]
    monkeypatch.setattr(websocket.time, "time", lambda: now[0])
    consumer = websocket._pending_broker_start_id()
    event_id = _committed_hint(broker_database)
    deliveries = []
    waits = []
    recorded = websocket._record_broker_dispatch

    class Listener:
        closed = False

        def close(self):
            self.closed = True

    listener = Listener()

    async def direct_io(operation, *args, **_kwargs):
        return operation(*args)

    async def dispatch(event):
        deliveries.append(event["id"])
        if len(deliveries) == 1:
            raise RuntimeError("local send failed")

    def record(event_id, error=None):
        if error is not None:
            raise RuntimeError("temporary database outage")
        return recorded(event_id)

    def wait(_listener, timeout, _stop_event):
        waits.append(True)
        if len(waits) > 1:
            raise asyncio.CancelledError
        assert timeout == 2
        now[0] += timeout

    monkeypatch.setattr(websocket, "run_blocking_io", direct_io)
    monkeypatch.setattr(websocket, "_open_broker_listener", lambda: listener)
    monkeypatch.setattr(websocket, "_wait_for_broker_signal", wait)
    monkeypatch.setattr(websocket, "dispatch_websocket_broker_event", dispatch)
    monkeypatch.setattr(websocket, "_record_broker_dispatch", record)
    monkeypatch.setattr(websocket, "log_error", lambda *_args, **_kwargs: None)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(websocket.run_websocket_event_broker(start_after_id=consumer))
    assert deliveries == [event_id, event_id]
    assert listener.closed is True
    assert websocket._load_broker_events(consumer) == []


def test_broker_cancellation_finishes_listener_reader_before_closing(monkeypatch):
    entered = threading.Event()

    class Listener:
        closed = False
        reading = False

        def notifies(self, *, timeout, stop_after):
            self.reading = True
            entered.set()
            try:
                threading.Event().wait(timeout)
                yield from ()
            finally:
                self.reading = False

        def close(self):
            assert self.reading is False
            self.closed = True

    listener = Listener()

    async def thread_io(operation, *args, **_kwargs):
        return await asyncio.to_thread(operation, *args)

    monkeypatch.setattr(websocket, "run_blocking_io", thread_io)
    monkeypatch.setattr(websocket, "_open_broker_listener", lambda: listener)
    monkeypatch.setattr(websocket, "_load_broker_events", lambda _consumer: [])

    async def scenario():
        broker = asyncio.create_task(websocket.run_websocket_event_broker())
        assert await asyncio.to_thread(entered.wait, 2)
        broker.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(broker, timeout=2)

    asyncio.run(scenario())
    assert listener.closed is True
    assert listener.reading is False


@pytest.mark.parametrize("boundary", ("open", "load", "record"))
def test_broker_cancellation_finishes_finite_db_work_before_close(monkeypatch, boundary):
    entered, release, finished = threading.Event(), threading.Event(), threading.Event()
    listener = SimpleNamespace(closed=False)
    order = []

    def close():
        order.append("close")
        listener.closed = True

    listener.close = close

    def pause(value):
        entered.set()
        assert release.wait(3)
        order.append("finished")
        finished.set()
        return value

    def open_listener():
        return pause(listener) if boundary == "open" else listener

    def load(_consumer):
        if boundary == "load":
            return pause([])
        return [{"id": 1}]

    async def dispatch(_event):
        return None

    monkeypatch.setattr(websocket, "_open_broker_listener", open_listener)
    monkeypatch.setattr(websocket, "_load_broker_events", load)
    monkeypatch.setattr(websocket, "dispatch_websocket_broker_event", dispatch)
    monkeypatch.setattr(websocket, "_record_broker_dispatch", lambda *_args: pause(None))

    async def scenario():
        broker = asyncio.create_task(websocket.run_websocket_event_broker())
        assert await asyncio.to_thread(entered.wait, 2)
        broker.cancel()
        try:
            await asyncio.wait({broker}, timeout=0.1)
            assert not broker.done(), "broker abandoned submitted DB work"
            assert not listener.closed
            broker.cancel()
        finally:
            release.set()
            with pytest.raises(asyncio.CancelledError):
                await broker
            assert await asyncio.to_thread(finished.wait, 2)
        assert listener.closed
        assert order == ["finished", "close"]

    try:
        asyncio.run(scenario())
    finally:
        release.set()


def test_local_retry_wait_uses_nearest_future_deadline_without_busy_loop():
    consumer = websocket._BrokerConsumer()
    consumer.mark_failed(1, now=100)
    consumer.mark_failed(2, now=105)
    assert consumer.wait_timeout(now=100) == 2
    assert consumer.wait_timeout(now=103) == 4
    assert consumer.wait_timeout(now=108) == 30
    assert consumer.due_retries(108) == [1, 2]


def test_broker_failed_listener_wait_releases_connection_and_reconnects(monkeypatch):
    listeners = []

    class Listener:
        closed = False

        def close(self):
            self.closed = True

    async def direct_io(operation, *args, **_kwargs):
        return operation(*args)

    def open_listener():
        listener = Listener()
        listeners.append(listener)
        return listener

    def wait(_listener, _timeout, _stop_event):
        if len(listeners) == 1:
            raise RuntimeError("listener connection lost")
        raise asyncio.CancelledError

    monkeypatch.setattr(websocket, "run_blocking_io", direct_io)
    monkeypatch.setattr(websocket, "_open_broker_listener", open_listener)
    monkeypatch.setattr(websocket, "_load_broker_events", lambda _consumer: [])
    monkeypatch.setattr(websocket, "_wait_for_broker_signal", wait)
    monkeypatch.setattr(websocket, "log_error", lambda *_args, **_kwargs: None)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(websocket.run_websocket_event_broker())
    assert len(listeners) == 2
    assert all(listener.closed for listener in listeners)
