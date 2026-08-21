"""Persistent import-session domain service for sequential source revisions."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
import secrets
import time

from backend.procurement_import.domain import (
    canonical_digest,
    revision_requires_materialization,
    revision_sort_key,
)
from backend.procurement_import.domain import derive_import_lifecycle_status
from backend.procurement_import.decisions import (
    ProcurementDecisionError,
    resolve_plan_decision_authority,
    resolve_revision_decisions,
)
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
        if kind == "PLAN":
            dispositions = {
                str(row.get("revisionId") or ""): str(
                    row.get("disposition") or ""
                ).upper()
                for row in bundle.get("revisionPreviews") or []
            }
            pending_revisions = [
                row for row in revisions
                if revision_requires_materialization(
                    dispositions.get(str(row.get("revisionId") or ""))
                )
            ]
            # Keep the existing retry behavior when every selected revision is
            # already known, but never replay an imported prefix before a new
            # source revision.
            if pending_revisions:
                revisions = pending_revisions
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
        decision_authority = deepcopy(
            (row.get("canonicalBundle") or {}).get("decisionAuthority") or {}
        )
        bundle = row.get("canonicalBundle") or {}
        active_revision_ids = {
            str(item.get("revisionId") or "")
            for item in row.get("revisions") or []
        }
        decision_packages = [
            deepcopy(item)
            for item in bundle.get("decisionPackages") or []
            if str(item.get("sourceRevisionId") or "") in active_revision_ids
        ]
        blocking_issues = [
            deepcopy(item)
            for item in bundle.get("blockingIssues") or []
            if str(item.get("sourceRevisionId") or "") in active_revision_ids
        ]
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
            "activeRevisionIds": sorted(active_revision_ids),
            "decisionPackages": decision_packages,
            "blockingIssues": blocking_issues,
            "planAuthority": deepcopy(bundle.get("plan") or {}),
            "decisionAuthority": {
                key: decision_authority.get(key)
                for key in ("status", "decisionsDigest", "investorId")
                if decision_authority.get(key) is not None
            },
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

    def bind_plan_decisions(
        self,
        session_id,
        *,
        organization_id,
        user_id,
        workspace_lease,
        bundle_digest,
        decisions,
        validate_investor=None,
        validate_local_target=None,
        validate_plan_authority=None,
        now=None,
    ):
        row = self._get(
            session_id,
            organization_id=organization_id,
            user_id=user_id,
            workspace_lease=workspace_lease,
            now=now,
        )
        if row["kind"] != "PLAN":
            raise LookupError("PROCUREMENT_REVISION_INVALID")
        if validate_plan_authority is not None:
            validate_plan_authority(
                deepcopy((row.get("canonicalBundle") or {}).get("plan") or {})
            )
        if str(bundle_digest or "") != str(row.get("bundleDigest") or ""):
            raise ProcurementDecisionError(
                "PROCUREMENT_PREVIEW_STALE",
                "Preview không còn khớp với phiên nhập.",
                409,
            )
        enrichment_status = str(
            (row.get("canonicalBundle") or {}).get("enrichmentStatus")
            or "COMPLETED"
        ).upper()
        if enrichment_status != "COMPLETED":
            raise LookupError(
                "PROCUREMENT_ENRICHMENT_PENDING"
                if enrichment_status in {"PENDING", "RUNNING"}
                else "PROCUREMENT_ENRICHMENT_INCOMPLETE"
            )
        investor_id = str((decisions or {}).get("investorId") or "").strip()
        if investor_id and validate_investor is not None:
            validate_investor(investor_id)
        selected_revision_ids = [
            str(item.get("revisionId") or "") for item in row["revisions"]
        ]
        authority = resolve_plan_decision_authority(
            row["canonicalBundle"],
            decisions or {},
            selected_revision_ids,
        )
        if validate_local_target is not None:
            for by_observation in authority["localTargetsByRevision"].values():
                for target in by_observation.values():
                    validate_local_target(target)
        binder = getattr(self.repository, "bind_decision_authority", None)
        if binder is None:
            raise RuntimeError("PROCUREMENT_SESSION_DECISION_STORAGE_UNAVAILABLE")
        stored = binder(
            session_id,
            organization_id=str(organization_id),
            user_id=str(user_id),
            workspace_lease=str(workspace_lease),
            bundle_digest=str(bundle_digest),
            authority=authority,
        )
        return self._public_manifest(stored)

    @staticmethod
    def _resolved_revision(row, revision):
        bundle = row.get("canonicalBundle") or {}
        authority = bundle.get("decisionAuthority") or {}
        revision_id = str(revision.get("revisionId") or "")
        if authority.get("status") == "BOUND":
            resolved = next((
                item for item in authority.get("resolvedRevisions") or []
                if str(item.get("revisionId") or "") == revision_id
            ), None)
            if resolved is None:
                raise LookupError("PROCUREMENT_REVISION_INVALID")
            return deepcopy(resolved), authority
        if bundle.get("decisionBindingRequired"):
            raise ProcurementDecisionError(
                "PROCUREMENT_DECISIONS_REQUIRED",
                "Phải xác nhận quyết định preview trước khi mở bản nháp.",
                409,
            )
        resolved, _explicit, local_targets = resolve_revision_decisions(
            revision,
            (bundle.get("reconciliationByRevision") or {}).get(revision_id, []),
            {},
        )
        return resolved, {
            "status": "IMPLICIT",
            "localTargetsByRevision": {revision_id: local_targets},
        }

    def get_revision_draft(
        self,
        session_id,
        revision_number,
        *,
        organization_id,
        user_id,
        workspace_lease,
        now=None,
        validate_plan_authority=None,
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
        if row["kind"] == "PLAN" and validate_plan_authority is not None:
            validate_plan_authority(
                deepcopy((row.get("canonicalBundle") or {}).get("plan") or {})
            )
        revision_number = str(revision_number)
        revision = next((
            item for item in row["canonicalBundle"].get("revisions") or []
            if str(item.get("revisionNumber")) == revision_number
        ), None)
        if revision is None:
            raise LookupError("PROCUREMENT_REVISION_INVALID")
        if row["kind"] == "PLAN":
            revision, decision_authority = self._resolved_revision(row, revision)
            plan_draft = map_plan_canonical_to_draft(
                row["provider"], row["familyNo"], revision
            )
            investor_id = str(decision_authority.get("investorId") or "").strip()
            if investor_id:
                plan_draft["chuDauTuId"] = investor_id
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
            decision_authority = {}
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

        selected_local_targets = (
            decision_authority.get("localTargetsByRevision") or {}
        ).get(str(revision.get("revisionId") or ""), {})

        def attach_local_root(package_draft):
            source = package_draft.get("sourceRevision") or {}
            observation_id = str(source.get("packageObservationId") or "")
            selected = selected_local_targets.get(observation_id) or {}
            stable_id = str(source.get("stablePackageId") or "").strip()
            symbol = str(package_draft.get("soHieuGoiThau") or "").strip().casefold()
            local_root_id = (
                selected.get("localRootId")
                or lineage_by_stable.get(stable_id)
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
            "decisionAuthority": {
                key: decision_authority.get(key)
                for key in ("status", "decisionsDigest", "investorId")
                if decision_authority.get(key) is not None
            },
            "warnings": deepcopy(row["canonicalBundle"].get("warnings") or []),
        }
        record_database_phase(
            "procurement_import", "session_read",
            time.perf_counter() - started,
        )
        return response
