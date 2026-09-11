# Dynamic SQL fragments come only from fixed allowlists; request values stay bound.
# ruff: noqa: S608
import math
import re
import time

from starlette.responses import JSONResponse

from backend.admin.operational import _authorize, _utc_now
from backend.admin.platform_directory_routes import _json_value
from backend.auth.auth_helper import verify_session_in_transaction
from backend.db.db_helper import database
from backend.documents.document_job_policy import DocumentJobAuthorizationError
from backend.documents.document_worker import (
    DocumentWorkerError,
    retry_failed_durable_document_job,
)
from backend.observability.metrics import admin_sync_metrics_snapshot
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError
from backend.shared.database_io import run_database_read, run_database_write
from backend.shared.logging_utils import log_audit, log_error, redact_log_value


_PAGE_SIZES = {25, 50, 100}
_JOB_STATUSES = {"", "pending", "processing", "retry", "completed", "failed"}
_JOB_SORTS = {
    "created_at": "created_at",
    "updated_at": "updated_at",
    "available_at": "available_at",
    "status": "status",
    "attempt_count": "attempt_count",
}
_SYNC_STATUSES = {"", "pending", "retry", "dispatched", "dead_letter"}
_SYNC_EVENT_TYPES = {"", "broadcast", "revoke_user"}
_SYNC_SORTS = {
    "created_at": "created_at",
    "available_at": "available_at",
    "status": "status",
    "attempt_count": "attempt_count",
}
_JOB_ID = re.compile(r"^[a-f0-9]{32}$")
_WINDOWS_PATH = re.compile(r"(?i)(?:[a-z]:[\\/]|\\\\)[^\s,;]+")
_POSIX_PATH = re.compile(r"(?<![\w:])/(?:[^/\s]+/)*[^/\s,;]+")
_URL = re.compile(r"(?i)\b(?:https?|file)://[^\s,;]+")
_CONTROL_CHARACTERS = re.compile(r"[\x00-\x1f\x7f]+")


class _InvalidQuery(ValueError):
    pass


class _AdminRetryAuthorizationError(PermissionError):
    pass


def _error(message, code, status):
    return JSONResponse(
        {"error": message, "code": code},
        status_code=status,
        headers={"Cache-Control": "private, no-store"},
    )


def _params(request, *, allowed, sorts, default_sort="created_at"):
    unknown = set(request.query_params.keys()) - allowed
    if unknown:
        raise _InvalidQuery("Tham số truy vấn không được hỗ trợ.")
    try:
        page = int(request.query_params.get("page") or 1)
        page_size = int(request.query_params.get("pageSize") or 25)
    except (TypeError, ValueError) as exc:
        raise _InvalidQuery("Phân trang không hợp lệ.") from exc
    if page < 1 or page_size not in _PAGE_SIZES:
        raise _InvalidQuery("Phân trang không hợp lệ.")
    sort_by = str(request.query_params.get("sortBy") or default_sort).strip()
    sort_dir = str(request.query_params.get("sortDir") or "desc").strip().lower()
    if sort_by not in sorts or sort_dir not in {"asc", "desc"}:
        raise _InvalidQuery("Sắp xếp không hợp lệ.")
    return page, page_size, sort_by, sort_dir


def _pagination(page, page_size, total):
    return {
        "page": page,
        "pageSize": page_size,
        "totalRows": total,
        "totalPages": max(1, math.ceil(total / page_size)),
    }


def _job_id(request):
    value = str(request.path_params.get("job_id") or "").strip().lower()
    if not _JOB_ID.fullmatch(value):
        raise _InvalidQuery("Định danh tác vụ không hợp lệ.")
    return value


def _safe_job_error(value):
    message = redact_log_value(value)
    message = _URL.sub("[REDACTED_URL]", message)
    message = _WINDOWS_PATH.sub("[REDACTED_PATH]", message)
    message = _POSIX_PATH.sub("[REDACTED_PATH]", message)
    message = _CONTROL_CHARACTERS.sub(" ", message)
    return " ".join(message.split())[:500] or None


def _job_detail_payload(row):
    status = str(row["status"] or "")
    return {
        "generatedAt": _utc_now(),
        "job": {
            "id": row["id"],
            "organizationId": row["organization_id"],
            "operation": row["operation"],
            "recordType": row["record_type"],
            "status": status,
            "attemptCount": int(row["attempt_count"] or 0),
            "availableAt": _json_value(row["available_at"]),
            "createdAt": _json_value(row["created_at"]),
            "updatedAt": _json_value(row["updated_at"]),
            "completedAt": _json_value(row["completed_at"]),
            "cancelledAt": _json_value(row["cancelled_at"]),
            "expiresAt": _json_value(row["expires_at"]),
            "progress": {
                "phase": row["progress_phase"],
                "completedItems": int(row["progress_completed_items"] or 0),
                "totalItems": max(1, int(row["progress_total_items"] or 1)),
            },
            "error": {
                "code": row["last_error_code"],
                "message": _safe_job_error(row["last_error_message"]),
            },
            "retryAllowed": status == "failed" and row["cancelled_at"] is None,
        },
    }


def _read_job_detail(job_id):
    connection = database.get_connection()
    try:
        row = connection.cursor().execute(
            """SELECT id, organization_id, operation, record_type, status,
                      attempt_count, available_at, created_at, updated_at,
                      completed_at, cancelled_at, expires_at,
                      progress_phase, progress_completed_items,
                      progress_total_items, last_error_code, last_error_message
                 FROM document_jobs WHERE id = ? LIMIT 1""",
            (job_id,),
        ).fetchone()
        return _job_detail_payload(row) if row is not None else None
    finally:
        connection.close()


def _retry_job_as_admin(request, job_id):
    def authorize_retry(cursor):
        valid, actor = verify_session_in_transaction(
            cursor, request, required_role="super_admin"
        )
        if not valid:
            raise _AdminRetryAuthorizationError(str(actor))
        return actor

    def audit_retry(cursor, job, actor):
        log_audit(
            "admin.document_job_retried",
            actor_user_id=actor.user_id,
            organization_id=job["organization_id"],
            target_type="document_job",
            target_id=job_id,
            request=request,
            metadata={
                "operation": job["operation"],
                "recordType": job["record_type"],
                "lastErrorCode": job["last_error_code"],
            },
            cursor=cursor,
            required=True,
        )

    return retry_failed_durable_document_job(
        database,
        job_id,
        authorize_retry=authorize_retry,
        audit_retry=audit_retry,
    )


def _read_jobs(request):
    page, page_size, sort_by, sort_dir = _params(
        request,
        allowed={"page", "pageSize", "status", "operation", "sortBy", "sortDir"},
        sorts=_JOB_SORTS,
    )
    status = str(request.query_params.get("status") or "").strip().lower()
    operation = str(request.query_params.get("operation") or "").strip()
    if status not in _JOB_STATUSES:
        raise _InvalidQuery("Trạng thái tác vụ không hợp lệ.")
    if len(operation) > 100:
        raise _InvalidQuery("Loại tác vụ không hợp lệ.")
    where = []
    values = []
    if status:
        where.append("status = ?")
        values.append(status)
    if operation:
        where.append("operation = ?")
        values.append(operation)
    where_sql = f" WHERE {' AND '.join(where)}" if where else ""
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        cursor.execute(
            "SELECT status, COUNT(*) AS count FROM document_jobs GROUP BY status ORDER BY status"
        )
        counts = {str(row["status"]): int(row["count"]) for row in cursor.fetchall()}
        cursor.execute(
            f"SELECT COUNT(*) AS total FROM document_jobs{where_sql}", tuple(values)
        )
        total = int(cursor.fetchone()["total"])
        cursor.execute(
            f"""SELECT id, organization_id, operation, record_type, status,
                       attempt_count, available_at, created_at, updated_at,
                       completed_at, cancelled_at, expires_at,
                       progress_phase, progress_completed_items,
                       progress_total_items, last_error_code
                  FROM document_jobs{where_sql}
                 ORDER BY {_JOB_SORTS[sort_by]} {sort_dir.upper()}, id
                 LIMIT ? OFFSET ?""",
            (*values, page_size, (page - 1) * page_size),
        )
        rows = cursor.fetchall()
    finally:
        connection.close()
    return {
        "generatedAt": _utc_now(),
        "summary": {"total": sum(counts.values()), "byStatus": counts},
        "items": [
            {
                "id": row["id"],
                "organizationId": row["organization_id"],
                "operation": row["operation"],
                "recordType": row["record_type"],
                "status": row["status"],
                "attemptCount": int(row["attempt_count"] or 0),
                "availableAt": _json_value(row["available_at"]),
                "createdAt": _json_value(row["created_at"]),
                "updatedAt": _json_value(row["updated_at"]),
                "completedAt": _json_value(row["completed_at"]),
                "cancelledAt": _json_value(row["cancelled_at"]),
                "expiresAt": _json_value(row["expires_at"]),
                "progress": {
                    "phase": row["progress_phase"],
                    "completedItems": int(row["progress_completed_items"] or 0),
                    "totalItems": int(row["progress_total_items"] or 1),
                },
                "lastErrorCode": row["last_error_code"],
            }
            for row in rows
        ],
        "pagination": _pagination(page, page_size, total),
        "sort": {"by": sort_by, "direction": sort_dir},
        "filters": {"status": status, "operation": operation},
    }


async def admin_system_jobs_api(request):
    authorization_error = await _authorize(request)
    if authorization_error:
        return authorization_error
    try:
        payload = await run_database_read(_read_jobs, request, timeout_seconds=10)
        return JSONResponse(payload, headers={"Cache-Control": "private, no-store"})
    except _InvalidQuery as exc:
        return _error(str(exc), "ADMIN_QUERY_INVALID", 400)
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _error("Hệ thống đang bận. Vui lòng thử lại sau.", "ADMIN_JOBS_UNAVAILABLE", 503)
    except Exception as exc:  # noqa: BLE001 - keep database details private.
        log_error(exc, "admin_system_jobs")
        return _error("Không thể tải trạng thái tác vụ.", "ADMIN_JOBS_FAILED", 500)


async def admin_system_job_detail_api(request):
    authorization_error = await _authorize(request)
    if authorization_error:
        return authorization_error
    try:
        payload = await run_database_read(
            _read_job_detail, _job_id(request), timeout_seconds=10
        )
        if payload is None:
            return _error("Không tìm thấy tác vụ.", "ADMIN_JOB_NOT_FOUND", 404)
        return JSONResponse(payload, headers={"Cache-Control": "private, no-store"})
    except _InvalidQuery as exc:
        return _error(str(exc), "ADMIN_QUERY_INVALID", 400)
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _error(
            "Hệ thống đang bận. Vui lòng thử lại sau.",
            "ADMIN_JOB_UNAVAILABLE",
            503,
        )
    except Exception as exc:  # noqa: BLE001 - keep database details private.
        log_error(exc, "admin_system_job_detail")
        return _error(
            "Không thể tải chi tiết tác vụ.", "ADMIN_JOB_DETAIL_FAILED", 500
        )


async def admin_system_job_retry_api(request):
    authorization_error = await _authorize(request)
    if authorization_error:
        return authorization_error
    try:
        job_id = _job_id(request)
        retried = await run_database_write(
            _retry_job_as_admin,
            request,
            job_id,
            timeout_seconds=10,
        )
        if not retried:
            return _error(
                "Trạng thái tác vụ đã thay đổi. Hãy tải lại danh sách.",
                "ADMIN_JOB_RETRY_CONFLICT",
                409,
            )
        return JSONResponse(
            {"jobId": job_id, "status": "retry"},
            status_code=202,
            headers={"Cache-Control": "private, no-store"},
        )
    except _InvalidQuery as exc:
        return _error(str(exc), "ADMIN_QUERY_INVALID", 400)
    except _AdminRetryAuthorizationError as exc:
        return _error(str(exc), "SUPER_ADMIN_REQUIRED", 403)
    except DocumentJobAuthorizationError:
        return _error(
            "Quyền xuất tài liệu hoặc phạm vi bản ghi của tác vụ không còn hợp lệ.",
            "ADMIN_JOB_RETRY_AUTHORITY_CHANGED",
            409,
        )
    except DocumentWorkerError:
        return _error(
            "Không còn dữ liệu đầu vào hợp lệ để chạy lại tác vụ.",
            "ADMIN_JOB_RETRY_INPUT_UNAVAILABLE",
            409,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _error(
            "Hệ thống đang bận. Vui lòng thử lại sau.",
            "ADMIN_JOB_UNAVAILABLE",
            503,
        )
    except Exception as exc:  # noqa: BLE001 - keep worker details private.
        log_error(exc, "admin_system_job_retry")
        return _error("Không thể chạy lại tác vụ.", "ADMIN_JOB_RETRY_FAILED", 500)


def _read_sync(request):
    page, page_size, sort_by, sort_dir = _params(
        request,
        allowed={"page", "pageSize", "status", "eventType", "sortBy", "sortDir"},
        sorts=_SYNC_SORTS,
    )
    status = str(request.query_params.get("status") or "").strip().lower()
    event_type = str(request.query_params.get("eventType") or "").strip().lower()
    if status not in _SYNC_STATUSES:
        raise _InvalidQuery("Trạng thái đồng bộ không hợp lệ.")
    if event_type not in _SYNC_EVENT_TYPES:
        raise _InvalidQuery("Loại sự kiện đồng bộ không hợp lệ.")
    where = []
    values = []
    if status:
        where.append("status = ?")
        values.append(status)
    if event_type:
        where.append("event_type = ?")
        values.append(event_type)
    where_sql = f" WHERE {' AND '.join(where)}" if where else ""
    now = int(time.time())
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        cursor.execute(
            "SELECT status, COUNT(*) AS count FROM websocket_events GROUP BY status ORDER BY status"
        )
        event_counts = {str(row["status"]): int(row["count"]) for row in cursor.fetchall()}
        cursor.execute(
            "SELECT COUNT(*) AS count FROM websocket_connection_leases WHERE expires_at > ?",
            (now,),
        )
        active_connections = int(cursor.fetchone()["count"])
        cursor.execute("SELECT COUNT(*) AS count FROM sync_mutations")
        recorded_mutations = int(cursor.fetchone()["count"])
        sync_metrics = admin_sync_metrics_snapshot()
        cursor.execute(
            f"SELECT COUNT(*) AS total FROM websocket_events{where_sql}", tuple(values)
        )
        total = int(cursor.fetchone()["total"])
        cursor.execute(
            f"""SELECT id, organization_id, event_type, status, attempt_count,
                       available_at, created_at, dispatched_at, delivered_at,
                       last_error_code
                  FROM websocket_events{where_sql}
                 ORDER BY {_SYNC_SORTS[sort_by]} {sort_dir.upper()}, id
                 LIMIT ? OFFSET ?""",
            (*values, page_size, (page - 1) * page_size),
        )
        rows = cursor.fetchall()
    finally:
        connection.close()
    return {
        "generatedAt": _utc_now(),
        "summary": {
            "eventsTotal": sum(event_counts.values()),
            "eventsByStatus": event_counts,
            "activeConnections": active_connections,
            "recordedMutations": recorded_mutations,
            "syncRequests": sync_metrics["syncRequests"],
            "failedSyncs": sync_metrics["failedSyncs"],
            "rowVersionConflicts": None,
            "visibilityResets": None,
            "fullSyncs": sync_metrics["fullSyncRequests"],
            "outboxFailures": int(event_counts.get("retry", 0)) + int(event_counts.get("dead_letter", 0)),
            "metricsScope": sync_metrics["scope"],
        },
        "items": [
            {
                "id": int(row["id"]),
                "organizationId": row["organization_id"],
                "eventType": row["event_type"],
                "status": row["status"],
                "attemptCount": int(row["attempt_count"] or 0),
                "availableAt": _json_value(row["available_at"]),
                "createdAt": _json_value(row["created_at"]),
                "dispatchedAt": _json_value(row["dispatched_at"]),
                "deliveredAt": _json_value(row["delivered_at"]),
                "lastErrorCode": row["last_error_code"],
            }
            for row in rows
        ],
        "pagination": _pagination(page, page_size, total),
        "sort": {"by": sort_by, "direction": sort_dir},
        "filters": {"status": status, "eventType": event_type},
    }


async def admin_system_sync_api(request):
    authorization_error = await _authorize(request)
    if authorization_error:
        return authorization_error
    try:
        payload = await run_database_read(_read_sync, request, timeout_seconds=10)
        return JSONResponse(payload, headers={"Cache-Control": "private, no-store"})
    except _InvalidQuery as exc:
        return _error(str(exc), "ADMIN_QUERY_INVALID", 400)
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _error("Hệ thống đang bận. Vui lòng thử lại sau.", "ADMIN_SYNC_UNAVAILABLE", 503)
    except Exception as exc:  # noqa: BLE001 - keep database details private.
        log_error(exc, "admin_system_sync")
        return _error("Không thể tải trạng thái đồng bộ.", "ADMIN_SYNC_FAILED", 500)


def platform_admin_system_routes(Route):
    return [
        Route("/api/admin/system/jobs", admin_system_jobs_api, methods=["GET"]),
        Route(
            "/api/admin/system/jobs/{job_id}",
            admin_system_job_detail_api,
            methods=["GET"],
        ),
        Route(
            "/api/admin/system/jobs/{job_id}/retry",
            admin_system_job_retry_api,
            methods=["POST"],
        ),
        Route("/api/admin/system/sync", admin_system_sync_api, methods=["GET"]),
    ]
