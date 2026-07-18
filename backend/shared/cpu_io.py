"""Bounded worker pool for PBKDF2 and other short CPU-heavy route work."""

from __future__ import annotations

from typing import Any, Callable

from backend.shared.async_io import BlockingIOStats, _BlockingIOPool, _bounded_env_int


_cpu_pool = _BlockingIOPool(
    workers=_bounded_env_int("CPU_WORKER_COUNT", 2, 1, 8),
    queue_size=_bounded_env_int("CPU_WORKER_QUEUE", 8, 0, 64),
)


async def run_cpu_bound(
    function: Callable[..., Any],
    *args: Any,
    timeout_seconds: float = 30.0,
    **kwargs: Any,
) -> Any:
    return await _cpu_pool.run(
        function,
        *args,
        timeout_seconds=timeout_seconds,
        **kwargs,
    )


def get_cpu_io_stats() -> BlockingIOStats:
    return _cpu_pool.stats()
