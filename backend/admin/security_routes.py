"""Bounded audit and session-security reads for platform administrators."""

# Dynamic SQL fragments in this module come only from fixed column maps and
# code-owned predicates; every request value remains a bound parameter.
# ruff: noqa: S608

from __future__ import annotations

import time

from starlette.responses import JSONResponse

from backend.admin.platform_directory_routes import (
    _InvalidDirectoryQuery,
    _forbidden_or_role,
    _json_value,
    _pagination,
    _parse_common_query,
)
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError
from backend.shared.database_io import run_database_read
from backend.shared.helpers import database, log_error


_AUDIT_SORT_COLUMNS = {
    "created_at": "audit.created_at",
    "action": "audit.action",
    "target_type": "audit.target_type",
    "sequence": "audit.sequence",
}
_SESSION_SORT_COLUMNS = {
    "created_at": "sessions.created_at",
    "last_seen_at": "sessions.last_seen_at",
    "absolute_expires_at": "sessions.absolute_expires_at",
    "user": "lower(COALESCE(account.ho_ten, account.ten_dang_nhap, account.email))",
}


def _response(payload, *, status_code=200):
    return JSONResponse(
        payload,
        status_code=status_code,
        headers={"Cache-Control": "private, no-store"},
    )


def _bounded_identifier(value, label, *, maximum=200):
    normalized = str(value or "").strip()
    if len(normalized) > maximum:
        raise _InvalidDirectoryQuery(f"{label} không hợp lệ.")
    return normalized


def _where_sql(predicates):
    return f" WHERE {' AND '.join(predicates)}" if predicates else ""


def _list_admin_audit_sync(request):
    denied, _role = _forbidden_or_role(request)
    if denied:
        return denied
    try:
        page, page_size, search, sort_by, sort_direction = _parse_common_query(
            request,
            sort_columns=_AUDIT_SORT_COLUMNS,
            default_sort="created_at",
            allowed_filters={"action", "targetType", "actorUserId", "organizationId"},
        )
        if "sortDir" not in request.query_params:
            sort_direction = "desc"
        action = _bounded_identifier(request.query_params.get("action"), "Hành động", maximum=120)
        target_type = _bounded_identifier(request.query_params.get("targetType"), "Loại đối tượng", maximum=120)
        actor_user_id = _bounded_identifier(request.query_params.get("actorUserId"), "Người thực hiện")
        organization_id = _bounded_identifier(request.query_params.get("organizationId"), "Tổ chức")

        predicates = []
        values = []
        if search:
            term = f"%{search.lower()}%"
            predicates.append(
                "(lower(audit.action) LIKE ? OR lower(COALESCE(audit.target_type, '')) LIKE ? "
                "OR lower(COALESCE(audit.target_id, '')) LIKE ?)"
            )
            values.extend((term, term, term))
        for column, value in (
            ("action", action),
            ("target_type", target_type),
            ("actor_user_id", actor_user_id),
            ("organization_id", organization_id),
        ):
            if value:
                predicates.append(f"audit.{column} = ?")
                values.append(value)
        where_sql = _where_sql(predicates)

        connection = database.get_connection()
        try:
            cursor = connection.cursor()
            cursor.execute(
                f"SELECT COUNT(*) AS total_rows FROM audit_log audit{where_sql}",
                tuple(values),
            )
            total_rows = int(cursor.fetchone()["total_rows"])
            cursor.execute(
                f"""SELECT audit.id, audit.chain_id, audit.sequence,
                           audit.actor_user_id, audit.organization_id,
                           audit.action, audit.target_type, audit.target_id,
                           audit.created_at
                      FROM audit_log audit{where_sql}
                     ORDER BY {_AUDIT_SORT_COLUMNS[sort_by]} {sort_direction.upper()},
                              audit.id DESC
                     LIMIT ? OFFSET ?""",
                (*values, page_size, (page - 1) * page_size),
            )
            rows = cursor.fetchall()
        finally:
            connection.close()

        return _response(
            {
                "items": [
                    {
                        "id": row["id"],
                        "chainId": row["chain_id"],
                        "sequence": int(row["sequence"]),
                        "actorUserId": row["actor_user_id"],
                        "organizationId": row["organization_id"],
                        "action": row["action"],
                        "targetType": row["target_type"],
                        "targetId": row["target_id"],
                        "createdAt": _json_value(row["created_at"]),
                    }
                    for row in rows
                ],
                "pagination": _pagination(page, page_size, total_rows),
                "sort": {"by": sort_by, "direction": sort_direction},
                "filters": {
                    "search": search,
                    "action": action,
                    "targetType": target_type,
                    "actorUserId": actor_user_id,
                    "organizationId": organization_id,
                },
            }
        )
    except _InvalidDirectoryQuery as exc:
        return _response({"error": str(exc)}, status_code=400)
    except Exception as exc:  # noqa: BLE001 - internal database details stay private.
        log_error(exc, "list_platform_admin_audit")
        return _response({"error": "Đã xảy ra lỗi tải nhật ký quản trị."}, status_code=500)


def _session_status(row, now):
    if row["revoked_at"] is not None:
        return "revoked"
    if int(row["idle_expires_at"]) <= now or int(row["absolute_expires_at"]) <= now:
        return "expired"
    return "active"


def _list_admin_sessions_sync(request):
    denied, _role = _forbidden_or_role(request)
    if denied:
        return denied
    try:
        page, page_size, search, sort_by, sort_direction = _parse_common_query(
            request,
            sort_columns=_SESSION_SORT_COLUMNS,
            default_sort="last_seen_at",
            allowed_filters={"status", "userId"},
        )
        if "sortDir" not in request.query_params:
            sort_direction = "desc"
        status = str(request.query_params.get("status") or "").strip().lower()
        user_id = _bounded_identifier(request.query_params.get("userId"), "Người dùng")
        if status not in {"", "active", "expired", "revoked"}:
            raise _InvalidDirectoryQuery("Trạng thái phiên không hợp lệ.")
        now = int(time.time())
        predicates = []
        values = []
        if search:
            term = f"%{search.lower()}%"
            predicates.append(
                "(lower(COALESCE(account.ho_ten, '')) LIKE ? "
                "OR lower(COALESCE(account.ten_dang_nhap, '')) LIKE ? "
                "OR lower(account.email) LIKE ?)"
            )
            values.extend((term, term, term))
        if user_id:
            predicates.append("sessions.user_id = ?")
            values.append(user_id)
        if status == "active":
            predicates.append(
                "sessions.revoked_at IS NULL AND sessions.idle_expires_at > ? "
                "AND sessions.absolute_expires_at > ?"
            )
            values.extend((now, now))
        elif status == "expired":
            predicates.append(
                "sessions.revoked_at IS NULL AND "
                "(sessions.idle_expires_at <= ? OR sessions.absolute_expires_at <= ?)"
            )
            values.extend((now, now))
        elif status == "revoked":
            predicates.append("sessions.revoked_at IS NOT NULL")
        where_sql = _where_sql(predicates)
        joins = " JOIN tai_khoan account ON account.id = sessions.user_id"

        connection = database.get_connection()
        try:
            cursor = connection.cursor()
            cursor.execute(
                f"SELECT COUNT(*) AS total_rows FROM auth_sessions sessions{joins}{where_sql}",
                tuple(values),
            )
            total_rows = int(cursor.fetchone()["total_rows"])
            cursor.execute(
                f"""SELECT sessions.id, sessions.user_id, sessions.created_at,
                           sessions.last_seen_at, sessions.idle_expires_at,
                           sessions.absolute_expires_at, sessions.revoked_at,
                           sessions.remember_me, sessions.active_role,
                           sessions.active_role_organization_id,
                           account.ho_ten AS user_name,
                           account.ten_dang_nhap AS username,
                           account.email, account.vai_tro AS platform_role,
                           account.trang_thai AS account_status
                      FROM auth_sessions sessions{joins}{where_sql}
                     ORDER BY {_SESSION_SORT_COLUMNS[sort_by]} {sort_direction.upper()},
                              sessions.id ASC
                     LIMIT ? OFFSET ?""",
                (*values, page_size, (page - 1) * page_size),
            )
            rows = cursor.fetchall()
        finally:
            connection.close()

        return _response(
            {
                "items": [
                    {
                        "sessionId": row["id"],
                        "user": {
                            "id": row["user_id"],
                            "name": row["user_name"],
                            "username": row["username"],
                            "email": row["email"],
                            "platformRole": row["platform_role"],
                            "status": row["account_status"],
                        },
                        "status": _session_status(row, now),
                        "createdAt": _json_value(row["created_at"]),
                        "lastSeenAt": _json_value(row["last_seen_at"]),
                        "idleExpiresAt": _json_value(row["idle_expires_at"]),
                        "absoluteExpiresAt": _json_value(row["absolute_expires_at"]),
                        "revokedAt": _json_value(row["revoked_at"]),
                        "rememberMe": bool(row["remember_me"]),
                        "activeRole": row["active_role"],
                        "activeRoleOrganizationId": row["active_role_organization_id"],
                    }
                    for row in rows
                ],
                "pagination": _pagination(page, page_size, total_rows),
                "sort": {"by": sort_by, "direction": sort_direction},
                "filters": {"search": search, "status": status, "userId": user_id},
            }
        )
    except _InvalidDirectoryQuery as exc:
        return _response({"error": str(exc)}, status_code=400)
    except Exception as exc:  # noqa: BLE001 - internal database details stay private.
        log_error(exc, "list_platform_admin_sessions")
        return _response({"error": "Đã xảy ra lỗi tải danh sách phiên."}, status_code=500)


async def list_admin_audit_api(request):
    try:
        return await run_database_read(_list_admin_audit_sync, request)
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        response = _response({"error": "Hệ thống đang bận. Vui lòng thử lại sau."}, status_code=503)
        response.headers["Retry-After"] = "1"
        return response


async def list_admin_sessions_api(request):
    try:
        return await run_database_read(_list_admin_sessions_sync, request)
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        response = _response({"error": "Hệ thống đang bận. Vui lòng thử lại sau."}, status_code=503)
        response.headers["Retry-After"] = "1"
        return response


def platform_admin_security_routes(Route):
    return [
        Route("/api/admin/audit", list_admin_audit_api, methods=["GET"]),
        Route("/api/admin/security/sessions", list_admin_sessions_api, methods=["GET"]),
    ]
