"""Authenticated HTTP adapter for on-demand procurement lookup."""

from __future__ import annotations

from threading import RLock

from starlette.responses import JSONResponse

from backend.auth.auth_service import get_client_ip, get_rate_limit_decision
from backend.integrations.muasamcong_browser.registry import (
    get_muasamcong_source,
)
from backend.procurement_lookup.domain import (
    ProcurementLookupError,
    normalize_lookup_options,
)
from backend.procurement_lookup.cache import PostgresProcurementLookupCache
from backend.procurement_lookup.config import ProcurementLookupSettings
from backend.procurement_lookup.service import ProcurementLookupService
from backend.procurement_raw import ProcurementRawSnapshotRepository
from backend.shared.async_io import (
    BlockingIOBusyError,
    BlockingIOTimeoutError,
    run_blocking_io,
)
from backend.shared.helpers import database, get_active_org, verify_session
from backend.shared.logging_utils import (
    error_response,
    get_request_id,
    log_and_error,
    log_structured_event,
)
from backend.shared.request_validation import read_json_object
from backend.commercial_policy.config import commercial_runtime_config
from backend.commercial_policy.repository import CommercialRepository
from backend.commercial_policy.errors import CommercialPolicyError
from backend.usage_credits import (
    SourceRevisionCandidate,
    UsageCreditService,
    UsageOwner,
)


_REQUEST_FIELDS = {
    "code", "workspaceLease", "detailLevel", "revisionMode",
    "revisionNumbers",
}
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
    event = dict(event or {})
    request_id = event.pop("lookupRequestId", None)
    log_structured_event(
        "procurement.lookup.completed",
        request_id=request_id,
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
    settings = ProcurementLookupSettings.from_environ()
    raw_repository = ProcurementRawSnapshotRepository(database=database)
    revision_mode = payload.get("revisionMode") or "LATEST"
    revision_numbers = payload.get("revisionNumbers")
    raw_loader = lambda: (
        raw_repository.load_fresh_plan_bundle
        if str(payload.get("code") or "").strip().upper().startswith("PL")
        else raw_repository.load_fresh_notice_bundle
    )(
        organization_id,
        payload.get("code"),
        revision_mode=revision_mode,
        revision_numbers=revision_numbers,
        max_age_seconds=settings.raw_cache_ttl_seconds,
    )
    cached_raw_bundle = raw_loader() if (payload.get("detailLevel") or "CANONICAL").upper() == "COMPLETE" else None
    service = build_lookup_service()
    reservations = _reserve_procurement_usage(
        request,
        session,
        organization_id,
        payload,
        raw_repository=raw_repository,
        service=service,
        cache_hit=isinstance(cached_raw_bundle, dict),
    )
    try:
        result = service.lookup(
            payload.get("code"),
            detail_level=payload.get("detailLevel") or "CANONICAL",
            revision_mode=revision_mode,
            revision_numbers=revision_numbers,
            raw_bundle_loader=lambda: cached_raw_bundle,
            cache_scope=str(organization_id),
            lookup_request_id=get_request_id(request),
        )
    except Exception:
        _finish_procurement_usage(reservations, consume=False, reason="lookup_failed")
        raise
    raw_bundle = result.get("rawBundle") if isinstance(result, dict) else None
    cache_layer = ((result.get("metrics") or {}).get("cache") or {}).get(
        "layer"
    ) if isinstance(result, dict) else None
    if isinstance(raw_bundle, dict) and cache_layer != "RAW_SNAPSHOT":
        connection = database.get_connection()
        try:
            connection.execute("BEGIN")
            result["rawSnapshot"] = raw_repository.save_bundle(
                organization_id, raw_bundle, connection=connection
            )
            committed = (
                bool(raw_bundle.get("complete"))
                and int(result["rawSnapshot"].get("inserted") or 0) > 0
            )
            _finish_procurement_usage(
                reservations,
                consume=committed,
                reason="authoritative_snapshot_duplicate" if not committed else "committed",
                connection=connection,
            )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()
    else:
        _finish_procurement_usage(reservations, consume=False, reason="cache_hit")
    _observe_shadow_procurement_usage(
        request,
        result,
        inserted=int((result.get("rawSnapshot") or {}).get("inserted") or 0),
    )
    return result


def _usage_owner(request, session, organization_id):
    context = getattr(getattr(request, "state", None), "organization_context", None)
    if getattr(context, "scope_type", None) == "personal":
        return UsageOwner("account", session.user_id)
    return UsageOwner("organization", organization_id)


def _select_revision_metadata(rows, revision_mode, revision_numbers):
    if not rows:
        raise ProcurementLookupError("PROCUREMENT_NOT_FOUND")
    mode = str(revision_mode or "LATEST").strip().upper()
    if mode == "LATEST":
        return rows[-1:]
    if mode == "ALL":
        return rows
    requested = {
        str(value).strip().zfill(2)
        for value in (revision_numbers or [])
        if str(value).strip()
    }
    selected = [row for row in rows if row["revisionNumber"] in requested]
    if {row["revisionNumber"] for row in selected} != requested:
        raise ProcurementLookupError("PROCUREMENT_REVISION_INVALID")
    return selected


def _raw_revision_exists(raw_repository, organization_id, code, kind, revision):
    loader = (
        raw_repository.load_fresh_plan_bundle
        if kind == "PLAN"
        else raw_repository.load_fresh_notice_bundle
    )
    bundle = loader(
        organization_id,
        code,
        revision_mode="SELECTED",
        revision_numbers=[revision],
        max_age_seconds=ProcurementLookupSettings.from_environ().raw_cache_ttl_seconds,
    )
    return isinstance(bundle, dict) and bool(bundle.get("complete"))


def _reserve_procurement_usage(
    request,
    session,
    organization_id,
    payload,
    *,
    raw_repository,
    service,
    cache_hit,
):
    config = commercial_runtime_config()
    if cache_hit or not config.procurement_credit_enforcement_enabled:
        return []
    if (payload.get("detailLevel") or "CANONICAL").upper() != "COMPLETE":
        raise CommercialPolicyError(
            "COMMERCIAL_POLICY_DECISION_REQUIRED",
            "Enforcement chỉ tải payload khi có thể commit raw snapshot hoàn chỉnh.",
            status_code=409,
            details={"decision": "completeSnapshotBeforeDebit"},
        )
    code = str(payload.get("code") or "").strip().upper()
    entity_kind = "PLAN" if code.startswith("PL") else "NOTICE"
    metadata = service.list_revision_metadata(
        code, lookup_request_id=get_request_id(request)
    )
    selected = _select_revision_metadata(
        metadata,
        payload.get("revisionMode") or "LATEST",
        payload.get("revisionNumbers"),
    )
    candidates = [
        SourceRevisionCandidate(
            "muasamcong", entity_kind, code, row["revisionNumber"]
        )
        for row in selected
        if not _raw_revision_exists(
            raw_repository,
            organization_id,
            code,
            entity_kind,
            row["revisionNumber"],
        )
    ]
    if not candidates:
        raise CommercialPolicyError(
            "COMMERCIAL_SNAPSHOT_CACHE_INCONSISTENT",
            "Raw snapshot cache cần được đối soát trước khi gọi lại nguồn.",
            status_code=409,
        )
    connection = database.get_connection()
    try:
        connection.execute("BEGIN")
        cursor = connection.cursor()
        release = CommercialRepository(cursor).effective_release()
        if not release:
            raise CommercialPolicyError("COMMERCIAL_POLICY_DECISION_REQUIRED", "Không có commercial release hiệu lực.", status_code=503)
        partial_policy = (release["snapshot"].get("policies") or {}).get("partialBatch") or {"kind": "blocked_decision"}
        reservations = UsageCreditService(cursor).reserve_source_fetch_batch(
            _usage_owner(request, session, organization_id),
            candidates,
            get_request_id(request),
            partial_batch_policy=partial_policy,
        )
        connection.commit()
        return [row for row in reservations if row.get("state") == "reserved"]
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _observe_shadow_procurement_usage(request, result, *, inserted):
    config = commercial_runtime_config()
    if not config.enabled or config.mode != "shadow":
        return
    raw_bundle = result.get("rawBundle") if isinstance(result, dict) else None
    if not isinstance(raw_bundle, dict):
        return
    revisions = sorted(str(value) for value in (raw_bundle.get("revisions") or {}))
    log_structured_event(
        "commercial.usage.shadow",
        request_id=get_request_id(request),
        fields={
            "provider": "muasamcong",
            "entityKind": str((raw_bundle.get("entity") or {}).get("kind") or ""),
            "sourceCode": str(result.get("canonicalCode") or ""),
            "revisionCount": len(revisions),
            "projectedDebit": len(revisions)
            if bool(raw_bundle.get("complete")) and inserted > 0
            else 0,
            "complete": bool(raw_bundle.get("complete")),
            "newSnapshotRows": max(0, int(inserted)),
        },
        nonblocking=True,
    )


def _finish_procurement_usage(
    reservations, *, consume, reason, connection=None
):
    if not reservations:
        return
    owns_connection = connection is None
    connection = connection or database.get_connection()
    try:
        if owns_connection:
            connection.execute("BEGIN")
        service = UsageCreditService(connection.cursor())
        for reservation in reservations:
            if consume:
                service.consume_reservation_item(
                    reservation["id"],
                    {"id": f"raw:{reservation['provider']}:{reservation['sourceCode']}:{reservation['sourceRevision']}"},
                )
            else:
                service.release_reservation_item(reservation["id"], reason)
        if owns_connection:
            connection.commit()
    except Exception:
        if owns_connection:
            connection.rollback()
        raise
    finally:
        if owns_connection:
            connection.close()


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
    if isinstance(error, CommercialPolicyError):
        return error_response(
            request,
            error.code,
            error.message,
            status_code=error.status_code,
        )
    code = str(error)
    statuses = {
        "PROCUREMENT_CODE_INVALID": 400,
        "PROCUREMENT_REVISION_INVALID": 400,
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
        "PROCUREMENT_REVISION_INVALID": (
            "Không tìm thấy revision Mua Sắm Công đã chọn."
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
        normalize_lookup_options(
            payload.get("detailLevel") or "CANONICAL",
            payload.get("revisionMode") or "LATEST",
            payload.get("revisionNumbers"),
        )
    except ValueError:
        return error_response(
            request,
            "PROCUREMENT_CODE_INVALID",
            "Tùy chọn lookup không hợp lệ.",
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
            lane="procurement",
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
    except CommercialPolicyError as error:
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
            lane="procurement",
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
