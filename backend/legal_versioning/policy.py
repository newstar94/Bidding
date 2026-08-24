"""Pure, versioned legal applicability policy from ADR 0009."""

from __future__ import annotations

from datetime import date, datetime


APPLICABILITY_POLICY_VERSION = "legal-applicability-v1"
RESOLUTION_STATUSES = frozenset({
    "RESOLVED", "AMBIGUOUS", "UNRESOLVED", "MANUAL_REVIEW_REQUIRED",
})


def _date(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def _result(status, reason, *, anchor=None, profile=None, candidates=()):
    return {
        "policyVersion": APPLICABILITY_POLICY_VERSION,
        "status": status,
        "reason": reason,
        "anchorDate": anchor.isoformat() if anchor else None,
        "profileVersionId": profile.get("id") if profile else None,
        "candidateProfileVersionIds": sorted({
            str(item.get("id") or "") for item in candidates if item.get("id")
        }),
        "evidence": {
            "anchorSource": "TARGET_VERSION_FACT",
            "candidateCount": len(candidates),
        },
    }


def resolve_applicability(target_facts, profile_versions):
    """Resolve an exact profile or explicit non-resolution without latest fallback."""

    facts = target_facts if isinstance(target_facts, dict) else {}
    anchor = _date(facts.get("anchorDate"))
    if anchor is None:
        return _result("UNRESOLVED", "MISSING_OR_INVALID_ANCHOR")
    candidates = []
    for profile in profile_versions or ():
        if not isinstance(profile, dict) or not profile.get("id"):
            continue
        effective_from = _date(profile.get("effectiveFrom"))
        effective_to = _date(profile.get("effectiveTo"))
        if effective_from is None:
            continue
        if effective_from <= anchor and (effective_to is None or anchor <= effective_to):
            candidates.append(profile)
    if not candidates:
        return _result("UNRESOLVED", "NO_APPLICABLE_PROFILE", anchor=anchor)
    max_priority = max(int(item.get("priority") or 0) for item in candidates)
    ranked = [
        item for item in candidates if int(item.get("priority") or 0) == max_priority
    ]
    if any(bool(item.get("manualReviewRequired")) for item in ranked):
        return _result(
            "MANUAL_REVIEW_REQUIRED", "TRANSITION_REQUIRES_REVIEW",
            anchor=anchor, candidates=ranked,
        )
    if len(ranked) != 1:
        return _result(
            "AMBIGUOUS", "OVERLAPPING_PROFILE_VERSIONS",
            anchor=anchor, candidates=ranked,
        )
    return _result(
        "RESOLVED", "EXACT_EFFECTIVE_INTERVAL",
        anchor=anchor, profile=ranked[0], candidates=ranked,
    )


def extract_target_anchor(target_type, record):
    """Extract only the product-approved anchor fact from an authorized record."""

    row = record if isinstance(record, dict) else {}
    if target_type == "plan":
        value = row.get("ngay_phe_duyet")
        source = "ke_hoach_lcnt.ngay_phe_duyet"
    elif target_type == "package":
        value = row.get("thoi_gian_dang_tai")
        source = "goi_thau.thoi_gian_dang_tai"
    else:
        raise ValueError("Legal binding target type is invalid.")
    anchor = _date(value)
    return {
        "anchorDate": anchor.isoformat() if anchor else None,
        "anchorSource": source,
        "targetRowVersion": int(row.get("row_version") or 1),
    }
