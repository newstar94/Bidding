"""Shared validation rules for summary bid-evaluation values."""

from __future__ import annotations

import re
import unicodedata
from decimal import Decimal, InvalidOperation


LOWEST_PRICE = "LOWEST_PRICE"
EVALUATED_PRICE = "EVALUATED_PRICE"
FIXED_PRICE = "FIXED_PRICE"
COMBINED_TECHNICAL_PRICE = "COMBINED_TECHNICAL_PRICE"
TECHNICAL_BASED = "TECHNICAL_BASED"
COMBINED_EVALUATION_METHOD = "Kết hợp giữa kỹ thuật và giá"
COMBINED_EVALUATION_METHOD_ALIASES = (
    COMBINED_EVALUATION_METHOD,
    "Kết hợp kỹ thuật và giá",
    COMBINED_TECHNICAL_PRICE,
)
LEGACY_TECHNICAL_RESULTS = frozenset({"Đạt", "Không đạt"})
_TECHNICAL_SCORE_PATTERN = re.compile(r"^(?:\d+(?:\.\d+)?|\.\d+)$")


def _normalize_method_token(value) -> str:
    normalized = unicodedata.normalize("NFD", str(value or ""))
    normalized = "".join(
        character for character in normalized
        if unicodedata.category(character) != "Mn"
    ).lower().replace("đ", "d")
    return " ".join(re.sub(r"[^a-z0-9]+", " ", normalized).split())


_EVALUATION_METHOD_BY_TOKEN = {
    "lowest price": LOWEST_PRICE,
    "gia thap nhat": LOWEST_PRICE,
    "evaluated price": EVALUATED_PRICE,
    "gia danh gia": EVALUATED_PRICE,
    "fixed price": FIXED_PRICE,
    "gia co dinh": FIXED_PRICE,
    "combined technical price": COMBINED_TECHNICAL_PRICE,
    "ket hop giua ky thuat va gia": COMBINED_TECHNICAL_PRICE,
    "ket hop ky thuat va gia": COMBINED_TECHNICAL_PRICE,
    "technical based": TECHNICAL_BASED,
    "dua tren ky thuat": TECHNICAL_BASED,
}


def normalize_evaluation_method(method) -> str:
    """Return the canonical evaluation-method code for codes or legacy labels."""
    return _EVALUATION_METHOD_BY_TOKEN.get(_normalize_method_token(method), "")


def is_combined_evaluation_method(method) -> bool:
    return normalize_evaluation_method(method) == COMBINED_TECHNICAL_PRICE


def parse_technical_score(value):
    """Return a non-negative finite score, or ``None`` for invalid input."""
    if isinstance(value, bool):
        return None
    normalized = ("" if value is None else str(value)).strip().replace(",", ".")
    if not normalized or not _TECHNICAL_SCORE_PATTERN.fullmatch(normalized):
        return None
    try:
        score = Decimal(normalized)
    except InvalidOperation:
        return None
    return score if score.is_finite() and score >= 0 else None


def requires_technical_score(method) -> bool:
    return is_combined_evaluation_method(method)


def is_inherited_legacy_technical_result(
    cursor,
    organization_id,
    package_root_id,
    package_version,
    target_plan_id,
    target_plan_root_id,
    contractor_id,
    lot_code,
    technical_value,
) -> bool:
    """Recognize an unchanged legacy result copied into a plan snapshot.

    Older combined-method records legitimately contain ``Đạt``/``Không đạt``
    because the numeric-score rule did not exist when they were saved. A plan
    snapshot must preserve those historical values, but a new evaluation must
    still be numeric. The source package, bidder, lot, version, and exact
    legacy value all have to match before this compatibility path is allowed.
    """

    normalized_technical_value = str(technical_value or "").strip()
    if normalized_technical_value not in LEGACY_TECHNICAL_RESULTS:
        return False

    required_values = (
        organization_id,
        package_root_id,
        package_version,
        target_plan_id,
        target_plan_root_id,
        contractor_id,
    )
    if any(value is None or not str(value).strip() for value in required_values):
        return False
    normalized_lot = str(lot_code or "").strip()
    row = cursor.execute(
        """SELECT 1
             FROM goi_thau AS source_package
             JOIN ke_hoach_lcnt AS source_plan
               ON source_plan.organization_id = source_package.organization_id
              AND source_plan.id = source_package.ke_hoach_id
             JOIN thong_tin_mo_thau AS source_opening
               ON source_opening.organization_id = source_package.organization_id
              AND source_opening.goi_thau_id = source_package.id
             JOIN ket_qua_danh_gia_nha_thau AS source_result
               ON source_result.organization_id = source_opening.organization_id
              AND source_result.goi_thau_id = source_opening.goi_thau_id
              AND source_result.thong_tin_mo_thau_id = source_opening.id
            WHERE source_package.organization_id = ?
              AND COALESCE(NULLIF(source_package.id_goc, ''), source_package.id) = ?
              AND source_package.phien_ban = ?
              AND source_package.ke_hoach_id <> ?
              AND COALESCE(NULLIF(source_plan.id_goc, ''), source_plan.id) = ?
              AND TRIM(source_package.phuong_phap_danh_gia) IN (?, ?, ?)
              AND source_package.archived_at IS NULL
              AND source_opening.archived_at IS NULL
              AND source_opening.nha_thau_id = ?
              AND COALESCE(source_opening.ma_phan_lo, '') = ?
              AND TRIM(source_result.danh_gia_ky_thuat) = ?
            LIMIT 1""",
        (
            organization_id,
            package_root_id,
            package_version,
            target_plan_id,
            target_plan_root_id,
            *COMBINED_EVALUATION_METHOD_ALIASES,
            contractor_id,
            normalized_lot,
            normalized_technical_value,
        ),
    ).fetchone()
    return bool(row)
