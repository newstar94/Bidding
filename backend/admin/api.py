"""HTTP adapters for platform administration reads."""

from __future__ import annotations

from starlette.responses import JSONResponse

from backend.admin.repository import AdminOverviewRepository
from backend.admin.service import AdminOverviewService
from backend.auth.auth_helper import verify_session
from backend.db.db_helper import database
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError
from backend.shared.database_io import run_database_read
from backend.shared.logging_utils import log_error


def _error(message: str, code: str, status_code: int) -> JSONResponse:
    return JSONResponse(
        {"error": message, "code": code},
        status_code=status_code,
        headers={"Cache-Control": "private, no-store"},
    )


def _read_overview() -> dict:
    connection = database.get_connection()
    try:
        repository = AdminOverviewRepository(connection.cursor())
        return AdminOverviewService(repository).build()
    finally:
        connection.close()


async def admin_overview_api(request):
    try:
        valid, session = await run_database_read(
            verify_session,
            request,
            "super_admin",
            timeout_seconds=5,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _error(
            "Không thể xác thực quyền quản trị lúc này.",
            "ADMIN_AUTH_UNAVAILABLE",
            503,
        )
    if not valid:
        return _error(str(session), "SUPER_ADMIN_REQUIRED", 403)

    try:
        payload = await run_database_read(_read_overview, timeout_seconds=10)
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _error(
            "Hệ thống đang bận tổng hợp dữ liệu quản trị.",
            "ADMIN_OVERVIEW_UNAVAILABLE",
            503,
        )
    except Exception as exc:  # noqa: BLE001 - keep internal query details private.
        log_error(exc, "admin_overview")
        return _error(
            "Không thể tổng hợp dữ liệu quản trị.",
            "ADMIN_OVERVIEW_FAILED",
            500,
        )
    return JSONResponse(
        payload,
        headers={"Cache-Control": "private, no-store"},
    )


def admin_routes(Route):
    return [Route("/api/admin/overview", admin_overview_api, methods=["GET"])]

