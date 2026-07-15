"""Bounded streaming of multipart uploads to private temporary files."""

from __future__ import annotations

import os
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path


@asynccontextmanager
async def spooled_upload(upload, *, max_bytes: int, suffix: str = ""):
    directory = os.environ.get("DOCUMENT_WORKER_TEMP_DIR") or None
    if directory:
        Path(directory).mkdir(parents=True, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(
        mode="w+b", suffix=suffix, prefix="biddingflow-upload-",
        dir=directory, delete=False,
    )
    path = Path(handle.name)
    size = 0
    head = b""
    one_shot_reader = False
    try:
        while True:
            try:
                chunk = await upload.read(64 * 1024)
            except TypeError:  # Small test doubles and older UploadFile adapters.
                chunk = await upload.read()
                one_shot_reader = True
            if not chunk:
                break
            size += len(chunk)
            if size > max_bytes:
                raise ValueError(f"Tệp tải lên vượt quá giới hạn {max_bytes} byte")
            if len(head) < 16:
                head += chunk[:16 - len(head)]
            handle.write(chunk)
            if one_shot_reader:
                break
        handle.flush()
        os.fsync(handle.fileno())
        handle.close()
        yield path, size, head
    finally:
        if not handle.closed:
            handle.close()
        path.unlink(missing_ok=True)
