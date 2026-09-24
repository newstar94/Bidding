from pathlib import Path
import subprocess
import sys

import pytest


@pytest.mark.parametrize("mode", ["shutdown", "transient"])
def test_submit_failure_releases_capacity_without_hanging(mode):
    # An asyncio deadline cannot stop synchronous deadlock in the event loop.
    # A bounded child process makes the original bug a deterministic failure.
    scenario = '''
import asyncio
from backend.shared.async_io import _BlockingIOPool

pool = _BlockingIOPool(1, 0)
original_submit = pool._executor.submit
if MODE == 'shutdown':
    pool._executor.shutdown()
else:
    def fail_submit(*args, **kwargs):
        raise RuntimeError('submission rejected')
    pool._executor.submit = fail_submit
async def run():
    for _ in range(3):
        try:
            await pool.run(lambda: 1, timeout_seconds=.1)
        except RuntimeError:
            pass
        else:
            raise AssertionError('submission must fail')
        stats = pool.stats()
        assert stats.in_flight == 0
        assert stats.submitted == stats.completed
        assert stats.rejected == 0
        assert pool._slots.acquire(blocking=False)
        pool._slots.release()
    if MODE == 'transient':
        pool._executor.submit = original_submit
        assert await pool.run(lambda: 42, timeout_seconds=1) == 42
        assert pool.stats().in_flight == 0
try:
    asyncio.run(run())
finally:
    pool._executor.shutdown()
'''
    result = subprocess.run(
        [sys.executable, "-B", "-c", f"MODE = {mode!r}\n" + scenario],
        cwd=Path(__file__).resolve().parents[1],
        capture_output=True, text=True, timeout=5,
    )
    assert result.returncode == 0, result.stdout + result.stderr
