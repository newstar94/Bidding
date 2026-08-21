"""Canonical, upstream-independent procurement import domain types."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
import json
import re
import unicodedata
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


SKIPPED_REVISION_DISPOSITIONS = frozenset({
    "ALREADY_IMPORTED",
    "PROVENANCE_ONLY",
})


def revision_requires_materialization(disposition: object) -> bool:
    """Return whether a source revision belongs to the active import surface."""

    return str(disposition or "").strip().upper() not in SKIPPED_REVISION_DISPOSITIONS


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


def has_exact_published_notice(package: dict) -> bool:
    """Return whether source evidence identifies an exact published TBMT."""

    has_link_field = "noticeLink" in package
    link = package.get("noticeLink") or {}
    link_state = str(
        link.get("state") or ("UNKNOWN" if has_link_field else "UNLINKED")
    ).upper()
    kind = str(link.get("kind") or "UNKNOWN").upper()
    exact_tbmt = bool(
        (
            link_state == "LINKED"
            and str(link.get("noticeNo") or "").strip()
            and kind == "TBMT"
            and str(link.get("noticeRevisionId") or "").strip()
            and link.get("noticeVersion") is not None
        )
        or (
            str(package.get("kind") or "").upper() == "TBMT"
            and str(package.get("noticeNo") or "").strip()
            and str(package.get("revisionId") or "").strip()
            and package.get("revisionNumber") is not None
        )
    )
    return exact_tbmt


def derive_import_lifecycle_status(package: dict) -> str:
    """Interpret the lifecycle observed at the procurement source."""

    has_link_field = "noticeLink" in package
    link = package.get("noticeLink") or {}
    link_state = str(
        link.get("state") or ("UNKNOWN" if has_link_field else "UNLINKED")
    ).upper()
    complete = not required_package_issues(package)
    exact_tbmt = has_exact_published_notice(package)
    notice_fields = package.get("noticeFields") or {}
    status_for_notify = str(
        notice_fields.get("statusForNotify")
        or package.get("statusForNotify")
        or ""
    ).strip().upper()
    source_status = str(
        notice_fields.get("status")
        or package.get("sourceStatus")
        or package.get("status")
        or ""
    ).strip().upper()
    source_status_text = "".join(
        character
        for character in unicodedata.normalize("NFKD", source_status)
        if unicodedata.category(character) != "Mn"
    ).replace("Đ", "D")
    if exact_tbmt and source_status_text in {"DANG XET THAU", "DANG CHAM THAU"}:
        return "EVALUATING"
    if exact_tbmt and status_for_notify == "DXT":
        return "EVALUATING"
    if exact_tbmt and status_for_notify in {"DHTBMT", "DHT", "DHKQLCNT"}:
        return "CANCELLED"
    status_mapping = {
        "INIT_MT": "PREPARING",
        "NEW": "PREPARING",
        "01": "INVITED",
        "PUBLISHED": "INVITED",
        "PUB_TBMT": "INVITED",
        "PUB_MT": "INVITED",
        "IS_PUBLISH": "INVITED",
        "CHUA_DONG_THAU": "INVITED",
        "OPEN_BID": "OPENED",
        "OPEN_DXKT": "OPENED",
        "PUB_DSNTKT": "EVALUATING",
        "OPEN_DXTC": "OPENED",
        "CANCEL_BID": "CANCELLED",
        "03": "CANCELLED",
        "OPENED": "OPENED",
        "EVALUATING": "EVALUATING",
        "PARTIALLY_AWARDED": "PARTIALLY_AWARDED",
        "AWARDED": "AWARDED",
        "CANCELLED": "CANCELLED",
        "PUB_KQLCNT": "AWARDED",
    }
    mapped = status_mapping.get(source_status)
    if exact_tbmt and mapped:
        return mapped
    contrary = source_status in {
        "CANCELLED", "OPENED", "EVALUATING", "PARTIALLY_AWARDED", "AWARDED",
    }
    if (
        exact_tbmt
        and str(package.get("approvalDecisionNo") or "").strip()
        and not contrary
    ):
        return "INVITED"
    if (
        link_state == "UNLINKED"
        and package.get("expectedNotice") is True
        and complete
        and not contrary
    ):
        return "PREPARING"
    return "UNKNOWN"


_LOCAL_WORKFLOW_STATUSES = {
    "UNKNOWN", "PREPARING", "INVITED", "OPENED", "EVALUATING",
    "PARTIALLY_AWARDED", "AWARDED", "CANCELLED",
}
_USER_CONTROLLED_WORKFLOW_STATUSES = {
    "OPENED", "EVALUATING", "PARTIALLY_AWARDED", "AWARDED", "CANCELLED",
}
_SOURCE_POST_INVITATION_STATUSES = {
    "OPENED", "EVALUATING", "PARTIALLY_AWARDED", "AWARDED", "CANCELLED",
}


def project_source_lifecycle_to_bidding(
    source_status,
    *,
    existing_status=None,
    has_published_notice=False,
) -> str:
    """Project source evidence without letting it drive Bidding workflow."""

    source = str(source_status or "UNKNOWN").strip().upper()
    if source not in _LOCAL_WORKFLOW_STATUSES:
        source = "UNKNOWN"
    existing = str(existing_status or "").strip().upper()
    if existing not in _LOCAL_WORKFLOW_STATUSES:
        existing = ""

    if existing in _USER_CONTROLLED_WORKFLOW_STATUSES:
        return existing
    if existing == "INVITED":
        return "INVITED"
    if source == "PREPARING":
        return "PREPARING"
    if source == "INVITED":
        return "INVITED" if has_published_notice else "UNKNOWN"
    if source in _SOURCE_POST_INVITATION_STATUSES:
        return "INVITED" if has_published_notice else "UNKNOWN"
    if existing == "PREPARING" and has_published_notice:
        return "INVITED"
    return "INVITED" if has_published_notice else "UNKNOWN"


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
    "goodsItems",
    "isMultiLot",
    "isPrequalification",
    "isConcentrateShopping",
    "additionalPurchaseOption",
    "additionalPurchaseItems",
    "bidValidityDays",
    "bidGuaranteeVnd",
    "approvalDecisionNo",
    "approvalDecisionDate",
    "actualOpeningAt",
    "financialActualOpeningAt",
    "lifecycleStatus",
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
