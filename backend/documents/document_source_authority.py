"""Exact dependency authority for durable Word jobs."""

from __future__ import annotations

from backend.auth.auth_helper import SessionRole
from backend.documents.document_job_policy import (
    DocumentJobAuthorizationError,
    document_source_digest,
    validate_document_job_policy_snapshot,
)


def verify_document_job_source_authority(job):
    policy = validate_document_job_policy_snapshot(
        job.get("policy_json"), job.get("policy_hash")
    )
    expected_digest = str(policy.get("sourceDigest") or "").strip()
    if not expected_digest:
        return True

    organization_id = str(job.get("organization_id") or "").strip()
    user_id = str(job.get("user_id") or "").strip()
    record_type = str(job.get("record_type") or policy.get("recordType") or "").strip()
    record_id = str(job.get("record_id") or policy.get("recordId") or "").strip()
    document_type = str(policy.get("sourceDocumentType") or "").strip()
    publication_type = str(policy.get("sourcePublicationType") or "").strip() or None
    role = SessionRole(
        str(policy.get("activeRole") or policy.get("platformRole") or "user"),
        user_id,
        platform_role=str(policy.get("platformRole") or "user"),
        active_role=str(policy.get("activeRole") or "").strip() or None,
        active_role_organization_id=(
            str(policy.get("activeRoleOrganizationId") or "").strip() or None
        ),
    )

    # Imported lazily to avoid the routes_docx -> document_worker import cycle.
    from backend.documents.routes_docx import (
        _prepare_plan_render,
        _prepare_report_render,
    )

    if record_type == "ke_hoach_lcnt":
        context, manifest, _templates, _groups = _prepare_plan_render(
            record_id, user_id, organization_id, role, publication_type, None,
            skip_template_resolution=True,
        )
    elif record_type == "goi_thau":
        context, manifest, _templates, _groups = _prepare_report_render(
            record_id, user_id, organization_id, role, document_type,
            publication_type, None, skip_template_resolution=True,
        )
    else:
        raise DocumentJobAuthorizationError("DOCUMENT_EXPORT_POLICY_INVALID")

    if document_source_digest(context, manifest) != expected_digest:
        raise DocumentJobAuthorizationError("DOCUMENT_EXPORT_SOURCE_CHANGED")
    return True
