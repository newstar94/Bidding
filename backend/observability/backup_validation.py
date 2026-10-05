"""Shared strict backup snapshot validation for runtime health and tooling."""

from __future__ import annotations

import hashlib
import hmac
import json
import pathlib


MANIFEST_FILENAME = "manifest.json"
MAX_MANIFEST_FILES = 500_000
ASSET_DIRECTORIES = ("uploads", "word-templates")


def manifest_relative_path(value):
    raw = str(value or "")
    components = raw.split("/")
    if (
        not raw
        or "\\" in raw
        or any(
            not component
            or component in {".", ".."}
            or ":" in component
            or any(ord(character) < 32 for character in component)
            for component in components
        )
    ):
        raise RuntimeError("unsafe backup path")
    relative = pathlib.PurePosixPath(raw)
    if relative.is_absolute():
        raise RuntimeError("unsafe backup path")
    return pathlib.Path(*relative.parts)


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def snapshot_asset_directories(snapshot_dir: pathlib.Path, manifest: dict) -> dict[str, bool]:
    declared = manifest.get("assetDirectories")
    if "assetDirectories" in manifest and (
        not isinstance(declared, dict)
        or set(declared) != set(ASSET_DIRECTORIES)
        or any(type(value) is not bool for value in declared.values())
    ):
        raise RuntimeError("invalid backup asset directory metadata")
    present = {}
    for name in ASSET_DIRECTORIES:
        directory = snapshot_dir / name
        if directory.is_symlink():
            raise RuntimeError("unsafe backup asset directory")
        exists = directory.is_dir()
        if declared is not None and declared[name] != exists:
            raise RuntimeError(f"backup asset directory presence mismatch: {name}")
        if not exists and any(
            str(entry.get("relativePath") or "").startswith(f"{name}/")
            for entry in manifest.get("files", [])
        ):
            raise RuntimeError(f"backup asset directory is missing: {name}")
        present[name] = exists
    return present


def verify_snapshot(snapshot_dir: pathlib.Path) -> dict:
    snapshot_dir = snapshot_dir.resolve()
    manifest_path = snapshot_dir / MANIFEST_FILENAME
    if not manifest_path.is_file() or manifest_path.stat().st_size > 64 * 1024 * 1024:
        raise RuntimeError("manifest.json is missing or too large")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("format") != "biddingflow-pg-backup" or manifest.get("version") != 1:
        raise RuntimeError("unsupported backup format")
    files = manifest.get("files")
    if not isinstance(files, list) or len(files) > MAX_MANIFEST_FILES:
        raise RuntimeError("invalid backup file list")
    if len(files) != int(manifest.get("fileCount", -1)):
        raise RuntimeError("backup file count mismatch")
    seen = set()
    verified_entries = {}
    for item in files:
        relative = manifest_relative_path(item.get("relativePath"))
        candidate = (snapshot_dir / relative).resolve()
        if candidate in seen or snapshot_dir not in candidate.parents:
            raise RuntimeError("unsafe or duplicate backup path")
        seen.add(candidate)
        if not candidate.is_file():
            raise RuntimeError(f"backup file is missing: {relative.as_posix()}")
        size = int(item.get("sizeBytes", -1))
        digest = str(item.get("sha256") or "")
        if candidate.stat().st_size != size:
            raise RuntimeError(f"backup size mismatch: {relative.as_posix()}")
        if not hmac.compare_digest(sha256_file(candidate), digest):
            raise RuntimeError(f"backup checksum mismatch: {relative.as_posix()}")
        verified_entries[relative.as_posix()] = (size, digest)

    database_entry = manifest.get("database")
    if not isinstance(database_entry, dict):
        raise RuntimeError("invalid backup database entry")
    database_relative = manifest_relative_path(database_entry.get("relativePath"))
    database_metadata = (
        int(database_entry.get("sizeBytes", -1)),
        str(database_entry.get("sha256") or ""),
    )
    if verified_entries.get(database_relative.as_posix()) != database_metadata:
        raise RuntimeError("backup database entry is not verified")
    snapshot_asset_directories(snapshot_dir, manifest)
    return manifest
