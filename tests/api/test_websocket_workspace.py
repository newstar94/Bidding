import sqlite3

import pytest

from backend.shared.origin_policy import get_allowed_websocket_origins, is_websocket_origin_allowed
from backend.sync import websocket as websocket_module
from backend.sync.websocket import dispatch_websocket_broker_event, resolve_websocket_owner


def _cursor():
    connection = sqlite3.connect(":memory:")
    connection.executescript(
        """
        CREATE TABLE to_chuc (
            id TEXT PRIMARY KEY,
            trang_thai TEXT NOT NULL,
            scope_type TEXT NOT NULL DEFAULT 'organization'
        );
        CREATE TABLE thanh_vien_to_chuc (
            user_id TEXT NOT NULL,
            organization_id TEXT NOT NULL
        );
        INSERT INTO to_chuc (id, trang_thai) VALUES ('org-a', 'active');
        INSERT INTO to_chuc (id, trang_thai) VALUES ('org-b', 'active');
        INSERT INTO to_chuc (id, trang_thai) VALUES ('org-disabled', 'disabled');
        INSERT INTO thanh_vien_to_chuc VALUES ('user-1', 'org-a');
        INSERT INTO thanh_vien_to_chuc VALUES ('user-1', 'org-disabled');
        INSERT INTO thanh_vien_to_chuc VALUES ('user-2', 'org-b');
        """
    )
    return connection, connection.cursor()


def test_websocket_requires_explicit_active_membership_id():
    connection, cursor = _cursor()
    try:
        assert resolve_websocket_owner(cursor, "user-1", "org-a") == "org-a"
        assert resolve_websocket_owner(cursor, "user-1", "org-b") is None
        assert resolve_websocket_owner(cursor, "user-1", "org-disabled") is None
        assert resolve_websocket_owner(cursor, "user-1", "") is None
    finally:
        connection.close()


def test_websocket_origin_policy_is_independent_and_fail_closed(monkeypatch):
    monkeypatch.setenv("ALLOWED_WS_ORIGINS", "https://app.example.com")
    allowed = get_allowed_websocket_origins()
    assert is_websocket_origin_allowed("https://app.example.com", allowed)
    assert not is_websocket_origin_allowed("", allowed)
    assert not is_websocket_origin_allowed("https://evil.example.com", allowed)
    assert not is_websocket_origin_allowed("https://app.example.com@evil.example.com", allowed)


def test_websocket_frame_limit_counts_utf8_bytes(monkeypatch):
    monkeypatch.setenv("WEBSOCKET_MAX_FRAME_BYTES", "8")

    assert websocket_module._websocket_frame_is_allowed("12345678")
    assert websocket_module._websocket_frame_is_allowed("đđđđ")
    assert not websocket_module._websocket_frame_is_allowed("đđđđđ")


def test_websocket_ip_connection_quota_is_released(monkeypatch):
    monkeypatch.setenv("WEBSOCKET_MAX_CONNECTIONS_PER_IP", "1")
    first = object()
    second = object()
    websocket_module.active_connections_by_ip.clear()
    try:
        assert websocket_module._register_ip_connection("203.0.113.10", first)
        assert not websocket_module._register_ip_connection("203.0.113.10", second)
        websocket_module._release_ip_connection("203.0.113.10", first)
        assert websocket_module._register_ip_connection("203.0.113.10", second)
    finally:
        websocket_module.active_connections_by_ip.clear()


def test_websocket_event_policy_removes_business_and_sensitive_fields():
    payload = websocket_module.serialize_websocket_event(
        {
            "type": "sync_update",
            "table": "nhathau",
            "id": "contractor-1",
            "syncVersion": "7",
            "soTaiKhoan": "secret-account",
            "soCccd": "secret-identity",
            "row": {"password": "never-broadcast"},
        }
    )

    assert payload == {
        "type": "sync_update",
        "table": "nhathau",
        "id": "contractor-1",
        "syncVersion": 7,
    }
    with pytest.raises(ValueError, match="Unsupported"):
        websocket_module.serialize_websocket_event({"event": "raw_record"})


class _Socket:
    def __init__(self, user_id):
        self.user_id = user_id
        self.sent = []
        self.closed = []

    async def send_text(self, message):
        self.sent.append(message)

    async def close(self, code):
        self.closed.append(code)


@pytest.mark.anyio
async def test_broker_events_are_scoped_and_revoke_across_worker_registry():
    socket_a = _Socket("user-a")
    socket_b = _Socket("user-b")
    websocket_module.active_connections.clear()
    websocket_module.active_connections.update({"org-a": {socket_a}, "org-b": {socket_b}})
    try:
        await dispatch_websocket_broker_event({
            "event_type": "broadcast",
            "organization_id": "org-a",
            "payload_json": '{"event":"db_changed"}',
        })
        assert socket_a.sent == ['{"event": "db_changed"}']
        assert socket_b.sent == []

        await dispatch_websocket_broker_event({"event_type": "revoke_user", "user_id": "user-a"})
        assert socket_a.closed == [4001]
        assert socket_b.closed == []
        assert "org-a" not in websocket_module.active_connections
    finally:
        websocket_module.active_connections.clear()
