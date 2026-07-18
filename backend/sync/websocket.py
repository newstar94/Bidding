"""WebSocket connection registry for synchronization notifications."""

import asyncio
import json
import os

from starlette.websockets import WebSocketDisconnect

from backend.shared.helpers import database
from backend.shared.async_io import run_blocking_io
from backend.shared.database_io import run_database_read
from backend.shared.origin_policy import is_websocket_origin_allowed
from backend.shared.client_ip import get_client_ip
from backend.auth.session_store import load_session_user, session_invalid_reason
from backend.observability.metrics import (
    websocket_attempted,
    websocket_authentication_failed,
    websocket_connected,
    websocket_disconnected,
    websocket_rejected,
)
from backend.shared.logging_utils import log_error


active_connections = {}
active_connections_by_ip = {}

_WEBSOCKET_EVENT_FIELDS = {
    "db_changed": ("event",),
    "organization_member_changed": ("event",),
    "organization_subscription_changed": ("event",),
    "user_access_settings_changed": ("event",),
    "sync_update": ("type", "table", "id", "syncVersion"),
}


def _positive_int_env(name, default, minimum=1, maximum=10_000):
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return min(maximum, max(minimum, value))


def _websocket_frame_is_allowed(value):
    if not isinstance(value, str):
        return False
    max_bytes = _positive_int_env("WEBSOCKET_MAX_FRAME_BYTES", 65_536, maximum=1_048_576)
    return len(value.encode("utf-8")) <= max_bytes


def _active_user_connection_count(user_id):
    return sum(
        1
        for sockets in active_connections.values()
        for socket in sockets
        if getattr(socket, "user_id", None) == user_id
    )


def _register_ip_connection(client_ip, websocket):
    sockets = active_connections_by_ip.setdefault(client_ip, set())
    limit = _positive_int_env("WEBSOCKET_MAX_CONNECTIONS_PER_IP", 10, maximum=1_000)
    if len(sockets) >= limit:
        if not sockets:
            active_connections_by_ip.pop(client_ip, None)
        return False
    sockets.add(websocket)
    return True


def _release_ip_connection(client_ip, websocket):
    sockets = active_connections_by_ip.get(client_ip)
    if sockets is None:
        return
    sockets.discard(websocket)
    if not sockets:
        active_connections_by_ip.pop(client_ip, None)


def serialize_websocket_event(message):
    """Allow only invalidation metadata; business rows never enter WS payloads."""
    if not isinstance(message, dict):
        raise ValueError("WebSocket event must be an object")
    event_name = str(message.get("event") or message.get("type") or "").strip()
    allowed_fields = _WEBSOCKET_EVENT_FIELDS.get(event_name)
    if allowed_fields is None:
        raise ValueError("Unsupported WebSocket event")
    payload = {
        field: message[field]
        for field in allowed_fields
        if field in message
    }
    if event_name == "sync_update":
        if not str(payload.get("table") or "").strip():
            raise ValueError("sync_update requires a table")
        if not str(payload.get("id") or "").strip():
            raise ValueError("sync_update requires an id")
        try:
            payload["syncVersion"] = int(payload.get("syncVersion"))
        except (TypeError, ValueError) as exc:
            raise ValueError("sync_update requires a numeric syncVersion") from exc
    return payload


def resolve_websocket_owner(cursor, user_id, organization_id):
    """Resolve the effective ID-backed workspace for a user."""
    requested = str(organization_id or "").strip()
    if not requested:
        return None
    cursor.execute(
        """
        SELECT memberships.organization_id
        FROM thanh_vien_to_chuc AS memberships
        INNER JOIN to_chuc AS organizations
            ON organizations.id = memberships.organization_id
        WHERE memberships.user_id = ?
          AND memberships.organization_id = ?
          AND COALESCE(memberships.trang_thai_thanh_vien, 'active') = 'active'
          AND organizations.trang_thai = 'active'
        LIMIT 1
        """,
        (user_id, requested),
    )
    row = cursor.fetchone()
    return str(row[0]) if row else None


def _load_websocket_owner(user_id, organization_id):
    connection = database.get_connection()
    try:
        return resolve_websocket_owner(
            connection.cursor(),
            user_id,
            organization_id,
        )
    finally:
        connection.close()


async def sync_websocket_endpoint(websocket):
    websocket_attempted()
    origin = websocket.headers.get("origin") or ""
    if not is_websocket_origin_allowed(origin):
        websocket_rejected("origin")
        await websocket.close(code=4403)
        return

    client_ip = get_client_ip(websocket)
    if not _register_ip_connection(client_ip, websocket):
        websocket_rejected("ip_limit")
        await websocket.close(code=4429)
        return

    organization_id = None
    user_id = None
    metrics_connected = False
    try:
        await websocket.accept()
        data = await asyncio.wait_for(websocket.receive_text(), timeout=10.0)
        if not _websocket_frame_is_allowed(data):
            websocket_rejected("frame_size")
            await websocket.close(code=1009)
            return
        try:
            msg = json.loads(data)
        except (json.JSONDecodeError, TypeError):
            websocket_authentication_failed("protocol")
            await websocket.close(code=4400)
            return
        if not isinstance(msg, dict):
            websocket_authentication_failed("protocol")
            await websocket.close(code=4400)
            return
        if msg.get("action") == "auth":
            requested_org_id = msg.get("organizationId")
            token = (websocket.cookies.get("session_token") or "").strip()

            session_user = await run_blocking_io(load_session_user, database, token)
            if session_user and not session_invalid_reason(session_user):
                user_id = session_user['id']
                websocket.user_id = user_id
                organization_id = await run_database_read(
                    _load_websocket_owner,
                    user_id,
                    requested_org_id,
                    timeout_seconds=5.0,
                )

        if not organization_id:
            websocket_authentication_failed("session_or_workspace")
            await websocket.close(code=4003)
            return

        user_limit = _positive_int_env(
            "WEBSOCKET_MAX_CONNECTIONS_PER_USER",
            3,
            maximum=100,
        )
        if _active_user_connection_count(user_id) >= user_limit:
            websocket_rejected("user_limit")
            await websocket.close(code=4429)
            return

        if organization_id not in active_connections:
            active_connections[organization_id] = set()
        active_connections[organization_id].add(websocket)
        websocket_connected(user_id)
        metrics_connected = True
        import time as _time
        _last_auth_check = _time.time()
        _AUTH_CHECK_INTERVAL = 30 * 60

        _PING_INTERVAL = 55.0
        _PONG_TIMEOUT = 15.0
        _waiting_pong = False

        while True:
            _now = _time.time()

            if _now - _last_auth_check >= _AUTH_CHECK_INTERVAL:
                _last_auth_check = _now
                try:
                    _session_user = await run_blocking_io(load_session_user, database, token)
                    if not _session_user or session_invalid_reason(_session_user, now=_now):
                        websocket_authentication_failed("reauthentication")
                        await websocket.close(code=4001)
                        return
                    _owner = await run_database_read(
                        _load_websocket_owner,
                        user_id,
                        organization_id,
                        timeout_seconds=5.0,
                    )
                    if not _owner:
                        websocket_authentication_failed("workspace_revoked")
                        await websocket.close(code=4001)
                        return
                except Exception as auth_recheck_error:
                    log_error(auth_recheck_error, "websocket_auth_recheck", level="WARN")
                    websocket_authentication_failed("reauthentication_error")
                    await websocket.close(code=4001)
                    return

            try:



                recv_timeout = _PONG_TIMEOUT if _waiting_pong else _PING_INTERVAL
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=recv_timeout)
                if not _websocket_frame_is_allowed(raw):
                    websocket_rejected("frame_size")
                    await websocket.close(code=1009)
                    return
                _waiting_pong = False
                try:
                    msg_in = json.loads(raw)


                except (json.JSONDecodeError, TypeError):
                    pass
            except asyncio.TimeoutError:
                if _waiting_pong:

                    await websocket.close(code=1001)
                    return

                await websocket.send_text('{"type":"ping"}')
                _waiting_pong = True

    except (WebSocketDisconnect, RuntimeError, asyncio.TimeoutError) as websocket_error:
        if isinstance(websocket_error, asyncio.TimeoutError) and not metrics_connected:
            websocket_authentication_failed("timeout")
    finally:
        if metrics_connected:
            websocket_disconnected()
        _release_ip_connection(client_ip, websocket)
        if organization_id and organization_id in active_connections:
            active_connections[organization_id].discard(websocket)
            if not active_connections[organization_id]:
                del active_connections[organization_id]

async def _broadcast_local(organization_id, message):
    if organization_id not in active_connections:
        return
    websockets = list(active_connections[organization_id])
    msg_str = json.dumps(serialize_websocket_event(message))
    dead = []
    for ws in websockets:
        try:
            await ws.send_text(msg_str)
        except Exception:
            dead.append(ws)
    for ws in dead:
        active_connections.get(organization_id, set()).discard(ws)
    if not active_connections.get(organization_id):
        active_connections.pop(organization_id, None)


def _store_broker_event(event_type, organization_id=None, user_id=None, payload=None):
    conn = database.get_connection()
    try:
        conn.execute(
            """
            INSERT INTO websocket_events (event_type, organization_id, user_id, payload_json)
            VALUES (?, ?, ?, ?)
            """,
            (event_type, organization_id, user_id, json.dumps(payload) if payload is not None else None),
        )
        conn.commit()
    finally:
        conn.close()


def _schedule_local_broadcast(organization_id, message):
    try:
        asyncio.get_running_loop().create_task(_broadcast_local(organization_id, message))
    except RuntimeError:
        pass


def broadcast_websocket_event(organization_id, message):
    """Publish through the SQLite outbox so every application worker receives the event."""
    try:
        sanitized_message = serialize_websocket_event(message)
    except ValueError as invalid_event_error:
        log_error(invalid_event_error, "websocket_event_policy", level="WARN")
        return False
    try:
        _store_broker_event(
            "broadcast",
            organization_id=str(organization_id),
            payload=sanitized_message,
        )
    except Exception:
        # A transient outbox failure must not suppress notifications in this worker.
        _schedule_local_broadcast(organization_id, sanitized_message)
    return True


async def _disconnect_user_local(user_id):
    close_tasks = []
    for organization_id, sockets in list(active_connections.items()):
        for ws in list(sockets):
            if getattr(ws, "user_id", None) == user_id:
                sockets.discard(ws)
                close_tasks.append(asyncio.create_task(ws.close(code=4001)))
        if not sockets:
            active_connections.pop(organization_id, None)
    if close_tasks:
        await asyncio.gather(*close_tasks, return_exceptions=True)


async def dispatch_websocket_broker_event(event):
    event_type = event.get("event_type")
    if event_type == "broadcast":
        try:
            payload = json.loads(event.get("payload_json") or "{}")
            payload = serialize_websocket_event(payload)
        except (TypeError, ValueError, json.JSONDecodeError):
            return
        await _broadcast_local(event.get("organization_id"), payload)
    elif event_type == "revoke_user":
        await _disconnect_user_local(event.get("user_id"))


def _load_broker_events(after_id):
    conn = database.get_connection()
    try:
        rows = conn.execute(
            """
            SELECT id, event_type, organization_id, user_id, payload_json
            FROM websocket_events
            WHERE id > ?
            ORDER BY id
            LIMIT 500
            """,
            (after_id,),
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def _latest_broker_event_id():
    conn = database.get_connection()
    try:
        row = conn.execute("SELECT COALESCE(MAX(id), 0) FROM websocket_events").fetchone()
        return int(row[0] or 0)
    finally:
        conn.close()


async def run_websocket_event_broker(poll_interval=0.25, start_after_id=None):
    """Fan out durable events to sockets owned by this process."""
    last_event_id = (
        int(start_after_id)
        if start_after_id is not None
        else await run_blocking_io(_latest_broker_event_id, timeout_seconds=5.0)
    )
    cleanup_counter = 0
    while True:
        try:
            events = await run_blocking_io(_load_broker_events, last_event_id, timeout_seconds=5.0)
        except asyncio.CancelledError:
            raise
        except Exception:
            await asyncio.sleep(max(1.0, poll_interval))
            continue
        for event in events:
            await dispatch_websocket_broker_event(event)
            last_event_id = max(last_event_id, int(event["id"]))
        cleanup_counter += 1
        if cleanup_counter >= 14_400:
            cleanup_counter = 0
            try:
                await run_blocking_io(_cleanup_broker_events, timeout_seconds=10.0)
            except Exception as broker_cleanup_error:
                log_error(broker_cleanup_error, "websocket_broker_cleanup", level="WARN")
        await asyncio.sleep(poll_interval)


def _cleanup_broker_events():
    conn = database.get_connection()
    try:
        conn.execute("DELETE FROM websocket_events WHERE created_at < datetime('now', '-1 day')")
        conn.commit()
    finally:
        conn.close()

def disconnect_user_websockets(user_id):
    """Revoke sockets for this user in every worker and immediately in this worker."""
    normalized_user_id = str(user_id or "").strip()
    if not normalized_user_id:
        return
    try:
        _store_broker_event("revoke_user", user_id=normalized_user_id)
    except Exception as revoke_store_error:
        log_error(revoke_store_error, "websocket_revoke_store", level="WARN")
    try:
        asyncio.get_running_loop().create_task(_disconnect_user_local(normalized_user_id))
    except RuntimeError:
        pass
