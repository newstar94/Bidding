"""Canonical matching normalization for award-result workbooks."""

from __future__ import annotations

from typing import Any
import unicodedata

from backend.shared.text_utils import normalize_lot_code


def normalize_text(value: Any) -> str:
    return " ".join(
        unicodedata.normalize("NFKC", str(value or "")).strip().split()
    ).casefold()


normalize_code = normalize_lot_code


def normalize_tax_code(value: Any) -> str:
    return normalize_code(value)
