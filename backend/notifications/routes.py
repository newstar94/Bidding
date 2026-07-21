"""Authenticated API for a user's persistent in-app notifications."""

from __future__ import annotations

import time

from starlette.responses import JSONResponse

from backend.shared.helpers import database, verify_session
from backend.shared.logging_utils import log_and_error


def _limit(request) -> int:
    try:
        return max(1, min(100, int(request.query_params.get("limit", "40"))))
    except (TypeError, ValueError):
        return 40


async def list_notifications_api(request):
    connection = None
    try:
        valid, session = verify_session(request)
        if not valid:
            return JSONResponse({"error": session}, status_code=403)
        connection = database.get_connection()
        cursor = connection.cursor()
        rows = cursor.execute(
            """SELECT id, organization_id, kind, severity, title, message,
                      target_type, target_id, route, read_at, created_at
               FROM user_notifications
               WHERE user_id = ?
               ORDER BY created_at DESC, id DESC
               LIMIT ?""",
            (session.user_id, _limit(request)),
        ).fetchall()
        unread = int(cursor.execute(
            "SELECT count(*) FROM user_notifications WHERE user_id = ? AND read_at IS NULL",
            (session.user_id,),
        ).fetchone()[0])
        items = [
            {
                "id": row[0],
                "organizationId": row[1],
                "kind": row[2],
                "severity": row[3],
                "title": row[4],
                "message": row[5],
                "targetType": row[6],
                "targetId": row[7],
                "route": row[8],
                "readAt": row[9],
                "createdAt": row[10],
            }
            for row in rows
        ]
        return JSONResponse(
            {"items": items, "unreadCount": unread},
            headers={"Cache-Control": "private, no-store"},
        )
    except Exception as exc:
        return log_and_error(
            request,
            exc,
            "list_notifications_api",
            "NOTIFICATION_LIST_FAILED",
            "Không thể tải thông báo.",
        )
    finally:
        if connection:
            connection.close()


async def mark_notification_read_api(request):
    connection = None
    try:
        valid, session = verify_session(request)
        if not valid:
            return JSONResponse({"error": session}, status_code=403)
        notification_id = str(request.path_params.get("notification_id") or "").strip()
        if not notification_id:
            return JSONResponse({"error": "Thiếu mã thông báo."}, status_code=400)
        connection = database.get_connection()
        cursor = connection.cursor()
        cursor.execute(
            """UPDATE user_notifications SET read_at = COALESCE(read_at, ?)
               WHERE id = ? AND user_id = ?""",
            (int(time.time()), notification_id, session.user_id),
        )
        if cursor.rowcount != 1:
            connection.rollback()
            return JSONResponse({"error": "Không tìm thấy thông báo."}, status_code=404)
        connection.commit()
        return JSONResponse({"success": True})
    except Exception as exc:
        if connection:
            connection.rollback()
        return log_and_error(
            request,
            exc,
            "mark_notification_read_api",
            "NOTIFICATION_UPDATE_FAILED",
            "Không thể cập nhật thông báo.",
        )
    finally:
        if connection:
            connection.close()


async def mark_all_notifications_read_api(request):
    connection = None
    try:
        valid, session = verify_session(request)
        if not valid:
            return JSONResponse({"error": session}, status_code=403)
        connection = database.get_connection()
        cursor = connection.cursor()
        cursor.execute(
            """UPDATE user_notifications SET read_at = ?
               WHERE user_id = ? AND read_at IS NULL""",
            (int(time.time()), session.user_id),
        )
        updated = int(cursor.rowcount or 0)
        connection.commit()
        return JSONResponse({"success": True, "updated": updated})
    except Exception as exc:
        if connection:
            connection.rollback()
        return log_and_error(
            request,
            exc,
            "mark_all_notifications_read_api",
            "NOTIFICATION_UPDATE_FAILED",
            "Không thể cập nhật thông báo.",
        )
    finally:
        if connection:
            connection.close()
