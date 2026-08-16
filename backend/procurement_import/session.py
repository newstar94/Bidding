"""Persistent import-session domain service for sequential source revisions."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
import secrets
import time

from backend.procurement_import.domain import canonical_digest, revision_sort_key
from backend.procurement_import.domain import derive_import_lifecycle_status
from backend.procurement_import.draft_mapping import (
    map_package_canonical_to_draft,
    map_plan_canonical_to_draft,
)
from backend.procurement_import.service import (
    enrich_plan_package_with_notice_revision,
)
from backend.observability.recording import record_database_phase


class ProcurementImportSessionService:
    def __init__(self, repository, ttl_seconds=86_400):
        self.repository = repository
        self.ttl_seconds = max(1800, min(int(ttl_seconds), 604_800))

    def create_from_bundle(
        self,
        bundle,
        *,
        organization_id,
        user_id,
        workspace_lease,
        now=None,
    ):
        created_at = now or datetime.now(timezone.utc)
        revisions = sorted(
            deepcopy(bundle.get("revisions") or []),
            key=lambda row: revision_sort_key(row.get("revisionNumber")),
        )
        if not revisions:
            raise LookupError("PROCUREMENT_REVISION_INVALID")
        kind = "PLAN" if bundle.get("plan") else "PACKAGE"
        family_no = (
            (bundle.get("plan") or {}).get("familyNo")
            or (bundle.get("notice") or {}).get("noticeNo")
        )
        manifest = [
            {
                "revisionId": str(row.get("revisionId") or ""),
                "revisionNumber": str(row.get("revisionNumber") or ""),
                "revisionDigest": row.get("revisionDigest") or canonical_digest(row),
                "status": "READY",
            }
            for row in revisions
        ]
        row = {
            "id": secrets.token_urlsafe(32),
            "organizationId": str(organization_id),
            "userId": str(user_id),
            "workspaceLease": str(workspace_lease),
            "provider": str(bundle.get("provider") or ""),
            "kind": kind,
            "familyNo": str(family_no or ""),
            "bundleDigest": canonical_digest(bundle),
            "revisions": manifest,
            "canonicalBundle": deepcopy(bundle),
            "currentIndex": 0,
            "status": "READY",
            "expiresAt": created_at + timedelta(seconds=self.ttl_seconds),
            "createdAt": created_at,
            "updatedAt": created_at,
        }
        cleanup_expired = getattr(self.repository, "cleanup_expired", None)
        if cleanup_expired is not None:
            cleanup_expired()
        stored = self.repository.create(row)
        return self._public_manifest(stored)

    @staticmethod
    def _public_manifest(row):
        enrichment_status = str(
            (row.get("canonicalBundle") or {}).get("enrichmentStatus")
            or "COMPLETED"
        ).upper()
        return {
            "sessionId": row["id"],
            "kind": row["kind"],
            "familyNo": row["familyNo"],
            "provider": row["provider"],
            "bundleDigest": row["bundleDigest"],
            "status": row["status"],
            "enrichmentStatus": enrichment_status,
            "currentIndex": int(row.get("currentIndex") or 0),
            "expiresAt": row["expiresAt"].isoformat(),
            "revisions": deepcopy(row["revisions"]),
        }

    def _get(self, session_id, *, organization_id, user_id, workspace_lease, now=None):
        row = self.repository.get_scoped(
            session_id,
            organization_id=str(organization_id),
            user_id=str(user_id),
            workspace_lease=str(workspace_lease),
        )
        if row is None:
            raise LookupError("PROCUREMENT_SESSION_EXPIRED")
        expires_at = row["expiresAt"]
        if (now or datetime.now(timezone.utc)) >= expires_at:
            raise LookupError("PROCUREMENT_SESSION_EXPIRED")
        return row

    def get_revision_draft(
        self,
        session_id,
        revision_number,
        *,
        organization_id,
        user_id,
        workspace_lease,
        now=None,
    ):
        started = time.perf_counter()
        row = self._get(
            session_id,
            organization_id=organization_id,
            user_id=user_id,
            workspace_lease=workspace_lease,
            now=now,
        )
        enrichment_status = str(
            (row.get("canonicalBundle") or {}).get("enrichmentStatus")
            or "COMPLETED"
        ).upper()
        if row["kind"] == "PLAN" and enrichment_status in {"PENDING", "RUNNING"}:
            raise LookupError("PROCUREMENT_ENRICHMENT_PENDING")
        if row["kind"] == "PLAN" and enrichment_status in {"PARTIAL", "FAILED"}:
            raise LookupError("PROCUREMENT_ENRICHMENT_INCOMPLETE")
        revision_number = str(revision_number)
        revision = next((
            item for item in row["canonicalBundle"].get("revisions") or []
            if str(item.get("revisionNumber")) == revision_number
        ), None)
        if revision is None:
            raise LookupError("PROCUREMENT_REVISION_INVALID")
        if row["kind"] == "PLAN":
            plan_draft = map_plan_canonical_to_draft(
                row["provider"], row["familyNo"], revision
            )
            package_drafts = [
                map_package_canonical_to_draft(
                    row["provider"], row["familyNo"], revision, package
                )
                for package in revision.get("packages") or []
            ]
            package_revision_histories = []
            linked_notice_revisions = (
                row["canonicalBundle"].get("linkedNoticeRevisions") or {}
            )
            for package in revision.get("packages") or []:
                link = package.get("noticeLink") or {}
                notice_no = str(link.get("noticeNo") or "").strip().upper()
                selected_version = str(link.get("noticeVersion") or "").strip()
                available_history = sorted(
                    deepcopy(linked_notice_revisions.get(notice_no) or []),
                    key=lambda item: revision_sort_key(
                        item.get("revisionNumber")
                    ),
                )
                if selected_version:
                    available_history = [
                        item for item in available_history
                        if revision_sort_key(item.get("revisionNumber"))
                        <= revision_sort_key(selected_version)
                    ]
                history_drafts = []
                for notice_revision in available_history:
                    snapshot = enrich_plan_package_with_notice_revision(
                        package, notice_no, notice_revision
                    )
                    snapshot["lifecycleStatus"] = (
                        derive_import_lifecycle_status(snapshot)
                    )
                    history_drafts.append(map_package_canonical_to_draft(
                        row["provider"], row["familyNo"], revision, snapshot
                    ))
                if len(history_drafts) > 1:
                    package_revision_histories.append({
                        "packageObservationId": package.get(
                            "planDetailRevisionId"
                        ),
                        "stablePackageId": package.get("stablePackageId"),
                        "noticeNo": notice_no,
                        "revisions": history_drafts,
                    })
        else:
            plan_draft = None
            package_drafts = [map_package_canonical_to_draft(
                row["provider"], row["familyNo"], revision, revision
            )]
            package_revision_histories = []
        lineage_loader = getattr(
            self.repository, "find_active_package_lineages", None,
        )
        active_lineages = (
            lineage_loader(
                str(organization_id), row["provider"], row["familyNo"],
            )
            if row["kind"] == "PLAN" and lineage_loader is not None
            else []
        )
        lineage_by_stable = {
            str(item.get("stablePackageId") or "").strip(): item["localRootId"]
            for item in active_lineages
            if str(item.get("stablePackageId") or "").strip()
        }
        lineage_by_symbol = {
            str(item.get("symbol") or "").strip().casefold(): item["localRootId"]
            for item in active_lineages
            if str(item.get("symbol") or "").strip()
        }

        def attach_local_root(package_draft):
            source = package_draft.get("sourceRevision") or {}
            stable_id = str(source.get("stablePackageId") or "").strip()
            symbol = str(package_draft.get("soHieuGoiThau") or "").strip().casefold()
            local_root_id = (
                lineage_by_stable.get(stable_id)
                or lineage_by_symbol.get(symbol)
            )
            if local_root_id:
                package_draft["sourceRevision"] = {
                    **source, "localRootId": local_root_id,
                }

        for package_draft in package_drafts:
            attach_local_root(package_draft)
        for history in package_revision_histories:
            for package_draft in history["revisions"]:
                attach_local_root(package_draft)
        authority = {
            "sessionId": row["id"],
            "workspaceLease": row["workspaceLease"],
            "provider": row["provider"],
            "familyNo": row["familyNo"],
            "revisionId": str(revision.get("revisionId") or ""),
            "revisionNumber": revision_number,
            "revisionDigest": (
                revision.get("revisionDigest") or canonical_digest(revision)
            ),
        }
        if plan_draft is not None:
            plan_draft["sourceRevision"] = {
                **plan_draft.get("sourceRevision", {}), **authority,
            }
        for package_draft in package_drafts:
            package_draft["sourceRevision"] = {
                **package_draft.get("sourceRevision", {}), **authority,
            }
        for history in package_revision_histories:
            for package_draft in history["revisions"]:
                package_draft["sourceRevision"] = {
                    **package_draft.get("sourceRevision", {}), **authority,
                }
        response = {
            "sessionId": row["id"],
            "kind": row["kind"],
            "familyNo": row["familyNo"],
            "revisionId": str(revision.get("revisionId") or ""),
            "revisionNumber": revision_number,
            "planDraft": plan_draft,
            "packageDrafts": package_drafts,
            "packageRevisionHistories": package_revision_histories,
            "investorResolution": deepcopy(row.get("investorResolution") or {}),
            "warnings": deepcopy(row["canonicalBundle"].get("warnings") or []),
        }
        record_database_phase(
            "procurement_import", "session_read",
            time.perf_counter() - started,
        )
        return response
