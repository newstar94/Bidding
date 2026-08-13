"""Parsing and bounded-size validation for sync request metadata."""

from dataclasses import dataclass
from datetime import datetime, timezone
import os

from backend.sync.queries import TABLE_KEYS


def sync_batch_limit():
    try:
        value = int(os.environ.get("SYNC_MAX_BATCH_ITEMS", "2000"))
    except (TypeError, ValueError):
        value = 2000
    return min(10_000, max(100, value))


def generated_aggregate_batch_limit():
    """Bound trusted server graphs separately from untrusted client batches."""

    try:
        value = int(os.environ.get("AGGREGATE_VERSION_MAX_ITEMS", "100000"))
    except (TypeError, ValueError):
        value = 100_000
    return min(500_000, max(2_001, value))


def sync_batch_size(payload):
    if not isinstance(payload, dict):
        return 0
    keys = set(TABLE_KEYS)
    keys.add("deletions")
    return sum(
        len(payload.get(key) or [])
        for key in keys
        if isinstance(payload.get(key), list)
    )


@dataclass(frozen=True)
class SyncReadWindow:
    since: str
    after_version: int | None
    is_full_initial_fetch: bool


def parse_sync_read_window(query_params) -> SyncReadWindow:
    since_value = query_params.get("since", "0")
    if since_value.isdigit() and int(since_value) < 10_000_000_000:
        timestamp = int(since_value)
        if timestamp == 0:
            since = "1970-01-01 00:00:00"
        else:
            try:
                since = datetime.fromtimestamp(timestamp, timezone.utc).isoformat()
            except (ValueError, OverflowError, OSError):
                since = "1970-01-01 00:00:00"
    else:
        since = since_value
    raw_version = query_params.get("after_version")
    try:
        after_version = int(raw_version) if raw_version not in (None, "") else None
    except (TypeError, ValueError):
        after_version = None
    return SyncReadWindow(
        since=since,
        after_version=after_version,
        is_full_initial_fetch=(
            after_version is None and since in {"1970-01-01 00:00:00", "0"}
        ),
    )
