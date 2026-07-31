import json

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
