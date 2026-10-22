"""Platform-admin API to maintain the public-holiday calendar."""

from __future__ import annotations

import json

from starlette.responses import JSONResponse

from backend.holidays.store import (
    HolidayValidationError,
    calendar_coverage,
    load_holidays,
    save_holidays,
)
from backend.shared.async_io import (
    BlockingIOBusyError,
    BlockingIOTimeoutError,
    run_blocking_io,
)
from backend.shared.database_io import run_database_read, run_database_write
from backend.shared.helpers import verify_session
from backend.shared.logging_utils import log_audit, log_error
from backend.shared.request_validation import read_json_object


def _error(message, code, status):
    return JSONResponse(
        {"error": message, "code": code},
        status_code=status,
        headers={"Cache-Control": "private, no-store"},
    )


async def _authorize(request):
    """Super admin only; saving additionally requires a recent re-authentication
    (enforced by verify_session for every unsafe super-admin method)."""

    try:
        valid, session = await run_database_read(
            verify_session, request, "super_admin", timeout_seconds=5,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return None, _error("Không thể xác thực quyền quản trị lúc này.", "ADMIN_AUTH_UNAVAILABLE", 503)
    if not valid:
        return None, _error(str(session), "SUPER_ADMIN_REQUIRED", 403)
    return session, None


async def get_holidays_api(request):
    _session, rejection = await _authorize(request)
    if rejection:
        return rejection
    data = await run_blocking_io(load_holidays, timeout_seconds=5)
    return JSONResponse(
        {"calendar": data, "coverage": calendar_coverage(data)},
        headers={"Cache-Control": "private, no-store"},
    )


async def put_holidays_api(request):
    session, rejection = await _authorize(request)
    if rejection:
        return rejection
    body, json_error = await read_json_object(request)
    if json_error:
        return json_error
    calendar = body.get("calendar")
    try:
        before = await run_blocking_io(load_holidays, timeout_seconds=5)
        saved = await run_blocking_io(save_holidays, calendar, timeout_seconds=10)
    except HolidayValidationError as error:
        return _error(str(error), "HOLIDAYS_INVALID", 400)
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _error("Hệ thống đang bận. Vui lòng thử lại.", "HOLIDAYS_BUSY", 503)
    except OSError as error:
        log_error(error, "holidays_save")
        return _error("Không thể lưu lịch ngày nghỉ.", "HOLIDAYS_SAVE_FAILED", 500)
    changed_years = sorted(
        year for year in set(before) | set(saved)
        if json.dumps(before.get(year), sort_keys=True) != json.dumps(saved.get(year), sort_keys=True)
    )
    try:
        await run_database_write(
            log_audit,
            "platform.holidays_updated",
            actor_user_id=session.user_id,
            target_type="holiday_calendar",
            target_id="holidays.json",
            request=request,
            metadata={"changedYears": changed_years},
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError) as error:
        # The calendar is saved; never block the event loop for the audit row.
        log_error(error, "holidays_audit", level="WARN")
    return JSONResponse(
        {"calendar": saved, "coverage": calendar_coverage(saved), "changedYears": changed_years},
        headers={"Cache-Control": "private, no-store"},
    )


def holiday_admin_routes(Route):
    return [
        Route("/api/admin/holidays", get_holidays_api, methods=["GET"]),
        Route("/api/admin/holidays", put_holidays_api, methods=["POST"]),
    ]
