"""Server-authoritative procurement preview decision resolution."""

from __future__ import annotations

from copy import deepcopy

from backend.procurement_import.domain import (
    SOURCE_OWNED_PACKAGE_FIELDS,
    canonical_digest,
    required_package_issues,
)


class ProcurementDecisionError(RuntimeError):
    """A bounded, public validation failure for preview decisions."""

    def __init__(self, code, message, status_code=409):
        super().__init__(code)
        self.code = code
        self.message = message
        self.status_code = status_code


def decision_rows(decisions, key):
    rows = (decisions or {}).get(key, [])
    if not isinstance(rows, list) or len(rows) > 500 or not all(
        isinstance(row, dict) for row in rows
    ):
        raise ProcurementDecisionError(
            "PROCUREMENT_DECISION_INVALID",
            "Quyết định preview không hợp lệ.",
            400,
        )
    return rows


def _decision_key(row):
    return (
        str(row.get("packageObservationId") or ""),
        str(row.get("field") or ""),
    )


def _coerce_required_value(field, value):
    if field == "priceVnd":
        if isinstance(value, bool):
            raise ProcurementDecisionError(
                "PROCUREMENT_DECISION_INVALID",
                "Giá trị trường bổ sung không hợp lệ.",
                400,
            )
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            raise ProcurementDecisionError(
                "PROCUREMENT_DECISION_INVALID",
                "Giá trị trường bổ sung không hợp lệ.",
                400,
            ) from None
        if parsed < 0 or str(value).strip() != str(parsed):
            raise ProcurementDecisionError(
                "PROCUREMENT_DECISION_INVALID",
                "Giá trị trường bổ sung không hợp lệ.",
                400,
            )
        return parsed
    if value is None:
        return ""
    if isinstance(value, (dict, list, tuple, set)):
        raise ProcurementDecisionError(
            "PROCUREMENT_DECISION_INVALID",
            "Giá trị trường bổ sung không hợp lệ.",
            400,
        )
    return str(value).strip()


def _reject_duplicate(rows, key):
    seen = set()
    for row in rows:
        marker = key(row)
        if marker in seen:
            raise ProcurementDecisionError(
                "PROCUREMENT_DECISION_INVALID",
                "Quyết định preview bị trùng lặp.",
                400,
            )
        seen.add(marker)


def _validate_bundle_decisions(revisions, reconciliation, decisions):
    observations = {
        str(package.get("planDetailRevisionId") or "")
        for revision in revisions
        for package in revision.get("packages") or []
        if package.get("planDetailRevisionId")
    }
    preview_rows = [
        row
        for revision in revisions
        for row in reconciliation.get(str(revision.get("revisionId") or ""), [])
    ]
    ambiguous = {
        str(row.get("planDetailRevisionId") or ""): row
        for row in preview_rows
        if row.get("action") == "AMBIGUOUS"
    }
    conflicts = {
        (str(row.get("planDetailRevisionId") or ""), str(item.get("field") or ""))
        for row in preview_rows
        for item in row.get("fieldConflicts") or []
    }
    required = {
        (
            str(package.get("planDetailRevisionId") or ""),
            str(issue.get("field") or ""),
        )
        for revision in revisions
        for package in revision.get("packages") or []
        for issue in required_package_issues(package)
    }

    matches = decision_rows(decisions, "packageMatches")
    field_values = decision_rows(decisions, "fieldValues")
    field_conflicts = decision_rows(decisions, "fieldConflicts")
    _reject_duplicate(matches, lambda row: str(row.get("packageObservationId") or ""))
    _reject_duplicate(field_values, _decision_key)
    _reject_duplicate(field_conflicts, _decision_key)

    for row in matches:
        observation_id = str(row.get("packageObservationId") or "")
        preview = ambiguous.get(observation_id)
        if observation_id not in observations or preview is None:
            raise ProcurementDecisionError(
                "PROCUREMENT_MATCH_DECISION_INVALID",
                "Quyết định ghép gói không thuộc preview hiện tại.",
                409,
            )
        selected_root = str(row.get("localRootId") or "").strip()
        is_new = row.get("new") is True
        candidate_roots = {
            str(candidate.get("rootId") or "")
            for candidate in preview.get("matchCandidates") or []
        }
        if is_new == bool(selected_root) or (
            selected_root and selected_root not in candidate_roots
        ):
            raise ProcurementDecisionError(
                "PROCUREMENT_MATCH_DECISION_INVALID",
                "Dòng gói được chọn không hợp lệ.",
                409,
            )

    for row in field_values:
        marker = _decision_key(row)
        if marker not in required or marker[1] not in SOURCE_OWNED_PACKAGE_FIELDS:
            raise ProcurementDecisionError(
                "PROCUREMENT_DECISION_INVALID",
                "Field bổ sung không thuộc blocking issue hiện tại.",
                400,
            )

    for row in field_conflicts:
        marker = _decision_key(row)
        if marker not in conflicts or str(row.get("resolution") or "").upper() not in {
            "KEEP_LOCAL", "APPLY_SOURCE",
        }:
            raise ProcurementDecisionError(
                "PROCUREMENT_DECISION_INVALID",
                "Quyết định xung đột field không hợp lệ.",
                400,
            )


def resolve_revision_decisions(revision, preview_rows, decisions, *, enforce_required=True):
    """Resolve one canonical revision using only preview-authorized choices."""

    observations = {
        str(row.get("planDetailRevisionId") or ""): row
        for row in revision.get("packages") or []
    }
    preview_by_id = {
        str(row.get("planDetailRevisionId") or ""): row
        for row in preview_rows
        if row.get("planDetailRevisionId")
    }
    package_decisions = {}
    for row in decision_rows(decisions, "packageMatches"):
        observation_id = str(row.get("packageObservationId") or "")
        if observation_id not in observations:
            raise ProcurementDecisionError(
                "PROCUREMENT_DECISION_INVALID",
                "Quyết định không thuộc revision hiện tại.",
                400,
            )
        preview = preview_by_id.get(observation_id)
        if not preview or preview.get("action") != "AMBIGUOUS":
            raise ProcurementDecisionError(
                "PROCUREMENT_MATCH_DECISION_INVALID",
                "Quyết định ghép gói không thuộc preview hiện tại.",
                409,
            )
        selected_root = str(row.get("localRootId") or "").strip()
        is_new = row.get("new") is True
        candidate_roots = {
            str(candidate.get("rootId") or "")
            for candidate in preview.get("matchCandidates") or []
        }
        if is_new == bool(selected_root) or (
            selected_root and selected_root not in candidate_roots
        ):
            raise ProcurementDecisionError(
                "PROCUREMENT_MATCH_DECISION_INVALID",
                "Dòng gói được chọn không hợp lệ.",
                409,
            )
        package_decisions[observation_id] = (
            {"new": True} if is_new
            else {"localRootId": selected_root}
        )
    unresolved_matches = [
        row for row in preview_rows
        if row.get("action") == "AMBIGUOUS"
        and str(row.get("planDetailRevisionId") or "") not in package_decisions
    ]
    if unresolved_matches:
        raise ProcurementDecisionError(
            "PROCUREMENT_MATCH_AMBIGUOUS",
            "Phải xác nhận mọi gói có kết quả ghép mơ hồ.",
            409,
        )

    overrides = {
        observation_id: deepcopy(preview.get("effectiveFields") or {})
        for observation_id, preview in preview_by_id.items()
        if preview.get("effectiveFields")
    }
    required_by_observation = {
        observation_id: {
            str(issue.get("field") or "")
            for issue in required_package_issues(
                observation.get("effectiveFields")
                if isinstance(observation.get("effectiveFields"), dict)
                else observation
            )
        }
        for observation_id, observation in observations.items()
    }
    for row in decision_rows(decisions, "fieldValues"):
        observation_id = str(row.get("packageObservationId") or "")
        field = str(row.get("field") or "")
        if observation_id not in observations:
            raise ProcurementDecisionError(
                "PROCUREMENT_DECISION_INVALID",
                "Quyết định không thuộc revision hiện tại.",
                400,
            )
        if field not in required_by_observation.get(observation_id, set()):
            raise ProcurementDecisionError(
                "PROCUREMENT_DECISION_INVALID",
                "Field bổ sung không thuộc blocking issue hiện tại.",
                400,
            )
        overrides.setdefault(observation_id, {})[field] = _coerce_required_value(
            field, row.get("value")
        )

    conflict_resolutions = {}
    for row in decision_rows(decisions, "fieldConflicts"):
        observation_id = str(row.get("packageObservationId") or "")
        field = str(row.get("field") or "")
        if observation_id not in observations:
            raise ProcurementDecisionError(
                "PROCUREMENT_DECISION_INVALID",
                "Quyết định không thuộc revision hiện tại.",
                400,
            )
        resolution = str(row.get("resolution") or "").upper()
        preview = preview_by_id.get(observation_id) or {}
        conflict = next((
            item for item in preview.get("fieldConflicts") or []
            if item.get("field") == field
        ), None)
        if conflict is None or resolution not in {"KEEP_LOCAL", "APPLY_SOURCE"}:
            raise ProcurementDecisionError(
                "PROCUREMENT_DECISION_INVALID",
                "Quyết định xung đột field không hợp lệ.",
                400,
            )
        conflict_resolutions[(observation_id, field)] = resolution
        overrides.setdefault(observation_id, {})[field] = deepcopy(
            conflict.get("localValue")
            if resolution == "KEEP_LOCAL"
            else conflict.get("sourceValue")
        )
    unresolved_conflicts = [
        (observation_id, conflict.get("field"))
        for observation_id, preview in preview_by_id.items()
        for conflict in preview.get("fieldConflicts") or []
        if (observation_id, conflict.get("field")) not in conflict_resolutions
    ]
    if unresolved_conflicts:
        raise ProcurementDecisionError(
            "PROCUREMENT_FIELD_CONFLICT",
            "Phải xử lý mọi xung đột field trước khi áp dụng.",
            409,
        )

    resolved = deepcopy(revision)
    local_targets = {}
    for observation in resolved.get("packages") or []:
        observation_id = str(observation.get("planDetailRevisionId") or "")
        observation["_canonicalSourceFields"] = {
            key: deepcopy(value)
            for key, value in observations.get(observation_id, {}).items()
            if key in SOURCE_OWNED_PACKAGE_FIELDS
        }
        observation.update(overrides.get(observation_id, {}))
        if isinstance(observation.get("effectiveFields"), dict):
            observation["effectiveFields"].update(
                deepcopy(overrides.get(observation_id, {}))
            )
        preview = preview_by_id.get(observation_id) or {}
        if preview.get("action") in {"CHANGED", "UNCHANGED", "ALREADY_IMPORTED"}:
            observation["_sourceAction"] = preview["action"]
        explicit = package_decisions.get(observation_id) or {}
        local_target = preview.get("localTarget") or {}
        selected_root = explicit.get("localRootId") or local_target.get("rootId")
        if selected_root:
            local_targets[observation_id] = {
                "localRootId": str(selected_root),
                "snapshotId": local_target.get("snapshotId"),
                "localVersion": local_target.get("localVersion"),
                "rowVersion": local_target.get("rowVersion"),
            }
            if explicit.get("localRootId"):
                candidate = next((
                    item for item in preview.get("matchCandidates") or []
                    if str(item.get("rootId") or "") == str(selected_root)
                ), {})
                local_targets[observation_id].update({
                    "snapshotId": candidate.get("snapshotId"),
                    "localVersion": candidate.get("localVersion"),
                    "rowVersion": candidate.get("rowVersion"),
                })
        validation_observation = (
            observation.get("effectiveFields")
            if isinstance(observation.get("effectiveFields"), dict)
            else observation
        )
        if enforce_required and required_package_issues(validation_observation):
            raise ProcurementDecisionError(
                "PROCUREMENT_REQUIRED_FIELDS_MISSING",
                "Gói thầu vẫn thiếu trường bắt buộc.",
                422,
            )
    return resolved, package_decisions, local_targets


def resolve_plan_decision_authority(bundle, decisions, selected_revision_ids=None):
    if set(decisions or {}) - {
        "investorId", "packageMatches", "fieldConflicts", "fieldValues",
    }:
        raise ProcurementDecisionError(
            "PROCUREMENT_DECISION_INVALID",
            "Quyết định preview chứa field không được hỗ trợ.",
            400,
        )
    revisions = deepcopy(bundle.get("revisions") or [])
    if selected_revision_ids is not None:
        selected = {str(value) for value in selected_revision_ids}
        revisions = [
            revision for revision in revisions
            if str(revision.get("revisionId") or "") in selected
        ]
    reconciliation = bundle.get("reconciliationByRevision") or {}
    _validate_bundle_decisions(revisions, reconciliation, decisions)
    resolved_revisions = []
    package_decisions = {}
    local_targets = {}
    for revision in revisions:
        revision_id = str(revision.get("revisionId") or "")
        revision_observations = {
            str(item.get("planDetailRevisionId") or "")
            for item in revision.get("packages") or []
        }
        revision_preview = reconciliation.get(revision_id, [])
        revision_required = {
            (
                str(item.get("planDetailRevisionId") or ""),
                str(issue.get("field") or ""),
            )
            for item in revision.get("packages") or []
            for issue in required_package_issues(item)
        }
        revision_conflicts = {
            (
                str(item.get("planDetailRevisionId") or ""),
                str(conflict.get("field") or ""),
            )
            for item in revision_preview
            for conflict in item.get("fieldConflicts") or []
        }
        scoped_decisions = {
            **(decisions or {}),
            "packageMatches": [
                item for item in decision_rows(decisions, "packageMatches")
                if str(item.get("packageObservationId") or "") in revision_observations
            ],
            "fieldValues": [
                item for item in decision_rows(decisions, "fieldValues")
                if _decision_key(item) in revision_required
            ],
            "fieldConflicts": [
                item for item in decision_rows(decisions, "fieldConflicts")
                if _decision_key(item) in revision_conflicts
            ],
        }
        resolved, explicit, targets = resolve_revision_decisions(
            revision,
            revision_preview,
            scoped_decisions,
        )
        resolved_revisions.append(resolved)
        package_decisions[revision_id] = explicit
        local_targets[revision_id] = targets
    normalized = {
        "investorId": str((decisions or {}).get("investorId") or "") or None,
        "packageMatches": sorted(
            deepcopy(decision_rows(decisions, "packageMatches")),
            key=lambda row: str(row.get("packageObservationId") or ""),
        ),
        "fieldConflicts": sorted(
            deepcopy(decision_rows(decisions, "fieldConflicts")),
            key=lambda row: (
                str(row.get("packageObservationId") or ""),
                str(row.get("field") or ""),
            ),
        ),
        "fieldValues": sorted(
            deepcopy(decision_rows(decisions, "fieldValues")),
            key=lambda row: (
                str(row.get("packageObservationId") or ""),
                str(row.get("field") or ""),
            ),
        ),
    }
    return {
        "status": "BOUND",
        "decisionsDigest": canonical_digest(normalized),
        "investorId": normalized["investorId"],
        "resolvedRevisions": resolved_revisions,
        "packageDecisionsByRevision": package_decisions,
        "localTargetsByRevision": local_targets,
    }
