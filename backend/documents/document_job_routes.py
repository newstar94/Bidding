"""Asynchronous, owner-scoped API for large package exports."""

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
    _prepare_report_render,
    _word_export_subscription_response,
)
from backend.documents.document_job_policy import (
    DocumentJobAuthorizationError,
    build_document_job_policy,
    verify_document_job_policy,
)
from backend.documents.export_policy_registry import governed_export
from backend.shared.access_policy import can_read_record
from backend.shared.client_ip import get_client_ip
from backend.shared.database_io import run_database_read, run_database_write
from backend.shared.helpers import clean_id, database, get_active_org, log_audit, verify_session


DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_JOB_ID = re.compile(r"[a-f0-9]{32}")


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
        if not can_read_record(
            cursor, role, role.user_id, organization_id,
            "goithau", "goi_thau", job["package_id"],
        ):
            return None, None, _error("DOCUMENT_JOB_NOT_FOUND", 404)
        try:
            verify_document_job_policy(cursor, job)
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
    requested_template_filenames = (
        request.query_params.getlist("templateFilename")
        if "templateFilename" in request.query_params
        else None
    )
    if not package_id or report_type not in REPORT_DOCUMENT_TYPES:
        return _error("DOCUMENT_EXPORT_INPUT_INVALID", 400)
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        organization_id = get_active_org(request, role.user_id, cursor=cursor)
        entitlement = _word_export_subscription_response(role, organization_id)
        if entitlement is not None:
            return entitlement
        if not can_read_record(
            cursor, role, role.user_id, organization_id,
            "goithau", "goi_thau", package_id,
        ):
            return _error("DOCUMENT_EXPORT_DENIED", 403)
    finally:
        connection.close()

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
    template_payload = {"template_path": template_path}
    artifact_provenance = None
    if isinstance(template_path, list):
        if len(template_path) != 1:
            return _error("DOCUMENT_EXPORT_TEMPLATE_SELECTION_REQUIRED", 400)
        target = template_path[0]
        template_payload = (
            {"template_content": target["content"]}
            if "content" in target
            else {"template_path": target["path"]}
        )
        if target.get("templateVersionId") and target.get("templateSha256"):
            artifact_provenance = {
                "templateVersionId": target["templateVersionId"],
                "templateSha256": target["templateSha256"],
                "recordType": "goi_thau",
                "recordId": package_id,
                "recordRowVersion": int(
                    (context.get("goi_thau") or {}).get("row_version") or 1
                ),
            }
    connection = database.get_connection()
    try:
        package_revision_row = connection.execute(
            "SELECT row_version FROM goi_thau WHERE organization_id = ? AND id = ?",
            (organization_id, package_id),
        ).fetchone()
        if not package_revision_row:
            return _error("DOCUMENT_EXPORT_DENIED", 403)
        policy, policy_hash = build_document_job_policy(
            role,
            package_revision=int(package_revision_row[0] or 1),
            required_sensitive_groups=sensitive_groups,
            document_format="docx",
            artifact_provenance=artifact_provenance,
        )
    finally:
        connection.close()
    filename = _filename_for_report(report_type, context)
    job_id = await run_database_write(
        enqueue_document_export,
        "render_docx",
        {
            **template_payload,
            "context": context,
            "context_manifest": manifest,
        },
        organization_id=organization_id,
        user_id=role.user_id,
        package_id=package_id,
        filename=filename,
        content_type=DOCX_CONTENT_TYPE,
        policy=policy,
        policy_hash=policy_hash,
        database=database,
        audit_event={
            "actor_user_id": role.user_id,
            "organization_id": organization_id,
            "action": "document.export_job_created",
            "target_type": "goi_thau",
            "target_id": package_id,
            "ip_address": get_client_ip(request),
            "metadata": {
                "document_type": report_type,
                "sensitive_capabilities_used": sensitive_groups,
            },
        },
    )
    return JSONResponse(
        {
            "jobId": job_id,
            "status": "pending",
            "statusUrl": f"/api/document-jobs/{job_id}",
            "downloadUrl": f"/api/document-jobs/{job_id}/download",
        },
        status_code=202,
        headers={"Retry-After": "2"},
    )


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
    return JSONResponse({
        "jobId": job["id"],
        "status": job["status"],
        "attemptCount": int(job["attempt_count"] or 0),
        "errorCode": error_code,
        "downloadUrl": (
            f"/api/document-jobs/{job['id']}/download"
            if job["status"] == "completed" else None
        ),
    })


@governed_export("docx.package_report")
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
    log_audit(
        "document.export_job_downloaded",
        actor_user_id=role.user_id,
        organization_id=organization_id,
        target_type="goi_thau",
        target_id=job["package_id"],
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


@governed_export("docx.package_report")
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
