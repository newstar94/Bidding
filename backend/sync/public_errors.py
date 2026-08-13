"""Allowlisted public error contract for synchronization mutations."""

from __future__ import annotations

from typing import Any


_PUBLIC_CODES = {
    "ROW_VERSION_CONFLICT",
    "RECORD_ACCESS_DENIED",
    "HISTORICAL_PARENT_IMMUTABLE",
    "RECORD_DELETED",
    "FULL_SYNC_REQUIRED",
    "AGGREGATE_PENDING_REFERENCE_INVALID",
}


def _correlation(value: Any) -> str:
    return str(value or "").strip()[:128]


def sanitize_sync_error(error: Any, *, correlation_id=None) -> dict[str, Any]:
    """Return only stable, allowlisted fields; never raw DB details or IDs."""

    if isinstance(error, dict):
        code = str(error.get("code") or "").strip()
        if code in _PUBLIC_CODES:
            public = {
                "code": code,
                "message": str(error.get("message") or "Không thể lưu bản ghi đồng bộ.")[:300],
                "retryable": bool(error.get("retryable", code == "ROW_VERSION_CONFLICT")),
            }
            for key in ("currentVersion", "expectedVersion", "field"):
                if key in error and isinstance(error[key], (str, int, float, bool, type(None))):
                    public[key] = error[key]
            correlation = _correlation(correlation_id or error.get("correlationId"))
            if correlation:
                public["correlationId"] = correlation
            return public
    public = {
        "code": "SYNC_ITEM_WRITE_FAILED",
        "message": "Không thể lưu bản ghi đồng bộ.",
        "retryable": False,
    }
    correlation = _correlation(correlation_id)
    if correlation:
        public["correlationId"] = correlation
    return public


def public_sync_item_error(
    exception: Exception,
    *,
    table_name=None,
    record_id=None,
    correlation_id=None,
) -> dict[str, Any]:
    """Map an internal item failure without exposing its table/record context."""

    del exception, table_name, record_id
    return sanitize_sync_error({}, correlation_id=correlation_id)
