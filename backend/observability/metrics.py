"""Low-cardinality Prometheus metrics for the BiddingFlow ASGI process.

The implementation deliberately uses only the Python standard library.  This
keeps the production dependency set small while still exposing Prometheus'
text format and the counters/gauges needed by the operations runbook.
"""

from __future__ import annotations

import asyncio
import base64
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
import sys
import threading
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from starlette.requests import Request
from starlette.responses import PlainTextResponse, Response

from backend.shared.client_ip import get_client_ip
from backend.ai.metrics import render_prometheus_lines
from backend.observability.recording import (
    DATABASE_DURATION_BUCKETS as _DATABASE_DURATION_BUCKETS,
    document_worker_acquired,
    document_worker_finished,
    document_worker_rejected,
    document_worker_wait_started,
    record_audit_chain_verification,
    record_audit_checkpoint,
    record_database_operation,
    record_database_phase,
    record_partner_lookup,
    record_partner_upstream,
    reset_recorded_metrics_for_tests,
    runtime_log_dropped,
    snapshot_recorded_metrics,
    websocket_attempted,
    websocket_authentication_failed,
    websocket_connected,
    websocket_disconnected,
    websocket_rejected,
)


_HTTP_DURATION_BUCKETS = (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0)
_SAFE_LABEL = re.compile(r"^[A-Za-z0-9_.:-]{1,96}$")
_PROCESS_STARTED_AT = time.time()
_lock = threading.Lock()

_active_http_requests = 0
_http_requests: Counter[tuple[str, str, str]] = Counter()
_http_rate_limited: Counter[tuple[str, str]] = Counter()
_http_duration_count: Counter[tuple[str, str]] = Counter()
_http_duration_sum: Counter[tuple[str, str]] = Counter()
_http_duration_buckets: Counter[tuple[str, str, float]] = Counter()
_turnstile_validations: Counter[tuple[str, str]] = Counter()


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


def record_turnstile_validation(action: object, outcome: object) -> None:
    """Record one low-cardinality bot-challenge outcome."""

    action_label = _safe_label(action)
    outcome_label = str(outcome or "unknown").strip().casefold()
    if outcome_label not in {"passed", "required", "invalid", "unavailable"}:
        outcome_label = "unknown"
    with _lock:
        _turnstile_validations[(action_label, outcome_label)] += 1


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
    if payload.get("format") != "biddingflow-restore-drill" or payload.get("version") != 2:
        return None
    integrity = payload.get("integrity")
    public_key_text = str(
        os.environ.get("BIDDING_RESTORE_DRILL_PUBLIC_KEY", "")
    ).strip()
    if (
        not isinstance(integrity, dict)
        or integrity.get("algorithm") != "Ed25519"
        or not public_key_text
    ):
        return None
    unsigned = {key: value for key, value in payload.items() if key != "integrity"}
    material = json.dumps(
        unsigned, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")
    try:
        public_key_bytes = base64.urlsafe_b64decode(
            public_key_text.encode("ascii")
        )
        signature = base64.urlsafe_b64decode(
            str(integrity.get("signature") or "").encode("ascii")
        )
        if len(public_key_bytes) != 32 or len(signature) != 64:
            return None
        Ed25519PublicKey.from_public_bytes(public_key_bytes).verify(
            signature,
            material,
        )
    except (InvalidSignature, TypeError, ValueError):
        return None
    try:
        snapshot = Path(str(payload.get("snapshot") or "")).resolve(strict=True)
        if snapshot.parent != backup_directory.resolve() or not (snapshot / "manifest.json").is_file():
            return None
        if payload.get("databaseVerified") is not True or payload.get("filesVerified") is not True:
            return None
        if float(payload.get("rpoSeconds", -1)) < 0 or float(
            payload.get("rtoSeconds", -1)
        ) < 0:
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
        queue_rows = connection.execute(
            """
            SELECT queue_name, status, row_count, oldest_seconds
            FROM (
                SELECT 'email' AS queue_name, status, COUNT(*) AS row_count,
                       COALESCE(
                           EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::bigint
                           - MIN(created_at),
                           0
                       ) AS oldest_seconds
                FROM email_delivery_status
                GROUP BY status
                UNION ALL
                SELECT 'partner', status, COUNT(*),
                       COALESCE(
                           EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::bigint
                           - MIN(created_at),
                           0
                       )
                FROM partner_enrichment_jobs
                GROUP BY status
                UNION ALL
                SELECT 'document', status, COUNT(*),
                       COALESCE(
                           EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::bigint
                           - MIN(created_at),
                           0
                       )
                FROM document_jobs
                GROUP BY status
            ) AS queue_state
            """
        ).fetchall()
        upstream_health = connection.execute(
            """
            SELECT upstream,
                   CASE WHEN opened_until >
                       EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::bigint
                   THEN 1 ELSE 0 END
            FROM partner_upstream_health
            """
        ).fetchall()
        postgres_stats = connection.execute(
            """
            SELECT deadlocks, conflicts, temp_files, temp_bytes,
                   xact_commit, xact_rollback
            FROM pg_stat_database
            WHERE datname = current_database()
            """
        ).fetchone()
        waiting_locks = connection.execute(
            "SELECT COUNT(*) FROM pg_locks WHERE NOT granted"
        ).fetchone()[0]
        active_websocket_leases = connection.execute(
            """
            SELECT COUNT(*)
            FROM websocket_connection_leases
            WHERE expires_at > EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::bigint
            """
        ).fetchone()[0]
        wal_bytes_row = connection.execute(
            "SELECT wal_bytes FROM pg_stat_wal"
        ).fetchone()
    finally:
        connection.close()
    pool_stats = database.pool_stats()
    result: dict[str, Any] = {
        "postgres_database_bytes": database_bytes,
        "postgres_pool": pool_stats,
        "websocket_outbox_rows": int(outbox[0] or 0),
        "websocket_outbox_oldest_seconds": float(outbox[1] or 0),
        "websocket_cluster_active_connections": int(
            active_websocket_leases or 0
        ),
        "background_jobs": {
            (str(row[0]), str(row[1])): {
                "count": int(row[2] or 0),
                "oldest_seconds": max(0.0, float(row[3] or 0)),
            }
            for row in queue_rows
        },
        "partner_upstream_open": {
            str(row[0]): int(row[1] or 0) for row in upstream_health
        },
        "postgres_stats": {
            key: int(value or 0)
            for key, value in zip(
                (
                    "deadlocks",
                    "conflicts",
                    "temp_files",
                    "temp_bytes",
                    "xact_commit",
                    "xact_rollback",
                ),
                postgres_stats or (0, 0, 0, 0, 0, 0),
            )
        },
        "postgres_waiting_locks": int(waiting_locks or 0),
        "postgres_wal_bytes": int(
            (wal_bytes_row[0] if wal_bytes_row else 0) or 0
        ),
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


def _process_resource_metrics() -> dict[str, float]:
    resident_bytes = 0
    open_descriptors = 0
    if os.name == "nt":
        try:
            import ctypes
            from ctypes import wintypes

            class _ProcessMemoryCounters(ctypes.Structure):
                _fields_ = [
                    ("cb", wintypes.DWORD),
                    ("PageFaultCount", wintypes.DWORD),
                    ("PeakWorkingSetSize", ctypes.c_size_t),
                    ("WorkingSetSize", ctypes.c_size_t),
                    ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                    ("PagefileUsage", ctypes.c_size_t),
                    ("PeakPagefileUsage", ctypes.c_size_t),
                ]

            process = ctypes.windll.kernel32.GetCurrentProcess()
            counters = _ProcessMemoryCounters()
            counters.cb = ctypes.sizeof(counters)
            if ctypes.windll.psapi.GetProcessMemoryInfo(
                process,
                ctypes.byref(counters),
                counters.cb,
            ):
                resident_bytes = int(counters.WorkingSetSize)
            handle_count = wintypes.DWORD()
            if ctypes.windll.kernel32.GetProcessHandleCount(
                process,
                ctypes.byref(handle_count),
            ):
                open_descriptors = int(handle_count.value)
        except (AttributeError, OSError, TypeError, ValueError):
            pass
    else:
        try:
            import resource

            maximum_rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            resident_bytes = int(
                maximum_rss if sys.platform == "darwin" else maximum_rss * 1024
            )
        except (ImportError, OSError, ValueError):
            pass
        try:
            open_descriptors = sum(1 for _ in Path("/proc/self/fd").iterdir())
        except OSError:
            pass
    return {
        "cpu_seconds": max(0.0, time.process_time()),
        "resident_memory_bytes": max(0, resident_bytes),
        "open_descriptors": max(0, open_descriptors),
    }


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
    recorded_metrics = snapshot_recorded_metrics()
    with _lock:
        active_http = _active_http_requests
        http_requests = _http_requests.copy()
        http_rate_limited = _http_rate_limited.copy()
        http_duration_count = _http_duration_count.copy()
        http_duration_sum = _http_duration_sum.copy()
        http_duration_buckets = _http_duration_buckets.copy()
        turnstile_validations = _turnstile_validations.copy()

    db_operations = recorded_metrics.database_operations
    db_busy = recorded_metrics.database_busy
    db_duration_count = recorded_metrics.database_duration_count
    db_duration_sum = recorded_metrics.database_duration_sum
    db_duration_buckets = recorded_metrics.database_duration_buckets
    db_phase_count = recorded_metrics.database_phase_count
    db_phase_sum = recorded_metrics.database_phase_sum
    db_phase_buckets = recorded_metrics.database_phase_buckets
    db_phase_max = recorded_metrics.database_phase_max
    runtime_log_drop_count = recorded_metrics.runtime_log_dropped
    document_worker = recorded_metrics.document_worker
    document_wait_seconds = recorded_metrics.document_worker_queue_wait_seconds
    document_duration_seconds = recorded_metrics.document_worker_duration_seconds
    partner_lookup_requests = recorded_metrics.partner_lookup_requests
    partner_upstreams = recorded_metrics.partner_upstreams
    websocket = recorded_metrics.websocket
    audit_chain_checks = recorded_metrics.audit_chain_checks
    audit_chain_available = recorded_metrics.audit_chain_available
    audit_chain_valid = recorded_metrics.audit_chain_valid
    audit_chain_rows = recorded_metrics.audit_chain_rows
    audit_chain_last_check = recorded_metrics.audit_chain_last_check_timestamp
    audit_chain_last_valid = recorded_metrics.audit_chain_last_valid_timestamp
    audit_chain_duration = recorded_metrics.audit_chain_check_duration_seconds
    audit_checkpoints = recorded_metrics.audit_checkpoints
    audit_checkpoint_last_success = (
        recorded_metrics.audit_checkpoint_last_success_timestamp
    )

    lines: list[str] = []
    _metric_header(lines, "biddingflow_process_start_time_seconds", "Unix time when this process started.", "gauge")
    lines.append(_sample("biddingflow_process_start_time_seconds", _PROCESS_STARTED_AT))
    _metric_header(lines, "biddingflow_process_id", "Operating-system process identifier for per-worker diagnostics.", "gauge")
    lines.append(_sample("biddingflow_process_id", os.getpid()))
    process_resources = _process_resource_metrics()
    _metric_header(lines, "biddingflow_process_cpu_seconds_total", "Process CPU time consumed in seconds.", "counter")
    lines.append(_sample("biddingflow_process_cpu_seconds_total", process_resources["cpu_seconds"]))
    _metric_header(lines, "biddingflow_process_resident_memory_bytes", "Resident memory used by this process.", "gauge")
    lines.append(_sample("biddingflow_process_resident_memory_bytes", process_resources["resident_memory_bytes"]))
    _metric_header(lines, "biddingflow_process_open_descriptors", "Open file descriptors or operating-system handles held by this process.", "gauge")
    lines.append(_sample("biddingflow_process_open_descriptors", process_resources["open_descriptors"]))
    _metric_header(lines, "biddingflow_http_active_requests", "HTTP requests currently executing.", "gauge")
    lines.append(_sample("biddingflow_http_active_requests", active_http))
    _metric_header(lines, "biddingflow_http_requests_total", "Completed HTTP requests by code-owned endpoint and status.", "counter")
    for (method, route, status), value in sorted(http_requests.items()):
        lines.append(_sample("biddingflow_http_requests_total", value, {"method": method, "route": route, "status": status}))
    _metric_header(lines, "biddingflow_http_rate_limited_total", "HTTP 429 responses returned by the application.", "counter")
    for (method, route), value in sorted(http_rate_limited.items()):
        lines.append(_sample("biddingflow_http_rate_limited_total", value, {"method": method, "route": route}))
    _metric_header(lines, "biddingflow_turnstile_validations_total", "Turnstile validations by code-owned action and outcome.", "counter")
    for (action, outcome), value in sorted(turnstile_validations.items()):
        lines.append(_sample("biddingflow_turnstile_validations_total", value, {"action": action, "outcome": outcome}))
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

    try:
        from backend.documents.award_result_excel_service import (
            validation_artifact_metrics,
        )

        artifact_metrics = validation_artifact_metrics()
    except (OSError, ValueError, TypeError):
        artifact_metrics = {
            "count": 0,
            "totalBytes": 0,
            "expiredCount": 0,
            "cleanupFailures": 0,
            "quotaRejections": 0,
        }
    for key, metric_name, help_text, metric_type in (
        ("count", "biddingflow_award_result_artifacts", "Validation artifacts currently stored.", "gauge"),
        ("totalBytes", "biddingflow_award_result_artifact_bytes", "Bytes used by validation artifacts.", "gauge"),
        ("expiredCount", "biddingflow_award_result_artifacts_expired", "Expired validation artifacts awaiting cleanup.", "gauge"),
        ("cleanupFailures", "biddingflow_award_result_artifact_cleanup_failures_total", "Validation artifact cleanup failures.", "counter"),
        ("quotaRejections", "biddingflow_award_result_artifact_quota_rejections_total", "Validation artifacts rejected by quota.", "counter"),
    ):
        _metric_header(lines, metric_name, help_text, metric_type)
        lines.append(_sample(metric_name, artifact_metrics[key]))

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
        filesystem = {"postgres_database_bytes": 0, "postgres_pool": {}, "websocket_outbox_rows": 0, "websocket_outbox_oldest_seconds": 0, "websocket_cluster_active_connections": 0, "background_jobs": {}, "partner_upstream_open": {}, "postgres_stats": {}, "postgres_waiting_locks": 0, "postgres_wal_bytes": 0, "disk": {}, "backup_timestamp": None, "backup_age": None, "restore_timestamp": None, "restore_age": None}
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
    _metric_header(lines, "biddingflow_websocket_cluster_active_connections", "Active WebSocket connection leases across the PostgreSQL-backed cluster.", "gauge")
    lines.append(_sample("biddingflow_websocket_cluster_active_connections", filesystem.get("websocket_cluster_active_connections", 0)))
    _metric_header(lines, "biddingflow_background_jobs", "Durable background jobs by bounded queue and status.", "gauge")
    _metric_header(lines, "biddingflow_background_job_oldest_seconds", "Age of the oldest durable background job by bounded queue and status.", "gauge")
    for (queue, status), state in sorted(filesystem.get("background_jobs", {}).items()):
        labels = {"queue": queue, "status": status}
        lines.append(_sample("biddingflow_background_jobs", state["count"], labels))
        lines.append(_sample("biddingflow_background_job_oldest_seconds", state["oldest_seconds"], labels))
    _metric_header(lines, "biddingflow_partner_upstream_circuit_open", "Whether the shared PostgreSQL circuit breaker is open for an upstream.", "gauge")
    for upstream, value in sorted(filesystem.get("partner_upstream_open", {}).items()):
        lines.append(_sample("biddingflow_partner_upstream_circuit_open", value, {"upstream": upstream}))
    _metric_header(lines, "biddingflow_postgres_stat", "Selected current-database PostgreSQL statistics.", "gauge")
    for stat, value in sorted(filesystem.get("postgres_stats", {}).items()):
        lines.append(_sample("biddingflow_postgres_stat", value, {"stat": stat}))
    _metric_header(lines, "biddingflow_postgres_waiting_locks", "PostgreSQL locks currently waiting for a grant.", "gauge")
    lines.append(_sample("biddingflow_postgres_waiting_locks", filesystem.get("postgres_waiting_locks", 0)))
    _metric_header(lines, "biddingflow_postgres_wal_bytes", "WAL bytes reported by pg_stat_wal since its last reset.", "gauge")
    lines.append(_sample("biddingflow_postgres_wal_bytes", filesystem.get("postgres_wal_bytes", 0)))
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
    lines.extend(render_prometheus_lines())
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
    global _active_http_requests
    with _lock:
        _active_http_requests = 0
        _http_requests.clear()
        _http_rate_limited.clear()
        _http_duration_count.clear()
        _http_duration_sum.clear()
        _http_duration_buckets.clear()
        _turnstile_validations.clear()
        _artifact_verification_cache.update(
            {
                "backup_directory": "",
                "restore_state_file": "",
                "backup_timestamp": None,
                "restore_timestamp": None,
                "checked_at": 0.0,
            }
        )
    reset_recorded_metrics_for_tests()
