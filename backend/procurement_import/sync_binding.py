"""Bind user-edited sync records to trusted import-session provenance."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import json
import time
from uuid import NAMESPACE_URL, uuid5

from backend.procurement_import.domain import (
    CANONICAL_SCHEMA_VERSION,
    canonical_digest,
)
from backend.procurement_import.repository import ProcurementImportSessionRepository
from backend.observability.recording import record_database_phase
from backend.shared.logging_utils import log_structured_event


def _stable_id(*parts):
    return str(uuid5(NAMESPACE_URL, ":".join(str(part) for part in parts)))


def _source(record):
    value = record.get("sourceRevision") if isinstance(record, dict) else None
    return value if isinstance(value, dict) else {}


def _record_revision_commit(session, context, organization_id, user_id, started):
    duration = time.perf_counter() - started
    record_database_phase(
        "procurement_import", "revision_commit", duration,
    )
    log_structured_event(
        "procurement_import.revision_committed",
        actor_user_id=user_id,
        organization_id=organization_id,
        fields={
            "kind": str(session.get("kind") or ""),
            "provider": str(session.get("provider") or ""),
            "familyNo": str(session.get("familyNo") or ""),
            "revisionNumber": context["revisionNumber"],
            "revisionCommitMs": round(duration * 1000, 3),
        },
        nonblocking=True,
    )


def _session_records(payload):
    plans = [
        row for row in payload.get("kehoach") or []
        if _source(row).get("sessionId")
    ]
    packages = [
        row for row in payload.get("goithau") or []
        if _source(row).get("sessionId")
    ]
    records = [*plans, *packages]
    if not records:
        return None
    session_ids = {str(_source(row).get("sessionId")) for row in records}
    revision_numbers = {str(_source(row).get("revisionNumber")) for row in records}
    providers = {str(_source(row).get("provider") or "") for row in records}
    family_numbers = {str(_source(row).get("familyNo") or "") for row in records}
    workspace_leases = {
        str(_source(row).get("workspaceLease") or "") for row in records
    }
    if (
        len(session_ids) != 1 or len(revision_numbers) != 1
        or len(providers) != 1 or len(family_numbers) != 1
        or len(workspace_leases) != 1
    ):
        raise ValueError("PROCUREMENT_SOURCE_VERSION_CONFLICT")
    return {
        "sessionId": session_ids.pop(),
        "revisionNumber": revision_numbers.pop(),
        "provider": providers.pop(),
        "familyNo": family_numbers.pop(),
        "workspaceLease": workspace_leases.pop(),
        "plans": plans,
        "packages": packages,
    }


def _validate_session_authority(session, context):
    revisions = session.get("revisions") or []
    current_index = int(session.get("currentIndex") or 0)
    active_revision = (
        revisions[current_index] if current_index < len(revisions) else None
    )
    if (
        session.get("status") not in {"READY", "WAITING_NEXT_CONFIRMATION"}
        or active_revision is None
        or str(active_revision.get("revisionNumber"))
        != context["revisionNumber"]
        or active_revision.get("status") == "COMMITTED"
        or str(session.get("provider") or "") != context["provider"]
        or str(session.get("familyNo") or "") != context["familyNo"]
        or str(session.get("workspaceLease") or "")
        != context["workspaceLease"]
    ):
        raise ValueError("PROCUREMENT_SOURCE_VERSION_CONFLICT")


def resolve_pending_imported_investor(cursor, payload, organization_id):
    """Serialize investor identity creation and reuse an intervening record."""

    started = time.perf_counter()
    context = _session_records(payload)
    if context is None:
        return None
    pending = payload.get("chudautu") or []
    if not context["plans"]:
        if pending:
            raise ValueError("PROCUREMENT_INVESTOR_RESOLUTION_FAILED")
        return None
    if len(pending) > 1:
        raise ValueError("PROCUREMENT_INVESTOR_RESOLUTION_FAILED")
    if not pending:
        record_database_phase(
            "procurement_import", "investor_resolve",
            time.perf_counter() - started, outcome="existing",
        )
        return None
    investor = pending[0]
    code = str(investor.get("maChuDauTu") or "").strip().casefold()
    tax_code = str(investor.get("maSoThue") or "").strip().casefold()
    if not code and not tax_code:
        raise ValueError("PROCUREMENT_INVESTOR_RESOLUTION_FAILED")
    lock_key = f"{organization_id}:investor:{code}:{tax_code}"
    cursor.execute("SELECT pg_advisory_xact_lock(hashtext(?))", (lock_key,))
    existing = cursor.execute(
        """SELECT id
             FROM chu_dau_tu
            WHERE organization_id = ? AND is_latest = 1
              AND archived_at IS NULL
              AND ((? <> '' AND lower(trim(ma_chu_dau_tu)) = ?)
                   OR (? <> '' AND lower(trim(COALESCE(ma_so_thue, ''))) = ?))
            ORDER BY created_at DESC, id DESC LIMIT 1""",
        (organization_id, code, code, tax_code, tax_code),
    ).fetchone()
    if existing is None:
        record_database_phase(
            "procurement_import", "investor_resolve",
            time.perf_counter() - started, outcome="new",
        )
        return None
    pending_id = str(investor.get("id") or "")
    authoritative_id = str(existing[0])
    payload["chudautu"] = []
    for plan in payload.get("kehoach") or []:
        if str(plan.get("chuDauTuId") or "") == pending_id:
            plan["chuDauTuId"] = authoritative_id
    record_database_phase(
        "procurement_import", "investor_resolve",
        time.perf_counter() - started, outcome="reused",
    )
    return authoritative_id


def _load_trusted_revision(cursor, context, organization_id, user_id):
    repository = ProcurementImportSessionRepository(cursor)
    session = repository.get_for_commit(
        context["sessionId"], organization_id=organization_id, user_id=user_id,
    )
    if session is None or session["expiresAt"] <= datetime.now(timezone.utc):
        raise LookupError("PROCUREMENT_SESSION_EXPIRED")
    _validate_session_authority(session, context)
    revision = next((
        row for row in session["canonicalBundle"].get("revisions") or []
        if str(row.get("revisionNumber")) == context["revisionNumber"]
    ), None)
    if revision is None:
        raise ValueError("PROCUREMENT_REVISION_INVALID")
    expected_digest = str(revision.get("revisionDigest") or canonical_digest(revision))
    for record in context["plans"]:
        source = _source(record)
        if (
            str(source.get("revisionId") or "") != str(revision.get("revisionId") or "")
            or str(source.get("revisionDigest") or "") != expected_digest
            or str(record.get("phienBan") or "") != context["revisionNumber"]
        ):
            raise ValueError("PROCUREMENT_SOURCE_VERSION_CONFLICT")
    canonical_packages = revision.get("packages") or []
    by_observation = {
        str(row.get("planDetailRevisionId") or ""): row
        for row in canonical_packages
    }
    by_stable = {
        str(row.get("stablePackageId") or ""): row
        for row in canonical_packages if row.get("stablePackageId")
    }
    for record in context["packages"]:
        source = _source(record)
        if (
            str(source.get("revisionId") or "") != str(revision.get("revisionId") or "")
            or str(source.get("revisionDigest") or "") != expected_digest
        ):
            raise ValueError("PROCUREMENT_SOURCE_VERSION_CONFLICT")
        if not context["plans"]:
            if str(record.get("phienBan") or "") != context["revisionNumber"]:
                raise ValueError("PROCUREMENT_SOURCE_VERSION_CONFLICT")
            continue
        canonical = (
            by_observation.get(str(source.get("packageObservationId") or ""))
            or by_stable.get(str(source.get("stablePackageId") or ""))
        )
        if canonical is None:
            raise ValueError("PROCUREMENT_MATCH_AMBIGUOUS")
        expected_package_version = str(
            (canonical.get("noticeLink") or {}).get("noticeVersion") or ""
        ).strip()
        declared_package_version = str(
            source.get("packageRevisionNumber") or ""
        ).strip()
        if expected_package_version:
            expected_package_version = expected_package_version.zfill(2)
            if (
                declared_package_version.zfill(2) != expected_package_version
                or str(record.get("phienBan") or "").zfill(2)
                != expected_package_version
            ):
                raise ValueError("PROCUREMENT_SOURCE_VERSION_CONFLICT")
        elif (
            declared_package_version
            or str(record.get("phienBan") or "").zfill(2) != "00"
        ):
            raise ValueError("PROCUREMENT_SOURCE_VERSION_CONFLICT")
    return session, revision, expected_digest


def validate_import_session_mutation(
    cursor, payload, *, organization_id, user_id,
):
    """Lock and validate the active source revision before entity writes."""

    context = _session_records(payload)
    if context is None:
        return None
    session, revision, digest = _load_trusted_revision(
        cursor, context, organization_id, user_id,
    )
    return {
        "sessionId": session["id"],
        "revisionId": str(revision.get("revisionId") or ""),
        "revisionNumber": context["revisionNumber"],
        "revisionDigest": digest,
    }


def persist_import_session_provenance(cursor, payload, *, organization_id, user_id):
    """Persist canonical evidence after local rows were validated and written."""

    started = time.perf_counter()
    context = _session_records(payload)
    if context is None:
        return None
    session, revision, digest = _load_trusted_revision(
        cursor, context, organization_id, user_id
    )
    revision_id = str(revision.get("revisionId") or "")
    idempotency_key = (
        f"session:{session['id']}:{revision_id}:{digest}"
    )
    plan = context["plans"][-1] if context["plans"] else None
    plan_id = str(plan.get("id") or "") if plan else None
    plan_root = str(plan.get("rootId") or plan_id) if plan else None
    entity_kind = "PLAN" if plan else "NOTICE"
    local_package = context["packages"][-1] if not plan and context["packages"] else None
    local_root = (
        plan_root if plan else str(local_package.get("rootId") or local_package.get("id") or "")
    )
    local_snapshot = plan_id if plan else str(local_package.get("id") or "")
    local_entity_type = "kehoach" if plan else "goithau"
    cursor.execute(
        """INSERT INTO procurement_source_revision (
               id, organization_id, provider, entity_kind, family_key,
               revision_uuid, revision_no, canonical_snapshot_json, digest,
               schema_version, disposition, applied_at, local_entity_type,
               local_root_id, local_snapshot_id, match_method, confirmed_by,
               idempotency_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'APPLIED',
                   CURRENT_TIMESTAMP, ?, ?, ?, 'IMPORT_SESSION', ?, ?)
           ON CONFLICT DO NOTHING""",
        (
            _stable_id(organization_id, session["provider"], entity_kind, revision_id, digest),
            organization_id, session["provider"], entity_kind, session["familyNo"],
            revision_id, context["revisionNumber"],
            json.dumps(revision, ensure_ascii=False), digest,
            CANONICAL_SCHEMA_VERSION, local_entity_type, local_root,
            local_snapshot, user_id,
            idempotency_key,
        ),
    )
    canonical_packages = revision.get("packages") or ([revision] if not plan else [])
    if not plan:
        ProcurementImportSessionRepository(cursor).mark_revision_committed(
            session["id"], organization_id=organization_id,
            revision_number=context["revisionNumber"],
        )
        result = {
            "sessionId": session["id"],
            "revisionNumber": context["revisionNumber"],
            "revisionId": revision_id,
        }
        _record_revision_commit(
            session, context, organization_id, user_id, started,
        )
        return result
    by_observation = {
        str(row.get("planDetailRevisionId") or ""): row
        for row in canonical_packages
    }
    by_stable = {
        str(row.get("stablePackageId") or ""): row
        for row in canonical_packages
        if row.get("stablePackageId")
    }
    for package in context["packages"]:
        source = _source(package)
        canonical = (
            by_observation.get(str(source.get("packageObservationId") or ""))
            or by_stable.get(str(source.get("stablePackageId") or ""))
        )
        if canonical is None:
            raise ValueError("PROCUREMENT_MATCH_AMBIGUOUS")
        detail_id = str(canonical.get("planDetailRevisionId") or "")
        if not detail_id:
            raise ValueError("PROCUREMENT_MATCH_AMBIGUOUS")
        package_id = str(package.get("id") or "")
        package_root = str(package.get("rootId") or package_id)
        canonical_fields = deepcopy(canonical)
        if plan:
            cursor.execute(
            """INSERT INTO procurement_source_binding (
                   id, organization_id, provider, family_key,
                   plan_revision_uuid, id_detail, stable_external_id,
                   symbol, notify_no, local_entity_type, local_root_id,
                   local_snapshot_id, match_method, confirmed_by,
                   canonical_fields_json, digest)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'goithau', ?, ?,
                       'IMPORT_SESSION', ?, ?, ?)
               ON CONFLICT DO NOTHING""",
                (
                _stable_id(organization_id, session["provider"], revision_id, detail_id, package_id),
                organization_id, session["provider"], session["familyNo"],
                revision_id, detail_id, canonical.get("stablePackageId"),
                canonical.get("symbol"),
                (canonical.get("noticeLink") or {}).get("noticeNo"),
                package_root, package_id, user_id,
                json.dumps(canonical_fields, ensure_ascii=False),
                canonical_digest(canonical_fields),
                ),
            )
    ProcurementImportSessionRepository(cursor).mark_revision_committed(
        session["id"], organization_id=organization_id,
        revision_number=context["revisionNumber"],
    )
    result = {
        "sessionId": session["id"],
        "revisionNumber": context["revisionNumber"],
        "revisionId": revision_id,
    }
    _record_revision_commit(
        session, context, organization_id, user_id, started,
    )
    return result
