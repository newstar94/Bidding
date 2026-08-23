"""Authenticated HTTP boundary for procurement prepare/apply/status/resume."""

from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
import json
import logging
import os
import re
import threading
from uuid import NAMESPACE_URL, uuid5

from starlette.responses import JSONResponse

from backend.auth.auth_helper import SessionRole
from backend.auth.roles import resolve_workspace_active_role
from backend.auth.session_store import session_invalid_reason
from backend.auth.auth_service import get_client_ip, get_rate_limit_decision
from backend.integrations.vneps.fake_procurement_provider import FixtureProcurementSource
from backend.integrations.vneps.procurement_provider import VnepsProcurementSource
from backend.integrations.muasamcong_browser.registry import (
    get_muasamcong_source,
)
from backend.procurement_import import opening_snapshot
from backend.procurement_import.command import (
    ProcurementNoticeReconciler,
    ProcurementPlanReconciler,
)
from backend.procurement_import.domain import (
    ImportConflict,
    canonical_digest,
    revision_requires_materialization,
)
from backend.procurement_import.decisions import (
    ProcurementDecisionError,
    resolve_plan_decision_authority,
    resolve_revision_decisions,
)
from backend.procurement_import.repository import ProcurementImportRepository
from backend.procurement_import.repository import ProcurementImportSessionRepository
from backend.procurement_import.service import ProcurementImportPreparer, PreviewStore
from backend.procurement_import.session import ProcurementImportSessionService
from backend.procurement_raw import ProcurementRawSnapshotRepository
from backend.procurement_import.source import ProcurementSourceError
from backend.procurement_import.runtime import (
    ProcurementRouteError,
    build_procurement_source as _build_runtime_source,
    procurement_import_enabled,
    procurement_provider_name,
    procurement_source_timeout_seconds,
)
from backend.procurement_lookup.config import ProcurementLookupSettings
from backend.shared.async_io import (
    BlockingIOBusyError,
    BlockingIOTimeoutError,
    run_blocking_io,
)
from backend.shared.helpers import OrgPermissionError, database, get_active_org, verify_session
from backend.shared.access_policy import (
    authorize_record_write,
    has_module_permission,
)
from backend.shared.logging_utils import error_response, log_and_error
from backend.shared.request_validation import read_json_object
from backend.shared.workspace_scope import is_personal_scope_for_user


LOGGER = logging.getLogger(__name__)

# Compatibility aliases for tests and callers that used the original route
# helpers while the raw-snapshot policy moves behind its dedicated seam.
_load_opening_from_raw_snapshot = opening_snapshot.load_complete_opening_snapshot
_raw_snapshot_has_complete_opening_sources = (
    opening_snapshot.raw_snapshot_has_complete_opening_sources
)


PREVIEW_STORE = PreviewStore(
    ttl_seconds=int(os.environ.get(
        "PROCUREMENT_IMPORT_PREVIEW_TTL_SECONDS",
        os.environ.get("VNEPS_PROCUREMENT_PREVIEW_TTL_SECONDS", "300"),
    ))
)
_PREPARE_FIELDS = {
    "code", "revisionMode", "selectedRevision", "includeLinkedNotices",
    "targetPlanRootId", "workspaceLease",
}
_APPLY_FIELDS = {
    "previewId", "idempotencyKey", "expectedPlanRowVersion", "decisions",
    "workspaceLease",
}
_SESSION_DECISION_FIELDS = {"bundleDigest", "decisions", "workspaceLease"}
_NOTICE_PREPARE_FIELDS = {
    "code", "revisionMode", "selectedRevision", "targetPackageRootId",
    "workspaceLease",
}
_NOTICE_APPLY_FIELDS = {
    "previewId", "idempotencyKey", "expectedPackageRowVersion",
    "workspaceLease",
}
_OPENING_PREPARE_FIELDS = {
    "packageId", "noticeNo", "selectedRevision", "workspaceLease",
}
_OPENING_APPLY_FIELDS = {
    "previewId", "expectedPackageRowVersion", "workspaceLease",
}


def _enabled():
    return procurement_import_enabled()


def _provider_name():
    return procurement_provider_name()


def _source_timeout_seconds():
    return procurement_source_timeout_seconds()


def build_procurement_source():
    return _build_runtime_source(
        fixture_source_factory=FixtureProcurementSource,
        vneps_source_factory=VnepsProcurementSource,
        muasamcong_source_factory=get_muasamcong_source,
    )


def _build_import_preparer(source):
    settings = ProcurementLookupSettings.from_environ()
    return ProcurementImportPreparer(
        source,
        PREVIEW_STORE,
        raw_snapshot_repository=ProcurementRawSnapshotRepository(
            database=database
        ),
        raw_cache_ttl_seconds=settings.raw_cache_ttl_seconds,
    )


def _request_context(request, workspace_lease):
    valid, session = verify_session(request)
    if not valid:
        raise ProcurementRouteError("AUTHENTICATION_REQUIRED", str(session), 401)
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        organization_id = get_active_org(request, session.user_id, cursor=cursor)
    finally:
        connection.close()
    lease = str(workspace_lease or organization_id).strip()
    if not lease or len(lease) > 128:
        raise ProcurementRouteError(
            "ORGANIZATION_ACCESS_DENIED", "Workspace lease không hợp lệ.", 403
        )
    return session, organization_id, lease


def _enforce_rate_limit(request, user_id, organization_id, action):
    buckets = (
        f"procurement:{action}:ip:{get_client_ip(request)}",
        f"procurement:{action}:user:{user_id}",
        f"procurement:{action}:org:{organization_id}",
    )
    for bucket in buckets:
        decision = get_rate_limit_decision(
            bucket, max_attempts=30 if action == "prepare" else 15,
            window_seconds=60,
        )
        if not decision.allowed:
            raise ProcurementRouteError(
                "PROCUREMENT_LOOKUP_RATE_LIMITED",
                "Đã vượt giới hạn yêu cầu nhập procurement.",
                429,
            )


def _prepare_blocking(request, payload):
    session, organization_id, lease = _request_context(
        request, payload.get("workspaceLease")
    )
    _enforce_rate_limit(request, session.user_id, organization_id, "prepare")
    source = build_procurement_source()
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        if not has_module_permission(
            cursor, session, session.user_id, organization_id, "kehoach", "view"
        ):
            raise ProcurementRouteError(
                "ORGANIZATION_ACCESS_DENIED",
                "Không có quyền nhập kế hoạch trong workspace hiện tại.",
                403,
            )
        repository = ProcurementImportRepository(cursor)
        code = str(payload.get("code") or "").strip().upper()
        family_no = code.split("-", 1)[0]
        local_state = repository.load_family(
            organization_id, source.name, family_no
        )
        if local_state.get("latestPlan") is None:
            local_state = None
    finally:
        connection.rollback()
        connection.close()
    include_linked_notices = payload.get("includeLinkedNotices", True)
    quick_enrichment = (
        bool(include_linked_notices)
        and str(source.name).upper() == "MUASAMCONG"
    )
    preview = _build_import_preparer(source).prepare_plan(
        code=payload.get("code"),
        revision_mode=payload.get("revisionMode") or "LATEST",
        selected_revision=payload.get("selectedRevision"),
        # Plan/package fields are sufficient for the first response.  Linked
        # TBMT details are refreshed by the bounded background operation below.
        include_linked_notices=(
            False if quick_enrichment else bool(include_linked_notices)
        ),
        organization_id=organization_id,
        user_id=session.user_id,
        workspace_lease=lease,
        local_state=local_state,
    )
    stored = PREVIEW_STORE.get(
        preview["previewId"], organization_id=organization_id,
        user_id=session.user_id, workspace_lease=lease,
    )
    linked = _linked_notice_numbers(stored.canonical_bundle)
    session_bundle = deepcopy(stored.canonical_bundle)
    session_bundle["decisionBindingRequired"] = True
    if quick_enrichment:
        session_bundle["enrichmentStatus"] = (
            "PENDING" if linked else "COMPLETED"
        )
    connection = database.get_connection()
    try:
        connection.execute("BEGIN ISOLATION LEVEL SERIALIZABLE")
        import_session = ProcurementImportSessionService(
            ProcurementImportSessionRepository(connection.cursor()),
            ttl_seconds=int(os.environ.get("PROCUREMENT_IMPORT_SESSION_TTL_SECONDS", "86400")),
        ).create_from_bundle(
            session_bundle,
            organization_id=organization_id,
            user_id=session.user_id,
            workspace_lease=lease,
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
    result = {
        **preview,
        "importSession": import_session,
        "decisionPackages": deepcopy(
            import_session["decisionPackages"]
            if "decisionPackages" in import_session
            else preview.get("decisionPackages") or []
        ),
        "blockingIssues": deepcopy(
            import_session["blockingIssues"]
            if "blockingIssues" in import_session
            else preview.get("blockingIssues") or []
        ),
    }
    if quick_enrichment:
        if linked:
            result.update({
                "previewMode": "QUICK",
                "enrichmentStatus": "PENDING",
                "enrichmentWarnings": [{
                    "code": "PROCUREMENT_ENRICHMENT_PENDING",
                    "message": "Dữ liệu TBMT liên kết đang được bổ sung trong nền.",
                }],
                "_enrichmentContext": {
                    "sessionId": import_session.get("sessionId"),
                    "familyNo": str(payload.get("code") or "").split("-", 1)[0].upper(),
                    "revisionMode": payload.get("revisionMode") or "LATEST",
                    "selectedRevision": payload.get("selectedRevision"),
                    "workspaceLease": lease,
                    "organizationId": organization_id,
                    "userId": session.user_id,
                    "provider": source.name,
                    "linkedNoticeCount": len(linked),
                },
            })
        else:
            result.update({
                "previewMode": "QUICK",
                "enrichmentStatus": "COMPLETED",
            })
    return result


def _linked_notice_numbers(bundle):
    notices = []
    seen = set()
    for revision in (bundle or {}).get("revisions") or []:
        for package in revision.get("packages") or []:
            link = package.get("noticeLink") or {}
            notice_no = str(link.get("noticeNo") or "").strip().upper()
            if link.get("state") == "LINKED" and notice_no and notice_no not in seen:
                seen.add(notice_no)
                notices.append(notice_no)
    return notices


def _bundle_local_authority_signature(bundle):
    """Return only local target identity, excluding refreshable source evidence."""

    plan = (bundle or {}).get("plan") or {}
    predecessor = plan.get("expectedPredecessor")
    plan_signature = None if predecessor is None else tuple(
        str(predecessor.get(key) or "")
        for key in ("id", "rootId", "localVersion", "rowVersion")
    )
    targets = []
    for revision in (bundle or {}).get("revisions") or []:
        revision_id = str(revision.get("revisionId") or "")
        rows = ((bundle or {}).get("reconciliationByRevision") or {}).get(
            revision_id, []
        )
        for row in rows:
            observation_id = str(row.get("planDetailRevisionId") or "")
            target = row.get("localTarget") or {}
            if target.get("rootId") or target.get("snapshotId"):
                targets.append((
                    revision_id, observation_id, "selected",
                    str(target.get("rootId") or ""),
                    str(target.get("snapshotId") or ""),
                    str(target.get("localVersion") or ""),
                    str(target.get("rowVersion") or ""),
                ))
            candidates = list(row.get("matchCandidates") or [])
            candidates += list((row.get("candidateMergeSurfaces") or {}).values())
            for candidate in candidates:
                if candidate.get("rootId") or candidate.get("localRootId"):
                    targets.append((
                        revision_id, observation_id, "candidate",
                        str(candidate.get("rootId") or candidate.get("localRootId") or ""),
                        str(candidate.get("snapshotId") or ""),
                        str(candidate.get("localVersion") or ""),
                        str(candidate.get("rowVersion") or ""),
                    ))
    return plan_signature, tuple(sorted(set(targets)))


def _bundle_local_targets(bundle):
    targets = []
    for revision in (bundle or {}).get("revisions") or []:
        revision_id = str(revision.get("revisionId") or "")
        rows = ((bundle or {}).get("reconciliationByRevision") or {}).get(
            revision_id, []
        )
        for row in rows:
            local_target = row.get("localTarget") or {}
            if local_target.get("rootId") or local_target.get("snapshotId"):
                targets.append({
                    "localRootId": local_target.get("rootId"),
                    "snapshotId": local_target.get("snapshotId"),
                    "localVersion": local_target.get("localVersion"),
                    "rowVersion": local_target.get("rowVersion"),
                    "isLatest": bool(local_target.get("isLatest", True)),
                })
            targets.extend({
                "localRootId": candidate.get("rootId") or candidate.get("localRootId"),
                "snapshotId": candidate.get("snapshotId"),
                "localVersion": candidate.get("localVersion"),
                "rowVersion": candidate.get("rowVersion"),
                "isLatest": bool(candidate.get("isLatest", True)),
            } for candidate in list(row.get("matchCandidates") or [])
                + list((row.get("candidateMergeSurfaces") or {}).values()))
    return {
        (str(target.get("localRootId") or ""), str(target.get("snapshotId") or "")): target
        for target in targets
        if target.get("localRootId") and target.get("snapshotId")
    }.values()


def _create_enrichment_operation(context, bundle, notices):
    """Create an idempotent progress record for background TBMT enrichment."""
    idempotency_key = f"enrichment:{context['sessionId']}"
    request_hash = sha256(
        json.dumps({
            "sessionId": context["sessionId"],
            "bundleDigest": canonical_digest(bundle),
            "notices": notices,
        }, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    manifest = [
        {"noticeNo": notice, "status": "PENDING"}
        for notice in notices
    ]
    connection = database.get_connection()
    try:
        connection.execute("BEGIN ISOLATION LEVEL SERIALIZABLE")
        operation = ProcurementImportRepository(connection.cursor()).create_operation({
            "id": _operation_id(
                context["organizationId"], context["provider"],
                context["familyNo"], idempotency_key,
            ),
            "organizationId": context["organizationId"],
            "provider": context["provider"],
            "familyNo": context["familyNo"],
            "totalRevisions": len(manifest),
            "bundleDigest": canonical_digest(bundle),
            "idempotencyKey": idempotency_key,
            "requestHash": request_hash,
            "actorUserId": context["userId"],
            "revisionResults": manifest,
        })
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
    return operation


def _record_enrichment_progress(context, operation_id, notice_no, processed, total):
    connection = database.get_connection()
    try:
        connection.execute("BEGIN ISOLATION LEVEL SERIALIZABLE")
        repository = ProcurementImportRepository(connection.cursor())
        operation = repository.get_operation(context["organizationId"], operation_id)
        if operation is None:
            return
        results = operation.get("revisionResults", [])
        for item in results:
            if str(item.get("noticeNo") or "").upper() == str(notice_no).upper():
                item["status"] = "SUCCEEDED"
        repository.update_operation(
            context["organizationId"], operation_id,
            cursor=min(int(processed), int(total)), results=results, status="RUNNING",
        )
        connection.commit()
    except Exception:  # noqa: BLE001 - best-effort progress must not abort enrichment.
        connection.rollback()
        LOGGER.warning(
            "Unable to record procurement enrichment progress",
            extra={"operation_id": operation_id, "notice_no": notice_no},
            exc_info=True,
        )
    finally:
        connection.close()


def _run_plan_enrichment(context, operation_id):
    """Refresh linked notices without holding the HTTP prepare request open."""
    try:
        progress_connection = database.get_connection()
        try:
            progress_connection.execute("BEGIN ISOLATION LEVEL SERIALIZABLE")
            progress_repo = ProcurementImportRepository(progress_connection.cursor())
            progress_operation = progress_repo.get_operation(
                context["organizationId"], operation_id,
            )
            if progress_operation is None:
                return
            progress_repo.update_operation(
                context["organizationId"], operation_id,
                cursor=0,
                results=progress_operation.get("revisionResults", []),
                status="RUNNING",
            )
            progress_connection.commit()
        except Exception:
            progress_connection.rollback()
            raise
        finally:
            progress_connection.close()
        connection = database.get_connection()
        try:
            connection.rollback()
            session_row = ProcurementImportSessionRepository(
                connection.cursor()
            ).get_scoped(
                context["sessionId"],
                organization_id=context["organizationId"],
                user_id=context["userId"],
                workspace_lease=context["workspaceLease"],
            )
        finally:
            connection.close()
        if session_row is None:
            return
        source = build_procurement_source()
        preparer = _build_import_preparer(source)
        code = context["familyNo"]
        local_connection = database.get_connection()
        try:
            local_state = ProcurementImportRepository(
                local_connection.cursor()
            ).load_family(
                context["organizationId"], source.name, code
            )
            if local_state.get("latestPlan") is None:
                local_state = None
        finally:
            local_connection.rollback()
            local_connection.close()
        refreshed = preparer.prepare_plan(
            code=code,
            revision_mode=context["revisionMode"],
            selected_revision=context.get("selectedRevision"),
            include_linked_notices=True,
            organization_id=context["organizationId"],
            user_id=context["userId"],
            workspace_lease=context["workspaceLease"],
            local_state=local_state,
            enrichment_workers=max(
                1,
                min(int(os.environ.get("PROCUREMENT_ENRICHMENT_MAX_WORKERS", "3")), 8),
            ),
            enrichment_timeout_seconds=max(
                5.0,
                min(float(os.environ.get("PROCUREMENT_ENRICHMENT_CHILD_TIMEOUT_SECONDS", "45")), 120.0),
            ),
            enrichment_source_factory=build_procurement_source,
            enrichment_progress=lambda notice_no, processed, total: _record_enrichment_progress(
                context, operation_id, notice_no, processed, total,
            ),
        )
        stored = PREVIEW_STORE.get(
            refreshed["previewId"],
            organization_id=context["organizationId"],
            user_id=context["userId"],
            workspace_lease=context["workspaceLease"],
        )
        if _bundle_local_authority_signature(
            session_row.get("canonicalBundle") or {}
        ) != _bundle_local_authority_signature(stored.canonical_bundle):
            raise ProcurementRouteError(
                "PROCUREMENT_PREVIEW_STALE",
                "Dữ liệu nội bộ đã thay đổi trong lúc bổ sung dữ liệu nguồn.",
                409,
            )
        failed_notices = {
            str(item.get("noticeNo") or "").strip().upper()
            for item in (stored.canonical_bundle.get("warnings") or [])
            if item.get("code") == "PROCUREMENT_ENRICHMENT_PARTIAL"
        }
        enriched_bundle = deepcopy(stored.canonical_bundle)
        enriched_bundle["decisionBindingRequired"] = True
        enriched_bundle["enrichmentStatus"] = (
            "PARTIAL" if failed_notices else "COMPLETED"
        )
        enriched_digest = canonical_digest(enriched_bundle)
        update_connection = database.get_connection()
        try:
            update_connection.execute("BEGIN ISOLATION LEVEL SERIALIZABLE")
            update_cursor = update_connection.cursor()
            _validate_plan_predecessor(
                update_cursor,
                context["organizationId"],
                session_row.get("canonicalBundle", {}).get("plan") or {},
            )
            for target in _bundle_local_targets(
                session_row.get("canonicalBundle") or {}
            ):
                _validate_plan_local_target(
                    update_cursor, context["organizationId"], target,
                )
            updated = ProcurementImportSessionRepository(
                update_cursor
            ).update_canonical_bundle(
                context["sessionId"],
                organization_id=context["organizationId"],
                user_id=context["userId"],
                workspace_lease=context["workspaceLease"],
                bundle=enriched_bundle,
                bundle_digest=enriched_digest,
            )
            results = [
                {
                    "noticeNo": notice,
                    "status": "FAILED" if notice in failed_notices else "SUCCEEDED",
                    **({"errorCode": "PROCUREMENT_ENRICHMENT_PARTIAL"} if notice in failed_notices else {}),
                }
                for notice in _linked_notice_numbers(enriched_bundle)
            ]
            ProcurementImportRepository(update_connection.cursor()).update_operation(
                context["organizationId"], operation_id,
                cursor=len(results), results=results,
                status=(
                    "FAILED" if not updated
                    else "PARTIAL" if failed_notices
                    else "COMPLETED"
                ),
            )
            update_connection.commit()
        except Exception:
            update_connection.rollback()
            raise
        finally:
            update_connection.close()
    except Exception as error:  # noqa: BLE001 - background work is reported via operation status.
        connection = database.get_connection()
        try:
            connection.execute("BEGIN ISOLATION LEVEL SERIALIZABLE")
            operation = ProcurementImportRepository(
                connection.cursor()
            ).get_operation(context["organizationId"], operation_id)
            results = operation.get("revisionResults", []) if operation else []
            for item in results:
                item["status"] = "FAILED"
                item["errorCode"] = str(error)[:120]
            ProcurementImportRepository(connection.cursor()).update_operation(
                context["organizationId"], operation_id,
                cursor=0, results=results, status="FAILED",
            )
            connection.commit()
        except Exception:  # noqa: BLE001 - preserve the original background failure.
            connection.rollback()
            LOGGER.warning(
                "Unable to mark procurement enrichment operation as failed",
                extra={"operation_id": operation_id},
                exc_info=True,
            )
        finally:
            connection.close()


def _start_plan_enrichment(result):
    context = result.pop("_enrichmentContext", None)
    if not context:
        return result
    bundle = PREVIEW_STORE.get(
        result["previewId"],
        organization_id=context["organizationId"],
        user_id=context["userId"],
        workspace_lease=context["workspaceLease"],
    )
    notices = _linked_notice_numbers(bundle.canonical_bundle)
    if not notices:
        result["enrichmentStatus"] = "COMPLETED"
        return result
    operation = _create_enrichment_operation(context, bundle.canonical_bundle, notices)
    result["enrichmentOperationId"] = operation["operationId"]
    if operation.get("status") in {"COMPLETED", "PARTIAL", "FAILED"}:
        result["enrichmentStatus"] = operation["status"]
        return result
    thread = threading.Thread(
        target=_run_plan_enrichment,
        args=(context, operation["operationId"]),
        name="procurement-plan-enrichment",
        daemon=True,
    )
    thread.start()
    return result


def _prepare_notice_blocking(request, payload):
    session, organization_id, lease = _request_context(
        request, payload.get("workspaceLease")
    )
    _enforce_rate_limit(request, session.user_id, organization_id, "prepare")
    source = build_procurement_source()

    permission_connection = database.get_connection()
    try:
        if not has_module_permission(
            permission_connection.cursor(), session, session.user_id,
            organization_id, "goithau", "edit",
        ):
            raise ProcurementRouteError(
                "ORGANIZATION_ACCESS_DENIED",
                "Không có quyền nhập gói thầu trong workspace hiện tại.",
                403,
            )
    finally:
        permission_connection.close()

    def resolve_local_target(notice_no, relationship, target_root_id):
        connection = database.get_connection()
        try:
            return ProcurementImportRepository(
                connection.cursor()
            ).resolve_notice_target(
                organization_id, source.name, notice_no, relationship,
                target_root_id=target_root_id,
            )
        finally:
            connection.rollback()
            connection.close()

    preview = _build_import_preparer(source).prepare_notice(
        code=payload.get("code"),
        revision_mode=payload.get("revisionMode") or "LATEST",
        selected_revision=payload.get("selectedRevision"),
        target_package_root_id=payload.get("targetPackageRootId"),
        organization_id=organization_id,
        user_id=session.user_id,
        workspace_lease=lease,
        resolve_local_target=resolve_local_target,
    )
    stored = PREVIEW_STORE.get(
        preview["previewId"], organization_id=organization_id,
        user_id=session.user_id, workspace_lease=lease,
    )
    connection = database.get_connection()
    try:
        connection.execute("BEGIN ISOLATION LEVEL SERIALIZABLE")
        import_session = ProcurementImportSessionService(
            ProcurementImportSessionRepository(connection.cursor()),
            ttl_seconds=int(os.environ.get("PROCUREMENT_IMPORT_SESSION_TTL_SECONDS", "86400")),
        ).create_from_bundle(
            stored.canonical_bundle,
            organization_id=organization_id,
            user_id=session.user_id,
            workspace_lease=lease,
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
    return {**preview, "importSession": import_session}


def _get_import_session_blocking(request, session_id, revision_number=None):
    session, organization_id, lease = _request_context(
        request, request.query_params.get("workspaceLease")
    )
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        repository = ProcurementImportSessionRepository(cursor)
        service = ProcurementImportSessionService(repository)
        stored = repository.get_scoped(
            session_id, organization_id=organization_id,
            user_id=session.user_id, workspace_lease=lease,
        )
        if stored is None:
            raise LookupError("PROCUREMENT_SESSION_EXPIRED")
        module = "kehoach" if stored["kind"] == "PLAN" else "goithau"
        if not has_module_permission(
            cursor, session, session.user_id, organization_id, module, "edit"
        ):
            raise ProcurementRouteError(
                "ORGANIZATION_ACCESS_DENIED",
                "Không có quyền tiếp tục phiên nhập trong workspace hiện tại.",
                403,
            )
        if revision_number is None:
            service._get(
                session_id, organization_id=organization_id,
                user_id=session.user_id, workspace_lease=lease,
            )
            return service._public_manifest(stored)
        return service.get_revision_draft(
            session_id, revision_number,
            organization_id=organization_id, user_id=session.user_id,
            workspace_lease=lease,
            validate_plan_authority=lambda plan_authority: _validate_plan_predecessor(
                cursor, organization_id, plan_authority
            ),
            validate_local_target=lambda target: _validate_plan_local_target(
                cursor, organization_id, target
            ),
        )
    finally:
        connection.rollback()
        connection.close()


def _bind_import_session_decisions_blocking(request, session_id, payload):
    session, organization_id, lease = _request_context(
        request, payload.get("workspaceLease")
    )
    connection = database.get_connection()
    try:
        connection.execute("BEGIN ISOLATION LEVEL SERIALIZABLE")
        cursor = connection.cursor()
        repository = ProcurementImportSessionRepository(cursor)
        stored = repository.get_scoped(
            session_id,
            organization_id=organization_id,
            user_id=session.user_id,
            workspace_lease=lease,
        )
        if stored is None:
            raise LookupError("PROCUREMENT_SESSION_EXPIRED")
        if stored["kind"] != "PLAN" or not has_module_permission(
            cursor, session, session.user_id, organization_id, "kehoach", "edit"
        ):
            raise ProcurementRouteError(
                "ORGANIZATION_ACCESS_DENIED",
                "Không có quyền xác nhận phiên nhập trong workspace hiện tại.",
                403,
            )

        def validate_investor(investor_id):
            _validate_investor(cursor, organization_id, investor_id)

        def validate_local_target(target):
            _validate_plan_local_target(cursor, organization_id, target)

        result = ProcurementImportSessionService(repository).bind_plan_decisions(
            session_id,
            organization_id=organization_id,
            user_id=session.user_id,
            workspace_lease=lease,
            bundle_digest=payload.get("bundleDigest"),
            decisions=payload.get("decisions") or {},
            validate_investor=validate_investor,
            validate_local_target=validate_local_target,
            validate_plan_authority=lambda plan_authority: _validate_plan_predecessor(
                cursor, organization_id, plan_authority
            ),
        )
        connection.commit()
        return result
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _cancel_import_session_blocking(request, session_id):
    session, organization_id, lease = _request_context(
        request, request.query_params.get("workspaceLease")
    )
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        repository = ProcurementImportSessionRepository(cursor)
        stored = repository.get_scoped(
            session_id, organization_id=organization_id,
            user_id=session.user_id, workspace_lease=lease,
        )
        if stored is None:
            raise LookupError("PROCUREMENT_SESSION_EXPIRED")
        module = "kehoach" if stored["kind"] == "PLAN" else "goithau"
        if not has_module_permission(
            cursor, session, session.user_id, organization_id, module, "edit"
        ):
            raise ProcurementRouteError(
                "ORGANIZATION_ACCESS_DENIED",
                "Không có quyền kết thúc phiên nhập trong workspace hiện tại.",
                403,
            )
        repository.cancel_remaining(
            session_id, organization_id=organization_id, user_id=session.user_id,
        )
        connection.commit()
        return {"sessionId": session_id, "status": "CANCELLED"}
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _prepare_opening_blocking(request, payload):
    session, organization_id, lease = _request_context(
        request, payload.get("workspaceLease")
    )
    _enforce_rate_limit(request, session.user_id, organization_id, "prepare")
    package_id = str(payload.get("packageId") or "").strip()
    if not package_id or len(package_id) > 128:
        raise ProcurementRouteError(
            "PROCUREMENT_CODE_INVALID", "Gói thầu không hợp lệ.", 400
        )
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        if not has_module_permission(
            cursor,
            session,
            session.user_id,
            organization_id,
            "goithau",
            "edit",
        ):
            raise ProcurementRouteError(
                "ORGANIZATION_ACCESS_DENIED",
                "Không có quyền cập nhật thông tin mở thầu.",
                403,
            )
        package = cursor.execute(
            """SELECT id, COALESCE(NULLIF(id_goc, ''), id), row_version,
                      ma_goi_thau, ten_goi_thau
                 FROM goi_thau
                WHERE organization_id = ? AND id = ?
                  AND is_latest = 1 AND archived_at IS NULL""",
            (organization_id, package_id),
        ).fetchone()
        if package is None:
            raise ProcurementRouteError(
                "PROCUREMENT_NOTICE_PACKAGE_UNRESOLVED",
                "Không tìm thấy gói thầu trong workspace hiện tại.",
                404,
            )
        binding = cursor.execute(
            """SELECT notify_no
                 FROM procurement_source_binding
                WHERE organization_id = ?
                  AND (local_snapshot_id = ? OR local_root_id = ?)
                  AND NULLIF(trim(notify_no), '') IS NOT NULL
                ORDER BY created_at DESC
                LIMIT 1""",
            (organization_id, package[0], package[1]),
        ).fetchone()
    finally:
        connection.rollback()
        connection.close()
    requested_notice = str(payload.get("noticeNo") or "").strip().upper()
    bound_notice = str(binding[0] if binding else "").strip().upper()
    fallback_notice = str(package[3] or "").strip().upper()
    notice_no = bound_notice or requested_notice
    if not notice_no and fallback_notice.startswith("IB"):
        notice_no = fallback_notice
    if not re.fullmatch(r"IB\d{10}", notice_no):
        raise ProcurementRouteError(
            "PROCUREMENT_NOTICE_PACKAGE_UNRESOLVED",
            "Gói thầu chưa có liên kết mã TBMT hợp lệ.",
            422,
        )
    if bound_notice and requested_notice and bound_notice != requested_notice:
        raise ProcurementRouteError(
            "PROCUREMENT_PREVIEW_STALE",
            "Mã TBMT không khớp liên kết nguồn của gói thầu.",
            409,
        )
    source = build_procurement_source()
    available = sorted(
        source.list_notice_revisions(notice_no),
        key=lambda row: str(row.get("revisionNumber") or "").zfill(12),
    )
    if not available:
        raise ProcurementRouteError(
            "PROCUREMENT_NOT_FOUND", "Không tìm thấy TBMT trên Mua Sắm Công.", 404
        )
    requested_revision = str(payload.get("selectedRevision") or "").strip()
    selected = (
        next(
            (
                row
                for row in available
                if str(row.get("revisionNumber")) == requested_revision
            ),
            None,
        )
        if requested_revision
        else available[-1]
    )
    if selected is None:
        raise ProcurementRouteError(
            "PROCUREMENT_REVISION_INVALID", "Phiên bản TBMT không hợp lệ.", 400
        )
    raw_repository = ProcurementRawSnapshotRepository(database=database)
    opening = _load_opening_from_raw_snapshot(
        source,
        raw_repository,
        organization_id,
        notice_no,
        selected,
        max_age_seconds=(
            ProcurementLookupSettings.from_environ().raw_cache_ttl_seconds
        ),
    )
    if opening is None:
        opening = source.get_opening_bundle(notice_no, selected["revisionId"])
        captured_bundle = opening.pop("rawBundle", None)
        if isinstance(captured_bundle, dict):
            raw_repository.save_bundle(organization_id, captured_bundle)
    canonical = {
        "schemaVersion": "biddingflow-opening-import-preview-v1",
        "importKind": "OPENING",
        "provider": source.name,
        "package": {
            "id": str(package[0]),
            "rootId": str(package[1]),
            "rowVersion": int(package[2] or 1),
            "name": package[4],
        },
        "notice": {
            "noticeNo": notice_no,
            "availableRevisions": [
                str(row.get("revisionNumber")) for row in available
            ],
            "selectedRevision": str(selected.get("revisionNumber")),
            "revisionId": str(selected["revisionId"]),
        },
        "opening": opening,
        "warnings": (
            [{"code": "PROCUREMENT_PARTIAL_DATA"}]
            if opening.get("partial")
            else []
        ),
    }
    stored = PREVIEW_STORE.put(
        canonical,
        organization_id=organization_id,
        user_id=session.user_id,
        workspace_lease=lease,
    )
    return {
        **deepcopy(canonical),
        "previewId": stored.preview_id,
        "expiresAt": stored.expires_at.isoformat(),
        "bundleDigest": stored.bundle_digest,
    }


def _apply_opening_blocking(request, payload):
    session, organization_id, lease = _request_context(
        request, payload.get("workspaceLease")
    )
    _enforce_rate_limit(request, session.user_id, organization_id, "apply")
    stored = PREVIEW_STORE.get(
        payload.get("previewId"),
        organization_id=organization_id,
        user_id=session.user_id,
        workspace_lease=lease,
    )
    bundle = deepcopy(stored.canonical_bundle)
    if bundle.get("importKind") != "OPENING":
        raise ProcurementRouteError(
            "PROCUREMENT_PREVIEW_STALE", "Preview không thuộc luồng mở thầu.", 409
        )
    expected = payload.get("expectedPackageRowVersion")
    canonical_expected = int((bundle.get("package") or {}).get("rowVersion") or 0)
    if expected != canonical_expected:
        raise ProcurementRouteError(
            "PROCUREMENT_PREVIEW_STALE", "Gói thầu đã thay đổi sau preview.", 409
        )
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        if not has_module_permission(
            cursor,
            session,
            session.user_id,
            organization_id,
            "goithau",
            "edit",
        ):
            raise ProcurementRouteError(
                "ORGANIZATION_ACCESS_DENIED",
                "Không có quyền cập nhật thông tin mở thầu.",
                403,
            )
        row = cursor.execute(
            """SELECT row_version FROM goi_thau
                WHERE organization_id = ? AND id = ?
                  AND is_latest = 1 AND archived_at IS NULL""",
            (organization_id, bundle["package"]["id"]),
        ).fetchone()
    finally:
        connection.rollback()
        connection.close()
    if row is None or int(row[0] or 0) != canonical_expected:
        raise ProcurementRouteError(
            "PROCUREMENT_PREVIEW_STALE", "Gói thầu đã thay đổi sau preview.", 409
        )
    return {
        "ok": True,
        "package": bundle["package"],
        "notice": bundle["notice"],
        "opening": bundle["opening"],
        "warnings": bundle.get("warnings", []),
    }


def _validate_investor(cursor, organization_id, investor_id):
    row = cursor.execute(
        """SELECT id FROM chu_dau_tu
            WHERE organization_id = ? AND id = ?
              AND is_latest = 1 AND archived_at IS NULL""",
        (organization_id, str(investor_id or "")),
    ).fetchone()
    if row is None:
        raise ProcurementRouteError(
            "PROCUREMENT_REQUIRED_FIELDS_MISSING",
            "Phải chọn đúng chủ đầu tư hiện hữu.",
            422,
        )


def _validate_plan_predecessor(cursor, organization_id, plan_authority):
    """Validate the exact latest plan captured when the preview was made."""

    family_no = str((plan_authority or {}).get("familyNo") or "").strip().upper()
    expected = (plan_authority or {}).get("expectedPredecessor")
    if not family_no:
        return
    current = cursor.execute(
        """SELECT id, COALESCE(NULLIF(id_goc, ''), id), phien_ban,
                          row_version, is_latest
             FROM ke_hoach_lcnt
            WHERE organization_id = ? AND upper(ma_ke_hoach) = ?
              AND archived_at IS NULL AND is_latest = 1
            ORDER BY phien_ban DESC, id DESC LIMIT 1 FOR UPDATE""",
        (organization_id, family_no),
    ).fetchone()
    if expected is None:
        if current is not None:
            raise ProcurementRouteError(
                "PROCUREMENT_PREVIEW_STALE",
                "Kế hoạch đã xuất hiện sau khi tạo preview.",
                409,
            )
        return
    if current is None:
        raise ProcurementRouteError(
            "PROCUREMENT_PREVIEW_STALE",
            "Kế hoạch tiền nhiệm không còn tồn tại.",
            409,
        )
    actual = {
        "id": str(current[0]),
        "rootId": str(current[1]),
        "localVersion": int(current[2] or 0),
        "rowVersion": int(current[3] or 0),
    }
    expected_normalized = {
        "id": str(expected.get("id") or ""),
        "rootId": str(expected.get("rootId") or ""),
        "localVersion": int(expected.get("localVersion") or 0),
        "rowVersion": int(expected.get("rowVersion") or 0),
    }
    if actual != expected_normalized or not bool(current[4]):
        raise ProcurementRouteError(
            "PROCUREMENT_PREVIEW_STALE",
            "Kế hoạch đã thay đổi sau khi tạo preview.",
            409,
        )


def _validate_plan_local_target(cursor, organization_id, target):
    """Re-CAS one exact latest package target before serving a draft."""

    root_id = str((target or {}).get("localRootId") or "").strip()
    snapshot_id = str((target or {}).get("snapshotId") or "").strip()
    if not root_id or not snapshot_id:
        raise ProcurementRouteError(
            "PROCUREMENT_PREVIEW_STALE",
            "Gói thầu nội bộ không còn là đúng bản ghi đã xem trước.",
            409,
        )
    current = cursor.execute(
        """SELECT id, COALESCE(NULLIF(id_goc, ''), id), phien_ban,
                          row_version, is_latest
                     FROM goi_thau
                    WHERE organization_id = ? AND archived_at IS NULL
                      AND is_latest = 1
                      AND COALESCE(NULLIF(id_goc, ''), id) = ?
                    ORDER BY phien_ban DESC, id DESC LIMIT 1 FOR UPDATE""",
        (organization_id, root_id),
    ).fetchone()
    expected_local_version = (target or {}).get("localVersion")
    expected_row_version = (target or {}).get("rowVersion")
    expected_latest = bool((target or {}).get("isLatest", True))
    if current is None or str(current[0]) != snapshot_id or not bool(current[4]):
        stale = True
    else:
        stale = (
            expected_local_version is not None
            and int(current[2] or 0) != int(expected_local_version)
        ) or (
            expected_row_version is not None
            and int(current[3] or 0) != int(expected_row_version)
        ) or (bool(current[4]) != expected_latest)
    if stale:
        raise ProcurementRouteError(
            "PROCUREMENT_PREVIEW_STALE",
            "Gói thầu nội bộ đã thay đổi sau khi tạo preview.",
            409,
        )


def _resolve_revision_decisions(revision, preview_rows, decisions):
    try:
        resolved, package_decisions, _targets = resolve_revision_decisions(
            revision, preview_rows, decisions,
        )
        return resolved, package_decisions
    except ProcurementDecisionError as error:
        raise ProcurementRouteError(
            error.code, error.message, error.status_code,
        ) from error


def _deny_procurement_write(message):
    raise ProcurementRouteError(
        "ORGANIZATION_ACCESS_DENIED",
        message,
        403,
    )


def _reload_write_authority(cursor, session, organization_id):
    """Lock and rebuild the current write authority inside its transaction."""

    user_id = str(getattr(session, "user_id", "") or "").strip()
    session_id = str(getattr(session, "session_id", "") or "").strip()
    if not user_id or not session_id:
        raise ProcurementRouteError(
            "AUTHENTICATION_REQUIRED",
            "Phiên đăng nhập đã hết hạn! Vui lòng đăng nhập lại.",
            401,
        )
    row = cursor.execute(
        """SELECT accounts.id,
                  accounts.vai_tro,
                  accounts.trang_thai AS account_status,
                  sessions.id AS session_id,
                  sessions.idle_expires_at,
                  sessions.absolute_expires_at,
                  sessions.revoked_at,
                  sessions.active_role,
                  sessions.active_role_organization_id
             FROM auth_sessions AS sessions
             JOIN tai_khoan AS accounts ON accounts.id = sessions.user_id
            WHERE sessions.id = ? AND sessions.user_id = ?
            FOR UPDATE OF sessions, accounts""",
        (session_id, user_id),
    ).fetchone()
    session_user = dict(row) if row is not None else None
    if session_invalid_reason(session_user):
        raise ProcurementRouteError(
            "AUTHENTICATION_REQUIRED",
            "Phiên đăng nhập đã hết hạn! Vui lòng đăng nhập lại.",
            401,
        )

    if is_personal_scope_for_user(organization_id, user_id):
        membership_role = "employee"
        scope_type = "personal"
    else:
        membership = cursor.execute(
            """SELECT membership.vai_tro_trong_to_chuc,
                      membership.trang_thai_thanh_vien,
                      organization.trang_thai AS organization_status
                 FROM thanh_vien_to_chuc AS membership
                 JOIN to_chuc AS organization
                   ON organization.id = membership.organization_id
                WHERE membership.user_id = ?
                  AND membership.organization_id = ?
                FOR UPDATE OF membership, organization""",
            (user_id, organization_id),
        ).fetchone()
        if (
            membership is None
            or str(membership["trang_thai_thanh_vien"] or "").strip().lower()
            != "active"
            or str(membership["organization_status"] or "").strip().lower()
            != "active"
        ):
            _deny_procurement_write(
                "Không có quyền truy cập workspace hiện tại."
            )
        membership_role = str(
            membership["vai_tro_trong_to_chuc"] or ""
        ).strip().lower()
        if membership_role not in {"manager", "employee"}:
            _deny_procurement_write(
                "Vai trò thành viên trong workspace không hợp lệ."
            )
        scope_type = "organization"

    active_role = resolve_workspace_active_role(
        platform_role=session_user["vai_tro"],
        membership_role=membership_role,
        scope_type=scope_type,
        organization_id=organization_id,
        selected_role=session_user.get("active_role"),
        selected_organization_id=session_user.get(
            "active_role_organization_id"
        ),
    )
    return SessionRole(
        active_role,
        user_id,
        session_id,
        platform_role=session_user["vai_tro"],
        active_role=active_role,
        active_role_organization_id=(
            str(session_user.get("active_role_organization_id") or "").strip()
            or None
        ),
    )


def _require_module_edit(cursor, session, organization_id, module):
    cursor.execute(
        """SELECT 1
             FROM ma_tran_phan_quyen
            WHERE organization_id = ? AND emp_id = ?
            FOR UPDATE""",
        (organization_id, session.user_id),
    ).fetchone()
    if not has_module_permission(
        cursor,
        session,
        session.user_id,
        organization_id,
        module,
        "edit",
    ):
        _deny_procurement_write(
            "Không có quyền áp dụng dữ liệu nhập trong workspace hiện tại."
        )


def _require_record_write(
    cursor,
    session,
    organization_id,
    payload_key,
    table_name,
    item,
):
    decision = authorize_record_write(
        cursor,
        session,
        session.user_id,
        organization_id,
        payload_key,
        table_name,
        item,
    )
    if not decision.allowed:
        _deny_procurement_write(
            decision.message
            or "Không có quyền sửa bản ghi trong tiến trình nhập."
        )


def _lock_and_authorize_operation(
    cursor,
    organization_id,
    operation_id,
    actor_user_id,
):
    if not operation_id:
        return
    row = cursor.execute(
        """SELECT actor_user_id
             FROM procurement_import_operation
            WHERE organization_id = ? AND id = ?
            FOR UPDATE""",
        (organization_id, operation_id),
    ).fetchone()
    if row is None or str(row[0]) != str(actor_user_id):
        _deny_procurement_write(
            "Chỉ người tạo tiến trình được tiếp tục áp dụng."
        )


def _authorize_plan_revision_write(
    cursor,
    session,
    organization_id,
    provider,
    revision,
    operation_id,
):
    _require_module_edit(cursor, session, organization_id, "kehoach")
    _lock_and_authorize_operation(
        cursor,
        organization_id,
        operation_id,
        session.user_id,
    )
    family_no = str(revision.get("familyNo") or "").strip().upper()
    repository = ProcurementImportRepository(cursor)
    repository.lock_family(organization_id, provider, family_no)
    family = repository.load_family(organization_id, provider, family_no)
    plan = family.get("latestPlan")
    if plan is not None:
        _require_record_write(
            cursor,
            session,
            organization_id,
            "kehoach",
            "ke_hoach_lcnt",
            plan,
        )
    for package in family.get("packages") or []:
        _require_record_write(
            cursor,
            session,
            organization_id,
            "goithau",
            "goi_thau",
            package,
        )


def _authorize_notice_revision_write(
    cursor,
    session,
    organization_id,
    provider,
    notice,
    target_package_root_id,
    operation_id,
):
    _require_module_edit(cursor, session, organization_id, "goithau")
    _lock_and_authorize_operation(
        cursor,
        organization_id,
        operation_id,
        session.user_id,
    )
    notice_no = str(notice.get("noticeNo") or "").strip().upper()
    repository = ProcurementImportRepository(cursor)
    repository.lock_family(organization_id, provider, notice_no)
    target = repository.resolve_notice_target(
        organization_id,
        provider,
        notice_no,
        notice.get("relationship") or {},
        target_root_id=target_package_root_id,
    )
    if target is not None:
        _require_record_write(
            cursor,
            session,
            organization_id,
            "goithau",
            "goi_thau",
            target,
        )


def _apply_one(
    organization_id,
    session,
    provider,
    revision,
    idempotency_key,
    expected_plan_row_version,
    investor_id,
    package_decisions=None,
    operation_id=None,
    connection=None,
):
    owns_connection = connection is None
    connection = connection or database.get_connection()
    try:
        if owns_connection:
            connection.execute("BEGIN ISOLATION LEVEL SERIALIZABLE")
        cursor = connection.cursor()
        session = _reload_write_authority(cursor, session, organization_id)
        _authorize_plan_revision_write(
            cursor,
            session,
            organization_id,
            provider,
            revision,
            operation_id,
        )
        _validate_investor(cursor, organization_id, investor_id)
        normalized = deepcopy(revision)
        normalized["investorId"] = investor_id
        result = ProcurementPlanReconciler(
            ProcurementImportRepository(cursor)
        ).reconcile_revision(
            organization_id=organization_id,
            actor_user_id=session.user_id,
            provider=provider,
            revision=normalized,
            idempotency_key=idempotency_key,
            expected_plan_row_version=expected_plan_row_version,
            package_decisions=package_decisions,
            operation_id=operation_id,
        )
        if owns_connection:
            connection.commit()
        return result
    except Exception:
        if owns_connection:
            connection.rollback()
        raise
    finally:
        if owns_connection:
            connection.close()


def _apply_notice_one(
    organization_id,
    session,
    provider,
    notice,
    idempotency_key,
    expected_package_row_version,
    target_package_root_id,
    operation_id=None,
    connection=None,
):
    owns_connection = connection is None
    connection = connection or database.get_connection()
    try:
        if owns_connection:
            connection.execute("BEGIN ISOLATION LEVEL SERIALIZABLE")
        cursor = connection.cursor()
        session = _reload_write_authority(cursor, session, organization_id)
        _authorize_notice_revision_write(
            cursor,
            session,
            organization_id,
            provider,
            notice,
            target_package_root_id,
            operation_id,
        )
        result = ProcurementNoticeReconciler(
            ProcurementImportRepository(cursor)
        ).reconcile_revision(
            organization_id=organization_id,
            actor_user_id=session.user_id,
            provider=provider,
            notice=deepcopy(notice),
            idempotency_key=idempotency_key,
            expected_package_row_version=expected_package_row_version,
            target_package_root_id=target_package_root_id,
            operation_id=operation_id,
        )
        if owns_connection:
            connection.commit()
        return result
    except Exception:
        if owns_connection:
            connection.rollback()
        raise
    finally:
        if owns_connection:
            connection.close()


def _operation_id(organization_id, provider, family_no, idempotency_key):
    token = f"{organization_id}:{provider}:{family_no}:{idempotency_key}"
    return str(uuid5(NAMESPACE_URL, token))


def _create_operation(
    organization_id, session, bundle, stored, idempotency_key, decisions,
    expected_plan_row_version, resolved_revisions, package_decision_maps,
):
    operation_id = _operation_id(
        organization_id, bundle["provider"], bundle["plan"]["familyNo"], idempotency_key
    )
    request_hash = sha256(
        json.dumps(
            {
                "previewId": stored.preview_id, "decisions": decisions,
                "expectedPlanRowVersion": expected_plan_row_version,
                "bundleDigest": stored.bundle_digest,
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    manifest = [
        {
            "revisionId": revision["revisionId"],
            "revisionDigest": revision["revisionDigest"],
            "status": "PENDING",
            "canonicalRevision": deepcopy(revision),
            "investorId": decisions["investorId"],
            "expectedPlanRowVersion": (
                expected_plan_row_version if index == 0 else 1
            ),
        }
        for index, revision in enumerate(resolved_revisions)
    ]
    for index, package_decisions in enumerate(package_decision_maps):
        manifest[index]["packageDecisions"] = deepcopy(package_decisions)
    connection = database.get_connection()
    try:
        connection.execute("BEGIN ISOLATION LEVEL SERIALIZABLE")
        cursor = connection.cursor()
        session = _reload_write_authority(cursor, session, organization_id)
        _require_module_edit(cursor, session, organization_id, "kehoach")
        operation = ProcurementImportRepository(cursor).create_operation({
            "id": operation_id,
            "organizationId": organization_id,
            "provider": bundle["provider"],
            "familyNo": bundle["plan"]["familyNo"],
            "totalRevisions": len(resolved_revisions),
            "bundleDigest": stored.bundle_digest,
            "idempotencyKey": idempotency_key,
            "requestHash": request_hash,
            "actorUserId": session.user_id,
            "revisionResults": manifest,
        })
        if str(operation.get("actorUserId")) != str(session.user_id):
            _deny_procurement_write(
                "Idempotency key đã thuộc về một tiến trình khác."
            )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
    return (
        operation_id,
        operation["revisionResults"],
        operation["status"],
        operation["nextRevisionIndex"],
    )


def _create_notice_operation(
    organization_id,
    session,
    bundle,
    stored,
    idempotency_key,
    expected_package_row_version,
):
    family_no = bundle["notice"]["noticeNo"]
    operation_id = _operation_id(
        organization_id, bundle["provider"], family_no, idempotency_key
    )
    request_hash = sha256(
        json.dumps(
            {
                "previewId": stored.preview_id,
                "expectedPackageRowVersion": expected_package_row_version,
                "bundleDigest": stored.bundle_digest,
                "importKind": "NOTICE",
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    manifest = [
        {
            "importKind": "NOTICE",
            "revisionId": revision["revisionId"],
            "revisionDigest": revision["revisionDigest"],
            "status": "PENDING",
            "canonicalRevision": deepcopy(revision),
            "targetPackageRootId": bundle.get("targetPackageRootId"),
            "expectedPackageRowVersion": (
                expected_package_row_version if index == 0 else None
            ),
        }
        for index, revision in enumerate(bundle["revisions"])
    ]
    connection = database.get_connection()
    try:
        connection.execute("BEGIN ISOLATION LEVEL SERIALIZABLE")
        cursor = connection.cursor()
        session = _reload_write_authority(cursor, session, organization_id)
        _require_module_edit(cursor, session, organization_id, "goithau")
        operation = ProcurementImportRepository(cursor).create_operation({
            "id": operation_id,
            "organizationId": organization_id,
            "provider": bundle["provider"],
            "familyNo": family_no,
            "totalRevisions": len(bundle["revisions"]),
            "bundleDigest": stored.bundle_digest,
            "idempotencyKey": idempotency_key,
            "requestHash": request_hash,
            "actorUserId": session.user_id,
            "revisionResults": manifest,
        })
        if str(operation.get("actorUserId")) != str(session.user_id):
            _deny_procurement_write(
                "Idempotency key đã thuộc về một tiến trình khác."
            )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
    return (
        operation_id,
        operation["revisionResults"],
        operation["status"],
        operation["nextRevisionIndex"],
    )


def _update_operation(organization_id, operation_id, cursor, results, status):
    connection = database.get_connection()
    try:
        connection.execute("BEGIN ISOLATION LEVEL SERIALIZABLE")
        ProcurementImportRepository(connection.cursor()).update_operation(
            organization_id, operation_id, cursor=cursor, results=results, status=status
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _apply_blocking(request, payload):
    session, organization_id, lease = _request_context(
        request, payload.get("workspaceLease")
    )
    _enforce_rate_limit(request, session.user_id, organization_id, "apply")
    stored = PREVIEW_STORE.get(
        payload.get("previewId"), organization_id=organization_id,
        user_id=session.user_id, workspace_lease=lease,
    )
    bundle = deepcopy(stored.canonical_bundle)
    decisions = payload.get("decisions")
    if not isinstance(decisions, dict) or not decisions.get("investorId"):
        raise ProcurementRouteError(
            "PROCUREMENT_REQUIRED_FIELDS_MISSING",
            "Phải xác nhận chủ đầu tư.",
            422,
        )
    idempotency_key = str(payload.get("idempotencyKey") or "").strip()
    if not idempotency_key or len(idempotency_key) > 128:
        raise ProcurementRouteError(
            "PROCUREMENT_CODE_INVALID", "Idempotency key không hợp lệ.", 400
        )
    resolved_revisions = []
    package_decision_maps = []
    reconciliation = bundle.get("reconciliationByRevision") or {}
    dispositions = {
        str(row.get("revisionId")): row.get("disposition")
        for row in bundle.get("revisionPreviews") or []
    }
    active_revisions = [
        revision for revision in bundle["revisions"]
        if revision_requires_materialization(
            dispositions.get(str(revision.get("revisionId")))
        )
    ]
    if active_revisions:
        active_bundle = {
            **bundle,
            "revisions": active_revisions,
            "reconciliationByRevision": {
                str(revision.get("revisionId")): reconciliation.get(
                    str(revision.get("revisionId")), []
                )
                for revision in active_revisions
            },
        }
        authority = resolve_plan_decision_authority(active_bundle, decisions)
        resolved_by_id = {
            str(revision.get("revisionId")): revision
            for revision in authority["resolvedRevisions"]
        }
        package_decisions_by_id = authority["packageDecisionsByRevision"]
    else:
        resolved_by_id = {}
        package_decisions_by_id = {}
    for revision in bundle["revisions"]:
        revision_id = str(revision.get("revisionId"))
        if not revision_requires_materialization(dispositions.get(revision_id)):
            resolved, package_decisions = deepcopy(revision), {}
        else:
            resolved = deepcopy(resolved_by_id[revision_id])
            package_decisions = deepcopy(package_decisions_by_id[revision_id])
        resolved_revisions.append(resolved)
        package_decision_maps.append(package_decisions)
    all_history = bundle.get("revisionMode") == "ALL"
    operation_id = None
    results = []
    start_index = 0
    operation_status = None
    if all_history:
        operation_id, results, operation_status, start_index = _create_operation(
            organization_id, session, bundle, stored, idempotency_key,
            decisions, payload.get("expectedPlanRowVersion"),
            resolved_revisions, package_decision_maps,
        )
        if operation_status == "COMPLETED":
            return {
                "statusCode": 202, "operationId": operation_id,
                "status": "COMPLETED", "nextRevisionIndex": start_index,
                "revisionResults": [
                    _public_operation_result(row) for row in results
                ],
            }
    expected = payload.get("expectedPlanRowVersion")
    if start_index:
        expected = results[start_index].get("expectedPlanRowVersion")
    current_index = start_index
    batch_connection = None
    if operation_id:
        batch_connection = database.get_connection()
        batch_connection.execute("BEGIN ISOLATION LEVEL SERIALIZABLE")
    try:
        for index in range(start_index, len(resolved_revisions)):
            current_index = index
            revision = resolved_revisions[index]
            per_revision_key = f"{idempotency_key}:{revision['revisionId']}:{revision['revisionDigest']}"
            result = _apply_one(
                organization_id, session, bundle["provider"], revision,
                per_revision_key, expected, decisions["investorId"],
                package_decision_maps[index],
                operation_id,
                batch_connection,
            )
            public_result = {
                "revisionId": revision["revisionId"],
                "revisionDigest": revision["revisionDigest"],
                "outcome": result["operation"],
                "createdPlanIds": [row["id"] for row in result["createdPlans"]],
                "createdPackageIds": [row["id"] for row in result["createdPackages"]],
            }
            if operation_id:
                results[index].update(public_result)
                results[index]["status"] = "COMPLETED"
            else:
                results.append(public_result)
            expected = 1
        if batch_connection is not None:
            batch_connection.commit()
    except Exception as error:
        if batch_connection is not None:
            batch_connection.rollback()
        if operation_id:
            if current_index < len(results):
                results[current_index]["status"] = "FAILED"
                results[current_index]["errorCode"] = (
                    str(error) if isinstance(error, ImportConflict)
                    else "PROCUREMENT_APPLY_FAILED"
                )
            _update_operation(
                organization_id, operation_id, current_index, results, "FAILED"
            )
        raise
    finally:
        if batch_connection is not None:
            batch_connection.close()
    if operation_id:
        _update_operation(
            organization_id,
            operation_id,
            len(results),
            results,
            "COMPLETED",
        )
        return {
            "statusCode": 202, "operationId": operation_id,
            "status": "COMPLETED", "nextRevisionIndex": len(results),
            "revisionResults": [_public_operation_result(row) for row in results],
        }
    created_plan_ids = [value for row in results for value in row["createdPlanIds"]]
    created_package_ids = [value for row in results for value in row["createdPackageIds"]]
    return {
        "statusCode": 200,
        "ok": True,
        "operation": results[-1]["outcome"] if results else "NOOP",
        "created": {"planIds": created_plan_ids, "packageIds": created_package_ids},
        "authoritativeDelta": {"kehoachIds": created_plan_ids, "goithauIds": created_package_ids},
        "warnings": bundle.get("warnings", []),
    }


def _apply_notice_blocking(request, payload):
    session, organization_id, lease = _request_context(
        request, payload.get("workspaceLease")
    )
    _enforce_rate_limit(request, session.user_id, organization_id, "apply")
    stored = PREVIEW_STORE.get(
        payload.get("previewId"), organization_id=organization_id,
        user_id=session.user_id, workspace_lease=lease,
    )
    bundle = deepcopy(stored.canonical_bundle)
    if bundle.get("importKind") != "NOTICE":
        raise ProcurementRouteError(
            "PROCUREMENT_PREVIEW_STALE", "Preview không thuộc luồng thông báo.", 409
        )
    if bundle.get("blockingIssues"):
        raise ProcurementRouteError(
            "PROCUREMENT_NOTICE_PACKAGE_UNRESOLVED",
            "Chưa xác định chắc chắn gói thầu nhận thông báo.",
            422,
        )
    idempotency_key = str(payload.get("idempotencyKey") or "").strip()
    if not idempotency_key or len(idempotency_key) > 128:
        raise ProcurementRouteError(
            "PROCUREMENT_CODE_INVALID", "Idempotency key không hợp lệ.", 400
        )
    expected = payload.get("expectedPackageRowVersion")
    canonical_expected = (bundle.get("notice") or {}).get(
        "expectedPackageRowVersion"
    )
    if expected != canonical_expected:
        raise ProcurementRouteError(
            "PROCUREMENT_PREVIEW_STALE", "Package đã thay đổi sau preview.", 409
        )
    revisions = bundle.get("revisions") or []
    if not revisions:
        raise ProcurementRouteError(
            "PROCUREMENT_PREVIEW_STALE", "Preview không còn revision hợp lệ.", 409
        )
    operation_id = None
    results = []
    start_index = 0
    operation_status = None
    if bundle.get("revisionMode") == "ALL":
        operation_id, results, operation_status, start_index = (
            _create_notice_operation(
                organization_id,
                session,
                bundle,
                stored,
                idempotency_key,
                expected,
            )
        )
        if operation_status == "COMPLETED":
            return {
                "statusCode": 202,
                "operationId": operation_id,
                "status": "COMPLETED",
                "nextRevisionIndex": start_index,
                "revisionResults": [
                    _public_operation_result(row) for row in results
                ],
            }
    current_index = start_index
    if start_index:
        expected = results[start_index - 1].get(
            "nextExpectedPackageRowVersion", expected
        )
    batch_connection = None
    if operation_id:
        batch_connection = database.get_connection()
        batch_connection.execute("BEGIN ISOLATION LEVEL SERIALIZABLE")
    try:
        for index in range(start_index, len(revisions)):
            current_index = index
            revision = revisions[index]
            per_revision_key = (
                f"{idempotency_key}:{revision['revisionId']}:"
                f"{revision['revisionDigest']}"
            )
            result = _apply_notice_one(
                organization_id,
                session,
                bundle["provider"],
                revision,
                per_revision_key,
                expected,
                bundle.get("targetPackageRootId"),
                operation_id,
                batch_connection,
            )
            package_ids = [
                row["id"] for row in result.get("createdPackages", [])
            ]
            next_expected = 1 if package_ids else expected
            public_result = {
                "revisionId": revision["revisionId"],
                "revisionDigest": revision["revisionDigest"],
                "outcome": result["operation"],
                "createdPlanIds": [],
                "createdPackageIds": package_ids,
                "nextExpectedPackageRowVersion": next_expected,
            }
            if operation_id:
                results[index].update(public_result)
                results[index]["status"] = "COMPLETED"
            else:
                results.append(public_result)
            expected = next_expected
        if batch_connection is not None:
            batch_connection.commit()
    except Exception as error:
        if batch_connection is not None:
            batch_connection.rollback()
        if operation_id:
            results[current_index]["status"] = "FAILED"
            results[current_index]["errorCode"] = (
                str(error)
                if isinstance(error, ImportConflict)
                else "PROCUREMENT_APPLY_FAILED"
            )
            _update_operation(
                organization_id,
                operation_id,
                current_index,
                results,
                "FAILED",
            )
        raise
    finally:
        if batch_connection is not None:
            batch_connection.close()
    if operation_id:
        _update_operation(
            organization_id,
            operation_id,
            len(results),
            results,
            "COMPLETED",
        )
        return {
            "statusCode": 202,
            "operationId": operation_id,
            "status": "COMPLETED",
            "nextRevisionIndex": len(results),
            "revisionResults": [_public_operation_result(row) for row in results],
        }
    package_ids = [
        value for row in results for value in row.get("createdPackageIds", [])
    ]
    return {
        "statusCode": 200,
        "ok": True,
        "operation": results[-1]["outcome"] if results else "NOOP",
        "created": {"planIds": [], "packageIds": package_ids},
        "authoritativeDelta": {"kehoachIds": [], "goithauIds": package_ids},
        "warnings": bundle.get("warnings", []),
    }


def _get_operation_blocking(request, operation_id):
    _session, organization_id, _lease = _request_context(request, None)
    connection = database.get_connection()
    try:
        operation = ProcurementImportRepository(connection.cursor()).get_operation(
            organization_id, operation_id
        )
    finally:
        connection.close()
    if operation is None:
        raise ProcurementRouteError(
            "PROCUREMENT_OPERATION_NOT_FOUND", "Không tìm thấy tiến trình nhập.", 404
        )
    operation["revisionResults"] = [
        _public_operation_result(row) for row in operation["revisionResults"]
    ]
    operation.pop("actorUserId", None)
    operation.pop("requestHash", None)
    return operation


def _public_operation_result(row):
    return {
        key: deepcopy(value)
        for key, value in row.items()
        if key not in {
            "canonicalRevision", "investorId", "expectedPlanRowVersion",
            "packageDecisions",
            "targetPackageRootId",
            "expectedPackageRowVersion",
        }
    }


def _resume_blocking(request, operation_id):
    session, organization_id, _lease = _request_context(request, None)
    batch_connection = database.get_connection()
    operation = None
    results = []
    current_index = 0
    resume_started = False
    try:
        batch_connection.execute("BEGIN ISOLATION LEVEL SERIALIZABLE")
        cursor = batch_connection.cursor()
        session = _reload_write_authority(cursor, session, organization_id)
        operation = ProcurementImportRepository(cursor).get_operation(
            organization_id, operation_id
        )
        if operation is None:
            raise ProcurementRouteError(
                "PROCUREMENT_OPERATION_NOT_FOUND",
                "Không tìm thấy tiến trình nhập.",
                404,
            )
        _lock_and_authorize_operation(
            cursor,
            organization_id,
            operation_id,
            session.user_id,
        )
        operation = ProcurementImportRepository(cursor).get_operation(
            organization_id, operation_id
        )
        first_entry = next(iter(operation.get("revisionResults") or []), {})
        _require_module_edit(
            cursor,
            session,
            organization_id,
            (
                "goithau"
                if first_entry.get("importKind") == "NOTICE"
                else "kehoach"
            ),
        )
        if operation["status"] == "COMPLETED":
            batch_connection.rollback()
            operation["revisionResults"] = [
                _public_operation_result(row)
                for row in operation["revisionResults"]
            ]
            operation.pop("actorUserId", None)
            operation.pop("requestHash", None)
            return operation
        results = operation["revisionResults"]
        start = operation["nextRevisionIndex"]
        current_index = start
        resume_started = True
        for index in range(start, len(results)):
            current_index = index
            entry = results[index]
            revision = entry.get("canonicalRevision")
            if not isinstance(revision, dict):
                raise ProcurementRouteError(
                    "PROCUREMENT_PREVIEW_STALE",
                    "Không còn canonical revision để resume.",
                    409,
                )
            key = (
                f"{operation_id}:{revision['revisionId']}:"
                f"{revision['revisionDigest']}"
            )
            if entry.get("importKind") == "NOTICE":
                expected = entry.get("expectedPackageRowVersion")
                if index > 0:
                    expected = results[index - 1].get(
                        "nextExpectedPackageRowVersion", expected
                    )
                result = _apply_notice_one(
                    organization_id,
                    session,
                    operation["provider"],
                    revision,
                    key,
                    expected,
                    entry.get("targetPackageRootId"),
                    operation_id,
                    batch_connection,
                )
            else:
                result = _apply_one(
                    organization_id, session, operation["provider"], revision,
                    key, entry.get("expectedPlanRowVersion"), entry.get("investorId"),
                    entry.get("packageDecisions") or {},
                    operation_id,
                    batch_connection,
                )
            created_package_ids = [
                row["id"] for row in result["createdPackages"]
            ]
            entry.update({
                "status": "COMPLETED", "outcome": result["operation"],
                "createdPlanIds": [row["id"] for row in result["createdPlans"]],
                "createdPackageIds": created_package_ids,
            })
            if entry.get("importKind") == "NOTICE":
                entry["nextExpectedPackageRowVersion"] = (
                    1 if created_package_ids else expected
                )
            entry.pop("errorCode", None)
        batch_connection.commit()
    except Exception as error:
        batch_connection.rollback()
        if resume_started and current_index < len(results):
            results[current_index]["status"] = "FAILED"
            results[current_index]["errorCode"] = (
                error.code
                if isinstance(error, ProcurementRouteError)
                else str(error)
                if isinstance(error, ImportConflict)
                else "PROCUREMENT_APPLY_FAILED"
            )
        if resume_started:
            _update_operation(
                organization_id, operation_id, current_index, results, "FAILED"
            )
        raise
    finally:
        batch_connection.close()
    _update_operation(
        organization_id,
        operation_id,
        len(results),
        results,
        "COMPLETED",
    )
    public_operation = {
        **operation,
        "status": "COMPLETED",
        "nextRevisionIndex": len(results),
        "revisionResults": [_public_operation_result(row) for row in results],
    }
    public_operation.pop("actorUserId", None)
    public_operation.pop("requestHash", None)
    return public_operation


def _public_error(request, error):
    if isinstance(error, ProcurementDecisionError):
        return error_response(
            request, error.code, error.message, status_code=error.status_code
        )
    if isinstance(error, ProcurementRouteError):
        return error_response(
            request, error.code, error.message, status_code=error.status_code
        )
    if isinstance(error, PermissionError):
        return error_response(
            request, "ORGANIZATION_ACCESS_DENIED", "Preview không thuộc workspace hiện tại.", status_code=403
        )
    if type(error) is LookupError and error.args:
        if error.args[0] == "PROCUREMENT_SESSION_EXPIRED":
            return error_response(
                request, "PROCUREMENT_SESSION_EXPIRED",
                "Phiên nhập đã hết hạn hoặc không còn tồn tại.", status_code=410,
            )
        if error.args[0] == "PROCUREMENT_PREVIEW_EXPIRED":
            return error_response(
                request, "PROCUREMENT_PREVIEW_EXPIRED", "Preview đã hết hạn.", status_code=410
            )
        if error.args[0] == "PROCUREMENT_REVISION_INVALID":
            return error_response(
                request,
                "PROCUREMENT_REVISION_INVALID",
                "Không tìm thấy phiên bản nguồn phù hợp với mã đã nhập.",
                status_code=400,
            )
        if error.args[0] == "PROCUREMENT_ENRICHMENT_PENDING":
            return error_response(
                request,
                "PROCUREMENT_ENRICHMENT_PENDING",
                "Dữ liệu TBMT liên kết đang được bổ sung; hãy thử lại sau khi tiến trình hoàn tất.",
                status_code=409,
            )
        if error.args[0] == "PROCUREMENT_ENRICHMENT_INCOMPLETE":
            return error_response(
                request,
                "PROCUREMENT_ENRICHMENT_INCOMPLETE",
                "Chưa thể lấy đầy đủ dữ liệu TBMT liên kết; hãy chuẩn bị lại kế hoạch.",
                status_code=409,
            )
    if isinstance(error, ValueError) and error.args:
        messages = {
            "PROCUREMENT_CODE_INVALID": "Mã procurement không hợp lệ.",
            "PROCUREMENT_REVISION_INVALID": (
                "Phiên bản procurement không hợp lệ."
            ),
        }
        code = error.args[0]
        if code in messages:
            return error_response(
                request, code, messages[code], status_code=400
            )
    if isinstance(error, ImportConflict):
        code = str(error)
        return error_response(request, code, "Dữ liệu import đang xung đột.", status_code=409)
    if isinstance(error, ProcurementSourceError):
        code = str(error)
        if code == "PROCUREMENT_NOT_FOUND":
            status = 404
        elif code in {
            "BLOCKED BY EXTERNAL/API AUTHORIZATION",
            "PROCUREMENT_LOOKUP_DISABLED",
        }:
            status = 503
        else:
            status = 502
        public_code = "PROCUREMENT_LOOKUP_DISABLED" if code == "BLOCKED BY EXTERNAL/API AUTHORIZATION" else code
        return error_response(request, public_code, "Nguồn procurement chưa khả dụng.", status_code=status)
    if isinstance(error, OrgPermissionError):
        return error_response(
            request, "ORGANIZATION_ACCESS_DENIED", "Không có quyền truy cập tổ chức.", status_code=403
        )
    if isinstance(error, BlockingIOBusyError):
        return error_response(
            request, "PROCUREMENT_LOOKUP_BUSY", "Dịch vụ đang bận.", status_code=503
        )
    if isinstance(error, BlockingIOTimeoutError):
        return error_response(
            request, "PROCUREMENT_LOOKUP_TIMEOUT", "Tra cứu đã hết thời gian.", status_code=504
        )
    return None


async def prepare_plan_import(request):
    payload, invalid = await read_json_object(request)
    if invalid:
        return invalid
    if set(payload) - _PREPARE_FIELDS:
        return error_response(
            request, "PROCUREMENT_CODE_INVALID", "Request chứa field không được hỗ trợ.", status_code=400
        )
    try:
        result = await run_blocking_io(
            _prepare_blocking, request, payload,
            timeout_seconds=_source_timeout_seconds(),
        )
        return JSONResponse(_start_plan_enrichment(result))
    except Exception as error:  # noqa: BLE001 - sanitized boundary.
        response = _public_error(request, error)
        return response or log_and_error(
            request, error, "prepare_procurement_import",
            "PROCUREMENT_UPSTREAM_UNAVAILABLE", "Không thể chuẩn bị dữ liệu nhập.", status_code=502,
        )


async def apply_plan_import(request):
    payload, invalid = await read_json_object(request)
    if invalid:
        return invalid
    if set(payload) - _APPLY_FIELDS:
        return error_response(
            request, "PROCUREMENT_CODE_INVALID", "Apply không nhận canonical source payload.", status_code=400
        )
    try:
        result = await run_blocking_io(_apply_blocking, request, payload, timeout_seconds=120)
        return JSONResponse(
            {key: value for key, value in result.items() if key != "statusCode"},
            status_code=result["statusCode"],
        )
    except Exception as error:  # noqa: BLE001 - sanitized boundary.
        response = _public_error(request, error)
        return response or log_and_error(
            request, error, "apply_procurement_import",
            "PROCUREMENT_APPLY_FAILED", "Không thể áp dụng dữ liệu nhập.", status_code=500,
        )


async def get_plan_import_session(request):
    try:
        result = await run_blocking_io(
            _get_import_session_blocking,
            request,
            request.path_params.get("session_id", ""),
            timeout_seconds=8,
        )
        return JSONResponse(result)
    except Exception as error:  # noqa: BLE001 - sanitized boundary.
        response = _public_error(request, error)
        return response or log_and_error(
            request, error, "get_procurement_import_session",
            "PROCUREMENT_SESSION_FAILED", "Không thể đọc phiên nhập.", status_code=500,
        )


async def bind_plan_import_session_decisions(request):
    payload, invalid = await read_json_object(request)
    if invalid:
        return invalid
    if set(payload) - _SESSION_DECISION_FIELDS:
        return error_response(
            request,
            "PROCUREMENT_DECISION_INVALID",
            "Request quyết định chứa field không được hỗ trợ.",
            status_code=400,
        )
    try:
        result = await run_blocking_io(
            _bind_import_session_decisions_blocking,
            request,
            request.path_params.get("session_id", ""),
            payload,
            timeout_seconds=8,
        )
        return JSONResponse(result)
    except Exception as error:  # noqa: BLE001 - sanitized boundary.
        response = _public_error(request, error)
        return response or log_and_error(
            request,
            error,
            "bind_procurement_import_session_decisions",
            "PROCUREMENT_SESSION_FAILED",
            "Không thể xác nhận quyết định nhập.",
            status_code=500,
        )


async def get_plan_import_revision(request):
    try:
        result = await run_blocking_io(
            _get_import_session_blocking,
            request,
            request.path_params.get("session_id", ""),
            request.path_params.get("revision_number", ""),
            timeout_seconds=8,
        )
        return JSONResponse(result)
    except Exception as error:  # noqa: BLE001 - sanitized boundary.
        response = _public_error(request, error)
        return response or log_and_error(
            request, error, "get_procurement_import_revision",
            "PROCUREMENT_SESSION_FAILED", "Không thể đọc dữ liệu phiên bản.", status_code=500,
        )


async def cancel_import_session(request):
    try:
        result = await run_blocking_io(
            _cancel_import_session_blocking,
            request,
            request.path_params.get("session_id", ""),
            timeout_seconds=8,
        )
        return JSONResponse(result)
    except Exception as error:  # noqa: BLE001 - sanitized boundary.
        response = _public_error(request, error)
        return response or log_and_error(
            request, error, "cancel_procurement_import_session",
            "PROCUREMENT_SESSION_FAILED", "Không thể kết thúc phiên nhập.", status_code=500,
        )


async def prepare_notice_import(request):
    payload, invalid = await read_json_object(request)
    if invalid:
        return invalid
    if set(payload) - _NOTICE_PREPARE_FIELDS:
        return error_response(
            request, "PROCUREMENT_CODE_INVALID",
            "Request chứa field không được hỗ trợ.", status_code=400,
        )
    try:
        result = await run_blocking_io(
            _prepare_notice_blocking, request, payload,
            timeout_seconds=_source_timeout_seconds(),
        )
        return JSONResponse(result)
    except Exception as error:  # noqa: BLE001 - sanitized boundary.
        response = _public_error(request, error)
        return response or log_and_error(
            request, error, "prepare_procurement_notice_import",
            "PROCUREMENT_UPSTREAM_UNAVAILABLE",
            "Không thể chuẩn bị dữ liệu thông báo.", status_code=502,
        )


async def apply_notice_import(request):
    payload, invalid = await read_json_object(request)
    if invalid:
        return invalid
    if set(payload) - _NOTICE_APPLY_FIELDS:
        return error_response(
            request, "PROCUREMENT_CODE_INVALID",
            "Apply không nhận canonical source payload.", status_code=400,
        )
    try:
        result = await run_blocking_io(
            _apply_notice_blocking, request, payload, timeout_seconds=120
        )
        return JSONResponse(
            {key: value for key, value in result.items() if key != "statusCode"},
            status_code=result["statusCode"],
        )
    except Exception as error:  # noqa: BLE001 - sanitized boundary.
        response = _public_error(request, error)
        return response or log_and_error(
            request, error, "apply_procurement_notice_import",
            "PROCUREMENT_APPLY_FAILED",
            "Không thể áp dụng dữ liệu thông báo.", status_code=500,
        )


async def prepare_opening_import(request):
    payload, invalid = await read_json_object(request)
    if invalid:
        return invalid
    if set(payload) - _OPENING_PREPARE_FIELDS:
        return error_response(
            request,
            "PROCUREMENT_CODE_INVALID",
            "Request chứa field không được hỗ trợ.",
            status_code=400,
        )
    try:
        result = await run_blocking_io(
            _prepare_opening_blocking,
            request,
            payload,
            timeout_seconds=_source_timeout_seconds(),
        )
        return JSONResponse(result)
    except Exception as error:  # noqa: BLE001 - sanitized boundary.
        response = _public_error(request, error)
        return response or log_and_error(
            request,
            error,
            "prepare_procurement_opening_import",
            "PROCUREMENT_UPSTREAM_UNAVAILABLE",
            "Không thể chuẩn bị dữ liệu mở thầu.",
            status_code=502,
        )


async def apply_opening_import(request):
    payload, invalid = await read_json_object(request)
    if invalid:
        return invalid
    if set(payload) - _OPENING_APPLY_FIELDS:
        return error_response(
            request,
            "PROCUREMENT_CODE_INVALID",
            "Apply không nhận canonical source payload.",
            status_code=400,
        )
    try:
        result = await run_blocking_io(
            _apply_opening_blocking, request, payload, timeout_seconds=30
        )
        return JSONResponse(result)
    except Exception as error:  # noqa: BLE001 - sanitized boundary.
        response = _public_error(request, error)
        return response or log_and_error(
            request,
            error,
            "apply_procurement_opening_import",
            "PROCUREMENT_APPLY_FAILED",
            "Không thể áp dụng dữ liệu mở thầu.",
            status_code=500,
        )
async def get_import_operation(request):
    try:
        result = await run_blocking_io(
            _get_operation_blocking, request,
            request.path_params.get("operation_id", ""), timeout_seconds=8,
        )
        return JSONResponse(result)
    except Exception as error:  # noqa: BLE001 - sanitized boundary.
        response = _public_error(request, error)
        return response or log_and_error(
            request, error, "get_procurement_operation",
            "PROCUREMENT_OPERATION_FAILED", "Không thể đọc tiến trình nhập.", status_code=500,
        )


async def resume_import_operation(request):
    try:
        result = await run_blocking_io(
            _resume_blocking, request, request.path_params.get("operation_id", ""),
            timeout_seconds=120,
        )
        return JSONResponse(result)
    except Exception as error:  # noqa: BLE001 - sanitized boundary.
        response = _public_error(request, error)
        return response or log_and_error(
            request, error, "resume_procurement_operation",
            "PROCUREMENT_OPERATION_FAILED", "Không thể resume tiến trình nhập.", status_code=500,
        )


def procurement_import_routes(Route):
    return [
        Route("/api/procurement/imports/plan/prepare", prepare_plan_import, methods=["POST"]),
        Route("/api/procurement/imports/plan/sessions/{session_id}/revisions/{revision_number}", get_plan_import_revision, methods=["GET"]),
        Route("/api/procurement/imports/plan/sessions/{session_id}/decisions", bind_plan_import_session_decisions, methods=["POST"]),
        Route("/api/procurement/imports/plan/sessions/{session_id}", get_plan_import_session, methods=["GET"]),
        Route("/api/procurement/imports/plan/sessions/{session_id}/cancel", cancel_import_session, methods=["POST"]),
        Route("/api/procurement/imports/plan/apply", apply_plan_import, methods=["POST"]),
        Route("/api/procurement/imports/notice/prepare", prepare_notice_import, methods=["POST"]),
        Route("/api/procurement/imports/notice/sessions/{session_id}/revisions/{revision_number}", get_plan_import_revision, methods=["GET"]),
        Route("/api/procurement/imports/notice/sessions/{session_id}", get_plan_import_session, methods=["GET"]),
        Route("/api/procurement/imports/notice/sessions/{session_id}/cancel", cancel_import_session, methods=["POST"]),
        Route("/api/procurement/imports/notice/apply", apply_notice_import, methods=["POST"]),
        Route("/api/procurement/imports/opening/prepare", prepare_opening_import, methods=["POST"]),
        Route("/api/procurement/imports/opening/apply", apply_opening_import, methods=["POST"]),
        Route("/api/procurement/imports/operations/{operation_id}", get_import_operation, methods=["GET"]),
        Route("/api/procurement/imports/operations/{operation_id}/resume", resume_import_operation, methods=["POST"]),
    ]
