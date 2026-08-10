"""Conservative normalization of configurable VNEPS violation responses."""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from datetime import date, datetime
from typing import Any

from backend.contractor_risk.types import (
    DurationUnit,
    NormalizedViolationRecord,
    ViolationCategory,
    ViolationProviderResult,
)
from backend.integrations.vneps.errors import VnepsSchemaError
from backend.shared.date_utils import parse_datetime_value


RESPONSE_SCHEMA_VERSION = "1"


def _fold(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value or "")).casefold()
    text = "".join(character for character in text if not unicodedata.combining(character))
    return re.sub(r"[^a-z0-9]+", "_", text).strip("_")


_CATEGORY_MAP = {
    "bidding_ban": ViolationCategory.BIDDING_BAN,
    "cam_tham_gia_hoat_dong_dau_thau": ViolationCategory.BIDDING_BAN,
    "cam_thau": ViolationCategory.BIDDING_BAN,
    "contract_termination_by_contractor_fault": (
        ViolationCategory.CONTRACT_TERMINATION_BY_CONTRACTOR_FAULT
    ),
    "cham_dut_hop_dong_do_loi_cua_nha_thau": (
        ViolationCategory.CONTRACT_TERMINATION_BY_CONTRACTOR_FAULT
    ),
    "unreliable_bid_participation": ViolationCategory.UNRELIABLE_BID_PARTICIPATION,
    "khong_bao_dam_uy_tin_khi_tham_du_thau": (
        ViolationCategory.UNRELIABLE_BID_PARTICIPATION
    ),
    "administrative_warning_or_other_action": (
        ViolationCategory.ADMINISTRATIVE_WARNING_OR_OTHER_ACTION
    ),
    "xu_ly_hanh_chinh_canh_bao_hinh_thuc_khac": (
        ViolationCategory.ADMINISTRATIVE_WARNING_OR_OTHER_ACTION
    ),
    "xu_ly_hanh_chinh_canh_cao_hinh_thuc_khac": (
        ViolationCategory.ADMINISTRATIVE_WARNING_OR_OTHER_ACTION
    ),
}

_REVOKED_STATUSES = {
    "cancel",
    "cancelled",
    "canceled",
    "revoked",
    "withdrawn",
    "bi_huy",
    "da_huy",
    "thu_hoi",
    "da_thu_hoi",
}


def _first(mapping: dict[str, Any], *keys: str, default=None):
    for key in keys:
        if key in mapping and mapping[key] not in (None, ""):
            return mapping[key]
    return default


def _parse_date(value: object) -> date | datetime | None:
    if value in (None, ""):
        return None
    parsed = parse_datetime_value(value)
    if parsed is None:
        return None
    raw = str(value).strip()
    has_time = "T" in raw or ":" in raw or len(raw) > 10
    return parsed if has_time else parsed.date()


def _parse_duration_unit(value: object) -> DurationUnit | None:
    folded = _fold(value)
    return {
        "day": DurationUnit.DAY,
        "days": DurationUnit.DAY,
        "ngay": DurationUnit.DAY,
        "month": DurationUnit.MONTH,
        "months": DurationUnit.MONTH,
        "thang": DurationUnit.MONTH,
        "year": DurationUnit.YEAR,
        "years": DurationUnit.YEAR,
        "nam": DurationUnit.YEAR,
    }.get(folded)


def _parse_boolean(value: object, *, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value in (1, "1"):
        return True
    if value in (0, "0"):
        return False
    folded = _fold(value)
    if folded in {"true", "yes", "co"}:
        return True
    if folded in {"false", "no", "khong"}:
        return False
    return default


def _extract_items(payload: object) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        raise VnepsSchemaError("VNEPS violation response must be an object or list")
    for key in ("items", "content", "value", "results", "records"):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    data = payload.get("data")
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    if isinstance(data, dict):
        return _extract_items(data)
    page = payload.get("page")
    if isinstance(page, dict):
        return _extract_items(page)
    if payload in ({}, {"data": None}):
        return []
    raise VnepsSchemaError("VNEPS violation response has no supported record list")


def _normalize_record(item: dict[str, Any]) -> NormalizedViolationRecord | None:
    raw_category = _first(
        item,
        "category",
        "violationCategory",
        "violationType",
        "type",
        "loaiViPham",
    )
    category = _CATEGORY_MAP.get(_fold(raw_category))
    if category is None:
        return None

    source_status = str(
        _first(item, "sourceStatus", "status", "trangThai", default="") or ""
    ).strip()
    revoked = _parse_boolean(
        _first(item, "isRevoked", "isCancelled", "isCanceled", "daHuy"),
    ) or _fold(source_status) in _REVOKED_STATUSES
    duration_value = _first(item, "duration", "durationValue", "thoiHan")
    try:
        duration = int(duration_value) if duration_value not in (None, "") else None
    except (TypeError, ValueError):
        duration = None

    applicable = _parse_boolean(
        _first(item, "isApplicable", "applicable", default=True),
        default=True,
    )
    if category == ViolationCategory.CONTRACT_TERMINATION_BY_CONTRACTOR_FAULT:
        fault_value = _first(
            item,
            "contractorFault",
            "isContractorFault",
            "doLoiNhaThau",
            default=None,
        )
        explicitly_faulted = _parse_boolean(fault_value, default=False)
        explicitly_not_faulted = fault_value is not None and not explicitly_faulted
        applicable = applicable and not explicitly_not_faulted
        requires_review = fault_value is None
    else:
        requires_review = False

    return NormalizedViolationRecord(
        category=category,
        contractor_identifier=str(
            _first(
                item,
                "contractorIdentifier",
                "orgCode",
                "bidderCode",
                "maNhaThau",
                default="",
            )
            or ""
        ).strip(),
        tax_code=str(
            _first(item, "taxCode", "contractorTaxCode", "maSoThue", default="")
            or ""
        ).strip(),
        decision_number=str(
            _first(item, "decisionNumber", "documentNumber", "soQuyetDinh", default="")
            or ""
        ).strip(),
        issued_date=_parse_date(
            _first(item, "issuedDate", "decisionDate", "ngayBanHanh")
        ),
        effective_from=_parse_date(
            _first(item, "effectiveFrom", "fromDate", "ngayHieuLuc")
        ),
        effective_to=_parse_date(
            _first(item, "effectiveTo", "toDate", "ngayHetHieuLuc")
        ),
        # Deliberately never falls back to publicDate/createdDate/issuedDate.
        behavior_date=_parse_date(
            _first(item, "behaviorDate", "violationDate", "ngayThucHienHanhVi")
        ),
        duration=duration,
        duration_unit=_parse_duration_unit(
            _first(item, "durationUnit", "thoiHanDonVi")
        ),
        source_status=source_status,
        is_revoked=revoked,
        is_applicable=applicable,
        requires_review=_parse_boolean(
            _first(item, "requiresReview", default=requires_review),
            default=requires_review,
        ),
    )


def parse_violation_response(
    payload: object,
    *,
    provider: str,
) -> ViolationProviderResult:
    canonical = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
        default=str,
    ).encode("utf-8")
    records = tuple(
        normalized
        for item in _extract_items(payload)
        if (normalized := _normalize_record(item)) is not None
    )
    return ViolationProviderResult(
        records=records,
        provider=provider,
        schema_version=RESPONSE_SCHEMA_VERSION,
        payload_hash=hashlib.sha256(canonical).hexdigest(),
    )
