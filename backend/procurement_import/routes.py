"""Authenticated HTTP boundary for procurement prepare/apply/status/resume."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from hashlib import sha256
import json
import os
import re
from uuid import NAMESPACE_URL, uuid5

from starlette.responses import JSONResponse

from backend.auth.auth_service import get_client_ip, get_rate_limit_decision
from backend.integrations.vneps.fake_procurement_provider import FixtureProcurementSource
from backend.integrations.vneps.procurement_provider import VnepsProcurementSource
from backend.integrations.muasamcong_browser.registry import (
    get_muasamcong_source,
)
from backend.procurement_import.command import (
    ProcurementNoticeReconciler,
    ProcurementPlanReconciler,
)
from backend.procurement_import.domain import (
    ImportConflict,
    SOURCE_OWNED_PACKAGE_FIELDS,
    required_package_issues,
)
from backend.procurement_import.repository import ProcurementImportRepository
from backend.procurement_import.repository import ProcurementImportSessionRepository
from backend.procurement_import.service import ProcurementImportPreparer, PreviewStore
from backend.procurement_import.session import ProcurementImportSessionService
from backend.procurement_raw import ProcurementRawSnapshotRepository
from backend.procurement_import.source import ProcurementSourceError
from backend.procurement_lookup.config import ProcurementLookupSettings
from backend.shared.async_io import (
    BlockingIOBusyError,
    BlockingIOTimeoutError,
    run_blocking_io,
)
from backend.shared.helpers import OrgPermissionError, database, get_active_org, verify_session
from backend.shared.access_policy import has_module_permission
from backend.shared.logging_utils import error_response, log_and_error
from backend.shared.request_validation import read_json_object


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


@dataclass(frozen=True, slots=True)
class ProcurementRouteError(RuntimeError):
    code: str
    message: str
    status_code: int

    def __str__(self):
        return self.message


def _enabled():
    return os.environ.get(
        "PROCUREMENT_IMPORT_ENABLED",
        os.environ.get("VNEPS_PROCUREMENT_IMPORT_ENABLED", "false"),
    ).strip().casefold() == "true"


def _provider_name():
    explicit = str(os.environ.get("PROCUREMENT_PROVIDER") or "").strip()
    if explicit:
        return explicit.casefold()
    lookup_enabled = str(
        os.environ.get("PROCUREMENT_LOOKUP_ENABLED") or ""
    ).strip().casefold() == "true"
    if lookup_enabled:
        return "muasamcong"
    return str(
        os.environ.get("VNEPS_PROCUREMENT_PROVIDER", "disabled")
    ).strip().casefold()


def _source_timeout_seconds():
    provider = _provider_name()
    if provider in {"muasamcong", "web_dau_thau"}:
        return max(
            20.0,
            min(
                float(
                    os.environ.get(
                        "MUASAMCONG_REQUEST_TIMEOUT_SECONDS", "60"
                    )
                ),
                120.0,
            ),
        )
    return max(
        1.0,
        min(
            float(os.environ.get("VNEPS_PROCUREMENT_TIMEOUT_SECONDS", "8")),
            120.0,
        ),
    )


def build_procurement_source():
    if not _enabled():
        raise ProcurementRouteError(
            "PROCUREMENT_LOOKUP_DISABLED",
            "Tính năng nhập Mua Sắm Công chưa được bật.",
            503,
        )
    provider = _provider_name()
    if provider == "fixture":
        if os.environ.get("APP_ENV", "").strip().casefold() not in {
            "test", "testing",
        }:
            raise ProcurementRouteError(
                "PROCUREMENT_LOOKUP_DISABLED",
                "Fixture procurement chỉ được phép trong APP_ENV=test.",
                503,
            )
        path = os.environ.get("VNEPS_PROCUREMENT_FIXTURE_PATH", "").strip()
        if not path:
            raise ProcurementRouteError(
                "PROCUREMENT_LOOKUP_DISABLED", "Chưa cấu hình fixture provider.", 503
            )
        return FixtureProcurementSource(path)
    if provider == "vneps":
        return VnepsProcurementSource()
    if provider in {"muasamcong", "web_dau_thau"}:
        return get_muasamcong_source()
    raise ProcurementRouteError(
        "PROCUREMENT_LOOKUP_DISABLED",
        "Connector procurement chưa được cấu hình.",
        503,
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
    preview = _build_import_preparer(source).prepare_plan(
        code=payload.get("code"),
        revision_mode=payload.get("revisionMode") or "LATEST",
        selected_revision=payload.get("selectedRevision"),
        include_linked_notices=payload.get("includeLinkedNotices", True),
        organization_id=organization_id,
        user_id=session.user_id,
        workspace_lease=lease,
        local_state=local_state,
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
        )
    finally:
        connection.rollback()
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


def _load_opening_from_raw_snapshot(
    source,
    raw_repository,
    organization_id,
    notice_no,
    selected_revision,
    *,
    max_age_seconds=900,
):
    """Project an exact complete opening snapshot without an upstream call."""

    loader = getattr(raw_repository, "load_fresh_notice_bundle", None)
    projector = getattr(source, "lookup_from_raw_bundle", None)
    if not callable(loader) or not callable(projector):
        return None
    revision_number = str(
        selected_revision.get("revisionNumber") or ""
    ).strip()
    raw_bundle = loader(
        organization_id,
        notice_no,
        detail_level="COMPLETE",
        revision_mode="SELECTED",
        revision_numbers=[revision_number],
        max_age_seconds=max_age_seconds,
    )
    if not isinstance(raw_bundle, dict) or raw_bundle.get("complete") is not True:
        return None
    projected = projector(
        notice_no,
        raw_bundle,
        revision_mode="SELECTED",
        detail_level="COMPLETE",
    )
    revisions = (projected.get("canonical") or {}).get("revisions") or []
    revision = next((
        row for row in revisions
        if str(row.get("revisionId") or "")
        == str(selected_revision.get("revisionId") or "")
        and str(row.get("revisionNumber") or "") == revision_number
    ), None)
    opening = (revision or {}).get("opening")
    if not isinstance(opening, dict) or not isinstance(opening.get("bidders"), list):
        return None
    return {
        **deepcopy(opening),
        "schemaVersion": "biddingflow-opening-bundle-v1",
        "partial": False,
        "failedOperations": [],
        "source": {
            "provider": getattr(source, "name", "MUASAMCONG"),
            "driver": "raw-snapshot",
            "retrievedAt": raw_bundle.get("retrievedAt"),
        },
    }


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


def _decision_rows(decisions, key):
    rows = decisions.get(key, [])
    if not isinstance(rows, list) or len(rows) > 500 or not all(
        isinstance(row, dict) for row in rows
    ):
        raise ProcurementRouteError(
            "PROCUREMENT_DECISION_INVALID", "Quyết định preview không hợp lệ.", 400
        )
    return rows


def _resolve_revision_decisions(revision, preview_rows, decisions):
    observations = {
        str(row.get("planDetailRevisionId") or ""): row
        for row in revision.get("packages") or []
    }
    preview_by_id = {
        str(row.get("planDetailRevisionId") or ""): row
        for row in preview_rows
        if row.get("planDetailRevisionId")
    }
    package_decisions = {}
    for row in _decision_rows(decisions, "packageMatches"):
        observation_id = str(row.get("packageObservationId") or "")
        if observation_id not in observations:
            continue
        preview = preview_by_id.get(observation_id)
        if not preview or preview.get("action") != "AMBIGUOUS":
            raise ProcurementRouteError(
                "PROCUREMENT_MATCH_DECISION_INVALID",
                "Quyết định ghép gói không thuộc preview hiện tại.", 409,
            )
        selected_root = str(row.get("localRootId") or "").strip()
        is_new = row.get("new") is True
        candidate_roots = {
            str(candidate.get("rootId") or "")
            for candidate in preview.get("matchCandidates") or []
        }
        if is_new == bool(selected_root) or (
            selected_root and selected_root not in candidate_roots
        ):
            raise ProcurementRouteError(
                "PROCUREMENT_MATCH_DECISION_INVALID",
                "Dòng gói được chọn không hợp lệ.", 409,
            )
        package_decisions[observation_id] = (
            {"new": True} if is_new else {"localRootId": selected_root}
        )
    unresolved_matches = [
        row for row in preview_rows
        if row.get("action") == "AMBIGUOUS"
        and str(row.get("planDetailRevisionId") or "") not in package_decisions
    ]
    if unresolved_matches:
        raise ProcurementRouteError(
            "PROCUREMENT_MATCH_AMBIGUOUS",
            "Phải xác nhận mọi gói có kết quả ghép mơ hồ.", 409,
        )

    allowed_fields = set(SOURCE_OWNED_PACKAGE_FIELDS)
    overrides = {
        observation_id: deepcopy(preview.get("effectiveFields") or {})
        for observation_id, preview in preview_by_id.items()
        if preview.get("effectiveFields")
    }
    for row in _decision_rows(decisions, "fieldValues"):
        observation_id = str(row.get("packageObservationId") or "")
        field = str(row.get("field") or "")
        if observation_id not in observations:
            continue
        if field not in allowed_fields:
            raise ProcurementRouteError(
                "PROCUREMENT_DECISION_INVALID", "Field bổ sung không hợp lệ.", 400
            )
        overrides.setdefault(observation_id, {})[field] = deepcopy(row.get("value"))

    conflict_resolutions = {}
    for row in _decision_rows(decisions, "fieldConflicts"):
        observation_id = str(row.get("packageObservationId") or "")
        field = str(row.get("field") or "")
        if observation_id not in observations:
            continue
        resolution = str(row.get("resolution") or "").upper()
        preview = preview_by_id.get(observation_id) or {}
        conflict = next((
            item for item in preview.get("fieldConflicts") or []
            if item.get("field") == field
        ), None)
        if conflict is None or resolution not in {"KEEP_LOCAL", "APPLY_SOURCE"}:
            raise ProcurementRouteError(
                "PROCUREMENT_DECISION_INVALID",
                "Quyết định xung đột field không hợp lệ.", 400,
            )
        conflict_resolutions[(observation_id, field)] = resolution
        overrides.setdefault(observation_id, {})[field] = deepcopy(
            conflict.get("localValue")
            if resolution == "KEEP_LOCAL"
            else conflict.get("sourceValue")
        )
    unresolved_conflicts = [
        (observation_id, conflict.get("field"))
        for observation_id, preview in preview_by_id.items()
        for conflict in preview.get("fieldConflicts") or []
        if (observation_id, conflict.get("field")) not in conflict_resolutions
    ]
    if unresolved_conflicts:
        raise ProcurementRouteError(
            "PROCUREMENT_FIELD_CONFLICT",
            "Phải xử lý mọi xung đột field trước khi áp dụng.", 409,
        )

    resolved = deepcopy(revision)
    for observation in resolved.get("packages") or []:
        observation_id = str(observation.get("planDetailRevisionId") or "")
        observation["_canonicalSourceFields"] = {
            key: deepcopy(value)
            for key, value in observations.get(observation_id, {}).items()
            if key in SOURCE_OWNED_PACKAGE_FIELDS
        }
        observation.update(overrides.get(observation_id, {}))
        preview = preview_by_id.get(observation_id) or {}
        if preview.get("action") in {"CHANGED", "UNCHANGED", "ALREADY_IMPORTED"}:
            observation["_sourceAction"] = preview["action"]
        if required_package_issues(observation):
            raise ProcurementRouteError(
                "PROCUREMENT_REQUIRED_FIELDS_MISSING",
                "Gói thầu vẫn thiếu trường bắt buộc.", 422,
            )
    return resolved, package_decisions


def _apply_one(
    organization_id,
    actor_user_id,
    provider,
    revision,
    idempotency_key,
    expected_plan_row_version,
    investor_id,
    package_decisions=None,
    operation_id=None,
):
    connection = database.get_connection()
    try:
        connection.execute("BEGIN ISOLATION LEVEL SERIALIZABLE")
        cursor = connection.cursor()
        _validate_investor(cursor, organization_id, investor_id)
        normalized = deepcopy(revision)
        normalized["investorId"] = investor_id
        result = ProcurementPlanReconciler(
            ProcurementImportRepository(cursor)
        ).reconcile_revision(
            organization_id=organization_id,
            actor_user_id=actor_user_id,
            provider=provider,
            revision=normalized,
            idempotency_key=idempotency_key,
            expected_plan_row_version=expected_plan_row_version,
            package_decisions=package_decisions,
            operation_id=operation_id,
        )
        connection.commit()
        return result
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _apply_notice_one(
    organization_id,
    actor_user_id,
    provider,
    notice,
    idempotency_key,
    expected_package_row_version,
    target_package_root_id,
    operation_id=None,
):
    connection = database.get_connection()
    try:
        connection.execute("BEGIN ISOLATION LEVEL SERIALIZABLE")
        result = ProcurementNoticeReconciler(
            ProcurementImportRepository(connection.cursor())
        ).reconcile_revision(
            organization_id=organization_id,
            actor_user_id=actor_user_id,
            provider=provider,
            notice=deepcopy(notice),
            idempotency_key=idempotency_key,
            expected_package_row_version=expected_package_row_version,
            target_package_root_id=target_package_root_id,
            operation_id=operation_id,
        )
        connection.commit()
        return result
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _operation_id(organization_id, provider, family_no, idempotency_key):
    token = f"{organization_id}:{provider}:{family_no}:{idempotency_key}"
    return str(uuid5(NAMESPACE_URL, token))


def _create_operation(
    organization_id, actor_user_id, bundle, stored, idempotency_key, decisions,
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
        operation = ProcurementImportRepository(connection.cursor()).create_operation({
            "id": operation_id,
            "organizationId": organization_id,
            "provider": bundle["provider"],
            "familyNo": bundle["plan"]["familyNo"],
            "totalRevisions": len(resolved_revisions),
            "bundleDigest": stored.bundle_digest,
            "idempotencyKey": idempotency_key,
            "requestHash": request_hash,
            "actorUserId": actor_user_id,
            "revisionResults": manifest,
        })
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
    actor_user_id,
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
        operation = ProcurementImportRepository(connection.cursor()).create_operation({
            "id": operation_id,
            "organizationId": organization_id,
            "provider": bundle["provider"],
            "familyNo": family_no,
            "totalRevisions": len(bundle["revisions"]),
            "bundleDigest": stored.bundle_digest,
            "idempotencyKey": idempotency_key,
            "requestHash": request_hash,
            "actorUserId": actor_user_id,
            "revisionResults": manifest,
        })
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
    for revision in bundle["revisions"]:
        revision_id = str(revision.get("revisionId"))
        if dispositions.get(revision_id) in {
            "PROVENANCE_ONLY", "ALREADY_IMPORTED",
        }:
            resolved, package_decisions = deepcopy(revision), {}
        else:
            resolved, package_decisions = _resolve_revision_decisions(
                revision, reconciliation.get(revision_id, []), decisions,
            )
        resolved_revisions.append(resolved)
        package_decision_maps.append(package_decisions)
    all_history = bundle.get("revisionMode") == "ALL"
    operation_id = None
    results = []
    start_index = 0
    operation_status = None
    if all_history:
        operation_id, results, operation_status, start_index = _create_operation(
            organization_id, session.user_id, bundle, stored, idempotency_key,
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
    try:
        for index in range(start_index, len(resolved_revisions)):
            current_index = index
            revision = resolved_revisions[index]
            per_revision_key = f"{idempotency_key}:{revision['revisionId']}:{revision['revisionDigest']}"
            result = _apply_one(
                organization_id, session.user_id, bundle["provider"], revision,
                per_revision_key, expected, decisions["investorId"],
                package_decision_maps[index],
                operation_id,
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
            if operation_id:
                _update_operation(
                    organization_id, operation_id, index + 1, results,
                    "COMPLETED" if index + 1 == len(resolved_revisions) else "RUNNING",
                )
    except Exception as error:
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
    if operation_id:
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
                session.user_id,
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
                session.user_id,
                bundle["provider"],
                revision,
                per_revision_key,
                expected,
                bundle.get("targetPackageRootId"),
                operation_id,
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
                _update_operation(
                    organization_id,
                    operation_id,
                    index + 1,
                    results,
                    "COMPLETED" if index + 1 == len(revisions) else "RUNNING",
                )
            else:
                results.append(public_result)
            expected = next_expected
    except Exception as error:
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
    if operation_id:
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
    if operation["actorUserId"] != session.user_id:
        raise ProcurementRouteError(
            "ORGANIZATION_ACCESS_DENIED", "Chỉ người tạo tiến trình được resume.", 403
        )
    if operation["status"] == "COMPLETED":
        operation["revisionResults"] = [
            _public_operation_result(row) for row in operation["revisionResults"]
        ]
        operation.pop("actorUserId", None)
        operation.pop("requestHash", None)
        return operation
    results = operation["revisionResults"]
    start = operation["nextRevisionIndex"]
    current_index = start
    try:
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
                    session.user_id,
                    operation["provider"],
                    revision,
                    key,
                    expected,
                    entry.get("targetPackageRootId"),
                    operation_id,
                )
            else:
                result = _apply_one(
                    organization_id, session.user_id, operation["provider"], revision,
                    key, entry.get("expectedPlanRowVersion"), entry.get("investorId"),
                    entry.get("packageDecisions") or {},
                    operation_id,
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
            _update_operation(
                organization_id, operation_id, index + 1, results,
                "COMPLETED" if index + 1 == len(results) else "RUNNING",
            )
    except Exception as error:
        if current_index < len(results):
            results[current_index]["status"] = "FAILED"
            results[current_index]["errorCode"] = (
                error.code
                if isinstance(error, ProcurementRouteError)
                else str(error)
                if isinstance(error, ImportConflict)
                else "PROCUREMENT_APPLY_FAILED"
            )
        _update_operation(
            organization_id, operation_id, current_index, results, "FAILED"
        )
        raise
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
        return JSONResponse(result)
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
