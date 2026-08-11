"""Upstream-independent types for on-demand procurement lookup."""

from __future__ import annotations


LOOKUP_SCHEMA_VERSION = "biddingflow-procurement-preview-v1"


class ProcurementLookupError(RuntimeError):
    """Sanitized lookup failure carrying a stable public error code."""

