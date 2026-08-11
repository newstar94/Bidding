"""Bounded, identifier-first classification of browser extraction artifacts."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from backend.integrations.muasamcong_browser.artifacts import (
    same_procurement_family,
    walk_artifact,
)
from backend.procurement_lookup.domain import ProcurementLookupError


@dataclass(frozen=True, slots=True)
class ClassifiedPayload:
    payload: dict
    strategy: str
    score: int


class UpstreamClassification(StrEnum):
    FOUND_SUPPORTED = "FOUND_SUPPORTED"
    FOUND_SCHEMA_CHANGED = "FOUND_SCHEMA_CHANGED"
    NOT_FOUND = "NOT_FOUND"
    SESSION_FAILED = "SESSION_FAILED"
    UPSTREAM_CHANGED = "UPSTREAM_CHANGED"
    ENDPOINT_CHANGED = "ENDPOINT_CHANGED"
    PARTIAL_DATA = "PARTIAL_DATA"


def classify_upstream_error(error_code=None, *, partial=False):
    """Map stable provider errors to the complete public upstream taxonomy."""

    if partial:
        return UpstreamClassification.PARTIAL_DATA
    code = str(error_code or "").strip().upper()
    if not code:
        return UpstreamClassification.FOUND_SUPPORTED
    if code == "PROCUREMENT_SCHEMA_CHANGED":
        return UpstreamClassification.FOUND_SCHEMA_CHANGED
    if code == "PROCUREMENT_NOT_FOUND":
        return UpstreamClassification.NOT_FOUND
    if code in {"PROCUREMENT_SESSION_FAILED", "PROCUREMENT_BROWSER_FAILED"}:
        return UpstreamClassification.SESSION_FAILED
    if code == "PROCUREMENT_ENDPOINT_CHANGED":
        return UpstreamClassification.ENDPOINT_CHANGED
    return UpstreamClassification.UPSTREAM_CHANGED


def _has_exact(value, field, expected):
    return any(
        isinstance(item, dict)
        and same_procurement_family(item.get(field), expected)
        for item in walk_artifact(value)
    )


def _has_key(value, keys):
    return any(
        isinstance(item, dict) and any(key in item for key in keys)
        for item in walk_artifact(value)
    )


def _has_package_array(value):
    for item in walk_artifact(value):
        if not isinstance(item, list) or not item:
            continue
        rows = [row for row in item if isinstance(row, dict)]
        if rows and any(
            "idDetail" in row or "bidName" in row or "bidPrice" in row
            for row in rows
        ):
            return True
    return False


def _score(payload, code, kind):
    identifier = "planNo" if kind == "PLAN" else "notifyNo"
    if not _has_exact(payload, identifier, code):
        return None
    score = 100
    if kind == "PLAN":
        score += 10 if _has_key(payload, {"name", "planName"}) else 0
        score += 10 if _has_key(payload, {"investorName"}) else 0
        score += 20 if _has_package_array(payload) else 0
        score += 20 if _has_key(payload, {"planVersion", "decisionNo"}) else 0
    else:
        score += 10 if _has_key(payload, {"bidName"}) else 0
        score += 10 if _has_key(payload, {"planNo"}) else 0
        score += 10 if _has_key(payload, {"investorName"}) else 0
        score += 10 if _has_key(payload, {"bidPrice"}) else 0
        score += 20 if _has_key(payload, {"notifyVersion", "notifyId"}) else 0
    return score


class PayloadClassifier:
    """Select the strongest exact candidate without endpoint-name coupling."""

    def classify(self, artifact, *, code, kind):
        exact_but_unknown_schema = False
        groups = (
            (
                "network-json",
                [
                    row.get("body")
                    for row in artifact.get("networkResponses", [])
                    if isinstance(row, dict)
                    and isinstance(row.get("body"), dict)
                    and int(row.get("status") or 0) < 400
                ],
            ),
            (
                str(artifact.get("frameworkStrategy") or "vue-state"),
                artifact.get(
                    "frameworkStateCandidates",
                    artifact.get("vueStateCandidates", []),
                ),
            ),
            ("semantic-dom", artifact.get("domCandidates", [])),
        )
        for strategy, payloads in groups:
            candidates = []
            for payload in payloads or []:
                if not isinstance(payload, dict):
                    continue
                score = _score(payload, code, kind)
                if score is not None:
                    if score >= 120:
                        candidates.append(
                            ClassifiedPayload(payload, strategy, score)
                        )
                    else:
                        exact_but_unknown_schema = True
            if candidates:
                return max(candidates, key=lambda item: item.score)
        if exact_but_unknown_schema:
            raise ProcurementLookupError("PROCUREMENT_SCHEMA_CHANGED")
        raise ProcurementLookupError("PROCUREMENT_NOT_FOUND")
