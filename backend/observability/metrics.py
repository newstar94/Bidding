"""Low-cardinality Prometheus metrics for the BiddingFlow ASGI process.

The implementation deliberately uses only the Python standard library.  This
keeps the production dependency set small while still exposing Prometheus'
text format and the counters/gauges needed by the operations runbook.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import ipaddress
import itertools
import json
import math
import os
import re
import secrets
import shutil
import threading
import time
from collections import Counter, OrderedDict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from starlette.requests import Request
from starlette.responses import PlainTextResponse, Response

from backend.shared.client_ip import get_client_ip


_HTTP_DURATION_BUCKETS = (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0)
_DATABASE_DURATION_BUCKETS = (0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 15.0, 30.0)
_SAFE_LABEL = re.compile(r"^[A-Za-z0-9_.:-]{1,96}$")
_PROCESS_STARTED_AT = time.time()
_lock = threading.Lock()

_active_http_requests = 0
_http_requests: Counter[tuple[str, str, str]] = Counter()
_http_rate_limited: Counter[tuple[str, str]] = Counter()
_http_duration_count: Counter[tuple[str, str]] = Counter()
_http_duration_sum: Counter[tuple[str, str]] = Counter()
_http_duration_buckets: Counter[tuple[str, str, float]] = Counter()

_database_operations: Counter[tuple[str, str]] = Counter()
_database_busy: Counter[str] = Counter()
_database_duration_count: Counter[str] = Counter()
_database_duration_sum: Counter[str] = Counter()
_database_duration_buckets: Counter[tuple[str, float]] = Counter()
_database_phase_count: Counter[tuple[str, str, str]] = Counter()
_database_phase_sum: Counter[tuple[str, str, str]] = Counter()
_database_phase_buckets: Counter[tuple[str, str, str, float]] = Counter()
_database_phase_max: Counter[tuple[str, str, str]] = Counter()

_document_worker = Counter()
_document_worker_queue_wait_seconds = 0.0
_document_worker_duration_seconds = 0.0

_partner_lookup_requests = Counter()
_partner_upstreams = Counter()

_websocket = Counter()
_recent_websocket_users: OrderedDict[str, float] = OrderedDict()
_runtime_log_dropped = 0
_audit_chain_checks = Counter()
_audit_chain_available = 0
_audit_chain_valid = 0
_audit_chain_rows = 0
_audit_chain_last_check_timestamp = 0.0
_audit_chain_last_valid_timestamp = 0.0
_audit_chain_check_duration_seconds = 0.0
_audit_checkpoints = Counter()
_audit_checkpoint_last_success_timestamp = 0.0
_artifact_verification_cache = {
    "backup_directory": None,
    "restore_state_file": None,
    "backup_timestamp": None,
    "restore_timestamp": None,
    "checked_at": 0.0,
}


def _safe_label(value: object, fallback: str = "unknown") -> str:
    text = str(value or "").strip()
    return text if _SAFE_LABEL.fullmatch(text) else fallback


def route_label_from_scope(scope: dict[str, Any]) -> str:
    """Return a code-owned endpoint label; never use the raw request path."""
    endpoint = scope.get("endpoint")
    if endpoint is None:
        return "unmatched"
    name = getattr(endpoint, "__name__", None)
    if name:
        return _safe_label(name)
    return _safe_label(endpoint.__class__.__name__.lower())


def http_request_started() -> None:
    global _active_http_requests
    with _lock:
        _active_http_requests += 1


def http_request_finished(method: object, route: object, status: int, duration_seconds: float) -> None:
    global _active_http_requests
    method_label = _safe_label(str(method or "UNKNOWN").upper(), "UNKNOWN")
    route_label = _safe_label(route, "unknown")
    status_label = str(min(599, max(100, int(status or 500))))
    duration = max(0.0, float(duration_seconds))
    with _lock:
        _active_http_requests = max(0, _active_http_requests - 1)
        _http_requests[(method_label, route_label, status_label)] += 1
        if status_label == "429":
            _http_rate_limited[(method_label, route_label)] += 1
        histogram_key = (method_label, route_label)
        _http_duration_count[histogram_key] += 1
        _http_duration_sum[histogram_key] += duration
        for upper_bound in _HTTP_DURATION_BUCKETS:
            if duration <= upper_bound:
                _http_duration_buckets[(method_label, route_label, upper_bound)] += 1


def record_database_operation(
    lane: object,
    duration_seconds: float,
    *,
    outcome: object = "ok",
    busy: bool = False,
) -> None:
    lane_label = _safe_label(lane, "unknown")
    outcome_label = _safe_label(outcome, "error")
    duration = max(0.0, float(duration_seconds))
    with _lock:
        _database_operations[(lane_label, outcome_label)] += 1
        if busy:
            _database_busy[lane_label] += 1
        _database_duration_count[lane_label] += 1
        _database_duration_sum[lane_label] += duration
        for upper_bound in _DATABASE_DURATION_BUCKETS:
            if duration <= upper_bound:
                _database_duration_buckets[(lane_label, upper_bound)] += 1


def record_database_phase(
    scope: object,
    phase: object,
    duration_seconds: float,
    *,
    outcome: object = "ok",
) -> None:
    """Record a bounded internal latency phase without query text or tenant labels."""

    scope_label = _safe_label(scope, "unknown")
    phase_label = _safe_label(phase, "unknown")
    outcome_label = _safe_label(outcome, "error")
    duration = max(0.0, float(duration_seconds))
    key = (scope_label, phase_label, outcome_label)
    with _lock:
        _database_phase_count[key] += 1
        _database_phase_sum[key] += duration
        _database_phase_max[key] = max(_database_phase_max[key], duration)
        for upper_bound in _DATABASE_DURATION_BUCKETS:
            if duration <= upper_bound:
                _database_phase_buckets[(*key, upper_bound)] += 1


def document_worker_wait_started() -> None:
    with _lock:
        _document_worker["submitted"] += 1
        _document_worker["waiting"] += 1


def document_worker_acquired(wait_seconds: float) -> None:
    global _document_worker_queue_wait_seconds
    with _lock:
        _document_worker["waiting"] = max(0, _document_worker["waiting"] - 1)
        _document_worker["active"] += 1
        _document_worker_queue_wait_seconds += max(0.0, float(wait_seconds))


def document_worker_rejected(wait_seconds: float) -> None:
    global _document_worker_queue_wait_seconds
    with _lock:
        _document_worker["waiting"] = max(0, _document_worker["waiting"] - 1)
        _document_worker["rejected"] += 1
        _document_worker_queue_wait_seconds += max(0.0, float(wait_seconds))


def document_worker_finished(outcome: object, duration_seconds: float) -> None:
    global _document_worker_duration_seconds
    outcome_label = _safe_label(outcome, "failed")
    if outcome_label not in {"completed", "failed", "timed_out"}:
        outcome_label = "failed"
    with _lock:
        _document_worker["active"] = max(0, _document_worker["active"] - 1)
        _document_worker[outcome_label] += 1
        _document_worker_duration_seconds += max(0.0, float(duration_seconds))


def record_partner_lookup(outcome: object) -> None:
    """Record a bounded aggregate; tenant attribution stays in structured logs."""
    outcome_label = _safe_label(outcome, "error")
    if outcome_label not in {
        "found",
        "not_found",
        "invalid",
        "unauthorized",
        "forbidden",
        "rate_limited",
        "busy",
        "upstream_error",
        "error",
    }:
        outcome_label = "error"
    with _lock:
        _partner_lookup_requests[outcome_label] += 1


def record_partner_upstream(upstream: object, outcome: object) -> None:
    upstream_label = _safe_label(upstream, "unknown")
    outcome_label = _safe_label(outcome, "error")
    if upstream_label not in {"muasamcong", "vietqr", "escodata"}:
        upstream_label = "unknown"
    if outcome_label not in {
        "found",
        "not_found",
        "timeout",
        "error",
        "circuit_open",
    }:
        outcome_label = "error"
    with _lock:
        _partner_upstreams[(upstream_label, outcome_label)] += 1


def websocket_attempted() -> None:
    with _lock:
        _websocket["attempted"] += 1


def websocket_rejected(reason: object) -> None:
    reason_label = _safe_label(reason, "other")
    with _lock:
        _websocket[f"rejected:{reason_label}"] += 1


def websocket_authentication_failed(reason: object) -> None:
    reason_label = _safe_label(reason, "other")
    with _lock:
        _websocket[f"auth_failed:{reason_label}"] += 1


def websocket_connected(user_id: object) -> None:
    now = time.monotonic()
    user_fingerprint = hashlib.sha256(str(user_id or "unknown").encode("utf-8")).hexdigest()
    with _lock:
        _websocket["active"] += 1
        _websocket["connected"] += 1
        previous = _recent_websocket_users.pop(user_fingerprint, None)
        if previous is not None and now - previous <= 3600:
            _websocket["reconnected"] += 1
        _recent_websocket_users[user_fingerprint] = now
        while len(_recent_websocket_users) > 10_000:
            _recent_websocket_users.popitem(last=False)
        while _recent_websocket_users:
            _key, last_seen = next(iter(_recent_websocket_users.items()))
            if now - last_seen <= 3600:
                break
            _recent_websocket_users.popitem(last=False)


def websocket_disconnected() -> None:
    with _lock:
        _websocket["active"] = max(0, _websocket["active"] - 1)
        _websocket["disconnected"] += 1


def runtime_log_dropped() -> None:
    global _runtime_log_dropped
    with _lock:
        _runtime_log_dropped += 1


def record_audit_chain_verification(outcome: object, duration_seconds: float, row_count: int) -> None:
    global _audit_chain_available, _audit_chain_valid, _audit_chain_rows
    global _audit_chain_last_check_timestamp, _audit_chain_last_valid_timestamp
    global _audit_chain_check_duration_seconds
    outcome_label = _safe_label(outcome, "error")
    if outcome_label not in {"valid", "invalid", "error"}:
        outcome_label = "error"
    now = time.time()
    with _lock:
        _audit_chain_checks[outcome_label] += 1
        _audit_chain_available = 0 if outcome_label == "error" else 1
        _audit_chain_valid = 1 if outcome_label == "valid" else 0
        _audit_chain_rows = max(0, int(row_count or 0))
        _audit_chain_last_check_timestamp = now
        if outcome_label == "valid":
            _audit_chain_last_valid_timestamp = now
        _audit_chain_check_duration_seconds += max(0.0, float(duration_seconds))


def record_audit_checkpoint(outcome: object) -> None:
    global _audit_checkpoint_last_success_timestamp
    outcome_label = _safe_label(outcome, "error")
    if outcome_label not in {"success", "error"}:
        outcome_label = "error"
    with _lock:
        _audit_checkpoints[outcome_label] += 1
        if outcome_label == "success":
            _audit_checkpoint_last_success_timestamp = time.time()


def _escape_label(value: object) -> str:
    return str(value).replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')


def _format_number(value: object) -> str:
    number = float(value)
    if math.isnan(number):
        return "NaN"
    if math.isinf(number):
        return "+Inf" if number > 0 else "-Inf"
    if number.is_integer():
        return str(int(number))
    return format(number, ".12g")


def _sample(name: str, value: object, labels: dict[str, object] | None = None) -> str:
    if labels:
        rendered_labels = ",".join(
            f'{key}="{_escape_label(label_value)}"'
            for key, label_value in sorted(labels.items())
        )
        return f"{name}{{{rendered_labels}}} {_format_number(value)}"
    return f"{name} {_format_number(value)}"


def _metric_header(lines: list[str], name: str, help_text: str, metric_type: str) -> None:
    lines.append(f"# HELP {name} {help_text}")
    lines.append(f"# TYPE {name} {metric_type}")


def _parse_timestamp(value: object) -> float | None:
    if not isinstance(value, str) or len(value) > 128:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    timestamp = parsed.astimezone(timezone.utc).timestamp()
    return timestamp if timestamp > 0 else None


def _latest_backup_timestamp(backup_directory: Path) -> float | None:
    """Return the newest PostgreSQL backup whose manifest and hashes verify."""
    if not backup_directory.is_dir():
        return None
    latest = None
    candidates: list[tuple[str, Path]] = []
    try:
        scanner = os.scandir(backup_directory)
    except OSError:
        return None
    with scanner:
        for entry in itertools.islice(scanner, 10_000):
            if not entry.is_dir(follow_symlinks=False) or not entry.name.startswith("biddingflow-backup-"):
                continue
            candidates.append((entry.name, Path(entry.path) / "manifest.json"))
    for _name, manifest_path in sorted(candidates, reverse=True)[:8]:
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if manifest.get("format") != "biddingflow-pg-backup" or manifest.get("version") != 1:
                continue
            files = manifest.get("files")
            if not isinstance(files, list) or len(files) != int(manifest.get("fileCount", -1)):
                continue
            valid = True
            for item in files:
                relative = Path(str(item.get("relativePath") or ""))
                candidate = (manifest_path.parent / relative).resolve()
                if manifest_path.parent.resolve() not in candidate.parents:
                    valid = False
                    break
                if not candidate.is_file() or candidate.stat().st_size != int(item.get("sizeBytes", -1)):
                    valid = False
                    break
                digest = hashlib.sha256(candidate.read_bytes()).hexdigest()
                if not hmac.compare_digest(digest, str(item.get("sha256") or "")):
                    valid = False
                    break
            if not valid:
                continue
            created_at = manifest.get("createdAt")
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            continue
        timestamp = _parse_timestamp(created_at)
        if timestamp is not None and (latest is None or timestamp > latest):
            latest = timestamp
    return latest


def _restore_drill_timestamp(backup_directory: Path) -> float | None:
    """Verify a signed PostgreSQL restore-drill marker."""
    configured = str(os.environ.get("BIDDING_RESTORE_DRILL_STATE_FILE", "")).strip()
    state_path = Path(configured).resolve() if configured else backup_directory / "last-restore-drill.json"
    try:
        if not state_path.is_file() or state_path.stat().st_size > 64 * 1024:
            return None
        payload = json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None
    if payload.get("format") != "biddingflow-restore-drill" or payload.get("version") != 1:
        return None
    integrity = payload.get("integrity")
    hmac_key = str(os.environ.get("BIDDING_RESTORE_DRILL_HMAC_KEY", ""))
    if not isinstance(integrity, dict) or len(hmac_key.encode("utf-8")) < 32:
        return None
    unsigned = {key: value for key, value in payload.items() if key != "integrity"}
    material = json.dumps(
        unsigned, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")
    expected_hmac = hmac.new(hmac_key.encode("utf-8"), material, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(str(integrity.get("hmacSha256") or ""), expected_hmac):
        return None
    try:
        snapshot = Path(str(payload.get("snapshot") or "")).resolve(strict=True)
        if snapshot.parent != backup_directory.resolve() or not (snapshot / "manifest.json").is_file():
            return None
        if payload.get("databaseVerified") is not True or payload.get("filesVerified") is not True:
            return None
    except (OSError, ValueError, TypeError):
        return None
    timestamp = _parse_timestamp(payload.get("recordedAt"))
    if timestamp is None or timestamp > time.time() + 300:
        return None
    return timestamp


def refresh_operational_artifact_verification() -> dict[str, object]:
    """Perform expensive backup/restore verification and publish a small cache."""

    from backend.shared.helpers import database

    backup_raw = str(os.environ.get("BIDDING_BACKUP_DIR", "")).strip()
    backup_directory = Path(backup_raw).resolve() if backup_raw else Path("data/backups").resolve()
    configured_state = str(os.environ.get("BIDDING_RESTORE_DRILL_STATE_FILE", "")).strip()
    state_path = (
        Path(configured_state).resolve()
        if configured_state
        else backup_directory / "last-restore-drill.json"
    )
    result = {
        "backup_directory": str(backup_directory),
        "restore_state_file": str(state_path),
        "backup_timestamp": _latest_backup_timestamp(backup_directory),
        "restore_timestamp": _restore_drill_timestamp(backup_directory),
        "checked_at": time.time(),
    }
    with _lock:
        _artifact_verification_cache.update(result)
    return result


def _verified_artifact_timestamps(
    backup_directory: Path,
) -> tuple[float | None, float | None, float]:
    configured_state = str(os.environ.get("BIDDING_RESTORE_DRILL_STATE_FILE", "")).strip()
    state_path = (
        Path(configured_state).resolve()
        if configured_state
        else backup_directory / "last-restore-drill.json"
    )
    with _lock:
        if (
            _artifact_verification_cache["backup_directory"] != str(backup_directory)
            or _artifact_verification_cache["restore_state_file"] != str(state_path)
        ):
            return None, None, 0.0
        return (
            _artifact_verification_cache["backup_timestamp"],
            _artifact_verification_cache["restore_timestamp"],
            float(_artifact_verification_cache["checked_at"] or 0.0),
        )


async def monitor_operational_artifacts():
    """Refresh verified artifact metrics on a bounded background cadence."""

    try:
        interval = float(os.environ.get("OPERATIONAL_ARTIFACT_VERIFY_INTERVAL_SECONDS", "900"))
    except ValueError:
        interval = 900.0
    interval = min(86_400.0, max(60.0, interval))
    from backend.shared.async_io import run_blocking_io

    while True:
        try:
            await run_blocking_io(
                refresh_operational_artifact_verification,
                timeout_seconds=120.0,
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            # The cache remains unavailable/stale rather than claiming success.
            with _lock:
                _artifact_verification_cache.update(
                    {
                        "backup_timestamp": None,
                        "restore_timestamp": None,
                        "checked_at": time.time(),
                    }
                )
        await asyncio.sleep(interval)


def _filesystem_metrics() -> dict[str, Any]:
    from backend.shared.helpers import database

    now = time.time()
    backup_raw = str(os.environ.get("BIDDING_BACKUP_DIR", "")).strip()
    backup_directory = Path(backup_raw).resolve() if backup_raw else Path("data/backups").resolve()
    data_directory = Path(os.environ.get("BIDDING_DATA_DIR", "data")).resolve()
    connection = database.get_connection()
    try:
        database_bytes = int(
            connection.execute("SELECT pg_database_size(current_database())").fetchone()[0]
        )
        outbox = connection.execute(
            """SELECT COUNT(*),
                      COALESCE(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MIN(created_at))), 0)
               FROM websocket_events"""
        ).fetchone()
    finally:
        connection.close()
    pool_stats = database.pool_stats()
    result: dict[str, Any] = {
        "postgres_database_bytes": database_bytes,
        "postgres_pool": pool_stats,
        "websocket_outbox_rows": int(outbox[0] or 0),
        "websocket_outbox_oldest_seconds": float(outbox[1] or 0),
        "disk": {},
    }
    for volume, path in (("data", data_directory), ("backup", backup_directory)):
        try:
            usage = shutil.disk_usage(path)
        except OSError:
            continue
        result["disk"][volume] = {"free": usage.free, "total": usage.total}
    backup_timestamp, restore_timestamp, artifact_checked_at = _verified_artifact_timestamps(
        backup_directory
    )
    result.update(
        {
            "backup_timestamp": backup_timestamp,
            "backup_age": max(0.0, now - backup_timestamp) if backup_timestamp else None,
            "restore_timestamp": restore_timestamp,
            "restore_age": max(0.0, now - restore_timestamp) if restore_timestamp else None,
            "artifact_checked_at": artifact_checked_at,
        }
    )
    return result


def _pool_samples(lines: list[str]) -> None:
    from backend.shared.async_io import get_blocking_io_stats
    from backend.shared.cpu_io import get_cpu_io_stats
    from backend.shared.database_io import get_database_io_stats

    pools = {
        "blocking_io": get_blocking_io_stats(),
        "cpu": get_cpu_io_stats(),
        "database_read": get_database_io_stats()["read"],
        "database_write": get_database_io_stats()["write"],
    }
    gauges = ("in_flight", "queued", "capacity", "workers")
    counters = ("submitted", "completed", "rejected", "timed_out")
    for field in gauges:
        name = f"biddingflow_worker_pool_{field}"
        _metric_header(lines, name, f"Current worker-pool {field.replace('_', ' ')}.", "gauge")
        for pool, stats in sorted(pools.items()):
            lines.append(_sample(name, getattr(stats, field), {"pool": pool}))
    for field in counters:
        name = f"biddingflow_worker_pool_{field}_total"
        _metric_header(lines, name, f"Cumulative worker-pool {field.replace('_', ' ')}.", "counter")
        for pool, stats in sorted(pools.items()):
            lines.append(_sample(name, getattr(stats, field), {"pool": pool}))
    for field in ("queue_wait_seconds", "execution_seconds"):
        name = f"biddingflow_worker_pool_{field}_total"
        _metric_header(lines, name, f"Cumulative worker-pool {field.replace('_', ' ')}.", "counter")
        for pool, stats in sorted(pools.items()):
            lines.append(_sample(name, getattr(stats, field, 0.0), {"pool": pool}))


def render_prometheus(application: object | None = None) -> str:
    """Render a consistent Prometheus 0.0.4 snapshot."""
    with _lock:
        active_http = _active_http_requests
        http_requests = _http_requests.copy()
        http_rate_limited = _http_rate_limited.copy()
        http_duration_count = _http_duration_count.copy()
        http_duration_sum = _http_duration_sum.copy()
        http_duration_buckets = _http_duration_buckets.copy()
        db_operations = _database_operations.copy()
        db_busy = _database_busy.copy()
        db_duration_count = _database_duration_count.copy()
        db_duration_sum = _database_duration_sum.copy()
        db_duration_buckets = _database_duration_buckets.copy()
        db_phase_count = _database_phase_count.copy()
        db_phase_sum = _database_phase_sum.copy()
        db_phase_buckets = _database_phase_buckets.copy()
        db_phase_max = _database_phase_max.copy()
        document_worker = _document_worker.copy()
        document_wait_seconds = _document_worker_queue_wait_seconds
        document_duration_seconds = _document_worker_duration_seconds
        partner_lookup_requests = _partner_lookup_requests.copy()
        partner_upstreams = _partner_upstreams.copy()
        websocket = _websocket.copy()
        runtime_log_drop_count = _runtime_log_dropped
        audit_chain_checks = _audit_chain_checks.copy()
        audit_chain_available = _audit_chain_available
        audit_chain_valid = _audit_chain_valid
        audit_chain_rows = _audit_chain_rows
        audit_chain_last_check = _audit_chain_last_check_timestamp
        audit_chain_last_valid = _audit_chain_last_valid_timestamp
        audit_chain_duration = _audit_chain_check_duration_seconds
        audit_checkpoints = _audit_checkpoints.copy()
        audit_checkpoint_last_success = _audit_checkpoint_last_success_timestamp

    lines: list[str] = []
    _metric_header(lines, "biddingflow_process_start_time_seconds", "Unix time when this process started.", "gauge")
    lines.append(_sample("biddingflow_process_start_time_seconds", _PROCESS_STARTED_AT))
    _metric_header(lines, "biddingflow_process_id", "Operating-system process identifier for per-worker diagnostics.", "gauge")
    lines.append(_sample("biddingflow_process_id", os.getpid()))
    _metric_header(lines, "biddingflow_http_active_requests", "HTTP requests currently executing.", "gauge")
    lines.append(_sample("biddingflow_http_active_requests", active_http))
    _metric_header(lines, "biddingflow_http_requests_total", "Completed HTTP requests by code-owned endpoint and status.", "counter")
    for (method, route, status), value in sorted(http_requests.items()):
        lines.append(_sample("biddingflow_http_requests_total", value, {"method": method, "route": route, "status": status}))
    _metric_header(lines, "biddingflow_http_rate_limited_total", "HTTP 429 responses returned by the application.", "counter")
    for (method, route), value in sorted(http_rate_limited.items()):
        lines.append(_sample("biddingflow_http_rate_limited_total", value, {"method": method, "route": route}))
    _metric_header(lines, "biddingflow_http_request_duration_seconds", "HTTP request latency histogram.", "histogram")
    for method, route in sorted(http_duration_count):
        labels = {"method": method, "route": route}
        for upper_bound in _HTTP_DURATION_BUCKETS:
            lines.append(_sample("biddingflow_http_request_duration_seconds_bucket", http_duration_buckets[(method, route, upper_bound)], {**labels, "le": str(upper_bound)}))
        lines.append(_sample("biddingflow_http_request_duration_seconds_bucket", http_duration_count[(method, route)], {**labels, "le": "+Inf"}))
        lines.append(_sample("biddingflow_http_request_duration_seconds_sum", http_duration_sum[(method, route)], labels))
        lines.append(_sample("biddingflow_http_request_duration_seconds_count", http_duration_count[(method, route)], labels))

    _metric_header(lines, "biddingflow_database_operations_total", "Database lane operations by outcome.", "counter")
    for (lane, outcome), value in sorted(db_operations.items()):
        lines.append(_sample("biddingflow_database_operations_total", value, {"lane": lane, "outcome": outcome}))
    _metric_header(lines, "biddingflow_database_lock_timeout_total", "PostgreSQL lock or statement timeouts observed in bounded database lanes.", "counter")
    for lane, value in sorted(db_busy.items()):
        lines.append(_sample("biddingflow_database_lock_timeout_total", value, {"lane": lane}))
    _metric_header(lines, "biddingflow_database_operation_duration_seconds", "Database lane latency including executor queue wait.", "histogram")
    for lane in sorted(db_duration_count):
        for upper_bound in _DATABASE_DURATION_BUCKETS:
            lines.append(_sample("biddingflow_database_operation_duration_seconds_bucket", db_duration_buckets[(lane, upper_bound)], {"lane": lane, "le": str(upper_bound)}))
        lines.append(_sample("biddingflow_database_operation_duration_seconds_bucket", db_duration_count[lane], {"lane": lane, "le": "+Inf"}))
        lines.append(_sample("biddingflow_database_operation_duration_seconds_sum", db_duration_sum[lane], {"lane": lane}))
        lines.append(_sample("biddingflow_database_operation_duration_seconds_count", db_duration_count[lane], {"lane": lane}))

    _metric_header(lines, "biddingflow_database_phase_duration_seconds", "Internal database-path latency by bounded phase.", "histogram")
    for scope, phase, outcome in sorted(db_phase_count):
        labels = {"scope": scope, "phase": phase, "outcome": outcome}
        for upper_bound in _DATABASE_DURATION_BUCKETS:
            lines.append(_sample(
                "biddingflow_database_phase_duration_seconds_bucket",
                db_phase_buckets[(scope, phase, outcome, upper_bound)],
                {**labels, "le": str(upper_bound)},
            ))
        lines.append(_sample(
            "biddingflow_database_phase_duration_seconds_bucket",
            db_phase_count[(scope, phase, outcome)],
            {**labels, "le": "+Inf"},
        ))
        lines.append(_sample(
            "biddingflow_database_phase_duration_seconds_sum",
            db_phase_sum[(scope, phase, outcome)],
            labels,
        ))
        lines.append(_sample(
            "biddingflow_database_phase_duration_seconds_count",
            db_phase_count[(scope, phase, outcome)],
            labels,
        ))
        lines.append(_sample(
            "biddingflow_database_phase_duration_seconds_max",
            db_phase_max[(scope, phase, outcome)],
            labels,
        ))

    _pool_samples(lines)

    _metric_header(lines, "biddingflow_document_worker_active", "Document subprocess jobs currently active.", "gauge")
    lines.append(_sample("biddingflow_document_worker_active", document_worker["active"]))
    _metric_header(lines, "biddingflow_document_worker_queue_depth", "Document jobs currently waiting for a local slot.", "gauge")
    lines.append(_sample("biddingflow_document_worker_queue_depth", document_worker["waiting"]))
    for key in ("submitted", "completed", "rejected", "timed_out", "failed"):
        name = f"biddingflow_document_worker_{key}_total"
        _metric_header(lines, name, f"Cumulative document worker jobs {key.replace('_', ' ')}.", "counter")
        lines.append(_sample(name, document_worker[key]))
    _metric_header(lines, "biddingflow_document_worker_queue_wait_seconds_total", "Cumulative document-worker slot wait time.", "counter")
    lines.append(_sample("biddingflow_document_worker_queue_wait_seconds_total", document_wait_seconds))
    _metric_header(lines, "biddingflow_document_worker_duration_seconds_total", "Cumulative active document-worker job time.", "counter")
    lines.append(_sample("biddingflow_document_worker_duration_seconds_total", document_duration_seconds))

    _metric_header(lines, "biddingflow_partner_lookup_requests_total", "Partner lookup requests by bounded outcome; tenant attribution is emitted in structured logs.", "counter")
    for outcome, value in sorted(partner_lookup_requests.items()):
        lines.append(_sample("biddingflow_partner_lookup_requests_total", value, {"outcome": outcome}))
    _metric_header(lines, "biddingflow_partner_upstream_requests_total", "Partner upstream attempts by provider and bounded outcome.", "counter")
    for (upstream, outcome), value in sorted(partner_upstreams.items()):
        lines.append(_sample("biddingflow_partner_upstream_requests_total", value, {"upstream": upstream, "outcome": outcome}))

    _metric_header(lines, "biddingflow_websocket_active_connections", "Authenticated WebSocket connections currently open.", "gauge")
    lines.append(_sample("biddingflow_websocket_active_connections", websocket["active"]))
    for key in ("attempted", "connected", "disconnected", "reconnected"):
        name = f"biddingflow_websocket_{key}_total"
        _metric_header(lines, name, f"Cumulative WebSocket connections {key}.", "counter")
        lines.append(_sample(name, websocket[key]))
    _metric_header(lines, "biddingflow_websocket_rejected_total", "WebSocket handshakes or connections rejected by bounded reason.", "counter")
    for key, value in sorted(websocket.items()):
        if key.startswith("rejected:"):
            lines.append(_sample("biddingflow_websocket_rejected_total", value, {"reason": key.split(":", 1)[1]}))
    _metric_header(lines, "biddingflow_websocket_authentication_failures_total", "WebSocket authentication failures by bounded reason.", "counter")
    for key, value in sorted(websocket.items()):
        if key.startswith("auth_failed:"):
            lines.append(_sample("biddingflow_websocket_authentication_failures_total", value, {"reason": key.split(":", 1)[1]}))

    lag_ms = max(0.0, float(getattr(getattr(application, "state", None), "event_loop_lag_ms", 0.0) or 0.0))
    _metric_header(lines, "biddingflow_event_loop_lag_seconds", "Latest measured ASGI event-loop scheduling lag.", "gauge")
    lines.append(_sample("biddingflow_event_loop_lag_seconds", lag_ms / 1000.0))
    _metric_header(lines, "biddingflow_runtime_log_dropped_total", "Structured request log lines dropped because the bounded writer queue was full.", "counter")
    lines.append(_sample("biddingflow_runtime_log_dropped_total", runtime_log_drop_count))
    _metric_header(lines, "biddingflow_audit_chain_check_available", "Whether the latest audit-chain verification completed.", "gauge")
    lines.append(_sample("biddingflow_audit_chain_check_available", audit_chain_available))
    _metric_header(lines, "biddingflow_audit_chain_valid", "Whether the latest completed audit-chain verification was valid.", "gauge")
    lines.append(_sample("biddingflow_audit_chain_valid", audit_chain_valid))
    _metric_header(lines, "biddingflow_audit_chain_rows", "Rows inspected by the latest audit-chain verification.", "gauge")
    lines.append(_sample("biddingflow_audit_chain_rows", audit_chain_rows))
    _metric_header(lines, "biddingflow_audit_chain_checks_total", "Audit-chain checks by bounded outcome.", "counter")
    for outcome, value in sorted(audit_chain_checks.items()):
        lines.append(_sample("biddingflow_audit_chain_checks_total", value, {"outcome": outcome}))
    _metric_header(lines, "biddingflow_audit_chain_check_duration_seconds_total", "Cumulative audit-chain verification duration.", "counter")
    lines.append(_sample("biddingflow_audit_chain_check_duration_seconds_total", audit_chain_duration))
    _metric_header(lines, "biddingflow_audit_chain_last_check_timestamp_seconds", "Unix timestamp of the latest attempted audit-chain verification.", "gauge")
    lines.append(_sample("biddingflow_audit_chain_last_check_timestamp_seconds", audit_chain_last_check))
    _metric_header(lines, "biddingflow_audit_chain_last_valid_timestamp_seconds", "Unix timestamp of the latest valid audit-chain verification.", "gauge")
    lines.append(_sample("biddingflow_audit_chain_last_valid_timestamp_seconds", audit_chain_last_valid))
    _metric_header(lines, "biddingflow_audit_checkpoints_total", "Audit checkpoint exports by outcome.", "counter")
    for outcome, value in sorted(audit_checkpoints.items()):
        lines.append(_sample("biddingflow_audit_checkpoints_total", value, {"outcome": outcome}))
    _metric_header(lines, "biddingflow_audit_checkpoint_last_success_timestamp_seconds", "Unix timestamp of the latest local audit checkpoint export.", "gauge")
    lines.append(_sample("biddingflow_audit_checkpoint_last_success_timestamp_seconds", audit_checkpoint_last_success))

    filesystem_ok = 1
    try:
        filesystem = _filesystem_metrics()
    except (OSError, ValueError, TypeError):
        filesystem_ok = 0
        filesystem = {"postgres_database_bytes": 0, "postgres_pool": {}, "websocket_outbox_rows": 0, "websocket_outbox_oldest_seconds": 0, "disk": {}, "backup_timestamp": None, "backup_age": None, "restore_timestamp": None, "restore_age": None}
    _metric_header(lines, "biddingflow_metrics_filesystem_collection_success", "Whether filesystem-backed operational metrics were collected successfully.", "gauge")
    lines.append(_sample("biddingflow_metrics_filesystem_collection_success", filesystem_ok))
    _metric_header(lines, "biddingflow_operational_artifact_last_check_timestamp_seconds", "Unix timestamp of the latest full backup/restore artifact verification attempt.", "gauge")
    lines.append(_sample("biddingflow_operational_artifact_last_check_timestamp_seconds", filesystem.get("artifact_checked_at", 0)))
    _metric_header(lines, "biddingflow_postgres_database_bytes", "Current PostgreSQL database size.", "gauge")
    lines.append(_sample("biddingflow_postgres_database_bytes", filesystem["postgres_database_bytes"]))
    _metric_header(lines, "biddingflow_postgres_pool_value", "Psycopg pool statistics.", "gauge")
    for key, value in sorted(filesystem.get("postgres_pool", {}).items()):
        if isinstance(value, (int, float)):
            lines.append(_sample("biddingflow_postgres_pool_value", value, {"stat": key}))
    _metric_header(lines, "biddingflow_websocket_outbox_rows", "Durable websocket events awaiting retention cleanup.", "gauge")
    lines.append(_sample("biddingflow_websocket_outbox_rows", filesystem["websocket_outbox_rows"]))
    _metric_header(lines, "biddingflow_websocket_outbox_oldest_seconds", "Age of the oldest durable websocket event.", "gauge")
    lines.append(_sample("biddingflow_websocket_outbox_oldest_seconds", filesystem["websocket_outbox_oldest_seconds"]))
    _metric_header(lines, "biddingflow_disk_free_bytes", "Free bytes on managed runtime volumes.", "gauge")
    _metric_header(lines, "biddingflow_disk_total_bytes", "Total bytes on managed runtime volumes.", "gauge")
    for volume, usage in sorted(filesystem["disk"].items()):
        lines.append(_sample("biddingflow_disk_free_bytes", usage["free"], {"volume": volume}))
        lines.append(_sample("biddingflow_disk_total_bytes", usage["total"], {"volume": volume}))
    for prefix, timestamp_key, age_key in (("backup", "backup_timestamp", "backup_age"), ("restore_drill", "restore_timestamp", "restore_age")):
        available = filesystem[timestamp_key] is not None
        available_name = f"biddingflow_{prefix}_available"
        timestamp_name = f"biddingflow_{prefix}_last_success_timestamp_seconds"
        age_name = f"biddingflow_{prefix}_age_seconds"
        _metric_header(lines, available_name, f"Whether a verified {prefix.replace('_', ' ')} record is available.", "gauge")
        lines.append(_sample(available_name, 1 if available else 0))
        _metric_header(lines, timestamp_name, f"Unix timestamp of the latest verified {prefix.replace('_', ' ')}.", "gauge")
        lines.append(_sample(timestamp_name, filesystem[timestamp_key] or 0))
        _metric_header(lines, age_name, f"Age in seconds of the latest verified {prefix.replace('_', ' ')}.", "gauge")
        lines.append(_sample(age_name, filesystem[age_key] or 0))
    return "\n".join(lines) + "\n"


def _metrics_request_allowed(request: Request) -> bool:
    configured_networks = str(os.environ.get("METRICS_ALLOWED_CIDRS", "127.0.0.1/32,::1/128"))
    try:
        client = ipaddress.ip_address(get_client_ip(request))
        networks = tuple(
            ipaddress.ip_network(item.strip(), strict=False)
            for item in configured_networks.split(",")
            if item.strip()
        )
    except ValueError:
        return False
    if not networks or not any(client in network for network in networks):
        return False
    configured_token = str(os.environ.get("METRICS_BEARER_TOKEN", "")).strip()
    if not configured_token:
        return True
    authorization = str(request.headers.get("authorization", ""))
    scheme, _, supplied_token = authorization.partition(" ")
    return scheme.casefold() == "bearer" and secrets.compare_digest(configured_token, supplied_token.strip())


async def metrics_api(request: Request) -> Response:
    if str(os.environ.get("METRICS_ENABLED", "true")).strip().casefold() not in {"1", "true", "yes"}:
        return Response(status_code=404, headers={"Cache-Control": "no-store"})
    if not _metrics_request_allowed(request):
        return Response(status_code=403, headers={"Cache-Control": "no-store"})
    from backend.shared.async_io import (
        BlockingIOBusyError,
        BlockingIOTimeoutError,
        run_blocking_io,
    )

    try:
        payload = await run_blocking_io(
            render_prometheus,
            request.app,
            timeout_seconds=5.0,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return Response(
            status_code=503,
            headers={"Cache-Control": "no-store", "Retry-After": "1"},
        )
    return PlainTextResponse(
        payload,
        media_type="text/plain; version=0.0.4",
        headers={"Cache-Control": "no-store"},
    )


class ObservabilityMiddleware:
    """Measure HTTP traffic and emit bounded structured request events."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("path") == "/metrics":
            await self.app(scope, receive, send)
            return
        started = time.perf_counter()
        status_code = 500
        http_request_started()

        async def send_with_status(message):
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = int(message.get("status") or 500)
            await send(message)

        try:
            await self.app(scope, receive, send_with_status)
        finally:
            duration = time.perf_counter() - started
            route = route_label_from_scope(scope)
            http_request_finished(scope.get("method"), route, status_code, duration)
            try:
                from backend.shared.logging_utils import log_http_request

                log_http_request(
                    Request(scope),
                    method=scope.get("method"),
                    route=route,
                    status_code=status_code,
                    duration_seconds=duration,
                )
            except Exception:
                pass


def _reset_metrics_for_tests() -> None:
    global _active_http_requests, _document_worker_queue_wait_seconds, _document_worker_duration_seconds, _runtime_log_dropped
    global _audit_chain_available, _audit_chain_valid, _audit_chain_rows
    global _audit_chain_last_check_timestamp, _audit_chain_last_valid_timestamp
    global _audit_chain_check_duration_seconds, _audit_checkpoint_last_success_timestamp
    with _lock:
        _active_http_requests = 0
        _http_requests.clear()
        _http_rate_limited.clear()
        _http_duration_count.clear()
        _http_duration_sum.clear()
        _http_duration_buckets.clear()
        _database_operations.clear()
        _database_busy.clear()
        _database_duration_count.clear()
        _database_duration_sum.clear()
        _database_duration_buckets.clear()
        _document_worker.clear()
        _document_worker_queue_wait_seconds = 0.0
        _document_worker_duration_seconds = 0.0
        _partner_lookup_requests.clear()
        _partner_upstreams.clear()
        _websocket.clear()
        _recent_websocket_users.clear()
        _runtime_log_dropped = 0
        _audit_chain_checks.clear()
        _audit_chain_available = 0
        _audit_chain_valid = 0
        _audit_chain_rows = 0
        _audit_chain_last_check_timestamp = 0.0
        _audit_chain_last_valid_timestamp = 0.0
        _audit_chain_check_duration_seconds = 0.0
        _audit_checkpoints.clear()
        _audit_checkpoint_last_success_timestamp = 0.0
        _artifact_verification_cache.update(
            {
                "backup_directory": "",
                "restore_state_file": "",
                "backup_timestamp": None,
                "restore_timestamp": None,
                "checked_at": 0.0,
            }
        )
