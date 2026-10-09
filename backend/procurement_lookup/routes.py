"""Authenticated HTTP adapter for on-demand procurement lookup."""

from __future__ import annotations

from copy import deepcopy
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
from backend.shared.workspace_scope import is_personal_scope_for_user
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
    return fetch_procurement_snapshot(request, session, organization_id, payload)


def fetch_procurement_snapshot(
    request, session, organization_id, payload, *, raw_repository=None,
    service=None, fetch=None, revision_metadata=None, persist_partial_snapshot=True,
):
    """Reserve, fetch and atomically persist one lookup/import source snapshot.

    Callers supply their already-authorized workspace context. ``fetch`` is an
    optional specialized projection fetch (opening), with the same code/revision
    identity and authoritative snapshot commit as ordinary lookup.
    """
    settings = ProcurementLookupSettings.from_environ()
    raw_repository = raw_repository or ProcurementRawSnapshotRepository(database=database)
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
    cached_raw_bundle = raw_loader() if fetch is None and (payload.get("detailLevel") or "CANONICAL").upper() == "COMPLETE" else None
    service = service or build_lookup_service()
    reservations = _reserve_procurement_usage(
        request,
        session,
        organization_id,
        payload,
        raw_repository=raw_repository,
        service=service,
        cache_hit=isinstance(cached_raw_bundle, dict),
        cached_raw_bundle=cached_raw_bundle,
        revision_metadata=revision_metadata,
    )
    usage_credits = None
    authoritative_raw_bundle = None
    merged_result = None
    try:
        if isinstance(reservations, dict):
            availability = reservations
            reservations = availability["reservations"]
            usage_credits = availability["usageCredits"]
            existing_revisions = availability["existingRevisions"]
            if existing_revisions:
                revision_mode = "SELECTED"
                revision_numbers = list(existing_revisions)
                authoritative_raw_bundle = (
                    cached_raw_bundle
                    if availability.get("cacheHit")
                    else raw_loader()
                )
                if not isinstance(authoritative_raw_bundle, dict) or not authoritative_raw_bundle.get("complete"):
                    raise CommercialPolicyError(
                        "COMMERCIAL_SNAPSHOT_CACHE_INCONSISTENT",
                        "Raw snapshot cache cần được đối soát trước khi gọi lại nguồn.",
                        status_code=409,
                    )
            if availability["fetchRevisions"]:
                revision_mode = "SELECTED"
                revision_numbers = list(availability["fetchRevisions"])
                # Keep the cached revisions for the combined response, while
                # fetching only the revisions accepted by the reservation.
                cached_raw_bundle = None
            else:
                cached_raw_bundle = authoritative_raw_bundle
        if fetch is not None:
            result = fetch()
        else:
            result = service.lookup(
                payload.get("code"),
                detail_level=payload.get("detailLevel") or "CANONICAL",
                revision_mode=revision_mode,
                revision_numbers=revision_numbers,
                raw_bundle_loader=lambda: cached_raw_bundle,
                cache_scope=str(organization_id),
                lookup_request_id=get_request_id(request),
            )
        if reservations and not isinstance(result.get("rawBundle"), dict):
            raise ProcurementLookupError("PROCUREMENT_SCHEMA_CHANGED")
        if fetch is None and usage_credits is not None and availability["fetchRevisions"] and isinstance(authoritative_raw_bundle, dict):
            # Validate the response containing both cached and fetched revisions
            # before the fetched snapshot and its usage debit are committed.
            merged_result = _merge_authoritative_raw_bundle(
                result, authoritative_raw_bundle, service, payload.get("code")
            )
    except Exception:
        _finish_procurement_usage(reservations, consume=False, reason="lookup_failed")
        raise
    raw_bundle = result.get("rawBundle") if isinstance(result, dict) else None
    cache_layer = ((result.get("metrics") or {}).get("cache") or {}).get(
        "layer"
    ) if isinstance(result, dict) else None
    persist_snapshot = (
        isinstance(raw_bundle, dict)
        and (persist_partial_snapshot or bool(raw_bundle.get("complete")))
    )
    if persist_snapshot and cache_layer != "RAW_SNAPSHOT":
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
            _finish_procurement_usage(reservations, consume=False, reason="snapshot_save_failed")
            raise
        finally:
            connection.close()
    else:
        _finish_procurement_usage(
            reservations, consume=False,
            reason="incomplete_snapshot" if isinstance(raw_bundle, dict) and not raw_bundle.get("complete") else "cache_hit",
        )
    _observe_shadow_procurement_usage(
        request,
        result,
        inserted=int((result.get("rawSnapshot") or {}).get("inserted") or 0),
    )
    if usage_credits is not None:
        if merged_result is not None:
            if "rawSnapshot" in result:
                merged_result["rawSnapshot"] = result["rawSnapshot"]
            result = merged_result
        result["usageCredits"] = usage_credits
    return result


def _usage_owner(request, session, organization_id):
    context = getattr(getattr(request, "state", None), "organization_context", None)
    if getattr(context, "scope_type", None) == "personal" or is_personal_scope_for_user(organization_id, session.user_id):
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
    cached_raw_bundle=None,
    revision_metadata=None,
):
    config = commercial_runtime_config()
    if not config.procurement_credit_enforcement_enabled:
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
    if cache_hit and isinstance(cached_raw_bundle, dict) and cached_raw_bundle.get("complete"):
        cached = [
            SourceRevisionCandidate("muasamcong", entity_kind, code, number)
            for number in cached_raw_bundle.get("revisions") or {}
        ]
        return {
            "reservations": [], "fetchRevisions": [],
            "existingRevisions": [candidate.source_revision for candidate in cached],
            "cacheHit": True,
            "usageCredits": _usage_credit_outcome(cached, {candidate.identity for candidate in cached}),
        }
    metadata = revision_metadata if revision_metadata is not None else service.list_revision_metadata(
        code, lookup_request_id=get_request_id(request)
    )
    selected = _select_revision_metadata(
        metadata,
        payload.get("revisionMode") or "LATEST",
        payload.get("revisionNumbers"),
    )
    requested = [
        SourceRevisionCandidate(
            "muasamcong", entity_kind, code, row["revisionNumber"]
        )
        for row in selected
    ]
    cached_revisions = set(
        (cached_raw_bundle.get("revisions") or {})
        if isinstance(cached_raw_bundle, dict) and cached_raw_bundle.get("complete")
        else ()
    )
    existing = {
        candidate.identity for candidate in requested
        if candidate.source_revision in cached_revisions or _raw_revision_exists(
            raw_repository,
            organization_id,
            code,
            entity_kind,
            candidate.source_revision,
        )
    }
    candidates = [candidate for candidate in requested if candidate.identity not in existing]
    if not candidates:
        return {
            "reservations": [], "fetchRevisions": [],
            "existingRevisions": [candidate.source_revision for candidate in requested],
            "usageCredits": _usage_credit_outcome(requested, existing),
        }
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
        accepted = existing | {
            (row["provider"], row["entityKind"], row["sourceCode"], row["sourceRevision"])
            for row in reservations
        }
        outcome = _usage_credit_outcome(requested, accepted)
        if not outcome["processed"]:
            outcome["status"] = "QUOTA_EXHAUSTED"
            raise CommercialPolicyError(
                "QUOTA_EXHAUSTED",
                "Không còn đủ lượt lấy hồ sơ Mua Sắm Công; các phiên bản đã chọn chưa được xử lý.",
                status_code=409,
                details={"usageCredits": outcome},
            )
        connection.commit()
        return {
            "reservations": [row for row in reservations if row.get("state") == "reserved"],
            "fetchRevisions": [row["sourceRevision"] for row in reservations],
            "existingRevisions": [candidate.source_revision for candidate in requested if candidate.identity in existing],
            "usageCredits": outcome,
        }
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _usage_credit_outcome(requested, accepted):
    processed = []
    skipped = []
    requested_items = []
    for candidate in requested:
        item = {
            "provider": candidate.provider,
            "entityKind": candidate.entity_kind,
            "sourceCode": candidate.source_code,
            "sourceRevision": candidate.source_revision,
        }
        requested_items.append(item)
        if candidate.identity in accepted:
            processed.append(dict(item))
        else:
            skipped.append({**item, "reasonCode": "QUOTA_EXHAUSTED"})
    return {
        "status": "PARTIAL" if skipped else "COMPLETE",
        "requested": requested_items,
        "processed": processed,
        "skipped": skipped,
    }


def _merge_authoritative_raw_bundle(result, authoritative, service, code):
    """Keep cached revisions visible when only the affordable suffix was fetched."""

    fetched = result.get("rawBundle") if isinstance(result, dict) else None
    if not isinstance(fetched, dict):
        return result
    merged = deepcopy(authoritative)
    merged["revisions"] = {
        **(authoritative.get("revisions") or {}),
        **(fetched.get("revisions") or {}),
    }
    merged["sources"] = {
        **(authoritative.get("sources") or {}),
        **(fetched.get("sources") or {}),
    }
    merged["failures"] = [
        *(authoritative.get("failures") or []),
        *(fetched.get("failures") or []),
    ]
    merged["complete"] = bool(authoritative.get("complete")) and bool(fetched.get("complete"))
    merged["status"] = "FOUND_COMPLETE" if merged["complete"] else "FOUND_PARTIAL"
    merged["manifest"] = {
        **(authoritative.get("manifest") or {}),
        **(fetched.get("manifest") or {}),
        "revisions": list(merged["revisions"]),
    }
    projector = getattr(getattr(service, "source", None), "lookup_from_raw_bundle", None)
    if not callable(projector):
        raise ProcurementLookupError("PROCUREMENT_ADAPTER_UNSUPPORTED")
    projected = projector(
        code,
        merged,
        revision_mode="ALL",
        detail_level="COMPLETE",
    )
    projected["metrics"] = result.get("metrics") or projected.get("metrics") or {}
    return projected


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
            fields=error.details if error.code == "QUOTA_EXHAUSTED" else None,
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
