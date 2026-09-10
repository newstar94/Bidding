"""Bounded audit and session-security reads for platform administrators."""

# Dynamic SQL fragments in this module come only from fixed column maps and
# code-owned predicates; every request value remains a bound parameter.
# ruff: noqa: S608

from __future__ import annotations

import json
import re
import time
from datetime import date, datetime, timedelta, timezone

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
from backend.shared.logging_utils import redact_log_value


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
_AUDIT_RESULT_SQL = """CASE
    WHEN lower(audit.action) LIKE '%%failed%%'
      OR lower(audit.action) LIKE '%%denied%%'
      OR lower(audit.action) LIKE '%%rejected%%'
      OR lower(audit.action) LIKE '%%rate_limited%%'
      OR lower(audit.action) LIKE '%%blocked%%'
    THEN 'failure'
    WHEN lower(audit.action) LIKE '%%success%%'
      OR lower(audit.action) LIKE '%%succeeded%%'
      OR lower(audit.action) LIKE '%%completed%%'
    THEN 'success'
    ELSE 'unknown'
END"""
_SECURITY_EVENT_LIMIT = 80
_SECURITY_SECTION_ITEM_LIMIT = 6
_SECURITY_WINDOW_HOURS = 24
_AUDIT_DETAIL_KEYS = {
    "amount",
    "currency",
    "effectiveAt",
    "field",
    "operation",
    "ownerKind",
    "preservedData",
    "publicId",
    "reason",
    "remember",
    "revision",
    "stage",
    "status",
    "updated_fields",
}
_DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,128}$")


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


def _iso_date(value, label):
    normalized = str(value or "").strip()
    if not normalized:
        return ""
    if not _DATE_PATTERN.fullmatch(normalized):
        raise _InvalidDirectoryQuery(f"{label} không hợp lệ.")
    try:
        return date.fromisoformat(normalized).isoformat()
    except ValueError as exc:
        raise _InvalidDirectoryQuery(f"{label} không hợp lệ.") from exc


def _audit_metadata(value):
    try:
        payload = json.loads(value or "{}")
    except (TypeError, ValueError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _safe_audit_scalar(value):
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return redact_log_value(value)[:500]
    if isinstance(value, list):
        return [_safe_audit_scalar(item) for item in value[:20] if isinstance(item, (type(None), bool, int, float, str))]
    return None


def _audit_public_fields(row):
    metadata = _audit_metadata(row["metadata_json"])
    request_id = str(metadata.get("requestId") or "").strip()
    if not _REQUEST_ID_PATTERN.fullmatch(request_id):
        request_id = ""
    details = {
        key: _safe_audit_scalar(metadata[key])
        for key in sorted(_AUDIT_DETAIL_KEYS)
        if key in metadata and _safe_audit_scalar(metadata[key]) is not None
    }
    return request_id or None, details


def _audit_outcome(action, metadata):
    normalized_action = str(action or "").strip().lower()
    explicit = str(
        metadata.get("outcome")
        or metadata.get("result")
        or metadata.get("status")
        or ""
    ).strip().lower()
    if explicit in {"failure", "failed", "denied", "rejected", "blocked", "error"}:
        return "failure"
    if explicit in {"success", "succeeded", "completed", "verified", "settled"}:
        return "success"
    if any(token in normalized_action for token in (
        "failed", "denied", "rejected", "rate_limited", "blocked",
    )):
        return "failure"
    if any(token in normalized_action for token in ("success", "succeeded", "completed")):
        return "success"
    return "unknown"


def _security_sections(action):
    normalized = str(action or "").strip().lower()
    sections = []
    if "login_failed" in normalized or "reauth_failed" in normalized:
        sections.append("failedLogins")
    if any(token in normalized for token in ("suspicious", "rate_limited", "blocked")):
        sections.append("suspiciousEvents")
    if any(token in normalized for token in ("denied", "rejected", "forbidden", "access_denied")):
        sections.append("authorizationDenies")
    if normalized.startswith("admin."):
        sections.append("adminActions")
    return sections


def _security_event(row):
    metadata = _audit_metadata(row["metadata_json"])
    request_id, details = _audit_public_fields(row)
    return {
        "id": row["id"],
        "actorUserId": row["actor_user_id"],
        "organizationId": row["organization_id"],
        "action": row["action"],
        "targetType": row["target_type"],
        "targetId": row["target_id"],
        "createdAt": _json_value(row["created_at"]),
        "outcome": _audit_outcome(row["action"], metadata),
        "requestId": request_id,
        "details": details,
    }


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
            allowed_filters={
                "action", "targetType", "actorUserId", "organizationId",
                "from", "to", "result", "requestId",
            },
        )
        if "sortDir" not in request.query_params:
            sort_direction = "desc"
        action = _bounded_identifier(request.query_params.get("action"), "Hành động", maximum=120)
        target_type = _bounded_identifier(request.query_params.get("targetType"), "Loại đối tượng", maximum=120)
        actor_user_id = _bounded_identifier(request.query_params.get("actorUserId"), "Người thực hiện")
        organization_id = _bounded_identifier(request.query_params.get("organizationId"), "Tổ chức")
        from_date = _iso_date(request.query_params.get("from"), "Ngày bắt đầu")
        to_date = _iso_date(request.query_params.get("to"), "Ngày kết thúc")
        if from_date and to_date and from_date > to_date:
            raise _InvalidDirectoryQuery("Ngày bắt đầu phải trước hoặc trùng ngày kết thúc.")
        result = str(request.query_params.get("result") or "").strip().lower()
        if result not in {"", "success", "failure", "unknown"}:
            raise _InvalidDirectoryQuery("Kết quả không hợp lệ.")
        request_id = _bounded_identifier(request.query_params.get("requestId"), "Request ID", maximum=128)
        if request_id and not _REQUEST_ID_PATTERN.fullmatch(request_id):
            raise _InvalidDirectoryQuery("Request ID không hợp lệ.")

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
        if from_date:
            predicates.append("audit.created_at >= ?")
            values.append(f"{from_date} 00:00:00")
        if to_date:
            next_day = date.fromisoformat(to_date) + timedelta(days=1)
            predicates.append("audit.created_at < ?")
            values.append(f"{next_day.isoformat()} 00:00:00")
        if result:
            predicates.append(f"({_AUDIT_RESULT_SQL}) = ?")
            values.append(result)
        if request_id:
            predicates.append("audit.metadata_json LIKE ?")
            values.append(f'%"requestId": "{request_id}"%')
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
                           audit.created_at, audit.metadata_json,
                           {_AUDIT_RESULT_SQL} AS result
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
                        "result": row["result"],
                        "requestId": public_fields[0],
                        "details": public_fields[1],
                    }
                    for row in rows
                    for public_fields in (_audit_public_fields(row),)
                ],
                "pagination": _pagination(page, page_size, total_rows),
                "sort": {"by": sort_by, "direction": sort_direction},
                "filters": {
                    "search": search,
                    "action": action,
                    "targetType": target_type,
                    "actorUserId": actor_user_id,
                    "organizationId": organization_id,
                    "from": from_date,
                    "to": to_date,
                    "result": result,
                    "requestId": request_id,
                },
            }
        )
    except _InvalidDirectoryQuery as exc:
        return _response({"error": str(exc)}, status_code=400)
    except Exception as exc:  # noqa: BLE001 - internal database details stay private.
        log_error(exc, "list_platform_admin_audit")
        return _response({"error": "Đã xảy ra lỗi tải nhật ký quản trị."}, status_code=500)


def _security_summary_sync(request):
    denied, _role = _forbidden_or_role(request)
    if denied:
        return denied
    since = datetime.now(timezone.utc) - timedelta(hours=_SECURITY_WINDOW_HOURS)
    since_value = since.strftime("%Y-%m-%d %H:%M:%S")
    try:
        connection = database.get_connection()
        try:
            cursor = connection.cursor()
            counts = cursor.execute(
                """SELECT
                    COUNT(*) FILTER (WHERE lower(action) LIKE '%%login_failed%%'
                        OR lower(action) LIKE '%%reauth_failed%%') AS failed_logins,
                    COUNT(*) FILTER (WHERE lower(action) LIKE '%%suspicious%%'
                        OR lower(action) LIKE '%%rate_limited%%'
                        OR lower(action) LIKE '%%blocked%%') AS suspicious_events,
                    COUNT(*) FILTER (WHERE lower(action) LIKE '%%denied%%'
                        OR lower(action) LIKE '%%rejected%%'
                        OR lower(action) LIKE '%%forbidden%%'
                        OR lower(action) LIKE '%%access_denied%%') AS authorization_denies,
                    COUNT(*) FILTER (WHERE lower(action) LIKE 'admin.%%') AS admin_actions
                   FROM audit_log
                  WHERE created_at >= ?""",
                (since_value,),
            ).fetchone()
            rows = cursor.execute(
                """SELECT id, actor_user_id, organization_id, action,
                          target_type, target_id, created_at, metadata_json
                     FROM audit_log
                    WHERE created_at >= ?
                      AND (lower(action) LIKE '%%login_failed%%'
                       OR lower(action) LIKE '%%reauth_failed%%'
                       OR lower(action) LIKE '%%suspicious%%'
                       OR lower(action) LIKE '%%rate_limited%%'
                       OR lower(action) LIKE '%%blocked%%'
                       OR lower(action) LIKE '%%denied%%'
                       OR lower(action) LIKE '%%rejected%%'
                       OR lower(action) LIKE '%%forbidden%%'
                       OR lower(action) LIKE '%%access_denied%%'
                       OR lower(action) LIKE 'admin.%%')
                    ORDER BY created_at DESC, id DESC
                    LIMIT ?""",
                (since_value, _SECURITY_EVENT_LIMIT),
            ).fetchall()
        finally:
            connection.close()

        sections = {
            "failedLogins": [],
            "suspiciousEvents": [],
            "authorizationDenies": [],
            "adminActions": [],
        }
        for row in rows:
            event = _security_event(row)
            for section in _security_sections(row["action"]):
                if len(sections[section]) < _SECURITY_SECTION_ITEM_LIMIT:
                    sections[section].append(event)
        return _response({
            "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "window": {"hours": _SECURITY_WINDOW_HOURS, "since": since.isoformat().replace("+00:00", "Z")},
            "counts": {
                "failedLogins": int(counts["failed_logins"]),
                "suspiciousEvents": int(counts["suspicious_events"]),
                "authorizationDenies": int(counts["authorization_denies"]),
                "adminActions": int(counts["admin_actions"]),
            },
            "sections": sections,
            "coverage": {
                "source": "audit_log",
                "failedLogins": "partial",
                "note": (
                    "Chỉ hiển thị sự kiện đăng nhập thất bại đã được ghi vào audit log; "
                    "log vận hành không được suy diễn thành dữ liệu audit."
                ),
            },
        })
    except Exception as exc:  # noqa: BLE001 - internal database details stay private.
        log_error(exc, "platform_admin_security_summary")
        return _response({"error": "Đã xảy ra lỗi tải trung tâm bảo mật."}, status_code=500)


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


async def admin_security_summary_api(request):
    try:
        return await run_database_read(_security_summary_sync, request)
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
        Route("/api/admin/security/summary", admin_security_summary_api, methods=["GET"]),
        Route("/api/admin/security/sessions", list_admin_sessions_api, methods=["GET"]),
    ]
