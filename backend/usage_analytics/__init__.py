"""Privacy-bounded product usage analytics for commercial decisions."""

from backend.usage_analytics.service import (
    FEATURE_KEYS,
    FEATURE_LABELS,
    build_usage_summary,
    parse_summary_window,
    record_client_event,
    record_word_export_success_best_effort,
)

__all__ = (
    "FEATURE_KEYS",
    "FEATURE_LABELS",
    "build_usage_summary",
    "parse_summary_window",
    "record_client_event",
    "record_word_export_success_best_effort",
)
