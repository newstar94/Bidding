"""Authenticated HTTP adapter for on-demand procurement lookup."""

from __future__ import annotations

from threading import RLock

from starlette.responses import JSONResponse

from backend.auth.auth_service import get_client_ip, get_rate_limit_decision
from backend.integrations.muasamcong_browser.launchers import (
    BrowserLauncherFactory,
)
from backend.integrations.muasamcong_browser.source import (
    MuaSamCongBrowserSource,
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
        previous = _SERVICE
        launcher = BrowserLauncherFactory.create(
            config.mode,
            **config.launcher_options,
        )
        source = MuaSamCongBrowserSource(launcher=launcher)
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
    old_launcher = getattr(getattr(previous, "source", None), "launcher", None)
    if old_launcher is not None:
        old_launcher.close()
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


def procurement_lookup_routes(Route):
    return [Route("/api/procurement/lookup", lookup_procurement, methods=["POST"])]
