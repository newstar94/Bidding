"""Low-cardinality process metrics for the AI gateway."""

from __future__ import annotations

from collections import Counter
import threading


_lock = threading.Lock()
_values = Counter()
_allowed = frozenset({
    "ai_requests_total",
    "ai_request_duration_seconds",
    "ai_tool_calls_total",
    "ai_tool_duration_seconds",
    "ai_tool_errors_total",
    "ai_input_tokens_total",
    "ai_output_tokens_total",
    "ai_quota_rejections_total",
    "ai_permission_denials_total",
    "ai_provider_errors_total",
    "ai_active_streams",
    "ai_feedback_total",
})


def increment(name: str, value: float = 1) -> None:
    if name not in _allowed:
        return
    with _lock:
        _values[name] += float(value)


def render_prometheus_lines() -> list[str]:
    with _lock:
        snapshot = dict(_values)
    lines = []
    for name in sorted(_allowed):
        metric_type = "gauge" if name == "ai_active_streams" else "counter"
        lines.append(f"# HELP {name} BiddingFlow AI gateway metric.")
        lines.append(f"# TYPE {name} {metric_type}")
        lines.append(f"{name} {snapshot.get(name, 0)}")
    return lines


def reset_for_tests() -> None:
    with _lock:
        _values.clear()
