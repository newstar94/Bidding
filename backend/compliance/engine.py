"""Pure bundle-v1 evaluator for legal and timeline readiness."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from backend.timeline.effective_timeline import (
    TIMELINE_TEMPLATE_VERSION,
    build_effective_timeline,
)


_CATALOG_PATH = Path(__file__).resolve().parents[2] / "shared" / "timeline_rules.json"
_CATALOG_BYTES = _CATALOG_PATH.read_bytes()
_CATALOG = json.loads(_CATALOG_BYTES.decode("utf-8-sig"))
TIMELINE_CATALOG_SHA256 = hashlib.sha256(_CATALOG_BYTES).hexdigest()
BUNDLE_VERSION = "compliance-deadline-readiness-v1"


def _severity(result):
    return "WARNING" if result in {"FAIL", "NEEDS_REVIEW"} else "INFO"


def _finding(rule_id, result, evidence_paths, legal_source_ids=(), *, subject_id=""):
    return {
        "ruleId": rule_id,
        "ruleVersion": f"{BUNDLE_VERSION}:timeline-v{TIMELINE_TEMPLATE_VERSION}",
        "severity": _severity(result),
        "result": result,
        "subjectId": subject_id or None,
        "evidencePaths": list(evidence_paths),
        "legalSourceIds": list(legal_source_ids),
    }


def _package_timeline(snapshot, package):
    relations = snapshot.get("relations") or {}
    context = snapshot.get("context") or {}
    if snapshot.get("entityType") == "goithau":
        related = {
            "ehsmtAdjustments": relations.get("ehsmtAdjustments", []),
            "clarificationRequests": relations.get("yeuCauLamRoList", []),
            "clarificationResponses": relations.get("traLoiLamRoList", []),
            "extensions": relations.get("giaHanList", []),
            "expertTeam": relations.get("toChuyenGia", []),
            "appraisalTeam": relations.get("toThamDinh", []),
        }
        saved = relations.get("timelineItems", [])
        plan = context.get("plan") or {}
    else:
        related = {
            "ehsmtAdjustments": package.get("ehsmtAdjustments", []),
            "clarificationRequests": package.get("yeuCauLamRoList", []),
            "clarificationResponses": package.get("traLoiLamRoList", []),
            "extensions": package.get("giaHanList", []),
            "expertTeam": package.get("toChuyenGia", []),
            "appraisalTeam": package.get("toThamDinh", []),
        }
        saved = package.get("timelineItems", [])
        plan = snapshot.get("record") or {}
    return build_effective_timeline(package, {"plan": plan, **related}, saved)


def _timeline_projection(row):
    return {
        "milestoneKey": row.get("milestone_key"),
        "instanceKey": row.get("instance_key"),
        "displayCode": row.get("display_code"),
        "title": row.get("title"),
        "applicability": row.get("applicability"),
        "applicabilityReason": row.get("applicability_reason"),
        "status": row.get("status"),
        "plannedDate": row.get("ngay_du_kien"),
        "actualDate": row.get("ngay_thuc_te"),
        "sourceKey": row.get("source_key"),
    }


def evaluate_bundle(snapshot, legal_binding, legal_sources, documents):
    source_ids = [source["id"] for source in legal_sources if source.get("id")]
    binding_status = str((legal_binding or {}).get("status") or "UNRESOLVED")
    if binding_status == "RESOLVED" and (legal_binding or {}).get("profileVersionId"):
        legal_result = "PASS"
    elif binding_status in {"AMBIGUOUS", "MANUAL_REVIEW_REQUIRED"}:
        legal_result = "NEEDS_REVIEW"
    else:
        legal_result = "NOT_EVALUATED"
    findings = [_finding(
        "BF-COMP-V1-LEGAL-BINDING-READINESS",
        legal_result,
        ["legalBinding.status", "legalBinding.sourceProfileVersionId"],
        source_ids,
    )]

    packages = (
        [snapshot.get("record") or {}]
        if snapshot.get("entityType") == "goithau"
        else list((snapshot.get("relations") or {}).get("packages") or [])
    )
    timeline_packages = []
    for package_index, package in enumerate(packages):
        rows = _package_timeline(snapshot, package)
        projected = [_timeline_projection(row) for row in rows]
        timeline_packages.append({
            "packageId": package.get("id"),
            "packageRootId": package.get("rootId") or package.get("id"),
            "items": projected,
        })
        applicable = [row for row in projected if row["applicability"] == "APPLICABLE"]
        conditional = [row for row in projected if row["applicability"] == "CONDITIONAL"]
        missing = [row for row in applicable if not row["plannedDate"] and not row["actualDate"]]
        if missing:
            result = "FAIL"
            paths = [
                f"timeline.packages[{package_index}].items[{projected.index(row)}].plannedDate"
                for row in missing
            ]
        elif conditional:
            result = "NEEDS_REVIEW"
            paths = [
                f"timeline.packages[{package_index}].items[{projected.index(row)}].applicability"
                for row in conditional
            ]
        elif applicable:
            result = "PASS"
            paths = [f"timeline.packages[{package_index}].items"]
        else:
            result = "NOT_EVALUATED"
            paths = [f"timeline.packages[{package_index}]"]
        findings.append(_finding(
            "BF-COMP-V1-DEADLINE-TIMELINE-READINESS",
            result,
            paths,
            source_ids,
            subject_id=str(package.get("id") or ""),
        ))

    not_evaluated = [
        {"code": "LEGAL_CONCLUSION_NOT_EVALUATED", "reason": "LEGAL_REVIEWER_CITATION_FIXTURES_PENDING"},
        {"code": "WORKFLOW_RULES_NOT_IN_BUNDLE", "reason": "BUNDLE_V1_SCOPE"},
        {"code": "DOCUMENT_RULES_NOT_IN_BUNDLE", "reason": "BUNDLE_V1_SCOPE"},
    ]
    if legal_result == "NOT_EVALUATED":
        not_evaluated.append({"code": "LEGAL_BINDING_NOT_AVAILABLE", "reason": binding_status})
    if not packages:
        not_evaluated.append({"code": "TIMELINE_TARGET_NOT_AVAILABLE", "reason": "NO_PACKAGE_IN_AUTHORIZED_SNAPSHOT"})
    return {
        "bundle": {
            "bundleVersionId": BUNDLE_VERSION,
            "timelineCatalogVersion": _CATALOG.get("catalogVersion"),
            "timelineCatalogSha256": TIMELINE_CATALOG_SHA256,
        },
        "findings": findings,
        "timeline": {
            "templateVersion": TIMELINE_TEMPLATE_VERSION,
            "catalogSha256": TIMELINE_CATALOG_SHA256,
            "packages": timeline_packages,
        },
        "documents": {"generatedArtifacts": list(documents)},
        "notEvaluated": not_evaluated,
    }
