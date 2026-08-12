"""Canonical, upstream-independent procurement import domain types."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
import json
import re
from hashlib import sha256


PREVIEW_SCHEMA_VERSION = "biddingflow-procurement-import-preview-v2"
CANONICAL_SCHEMA_VERSION = "biddingflow-procurement-canonical-v1"
_CODE_PATTERN = re.compile(r"^(?P<kind>PL|IB)(?P<number>[0-9]{10})(?:-(?P<revision>[0-9]{2}))?$", re.I)


class ProcurementCodeKind(StrEnum):
    PLAN = "PLAN"
    NOTICE = "NOTICE"


class PackageAction(StrEnum):
    ADDED = "ADDED"
    UNCHANGED = "UNCHANGED"
    CHANGED = "CHANGED"
    REMOVED = "REMOVED"
    AMBIGUOUS = "AMBIGUOUS"
    ALREADY_IMPORTED = "ALREADY_IMPORTED"


class NoticeState(StrEnum):
    UNLINKED = "UNLINKED"
    LINKED = "LINKED"
    UNKNOWN = "UNKNOWN"


class RequiredFieldIssue(StrEnum):
    NAME = "name"
    PRICE = "priceVnd"
    EXECUTION_PERIOD = "executionPeriod"
    CAPITAL = "capitalDetail"
    SELECTION_DURATION = "selectionDuration"
    SELECTION_START = "selectionStart"


class ImportConflict(RuntimeError):
    """A stable public conflict code from prepare/apply."""


@dataclass(frozen=True, slots=True)
class ProcurementCode:
    original: str
    base_code: str
    requested_revision: str | None
    kind: ProcurementCodeKind


def normalize_procurement_code(value: object) -> ProcurementCode:
    original = str(value or "").strip()
    match = _CODE_PATTERN.fullmatch(original)
    if not match:
        raise ValueError("PROCUREMENT_CODE_INVALID")
    prefix = match.group("kind").upper()
    return ProcurementCode(
        original=original,
        base_code=f"{prefix}{match.group('number')}",
        requested_revision=match.group("revision"),
        kind=(
            ProcurementCodeKind.PLAN
            if prefix == "PL"
            else ProcurementCodeKind.NOTICE
        ),
    )


def canonical_digest(value: object) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return f"sha256:{sha256(encoded).hexdigest()}"


def revision_sort_key(value: object) -> tuple[int, str]:
    text = str(value or "").strip()
    try:
        return int(text), text
    except ValueError:
        return -1, text


def source_revision_version(provider: object, value: object) -> int | None:
    """Return the Bidding version owned by an authoritative source revision."""

    if str(provider or "").strip().upper() != "MUASAMCONG":
        return None
    text = str(value or "").strip()
    if not text.isdigit():
        raise ValueError("PROCUREMENT_REVISION_INVALID")
    number = int(text)
    if number < 0:
        raise ValueError("PROCUREMENT_REVISION_INVALID")
    return number


def required_package_issues(package: dict) -> list[dict]:
    required = (
        (RequiredFieldIssue.NAME, package.get("name") not in (None, "")),
        (RequiredFieldIssue.PRICE, isinstance(package.get("priceVnd"), int) and package["priceVnd"] >= 0),
        (RequiredFieldIssue.EXECUTION_PERIOD, bool(str(package.get("executionPeriod") or "").strip())),
        (RequiredFieldIssue.CAPITAL, bool(str(package.get("capitalDetail") or "").strip())),
        (RequiredFieldIssue.SELECTION_DURATION, bool(str(package.get("selectionDuration") or "").strip())),
        (RequiredFieldIssue.SELECTION_START, bool(str(package.get("selectionStart") or "").strip())),
    )
    return [
        {
            "code": "PROCUREMENT_REQUIRED_FIELDS_MISSING",
            "field": field.value,
            "packageObservationId": package.get("planDetailRevisionId"),
        }
        for field, valid in required
        if not valid
    ]


def derive_import_lifecycle_status(package: dict) -> str:
    """Map source evidence conservatively to a persisted package status."""

    has_link_field = "noticeLink" in package
    link = package.get("noticeLink") or {}
    link_state = str(
        link.get("state") or ("UNKNOWN" if has_link_field else "UNLINKED")
    ).upper()
    kind = str(link.get("kind") or "UNKNOWN").upper()
    complete = not required_package_issues(package)
    exact_tbmt = bool(
        link_state == "LINKED"
        and str(link.get("noticeNo") or "").strip()
        and kind == "TBMT"
        and str(link.get("noticeRevisionId") or "").strip()
        and link.get("noticeVersion") is not None
    )
    source_status = str(
        (package.get("noticeFields") or {}).get("status")
        or package.get("sourceStatus")
        or ""
    ).upper()
    if exact_tbmt and complete and source_status == "PUBLISHED":
        return "INVITED"
    contrary = source_status in {
        "CANCELLED", "OPENED", "EVALUATING", "PARTIALLY_AWARDED", "AWARDED",
    }
    if (
        link_state == "UNLINKED"
        and package.get("expectedNotice") is True
        and complete
        and not contrary
    ):
        return "PREPARING"
    return "UNKNOWN"


SOURCE_OWNED_PACKAGE_FIELDS = (
    "symbol",
    "name",
    "summary",
    "priceVnd",
    "estimatePriceVnd",
    "field",
    "capitalDetail",
    "selectionForm",
    "selectionMode",
    "evaluationMethod",
    "selectionDuration",
    "selectionStart",
    "contractType",
    "executionPeriod",
    "onlineMode",
    "domesticOrInternational",
    "lots",
    "additionalPurchaseOption",
    "noticeLink",
    "noticeFields",
    "expectedNotice",
    "sourceStatus",
)


def package_source_fields(package: dict) -> dict:
    return {
        key: package.get(key)
        for key in SOURCE_OWNED_PACKAGE_FIELDS
        if key in package
    }


def three_way_merge_field(base, local, source, *, source_owned=True):
    """Return (effective value, disposition) without overwriting local edits."""

    if not source_owned:
        return local, "KEEP_LOCAL"
    local_changed = local != base
    source_changed = source != base
    if local_changed and source_changed and local != source:
        return local, "CONFLICT"
    if source_changed:
        return source, "APPLY_SOURCE"
    return local, "KEEP_LOCAL"
