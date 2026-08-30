"""Asynchronous, owner-scoped API for long-running Word exports."""

from __future__ import annotations

import re
import time
from urllib.parse import quote

from starlette.responses import JSONResponse, Response

from backend.documents.docx_context_policy import REPORT_DOCUMENT_TYPES
from backend.documents.document_worker import (
    cancel_document_export,
    enqueue_document_export,
    get_document_export_job,
    read_document_export_result,
    retry_failed_durable_document_job,
)
from backend.documents.routes_docx import (
    _prepare_plan_render,
    _prepare_report_render,
    _ensure_export_snapshot_unchanged,
    _validate_export_snapshot,
    _word_export_subscription_response,
)
from backend.documents.word_publication_team_policy import (
    WordPublicationTeamWarning,
)
from backend.documents.document_job_policy import (
    DocumentJobAuthorizationError,
    build_document_job_policy,
    document_job_record_scope,
    document_source_digest,
    verify_document_job_policy,
)
from backend.documents.document_source_authority import (
    verify_document_job_source_authority,
)
from backend.documents.export_policy_registry import governed_export
from backend.shared.access_policy import can_read_record
from backend.shared.client_ip import get_client_ip
from backend.shared.database_io import run_database_read, run_database_write
from backend.shared.helpers import clean_id, database, get_active_org, log_audit, verify_session


DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
ZIP_CONTENT_TYPE = "application/zip"
_JOB_ID = re.compile(r"[a-f0-9]{32}")

_CREATE_RECORD_SCOPES = {
    "goi_thau": ("goithau", "goi_thau"),
    "ke_hoach_lcnt": ("kehoach", "ke_hoach_lcnt"),
}


def _error(code, status_code):
    return JSONResponse({"code": code}, status_code=status_code)


def _filename_for_report(report_type, context):
    package = context.get("goi_thau") or {}
    contract = context.get("hop_dong") or {}
    if report_type in {"contract", "liquidation"}:
        prefix = "Thanh_ly_hop_dong" if report_type == "liquidation" else "Hop_dong"
        return f"{prefix}_{contract.get('so_hop_dong') or 'LCNT'}.docx"
    if report_type in {"hsmt", "opening"}:
        return f"{report_type.upper()}_{package.get('ma_goi_thau') or 'LCNT'}.docx"
    return f"Bao_cao_danh_gia_goi_thau_{package.get('ma_goi_thau') or 'LCNT'}.docx"


def _filename_for_plan(context):
    plan = context.get("ke_hoach") or {}
    return f"Ke_hoach_LCNT_{plan.get('ma_ke_hoach') or 'LCNT'}.docx"


def _requested_template_filenames(request):
    params = request.query_params
    if "templateFilename" not in params:
        return None
    getlist = getattr(params, "getlist", None)
    if callable(getlist):
        return getlist("templateFilename")
    value = params.get("templateFilename")
    return list(value) if isinstance(value, (list, tuple)) else [value]


def _prepare_render_job(
    template_selection,
    context,
    manifest,
    *,
    fallback_filename,
    record_type,
    record_id,
    record_revision,
):
    if isinstance(template_selection, list):
        targets = template_selection
    else:
        targets = [{"path": template_selection, "filename": fallback_filename}]
    if not targets:
        raise ValueError("DOCUMENT_EXPORT_TEMPLATE_SELECTION_REQUIRED")

    templates = []
    provenances = []
    for target in targets:
        if not isinstance(target, dict):
            raise ValueError("DOCUMENT_EXPORT_TEMPLATE_SELECTION_REQUIRED")
        template_payload = (
            {"template_content": target["content"]}
            if "content" in target
            else {"template_path": target["path"]}
        )
        templates.append({
            **template_payload,
            "filename": str(target.get("filename") or fallback_filename),
        })
        if target.get("templateVersionId") and target.get("templateSha256"):
            provenances.append({
                "templateVersionId": target["templateVersionId"],
                "templateSha256": target["templateSha256"],
                "recordType": record_type,
                "recordId": record_id,
                "recordRowVersion": int(record_revision),
            })

    if provenances and len(provenances) != len(templates):
        raise ValueError("DOCUMENT_EXPORT_TEMPLATE_SELECTION_REQUIRED")

    if len(templates) == 1:
        operation = "render_docx"
        payload = {
            key: value
            for key, value in templates[0].items()
            if key != "filename"
        }
        filename = fallback_filename
        content_type = DOCX_CONTENT_TYPE
    else:
        operation = "render_docx_batch"
        payload = {"templates": templates}
        filename = f"{fallback_filename.removesuffix('.docx')}.zip"
        content_type = ZIP_CONTENT_TYPE
    payload.update({"context": context, "context_manifest": manifest})
    return {
        "operation": operation,
        "payload": payload,
        "filename": filename,
        "content_type": content_type,
        "template_count": len(templates),
        "artifact_provenance": provenances or None,
    }


def _create_record_access(request, role, record_type, record_id):
    module, table = _CREATE_RECORD_SCOPES[record_type]
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        organization_id = get_active_org(request, role.user_id, cursor=cursor)
        entitlement = _word_export_subscription_response(role, organization_id)
        if entitlement is not None:
            return None, entitlement
        if not can_read_record(
            cursor,
            role,
            role.user_id,
            organization_id,
            module,
            table,
            record_id,
        ):
            return None, _error("DOCUMENT_EXPORT_DENIED", 403)
        return organization_id, None
    finally:
        connection.close()


async def _enqueue_prepared_word_export(
    request,
    role,
    organization_id,
    *,
    record_type,
    record_id,
    document_type,
    context,
    manifest,
    template_selection,
    sensitive_groups,
    fallback_filename,
    sync_revision=None,
    publication_type=None,
):
    _module, table = _CREATE_RECORD_SCOPES[record_type]
    connection = database.get_connection()
    try:
        revision_row = connection.execute(
            f"SELECT row_version FROM {table} "  # noqa: S608 - fixed allowlist
            "WHERE organization_id = ? AND id = ? AND archived_at IS NULL",
            (organization_id, record_id),
        ).fetchone()
        if not revision_row:
            return _error("DOCUMENT_EXPORT_DENIED", 403)
        record_revision = int(revision_row[0] or 1)
    finally:
        connection.close()

    context_revision = int(manifest.get("record_revision") or 1)
    if context_revision != record_revision:
        return _error("DOCUMENT_EXPORT_SOURCE_CHANGED", 409)

    try:
        prepared = _prepare_render_job(
            template_selection,
            context,
            manifest,
            fallback_filename=fallback_filename,
            record_type=record_type,
            record_id=record_id,
            record_revision=record_revision,
        )
        policy, policy_hash = build_document_job_policy(
            role,
            record_type=record_type,
            record_id=record_id,
            record_revision=record_revision,
            sync_revision=sync_revision,
            required_sensitive_groups=sensitive_groups,
            document_format="docx",
            artifact_provenance=prepared["artifact_provenance"],
            source_digest=document_source_digest(context, manifest),
            source_document_type=document_type,
            source_publication_type=publication_type,
        )
    except ValueError as error:
        code = str(error)
        if code in {
            "DOCUMENT_EXPORT_POLICY_TOO_LARGE",
            "DOCUMENT_EXPORT_RECORD_INVALID",
            "DOCUMENT_EXPORT_TEMPLATE_SELECTION_REQUIRED",
        }:
            return _error(code, 400)
        raise
    job_id = await run_database_write(
        enqueue_document_export,
        prepared["operation"],
        prepared["payload"],
        organization_id=organization_id,
        user_id=role.user_id,
        package_id=record_id if record_type == "goi_thau" else None,
        record_type=record_type,
        record_id=record_id,
        filename=prepared["filename"],
        content_type=prepared["content_type"],
        policy=policy,
        policy_hash=policy_hash,
        progress_phase="queued",
        progress_completed_items=0,
        progress_total_items=prepared["template_count"],
        database=database,
        audit_event={
            "actor_user_id": role.user_id,
            "organization_id": organization_id,
            "action": "document.export_job_created",
            "target_type": record_type,
            "target_id": record_id,
            "ip_address": get_client_ip(request),
            "metadata": {
                "document_type": document_type,
                "template_count": prepared["template_count"],
                "sensitive_capabilities_used": sensitive_groups,
            },
        },
    )
    return JSONResponse(
        {
            "jobId": job_id,
            "status": "pending",
            "phase": "queued",
            "completedItems": 0,
            "totalItems": prepared["template_count"],
            "statusUrl": f"/api/document-jobs/{job_id}",
            "downloadUrl": f"/api/document-jobs/{job_id}/download",
        },
        status_code=202,
        headers={"Retry-After": "2"},
    )


def _job_access(request):
    valid, role = verify_session(request)
    if not valid:
        return None, None, _error("AUTH_REQUIRED", 403)
    job_id = str(request.path_params.get("job_id") or "").strip().lower()
    if not _JOB_ID.fullmatch(job_id):
        return None, None, _error("DOCUMENT_JOB_NOT_FOUND", 404)
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        organization_id = get_active_org(request, role.user_id, cursor=cursor)
        job = get_document_export_job(
            database, job_id, organization_id, role.user_id
        )
        if not job:
            return None, None, _error("DOCUMENT_JOB_NOT_FOUND", 404)
        try:
            record_scope = document_job_record_scope(job)
        except DocumentJobAuthorizationError as policy_error:
            return None, None, _error(policy_error.code, 403)
        if not can_read_record(
            cursor, role, role.user_id, organization_id,
            record_scope["module"],
            record_scope["table"],
            record_scope["record_id"],
        ):
            return None, None, _error("DOCUMENT_JOB_NOT_FOUND", 404)
        try:
            verify_document_job_policy(cursor, job)
            if job.get("status") == "completed":
                verify_document_job_source_authority(job)
        except DocumentJobAuthorizationError as policy_error:
            return None, None, _error(policy_error.code, 403)
        return (role, organization_id), job, None
    finally:
        connection.close()


@governed_export("docx.package_report")
async def create_package_export_job_api(request):
    valid, role = verify_session(request)
    if not valid:
        return _error("AUTH_REQUIRED", 403)
    package_id = clean_id(request.path_params.get("package_id"))
    report_type = str(request.query_params.get("type") or "evaluation").strip()
    publication_type = str(
        request.query_params.get("publicationType") or ""
    ).strip()
    requested_template_filenames = _requested_template_filenames(request)
    if not package_id or report_type not in REPORT_DOCUMENT_TYPES:
        return _error("DOCUMENT_EXPORT_INPUT_INVALID", 400)
    organization_id, access_error = _create_record_access(
        request, role, "goi_thau", package_id
    )
    if access_error is not None:
        return access_error
    snapshot_version, snapshot_error = _validate_export_snapshot(
        request, organization_id
    )
    if snapshot_error is not None:
        return snapshot_error

    try:
        context, manifest, template_path, sensitive_groups = await run_database_read(
            _prepare_report_render,
            package_id,
            role.user_id,
            organization_id,
            role,
            report_type,
            publication_type or None,
            requested_template_filenames,
            timeout_seconds=30,
        )
    except WordPublicationTeamWarning as warning:
        return JSONResponse({
            "code": warning.code,
            "error": str(warning),
            "missingTeams": list(warning.missing_teams),
        }, status_code=422)
    snapshot_error = await run_database_read(
        _ensure_export_snapshot_unchanged,
        organization_id,
        snapshot_version,
    )
    if snapshot_error is not None:
        return snapshot_error
    return await _enqueue_prepared_word_export(
        request,
        role,
        organization_id,
        record_type="goi_thau",
        record_id=package_id,
        document_type=report_type,
        context=context,
        manifest=manifest,
        template_selection=template_path,
        sensitive_groups=sensitive_groups,
        fallback_filename=_filename_for_report(report_type, context),
        sync_revision=snapshot_version,
        publication_type=publication_type or None,
    )


@governed_export("docx.plan")
async def create_plan_export_job_api(request):
    valid, role = verify_session(request)
    if not valid:
        return _error("AUTH_REQUIRED", 403)
    plan_id = clean_id(request.path_params.get("plan_id"))
    publication_type = str(
        request.query_params.get("publicationType") or ""
    ).strip()
    requested_template_filenames = _requested_template_filenames(request)
    if not plan_id:
        return _error("DOCUMENT_EXPORT_INPUT_INVALID", 400)

    organization_id, access_error = _create_record_access(
        request, role, "ke_hoach_lcnt", plan_id
    )
    if access_error is not None:
        return access_error
    snapshot_version, snapshot_error = _validate_export_snapshot(
        request, organization_id
    )
    if snapshot_error is not None:
        return snapshot_error
    context, manifest, template_path, sensitive_groups = await run_database_read(
        _prepare_plan_render,
        plan_id,
        role.user_id,
        organization_id,
        role,
        publication_type or None,
        requested_template_filenames,
        timeout_seconds=30,
    )
    snapshot_error = await run_database_read(
        _ensure_export_snapshot_unchanged,
        organization_id,
        snapshot_version,
    )
    if snapshot_error is not None:
        return snapshot_error
    return await _enqueue_prepared_word_export(
        request,
        role,
        organization_id,
        record_type="ke_hoach_lcnt",
        record_id=plan_id,
        document_type="plan",
        context=context,
        manifest=manifest,
        template_selection=template_path,
        sensitive_groups=sensitive_groups,
        fallback_filename=_filename_for_plan(context),
        sync_revision=snapshot_version,
        publication_type=publication_type or None,
    )


def _job_progress(job):
    total_items = max(1, int(job.get("progress_total_items") or 1))
    completed_items = max(0, int(job.get("progress_completed_items") or 0))
    completed_items = min(completed_items, total_items)
    phase = str(job.get("progress_phase") or "").strip()
    if not phase:
        phase = {
            "pending": "queued",
            "retry": "queued",
            "processing": "rendering",
            "completed": "completed",
            "failed": "cancelled" if job.get("cancelled_at") else "failed",
        }.get(job.get("status"), "queued")
    return phase, completed_items, total_items


async def document_export_job_status_api(request):
    access, job, error = await run_database_read(_job_access, request)
    if error:
        return error
    del access
    if int(job["expires_at"] or 0) <= int(time.time()):
        return _error("DOCUMENT_JOB_EXPIRED", 410)
    error_code = None
    if job["status"] == "failed":
        error_code = (
            "DOCUMENT_JOB_CANCELLED"
            if job.get("cancelled_at") else "DOCUMENT_JOB_FAILED"
        )
    phase, completed_items, total_items = _job_progress(job)
    return JSONResponse({
        "jobId": job["id"],
        "status": job["status"],
        "phase": phase,
        "completedItems": completed_items,
        "totalItems": total_items,
        "attemptCount": int(job["attempt_count"] or 0),
        "errorCode": error_code,
        "downloadUrl": (
            f"/api/document-jobs/{job['id']}/download"
            if job["status"] == "completed" else None
        ),
    })


@governed_export("docx.document_job")
async def download_document_export_job_api(request):
    access, job, error = await run_database_read(_job_access, request)
    if error:
        return error
    role, organization_id = access
    if int(job["expires_at"] or 0) <= int(time.time()):
        return _error("DOCUMENT_JOB_EXPIRED", 410)
    job, result = await run_database_read(
        read_document_export_result,
        database,
        job["id"],
        organization_id,
        role.user_id,
    )
    if result is None:
        return _error("DOCUMENT_JOB_NOT_READY", 409)
    if not isinstance(result, (bytes, bytearray)):
        return _error("DOCUMENT_JOB_RESULT_INVALID", 500)
    record_scope = document_job_record_scope(job)
    log_audit(
        "document.export_job_downloaded",
        actor_user_id=role.user_id,
        organization_id=organization_id,
        target_type=record_scope["record_type"],
        target_id=record_scope["record_id"],
        request=request,
        metadata={"job_id": job["id"]},
        required=True,
    )
    filename = str(job["filename"] or "BiddingFlow-export.docx")
    return Response(
        bytes(result),
        media_type=str(job["content_type"] or DOCX_CONTENT_TYPE),
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
            "Cache-Control": "private, no-store",
        },
    )


async def cancel_document_export_job_api(request):
    access, job, error = await run_database_read(_job_access, request)
    if error:
        return error
    role, organization_id = access
    cancelled = await run_database_write(
        cancel_document_export,
        database,
        job["id"],
        organization_id,
        role.user_id,
    )
    return JSONResponse(
        {"jobId": job["id"], "status": "cancelled" if cancelled else job["status"]},
        status_code=200 if cancelled else 409,
    )


@governed_export("docx.document_job")
async def retry_document_export_job_api(request):
    access, job, error = await run_database_read(_job_access, request)
    if error:
        return error
    del access
    retried = await run_database_write(
        retry_failed_durable_document_job, database, job["id"]
    )
    return JSONResponse(
        {"jobId": job["id"], "status": "retry" if retried else job["status"]},
        status_code=202 if retried else 409,
    )


def document_job_routes(Route):
    return [
        Route(
            "/api/document-jobs/plan/{plan_id}",
            create_plan_export_job_api,
            methods=["POST"],
        ),
        Route(
            "/api/document-jobs/package-report/{package_id}",
            create_package_export_job_api,
            methods=["POST"],
        ),
        Route(
            "/api/document-jobs/{job_id}",
            document_export_job_status_api,
            methods=["GET"],
        ),
        Route(
            "/api/document-jobs/{job_id}/download",
            download_document_export_job_api,
            methods=["GET"],
        ),
        Route(
            "/api/document-jobs/{job_id}/retry",
            retry_document_export_job_api,
            methods=["POST"],
        ),
        Route(
            "/api/document-jobs/{job_id}",
            cancel_document_export_job_api,
            methods=["DELETE"],
        ),
    ]
