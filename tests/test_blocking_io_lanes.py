import asyncio
from threading import Event

import pytest

import backend.shared.async_io as async_io


def test_bounded_lane_rejects_excess_work_without_saturating_another_lane(monkeypatch):
    monkeypatch.setenv("BLOCKING_IO_TESTHOT_MAX_WORKERS", "1")
    monkeypatch.setenv("BLOCKING_IO_TESTHOT_MAX_QUEUE", "0")
    monkeypatch.setenv("BLOCKING_IO_TESTFAST_MAX_WORKERS", "1")
    monkeypatch.setenv("BLOCKING_IO_TESTFAST_MAX_QUEUE", "0")
    async_io._lanes.pop("testhot", None)
    async_io._lanes.pop("testfast", None)
    started = Event()
    release = Event()

    def blocking():
        started.set()
        release.wait(2)
        return "done"

    async def scenario():
        hot = asyncio.create_task(
            async_io.run_blocking_io(blocking, lane="testhot", timeout_seconds=2)
        )
        while not started.is_set():
            await asyncio.sleep(0)
        with pytest.raises(async_io.BlockingIOBusyError):
            await async_io.run_blocking_io(
                lambda: "overflow", lane="testhot", timeout_seconds=1
            )
        fast = await async_io.run_blocking_io(
            lambda: "responsive", lane="testfast", timeout_seconds=1
        )
        release.set()
        assert await hot == "done"
        return fast

    try:
        assert asyncio.run(scenario()) == "responsive"
        stats = async_io.get_blocking_io_lane_stats()
        assert stats["testhot"].rejected == 1
        assert stats["testfast"].completed == 1
    finally:
        release.set()
