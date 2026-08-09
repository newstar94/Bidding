import asyncio
import json

from starlette.websockets import WebSocketDisconnect

from backend.sync import websocket as websocket_module


class _AuthenticatedSocket:
    headers = {"origin": "https://app.example.test"}
    cookies = {"session_token": "session-token"}

    def __init__(self):
        self.accepted = False
        self.closed = []
        self.sent = []
        self._receive_count = 0

    async def accept(self):
        self.accepted = True

    async def close(self, *, code):
        self.closed.append(code)

    async def send_text(self, payload):
        self.sent.append(payload)

    async def receive_text(self):
        self._receive_count += 1
        if self._receive_count == 1:
            return json.dumps({"action": "auth", "organizationId": "org-1"})
        raise WebSocketDisconnect(code=1000)


def test_authenticated_websocket_announces_ready_workspace(monkeypatch):
    socket = _AuthenticatedSocket()

    async def run_database_write(operation, *_args, **_kwargs):
        if operation in {
            websocket_module._acquire_cluster_ip_lease,
            websocket_module._attach_cluster_user_lease,
        }:
            return True
        return None

    async def run_database_read(_operation, *_args, **_kwargs):
        return "org-1"

    async def run_blocking_io(_operation, *_args, **_kwargs):
        return {"id": "user-1"}

    monkeypatch.setattr(websocket_module, "is_websocket_origin_allowed", lambda _origin: True)
    monkeypatch.setattr(websocket_module, "get_client_ip", lambda _socket: "127.0.0.1")
    monkeypatch.setattr(websocket_module, "run_database_write", run_database_write)
    monkeypatch.setattr(websocket_module, "run_database_read", run_database_read)
    monkeypatch.setattr(websocket_module, "run_blocking_io", run_blocking_io)
    monkeypatch.setattr(websocket_module, "session_invalid_reason", lambda _user: None)

    asyncio.run(websocket_module.sync_websocket_endpoint(socket))

    assert socket.accepted is True
    assert socket.closed == []
    assert [json.loads(payload) for payload in socket.sent] == [
        {"type": "ready", "organizationId": "org-1"},
    ]
    assert websocket_module.active_connections == {}
    assert websocket_module.active_connections_by_ip == {}
