"""WebSocket connection registry for synchronization notifications."""

import asyncio
import hashlib
import json
import os
import time
import uuid

from starlette.websockets import WebSocketDisconnect

from backend.db.db_helper import database
from backend.shared.async_io import run_blocking_io
from backend.shared.database_io import run_database_read, run_database_write
from backend.shared.origin_policy import is_websocket_origin_allowed
from backend.shared.client_ip import get_client_ip
from backend.auth.session_store import load_session_user, session_invalid_reason
from backend.observability.recording import (
    websocket_attempted,
    websocket_authentication_failed,
    websocket_connected,
    websocket_disconnected,
    websocket_rejected,
)
from backend.shared.logging_utils import log_error


active_connections = {}
active_connections_by_ip = {}
_BROKER_CHANNEL = "biddingflow_events"
_WORKER_ID = f"{os.getpid()}-{uuid.uuid4().hex[:12]}"
_WEBSOCKET_LEASE_SECONDS = 120

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


def _client_ip_hash(client_ip):
    return hashlib.sha256(
        f"biddingflow-websocket-ip:{client_ip}".encode("utf-8")
    ).hexdigest()


def _acquire_cluster_ip_lease(
    lease_id,
    client_ip_hash,
    ip_limit,
):
    now = int(time.time())
    connection = database.get_connection()
    try:
        connection.execute("BEGIN")
        connection.execute(
            "SELECT pg_advisory_xact_lock(hashtext('biddingflow-websocket-quota'))"
        )
        connection.execute(
            "DELETE FROM websocket_connection_leases WHERE expires_at <= ?",
            (now,),
        )
        current = connection.execute(
            """
            SELECT count(*)
            FROM websocket_connection_leases
            WHERE client_ip_hash = ? AND expires_at > ?
            """,
            (client_ip_hash, now),
        ).fetchone()[0]
        if int(current or 0) >= int(ip_limit):
            connection.rollback()
            return False
        connection.execute(
            """
            INSERT INTO websocket_connection_leases (
                id, user_id, organization_id, client_ip_hash,
                worker_id, expires_at, created_at, updated_at
            ) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?)
            """,
            (
                lease_id,
                client_ip_hash,
                _WORKER_ID,
                now + _WEBSOCKET_LEASE_SECONDS,
                now,
                now,
            ),
        )
        connection.commit()
        return True
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _attach_cluster_user_lease(
    lease_id,
    user_id,
    organization_id,
    user_limit,
):
    now = int(time.time())
    connection = database.get_connection()
    try:
        connection.execute("BEGIN")
        connection.execute(
            "SELECT pg_advisory_xact_lock(hashtext('biddingflow-websocket-quota'))"
        )
        connection.execute(
            "DELETE FROM websocket_connection_leases WHERE expires_at <= ?",
            (now,),
        )
        current = connection.execute(
            """
            SELECT count(*)
            FROM websocket_connection_leases
            WHERE user_id = ? AND expires_at > ? AND id <> ?
            """,
            (user_id, now, lease_id),
        ).fetchone()[0]
        if int(current or 0) >= int(user_limit):
            connection.rollback()
            return False
        updated = connection.execute(
            """
            UPDATE websocket_connection_leases
            SET user_id = ?, organization_id = ?,
                expires_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                user_id,
                organization_id,
                now + _WEBSOCKET_LEASE_SECONDS,
                now,
                lease_id,
            ),
        )
        if updated.rowcount != 1:
            connection.rollback()
            return False
        connection.commit()
        return True
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _renew_cluster_lease(lease_id):
    now = int(time.time())
    connection = database.get_connection()
    try:
        updated = connection.execute(
            """
            UPDATE websocket_connection_leases
            SET expires_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (now + _WEBSOCKET_LEASE_SECONDS, now, lease_id),
        )
        connection.commit()
        return updated.rowcount == 1
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _release_cluster_lease(lease_id):
    connection = database.get_connection()
    try:
        connection.execute(
            "DELETE FROM websocket_connection_leases WHERE id = ?",
            (lease_id,),
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


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
    lease_id = uuid.uuid4().hex
    cluster_lease_acquired = False
    try:
        ip_limit = _positive_int_env(
            "WEBSOCKET_MAX_CONNECTIONS_PER_IP",
            10,
            maximum=1_000,
        )
        try:
            cluster_lease_acquired = await run_database_write(
                _acquire_cluster_ip_lease,
                lease_id,
                _client_ip_hash(client_ip),
                ip_limit,
            )
        except Exception as lease_error:
            log_error(
                lease_error,
                "websocket_cluster_ip_quota",
                level="WARN",
            )
            websocket_rejected("cluster_quota_unavailable")
            await websocket.close(code=1013)
            return
        if not cluster_lease_acquired:
            websocket_rejected("cluster_ip_limit")
            await websocket.close(code=4429)
            return

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
        try:
            user_lease_attached = await run_database_write(
                _attach_cluster_user_lease,
                lease_id,
                user_id,
                organization_id,
                user_limit,
            )
        except Exception as lease_error:
            log_error(
                lease_error,
                "websocket_cluster_user_quota",
                level="WARN",
            )
            websocket_rejected("cluster_quota_unavailable")
            await websocket.close(code=1013)
            return
        if not user_lease_attached:
            websocket_rejected("cluster_user_limit")
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
        _last_lease_renew = _time.time()

        while True:
            _now = _time.time()
            if _now - _last_lease_renew >= 60:
                try:
                    renewed = await run_database_write(
                        _renew_cluster_lease,
                        lease_id,
                    )
                except Exception as lease_error:
                    log_error(
                        lease_error,
                        "websocket_cluster_lease_renew",
                        level="WARN",
                    )
                    renewed = False
                if not renewed:
                    websocket_rejected("cluster_lease_lost")
                    await websocket.close(code=1013)
                    return
                _last_lease_renew = _now

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
                    json.loads(raw)


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
        if cluster_lease_acquired:
            try:
                await run_database_write(
                    _release_cluster_lease,
                    lease_id,
                )
            except Exception as lease_error:
                # The short lease expires automatically after a worker crash or
                # database outage; cleanup must not mask disconnect handling.
                log_error(
                    lease_error,
                    "websocket_cluster_lease_release",
                    level="WARN",
                )

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


def enqueue_websocket_event(
    cursor,
    event_type,
    *,
    organization_id=None,
    user_id=None,
    payload=None,
):
    """Insert and wake the broker using the caller's business transaction."""

    sanitized_payload = (
        serialize_websocket_event(payload)
        if event_type == "broadcast" else payload
    )
    row = cursor.execute(
        """
        INSERT INTO websocket_events (event_type, organization_id, user_id, payload_json)
        VALUES (?, ?, ?, ?)
        RETURNING id
        """,
        (
            event_type,
            organization_id,
            user_id,
            json.dumps(sanitized_payload) if sanitized_payload is not None else None,
        ),
    ).fetchone()
    event_id = int(row[0])
    # PostgreSQL delivers NOTIFY only when this transaction commits.
    cursor.execute("SELECT pg_notify(?, ?)", (_BROKER_CHANNEL, str(event_id)))
    return event_id


def _store_broker_event(event_type, organization_id=None, user_id=None, payload=None):
    conn = database.get_connection()
    try:
        event_id = enqueue_websocket_event(
            conn,
            event_type,
            organization_id=organization_id,
            user_id=user_id,
            payload=payload,
        )
        conn.commit()
        return event_id
    except Exception:  # noqa: BLE001 - transaction boundary must roll back any driver failure
        conn.rollback()
        raise
    finally:
        conn.close()


def _schedule_local_broadcast(organization_id, message):
    try:
        asyncio.get_running_loop().create_task(_broadcast_local(organization_id, message))
    except RuntimeError:
        pass


def broadcast_websocket_event(organization_id, message):
    """Publish through the PostgreSQL outbox so every worker receives the event."""
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
        except (TypeError, ValueError, json.JSONDecodeError) as exc:
            raise ValueError("WEBSOCKET_EVENT_PAYLOAD_INVALID") from exc
        await _broadcast_local(event.get("organization_id"), payload)
    elif event_type == "revoke_user":
        await _disconnect_user_local(event.get("user_id"))


def _load_broker_events(after_id):
    conn = database.get_connection()
    try:
        rows = conn.execute(
            """
            SELECT id, event_type, organization_id, user_id, payload_json,
                   status, attempt_count
            FROM websocket_events
            WHERE id > ? AND status != 'dead_letter'
              AND available_at <= ?
            ORDER BY id
            LIMIT 500
            """,
            (after_id, int(time.time())),
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


def _pending_broker_start_id():
    """Resume before the oldest event not acknowledged by any consumer."""

    conn = database.get_connection()
    try:
        row = conn.execute(
            """SELECT COALESCE(
                       MIN(id) FILTER (WHERE status IN ('pending', 'retry')) - 1,
                       MAX(id),
                       0
                   )
               FROM websocket_events"""
        ).fetchone()
        return max(0, int(row[0] or 0))
    finally:
        conn.close()


def _record_broker_delivery(event_id, error=None):
    now = int(time.time())
    conn = database.get_connection()
    try:
        conn.execute("BEGIN")
        if error is None:
            conn.execute(
                """UPDATE websocket_events
                   SET status = 'delivered', attempt_count = attempt_count + 1,
                       delivered_at = ?, last_error_code = NULL
                   WHERE id = ?""",
                (now, event_id),
            )
            status = "delivered"
        else:
            row = conn.execute(
                "SELECT attempt_count FROM websocket_events WHERE id = ? FOR UPDATE",
                (event_id,),
            ).fetchone()
            attempts = int(row[0] or 0) + 1 if row else 1
            status = "dead_letter" if attempts >= 5 else "retry"
            conn.execute(
                """UPDATE websocket_events
                   SET status = ?, attempt_count = ?, available_at = ?,
                       last_error_code = ?
                   WHERE id = ?""",
                (
                    status,
                    attempts,
                    now + min(60, 2 ** attempts) if status == "retry" else now,
                    error.__class__.__name__[:96],
                    event_id,
                ),
            )
        conn.commit()
        return status
    except Exception:  # noqa: BLE001 - transaction boundary must roll back any driver failure
        conn.rollback()
        raise
    finally:
        conn.close()


async def run_websocket_event_broker(poll_interval=0.25, start_after_id=None):
    """Fan out durable events using PostgreSQL LISTEN/NOTIFY with replay."""
    del poll_interval
    last_event_id = (
        int(start_after_id)
        if start_after_id is not None
        else await run_blocking_io(_latest_broker_event_id, timeout_seconds=5.0)
    )
    listener = None
    cleanup_counter = 0
    while True:
        try:
            if listener is None or listener.closed:
                listener = await run_blocking_io(
                    _open_broker_listener, timeout_seconds=10.0
                )
            events = await run_blocking_io(_load_broker_events, last_event_id, timeout_seconds=5.0)
            if not events:
                await run_blocking_io(
                    _wait_for_broker_signal,
                    listener,
                    timeout_seconds=35.0,
                )
                events = await run_blocking_io(
                    _load_broker_events, last_event_id, timeout_seconds=5.0
                )
        except asyncio.CancelledError:
            if listener is not None:
                await run_blocking_io(listener.close, timeout_seconds=2.0)
            raise
        except Exception as broker_error:
            log_error(broker_error, "websocket_broker_listener", level="WARN")
            if listener is not None:
                try:
                    listener.close()
                except Exception:
                    pass
            listener = None
            await asyncio.sleep(1.0)
            continue
        for event in events:
            try:
                await dispatch_websocket_broker_event(event)
                await run_blocking_io(
                    _record_broker_delivery,
                    int(event["id"]),
                    timeout_seconds=5.0,
                )
                last_event_id = max(last_event_id, int(event["id"]))
            except Exception as delivery_error:  # noqa: BLE001 - durable broker retries all delivery failures
                status = await run_blocking_io(
                    _record_broker_delivery,
                    int(event["id"]),
                    delivery_error,
                    timeout_seconds=5.0,
                )
                if status == "dead_letter":
                    last_event_id = max(last_event_id, int(event["id"]))
                break
        cleanup_counter += 1
        if cleanup_counter >= 1_000:
            cleanup_counter = 0
            try:
                await run_blocking_io(_cleanup_broker_events, timeout_seconds=10.0)
            except Exception as broker_cleanup_error:
                log_error(broker_cleanup_error, "websocket_broker_cleanup", level="WARN")


def _open_broker_listener():
    connection = database.listen_connection()
    with connection.cursor() as cursor:
        cursor.execute(f"LISTEN {_BROKER_CHANNEL}")
    return connection


def _wait_for_broker_signal(connection, timeout=30.0):
    return next(connection.notifies(timeout=timeout, stop_after=1), None)


def _cleanup_broker_events():
    conn = database.get_connection()
    try:
        conn.execute("BEGIN")
        leader = conn.execute(
            "SELECT pg_try_advisory_xact_lock(hashtext('biddingflow-websocket-cleanup'))"
        ).fetchone()
        if not leader or not leader[0]:
            conn.rollback()
            return
        conn.execute(
            "DELETE FROM websocket_events WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '1 day'"
        )
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
