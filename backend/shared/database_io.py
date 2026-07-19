"""Bounded, event-loop-safe execution lanes for synchronous database work."""

from __future__ import annotations

import time
from typing import Any, Callable

from backend.observability.metrics import (
    record_database_operation,
    record_database_phase,
)
from backend.db.db_helper import OperationalError
from backend.shared.async_io import (
    BlockingIOBusyError,
    BlockingIOStats,
    BlockingIOTimeoutError,
    _BlockingIOPool,
    _bounded_env_int,
)


_read_pool = _BlockingIOPool(
    workers=_bounded_env_int("DATABASE_READ_WORKERS", 8, 1, 16),
    queue_size=_bounded_env_int("DATABASE_READ_QUEUE", 64, 0, 128),
)

_write_lane = _BlockingIOPool(
    workers=_bounded_env_int("DATABASE_WRITE_WORKERS", 4, 1, 16),
    queue_size=_bounded_env_int("DATABASE_WRITE_QUEUE", 64, 0, 256),
)


def _record_executor_timing(lane: str):
    def record(queue_wait_seconds: float, execution_seconds: float) -> None:
        record_database_phase(lane, "executor_queue", queue_wait_seconds)
        record_database_phase(lane, "executor_execution", execution_seconds)

    return record


async def run_database_read(
    function: Callable[..., Any],
    *args: Any,
    timeout_seconds: float = 30.0,
    **kwargs: Any,
) -> Any:
    started = time.perf_counter()
    outcome = "ok"
    busy = False
    try:
        return await _read_pool.run(
            function,
            *args,
            timeout_seconds=timeout_seconds,
            timing_callback=_record_executor_timing("read"),
            **kwargs,
        )
    except BlockingIOBusyError:
        outcome = "rejected"
        raise
    except BlockingIOTimeoutError:
        outcome = "timed_out"
        raise
    except OperationalError as exc:
        outcome = "error"
        busy = getattr(exc, "sqlstate", None) in {"55P03", "57014"}
        raise
    except Exception:
        outcome = "error"
        raise
    finally:
        record_database_operation(
            "read",
            time.perf_counter() - started,
            outcome=outcome,
            busy=busy,
        )


async def run_database_write(
    function: Callable[..., Any],
    *args: Any,
    **kwargs: Any,
) -> Any:
    # A submitted mutation is allowed to finish. Returning a timeout while its
    # transaction can still commit would give clients an ambiguous result.
    started = time.perf_counter()
    outcome = "ok"
    busy = False
    try:
        return await _write_lane.run(
            function,
            *args,
            timeout_seconds=None,
            timing_callback=_record_executor_timing("write"),
            **kwargs,
        )
    except BlockingIOBusyError:
        outcome = "rejected"
        raise
    except OperationalError as exc:
        outcome = "error"
        busy = getattr(exc, "sqlstate", None) in {"55P03", "57014"}
        raise
    except Exception:
        outcome = "error"
        raise
    finally:
        record_database_operation(
            "write",
            time.perf_counter() - started,
            outcome=outcome,
            busy=busy,
        )


def get_database_io_stats() -> dict[str, BlockingIOStats]:
    return {
        "read": _read_pool.stats(),
        "write": _write_lane.stats(),
    }
