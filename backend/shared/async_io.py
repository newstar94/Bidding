"""Bounded executor for short blocking operations called by async routes."""

from __future__ import annotations

import asyncio
import functools
import os
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any, Callable


class BlockingIOBusyError(RuntimeError):
    """The bounded blocking-I/O queue has no free capacity."""


class BlockingIOTimeoutError(TimeoutError):
    """A blocking operation did not complete within its route deadline."""


def _bounded_env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return min(maximum, max(minimum, value))


@dataclass(frozen=True)
class BlockingIOStats:
    in_flight: int
    queued: int
    submitted: int
    completed: int
    rejected: int
    timed_out: int
    capacity: int
    workers: int


class _BlockingIOPool:
    def __init__(self, workers: int, queue_size: int):
        self.workers = max(1, int(workers))
        self.queue_size = max(0, int(queue_size))
        self.capacity = self.workers + self.queue_size
        self._executor = ThreadPoolExecutor(
            max_workers=self.workers,
            thread_name_prefix="bidding-io",
        )
        self._slots = threading.BoundedSemaphore(self.capacity)
        self._lock = threading.Lock()
        self._in_flight = 0
        self._submitted = 0
        self._completed = 0
        self._rejected = 0
        self._timed_out = 0

    def _mark_rejected(self) -> None:
        with self._lock:
            self._rejected += 1

    def _mark_submitted(self) -> None:
        with self._lock:
            self._submitted += 1
            self._in_flight += 1

    def _mark_timed_out(self) -> None:
        with self._lock:
            self._timed_out += 1

    def _complete(self, future: Future[Any]) -> None:
        # Retrieve worker exceptions even if the awaiting request already timed out.
        if not future.cancelled():
            try:
                future.exception()
            except Exception:
                pass
        with self._lock:
            self._completed += 1
            self._in_flight = max(0, self._in_flight - 1)
        self._slots.release()

    async def run(
        self,
        function: Callable[..., Any],
        *args: Any,
        timeout_seconds: float,
        **kwargs: Any,
    ) -> Any:
        if not self._slots.acquire(blocking=False):
            self._mark_rejected()
            raise BlockingIOBusyError(
                "Hệ thống đang xử lý quá nhiều tác vụ mạng hoặc tệp."
            )
        self._mark_submitted()
        try:
            future = self._executor.submit(
                functools.partial(function, *args, **kwargs)
            )
        except Exception:
            self._complete(Future())
            raise
        future.add_done_callback(self._complete)
        try:
            return await asyncio.wait_for(
                asyncio.wrap_future(future),
                timeout=max(0.1, min(120.0, float(timeout_seconds))),
            )
        except asyncio.TimeoutError as exc:
            self._mark_timed_out()
            raise BlockingIOTimeoutError(
                "Tác vụ mạng hoặc tệp đã vượt quá thời gian cho phép."
            ) from exc

    def stats(self) -> BlockingIOStats:
        with self._lock:
            return BlockingIOStats(
                in_flight=self._in_flight,
                queued=max(0, self._in_flight - self.workers),
                submitted=self._submitted,
                completed=self._completed,
                rejected=self._rejected,
                timed_out=self._timed_out,
                capacity=self.capacity,
                workers=self.workers,
            )


_pool = _BlockingIOPool(
    workers=_bounded_env_int("BLOCKING_IO_MAX_WORKERS", 8, 2, 32),
    queue_size=_bounded_env_int("BLOCKING_IO_MAX_QUEUE", 16, 0, 128),
)


async def run_blocking_io(
    function: Callable[..., Any],
    *args: Any,
    timeout_seconds: float = 15.0,
    **kwargs: Any,
) -> Any:
    return await _pool.run(
        function,
        *args,
        timeout_seconds=timeout_seconds,
        **kwargs,
    )


def get_blocking_io_stats() -> BlockingIOStats:
    return _pool.stats()
