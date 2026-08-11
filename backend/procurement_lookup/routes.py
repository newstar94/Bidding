"""Authenticated HTTP adapter for on-demand procurement lookup."""

from __future__ import annotations

from threading import RLock

from starlette.responses import JSONResponse

from backend.auth.auth_service import get_client_ip, get_rate_limit_decision
from backend.integrations.muasamcong_browser.registry import (
    get_muasamcong_source,
)
from backend.procurement_lookup.domain import ProcurementLookupError
from backend.procurement_lookup.cache import PostgresProcurementLookupCache
from backend.procurement_lookup.config import ProcurementLookupSettings
from backend.procurement_lookup.service import ProcurementLookupService
from backend.shared.async_io import (
    BlockingIOBusyError,
    BlockingIOTimeoutError,
    run_blocking_io,
)
from backend.shared.helpers import database, get_active_org, verify_session
from backend.shared.logging_utils import (
    error_response,
    log_and_error,
    log_structured_event,
)
from backend.shared.request_validation import read_json_object


_REQUEST_FIELDS = {"code", "workspaceLease"}
_SERVICE_LOCK = RLock()
_SERVICE = None
_SERVICE_FINGERPRINT = None
_HEALTH_STATUSES = {
    "UP", "SESSION_DEGRADED", "API_CHANGED", "SCHEMA_CHANGED",
    "FRONTEND_CHANGED", "PARTIAL", "DOWN",
}
_HEALTH_FAILURES = {
    "PROCUREMENT_SESSION_FAILED", "PROCUREMENT_ENDPOINT_CHANGED",
    "PROCUREMENT_SCHEMA_CHANGED", "PROCUREMENT_UPSTREAM_UNAVAILABLE",
    "PROCUREMENT_TIMEOUT",
}


def _observe_lookup(event):
    log_structured_event(
        "procurement.lookup.completed",
        fields=event,
        nonblocking=True,
    )


def build_lookup_service():
    global _SERVICE, _SERVICE_FINGERPRINT
    config = ProcurementLookupSettings.from_environ()
    if not config.enabled:
        raise ProcurementLookupError("PROCUREMENT_LOOKUP_DISABLED")
    fingerprint = config.fingerprint
    with _SERVICE_LOCK:
        if _SERVICE is not None and _SERVICE_FINGERPRINT == fingerprint:
            return _SERVICE
        source = get_muasamcong_source()
        shared_cache = (
            PostgresProcurementLookupCache(database=database)
            if config.shared_cache_enabled
            else None
        )
        _SERVICE = ProcurementLookupService(
            source,
            ttl_seconds=config.ttl_seconds,
            ttl_by_kind=config.ttl_by_kind,
            shared_cache=shared_cache,
            coalesce_timeout_seconds=config.coalesce_timeout_seconds,
            observer=_observe_lookup,
        )
        _SERVICE_FINGERPRINT = fingerprint
    return _SERVICE


def _request_context(request, workspace_lease):
    valid, session = verify_session(request)
    if not valid:
        raise ProcurementLookupError("AUTHENTICATION_REQUIRED")
    connection = database.get_connection()
    try:
        organization_id = get_active_org(
            request, session.user_id, cursor=connection.cursor()
        )
    finally:
        connection.close()
    lease = str(workspace_lease or organization_id).strip()
    if lease != str(organization_id):
        raise ProcurementLookupError("ORGANIZATION_ACCESS_DENIED")
    return session, organization_id


def _enforce_rate_limit(request, user_id, organization_id):
    for bucket in (
        f"procurement:lookup:ip:{get_client_ip(request)}",
        f"procurement:lookup:user:{user_id}",
        f"procurement:lookup:org:{organization_id}",
    ):
        decision = get_rate_limit_decision(
            bucket, max_attempts=30, window_seconds=60
        )
        if not decision.allowed:
            raise ProcurementLookupError("PROCUREMENT_LOOKUP_RATE_LIMITED")


def _lookup_blocking(request, payload):
    session, organization_id = _request_context(
        request, payload.get("workspaceLease")
    )
    _enforce_rate_limit(request, session.user_id, organization_id)
    return build_lookup_service().lookup(payload.get("code"))


def _public_health(result):
    """Return a closed health contract so process-boundary secrets cannot leak."""

    result = result if isinstance(result, dict) else {}
    session = result.get("session") if isinstance(result.get("session"), dict) else {}
    api = result.get("api") if isinstance(result.get("api"), dict) else {}
    frontend = (
        result.get("frontend")
        if isinstance(result.get("frontend"), dict)
        else {}
    )
    status = str(result.get("status") or "DOWN")
    session_status = str(session.get("status") or "PARTIAL")
    api_status = str(api.get("status") or "PARTIAL")
    return {
        "profile": str(result.get("profile") or "unknown")[:32],
        "status": status if status in _HEALTH_STATUSES else "DOWN",
        "session": {
            "status": (
                session_status if session_status in _HEALTH_STATUSES else "PARTIAL"
            ),
            "cached": bool(session.get("cached")),
            "refreshing": bool(session.get("refreshing")),
            "refreshCount": max(0, int(session.get("refreshCount") or 0)),
            "browserStartupMs": max(
                0, int(float(session.get("browserStartupMs") or 0))
            ),
            "lastError": (
                session.get("lastError")
                if session.get("lastError") in _HEALTH_FAILURES
                else None
            ),
        },
        "api": {
            "status": api_status if api_status in _HEALTH_STATUSES else "PARTIAL",
            "circuitOpen": bool(api.get("circuitOpen")),
            "activeRequests": max(0, int(api.get("activeRequests") or 0)),
            "queuedRequests": max(0, int(api.get("queuedRequests") or 0)),
            "maxConcurrency": max(1, int(api.get("maxConcurrency") or 1)),
            "lastFailure": (
                api.get("lastFailure")
                if api.get("lastFailure") in _HEALTH_FAILURES
                else None
            ),
        },
        "frontend": {
            "status": (
                frontend.get("status")
                if frontend.get("status") in _HEALTH_STATUSES
                else "PARTIAL"
            ),
            "framework": str(frontend.get("framework") or "unknown")[:32],
            "driverCandidate": (
                str(frontend.get("driverCandidate"))[:32]
                if frontend.get("driverCandidate")
                else None
            ),
            "interactionRequired": bool(frontend.get("interactionRequired")),
            "capabilities": {
                key: bool((frontend.get("capabilities") or {}).get(key))
                for key in (
                    "protectedApi", "networkJson", "vue2", "vue3",
                    "react", "semanticDom", "genericSearchUi",
                )
            },
        },
    }


def _public_error(request, error):
    code = str(error)
    statuses = {
        "PROCUREMENT_CODE_INVALID": 400,
        "AUTHENTICATION_REQUIRED": 401,
        "ORGANIZATION_ACCESS_DENIED": 403,
        "PROCUREMENT_NOT_FOUND": 404,
        "PROCUREMENT_LOOKUP_RATE_LIMITED": 429,
        "PROCUREMENT_INTERACTION_REQUIRED": 409,
        "PROCUREMENT_TIMEOUT": 504,
        "PROCUREMENT_UPSTREAM_UNAVAILABLE": 502,
        "PROCUREMENT_BROWSER_FAILED": 502,
        "PROCUREMENT_SCHEMA_CHANGED": 502,
        "PROCUREMENT_ADAPTER_UNSUPPORTED": 503,
        "PROCUREMENT_LOOKUP_BUSY": 503,
        "PROCUREMENT_LOOKUP_DISABLED": 503,
    }
    status = statuses.get(code)
    if status is None:
        return None
    messages = {
        "PROCUREMENT_TIMEOUT": (
            "Kết nối máy chủ tới Mua Sắm Công quá thời gian; "
            "hãy kiểm tra proxy, VPN hoặc allowlist egress."
        ),
        "PROCUREMENT_INTERACTION_REQUIRED": (
            "Mua Sắm Công yêu cầu tương tác xác minh trước khi tra cứu."
        ),
        "PROCUREMENT_NOT_FOUND": (
            "Không tìm thấy chính xác mã PL/IB trên Mua Sắm Công."
        ),
    }
    return error_response(
        request,
        code,
        messages.get(code, "Không thể hoàn tất tra cứu Mua Sắm Công."),
        status_code=status,
    )


async def lookup_procurement(request):
    payload, invalid = await read_json_object(request)
    if invalid:
        return invalid
    if set(payload) - _REQUEST_FIELDS:
        return error_response(
            request,
            "PROCUREMENT_CODE_INVALID",
            "Request chứa field không được hỗ trợ.",
            status_code=400,
        )
    try:
        result = await run_blocking_io(
            _lookup_blocking,
            request,
            payload,
            timeout_seconds=(
                ProcurementLookupSettings.from_environ()
                .request_timeout_seconds
            ),
        )
        return JSONResponse(result)
    except BlockingIOBusyError:
        return _public_error(
            request, ProcurementLookupError("PROCUREMENT_LOOKUP_BUSY")
        )
    except BlockingIOTimeoutError:
        return _public_error(
            request, ProcurementLookupError("PROCUREMENT_TIMEOUT")
        )
    except ProcurementLookupError as error:
        return _public_error(request, error)
    except Exception as error:  # noqa: BLE001 - sanitized HTTP adapter.
        return log_and_error(
            request,
            error,
            "lookup_procurement",
            "PROCUREMENT_UPSTREAM_UNAVAILABLE",
            "Không thể hoàn tất tra cứu Mua Sắm Công.",
            status_code=502,
        )


async def procurement_health(request):
    try:
        session, organization_id = _request_context(request, None)
        _enforce_rate_limit(request, session.user_id, organization_id)
        result = await run_blocking_io(
            lambda: get_muasamcong_source().health(),
            timeout_seconds=30,
        )
        return JSONResponse(_public_health(result))
    except ProcurementLookupError as error:
        return _public_error(request, error)
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _public_error(
            request, ProcurementLookupError("PROCUREMENT_LOOKUP_BUSY")
        )
    except Exception as error:  # noqa: BLE001 - sanitized HTTP adapter.
        return log_and_error(
            request,
            error,
            "procurement_health",
            "PROCUREMENT_UPSTREAM_UNAVAILABLE",
            "Không thể đọc trạng thái Mua Sắm Công.",
            status_code=502,
        )
def procurement_lookup_routes(Route):
    return [
        Route("/api/procurement/lookup", lookup_procurement, methods=["POST"]),
        Route("/api/procurement/health", procurement_health, methods=["GET"]),
    ]
