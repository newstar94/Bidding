"""WebSocket connection registry for synchronization notifications."""

import asyncio
import json

from helpers import database


active_connections = {}


def _public_upload_path(value):
    path = str(value or "").strip()
    return "/" + path if path.startswith("uploads/") else path





async def sync_websocket_endpoint(websocket):


    try:
        from app import ALLOWED_WS_ORIGINS, APP_DEBUG as _APP_DEBUG
        origin = (websocket.headers.get("origin") or "").rstrip("/")
        if not _APP_DEBUG and origin and origin not in ALLOWED_WS_ORIGINS:
            await websocket.close(code=4403)
            return
    except Exception:
        pass

    await websocket.accept()

    owner_id = None
    user_id = None
    try:
        data = await websocket.receive_text()
        msg = json.loads(data)
        if msg.get("action") == "auth":
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
                cursor.execute("""
                    SELECT to_chuc_id
                    FROM thanh_vien_to_chuc
                    WHERE user_id = ?
                """, (user_id,))
                user_orgs = [r[0] for r in cursor.fetchall()]
                conn.close()
                if user_orgs:
                    owner_id = user_orgs[0]
                else:
                    owner_id = str(user_id)

        if not owner_id:
            await websocket.close(code=4003)
            return

        if owner_id not in active_connections:
            active_connections[owner_id] = set()
        active_connections[owner_id].add(websocket)
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
                    _cur.execute("SELECT token_phien, han_su_dung_token FROM tai_khoan WHERE id = ?", (user_id,))
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
        if owner_id and owner_id in active_connections:
            active_connections[owner_id].discard(websocket)
            if not active_connections[owner_id]:
                del active_connections[owner_id]

def broadcast_websocket_event(owner_id, message):
    if owner_id not in active_connections:
        return
    websockets = list(active_connections[owner_id])
    msg_str = json.dumps(message)

    async def broadcast():
        dead = []
        for ws in websockets:
            try:
                await ws.send_text(msg_str)
            except Exception:
                dead.append(ws)

        for ws in dead:
            active_connections[owner_id].discard(ws)
        if not active_connections.get(owner_id):
            active_connections.pop(owner_id, None)

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(broadcast())
    except RuntimeError:
        pass

def disconnect_user_websockets(user_id):
    """Tìm và ngắt toàn bộ kết nối WebSocket thuộc về user_id."""
    for owner_id, sockets in list(active_connections.items()):
        for ws in list(sockets):
            if getattr(ws, 'user_id', None) == user_id:
                try:
                    async def close_ws(w):
                        try:
                            await w.close(code=4001)
                        except Exception:
                            pass
                    loop = asyncio.get_running_loop()
                    loop.create_task(close_ws(ws))
                except Exception:
                    pass

                sockets.discard(ws)
        if not active_connections.get(owner_id):
            active_connections.pop(owner_id, None)




