"""Prepare immutable, scoped procurement import previews."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import secrets
import time
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
from backend.observability.recording import record_database_phase


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
    def __init__(
        self,
        source,
        preview_store: PreviewStore,
        *,
        raw_snapshot_repository=None,
        raw_cache_ttl_seconds=900,
    ):
        self.source = source
        self.preview_store = preview_store
        self.raw_snapshot_repository = raw_snapshot_repository
        self.raw_cache_ttl_seconds = max(
            1.0, min(float(raw_cache_ttl_seconds), 86_400.0)
        )

    def _lookup_complete_bundle(
        self, code, kind, organization_id, *, detail_level="COMPLETE",
    ):
        raw_bundle = None
        loader_name = (
            "load_fresh_plan_bundle" if kind == "PLAN"
            else "load_fresh_notice_bundle"
        )
        loader = getattr(self.raw_snapshot_repository, loader_name, None)
        project = getattr(self.source, "lookup_from_raw_bundle", None)
        if callable(loader) and callable(project):
            loader_options = {
                "revision_mode": "ALL",
                "revision_numbers": [],
                "max_age_seconds": self.raw_cache_ttl_seconds,
            }
            if kind == "PACKAGE":
                loader_options["detail_level"] = detail_level
            raw_bundle = loader(
                organization_id,
                code,
                **loader_options,
            )
        if isinstance(raw_bundle, dict):
            complete = project(
                code, raw_bundle, revision_mode="ALL",
                detail_level=detail_level,
            )
            complete.setdefault("rawBundle", raw_bundle)
            complete.setdefault("metrics", {})["cache"] = {
                "hit": True, "layer": "RAW_SNAPSHOT",
            }
        else:
            complete_lookup = getattr(self.source, "lookup_with_options", None)
            if not callable(complete_lookup):
                return None
            complete = complete_lookup(
                code,
                kind,
                detail_level=detail_level,
                revision_mode="ALL",
                revision_numbers=[],
            )
        cache_metadata = (complete.get("metrics") or {}).get("cache") or {}
        cache_hit = cache_metadata.get("hit") is True
        record_database_phase(
            "procurement_import", "source_cache", 0,
            outcome=("hit" if cache_hit else "miss"),
        )
        captured_bundle = complete.get("rawBundle")
        if (
            not cache_hit
            and detail_level == "COMPLETE"
            and self.raw_snapshot_repository is not None
            and isinstance(captured_bundle, dict)
        ):
            self.raw_snapshot_repository.save_bundle(
                organization_id, captured_bundle
            )
        return complete

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

    def _enrich_linked_notices(
        self, revision, *, organization_id, complete_cache=None,
    ):
        complete_cache = complete_cache if complete_cache is not None else {}
        for package in revision.get("packages", []):
            link = package.get("noticeLink") or {}
            notice_no = str(link.get("noticeNo") or "").strip().upper()
            if link.get("state") != "LINKED" or not notice_no:
                continue
            desired_version = str(link.get("noticeVersion") or "").strip()
            complete = complete_cache.get(notice_no)
            if notice_no not in complete_cache:
                complete = self._lookup_complete_bundle(
                    notice_no, "PACKAGE", organization_id,
                    detail_level="INVITATION",
                )
                complete_cache[notice_no] = complete
            if complete is not None:
                revisions = sorted(
                    deepcopy((complete.get("canonical") or {}).get("revisions") or []),
                    key=lambda row: revision_sort_key(row.get("revisionNumber")),
                )
                detail = next((
                    row for row in revisions
                    if desired_version
                    and str(row.get("revisionNumber")) == desired_version
                ), revisions[-1] if revisions and not desired_version else None)
                if detail is None:
                    raise LookupError("PROCUREMENT_REVISION_INVALID")
                selected = {
                    "revisionId": detail.get("revisionId"),
                    "revisionNumber": detail.get("revisionNumber"),
                }
            else:
                available = sorted(
                    self.source.list_notice_revisions(notice_no),
                    key=lambda row: revision_sort_key(row.get("revisionNumber")),
                )
                if not available:
                    continue
                selected = next((
                    row for row in available
                    if desired_version
                    and str(row.get("revisionNumber")) == desired_version
                ), available[-1] if not desired_version else None)
                if selected is None:
                    raise LookupError("PROCUREMENT_REVISION_INVALID")
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
                    "publishedAt", "bidClosingAt",
                    "selectionForm", "selectionMode", "contractType",
                    "publicUrl",
                )
                if detail.get(field) not in (None, "")
            }
            notice_fields["status"] = "PUBLISHED"
            if notice_fields:
                package["noticeFields"] = notice_fields
            for field in (
                "bidGuaranteeVnd",
                "approvalDecisionNo",
                "approvalDecisionDate",
            ):
                if detail.get(field) not in (None, ""):
                    package[field] = deepcopy(detail[field])

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
        prepare_started = time.perf_counter()
        normalized = normalize_procurement_code(code)
        if normalized.kind is not ProcurementCodeKind.PLAN:
            raise ValueError("PROCUREMENT_CODE_INVALID")
        mode = str(revision_mode or "LATEST").upper()
        complete_lookup = getattr(self.source, "lookup_with_options", None)
        source_started = time.perf_counter()
        if mode == "ALL" and callable(complete_lookup):
            complete = self._lookup_complete_bundle(
                normalized.base_code, "PLAN", organization_id
            )
            canonical = complete.get("canonical") or {}
            revisions = deepcopy(canonical.get("revisions") or [])
            available = [
                {
                    "revisionId": row.get("revisionId"),
                    "revisionNumber": row.get("revisionNumber"),
                }
                for row in revisions
            ]
            selected = available
            if not revisions:
                raise LookupError("PROCUREMENT_REVISION_INVALID")
        else:
            available = self.source.list_plan_revisions(normalized.base_code)
            selected = self._select_revisions(
                available,
                mode,
                normalized.requested_revision,
                selected_revision,
            )
            revisions = [
                self.source.get_plan_revision(
                    normalized.base_code, row["revisionId"]
                )
                for row in selected
            ]
        if include_linked_notices:
            linked_notice_cache = {}
            for revision in revisions:
                self._enrich_linked_notices(
                    revision,
                    organization_id=organization_id,
                    complete_cache=linked_notice_cache,
                )
        record_database_phase(
            "procurement_import", "source_fetch",
            time.perf_counter() - source_started,
        )
        normalize_started = time.perf_counter()
        source_revision_digests = {
            str(revision["revisionId"]): canonical_digest(revision)
            for revision in revisions
        }
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
                digest_changed = (
                    observed.get("digest")
                    and observed.get("digest") != revision_digest
                )
                disposition = (
                    "RESYNC"
                    if digest_changed and self.source.name == "MUASAMCONG"
                    else "ALREADY_IMPORTED"
                )
                if digest_changed and self.source.name != "MUASAMCONG":
                    blocking_issues.append({
                        "code": "PROCUREMENT_REVISION_CONFLICT",
                        "sourceRevisionId": revision["revisionId"],
                        "sourceRevisionNumber": revision["revisionNumber"],
                    })
            elif self.source.name != "MUASAMCONG" and latest_external is not None and (
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
        record_database_phase(
            "procurement_import", "canonical_normalize",
            time.perf_counter() - normalize_started,
        )
        record_database_phase(
            "procurement_import", "prepare",
            time.perf_counter() - prepare_started,
        )
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
        prepare_started = time.perf_counter()
        normalized = normalize_procurement_code(code)
        if normalized.kind is not ProcurementCodeKind.NOTICE:
            raise ValueError("PROCUREMENT_CODE_INVALID")
        mode = str(revision_mode or "LATEST").upper()
        source_started = time.perf_counter()
        complete_lookup = getattr(self.source, "lookup_with_options", None)
        if mode == "ALL" and callable(complete_lookup):
            complete = self._lookup_complete_bundle(
                normalized.base_code, "PACKAGE", organization_id
            )
            revisions = sorted(
                deepcopy((complete.get("canonical") or {}).get("revisions") or []),
                key=lambda row: revision_sort_key(row.get("revisionNumber")),
            )
            if not revisions:
                raise LookupError("PROCUREMENT_REVISION_INVALID")
            available = [
                {
                    "revisionId": row.get("revisionId"),
                    "revisionNumber": str(row.get("revisionNumber")),
                }
                for row in revisions
            ]
            relationships = [
                {
                    "planNo": revision.get("planNo"),
                    "planDetailRevisionId": revision.get("planDetailRevisionId"),
                    "stablePackageId": revision.get("stablePackageId"),
                    "symbol": revision.get("symbol"),
                }
                if revision.get("planNo") else {}
                for revision in revisions
            ]
        else:
            available = self.source.list_notice_revisions(normalized.base_code)
            selected = self._select_revisions(
                available, mode, normalized.requested_revision, selected_revision
            )
            revisions = []
            relationships = []
            for selected_row in selected:
                revision = self.source.get_notice_revision(
                    normalized.base_code, selected_row["revisionId"]
                )
                relationship = self.source.resolve_notice_package(
                    normalized.base_code, selected_row["revisionId"]
                )
                revision = {
                    **deepcopy(revision),
                    "noticeNo": normalized.base_code,
                    "revisionId": selected_row["revisionId"],
                    "revisionNumber": str(selected_row.get("revisionNumber")),
                }
                revisions.append(revision)
                relationships.append(relationship or {})
        for revision, relationship in zip(revisions, relationships, strict=True):
            revision["noticeNo"] = normalized.base_code
            revision["revisionNumber"] = str(revision.get("revisionNumber"))
            revision["relationship"] = deepcopy(relationship or {})
            revision["revisionDigest"] = canonical_digest(revision)
        record_database_phase(
            "procurement_import", "source_fetch",
            time.perf_counter() - source_started,
        )
        normalize_started = time.perf_counter()
        relationship = relationships[-1]
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
        relationship_identities = {
            (
                str(row.get("planNo") or "").upper(),
                str(row.get("stablePackageId") or "")
                or str(row.get("planDetailRevisionId") or "")
                or str(row.get("symbol") or "").casefold(),
            )
            for row in relationships
            if row
        }
        if len(relationship_identities) > 1:
            blocking_issues.append({
                "code": "PROCUREMENT_MATCH_AMBIGUOUS",
                "noticeNo": normalized.base_code,
            })
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
                "selectedRevisions": [
                    str(row["revisionNumber"]) for row in revisions
                ],
                "expectedPackageRowVersion": (
                    None if target is None else target_preview["rowVersion"]
                ),
                "targetPackage": target_preview,
                "relationship": deepcopy(relationship or {}),
                "preview": {
                    key: deepcopy(value)
                    for key, value in revisions[-1].items()
                    if key not in {"revisionDigest", "relationship"}
                },
            },
            "revisions": revisions,
            "revisionPreviews": [
                {
                    "revisionId": row["revisionId"],
                    "revisionNumber": row["revisionNumber"],
                    "revisionDigest": row["revisionDigest"],
                    "disposition": "MATERIALIZE",
                }
                for row in revisions
            ],
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
            if key != "revisions"
        }
        response.update({
            "previewId": stored.preview_id,
            "expiresAt": stored.expires_at.isoformat(),
            "bundleDigest": stored.bundle_digest,
        })
        record_database_phase(
            "procurement_import", "canonical_normalize",
            time.perf_counter() - normalize_started,
        )
        record_database_phase(
            "procurement_import", "prepare",
            time.perf_counter() - prepare_started,
        )
        return response
