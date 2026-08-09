import json
import ast
import os
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest

from backend.db.db_helper import PostgresCursor, compat_row_factory
from backend.sync import websocket
from backend.sync.websocket import enqueue_websocket_event
from backend.db.upgrades import DB_SCHEMA_VERSION, UPGRADES


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
