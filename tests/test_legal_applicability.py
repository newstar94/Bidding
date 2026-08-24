from backend.legal_versioning.policy import (
    APPLICABILITY_POLICY_VERSION,
    extract_target_anchor,
    resolve_applicability,
)


def _profile(profile_id, start, end=None, **values):
    return {
        "id": profile_id,
        "effectiveFrom": start,
        "effectiveTo": end,
        **values,
    }


def test_before_on_after_effective_date_never_falls_back_to_latest():
    profiles = [
        _profile("old", "2024-01-01", "2025-06-30"),
        _profile("new", "2025-07-01"),
    ]

    before = resolve_applicability({"anchorDate": "2023-12-31"}, profiles)
    boundary = resolve_applicability({"anchorDate": "2025-07-01"}, profiles)
    after = resolve_applicability({"anchorDate": "2026-01-01"}, profiles)

    assert before["status"] == "UNRESOLVED"
    assert before["profileVersionId"] is None
    assert boundary["profileVersionId"] == "new"
    assert after["profileVersionId"] == "new"
    assert after["policyVersion"] == APPLICABILITY_POLICY_VERSION


def test_overlap_and_transition_are_explicit_non_resolutions():
    overlap = resolve_applicability(
        {"anchorDate": "2026-01-15"},
        [
            _profile("a", "2026-01-01", priority=2),
            _profile("b", "2026-01-01", priority=2),
        ],
    )
    transition = resolve_applicability(
        {"anchorDate": "2026-01-15"},
        [_profile("transition", "2026-01-01", manualReviewRequired=True)],
    )

    assert overlap["status"] == "AMBIGUOUS"
    assert overlap["candidateProfileVersionIds"] == ["a", "b"]
    assert transition["status"] == "MANUAL_REVIEW_REQUIRED"
    assert transition["profileVersionId"] is None


def test_missing_anchor_stays_unresolved_and_approved_fields_are_exact():
    assert resolve_applicability({}, [_profile("latest", "2020-01-01")])["status"] == (
        "UNRESOLVED"
    )
    assert extract_target_anchor("plan", {
        "ngay_phe_duyet": "2026-08-24", "row_version": 4,
    }) == {
        "anchorDate": "2026-08-24",
        "anchorSource": "ke_hoach_lcnt.ngay_phe_duyet",
        "targetRowVersion": 4,
    }
    assert extract_target_anchor("package", {
        "thoi_gian_dang_tai": "2026-08-24T09:15:00+07:00",
    })["anchorDate"] == "2026-08-24"
