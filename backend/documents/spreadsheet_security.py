"""Shared guards for untrusted text written to spreadsheet cells."""

from __future__ import annotations

import unicodedata
from typing import Any


_FORMULA_PREFIXES = ("=", "+", "-", "@")
_CONTROL_PREFIXES = ("\t", "\r", "\n")


def safe_spreadsheet_text(value: Any) -> Any:
    """Preserve text while preventing Excel from interpreting it as a formula."""

    if not isinstance(value, str) or not value or value.startswith("'"):
        return value
    normalized = unicodedata.normalize("NFKC", value)
    significant = normalized.lstrip()
    if normalized.startswith(_CONTROL_PREFIXES) or significant.startswith(
        _FORMULA_PREFIXES
    ):
        return f"'{value}"
    return value
