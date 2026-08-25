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


POLICY_VERSION = 2
LEGACY_POLICY_VERSION = 1
MAX_POLICY_JSON_BYTES = 65_536

_RECORD_SCOPES = {
    "goi_thau": {
        "module": "goithau",
        "table": "goi_thau",
    },
    "ke_hoach_lcnt": {
        "module": "kehoach",
        "table": "ke_hoach_lcnt",
    },
}


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


def document_source_digest(context, manifest) -> str:
    """Hash the exact sealed Word source, excluding request-time clock noise."""

    stable_context = dict(context or {})
    stable_context.pop("current_time", None)
    payload = {"context": stable_context, "manifest": dict(manifest or {})}
    return hashlib.sha256(_canonical(payload).encode("utf-8")).hexdigest()


def _validate_policy_size(policy, *, error_type):
    try:
        size = len(_canonical(policy).encode("utf-8"))
    except (TypeError, ValueError) as error:
        raise error_type("DOCUMENT_EXPORT_POLICY_INVALID") from error
    if size > MAX_POLICY_JSON_BYTES:
        raise error_type("DOCUMENT_EXPORT_POLICY_TOO_LARGE")


def build_document_job_policy(
    role,
    *,
    package_revision=None,
    record_type=None,
    record_id=None,
    record_revision=None,
    sync_revision=None,
    required_sensitive_groups=(),
    document_format="docx",
    artifact_provenance=None,
    source_digest=None,
    source_document_type=None,
    source_publication_type=None,
):
    """Build a durable authorization snapshot.

    The package-only arguments remain a v1 adapter for callers and queued jobs
    created before generic record jobs existed. New callers pass the three
    ``record_*`` values and receive the v2 shape.
    """

    generic_record = any(
        value is not None for value in (record_type, record_id, record_revision)
    )
    if generic_record:
        normalized_record_type = str(record_type or "").strip()
        normalized_record_id = str(record_id or "").strip()
        if normalized_record_type not in _RECORD_SCOPES or not normalized_record_id:
            raise ValueError("DOCUMENT_EXPORT_RECORD_INVALID")
        try:
            normalized_revision = int(record_revision)
        except (TypeError, ValueError) as error:
            raise ValueError("DOCUMENT_EXPORT_RECORD_INVALID") from error
        if normalized_revision < 1:
            raise ValueError("DOCUMENT_EXPORT_RECORD_INVALID")
        version = POLICY_VERSION
    else:
        try:
            normalized_revision = int(package_revision)
        except (TypeError, ValueError) as error:
            raise ValueError("DOCUMENT_EXPORT_RECORD_INVALID") from error
        if normalized_revision < 1:
            raise ValueError("DOCUMENT_EXPORT_RECORD_INVALID")
        version = LEGACY_POLICY_VERSION

    policy = {
        "version": version,
        "format": str(document_format or "").strip().casefold(),
        "platformRole": str(getattr(role, "platform_role", role) or "user"),
        "activeRole": str(getattr(role, "active_role", None) or ""),
        "activeRoleOrganizationId": str(
            getattr(role, "active_role_organization_id", None) or ""
        ),
        "requiredSensitiveGroups": sorted({
            str(value).strip().casefold()
            for value in required_sensitive_groups
            if str(value).strip()
        }),
    }
    if version == POLICY_VERSION:
        policy.update({
            "recordType": normalized_record_type,
            "recordId": normalized_record_id,
            "recordRevision": normalized_revision,
        })
        if sync_revision is not None:
            try:
                normalized_sync_revision = int(sync_revision)
            except (TypeError, ValueError) as error:
                raise ValueError("DOCUMENT_EXPORT_RECORD_INVALID") from error
            if normalized_sync_revision < 0:
                raise ValueError("DOCUMENT_EXPORT_RECORD_INVALID")
            policy["syncRevision"] = normalized_sync_revision
        if source_digest is not None:
            normalized_source_digest = str(source_digest or "").strip().casefold()
            normalized_document_type = str(source_document_type or "").strip()
            if (
                len(normalized_source_digest) != 64
                or any(char not in "0123456789abcdef" for char in normalized_source_digest)
                or not normalized_document_type
            ):
                raise ValueError("DOCUMENT_EXPORT_RECORD_INVALID")
            policy["sourceDigest"] = normalized_source_digest
            policy["sourceDocumentType"] = normalized_document_type
            policy["sourcePublicationType"] = str(
                source_publication_type or ""
            ).strip()
    else:
        policy["packageRevision"] = normalized_revision
    if artifact_provenance is not None:
        if version == POLICY_VERSION:
            if isinstance(artifact_provenance, dict):
                artifact_provenance = [artifact_provenance]
            policy["artifactProvenance"] = [
                dict(value) for value in artifact_provenance
            ]
        else:
            policy["artifactProvenance"] = dict(artifact_provenance)
    _validate_policy_size(policy, error_type=ValueError)
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
    if parsed:
        _validate_policy_size(
            parsed,
            error_type=DocumentJobAuthorizationError,
        )
    version = parsed.get("version") if parsed else None
    if (
        not parsed
        or version not in {LEGACY_POLICY_VERSION, POLICY_VERSION}
        or str(fingerprint or "") != document_job_policy_hash(parsed)
    ):
        raise DocumentJobAuthorizationError("DOCUMENT_EXPORT_POLICY_INVALID")
    if (
        str(parsed.get("format") or "") not in {"docx", "xlsx"}
        or not isinstance(parsed.get("requiredSensitiveGroups"), list)
    ):
        raise DocumentJobAuthorizationError("DOCUMENT_EXPORT_POLICY_INVALID")

    if version == LEGACY_POLICY_VERSION:
        if (
            not isinstance(parsed.get("packageRevision"), int)
            or int(parsed["packageRevision"]) < 1
        ):
            raise DocumentJobAuthorizationError("DOCUMENT_EXPORT_POLICY_INVALID")
        provenances = (
            [parsed["artifactProvenance"]]
            if parsed.get("artifactProvenance") is not None
            else []
        )
        if any(
            not isinstance(value, dict)
            or str(value.get("recordType") or "") != "goi_thau"
            for value in provenances
        ):
            raise DocumentJobAuthorizationError("DOCUMENT_EXPORT_POLICY_INVALID")
        expected_record_type = "goi_thau"
        expected_record_id = None
        expected_revision = int(parsed["packageRevision"])
    else:
        expected_record_type = str(parsed.get("recordType") or "").strip()
        expected_record_id = str(parsed.get("recordId") or "").strip()
        expected_revision = parsed.get("recordRevision")
        if (
            expected_record_type not in _RECORD_SCOPES
            or not expected_record_id
            or not isinstance(expected_revision, int)
            or int(expected_revision) < 1
            or (
                parsed.get("syncRevision") is not None
                and (
                    not isinstance(parsed.get("syncRevision"), int)
                    or isinstance(parsed.get("syncRevision"), bool)
                    or int(parsed["syncRevision"]) < 0
                )
            )
        ):
            raise DocumentJobAuthorizationError("DOCUMENT_EXPORT_POLICY_INVALID")
        provenance = parsed.get("artifactProvenance")
        if provenance is None:
            provenances = []
        elif isinstance(provenance, list) and provenance:
            provenances = provenance
        else:
            raise DocumentJobAuthorizationError("DOCUMENT_EXPORT_POLICY_INVALID")

    if parsed.get("sourceDigest") is not None:
        digest = str(parsed.get("sourceDigest") or "").strip().casefold()
        if (
            version != POLICY_VERSION
            or len(digest) != 64
            or any(char not in "0123456789abcdef" for char in digest)
            or not str(parsed.get("sourceDocumentType") or "").strip()
        ):
            raise DocumentJobAuthorizationError("DOCUMENT_EXPORT_POLICY_INVALID")

    if any(
        not isinstance(value, dict)
        or not str(value.get("templateVersionId") or "").strip()
        or len(str(value.get("templateSha256") or "")) != 64
        or str(value.get("recordType") or "") != expected_record_type
        or not str(value.get("recordId") or "").strip()
        or (
            expected_record_id is not None
            and str(value.get("recordId") or "") != expected_record_id
        )
        or not isinstance(value.get("recordRowVersion"), int)
        or (
            version == LEGACY_POLICY_VERSION
            and int(value["recordRowVersion"]) < 1
        )
        or (
            version == POLICY_VERSION
            and int(value["recordRowVersion"]) != int(expected_revision)
        )
        for value in provenances
    ):
        raise DocumentJobAuthorizationError("DOCUMENT_EXPORT_POLICY_INVALID")
    return parsed


def document_job_record_scope(job, policy=None):
    """Return the canonical record identity and permission scope for one job."""

    parsed = policy or _policy(job.get("policy_json")) or {}
    if parsed.get("version") == LEGACY_POLICY_VERSION:
        record_type = "goi_thau"
        record_id = str(job.get("package_id") or "").strip()
        revision = parsed.get("packageRevision")
    else:
        record_type = str(
            job.get("record_type") or parsed.get("recordType") or ""
        ).strip()
        record_id = str(
            job.get("record_id") or parsed.get("recordId") or ""
        ).strip()
        revision = parsed.get("recordRevision")
        if str(parsed.get("recordType") or "").strip() != record_type or str(
            parsed.get("recordId") or ""
        ).strip() != record_id:
            raise DocumentJobAuthorizationError("DOCUMENT_EXPORT_POLICY_INVALID")
    scope = _RECORD_SCOPES.get(record_type)
    if scope is None or not record_id or not isinstance(revision, int):
        raise DocumentJobAuthorizationError("DOCUMENT_EXPORT_POLICY_INVALID")
    return {
        "record_type": record_type,
        "record_id": record_id,
        "record_revision": int(revision),
        **scope,
    }


def verify_document_job_policy(cursor, job):
    """Reauthorize one job against current account, role, record and grants."""

    policy = validate_document_job_policy_snapshot(
        job.get("policy_json"), job.get("policy_hash")
    )
    organization_id = str(job.get("organization_id") or "")
    user_id = str(job.get("user_id") or "")
    record_scope = document_job_record_scope(job, policy)
    account = cursor.execute(
        "SELECT id, trang_thai, vai_tro FROM tai_khoan WHERE id = ?",
        (user_id,),
    ).fetchone()
    if not account or str(account[1] or "") != "active":
        raise DocumentJobAuthorizationError("DOCUMENT_EXPORT_PERMISSION_REVOKED")
    current_platform_role = str(account[2] or "user").strip() or "user"
    snapshot_active_role = str(policy.get("activeRole") or "").strip() or None
    if (
        snapshot_active_role == "super_admin"
        and current_platform_role != "super_admin"
    ):
        raise DocumentJobAuthorizationError("DOCUMENT_EXPORT_PERMISSION_REVOKED")
    role = SessionRole(
        snapshot_active_role or current_platform_role,
        user_id,
        platform_role=current_platform_role,
        active_role=snapshot_active_role,
        active_role_organization_id=(
            str(policy.get("activeRoleOrganizationId") or "") or None
        ),
    )
    if (
        role.active_role_organization_id
        and role.active_role_organization_id != organization_id
    ):
        raise DocumentJobAuthorizationError("DOCUMENT_EXPORT_PERMISSION_REVOKED")
    record = cursor.execute(
        f"SELECT row_version FROM {record_scope['table']} "  # noqa: S608 - fixed allowlist
        "WHERE organization_id = ? AND id = ? AND archived_at IS NULL",
        (organization_id, record_scope["record_id"]),
    ).fetchone()
    if (
        not record
        or int(record[0] or 1) != int(record_scope["record_revision"])
    ):
        raise DocumentJobAuthorizationError("DOCUMENT_EXPORT_SOURCE_CHANGED")
    if policy.get("syncRevision") is not None and not policy.get("sourceDigest"):
        sync_row = cursor.execute(
            "SELECT current_version FROM sync_metadata WHERE organization_id = ?",
            (organization_id,),
        ).fetchone()
        if (
            not sync_row
            or int(sync_row[0] or 0) != int(policy["syncRevision"])
        ):
            raise DocumentJobAuthorizationError("DOCUMENT_EXPORT_SOURCE_CHANGED")
    if not can_use_document_export(
        cursor, role, user_id, organization_id, format=policy.get("format")
    ):
        raise DocumentJobAuthorizationError("DOCUMENT_EXPORT_ENTITLEMENT_REQUIRED")
    if not can_read_record(
        cursor, role, user_id, organization_id,
        record_scope["module"], record_scope["table"], record_scope["record_id"],
    ):
        raise DocumentJobAuthorizationError("DOCUMENT_EXPORT_PERMISSION_REVOKED")
    required = set(policy.get("requiredSensitiveGroups") or ())
    current = resolve_document_export_capabilities(
        cursor, role, user_id, organization_id
    )
    if any(not bool(getattr(current, group, False)) for group in required):
        raise DocumentJobAuthorizationError("DOCUMENT_EXPORT_PERMISSION_REVOKED")
    return True
