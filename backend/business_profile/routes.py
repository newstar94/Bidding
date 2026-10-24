"""Public read and Super Admin maintenance of the business profile (ADR 0095)."""

from __future__ import annotations

from starlette.responses import JSONResponse

from backend.business_profile.store import (
    PROFILE_FIELDS,
    PROFILE_KEYS,
    BusinessProfileValidationError,
    is_profile_configured,
    load_business_profile,
    save_business_profile,
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


def _payload(profile):
    return {
        "profile": profile,
        "configured": is_profile_configured(profile),
        "fields": [{"key": key, "label": label, "maxLength": limit} for key, label, limit in PROFILE_FIELDS],
    }


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


async def public_business_profile_api(request):
    try:
        profile = await run_blocking_io(load_business_profile, timeout_seconds=5)
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _error("Hệ thống đang bận. Vui lòng thử lại.", "BUSINESS_PROFILE_BUSY", 503)
    # Cache lifetime comes from SecurityHeadersMiddleware reference-data rules.
    return JSONResponse({"profile": profile, "configured": is_profile_configured(profile)})


async def get_business_profile_api(request):
    _session, rejection = await _authorize(request)
    if rejection:
        return rejection
    profile = await run_blocking_io(load_business_profile, timeout_seconds=5)
    return JSONResponse(_payload(profile), headers={"Cache-Control": "private, no-store"})


async def put_business_profile_api(request):
    session, rejection = await _authorize(request)
    if rejection:
        return rejection
    body, json_error = await read_json_object(request)
    if json_error:
        return json_error
    try:
        before = await run_blocking_io(load_business_profile, timeout_seconds=5)
        saved = await run_blocking_io(save_business_profile, body.get("profile"), timeout_seconds=10)
    except BusinessProfileValidationError as error:
        return _error(str(error), "BUSINESS_PROFILE_INVALID", 400)
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _error("Hệ thống đang bận. Vui lòng thử lại.", "BUSINESS_PROFILE_BUSY", 503)
    except OSError as error:
        log_error(error, "business_profile_save")
        return _error("Không thể lưu thông tin doanh nghiệp.", "BUSINESS_PROFILE_SAVE_FAILED", 500)
    changed_fields = [key for key in PROFILE_KEYS if before.get(key) != saved.get(key)]
    try:
        await run_database_write(
            log_audit,
            "platform.business_profile_updated",
            actor_user_id=session.user_id,
            target_type="business_profile",
            target_id="business_profile.json",
            request=request,
            metadata={"changedFields": changed_fields},
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError) as error:
        # The profile is saved; never block the event loop for the audit row.
        log_error(error, "business_profile_audit", level="WARN")
    return JSONResponse(
        {**_payload(saved), "changedFields": changed_fields},
        headers={"Cache-Control": "private, no-store"},
    )


def business_profile_routes(Route):
    return [
        Route("/api/public/business-profile", public_business_profile_api, methods=["GET"]),
        Route("/api/admin/business-profile", get_business_profile_api, methods=["GET"]),
        Route("/api/admin/business-profile", put_business_profile_api, methods=["POST"]),
    ]
