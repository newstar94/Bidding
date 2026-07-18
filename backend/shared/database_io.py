"""Bounded, event-loop-safe execution lanes for synchronous database work."""

from __future__ import annotations

import time
from typing import Any, Callable

from backend.observability.metrics import record_database_operation
from backend.db.errors import DatabasePoolTimeout, OPERATIONAL_ERRORS
from backend.shared.async_io import (
    BlockingIOBusyError,
    BlockingIOStats,
    BlockingIOTimeoutError,
    _BlockingIOPool,
    _bounded_env_int,
)


_read_pool = _BlockingIOPool(
    workers=_bounded_env_int("DATABASE_READ_WORKERS", 4, 1, 16),
    queue_size=_bounded_env_int("DATABASE_READ_QUEUE", 16, 0, 128),
)

# SQLite permits concurrent readers but only one writer. Keeping one worker here
# prevents a herd of threads from blocking inside BEGIN IMMEDIATE/busy_timeout.
_write_lane = _BlockingIOPool(
    workers=1,
    queue_size=_bounded_env_int("DATABASE_WRITE_QUEUE", 32, 0, 256),
)


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
            **kwargs,
        )
    except BlockingIOBusyError:
        outcome = "rejected"
        raise
    except BlockingIOTimeoutError:
        outcome = "timed_out"
        raise
    except DatabasePoolTimeout as exc:
        outcome = "timed_out"
        raise BlockingIOTimeoutError(str(exc)) from exc
    except OPERATIONAL_ERRORS as exc:
        outcome = "error"
        busy = any(marker in str(exc).casefold() for marker in ("busy", "locked"))
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
    timeout_seconds: float | None = None,
    **kwargs: Any,
) -> Any:
    # Callers may only set a response deadline when their mutation contract is
    # idempotent. The worker is deliberately allowed to finish after an
    # awaiting request times out; a retry must use the same idempotency key.
    started = time.perf_counter()
    outcome = "ok"
    busy = False
    try:
        return await _write_lane.run(
            function,
            *args,
            timeout_seconds=timeout_seconds,
            **kwargs,
        )
    except BlockingIOBusyError:
        outcome = "rejected"
        raise
    except BlockingIOTimeoutError:
        outcome = "timed_out"
        raise
    except DatabasePoolTimeout as exc:
        outcome = "rejected"
        raise BlockingIOBusyError(str(exc)) from exc
    except OPERATIONAL_ERRORS as exc:
        outcome = "error"
        busy = any(marker in str(exc).casefold() for marker in ("busy", "locked"))
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
