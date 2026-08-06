"""Stable domain types shared by violation providers and the rule engine."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date, datetime
from enum import StrEnum
from typing import Any


class ViolationStatus(StrEnum):
    VIOLATION_CONFIRMED = "VIOLATION_CONFIRMED"
    NO_ACTIVE_VIOLATION = "NO_ACTIVE_VIOLATION"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"
    LOOKUP_FAILED = "LOOKUP_FAILED"
    NOT_CHECKED = "NOT_CHECKED"
    IDENTITY_CONFLICT = "IDENTITY_CONFLICT"


class ViolationCategory(StrEnum):
    BIDDING_BAN = "BIDDING_BAN"
    CONTRACT_TERMINATION_BY_CONTRACTOR_FAULT = (
        "CONTRACT_TERMINATION_BY_CONTRACTOR_FAULT"
    )
    UNRELIABLE_BID_PARTICIPATION = "UNRELIABLE_BID_PARTICIPATION"


class IdentityMatchType(StrEnum):
    CONTRACTOR_IDENTIFIER = "CONTRACTOR_IDENTIFIER"
    TAX_CODE = "TAX_CODE"
    NONE = "NONE"


class DurationUnit(StrEnum):
    DAY = "DAY"
    MONTH = "MONTH"
    YEAR = "YEAR"


@dataclass(frozen=True, slots=True)
class NormalizedViolationRecord:
    category: ViolationCategory
    contractor_identifier: str = ""
    tax_code: str = ""
    decision_number: str = ""
    issued_date: date | datetime | None = None
    effective_from: date | datetime | None = None
    effective_to: date | datetime | None = None
    behavior_date: date | datetime | None = None
    duration: int | None = None
    duration_unit: DurationUnit | None = None
    source_status: str = ""
    is_revoked: bool = False
    is_applicable: bool = True
    requires_review: bool = False

    def to_json_value(self) -> dict[str, Any]:
        value = asdict(self)
        value["category"] = self.category.value
        value["duration_unit"] = (
            self.duration_unit.value if self.duration_unit else None
        )
        for field in ("issued_date", "effective_from", "effective_to", "behavior_date"):
            item = value.get(field)
            if isinstance(item, (date, datetime)):
                value[field] = item.isoformat()
        return value


@dataclass(frozen=True, slots=True)
class ViolationProviderResult:
    records: tuple[NormalizedViolationRecord, ...]
    provider: str
    schema_version: str
    payload_hash: str


@dataclass(frozen=True, slots=True)
class IdentityMatchResult:
    records: tuple[NormalizedViolationRecord, ...]
    match_type: IdentityMatchType
    conflict: bool = False


@dataclass(frozen=True, slots=True)
class ViolationEvaluation:
    status: ViolationStatus
    applicable_records: tuple[NormalizedViolationRecord, ...] = ()
