import asyncio
import tracemalloc

import pytest

from backend.documents.upload_spooling import spooled_upload


class StreamingUpload:
    def __init__(self, total_bytes, chunk_size=64 * 1024):
        self.remaining = total_bytes
        self.chunk = b"x" * chunk_size

    async def read(self, requested):
        if self.remaining <= 0:
            return b""
        size = min(requested, self.remaining)
        self.remaining -= size
        return self.chunk[:size]


@pytest.mark.anyio
async def test_concurrent_large_uploads_are_spooled_with_bounded_memory(monkeypatch, tmp_path):
    monkeypatch.setenv("DOCUMENT_WORKER_TEMP_DIR", str(tmp_path))

    async def consume():
        async with spooled_upload(StreamingUpload(8 * 1024 * 1024), max_bytes=9 * 1024 * 1024) as (_path, size, _head):
            assert size == 8 * 1024 * 1024
            await asyncio.sleep(0)

    tracemalloc.start()
    await asyncio.gather(*(consume() for _ in range(8)))
    _current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    assert peak < 8 * 1024 * 1024
    assert list(tmp_path.iterdir()) == []
