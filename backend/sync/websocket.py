"""WebSocket connection registry for synchronization notifications."""

import asyncio
import json

from backend.shared.helpers import database
from backend.shared.async_io import run_blocking_io
from backend.shared.origin_policy import is_websocket_origin_allowed


active_connections = {}


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
          AND organizations.trang_thai = 'active'
          AND (
              organizations.scope_type = 'organization'
              OR NOT EXISTS (
                  SELECT 1
                  FROM thanh_vien_to_chuc business_membership
                  JOIN to_chuc business_org
                    ON business_org.id = business_membership.organization_id
                  WHERE business_membership.user_id = memberships.user_id
                    AND business_org.scope_type = 'organization'
              )
          )
        LIMIT 1
        """,
        (user_id, requested),
    )
    row = cursor.fetchone()
    return str(row[0]) if row else None


async def sync_websocket_endpoint(websocket):
    origin = websocket.headers.get("origin") or ""
    if not is_websocket_origin_allowed(origin):
        await websocket.close(code=4403)
        return

    await websocket.accept()

    organization_id = None
    user_id = None
    try:
        data = await asyncio.wait_for(websocket.receive_text(), timeout=10.0)
        msg = json.loads(data)
        if msg.get("action") == "auth":
            requested_org_id = msg.get("organizationId")
            token = (websocket.cookies.get("session_token") or "").strip()

            conn = database.get_connection()
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id, vai_tro, token_phien, han_su_dung_token FROM tai_khoan WHERE token_phien = ?",
                (token,)
            )
            row = cursor.fetchone()
            conn.close()

            if row:

                if row['han_su_dung_token']:
                    try:
                        import time as _time
                        if _time.time() > float(row['han_su_dung_token']):
                            await websocket.close(code=4001)
                            return
                    except Exception:
                        pass
                user_id = row['id']
                websocket.user_id = user_id
                conn = database.get_connection()
                cursor = conn.cursor()
                organization_id = resolve_websocket_owner(cursor, user_id, requested_org_id)
                conn.close()

        if not organization_id:
            await websocket.close(code=4003)
            return

        if organization_id not in active_connections:
            active_connections[organization_id] = set()
        active_connections[organization_id].add(websocket)
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
                    _conn = database.get_connection()
                    _cur = _conn.cursor()
                    _cur.execute(
                        """
                        SELECT accounts.token_phien, accounts.han_su_dung_token
                        FROM tai_khoan AS accounts
                        INNER JOIN thanh_vien_to_chuc AS memberships
                            ON memberships.user_id = accounts.id
                           AND memberships.organization_id = ?
                        INNER JOIN to_chuc AS organizations
                            ON organizations.id = memberships.organization_id
                           AND organizations.trang_thai = 'active'
                        WHERE accounts.id = ?
                          AND (
                              organizations.scope_type = 'organization'
                              OR NOT EXISTS (
                                  SELECT 1
                                  FROM thanh_vien_to_chuc business_membership
                                  JOIN to_chuc business_org
                                    ON business_org.id = business_membership.organization_id
                                  WHERE business_membership.user_id = accounts.id
                                    AND business_org.scope_type = 'organization'
                              )
                          )
                        LIMIT 1
                        """,
                        (organization_id, user_id),
                    )
                    _row = _cur.fetchone()
                    _conn.close()
                    if not _row or _row['token_phien'] != token:
                        await websocket.close(code=4001)
                        return
                    if _row['han_su_dung_token'] and _now > float(_row['han_su_dung_token']):
                        await websocket.close(code=4001)
                        return
                except Exception:
                    pass

            try:



                recv_timeout = _PONG_TIMEOUT if _waiting_pong else _PING_INTERVAL
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=recv_timeout)
                _waiting_pong = False
                try:
                    msg_in = json.loads(raw)


                except Exception:
                    pass
            except asyncio.TimeoutError:
                if _waiting_pong:

                    await websocket.close(code=1001)
                    return

                await websocket.send_text('{"type":"ping"}')
                _waiting_pong = True

    except Exception:
        pass
    finally:
        if organization_id and organization_id in active_connections:
            active_connections[organization_id].discard(websocket)
            if not active_connections[organization_id]:
                del active_connections[organization_id]

async def _broadcast_local(organization_id, message):
    if organization_id not in active_connections:
        return
    websockets = list(active_connections[organization_id])
    msg_str = json.dumps(message)
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
        _store_broker_event("broadcast", organization_id=str(organization_id), payload=message)
    except Exception:
        # A transient outbox failure must not suppress notifications in this worker.
        _schedule_local_broadcast(organization_id, message)


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
        except (TypeError, json.JSONDecodeError):
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
            except Exception:
                pass
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
    except Exception:
        pass
    try:
        asyncio.get_running_loop().create_task(_disconnect_user_local(normalized_user_id))
    except RuntimeError:
        pass
