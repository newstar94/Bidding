"""Bounded, content-addressed cache for immutable standardized Word templates.

Only template bytes and version attestations are stored here. Record context,
user data and mutable ``DocxTemplate`` objects must never cross this boundary.
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
import time
import uuid

from backend.documents.word_standardizer import (
    automatic_standardization_cache_identity,
)
from backend.shared.paths import resolve_runtime_path


CACHE_FORMAT = "biddingflow-word-template-cache"
CACHE_VERSION = 1


@dataclass
class StandardizedTemplateCacheLease:
    key: str
    identity: dict
    content_path: Path
    metadata_path: Path
    lock_path: Path
    descriptor: int
    released: bool = False


def _bounded_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return min(maximum, max(minimum, value))


def _canonical(value) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("ascii")


def _sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _cache_root() -> Path:
    root = resolve_runtime_path("BIDDING_WORD_EXPORT_CACHE_DIR").resolve()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    return root


def _cache_key(
    source: bytes,
    *,
    organization_scope: str,
    document_type_hint: str | None,
    mode: str | None,
) -> tuple[str, dict]:
    identity = {
        "cacheVersion": CACHE_VERSION,
        "organizationScope": str(organization_scope or "unscoped"),
        "sourceSha256": _sha256(source),
        **automatic_standardization_cache_identity(
            document_type_hint=document_type_hint,
            mode=mode,
        ),
    }
    return _sha256(_canonical(identity)), identity


def _paths(root: Path, key: str) -> tuple[Path, Path, Path]:
    shard = root / key[:2]
    shard.mkdir(parents=True, exist_ok=True, mode=0o700)
    return shard / f"{key}.docx", shard / f"{key}.json", shard / f"{key}.lock"


def _load(content_path: Path, metadata_path: Path, key: str, identity: dict) -> bytes | None:
    try:
        metadata = json.loads(metadata_path.read_text(encoding="ascii"))
        if (
            metadata.get("format") != CACHE_FORMAT
            or metadata.get("version") != CACHE_VERSION
            or metadata.get("key") != key
            or metadata.get("identity") != identity
        ):
            return None
        content = content_path.read_bytes()
        if (
            len(content) != int(metadata.get("sizeBytes") or -1)
            or _sha256(content) != metadata.get("outputSha256")
        ):
            return None
        try:
            os.utime(metadata_path, None)
        except OSError:
            pass
        return content
    except (FileNotFoundError, OSError, TypeError, ValueError, json.JSONDecodeError):
        return None


def _acquire_lock(lock_path: Path) -> int | None:
    wait_seconds = _bounded_int("WORD_EXPORT_CACHE_LOCK_SECONDS", 30, 1, 120)
    stale_seconds = max(60, wait_seconds * 3)
    deadline = time.monotonic() + wait_seconds
    while time.monotonic() < deadline:
        try:
            descriptor = os.open(
                lock_path,
                os.O_CREAT | os.O_EXCL | os.O_WRONLY,
                0o600,
            )
            os.write(descriptor, f"{os.getpid()}:{time.time_ns()}".encode("ascii"))
            return descriptor
        except (FileExistsError, PermissionError):
            # On Windows another thread closing and unlinking this exact lock
            # can transiently surface as EACCES instead of EEXIST. Treat that
            # state as ordinary lock contention and retry within the bound.
            try:
                if time.time() - lock_path.stat().st_mtime > stale_seconds:
                    lock_path.unlink(missing_ok=True)
                    continue
            except OSError:
                pass
            time.sleep(0.05)
    return None


def _store(
    content_path: Path,
    metadata_path: Path,
    *,
    key: str,
    identity: dict,
    content: bytes,
) -> None:
    nonce = uuid.uuid4().hex
    temporary_content = content_path.with_name(f".{content_path.name}.{nonce}.tmp")
    temporary_metadata = metadata_path.with_name(f".{metadata_path.name}.{nonce}.tmp")
    metadata = {
        "format": CACHE_FORMAT,
        "version": CACHE_VERSION,
        "key": key,
        "identity": identity,
        "sizeBytes": len(content),
        "outputSha256": _sha256(content),
        "preservation": "PASS",
        "validatedInSandbox": True,
        "createdAt": int(time.time()),
    }
    try:
        temporary_content.write_bytes(content)
        temporary_content.chmod(0o600)
        temporary_metadata.write_bytes(_canonical(metadata))
        temporary_metadata.chmod(0o600)
        os.replace(temporary_content, content_path)
        os.replace(temporary_metadata, metadata_path)
    finally:
        temporary_content.unlink(missing_ok=True)
        temporary_metadata.unlink(missing_ok=True)


def _prune(root: Path, keep_key: str) -> None:
    max_bytes = _bounded_int(
        "WORD_EXPORT_CACHE_MAX_MB", 512, 32, 8_192,
    ) * 1024 * 1024
    max_entries = _bounded_int("WORD_EXPORT_CACHE_MAX_ENTRIES", 1_024, 16, 20_000)
    entries = []
    total_bytes = 0
    try:
        for metadata_path in root.glob("*/*.json"):
            content_path = metadata_path.with_suffix(".docx")
            if not content_path.is_file():
                metadata_path.unlink(missing_ok=True)
                continue
            size = content_path.stat().st_size
            total_bytes += size
            entries.append((metadata_path.stat().st_mtime, size, content_path, metadata_path))
    except OSError:
        return
    entries.sort(key=lambda item: item[0])
    while entries and (len(entries) > max_entries or total_bytes > max_bytes):
        _mtime, size, content_path, metadata_path = entries.pop(0)
        if content_path.stem == keep_key:
            entries.append((_mtime, size, content_path, metadata_path))
            if len(entries) == 1:
                break
            continue
        content_path.unlink(missing_ok=True)
        metadata_path.unlink(missing_ok=True)
        total_bytes -= size


def acquire_standardized_template_cache(
    source: bytes,
    *,
    organization_scope: str,
    document_type_hint: str | None,
    mode: str | None,
) -> tuple[bytes | None, StandardizedTemplateCacheLease | None]:
    """Return a cache hit or an exclusive lease that may publish one miss."""

    original = bytes(source)
    if str(os.environ.get("WORD_EXPORT_CACHE_ENABLED", "true")).casefold() != "true":
        return None, None
    root = _cache_root()
    key, identity = _cache_key(
        original,
        organization_scope=organization_scope,
        document_type_hint=document_type_hint,
        mode=mode,
    )
    content_path, metadata_path, lock_path = _paths(root, key)
    cached = _load(content_path, metadata_path, key, identity)
    if cached is not None:
        return cached, None
    descriptor = _acquire_lock(lock_path)
    if descriptor is None:
        return None, None
    cached = _load(content_path, metadata_path, key, identity)
    if cached is not None:
        try:
            os.close(descriptor)
        finally:
            lock_path.unlink(missing_ok=True)
        return cached, None
    return None, StandardizedTemplateCacheLease(
        key=key,
        identity=identity,
        content_path=content_path,
        metadata_path=metadata_path,
        lock_path=lock_path,
        descriptor=descriptor,
    )


def release_standardized_template_cache(
    lease: StandardizedTemplateCacheLease | None,
) -> None:
    if lease is None or lease.released:
        return
    lease.released = True
    try:
        os.close(lease.descriptor)
    finally:
        lease.lock_path.unlink(missing_ok=True)


def publish_standardized_template_cache(
    lease: StandardizedTemplateCacheLease | None,
    content: bytes,
    *,
    preservation_attested: bool = False,
) -> None:
    if lease is None:
        return
    try:
        if preservation_attested is not True:
            return
        _store(
            lease.content_path,
            lease.metadata_path,
            key=lease.key,
            identity=lease.identity,
            content=bytes(content),
        )
        _prune(_cache_root(), lease.key)
    finally:
        release_standardized_template_cache(lease)


__all__ = [
    "StandardizedTemplateCacheLease",
    "acquire_standardized_template_cache",
    "publish_standardized_template_cache",
    "release_standardized_template_cache",
]
