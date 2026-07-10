from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class SyncReadWindow:
    since: str
    after_version: int | None
    is_full_initial_fetch: bool


def parse_sync_read_window(query_params) -> SyncReadWindow:
    since_val = query_params.get("since", "0")
    if since_val.isdigit() and int(since_val) < 10000000000:
        val = int(since_val)
        if val == 0:
            since = "1970-01-01 00:00:00"
        else:
            try:
                since = datetime.fromtimestamp(val).strftime("%Y-%m-%d %H:%M:%S")
            except Exception:
                since = "1970-01-01 00:00:00"
    else:
        since = since_val

    after_version_raw = query_params.get("after_version")
    try:
        after_version = int(after_version_raw) if after_version_raw not in (None, "") else None
    except (TypeError, ValueError):
        after_version = None

    is_full_initial_fetch = after_version is None and (since == "1970-01-01 00:00:00" or since == "0")
    return SyncReadWindow(
        since=since,
        after_version=after_version,
        is_full_initial_fetch=is_full_initial_fetch,
    )
