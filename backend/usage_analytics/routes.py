"""Authenticated collection and Super Admin product-usage reporting routes."""

from __future__ import annotations

from collections import OrderedDict, deque
import threading
import time

from starlette.responses import JSONResponse

from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError
from backend.shared.database_io import run_database_read, run_database_write
from backend.shared.helpers import (
    OrgPermissionError,
    database,
    get_active_org,
    verify_session,
)
from backend.shared.logging_utils import log_error
from backend.shared.request_validation import read_json_object
from backend.usage_analytics.service import (
    CLIENT_EVENT_TYPES,
    FEATURE_KEYS,
    UsageAnalyticsInputError,
    build_usage_summary,
    parse_summary_window,
    record_client_event,
)


class _UsageAnalyticsRateLimiter:
    """Bound request memory and per-user telemetry pressure in each process."""

    def __init__(self, limit=120, window_seconds=60, max_keys=4_096):
        self.limit = max(1, int(limit))
        self.window_seconds = max(1, int(window_seconds))
        self.max_keys = max(16, int(max_keys))
        self._entries = OrderedDict()
        self._lock = threading.Lock()

    def allow(self, opaque_user_id, now=None):
        current = time.monotonic() if now is None else float(now)
        cutoff = current - self.window_seconds
        key = str(opaque_user_id)
        with self._lock:
            timestamps = self._entries.pop(key, deque())
            while timestamps and timestamps[0] <= cutoff:
                timestamps.popleft()
            allowed = len(timestamps) < self.limit
            if allowed:
                timestamps.append(current)
            self._entries[key] = timestamps
            while len(self._entries) > self.max_keys:
                self._entries.popitem(last=False)
        return allowed


_rate_limiter = _UsageAnalyticsRateLimiter()


def _error(message: str, code: str, status_code: int) -> JSONResponse:
    return JSONResponse(
        {"error": message, "code": code},
        status_code=status_code,
        headers={"Cache-Control": "no-store"},
    )


def _validate_event_payload(data: dict) -> tuple[str, str | None]:
    unknown = set(data) - {"eventType", "feature"}
    if unknown:
        raise UsageAnalyticsInputError("Telemetry không nhận trường ngoài contract.")
    event_type = data.get("eventType")
    if not isinstance(event_type, str) or event_type not in CLIENT_EVENT_TYPES:
        raise UsageAnalyticsInputError("eventType không được hỗ trợ.")
    feature = data.get("feature")
    if feature is not None and not isinstance(feature, str):
        raise UsageAnalyticsInputError("feature phải là chuỗi.")
    normalized_feature = str(feature or "").strip().lower() or None
    if event_type == "feature_used" and normalized_feature not in FEATURE_KEYS:
        raise UsageAnalyticsInputError("feature không thuộc danh mục được hỗ trợ.")
    if event_type == "heartbeat" and "feature" in data:
        raise UsageAnalyticsInputError("feature không thuộc danh mục được hỗ trợ.")
    return event_type, normalized_feature


def _write_event(request, session, event_type: str, feature: str | None) -> None:
    connection = database.get_connection()
    try:
        connection.execute("BEGIN")
        cursor = connection.cursor()
        organization_id = get_active_org(
            request,
            session.user_id,
            cursor=cursor,
        )
        record_client_event(
            cursor,
            event_type=event_type,
            user_id=session.user_id,
            organization_id=organization_id,
            feature=feature,
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


async def usage_analytics_event_api(request):
    try:
        valid, session = await run_database_read(
            verify_session,
            request,
            timeout_seconds=5,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _error(
            "Không thể xác thực telemetry lúc này.",
            "USAGE_ANALYTICS_AUTH_UNAVAILABLE",
            503,
        )
    if not valid:
        return _error(str(session), "SESSION_REQUIRED", 403)
    if not _rate_limiter.allow(session.user_id):
        return JSONResponse(
            {
                "error": "Quá nhiều sự kiện sử dụng.",
                "code": "USAGE_ANALYTICS_RATE_LIMITED",
            },
            status_code=429,
            headers={"Cache-Control": "no-store", "Retry-After": "60"},
        )
    data, json_error = await read_json_object(request)
    if json_error:
        return json_error
    try:
        event_type, feature = _validate_event_payload(data)
    except UsageAnalyticsInputError as exc:
        return _error(str(exc), "USAGE_ANALYTICS_EVENT_INVALID", 400)
    try:
        await run_database_write(
            _write_event,
            request,
            session,
            event_type,
            feature,
        )
    except OrgPermissionError as exc:
        # A platform-only Super Admin may have no workspace. Drop that signal
        # without stopping the browser tracker or weakening workspace checks.
        log_error(exc, "product_usage_event_workspace", level="WARN")
    except (BlockingIOBusyError, BlockingIOTimeoutError) as exc:
        # Collection is deliberately fail-open and never blocks navigation.
        log_error(exc, "product_usage_event_backpressure", level="WARN")
    except Exception as exc:  # noqa: BLE001 - product telemetry is best-effort.
        log_error(exc, "product_usage_event", level="WARN")
    return JSONResponse(
        {"accepted": True},
        status_code=202,
        headers={"Cache-Control": "no-store"},
    )


def _read_summary(window):
    connection = database.get_connection()
    try:
        return build_usage_summary(connection.cursor(), window)
    finally:
        connection.close()


async def usage_analytics_summary_api(request):
    try:
        valid, session = await run_database_read(
            verify_session,
            request,
            "super_admin",
            timeout_seconds=5,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _error(
            "Không thể xác thực quyền xem báo cáo lúc này.",
            "USAGE_ANALYTICS_AUTH_UNAVAILABLE",
            503,
        )
    if not valid:
        return _error(str(session), "SUPER_ADMIN_REQUIRED", 403)
    del session
    try:
        window = parse_summary_window(request.query_params)
    except UsageAnalyticsInputError as exc:
        return _error(str(exc), "USAGE_ANALYTICS_RANGE_INVALID", 400)
    try:
        summary = await run_database_read(
            _read_summary,
            window,
            timeout_seconds=15,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _error(
            "Hệ thống đang bận tổng hợp dữ liệu sử dụng.",
            "USAGE_ANALYTICS_SUMMARY_UNAVAILABLE",
            503,
        )
    except Exception as exc:  # noqa: BLE001 - response remains aggregate-only.
        log_error(exc, "product_usage_summary")
        return _error(
            "Không thể tổng hợp dữ liệu sử dụng.",
            "USAGE_ANALYTICS_SUMMARY_FAILED",
            500,
        )
    return JSONResponse(
        {"summary": summary},
        headers={"Cache-Control": "private, no-store"},
    )


def usage_analytics_routes(Route):
    return [
        Route(
            "/api/usage-analytics/events",
            usage_analytics_event_api,
            methods=["POST"],
        ),
        Route(
            "/api/admin/usage-analytics/summary",
            usage_analytics_summary_api,
            methods=["GET"],
        ),
    ]
