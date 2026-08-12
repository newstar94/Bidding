"""Upstream-independent types for on-demand procurement lookup."""

from __future__ import annotations


LOOKUP_SCHEMA_VERSION = "biddingflow-procurement-preview-v1"
DETAIL_LEVELS = frozenset({"SUMMARY", "CANONICAL", "COMPLETE"})
REVISION_MODES = frozenset({"LATEST", "SELECTED", "ALL"})


class ProcurementLookupError(RuntimeError):
    """Sanitized lookup failure carrying a stable public error code."""


def normalize_lookup_options(
    detail_level="CANONICAL",
    revision_mode="LATEST",
    revision_numbers=None,
):
    """Validate the shared lookup/import revision vocabulary."""

    detail = str(detail_level or "CANONICAL").strip().upper()
    mode = str(revision_mode or "LATEST").strip().upper()
    if detail not in DETAIL_LEVELS or mode not in REVISION_MODES:
        raise ValueError("Invalid procurement lookup options")
    if revision_numbers is None:
        numbers = ()
    elif isinstance(revision_numbers, list):
        numbers = tuple(
            str(number).strip().zfill(2)
            for number in revision_numbers
            if str(number).strip()
        )
    else:
        raise ValueError("revisionNumbers must be an array")
    if mode == "SELECTED" and not numbers:
        raise ValueError("SELECTED requires revisionNumbers")
    if mode != "SELECTED" and numbers:
        raise ValueError("revisionNumbers requires SELECTED")
    if any(len(number) > 16 for number in numbers) or len(numbers) > 100:
        raise ValueError("Invalid revisionNumbers")
    return detail, mode, numbers
