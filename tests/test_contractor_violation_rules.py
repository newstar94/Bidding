from datetime import date

import pytest

from backend.contractor_risk.types import (
    DurationUnit,
    IdentityMatchType,
    NormalizedViolationRecord,
    ViolationCategory,
    ViolationStatus,
)
from backend.contractor_risk.violation_rules import (
    add_calendar_duration,
    evaluate_violation_records,
    match_violation_records,
    normalize_identity_code,
)


def record(category, **values):
    return NormalizedViolationRecord(category=category, **values)


@pytest.mark.parametrize(
    ("closing", "expected"),
    [
        ("2025-12-31 23:59:59", ViolationStatus.NO_ACTIVE_VIOLATION),
        ("2026-01-01 00:00:00", ViolationStatus.VIOLATION_CONFIRMED),
        ("2026-06-01 12:00:00", ViolationStatus.VIOLATION_CONFIRMED),
        ("2026-12-31 23:59:59", ViolationStatus.VIOLATION_CONFIRMED),
        ("2027-01-01 00:00:00", ViolationStatus.NO_ACTIVE_VIOLATION),
        ("2027-01-02 00:00:00", ViolationStatus.NO_ACTIVE_VIOLATION),
    ],
)
def test_bidding_ban_uses_half_open_effective_interval(closing, expected):
    result = evaluate_violation_records(
        [record(
            ViolationCategory.BIDDING_BAN,
            effective_from=date(2026, 1, 1),
            effective_to=date(2027, 1, 1),
        )],
        closing,
    )
    assert result.status == expected


def test_bidding_ban_ignores_revoked_decision():
    result = evaluate_violation_records(
        [record(
            ViolationCategory.BIDDING_BAN,
            effective_from=date(2026, 1, 1),
            effective_to=date(2027, 1, 1),
            is_revoked=True,
        )],
        "2026-06-01 00:00:00",
    )
    assert result.status == ViolationStatus.NO_ACTIVE_VIOLATION


@pytest.mark.parametrize("missing", ["start", "end"])
def test_bidding_ban_missing_required_boundary_needs_review(missing):
    values = {
        "effective_from": date(2026, 1, 1),
        "effective_to": date(2027, 1, 1),
    }
    values["effective_from" if missing == "start" else "effective_to"] = None
    result = evaluate_violation_records(
        [record(ViolationCategory.BIDDING_BAN, **values)],
        "2026-06-01 00:00:00",
    )
    assert result.status == ViolationStatus.REVIEW_REQUIRED


def test_bidding_ban_derives_calendar_month_duration():
    result = evaluate_violation_records(
        [record(
            ViolationCategory.BIDDING_BAN,
            effective_from=date(2024, 1, 31),
            duration=1,
            duration_unit=DurationUnit.MONTH,
        )],
        "2024-02-28 23:59:59",
    )
    assert result.status == ViolationStatus.VIOLATION_CONFIRMED
    assert add_calendar_duration(
        date(2024, 1, 31), 1, DurationUnit.MONTH
    ).date() == date(2024, 2, 29)


@pytest.mark.parametrize(
    ("closing", "expected"),
    [
        ("2021-08-14 23:59:59", ViolationStatus.NO_ACTIVE_VIOLATION),
        ("2026-08-14 23:59:59", ViolationStatus.VIOLATION_CONFIRMED),
        ("2026-08-15 00:00:00", ViolationStatus.NO_ACTIVE_VIOLATION),
        ("2027-08-15 00:00:00", ViolationStatus.NO_ACTIVE_VIOLATION),
    ],
)
def test_contract_termination_uses_five_calendar_years(closing, expected):
    result = evaluate_violation_records(
        [record(
            ViolationCategory.CONTRACT_TERMINATION_BY_CONTRACTOR_FAULT,
            issued_date=date(2021, 8, 15),
        )],
        closing,
    )
    assert result.status == expected


def test_contract_termination_handles_leap_day_as_calendar_years():
    termination = record(
        ViolationCategory.CONTRACT_TERMINATION_BY_CONTRACTOR_FAULT,
        issued_date=date(2020, 2, 29),
    )
    assert evaluate_violation_records(
        [termination], "2025-02-27 23:59:59"
    ).status == ViolationStatus.VIOLATION_CONFIRMED
    assert evaluate_violation_records(
        [termination], "2025-02-28 00:00:00"
    ).status == ViolationStatus.NO_ACTIVE_VIOLATION


def test_contract_termination_after_closing_and_revoked_are_not_active():
    future = record(
        ViolationCategory.CONTRACT_TERMINATION_BY_CONTRACTOR_FAULT,
        issued_date=date(2027, 1, 1),
    )
    revoked = record(
        ViolationCategory.CONTRACT_TERMINATION_BY_CONTRACTOR_FAULT,
        issued_date=date(2025, 1, 1),
        is_revoked=True,
    )
    assert evaluate_violation_records(
        [future, revoked], "2026-01-01"
    ).status == ViolationStatus.NO_ACTIVE_VIOLATION


def test_contract_termination_missing_issue_date_or_unverified_fault_needs_review():
    missing = record(
        ViolationCategory.CONTRACT_TERMINATION_BY_CONTRACTOR_FAULT,
    )
    uncertain = record(
        ViolationCategory.CONTRACT_TERMINATION_BY_CONTRACTOR_FAULT,
        issued_date=date(2025, 1, 1),
        requires_review=True,
    )
    assert evaluate_violation_records(
        [missing], "2026-01-01"
    ).status == ViolationStatus.REVIEW_REQUIRED
    assert evaluate_violation_records(
        [uncertain], "2026-01-01"
    ).status == ViolationStatus.REVIEW_REQUIRED


@pytest.mark.parametrize(
    ("closing", "expected"),
    [
        ("2024-09-09 23:59:59", ViolationStatus.NO_ACTIVE_VIOLATION),
        ("2026-09-09 23:59:59", ViolationStatus.VIOLATION_CONFIRMED),
        ("2026-09-10 00:00:00", ViolationStatus.NO_ACTIVE_VIOLATION),
        ("2027-09-10 00:00:00", ViolationStatus.NO_ACTIVE_VIOLATION),
    ],
)
def test_unreliable_participation_uses_two_calendar_years(closing, expected):
    result = evaluate_violation_records(
        [record(
            ViolationCategory.UNRELIABLE_BID_PARTICIPATION,
            behavior_date=date(2024, 9, 10),
        )],
        closing,
    )
    assert result.status == expected


def test_unreliable_participation_never_uses_public_or_issue_date_fallback():
    result = evaluate_violation_records(
        [record(
            ViolationCategory.UNRELIABLE_BID_PARTICIPATION,
            issued_date=date(2024, 9, 10),
        )],
        "2025-01-01",
    )
    assert result.status == ViolationStatus.REVIEW_REQUIRED


def test_unreliable_participation_revocation_is_not_active():
    result = evaluate_violation_records(
        [record(
            ViolationCategory.UNRELIABLE_BID_PARTICIPATION,
            behavior_date=date(2025, 1, 1),
            is_revoked=True,
        )],
        "2026-01-01",
    )
    assert result.status == ViolationStatus.NO_ACTIVE_VIOLATION


@pytest.mark.parametrize(
    ("closing", "expected"),
    [
        ("2021-08-14 23:59:59", ViolationStatus.NO_ACTIVE_VIOLATION),
        ("2026-08-14 23:59:59", ViolationStatus.VIOLATION_CONFIRMED),
        ("2026-08-15 00:00:00", ViolationStatus.NO_ACTIVE_VIOLATION),
    ],
)
def test_administrative_warning_or_other_action_uses_five_calendar_years(
    closing,
    expected,
):
    result = evaluate_violation_records(
        [record(
            ViolationCategory.ADMINISTRATIVE_WARNING_OR_OTHER_ACTION,
            issued_date=date(2021, 8, 15),
        )],
        closing,
    )
    assert result.status == expected


def test_administrative_action_missing_issue_date_needs_review():
    result = evaluate_violation_records(
        [record(ViolationCategory.ADMINISTRATIVE_WARNING_OR_OTHER_ACTION)],
        "2026-01-01",
    )
    assert result.status == ViolationStatus.REVIEW_REQUIRED


def test_any_confirmed_record_wins_over_review_required_record():
    result = evaluate_violation_records(
        [
            record(ViolationCategory.UNRELIABLE_BID_PARTICIPATION),
            record(
                ViolationCategory.BIDDING_BAN,
                effective_from=date(2025, 1, 1),
                effective_to=date(2027, 1, 1),
            ),
        ],
        "2026-01-01",
    )
    assert result.status == ViolationStatus.VIOLATION_CONFIRMED


def test_matching_prefers_identifier_then_tax_code():
    by_identifier = record(
        ViolationCategory.BIDDING_BAN,
        contractor_identifier="vn00123",
        tax_code="00123",
    )
    by_tax = record(
        ViolationCategory.BIDDING_BAN,
        contractor_identifier="vn99999",
        tax_code="00999",
    )
    result = match_violation_records(
        [by_tax, by_identifier],
        contractor_identifier=" vn00123 ",
        tax_code="00123",
    )
    assert result.match_type == IdentityMatchType.CONTRACTOR_IDENTIFIER
    assert result.records == (by_identifier,)


def test_matching_preserves_leading_zero_and_normalizes_unicode_whitespace():
    value = "  ＶＮ ００１２３  "
    assert normalize_identity_code(value) == "vn00123"
    assert normalize_identity_code("00123") != normalize_identity_code("123")


def test_matching_does_not_use_same_name_or_partial_code():
    unrelated = record(
        ViolationCategory.BIDDING_BAN,
        contractor_identifier="vn001234",
        tax_code="9999999999",
    )
    result = match_violation_records(
        [unrelated],
        contractor_identifier="vn00123",
        tax_code="",
    )
    assert result.records == ()
    assert result.match_type == IdentityMatchType.NONE


def test_identifier_and_tax_pointing_to_different_entities_is_conflict():
    identifier_entity = record(
        ViolationCategory.BIDDING_BAN,
        contractor_identifier="vn00123",
        tax_code="1111111111",
    )
    tax_entity = record(
        ViolationCategory.BIDDING_BAN,
        contractor_identifier="vn00999",
        tax_code="0012345678",
    )
    result = match_violation_records(
        [identifier_entity, tax_entity],
        contractor_identifier="vn00123",
        tax_code="0012345678",
    )
    assert result.conflict is True
    assert result.records == ()
