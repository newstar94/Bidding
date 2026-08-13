"""Current-authority checks for durable document export jobs."""

from __future__ import annotations

import hashlib
import json

from backend.auth.auth_helper import SessionRole
from backend.shared.access_policy import (
    can_read_record,
    resolve_document_export_capabilities,
)
from backend.shared.subscription_policy import can_use_document_export


POLICY_VERSION = 1


class DocumentJobAuthorizationError(PermissionError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def _canonical(policy) -> str:
    return json.dumps(
        policy, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )


def document_job_policy_hash(policy) -> str:
    return hashlib.sha256(_canonical(policy).encode("utf-8")).hexdigest()


def build_document_job_policy(
    role,
    *,
    package_revision,
    required_sensitive_groups=(),
    document_format="docx",
):
    policy = {
        "version": POLICY_VERSION,
        "format": str(document_format or "").strip().casefold(),
        "platformRole": str(getattr(role, "platform_role", role) or "user"),
        "activeRole": str(getattr(role, "active_role", None) or ""),
        "activeRoleOrganizationId": str(
            getattr(role, "active_role_organization_id", None) or ""
        ),
        "packageRevision": int(package_revision),
        "requiredSensitiveGroups": sorted({
            str(value).strip().casefold()
            for value in required_sensitive_groups
            if str(value).strip()
        }),
    }
    return policy, document_job_policy_hash(policy)


def _policy(value):
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(str(value or ""))
    except (TypeError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None


def validate_document_job_policy_snapshot(policy, fingerprint):
    """Validate immutable policy shape/hash without consulting current authority."""

    parsed = _policy(policy)
    if (
        not parsed
        or parsed.get("version") != POLICY_VERSION
        or str(fingerprint or "") != document_job_policy_hash(parsed)
    ):
        raise DocumentJobAuthorizationError("DOCUMENT_EXPORT_POLICY_INVALID")
    if (
        str(parsed.get("format") or "") not in {"docx", "xlsx"}
        or not isinstance(parsed.get("packageRevision"), int)
        or int(parsed["packageRevision"]) < 1
        or not isinstance(parsed.get("requiredSensitiveGroups"), list)
    ):
        raise DocumentJobAuthorizationError("DOCUMENT_EXPORT_POLICY_INVALID")
    return parsed


def verify_document_job_policy(cursor, job):
    """Reauthorize one job against current account, role, record and grants."""

    policy = validate_document_job_policy_snapshot(
        job.get("policy_json"), job.get("policy_hash")
    )
    organization_id = str(job.get("organization_id") or "")
    user_id = str(job.get("user_id") or "")
    package_id = str(job.get("package_id") or "")
    account = cursor.execute(
        "SELECT id, trang_thai, vai_tro FROM tai_khoan WHERE id = ?",
        (user_id,),
    ).fetchone()
    if not account or str(account[1] or "") != "active":
        raise DocumentJobAuthorizationError("DOCUMENT_EXPORT_PERMISSION_REVOKED")
    role = SessionRole(
        str(policy.get("activeRole") or policy.get("platformRole") or account[2]),
        user_id,
        platform_role=str(account[2] or policy.get("platformRole") or "user"),
        active_role=str(policy.get("activeRole") or "") or None,
        active_role_organization_id=(
            str(policy.get("activeRoleOrganizationId") or "") or None
        ),
    )
    if (
        role.active_role_organization_id
        and role.active_role_organization_id != organization_id
    ):
        raise DocumentJobAuthorizationError("DOCUMENT_EXPORT_PERMISSION_REVOKED")
    package = cursor.execute(
        "SELECT row_version FROM goi_thau WHERE organization_id = ? AND id = ? AND archived_at IS NULL",
        (organization_id, package_id),
    ).fetchone()
    if not package or int(package[0] or 1) != int(policy["packageRevision"]):
        raise DocumentJobAuthorizationError("DOCUMENT_EXPORT_SOURCE_CHANGED")
    if not can_use_document_export(
        cursor, role, user_id, organization_id, format=policy.get("format")
    ):
        raise DocumentJobAuthorizationError("DOCUMENT_EXPORT_ENTITLEMENT_REQUIRED")
    if not can_read_record(
        cursor, role, user_id, organization_id,
        "goithau", "goi_thau", package_id,
    ):
        raise DocumentJobAuthorizationError("DOCUMENT_EXPORT_PERMISSION_REVOKED")
    required = set(policy.get("requiredSensitiveGroups") or ())
    current = resolve_document_export_capabilities(
        cursor, role, user_id, organization_id
    )
    if any(not bool(getattr(current, group, False)) for group in required):
        raise DocumentJobAuthorizationError("DOCUMENT_EXPORT_PERMISSION_REVOKED")
    return True
