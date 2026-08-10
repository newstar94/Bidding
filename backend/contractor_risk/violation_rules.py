"""Pure, calendar-aware contractor violation rules.

Every active interval is half-open: ``[start, end)``.  Callers must pass the
package/lot bid-closing instant; this module never reads the current time.
"""

from __future__ import annotations

import calendar
import re
import unicodedata
from datetime import date, datetime, time, timedelta

from backend.contractor_risk.types import (
    DurationUnit,
    IdentityMatchResult,
    IdentityMatchType,
    NormalizedViolationRecord,
    ViolationCategory,
    ViolationEvaluation,
    ViolationStatus,
)
from backend.shared.date_utils import VIETNAM_TIMEZONE, parse_datetime_value


CONTRACT_TERMINATION_LOOKBACK_YEARS = 5
UNRELIABLE_BID_LOOKBACK_YEARS = 2
ADMINISTRATIVE_ACTION_LOOKBACK_YEARS = 5
VIOLATION_RULE_VERSION = "2026.2"


def normalize_identity_code(value: object) -> str:
    """Normalize comparison syntax without changing business characters/zeros."""

    normalized = unicodedata.normalize("NFKC", str(value or "")).strip()
    return re.sub(r"\s+", "", normalized).casefold()


def normalize_tax_code(value: object) -> str:
    return normalize_identity_code(value)


def _identity_key(record: NormalizedViolationRecord) -> tuple[str, str]:
    return (
        normalize_identity_code(record.contractor_identifier),
        normalize_tax_code(record.tax_code),
    )


def match_violation_records(
    records: tuple[NormalizedViolationRecord, ...] | list[NormalizedViolationRecord],
    *,
    contractor_identifier: object,
    tax_code: object = "",
) -> IdentityMatchResult:
    """Select records by identifier first and reject identifier/tax conflicts."""

    values = tuple(records)
    requested_identifier = normalize_identity_code(contractor_identifier)
    requested_tax_code = normalize_tax_code(tax_code)
    identifier_matches = tuple(
        record
        for record in values
        if requested_identifier
        and _identity_key(record)[0] == requested_identifier
    )
    tax_matches = tuple(
        record
        for record in values
        if requested_tax_code and _identity_key(record)[1] == requested_tax_code
    )

    if requested_identifier and requested_tax_code:
        identifier_conflicts = any(
            record_tax and record_tax != requested_tax_code
            for _, record_tax in map(_identity_key, identifier_matches)
        )
        tax_conflicts = any(
            record_identifier and record_identifier != requested_identifier
            for record_identifier, _ in map(_identity_key, tax_matches)
        )
        if identifier_conflicts or tax_conflicts:
            return IdentityMatchResult((), IdentityMatchType.NONE, conflict=True)

    if identifier_matches:
        return IdentityMatchResult(
            identifier_matches,
            IdentityMatchType.CONTRACTOR_IDENTIFIER,
        )
    if tax_matches:
        return IdentityMatchResult(tax_matches, IdentityMatchType.TAX_CODE)
    return IdentityMatchResult((), IdentityMatchType.NONE)


def _as_vietnam_datetime(value: date | datetime | str | None) -> datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, date):
        parsed = datetime.combine(value, time.min)
    else:
        parsed = parse_datetime_value(value)
        if parsed is None:
            return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=VIETNAM_TIMEZONE)
    return parsed.astimezone(VIETNAM_TIMEZONE)


def add_calendar_duration(
    value: date | datetime,
    duration: int,
    unit: DurationUnit,
) -> datetime:
    """Add a source duration using calendar months/years, never approximations."""

    start = _as_vietnam_datetime(value)
    if start is None:
        raise ValueError("A valid start date is required")
    amount = int(duration)
    if amount < 0:
        raise ValueError("Duration cannot be negative")
    if unit == DurationUnit.DAY:
        return start + timedelta(days=amount)
    if unit == DurationUnit.YEAR:
        target_year = start.year + amount
        target_day = min(start.day, calendar.monthrange(target_year, start.month)[1])
        return start.replace(year=target_year, day=target_day)
    if unit == DurationUnit.MONTH:
        month_index = start.year * 12 + (start.month - 1) + amount
        target_year, zero_based_month = divmod(month_index, 12)
        target_month = zero_based_month + 1
        target_day = min(start.day, calendar.monthrange(target_year, target_month)[1])
        return start.replace(year=target_year, month=target_month, day=target_day)
    raise ValueError(f"Unsupported duration unit: {unit}")


def add_calendar_years(value: date | datetime, years: int) -> datetime:
    return add_calendar_duration(value, years, DurationUnit.YEAR)


def _evaluate_bidding_ban(
    record: NormalizedViolationRecord,
    bid_closing_at: datetime,
) -> ViolationStatus:
    start = _as_vietnam_datetime(record.effective_from)
    end = _as_vietnam_datetime(record.effective_to)
    if end is None and start is not None and record.duration is not None and record.duration_unit:
        end = add_calendar_duration(start, record.duration, record.duration_unit)
    if start is None or end is None:
        return ViolationStatus.REVIEW_REQUIRED
    return (
        ViolationStatus.VIOLATION_CONFIRMED
        if start <= bid_closing_at < end
        else ViolationStatus.NO_ACTIVE_VIOLATION
    )


def _evaluate_calendar_lookback(
    source_date: date | datetime | None,
    bid_closing_at: datetime,
    years: int,
) -> ViolationStatus:
    start = _as_vietnam_datetime(source_date)
    if start is None:
        return ViolationStatus.REVIEW_REQUIRED
    end = add_calendar_years(start, years)
    return (
        ViolationStatus.VIOLATION_CONFIRMED
        if start <= bid_closing_at < end
        else ViolationStatus.NO_ACTIVE_VIOLATION
    )


def evaluate_violation_records(
    records: tuple[NormalizedViolationRecord, ...] | list[NormalizedViolationRecord],
    bid_closing_at: date | datetime | str,
) -> ViolationEvaluation:
    closing = _as_vietnam_datetime(bid_closing_at)
    if closing is None:
        return ViolationEvaluation(ViolationStatus.REVIEW_REQUIRED)

    reviewed: list[NormalizedViolationRecord] = []
    needs_review = False
    for record in records:
        if record.is_revoked or not record.is_applicable:
            continue
        if record.requires_review:
            reviewed.append(record)
            needs_review = True
            continue
        if record.category == ViolationCategory.BIDDING_BAN:
            status = _evaluate_bidding_ban(record, closing)
        elif record.category == ViolationCategory.CONTRACT_TERMINATION_BY_CONTRACTOR_FAULT:
            status = _evaluate_calendar_lookback(
                record.issued_date,
                closing,
                CONTRACT_TERMINATION_LOOKBACK_YEARS,
            )
        elif record.category == ViolationCategory.UNRELIABLE_BID_PARTICIPATION:
            status = _evaluate_calendar_lookback(
                record.behavior_date,
                closing,
                UNRELIABLE_BID_LOOKBACK_YEARS,
            )
        elif (
            record.category
            == ViolationCategory.ADMINISTRATIVE_WARNING_OR_OTHER_ACTION
        ):
            status = _evaluate_calendar_lookback(
                record.issued_date,
                closing,
                ADMINISTRATIVE_ACTION_LOOKBACK_YEARS,
            )
        else:  # Defensive for deserialized/forward-compatible values.
            continue
        reviewed.append(record)
        if status == ViolationStatus.VIOLATION_CONFIRMED:
            return ViolationEvaluation(
                ViolationStatus.VIOLATION_CONFIRMED,
                tuple(reviewed),
            )
        if status == ViolationStatus.REVIEW_REQUIRED:
            needs_review = True

    return ViolationEvaluation(
        ViolationStatus.REVIEW_REQUIRED
        if needs_review
        else ViolationStatus.NO_ACTIVE_VIOLATION,
        tuple(reviewed),
    )
