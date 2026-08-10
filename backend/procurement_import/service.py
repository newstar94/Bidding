"""Prepare immutable, scoped procurement import previews."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import secrets
from threading import RLock

from backend.procurement_import.domain import (
    PREVIEW_SCHEMA_VERSION,
    PackageAction,
    ProcurementCodeKind,
    canonical_digest,
    derive_import_lifecycle_status,
    normalize_procurement_code,
    package_source_fields,
    required_package_issues,
    revision_sort_key,
    three_way_merge_field,
)


@dataclass(frozen=True, slots=True)
class StoredPreview:
    preview_id: str
    organization_id: str
    user_id: str
    workspace_lease: str
    expires_at: datetime
    bundle_digest: str
    canonical_bundle: dict


class PreviewStore:
    """Small process-local cache; production may replace it with shared storage."""

    def __init__(self, ttl_seconds: int = 300):
        self.ttl_seconds = max(1, min(int(ttl_seconds), 1800))
        self._items: dict[str, StoredPreview] = {}
        self._lock = RLock()

    def put(self, canonical_bundle, *, organization_id, user_id, workspace_lease):
        now = datetime.now(timezone.utc)
        stored = StoredPreview(
            preview_id=secrets.token_urlsafe(32),
            organization_id=str(organization_id),
            user_id=str(user_id),
            workspace_lease=str(workspace_lease),
            expires_at=now + timedelta(seconds=self.ttl_seconds),
            bundle_digest=canonical_digest(canonical_bundle),
            canonical_bundle=deepcopy(canonical_bundle),
        )
        with self._lock:
            self._items[stored.preview_id] = stored
        return stored

    def get(self, preview_id, *, organization_id, user_id, workspace_lease, now=None):
        with self._lock:
            stored = self._items.get(str(preview_id))
        if stored is None:
            raise LookupError("PROCUREMENT_PREVIEW_EXPIRED")
        if (
            stored.organization_id != str(organization_id)
            or stored.user_id != str(user_id)
            or stored.workspace_lease != str(workspace_lease)
        ):
            raise PermissionError("PROCUREMENT_PREVIEW_SCOPE_INVALID")
        if (now or datetime.now(timezone.utc)) >= stored.expires_at:
            with self._lock:
                self._items.pop(stored.preview_id, None)
            raise LookupError("PROCUREMENT_PREVIEW_EXPIRED")
        return stored


class ProcurementImportPreparer:
    def __init__(self, source, preview_store: PreviewStore):
        self.source = source
        self.preview_store = preview_store

    def _select_revisions(self, available, mode, requested, selected):
        ordered = sorted(
            available,
            key=lambda row: revision_sort_key(row.get("revisionNumber")),
        )
        if not ordered:
            raise LookupError("PROCUREMENT_REVISION_INVALID")
        selected_number = selected or requested
        if mode == "ALL":
            return ordered
        if mode == "SELECTED" or selected_number:
            match = next((
                row for row in ordered
                if str(row.get("revisionNumber")) == str(selected_number)
            ), None)
            if match is None:
                raise LookupError("PROCUREMENT_REVISION_INVALID")
            return [match]
        if mode != "LATEST":
            raise ValueError("PROCUREMENT_REVISION_INVALID")
        return [ordered[-1]]

    def _enrich_linked_notices(self, revision):
        for package in revision.get("packages", []):
            link = package.get("noticeLink") or {}
            notice_no = str(link.get("noticeNo") or "").strip().upper()
            if link.get("state") != "LINKED" or not notice_no:
                continue
            available = sorted(
                self.source.list_notice_revisions(notice_no),
                key=lambda row: revision_sort_key(row.get("revisionNumber")),
            )
            if not available:
                continue
            selected = available[-1]
            detail = self.source.get_notice_revision(
                notice_no, selected.get("revisionId")
            )
            kind = str(detail.get("kind") or "UNKNOWN").upper()
            if kind not in {"TBMT", "PRE_NOTIFY"}:
                kind = "UNKNOWN"
            package["noticeLink"] = {
                "state": "LINKED", "noticeNo": notice_no, "kind": kind,
                "noticeRevisionId": selected.get("revisionId"),
                "noticeVersion": str(selected.get("revisionNumber")),
            }
            notice_fields = {
                field: deepcopy(detail.get(field))
                for field in (
                    "status", "publishedAt", "bidClosingAt", "bidOpeningAt",
                    "selectionForm", "selectionMode", "contractType",
                    "publicUrl",
                )
                if detail.get(field) not in (None, "")
            }
            if notice_fields:
                package["noticeFields"] = notice_fields

    @staticmethod
    def _match_candidates(observation, local_packages):
        stable_id = str(observation.get("stablePackageId") or "").strip()
        if stable_id:
            stable_matches = [
                row for row in local_packages
                if str(row.get("stableExternalId") or "").strip() == stable_id
            ]
            if stable_matches:
                return stable_matches
        notice_no = str(
            (observation.get("noticeLink") or {}).get("noticeNo") or ""
        ).strip().upper()
        if notice_no:
            notice_matches = [
                row for row in local_packages
                if str(row.get("noticeNo") or "").strip().upper() == notice_no
            ]
            if notice_matches:
                return notice_matches
        symbol = str(observation.get("symbol") or "").strip().casefold()
        return [
            row for row in local_packages
            if symbol and str(row.get("symbol") or "").strip().casefold() == symbol
        ]

    def _reconcile_packages(self, source_packages, local_state):
        local_packages = list((local_state or {}).get("packages") or [])
        matched_snapshot_ids = set()
        preview_rows = []
        for observation in source_packages:
            row = deepcopy(observation)
            candidates = self._match_candidates(observation, local_packages)
            if len(candidates) > 1:
                matched_snapshot_ids.update(
                    str(candidate.get("id")) for candidate in candidates
                )
                row.update({
                    "action": PackageAction.AMBIGUOUS.value,
                    "matchCandidates": [
                        {
                            "rootId": candidate.get("rootId") or candidate.get("id"),
                            "snapshotId": candidate.get("id"),
                            "name": candidate.get("name"),
                            "symbol": candidate.get("symbol"),
                        }
                        for candidate in candidates
                    ],
                })
                preview_rows.append(row)
                continue
            if not candidates:
                row["action"] = PackageAction.ADDED.value
                row["effectiveFields"] = package_source_fields(observation)
                preview_rows.append(row)
                continue
            matched = candidates[0]
            matched_snapshot_ids.add(str(matched.get("id")))
            base_fields = matched.get("sourceFields") or {}
            local_fields = matched.get("localFields") or base_fields
            source_fields = package_source_fields(observation)
            effective_fields = {}
            field_conflicts = []
            for field in dict.fromkeys((*base_fields, *local_fields, *source_fields)):
                effective, disposition = three_way_merge_field(
                    base_fields.get(field), local_fields.get(field),
                    source_fields.get(field),
                )
                effective_fields[field] = effective
                if disposition == "CONFLICT":
                    field_conflicts.append({
                        "field": field,
                        "baseValue": deepcopy(base_fields.get(field)),
                        "localValue": deepcopy(local_fields.get(field)),
                        "sourceValue": deepcopy(source_fields.get(field)),
                    })
            row.update({
                "action": (
                    PackageAction.CHANGED.value
                    if source_fields != base_fields
                    else PackageAction.UNCHANGED.value
                ),
                "localTarget": {
                    "rootId": matched.get("rootId") or matched.get("id"),
                    "snapshotId": matched.get("id"),
                    "localVersion": int(matched.get("localVersion") or 0),
                    "rowVersion": int(matched.get("rowVersion") or 1),
                },
                "fieldConflicts": field_conflicts,
                "effectiveFields": effective_fields,
            })
            preview_rows.append(row)
        for local in local_packages:
            if str(local.get("id")) in matched_snapshot_ids:
                continue
            preview_rows.append({
                "symbol": local.get("symbol"),
                "name": local.get("name"),
                "action": PackageAction.REMOVED.value,
                "localTarget": {
                    "rootId": local.get("rootId") or local.get("id"),
                    "snapshotId": local.get("id"),
                    "localVersion": int(local.get("localVersion") or 0),
                    "rowVersion": int(local.get("rowVersion") or 1),
                },
            })
        return preview_rows

    def prepare_plan(
        self,
        *,
        code,
        revision_mode,
        organization_id,
        user_id,
        workspace_lease,
        local_state,
        selected_revision=None,
        include_linked_notices=True,
    ):
        normalized = normalize_procurement_code(code)
        if normalized.kind is not ProcurementCodeKind.PLAN:
            raise ValueError("PROCUREMENT_CODE_INVALID")
        available = self.source.list_plan_revisions(normalized.base_code)
        selected = self._select_revisions(
            available,
            str(revision_mode or "LATEST").upper(),
            normalized.requested_revision,
            selected_revision,
        )
        revisions = [
            self.source.get_plan_revision(normalized.base_code, row["revisionId"])
            for row in selected
        ]
        source_revision_digests = {
            str(revision["revisionId"]): canonical_digest(revision)
            for revision in revisions
        }
        if include_linked_notices:
            for revision in revisions:
                self._enrich_linked_notices(revision)
        lifecycle_warnings = []
        for revision in revisions:
            for package in revision.get("packages", []):
                package["lifecycleStatus"] = derive_import_lifecycle_status(package)
                if package["lifecycleStatus"] == "UNKNOWN":
                    lifecycle_warnings.append({
                        "code": "PROCUREMENT_LIFECYCLE_UNKNOWN",
                        "message": (
                            "Chưa đủ bằng chứng để suy ra trạng thái gói thầu."
                        ),
                        "packageObservationId": package.get(
                            "planDetailRevisionId"
                        ),
                        "sourceRevisionId": revision.get("revisionId"),
                    })
        revision_previews = []
        blocking_issues = []
        observed_revisions = (local_state or {}).get("observedRevisions") or {}
        latest_external = (local_state or {}).get("latestAppliedExternalRevision")
        for revision in revisions:
            revision_digest = source_revision_digests[str(revision["revisionId"])]
            revision["revisionDigest"] = revision_digest
            observed = observed_revisions.get(str(revision["revisionId"]))
            if observed:
                disposition = "ALREADY_IMPORTED"
                if observed.get("digest") and observed.get("digest") != revision_digest:
                    blocking_issues.append({
                        "code": "PROCUREMENT_REVISION_CONFLICT",
                        "sourceRevisionId": revision["revisionId"],
                        "sourceRevisionNumber": revision["revisionNumber"],
                    })
            elif latest_external is not None and (
                revision_sort_key(revision.get("revisionNumber"))
                < revision_sort_key(latest_external)
            ):
                disposition = "PROVENANCE_ONLY"
            else:
                disposition = "MATERIALIZE"
            revision_previews.append({
                "revisionId": revision["revisionId"],
                "revisionNumber": revision["revisionNumber"],
                "revisionDigest": revision_digest,
                "disposition": disposition,
            })
            if disposition == "MATERIALIZE":
                for package in revision.get("packages", []):
                    for issue in required_package_issues(package):
                        blocking_issues.append({
                            **issue,
                            "sourceRevisionId": revision["revisionId"],
                            "sourceRevisionNumber": revision["revisionNumber"],
                        })
        # The package table is a preview of the effective (latest selected)
        # snapshot.  ALL mode still keeps every canonical revision server-side
        # for chronological apply and validates every one above.
        reconciliation_by_revision = {
            str(revision["revisionId"]): self._reconcile_packages(
                revision.get("packages", []), local_state
            )
            for revision in revisions
        }
        packages = reconciliation_by_revision[str(revisions[-1]["revisionId"])]
        if revision_previews[-1]["disposition"] == "ALREADY_IMPORTED":
            for package in packages:
                if package.get("action") != PackageAction.REMOVED.value:
                    package["action"] = PackageAction.ALREADY_IMPORTED.value
        warnings = lifecycle_warnings
        mode = str(revision_mode or "LATEST").upper()
        if local_state is None and mode != "ALL" and len(available) > 1:
            warnings.append({
                "code": "OLDER_REVISIONS_PROVENANCE_ONLY_AFTER_APPLY",
                "message": "Nên chọn toàn bộ lịch sử trước lần áp dụng đầu tiên.",
            })
        bundle = {
            "schemaVersion": PREVIEW_SCHEMA_VERSION,
            "provider": self.source.name,
            "originalCode": normalized.original,
            "revisionMode": mode,
            "includeLinkedNotices": bool(include_linked_notices),
            "plan": {
                "familyNo": normalized.base_code,
                "expectedRowVersion": (
                    None if local_state is None
                    else (local_state.get("latestPlan") or {}).get("rowVersion")
                ),
                "availableRevisions": [str(row.get("revisionNumber")) for row in sorted(available, key=lambda item: revision_sort_key(item.get("revisionNumber")))],
                "selectedRevisions": [str(row["revisionNumber"]) for row in revisions],
                "targetAction": "CREATE" if local_state is None else "VERSION",
                "preview": {
                    key: deepcopy(value)
                    for key, value in revisions[-1].items()
                    if key not in {"packages", "revisionDigest"}
                },
            },
            "revisionPreviews": revision_previews,
            "revisions": revisions,
            "reconciliationByRevision": reconciliation_by_revision,
            "packages": packages,
            "blockingIssues": blocking_issues,
            "warnings": warnings,
        }
        stored = self.preview_store.put(
            bundle,
            organization_id=organization_id,
            user_id=user_id,
            workspace_lease=workspace_lease,
        )
        response = {
            key: deepcopy(value) for key, value in bundle.items()
            if key not in {"revisions", "reconciliationByRevision"}
        }
        response.update({
            "previewId": stored.preview_id,
            "expiresAt": stored.expires_at.isoformat(),
            "bundleDigest": stored.bundle_digest,
        })
        return response

    def prepare_notice(
        self,
        *,
        code,
        revision_mode,
        organization_id,
        user_id,
        workspace_lease,
        resolve_local_target,
        selected_revision=None,
        target_package_root_id=None,
    ):
        normalized = normalize_procurement_code(code)
        if normalized.kind is not ProcurementCodeKind.NOTICE:
            raise ValueError("PROCUREMENT_CODE_INVALID")
        mode = str(revision_mode or "LATEST").upper()
        if mode == "ALL":
            raise ValueError("PROCUREMENT_REVISION_INVALID")
        available = self.source.list_notice_revisions(normalized.base_code)
        selected = self._select_revisions(
            available, mode, normalized.requested_revision, selected_revision
        )
        selected_row = selected[-1]
        revision = self.source.get_notice_revision(
            normalized.base_code, selected_row["revisionId"]
        )
        revision = {
            **deepcopy(revision),
            "noticeNo": normalized.base_code,
            "revisionId": selected_row["revisionId"],
            "revisionNumber": str(selected_row.get("revisionNumber")),
        }
        relationship = self.source.resolve_notice_package(
            normalized.base_code, selected_row["revisionId"]
        )
        revision["relationship"] = deepcopy(relationship or {})
        revision["revisionDigest"] = canonical_digest(revision)
        target = (
            resolve_local_target(
                normalized.base_code,
                relationship or {},
                target_package_root_id,
            )
            if callable(resolve_local_target)
            else None
        )
        blocking_issues = []
        if target is None:
            blocking_issues.append({
                "code": "PROCUREMENT_NOTICE_PACKAGE_UNRESOLVED",
                "noticeNo": normalized.base_code,
                "relationship": deepcopy(relationship or {}),
            })
        target_preview = None if target is None else {
            "rootId": target.get("rootId") or target.get("id"),
            "snapshotId": target.get("id"),
            "planSnapshotId": target.get("planSnapshotId"),
            "localVersion": int(target.get("localVersion") or 0),
            "rowVersion": int(target.get("rowVersion") or 1),
        }
        bundle = {
            "schemaVersion": PREVIEW_SCHEMA_VERSION,
            "provider": self.source.name,
            "importKind": "NOTICE",
            "originalCode": normalized.original,
            "revisionMode": mode,
            "notice": {
                "noticeNo": normalized.base_code,
                "availableRevisions": [
                    str(row.get("revisionNumber"))
                    for row in sorted(
                        available,
                        key=lambda row: revision_sort_key(row.get("revisionNumber")),
                    )
                ],
                "selectedRevision": revision["revisionNumber"],
                "expectedPackageRowVersion": (
                    None if target is None else target_preview["rowVersion"]
                ),
                "targetPackage": target_preview,
                "relationship": deepcopy(relationship or {}),
                "preview": {
                    key: deepcopy(value)
                    for key, value in revision.items()
                    if key not in {"revisionDigest", "relationship"}
                },
            },
            "revision": revision,
            "targetPackageRootId": (
                None if target is None else target_preview["rootId"]
            ),
            "blockingIssues": blocking_issues,
            "warnings": [],
        }
        stored = self.preview_store.put(
            bundle,
            organization_id=organization_id,
            user_id=user_id,
            workspace_lease=workspace_lease,
        )
        response = {
            key: deepcopy(value) for key, value in bundle.items()
            if key != "revision"
        }
        response.update({
            "previewId": stored.preview_id,
            "expiresAt": stored.expires_at.isoformat(),
            "bundleDigest": stored.bundle_digest,
        })
        return response
