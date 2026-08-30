"""Super Admin aggregate dashboard and minimal commercial intent collector."""

from __future__ import annotations

from datetime import date, timedelta
import os

from starlette.responses import JSONResponse

from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError
from backend.shared.database_io import run_database_read, run_database_write
from backend.shared.helpers import database, get_active_org, verify_session
from backend.shared.logging_utils import log_error
from backend.shared.request_validation import read_json_object

from .aggregation import refresh_product_analytics
from .events import (
    AnalyticsEventError,
    insert_commercial_event,
    insert_commercial_feedback,
    normalize_commercial_event,
    normalize_commercial_feedback,
)
from .query_service import build_dashboard


def _error(message, code, status=400):
    return JSONResponse({"error": message, "code": code}, status_code=status, headers={"Cache-Control": "no-store"})


async def commercial_analytics_event_api(request):
    valid, session = await run_database_read(verify_session, request, timeout_seconds=5)
    if not valid:
        return _error(str(session), "SESSION_REQUIRED", 403)
    payload, json_error = await read_json_object(request)
    if json_error:
        return json_error
    hmac_key = os.environ.get("ANALYTICS_HMAC_KEY", "")
    if len(hmac_key) < 16:
        # Collector is best-effort: do not make a storefront action fail when
        # analytics secret/configuration is intentionally absent in dev.
        return JSONResponse({"accepted": True, "recorded": False}, status_code=202)
    try:
        connection = database.get_connection()
        try:
            organization_id = get_active_org(request, session.user_id, cursor=connection.cursor())
            owner_kind = "account" if str(organization_id).startswith("personal:") else "organization"
            event = normalize_commercial_event(
                {**payload, "ownerKind": owner_kind},
                user_id=session.user_id,
                workspace_id=organization_id,
                hmac_key=hmac_key,
            )
            connection.execute("BEGIN")
            inserted = insert_commercial_event(connection.cursor(), event)
            connection.commit()
        finally:
            connection.close()
    except AnalyticsEventError as exc:
        return _error(str(exc), "ANALYTICS_EVENT_INVALID", 400)
    except Exception as exc:  # noqa: BLE001 - telemetry never blocks commerce.
        log_error(exc, "commercial_analytics_event", level="WARN")
        return JSONResponse({"accepted": True, "recorded": False}, status_code=202)
    return JSONResponse({"accepted": True, "recorded": inserted}, status_code=202)


async def commercial_analytics_feedback_api(request):
    valid, session = await run_database_read(verify_session, request, timeout_seconds=5)
    if not valid:
        return _error(str(session), "SESSION_REQUIRED", 403)
    payload, json_error = await read_json_object(request)
    if json_error:
        return json_error
    hmac_key = os.environ.get("ANALYTICS_HMAC_KEY", "")
    if len(hmac_key) < 16:
        return JSONResponse({"accepted": True, "recorded": False}, status_code=202)
    try:
        connection = database.get_connection()
        try:
            workspace_id = get_active_org(request, session.user_id, cursor=connection.cursor())
            owner_kind = "account" if str(workspace_id).startswith("personal:") else "organization"
            feedback = normalize_commercial_feedback(
                {**payload, "ownerKind": owner_kind}, workspace_id=workspace_id, hmac_key=hmac_key,
            )
            connection.execute("BEGIN")
            inserted = insert_commercial_feedback(connection.cursor(), feedback)
            connection.commit()
        finally:
            connection.close()
    except AnalyticsEventError as exc:
        return _error(str(exc), "COMMERCIAL_FEEDBACK_INVALID", 400)
    except Exception as exc:  # noqa: BLE001 - optional feedback never blocks commerce.
        log_error(exc, "commercial_analytics_feedback", level="WARN")
        return JSONResponse({"accepted": True, "recorded": False}, status_code=202)
    return JSONResponse({"accepted": True, "recorded": inserted}, status_code=202)


def _dashboard_read(filters):
    connection = database.get_connection()
    try:
        return build_dashboard(connection.cursor(), **filters)
    finally:
        connection.close()


async def commercial_analytics_dashboard_api(request):
    try:
        valid, session = await run_database_read(verify_session, request, "super_admin", timeout_seconds=5)
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _error("Không thể xác thực quyền xem analytics lúc này.", "ANALYTICS_AUTH_UNAVAILABLE", 503)
    if not valid:
        return _error(str(session), "SUPER_ADMIN_REQUIRED", 403)
    del session
    params = request.query_params
    today = date.today()
    default_start = today - timedelta(days=29)
    from_date = str(params.get("from") or default_start.isoformat())
    to_date = str(params.get("to") or today.isoformat())
    filters = {
        "ownerKind": params.get("ownerKind"), "variant": params.get("variant"),
        "sizeBucket": params.get("sizeBucket"), "releaseId": params.get("releaseId"),
        "releaseMode": params.get("releaseMode"),
        "plan": params.get("plan"), "paidState": params.get("paidState"),
        "cohortKind": params.get("cohortKind"),
        "procurementIntensity": params.get("procurementIntensity"),
        "collaborationIntensity": params.get("collaborationIntensity"),
        "aiAdoption": params.get("aiAdoption"),
    }
    try:
        page = int(params.get("page") or 1)
        page_size = int(params.get("pageSize") or 50)
        payload = await run_database_read(
            _dashboard_read,
            {"from_date": from_date, "to_date": to_date, "view": params.get("view", "overview"),
             "filters": filters, "page": page, "page_size": page_size},
            timeout_seconds=15,
        )
    except (ValueError, BlockingIOBusyError, BlockingIOTimeoutError) as exc:
        code = "ANALYTICS_RANGE_INVALID" if isinstance(exc, ValueError) else "ANALYTICS_UNAVAILABLE"
        return _error(str(exc), code, 400 if isinstance(exc, ValueError) else 503)
    except Exception as exc:  # noqa: BLE001
        log_error(exc, "commercial_analytics_dashboard")
        return _error("Không thể tổng hợp analytics.", "ANALYTICS_FAILED", 500)
    return JSONResponse({"dashboard": payload}, headers={"Cache-Control": "private, max-age=30"})


def _refresh_write(from_date, to_date):
    connection = database.get_connection()
    try:
        connection.execute("BEGIN")
        result = refresh_product_analytics(
            connection.cursor(),
            from_date=from_date,
            to_date=to_date,
            hmac_key=os.environ.get("ANALYTICS_HMAC_KEY", ""),
        )
        connection.commit()
        return result
    finally:
        connection.close()


async def refresh_product_analytics_api(request):
    valid, session = await run_database_read(verify_session, request, "super_admin", timeout_seconds=5)
    if not valid:
        return _error(str(session), "SUPER_ADMIN_REQUIRED", 403)
    del session
    try:
        end = date.today()
        start = end - timedelta(days=90)
        result = await run_database_write(_refresh_write, start.isoformat(), end.isoformat())
    except Exception as exc:  # noqa: BLE001
        log_error(exc, "commercial_analytics_refresh")
        return _error("Không thể làm mới analytics.", "ANALYTICS_REFRESH_FAILED", 500)
    return JSONResponse({"accepted": True, "refresh": result}, status_code=202)


def product_analytics_routes(Route):
    return [
        Route("/api/commercial-analytics/events", commercial_analytics_event_api, methods=["POST"]),
        Route("/api/commercial-analytics/feedback", commercial_analytics_feedback_api, methods=["POST"]),
        Route("/api/admin/product-analytics/dashboard", commercial_analytics_dashboard_api, methods=["GET"]),
        Route("/api/admin/product-analytics/refresh", refresh_product_analytics_api, methods=["POST"]),
    ]
