"""In-process metric recording without HTTP, database, or application imports.

Hot-path producers use this module instead of importing the Prometheus renderer.
The renderer consumes immutable snapshots through the same small interface.
"""

from __future__ import annotations

import re
import hashlib
import threading
import time
from collections import Counter, OrderedDict
from dataclasses import dataclass


DATABASE_DURATION_BUCKETS = (
    0.001,
    0.005,
    0.01,
    0.025,
    0.05,
    0.1,
    0.25,
    0.5,
    1.0,
    2.5,
    5.0,
    15.0,
    30.0,
)
_SAFE_LABEL = re.compile(r"^[A-Za-z0-9_.:-]{1,96}$")
_lock = threading.Lock()

_database_operations: Counter[tuple[str, str]] = Counter()
_database_busy: Counter[str] = Counter()
_database_duration_count: Counter[str] = Counter()
_database_duration_sum: Counter[str] = Counter()
_database_duration_buckets: Counter[tuple[str, float]] = Counter()
_database_phase_count: Counter[tuple[str, str, str]] = Counter()
_database_phase_sum: Counter[tuple[str, str, str]] = Counter()
_database_phase_buckets: Counter[tuple[str, str, str, float]] = Counter()
_database_phase_max: Counter[tuple[str, str, str]] = Counter()
_runtime_log_dropped = 0
_document_worker = Counter()
_document_worker_queue_wait_seconds = 0.0
_document_worker_duration_seconds = 0.0
_partner_lookup_requests = Counter()
_partner_upstreams = Counter()
_websocket = Counter()
_recent_websocket_users: OrderedDict[str, float] = OrderedDict()
_audit_chain_checks = Counter()
_audit_chain_available = 0
_audit_chain_valid = 0
_audit_chain_rows = 0
_audit_chain_last_check_timestamp = 0.0
_audit_chain_last_valid_timestamp = 0.0
_audit_chain_check_duration_seconds = 0.0
_audit_checkpoints = Counter()
_audit_checkpoint_last_success_timestamp = 0.0


@dataclass(frozen=True, slots=True)
class RecordedMetricSnapshot:
    database_operations: Counter[tuple[str, str]]
    database_busy: Counter[str]
    database_duration_count: Counter[str]
    database_duration_sum: Counter[str]
    database_duration_buckets: Counter[tuple[str, float]]
    database_phase_count: Counter[tuple[str, str, str]]
    database_phase_sum: Counter[tuple[str, str, str]]
    database_phase_buckets: Counter[tuple[str, str, str, float]]
    database_phase_max: Counter[tuple[str, str, str]]
    runtime_log_dropped: int
    document_worker: Counter[str]
    document_worker_queue_wait_seconds: float
    document_worker_duration_seconds: float
    partner_lookup_requests: Counter[str]
    partner_upstreams: Counter[tuple[str, str]]
    websocket: Counter[str]
    audit_chain_checks: Counter[str]
    audit_chain_available: int
    audit_chain_valid: int
    audit_chain_rows: int
    audit_chain_last_check_timestamp: float
    audit_chain_last_valid_timestamp: float
    audit_chain_check_duration_seconds: float
    audit_checkpoints: Counter[str]
    audit_checkpoint_last_success_timestamp: float


def _safe_label(value: object, fallback: str) -> str:
    text = str(value or "").strip()
    return text if _SAFE_LABEL.fullmatch(text) else fallback


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
        for upper_bound in DATABASE_DURATION_BUCKETS:
            if duration <= upper_bound:
                _database_duration_buckets[(lane_label, upper_bound)] += 1


def record_database_phase(
    scope: object,
    phase: object,
    duration_seconds: float,
    *,
    outcome: object = "ok",
) -> None:
    """Record a bounded internal latency phase without query or tenant labels."""

    scope_label = _safe_label(scope, "unknown")
    phase_label = _safe_label(phase, "unknown")
    outcome_label = _safe_label(outcome, "error")
    duration = max(0.0, float(duration_seconds))
    key = (scope_label, phase_label, outcome_label)
    with _lock:
        _database_phase_count[key] += 1
        _database_phase_sum[key] += duration
        _database_phase_max[key] = max(_database_phase_max[key], duration)
        for upper_bound in DATABASE_DURATION_BUCKETS:
            if duration <= upper_bound:
                _database_phase_buckets[(*key, upper_bound)] += 1


def runtime_log_dropped() -> None:
    global _runtime_log_dropped
    with _lock:
        _runtime_log_dropped += 1


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
    user_fingerprint = hashlib.sha256(
        str(user_id or "unknown").encode("utf-8")
    ).hexdigest()
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


def record_audit_chain_verification(
    outcome: object,
    duration_seconds: float,
    row_count: int,
) -> None:
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


def snapshot_recorded_metrics() -> RecordedMetricSnapshot:
    with _lock:
        return RecordedMetricSnapshot(
            database_operations=_database_operations.copy(),
            database_busy=_database_busy.copy(),
            database_duration_count=_database_duration_count.copy(),
            database_duration_sum=_database_duration_sum.copy(),
            database_duration_buckets=_database_duration_buckets.copy(),
            database_phase_count=_database_phase_count.copy(),
            database_phase_sum=_database_phase_sum.copy(),
            database_phase_buckets=_database_phase_buckets.copy(),
            database_phase_max=_database_phase_max.copy(),
            runtime_log_dropped=_runtime_log_dropped,
            document_worker=_document_worker.copy(),
            document_worker_queue_wait_seconds=_document_worker_queue_wait_seconds,
            document_worker_duration_seconds=_document_worker_duration_seconds,
            partner_lookup_requests=_partner_lookup_requests.copy(),
            partner_upstreams=_partner_upstreams.copy(),
            websocket=_websocket.copy(),
            audit_chain_checks=_audit_chain_checks.copy(),
            audit_chain_available=_audit_chain_available,
            audit_chain_valid=_audit_chain_valid,
            audit_chain_rows=_audit_chain_rows,
            audit_chain_last_check_timestamp=_audit_chain_last_check_timestamp,
            audit_chain_last_valid_timestamp=_audit_chain_last_valid_timestamp,
            audit_chain_check_duration_seconds=_audit_chain_check_duration_seconds,
            audit_checkpoints=_audit_checkpoints.copy(),
            audit_checkpoint_last_success_timestamp=(
                _audit_checkpoint_last_success_timestamp
            ),
        )


def reset_recorded_metrics_for_tests() -> None:
    global _runtime_log_dropped
    global _document_worker_queue_wait_seconds, _document_worker_duration_seconds
    global _audit_chain_available, _audit_chain_valid, _audit_chain_rows
    global _audit_chain_last_check_timestamp, _audit_chain_last_valid_timestamp
    global _audit_chain_check_duration_seconds, _audit_checkpoint_last_success_timestamp
    with _lock:
        _database_operations.clear()
        _database_busy.clear()
        _database_duration_count.clear()
        _database_duration_sum.clear()
        _database_duration_buckets.clear()
        _database_phase_count.clear()
        _database_phase_sum.clear()
        _database_phase_buckets.clear()
        _database_phase_max.clear()
        _runtime_log_dropped = 0
        _document_worker.clear()
        _document_worker_queue_wait_seconds = 0.0
        _document_worker_duration_seconds = 0.0
        _partner_lookup_requests.clear()
        _partner_upstreams.clear()
        _websocket.clear()
        _recent_websocket_users.clear()
        _audit_chain_checks.clear()
        _audit_chain_available = 0
        _audit_chain_valid = 0
        _audit_chain_rows = 0
        _audit_chain_last_check_timestamp = 0.0
        _audit_chain_last_valid_timestamp = 0.0
        _audit_chain_check_duration_seconds = 0.0
        _audit_checkpoints.clear()
        _audit_checkpoint_last_success_timestamp = 0.0
