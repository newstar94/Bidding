"""Authoritative revision reconciliation independent of provider payloads."""

from __future__ import annotations

from copy import deepcopy
from uuid import NAMESPACE_URL, uuid5

from backend.procurement_import.domain import (
    ImportConflict,
    canonical_digest,
    derive_import_lifecycle_status,
    package_source_fields,
    revision_sort_key,
)


def _id(idempotency_key, *parts):
    return str(uuid5(NAMESPACE_URL, ":".join((str(idempotency_key), *map(str, parts)))))


def _latest_applied_number(repository, organization_id, provider, family_no):
    method = getattr(repository, "latest_applied_revision", None)
    if method:
        row = method(organization_id, provider, family_no)
        return None if row is None else row.get("revisionNumber")
    rows = [
        row for (org, source, _revision), row in getattr(repository, "revisions", {}).items()
        if org == organization_id and source == provider
        and row.get("familyNo") == family_no
        and row.get("disposition") == "APPLIED"
    ]
    if not rows:
        return None
    return max(rows, key=lambda row: revision_sort_key(row.get("revisionNumber"))).get("revisionNumber")


def _match_package(observation, current_packages, decision=None):
    if decision:
        if decision.get("new") is True:
            return None
        selected_root = str(decision.get("localRootId") or "").strip()
        selected = [
            row for row in current_packages
            if selected_root
            and str(row.get("rootId") or row.get("id")) == selected_root
        ]
        if len(selected) != 1:
            raise ImportConflict("PROCUREMENT_MATCH_DECISION_INVALID")
        return selected[0]
    stable_id = str(observation.get("stablePackageId") or "").strip()
    if stable_id:
        matches = [
            row for row in current_packages
            if str(row.get("stableExternalId") or "").strip() == stable_id
        ]
        if len(matches) == 1:
            return matches[0]
        if len(matches) > 1:
            raise ImportConflict("PROCUREMENT_MATCH_AMBIGUOUS")
    notice_no = str((observation.get("noticeLink") or {}).get("noticeNo") or "").strip().upper()
    if notice_no:
        matches = [row for row in current_packages if str(row.get("noticeNo") or "").strip().upper() == notice_no]
        if len(matches) == 1:
            return matches[0]
        if len(matches) > 1:
            raise ImportConflict("PROCUREMENT_MATCH_AMBIGUOUS")
    symbol = str(observation.get("symbol") or "").strip().casefold()
    matches = [
        row for row in current_packages
        if symbol and str(row.get("symbol") or "").strip().casefold() == symbol
    ]
    if len(matches) > 1:
        raise ImportConflict("PROCUREMENT_MATCH_AMBIGUOUS")
    return matches[0] if matches else None


_NOTICE_MATERIAL_FIELDS = (
    "noticeNo",
    "kind",
    "status",
    "publishedAt",
    "bidClosingAt",
    "bidOpeningAt",
)


def _notice_material_snapshot(notice):
    return {
        field: deepcopy(notice.get(field))
        for field in _NOTICE_MATERIAL_FIELDS
    }


def _package_notice_material_snapshot(package):
    source_fields = package.get("sourceFields") or {}
    link = source_fields.get("noticeLink") or {}
    notice_fields = package.get("noticeFields") or source_fields.get("noticeFields") or {}
    return {
        "noticeNo": package.get("noticeNo") or link.get("noticeNo"),
        "kind": package.get("noticeKind") or link.get("kind") or "UNKNOWN",
        "status": notice_fields.get("status"),
        "publishedAt": notice_fields.get("publishedAt"),
        "bidClosingAt": notice_fields.get("bidClosingAt"),
        "bidOpeningAt": notice_fields.get("bidOpeningAt"),
    }


class ProcurementNoticeReconciler:
    """Apply one exact notice revision to an existing package lineage."""

    def __init__(self, repository):
        self.repository = repository

    def reconcile_revision(
        self,
        *,
        organization_id,
        actor_user_id,
        provider,
        notice,
        idempotency_key,
        expected_package_row_version,
        target_package_root_id=None,
    ):
        notice_no = str(notice.get("noticeNo") or "").strip().upper()
        revision_id = str(notice.get("revisionId") or "").strip()
        revision_number = str(notice.get("revisionNumber") or "").strip()
        if not notice_no or not revision_id or not revision_number or not idempotency_key:
            raise ValueError("PROCUREMENT_REVISION_INVALID")
        digest = str(notice.get("revisionDigest") or canonical_digest(notice))
        self.repository.lock_family(organization_id, provider, notice_no)
        observed = self.repository.find_notice_revision(
            organization_id, provider, revision_id
        )
        if observed:
            if observed.get("digest") != digest:
                raise ImportConflict("PROCUREMENT_REVISION_CONFLICT")
            return {
                "operation": "NOOP", "createdPlans": [], "createdPackages": [],
                "bindings": [], "provenance": observed,
            }
        relationship = deepcopy(notice.get("relationship") or {})
        target = self.repository.resolve_notice_target(
            organization_id, provider, notice_no, relationship,
            target_root_id=target_package_root_id,
        )
        if target is None:
            raise ImportConflict("PROCUREMENT_NOTICE_PACKAGE_UNRESOLVED")
        if int(target.get("rowVersion") or 1) != int(expected_package_row_version or 0):
            raise ImportConflict("PROCUREMENT_PREVIEW_STALE")

        previous_notice = self.repository.latest_notice_revision_for_package(
            organization_id, provider, target.get("rootId") or target["id"]
        )
        previous_material = (
            _notice_material_snapshot(previous_notice["normalizedSnapshot"])
            if previous_notice is not None
            else _package_notice_material_snapshot(target)
        )
        material = previous_material != _notice_material_snapshot(
            {**notice, "noticeNo": notice_no}
        )
        disposition = "APPLIED" if material else "OBSERVED_NOT_APPLIED"
        provenance = {
            "organizationId": organization_id,
            "provider": provider,
            "kind": "NOTICE",
            "familyNo": notice_no,
            "revisionId": revision_id,
            "revisionNumber": revision_number,
            "digest": digest,
            "schemaVersion": "biddingflow-procurement-canonical-v1",
            "normalizedSnapshot": deepcopy(notice),
            "actorUserId": actor_user_id,
            "idempotencyKey": str(idempotency_key),
            "disposition": disposition,
            "localEntityType": "goithau",
            "localRootId": target.get("rootId") or target["id"],
            "matchMethod": (
                "EXACT_NOTICE_NO"
                if str(target.get("noticeNo") or "").strip().upper() == notice_no
                else "EXACT_PLAN_PACKAGE"
            ),
            "publicUrl": notice.get("publicUrl"),
        }
        if not material:
            provenance["localSnapshotId"] = target["id"]
            result = {
                "operation": "PROVENANCE_ONLY", "createdPlans": [],
                "createdPackages": [], "bindings": [], "provenance": provenance,
            }
            self.repository.persist_revision(result)
            return result

        package_id = _id(idempotency_key, "notice", revision_id, target["id"])
        notice_fields = {
            field: deepcopy(notice.get(field))
            for field in (
                "status", "publishedAt", "bidClosingAt", "bidOpeningAt", "publicUrl"
            )
            if notice.get(field) is not None
        }
        source_fields = deepcopy(target.get("sourceFields") or {})
        source_fields["noticeLink"] = {
            "state": "LINKED", "noticeNo": notice_no,
            "kind": str(notice.get("kind") or "UNKNOWN").upper(),
            "noticeRevisionId": revision_id,
            "noticeVersion": revision_number,
        }
        source_fields["noticeFields"] = deepcopy(notice_fields)
        package = {
            "id": package_id,
            "rootId": target.get("rootId") or target["id"],
            "planSnapshotId": target["planSnapshotId"],
            "localVersion": int(target.get("localVersion") or 0) + 1,
            "rowVersion": 1,
            "symbol": target.get("symbol"),
            "name": target.get("name"),
            "noticeNo": notice_no,
            "noticeKind": str(notice.get("kind") or "UNKNOWN").upper(),
            "noticeRevisionId": revision_id,
            "noticeVersion": revision_number,
            "noticeFields": notice_fields,
            "sourceFields": source_fields,
            "canonicalSourceFields": source_fields,
            "assigneeUserId": target.get("assigneeUserId"),
            "cloneFromSnapshotId": target["id"],
            "supersedeSnapshotId": target["id"],
        }
        provenance["localSnapshotId"] = package_id
        bindings = []
        prior_binding = target.get("binding")
        if isinstance(prior_binding, dict):
            bindings.append({
                **deepcopy(prior_binding),
                "organizationId": organization_id,
                "provider": provider,
                "observationKey": (
                    f"{prior_binding.get('planRevisionId')}:"
                    f"{prior_binding.get('idDetail')}"
                ),
                "localRootId": package["rootId"],
                "localSnapshotId": package_id,
                "matchMethod": "NOTICE_VERSION_INHERITED",
            })
        result = {
            "operation": "APPLIED", "createdPlans": [],
            "createdPackages": [package], "bindings": bindings,
            "provenance": provenance,
        }
        self.repository.persist_revision(result)
        return result


class ProcurementPlanReconciler:
    def __init__(self, repository):
        self.repository = repository

    def reconcile_revision(
        self,
        *,
        organization_id,
        actor_user_id,
        provider,
        revision,
        idempotency_key,
        expected_plan_row_version,
        package_decisions=None,
    ):
        family_no = str(revision.get("familyNo") or "").strip().upper()
        revision_id = str(revision.get("revisionId") or "").strip()
        digest = str(revision.get("revisionDigest") or canonical_digest(revision))
        if not family_no or not revision_id or not idempotency_key:
            raise ValueError("PROCUREMENT_REVISION_INVALID")
        self.repository.lock_family(organization_id, provider, family_no)
        observed = self.repository.find_revision(organization_id, provider, revision_id)
        if observed:
            if observed.get("digest") != digest:
                raise ImportConflict("PROCUREMENT_REVISION_CONFLICT")
            return {
                "operation": "NOOP", "createdPlans": [], "createdPackages": [],
                "bindings": [], "provenance": observed,
            }
        family = self.repository.load_family(organization_id, provider, family_no)
        latest_plan = family.get("latestPlan")
        if latest_plan is not None and int(latest_plan.get("rowVersion") or 1) != int(expected_plan_row_version or 0):
            raise ImportConflict("PROCUREMENT_PREVIEW_STALE")
        latest_external = _latest_applied_number(
            self.repository, organization_id, provider, family_no
        )
        provenance_only = latest_external is not None and (
            revision_sort_key(revision.get("revisionNumber"))
            < revision_sort_key(latest_external)
        )
        disposition = "OBSERVED_NOT_APPLIED" if provenance_only else "APPLIED"
        normalized_snapshot = deepcopy(revision)
        for package in normalized_snapshot.get("packages") or []:
            package.pop("_sourceAction", None)
            package.pop("_canonicalSourceFields", None)
        provenance = {
            "organizationId": organization_id,
            "provider": provider,
            "kind": "PLAN",
            "familyNo": family_no,
            "revisionId": revision_id,
            "revisionNumber": str(revision.get("revisionNumber")),
            "digest": digest,
            "schemaVersion": "biddingflow-procurement-canonical-v1",
            "normalizedSnapshot": normalized_snapshot,
            "actorUserId": actor_user_id,
            "idempotencyKey": str(idempotency_key),
            "disposition": disposition,
        }
        if provenance_only:
            result = {
                "operation": "PROVENANCE_ONLY", "createdPlans": [],
                "createdPackages": [], "bindings": [], "provenance": provenance,
            }
            self.repository.persist_revision(result)
            return result
        plan_id = _id(idempotency_key, "plan", revision_id)
        plan_root = plan_id if latest_plan is None else latest_plan.get("rootId", latest_plan["id"])
        plan_fields = deepcopy(revision.get("plan") or {})
        if not plan_fields:
            plan_fields = {
                key: deepcopy(revision.get(key))
                for key in (
                    "name", "planType", "projectCode", "projectName",
                    "capitalDetail", "totalAmountVnd", "investorCode",
                    "investorName", "investorId", "approvalDecisionNo",
                    "approvalDecisionDate", "publishedAt", "publicUrl",
                )
                if key in revision
            }
        created_plan = {
            "id": plan_id,
            "rootId": plan_root,
            "familyNo": family_no,
            "localVersion": 0 if latest_plan is None else int(latest_plan.get("localVersion") or 0) + 1,
            "rowVersion": 1,
            "sourceRevisionId": revision_id,
            **plan_fields,
        }
        created_packages = []
        bindings = []
        package_decisions = package_decisions or {}
        for index, observation in enumerate(revision.get("packages") or []):
            observation_id = str(observation.get("planDetailRevisionId") or "")
            decision = package_decisions.get(observation_id)
            matched = _match_package(
                observation, family.get("packages") or [], decision
            )
            source_fields = package_source_fields(observation)
            canonical_source_fields = deepcopy(
                observation.get("_canonicalSourceFields") or source_fields
            )
            source_action = str(observation.get("_sourceAction") or "").upper()
            changed = matched is not None and (
                source_action == "CHANGED"
                or (
                    source_action not in {"UNCHANGED", "ALREADY_IMPORTED"}
                    and source_fields != (matched.get("sourceFields") or {})
                )
            )
            package_id = _id(idempotency_key, "package", revision_id, index)
            root_id = package_id if matched is None else matched.get("rootId", matched["id"])
            local_version = 0 if matched is None else int(matched.get("localVersion") or 0) + int(changed)
            notice = observation.get("noticeLink") or {}
            package = {
                "id": package_id,
                "rootId": root_id,
                "planSnapshotId": plan_id,
                "localVersion": local_version,
                "rowVersion": 1,
                "symbol": observation.get("symbol"),
                "name": observation.get("name"),
                "noticeNo": notice.get("noticeNo"),
                "noticeKind": notice.get("kind") or "UNKNOWN",
                "noticeRevisionId": notice.get("noticeRevisionId"),
                "noticeVersion": notice.get("noticeVersion"),
                "noticeFields": deepcopy(observation.get("noticeFields") or {}),
                "initialStatus": (
                    observation.get("lifecycleStatus")
                    or derive_import_lifecycle_status(observation)
                ),
                "sourceFields": source_fields,
                "canonicalSourceFields": canonical_source_fields,
                "assigneeUserId": actor_user_id if matched is None else matched.get("assigneeUserId"),
                "cloneFromSnapshotId": None if matched is None else matched.get("id"),
            }
            created_packages.append(package)
            bindings.append({
                "organizationId": organization_id,
                "provider": provider,
                "observationKey": f"{revision_id}:{observation.get('planDetailRevisionId')}",
                "familyNo": family_no,
                "planRevisionId": revision_id,
                "idDetail": observation.get("planDetailRevisionId"),
                "stableExternalId": observation.get("stablePackageId"),
                "symbol": observation.get("symbol"),
                "noticeNo": notice.get("noticeNo"),
                "localRootId": root_id,
                "localSnapshotId": package_id,
                "matchMethod": "NEW" if matched is None else "EXACT_SYMBOL_OR_NOTICE",
            })
            if decision:
                bindings[-1]["matchMethod"] = "USER_CONFIRMED"
                bindings[-1]["confirmedBy"] = actor_user_id
            elif matched is not None and observation.get("stablePackageId"):
                bindings[-1]["matchMethod"] = "STABLE_EXTERNAL_ID"
        result = {
            "operation": "APPLIED",
            "createdPlans": [created_plan],
            "createdPackages": created_packages,
            "bindings": bindings,
            "provenance": provenance,
        }
        self.repository.persist_revision(result)
        return result
