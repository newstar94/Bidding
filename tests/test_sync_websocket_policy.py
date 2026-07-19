from __future__ import annotations

import asyncio
import json

import pytest
from starlette.websockets import WebSocketDisconnect

from backend.sync import websocket as wsmod


class _Result:
    def __init__(self, *, one=None, rows=None, rowcount=1):
        self._one = one
        self._rows = rows or []
        self.rowcount = rowcount

    def fetchone(self):
        return self._one

    def fetchall(self):
        return self._rows


class _Cursor:
    def __init__(self, handler=None):
        self.handler = handler or (lambda _sql, _params: _Result())
        self.calls = []

    def execute(self, sql, params=()):
        self.calls.append((" ".join(sql.split()), params))
        return self.handler(" ".join(sql.split()), params)

    def fetchone(self):
        return self.handler("fetchone", ()).fetchone()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class _Connection:
    def __init__(self, handler=None, *, closed=False):
        self._cursor = _Cursor(handler)
        self.commits = 0
        self.rollbacks = 0
        self.close_calls = 0
        self.closed = closed

    def execute(self, sql, params=()):
        return self._cursor.execute(sql, params)

    def cursor(self):
        return self._cursor

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def close(self):
        self.close_calls += 1
        self.closed = True


class _Database:
    def __init__(self, *connections, listener=None):
        self.connections = list(connections)
        self.listener = listener

    def get_connection(self):
        return self.connections.pop(0)

    def listen_connection(self):
        return self.listener


class _WebSocket:
    def __init__(self, incoming=(), *, origin="https://app.local", token="token"):
        self.headers = {"origin": origin}
        self.cookies = {"session_token": token}
        self.incoming = list(incoming)
        self.accepted = 0
        self.closed = []
        self.sent = []

    async def accept(self):
        self.accepted += 1

    async def receive_text(self):
        if not self.incoming:
            raise WebSocketDisconnect()
        value = self.incoming.pop(0)
        if isinstance(value, BaseException):
            raise value
        return value

    async def close(self, code):
        self.closed.append(code)

    async def send_text(self, value):
        self.sent.append(value)


def _reset_registries():
    wsmod.active_connections.clear()
    wsmod.active_connections_by_ip.clear()


def _install_metrics(monkeypatch):
    events = []
    for name in (
        "websocket_attempted",
        "websocket_authentication_failed",
        "websocket_connected",
        "websocket_disconnected",
        "websocket_rejected",
    ):
        monkeypatch.setattr(
            wsmod,
            name,
            lambda *args, _name=name: events.append((_name, *args)),
        )
    return events


def test_positive_env_frame_quota_and_ip_registry(monkeypatch):
    monkeypatch.setenv("WS_VALUE", "broken")
    assert wsmod._positive_int_env("WS_VALUE", 5, minimum=2, maximum=8) == 5
    monkeypatch.setenv("WS_VALUE", "0")
    assert wsmod._positive_int_env("WS_VALUE", 5, minimum=2, maximum=8) == 2
    monkeypatch.setenv("WS_VALUE", "99")
    assert wsmod._positive_int_env("WS_VALUE", 5, minimum=2, maximum=8) == 8

    monkeypatch.setenv("WEBSOCKET_MAX_FRAME_BYTES", "4")
    assert wsmod._websocket_frame_is_allowed("abcd")
    assert not wsmod._websocket_frame_is_allowed("abcde")
    assert not wsmod._websocket_frame_is_allowed(b"abc")

    _reset_registries()
    monkeypatch.setenv("WEBSOCKET_MAX_CONNECTIONS_PER_IP", "1")
    first, second = object(), object()
    assert wsmod._register_ip_connection("127.0.0.1", first)
    assert not wsmod._register_ip_connection("127.0.0.1", second)
    wsmod._release_ip_connection("missing", first)
    wsmod._release_ip_connection("127.0.0.1", first)
    assert wsmod.active_connections_by_ip == {}
    assert len(wsmod._client_ip_hash("127.0.0.1")) == 64


def test_event_serialization_is_metadata_only():
    assert wsmod.serialize_websocket_event(
        {"event": "db_changed", "secret": "drop-me"}
    ) == {"event": "db_changed"}
    assert wsmod.serialize_websocket_event(
        {"type": "sync_update", "table": "goi_thau", "id": "1", "syncVersion": "2", "row": {}}
    ) == {"type": "sync_update", "table": "goi_thau", "id": "1", "syncVersion": 2}
    for value in (None, [], {"event": "unknown"}):
        with pytest.raises(ValueError):
            wsmod.serialize_websocket_event(value)
    for payload in (
        {"type": "sync_update", "id": "1", "syncVersion": 1},
        {"type": "sync_update", "table": "t", "syncVersion": 1},
        {"type": "sync_update", "table": "t", "id": "1", "syncVersion": "bad"},
    ):
        with pytest.raises(ValueError):
            wsmod.serialize_websocket_event(payload)


def test_owner_resolution_and_loader_closes_connection(monkeypatch):
    cursor = _Cursor(lambda sql, _params: _Result(one=("org-1",)) if sql != "fetchone" else _Result(one=("org-1",)))
    assert wsmod.resolve_websocket_owner(cursor, "u", "") is None
    assert wsmod.resolve_websocket_owner(cursor, "u", " org-1 ") == "org-1"
    empty = _Cursor(lambda *_args: _Result(one=None))
    assert wsmod.resolve_websocket_owner(empty, "u", "org-x") is None

    conn = _Connection(lambda sql, _params: _Result(one=("org-2",)) if sql != "fetchone" else _Result(one=("org-2",)))
    monkeypatch.setattr(wsmod, "database", _Database(conn))
    assert wsmod._load_websocket_owner("u", "org-2") == "org-2"
    assert conn.close_calls == 1


@pytest.mark.parametrize("limit_reached", [False, True])
def test_cluster_ip_lease_success_limit_and_cleanup(monkeypatch, limit_reached):
    def handler(sql, _params):
        if "SELECT count(*)" in sql:
            return _Result(one=(2 if limit_reached else 0,))
        return _Result()

    conn = _Connection(handler)
    monkeypatch.setattr(wsmod, "database", _Database(conn))
    assert wsmod._acquire_cluster_ip_lease("lease", "hash", 2) is (not limit_reached)
    assert conn.commits == (0 if limit_reached else 1)
    assert conn.rollbacks == (1 if limit_reached else 0)
    assert conn.close_calls == 1


def test_cluster_lease_helpers_limits_updates_and_errors(monkeypatch):
    connections = []

    def attach_handler(sql, _params):
        if "SELECT count(*)" in sql:
            return _Result(one=(0,))
        return _Result(rowcount=1)

    successful = _Connection(attach_handler)
    user_limited = _Connection(lambda sql, _params: _Result(one=(1,)) if "SELECT count(*)" in sql else _Result())
    missing = _Connection(lambda sql, _params: _Result(one=(0,)) if "SELECT count(*)" in sql else _Result(rowcount=0))
    renewed = _Connection(lambda *_args: _Result(rowcount=1))
    lost = _Connection(lambda *_args: _Result(rowcount=0))
    released = _Connection()
    connections.extend([successful, user_limited, missing, renewed, lost, released])
    monkeypatch.setattr(wsmod, "database", _Database(*connections))

    assert wsmod._attach_cluster_user_lease("l1", "u", "o", 1)
    assert not wsmod._attach_cluster_user_lease("l2", "u", "o", 1)
    assert not wsmod._attach_cluster_user_lease("l3", "u", "o", 1)
    assert wsmod._renew_cluster_lease("l1")
    assert not wsmod._renew_cluster_lease("lost")
    wsmod._release_cluster_lease("l1")
    assert all(conn.close_calls == 1 for conn in connections)

    failed = _Connection(lambda *_args: (_ for _ in ()).throw(RuntimeError("db")))
    monkeypatch.setattr(wsmod, "database", _Database(failed))
    with pytest.raises(RuntimeError):
        wsmod._release_cluster_lease("l")
    assert failed.rollbacks == 1 and failed.close_calls == 1


def _install_endpoint_defaults(monkeypatch, *, session=None, owner="org-1", attach=True):
    _reset_registries()
    events = _install_metrics(monkeypatch)
    monkeypatch.setattr(wsmod, "is_websocket_origin_allowed", lambda _origin: True)
    monkeypatch.setattr(wsmod, "get_client_ip", lambda _websocket: "127.0.0.1")
    monkeypatch.setattr(wsmod, "session_invalid_reason", lambda _session, **_kwargs: None)
    session = session if session is not None else {"id": "user-1"}

    async def blocking(function, *args, **_kwargs):
        if function is wsmod.load_session_user:
            return session
        return function(*args)

    async def read(function, *args, **_kwargs):
        if function is wsmod._load_websocket_owner:
            return owner
        return function(*args)

    async def write(function, *args, **_kwargs):
        if function is wsmod._acquire_cluster_ip_lease:
            return True
        if function is wsmod._attach_cluster_user_lease:
            if isinstance(attach, BaseException):
                raise attach
            return attach
        if function in (wsmod._renew_cluster_lease, wsmod._release_cluster_lease):
            return True
        return function(*args)

    monkeypatch.setattr(wsmod, "run_blocking_io", blocking)
    monkeypatch.setattr(wsmod, "run_database_read", read)
    monkeypatch.setattr(wsmod, "run_database_write", write)
    monkeypatch.setattr(wsmod, "log_error", lambda *args, **kwargs: events.append(("log", args, kwargs)))
    return events


def test_websocket_endpoint_rejects_origin_and_local_ip_limit(monkeypatch):
    events = _install_metrics(monkeypatch)
    monkeypatch.setattr(wsmod, "is_websocket_origin_allowed", lambda _origin: False)
    socket = _WebSocket()
    asyncio.run(wsmod.sync_websocket_endpoint(socket))
    assert socket.closed == [4403]
    assert ("websocket_rejected", "origin") in events

    _reset_registries()
    events = _install_metrics(monkeypatch)
    monkeypatch.setattr(wsmod, "is_websocket_origin_allowed", lambda _origin: True)
    monkeypatch.setattr(wsmod, "get_client_ip", lambda _websocket: "ip")
    monkeypatch.setattr(wsmod, "_register_ip_connection", lambda *_args: False)
    socket = _WebSocket()
    asyncio.run(wsmod.sync_websocket_endpoint(socket))
    assert socket.closed == [4429]
    assert ("websocket_rejected", "ip_limit") in events


@pytest.mark.parametrize(
    ("cluster_result", "expected_code", "reason"),
    [
        (False, 4429, "cluster_ip_limit"),
        (RuntimeError("db unavailable"), 1013, "cluster_quota_unavailable"),
    ],
)
def test_websocket_endpoint_rejects_cluster_ip_quota(monkeypatch, cluster_result, expected_code, reason):
    events = _install_endpoint_defaults(monkeypatch)

    async def write(function, *_args, **_kwargs):
        if function is wsmod._acquire_cluster_ip_lease:
            if isinstance(cluster_result, BaseException):
                raise cluster_result
            return cluster_result
        return True

    monkeypatch.setattr(wsmod, "run_database_write", write)
    socket = _WebSocket()
    asyncio.run(wsmod.sync_websocket_endpoint(socket))
    assert socket.closed == [expected_code]
    assert ("websocket_rejected", reason) in events
    assert wsmod.active_connections_by_ip == {}


@pytest.mark.parametrize(
    ("incoming", "expected_code", "metric"),
    [
        ("not-json", 4400, ("websocket_authentication_failed", "protocol")),
        ("[]", 4400, ("websocket_authentication_failed", "protocol")),
        (json.dumps({"action": "noop"}), 4003, ("websocket_authentication_failed", "session_or_workspace")),
    ],
)
def test_websocket_endpoint_rejects_invalid_auth_protocol(monkeypatch, incoming, expected_code, metric):
    events = _install_endpoint_defaults(monkeypatch)
    socket = _WebSocket([incoming])
    asyncio.run(wsmod.sync_websocket_endpoint(socket))
    assert socket.closed == [expected_code]
    assert metric in events


def test_websocket_endpoint_rejects_oversized_auth_and_missing_workspace(monkeypatch):
    events = _install_endpoint_defaults(monkeypatch)
    monkeypatch.setenv("WEBSOCKET_MAX_FRAME_BYTES", "1")
    socket = _WebSocket(["{}"])
    asyncio.run(wsmod.sync_websocket_endpoint(socket))
    assert socket.closed == [1009]
    assert ("websocket_rejected", "frame_size") in events

    events = _install_endpoint_defaults(monkeypatch, owner=None)
    monkeypatch.setenv("WEBSOCKET_MAX_FRAME_BYTES", "65536")
    socket = _WebSocket([json.dumps({"action": "auth", "organizationId": "org-x"})])
    asyncio.run(wsmod.sync_websocket_endpoint(socket))
    assert socket.closed == [4003]
    assert not hasattr(socket, "user_id") is False


def test_websocket_endpoint_rejects_local_and_cluster_user_limits(monkeypatch):
    events = _install_endpoint_defaults(monkeypatch)
    existing = _WebSocket()
    existing.user_id = "user-1"
    wsmod.active_connections["other"] = {existing}
    monkeypatch.setenv("WEBSOCKET_MAX_CONNECTIONS_PER_USER", "1")
    socket = _WebSocket([json.dumps({"action": "auth", "organizationId": "org-1"})])
    asyncio.run(wsmod.sync_websocket_endpoint(socket))
    assert socket.closed == [4429]
    assert ("websocket_rejected", "user_limit") in events

    for attach, code, reason in (
        (False, 4429, "cluster_user_limit"),
        (RuntimeError("db"), 1013, "cluster_quota_unavailable"),
    ):
        events = _install_endpoint_defaults(monkeypatch, attach=attach)
        monkeypatch.setenv("WEBSOCKET_MAX_CONNECTIONS_PER_USER", "3")
        socket = _WebSocket([json.dumps({"action": "auth", "organizationId": "org-1"})])
        asyncio.run(wsmod.sync_websocket_endpoint(socket))
        assert socket.closed == [code]
        assert ("websocket_rejected", reason) in events


def test_websocket_endpoint_connects_disconnects_and_releases_cluster_lease(monkeypatch):
    events = _install_endpoint_defaults(monkeypatch)
    released = []
    original_write = wsmod.run_database_write

    async def write(function, *args, **kwargs):
        if function is wsmod._release_cluster_lease:
            released.append(args[0])
            return True
        return await original_write(function, *args, **kwargs)

    monkeypatch.setattr(wsmod, "run_database_write", write)
    socket = _WebSocket(
        [json.dumps({"action": "auth", "organizationId": "org-1"}), WebSocketDisconnect()]
    )
    asyncio.run(wsmod.sync_websocket_endpoint(socket))
    assert socket.accepted == 1
    assert ("websocket_connected", "user-1") in events
    assert ("websocket_disconnected",) in events
    assert released and wsmod.active_connections == {} and wsmod.active_connections_by_ip == {}


def test_websocket_endpoint_initial_timeout_records_auth_failure(monkeypatch):
    events = _install_endpoint_defaults(monkeypatch)

    async def timeout(_awaitable, timeout):
        del timeout
        _awaitable.close()
        raise asyncio.TimeoutError

    monkeypatch.setattr(wsmod.asyncio, "wait_for", timeout)
    socket = _WebSocket()
    asyncio.run(wsmod.sync_websocket_endpoint(socket))
    assert ("websocket_authentication_failed", "timeout") in events
