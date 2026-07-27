"""Authenticated, tenant-scoped read endpoint for the current sync cursor."""

from __future__ import annotations

import time

from backend.db.db_helper import DatabaseError


from starlette.responses import JSONResponse

from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError
from backend.shared.database_io import run_database_read
from backend.shared.helpers import (
    OrgPermissionError,
    database,
    get_active_org,
    verify_session,
)
from backend.shared.logging_utils import error_response, log_and_error
from backend.observability.recording import record_database_phase
from backend.sync.repository import get_current_sync_version


_READ_TIMEOUT_SECONDS = 5.0


def _database_read_unavailable(request, code: str, message: str):
    response = error_response(request, code, message, status_code=503)
    response.headers.update({"Cache-Control": "no-store", "Retry-After": "1"})
    return response


async def current_sync_version_api(request):
    """Return the active workspace cursor without allocating a new version."""
    try:
        return await run_database_read(
            _read_current_sync_version,
            request,
            timeout_seconds=_READ_TIMEOUT_SECONDS,
        )
    except BlockingIOBusyError:
        return _database_read_unavailable(
            request,
            "DATABASE_READ_QUEUE_FULL",
            "Hệ thống đang xử lý quá nhiều truy vấn. Vui lòng thử lại.",
        )
    except BlockingIOTimeoutError:
        return _database_read_unavailable(
            request,
            "DATABASE_READ_TIMEOUT",
            "Truy vấn dữ liệu vượt quá thời gian cho phép. Vui lòng thử lại.",
        )
    except Exception as error:
        return log_and_error(
            request,
            error,
            "current_sync_version_api",
            "SYNC_VERSION_READ_FAILED",
            "Không thể đọc phiên bản đồng bộ hiện tại.",
        )


def _read_current_sync_version(request):
    connection = None
    try:
        is_valid, role_or_error = verify_session(request)
        if not is_valid:
            return error_response(
                request,
                "SESSION_INVALID",
                str(role_or_error),
                status_code=403,
            )

        organization_id = get_active_org(request, role_or_error.user_id)
        connection = database.get_connection()
        cursor = connection.cursor()
        sync_version = get_current_sync_version(cursor, organization_id)
        json_started_at = time.perf_counter()
        try:
            return JSONResponse(
                {"syncVersion": sync_version},
                headers={"Cache-Control": "private, no-store"},
            )
        finally:
            record_database_phase(
                "sync",
                "json_serialize",
                time.perf_counter() - json_started_at,
            )
    except OrgPermissionError:
        return error_response(
            request,
            "ORG_ACCESS_DENIED",
            "Không có quyền truy cập tổ chức này.",
            status_code=403,
        )
    finally:
        if connection is not None:
            try:
                connection.close()
            except DatabaseError:
                pass
