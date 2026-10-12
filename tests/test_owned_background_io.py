import asyncio
import threading

import pytest

from backend.shared import async_io, database_io


@pytest.mark.parametrize("kind,outcome", [
    (kind, outcome) for kind in ("blocking", "read", "write")
    for outcome in ("cancel", "timeout", "error", "cancel-error", "timeout-error")
    if kind != "write" or not outcome.startswith("timeout")
])
def test_owned_submission_finishes_before_propagating_outcome(monkeypatch, kind, outcome):
    started, release, completed = threading.Event(), threading.Event(), threading.Event()
    pool = async_io._BlockingIOPool(1, 0)
    selected_lanes = []
    if kind == "blocking":
        monkeypatch.setattr(async_io, "_lane_pool", lambda lane: selected_lanes.append(lane) or pool)
        operation = getattr(async_io, "run_owned_blocking_io", async_io.run_blocking_io)
        kwargs = {"timeout_seconds": 0.1 if outcome.startswith("timeout") else 5, "lane": "billing"}
    elif kind == "read":
        monkeypatch.setattr(database_io, "_read_pool", pool)
        operation = getattr(database_io, "run_owned_database_read", database_io.run_database_read)
        kwargs = {"timeout_seconds": 0.1 if outcome.startswith("timeout") else 5}
    else:
        monkeypatch.setattr(database_io, "_write_lane", pool)
        operation = getattr(database_io, "run_owned_database_write", database_io.run_database_write)
        kwargs = {}

    def work():
        started.set()
        try:
            assert release.wait(3)
            if outcome in {"error", "cancel-error", "timeout-error"}:
                raise ValueError("worker-error")
            return "done"
        finally:
            completed.set()

    async def scenario():
        task = asyncio.create_task(operation(work, **kwargs))
        assert await asyncio.to_thread(started.wait, 2)
        try:
            if outcome in {"cancel", "cancel-error"}:
                task.cancel()
                await asyncio.sleep(0)
                task.cancel()
            await asyncio.wait({task}, timeout=0.15)
            assert not task.done(), "owner returned before the synchronous operation finished"
            assert pool.stats().in_flight == 1
        finally:
            release.set()
            expected = {"cancel": asyncio.CancelledError, "cancel-error": asyncio.CancelledError,
                        "timeout": async_io.BlockingIOTimeoutError,
                        "timeout-error": async_io.BlockingIOTimeoutError, "error": ValueError}[outcome]
            with pytest.raises(expected):
                await task
        assert completed.is_set()
        assert pool.stats().in_flight == 0
        assert pool.stats().timed_out == int(outcome.startswith("timeout"))
        if kind == "blocking":
            assert selected_lanes == ["billing"]

    try:
        asyncio.run(scenario())
    finally:
        release.set()
        pool._executor.shutdown(wait=True)
