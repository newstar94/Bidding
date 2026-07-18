"""Atomic, verifiable backups for all persistent BiddingFlow filesystem state."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import stat
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from uuid import uuid4

from backend.db.maintenance import (
    DatabaseMaintenanceError,
    create_verified_database_snapshot,
)
from backend.db.db_helper import SQLiteDatabase


SNAPSHOT_FORMAT = "biddingflow-full-state"
SNAPSHOT_VERSION = 2
MANIFEST_FILENAME = "manifest.json"
DATABASE_RELATIVE_PATH = "database/bidding.db"
_SNAPSHOT_PREFIX = "biddingflow-full-state"
_ALLOWED_TOP_LEVEL_DIRECTORIES = {"database", "uploads", "word-templates"}
_MAX_MANIFEST_BYTES = 16 * 1024 * 1024
_MAX_MANIFEST_FILES = 1_000_000
_WINDOWS_RESERVED_NAMES = {
    "aux",
    "con",
    "nul",
    "prn",
    *(f"com{number}" for number in range(1, 10)),
    *(f"lpt{number}" for number in range(1, 10)),
}
_SECRET_FILE_NAMES = {
    ".env",
    "client_secret.json",
    "credentials.json",
    "id_ed25519",
    "id_rsa",
    "secrets.json",
}
_SECRET_SUFFIXES = {".jks", ".key", ".keystore", ".p12", ".pem", ".pfx"}
_SECRET_DIRECTORY_NAMES = {"secret", "secrets"}


class FullStateBackupError(DatabaseMaintenanceError):
    """Raised when a full-state snapshot cannot be proven complete and safe."""


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _paths_overlap(first: Path, second: Path) -> bool:
    return _is_within(first, second) or _is_within(second, first)


def _is_link_or_reparse(path: Path) -> bool:
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise FullStateBackupError(f"Could not inspect backup path: {path}") from exc
    if stat.S_ISLNK(metadata.st_mode):
        return True
    reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    return bool(reparse_flag and getattr(metadata, "st_file_attributes", 0) & reparse_flag)


def _validate_relative_path(value: object) -> str:
    if not isinstance(value, str) or not value or len(value) > 4096:
        raise FullStateBackupError("Manifest contains an invalid relative path.")
    if "\x00" in value or "\\" in value or value.startswith("/") or value.endswith("/"):
        raise FullStateBackupError(f"Unsafe manifest path: {value!r}")
    if "//" in value:
        raise FullStateBackupError(f"Unsafe manifest path: {value!r}")
    raw_parts = value.split("/")
    if any(part in {"", ".", ".."} for part in raw_parts):
        raise FullStateBackupError(f"Unsafe manifest path: {value!r}")
    for part in raw_parts:
        if ":" in part or part.endswith((".", " ")):
            raise FullStateBackupError(f"Unsafe manifest path: {value!r}")
        device_name = part.split(".", 1)[0].casefold()
        if device_name in _WINDOWS_RESERVED_NAMES:
            raise FullStateBackupError(f"Unsafe manifest path: {value!r}")
    normalized = PurePosixPath(value)
    if normalized.is_absolute() or normalized.as_posix() != value:
        raise FullStateBackupError(f"Unsafe manifest path: {value!r}")
    return value


def _safe_join(root: Path, relative_path: object, *, must_exist: bool) -> Path:
    normalized = _validate_relative_path(relative_path)
    root = root.resolve()
    candidate = root.joinpath(*PurePosixPath(normalized).parts)
    current = root
    for part in PurePosixPath(normalized).parts:
        current = current / part
        if current.exists() and _is_link_or_reparse(current):
            raise FullStateBackupError(f"Links are forbidden in snapshot paths: {normalized}")
    try:
        resolved = candidate.resolve(strict=must_exist)
    except OSError as exc:
        raise FullStateBackupError(f"Snapshot file is missing or inaccessible: {normalized}") from exc
    if not _is_within(resolved, root):
        raise FullStateBackupError(f"Snapshot path escapes its root: {normalized}")
    return resolved


def _is_excluded(relative_path: PurePosixPath) -> bool:
    lowered_parts = [part.casefold() for part in relative_path.parts]
    if any(part in _SECRET_DIRECTORY_NAMES for part in lowered_parts):
        return True
    filename = lowered_parts[-1]
    suffix = Path(filename).suffix.casefold()
    if filename in _SECRET_FILE_NAMES or filename.startswith(".env."):
        return True
    if filename.startswith(("client_secret.", "credentials.", "secret.")):
        return True
    if suffix in _SECRET_SUFFIXES:
        return True
    return (
        filename.endswith((".lock", ".wal", ".shm", "-wal", "-shm"))
        or filename == "manifest.json"
    )


def _collect_source_files(root: Path):
    files = []
    excluded_count = 0

    def visit(directory: Path, relative_directory: PurePosixPath):
        nonlocal excluded_count
        try:
            with os.scandir(directory) as scanner:
                entries = sorted(scanner, key=lambda entry: entry.name.casefold())
        except OSError as exc:
            raise FullStateBackupError(f"Could not enumerate managed state: {directory}") from exc
        for entry in entries:
            relative_path = relative_directory / entry.name
            if _is_excluded(relative_path):
                excluded_count += 1
                continue
            path = Path(entry.path)
            if _is_link_or_reparse(path):
                raise FullStateBackupError(
                    f"Links are forbidden in managed state: {relative_path.as_posix()}"
                )
            if entry.is_dir(follow_symlinks=False):
                visit(path, relative_path)
            elif entry.is_file(follow_symlinks=False):
                files.append((path, relative_path))
            else:
                raise FullStateBackupError(
                    f"Special files are forbidden in managed state: {relative_path.as_posix()}"
                )

    resolved_root = root.resolve()
    if not resolved_root.is_dir():
        raise FullStateBackupError(f"Managed state directory does not exist: {resolved_root}")
    if _is_link_or_reparse(resolved_root):
        raise FullStateBackupError(f"Managed state directory cannot be a link: {resolved_root}")
    visit(resolved_root, PurePosixPath())
    return files, excluded_count


def _copy_file_verified(source: Path, destination: Path) -> tuple[int, str]:
    try:
        before = source.stat(follow_symlinks=False)
        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        digest = hashlib.sha256()
        size = 0
        with source.open("rb") as input_file, destination.open("xb") as output_file:
            for chunk in iter(lambda: input_file.read(1024 * 1024), b""):
                output_file.write(chunk)
                digest.update(chunk)
                size += len(chunk)
            output_file.flush()
            os.fsync(output_file.fileno())
        after = source.stat(follow_symlinks=False)
    except OSError as exc:
        raise FullStateBackupError(f"Could not copy managed state file: {source}") from exc
    stable_fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns")
    if any(getattr(before, field, None) != getattr(after, field, None) for field in stable_fields):
        destination.unlink(missing_ok=True)
        raise FullStateBackupError(f"Managed state changed while it was being copied: {source}")
    if size != before.st_size:
        destination.unlink(missing_ok=True)
        raise FullStateBackupError(f"Managed state size changed while copying: {source}")
    if os.name != "nt":
        destination.chmod(0o600)
    return size, digest.hexdigest()


def _write_json_atomic(path: Path, payload: dict) -> None:
    partial_path = path.with_name(f".{path.name}.partial-{uuid4().hex}")
    try:
        with partial_path.open("x", encoding="utf-8", newline="\n") as output:
            json.dump(payload, output, ensure_ascii=False, indent=2, sort_keys=True)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        if os.name != "nt":
            partial_path.chmod(0o600)
        os.replace(partial_path, path)
    except OSError as exc:
        raise FullStateBackupError(f"Could not finalize snapshot manifest: {path}") from exc
    finally:
        partial_path.unlink(missing_ok=True)


def _fsync_directory(path: Path) -> None:
    if os.name == "nt":
        return
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
    try:
        descriptor = os.open(path, flags)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    except OSError as exc:
        raise FullStateBackupError(f"Could not make snapshot directory durable: {path}") from exc


def _fsync_tree_directories(root: Path) -> None:
    if os.name == "nt":
        return
    directories = [Path(directory) for directory, _names, _files in os.walk(root)]
    for directory in reversed(directories):
        _fsync_directory(directory)


def _remove_owned_staging(path: Path, expected_parent: Path) -> None:
    resolved_parent = expected_parent.resolve()
    candidate_parent = path.parent.resolve()
    if candidate_parent != resolved_parent or not path.name.startswith(".") or "partial-" not in path.name:
        raise FullStateBackupError(f"Refusing to clean an unrecognized staging path: {path}")
    if path.exists():
        shutil.rmtree(path)


def _database_integrity_read_only(database_path: Path) -> dict:
    try:
        uri = database_path.resolve().as_uri() + "?mode=ro&immutable=1"
        connection = sqlite3.connect(uri, uri=True, timeout=30)
        try:
            integrity_rows = [str(row[0]) for row in connection.execute("PRAGMA integrity_check")]
            foreign_key_rows = connection.execute("PRAGMA foreign_key_check").fetchall()
            schema_version = int(connection.execute("PRAGMA user_version").fetchone()[0])
        finally:
            connection.close()
    except sqlite3.Error as exc:
        raise FullStateBackupError(f"Snapshot SQLite verification failed: {exc}") from exc
    if integrity_rows != ["ok"]:
        raise FullStateBackupError(
            "Snapshot SQLite integrity_check failed: " + "; ".join(integrity_rows[:10])
        )
    if foreign_key_rows:
        raise FullStateBackupError(
            f"Snapshot SQLite foreign_key_check found {len(foreign_key_rows)} violation(s)."
        )
    return {
        "integrity": "ok",
        "foreignKeyViolations": 0,
        "schemaVersion": schema_version,
    }


def _load_manifest(snapshot_root: Path) -> dict:
    manifest_path = snapshot_root / MANIFEST_FILENAME
    if not manifest_path.is_file() or _is_link_or_reparse(manifest_path):
        raise FullStateBackupError("Snapshot manifest is missing or is not a regular file.")
    try:
        if manifest_path.stat().st_size > _MAX_MANIFEST_BYTES:
            raise FullStateBackupError("Snapshot manifest exceeds the safety size limit.")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise FullStateBackupError("Snapshot manifest is unreadable or invalid JSON.") from exc
    if not isinstance(manifest, dict):
        raise FullStateBackupError("Snapshot manifest must be a JSON object.")
    return manifest


def _validated_manifest_entries(manifest: dict) -> list[dict]:
    if manifest.get("format") != SNAPSHOT_FORMAT or manifest.get("version") != SNAPSHOT_VERSION:
        raise FullStateBackupError("Snapshot format or version is unsupported.")
    consistency = manifest.get("consistency")
    if consistency != {
        "mode": "exclusive-writer-lease",
        "quiesced": True,
    }:
        raise FullStateBackupError(
            "Snapshot does not prove an exclusive quiesced backup window."
        )
    created_at = manifest.get("createdAt")
    if not isinstance(created_at, str):
        raise FullStateBackupError("Snapshot creation timestamp is missing.")
    try:
        parsed_timestamp = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    except ValueError as exc:
        raise FullStateBackupError("Snapshot creation timestamp is invalid.") from exc
    if parsed_timestamp.tzinfo is None:
        raise FullStateBackupError("Snapshot creation timestamp must include a timezone.")

    entries = manifest.get("files")
    if not isinstance(entries, list) or not entries or len(entries) > _MAX_MANIFEST_FILES:
        raise FullStateBackupError("Snapshot manifest has an invalid file list.")
    seen = set()
    validated = []
    for entry in entries:
        if not isinstance(entry, dict):
            raise FullStateBackupError("Snapshot manifest file entries must be objects.")
        relative_path = _validate_relative_path(entry.get("relativePath"))
        case_key = relative_path.casefold()
        if case_key in seen:
            raise FullStateBackupError(f"Snapshot manifest has duplicate path: {relative_path}")
        seen.add(case_key)
        if relative_path == MANIFEST_FILENAME or _is_excluded(PurePosixPath(relative_path)):
            raise FullStateBackupError(f"Snapshot contains a forbidden file: {relative_path}")
        state_root = PurePosixPath(relative_path).parts[0]
        if state_root not in _ALLOWED_TOP_LEVEL_DIRECTORIES:
            raise FullStateBackupError(f"Snapshot contains an unknown state root: {relative_path}")
        expected_kind = {
            "database": "sqlite",
            "uploads": "upload",
            "word-templates": "wordTemplate",
        }[state_root]
        if entry.get("kind") != expected_kind:
            raise FullStateBackupError(f"Snapshot file kind is invalid: {relative_path}")
        if state_root == "database" and relative_path != DATABASE_RELATIVE_PATH:
            raise FullStateBackupError(f"Snapshot contains an unknown database file: {relative_path}")
        size = entry.get("sizeBytes")
        digest = entry.get("sha256")
        if isinstance(size, bool) or not isinstance(size, int) or size < 0:
            raise FullStateBackupError(f"Snapshot size is invalid: {relative_path}")
        if (
            not isinstance(digest, str)
            or len(digest) != 64
            or any(character not in "0123456789abcdef" for character in digest)
        ):
            raise FullStateBackupError(f"Snapshot SHA-256 is invalid: {relative_path}")
        validated.append(
            {
                "relativePath": relative_path,
                "sizeBytes": size,
                "sha256": digest,
                "kind": expected_kind,
            }
        )
    if DATABASE_RELATIVE_PATH.casefold() not in seen:
        raise FullStateBackupError("Snapshot manifest does not contain the SQLite database.")
    return validated


def _actual_snapshot_files(snapshot_root: Path) -> set[str]:
    actual = set()
    for directory, directory_names, filenames in os.walk(snapshot_root, followlinks=False):
        directory_path = Path(directory)
        for directory_name in directory_names:
            child = directory_path / directory_name
            if _is_link_or_reparse(child):
                raise FullStateBackupError(f"Snapshot directory link is forbidden: {child}")
        for filename in filenames:
            path = directory_path / filename
            if _is_link_or_reparse(path) or not path.is_file():
                raise FullStateBackupError(f"Snapshot special file is forbidden: {path}")
            relative_path = path.relative_to(snapshot_root).as_posix()
            if relative_path != MANIFEST_FILENAME:
                _validate_relative_path(relative_path)
                actual.add(relative_path)
    return actual


def verify_full_state_snapshot(snapshot_directory) -> dict:
    """Verify manifest completeness, every checksum, and SQLite integrity."""
    raw_root = Path(snapshot_directory)
    if not raw_root.is_dir() or _is_link_or_reparse(raw_root):
        raise FullStateBackupError(f"Snapshot directory does not exist: {raw_root}")
    snapshot_root = raw_root.resolve()
    manifest = _load_manifest(snapshot_root)
    entries = _validated_manifest_entries(manifest)
    expected_files = {entry["relativePath"] for entry in entries}
    actual_files = _actual_snapshot_files(snapshot_root)
    if actual_files != expected_files:
        missing = sorted(expected_files - actual_files)
        unexpected = sorted(actual_files - expected_files)
        details = []
        if missing:
            details.append("missing=" + ",".join(missing[:5]))
        if unexpected:
            details.append("unexpected=" + ",".join(unexpected[:5]))
        raise FullStateBackupError("Snapshot file list does not match manifest: " + "; ".join(details))

    total_size = 0
    for entry in entries:
        path = _safe_join(snapshot_root, entry["relativePath"], must_exist=True)
        size = path.stat().st_size
        if size != entry["sizeBytes"] or _sha256(path) != entry["sha256"]:
            raise FullStateBackupError(
                f"Snapshot checksum or size does not match: {entry['relativePath']}"
            )
        total_size += size

    database_manifest = manifest.get("database")
    if not isinstance(database_manifest, dict):
        raise FullStateBackupError("Snapshot database verification metadata is missing.")
    if database_manifest.get("relativePath") != DATABASE_RELATIVE_PATH:
        raise FullStateBackupError("Snapshot database path does not match the supported layout.")
    database_path = _safe_join(snapshot_root, DATABASE_RELATIVE_PATH, must_exist=True)
    database_result = _database_integrity_read_only(database_path)
    for key in ("integrity", "foreignKeyViolations", "schemaVersion"):
        if database_manifest.get(key) != database_result[key]:
            raise FullStateBackupError(f"Snapshot database {key} does not match its manifest.")

    return {
        "snapshot": str(snapshot_root),
        "verified": True,
        "format": SNAPSHOT_FORMAT,
        "version": SNAPSHOT_VERSION,
        "createdAt": manifest["createdAt"],
        "fileCount": len(entries),
        "totalSizeBytes": total_size,
        "database": database_result,
    }


def _validate_source_layout(
    database_path: Path,
    upload_directory: Path,
    word_template_directory: Path,
    backup_directory: Path,
) -> None:
    if not database_path.is_file():
        raise FullStateBackupError(f"SQLite database does not exist: {database_path}")
    for directory in (upload_directory, word_template_directory):
        if not directory.is_dir():
            raise FullStateBackupError(f"Managed state directory does not exist: {directory}")
        if _is_link_or_reparse(directory):
            raise FullStateBackupError(f"Managed state directory cannot be a link: {directory}")
    state_paths = [database_path, upload_directory, word_template_directory]
    if any(_paths_overlap(backup_directory, state_path) for state_path in state_paths):
        raise FullStateBackupError(
            "Full-state backup directory must be separate from every managed state path."
        )
    if _paths_overlap(upload_directory, word_template_directory):
        raise FullStateBackupError("Upload and Word-template directories must not overlap.")
    if _is_within(database_path, upload_directory) or _is_within(
        database_path, word_template_directory
    ):
        raise FullStateBackupError("SQLite database must be separate from managed file roots.")


def create_full_state_snapshot(
    database_path,
    backup_directory,
    upload_directory,
    word_template_directory,
    *,
    now: datetime | None = None,
) -> dict:
    """Create and atomically publish a verified full-state snapshot directory."""
    database_path = Path(database_path).resolve()
    upload_directory = Path(upload_directory).resolve()
    word_template_directory = Path(word_template_directory).resolve()
    backup_directory = Path(backup_directory).resolve()
    _validate_source_layout(
        database_path,
        upload_directory,
        word_template_directory,
        backup_directory,
    )
    try:
        backup_directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    except OSError as exc:
        raise FullStateBackupError(f"Could not create backup directory: {backup_directory}") from exc
    if _is_link_or_reparse(backup_directory):
        raise FullStateBackupError("Full-state backup directory cannot be a link.")

    timestamp = now or datetime.now(timezone.utc)
    if timestamp.tzinfo is None:
        raise FullStateBackupError("Snapshot timestamp must include a timezone.")
    timestamp = timestamp.astimezone(timezone.utc)
    snapshot_name = f"{_SNAPSHOT_PREFIX}-{timestamp.strftime('%Y%m%dT%H%M%S.%fZ')}"
    final_path = backup_directory / snapshot_name
    if final_path.exists():
        raise FullStateBackupError(f"Full-state snapshot already exists: {final_path}")
    partial_path = backup_directory / f".{snapshot_name}.partial-{uuid4().hex}"

    try:
        writer_lease = SQLiteDatabase(database_path).acquire_writer_lease()
    except RuntimeError as exc:
        raise FullStateBackupError(
            "Full-state backup requires a quiesced application. Stop every "
            "BiddingFlow process before creating the snapshot."
        ) from exc

    try:
        partial_path.mkdir(mode=0o700)
        for root_name in _ALLOWED_TOP_LEVEL_DIRECTORIES:
            (partial_path / root_name).mkdir(mode=0o700)

        database_result = create_verified_database_snapshot(
            database_path,
            partial_path / DATABASE_RELATIVE_PATH,
        )
        files = [
            {
                "kind": "sqlite",
                "relativePath": DATABASE_RELATIVE_PATH,
                "sizeBytes": database_result["sizeBytes"],
                "sha256": database_result["sha256"],
            }
        ]
        excluded_count = 0
        roots = (
            ("uploads", "upload", upload_directory),
            ("word-templates", "wordTemplate", word_template_directory),
        )
        for target_root, kind, source_root in roots:
            source_files, root_excluded_count = _collect_source_files(source_root)
            excluded_count += root_excluded_count
            for source, relative_source_path in source_files:
                relative_path = f"{target_root}/{relative_source_path.as_posix()}"
                destination = _safe_join(partial_path, relative_path, must_exist=False)
                size, digest = _copy_file_verified(source, destination)
                files.append(
                    {
                        "kind": kind,
                        "relativePath": relative_path,
                        "sizeBytes": size,
                        "sha256": digest,
                    }
                )

        files.sort(key=lambda entry: entry["relativePath"].casefold())
        manifest = {
            "consistency": {
                "mode": "exclusive-writer-lease",
                "quiesced": True,
            },
            "createdAt": timestamp.isoformat().replace("+00:00", "Z"),
            "database": {
                "foreignKeyViolations": database_result["foreignKeyViolations"],
                "integrity": database_result["integrity"],
                "relativePath": DATABASE_RELATIVE_PATH,
                "schemaVersion": database_result["schemaVersion"],
                "walCheckpoint": database_result["walCheckpoint"],
            },
            "files": files,
            "format": SNAPSHOT_FORMAT,
            "version": SNAPSHOT_VERSION,
        }
        _write_json_atomic(partial_path / MANIFEST_FILENAME, manifest)
        verification = verify_full_state_snapshot(partial_path)
        _fsync_tree_directories(partial_path)
        os.rename(partial_path, final_path)
        _fsync_directory(backup_directory)
    except (DatabaseMaintenanceError, OSError) as exc:
        if partial_path.exists():
            _remove_owned_staging(partial_path, backup_directory)
        if isinstance(exc, FullStateBackupError):
            raise
        if isinstance(exc, DatabaseMaintenanceError):
            raise FullStateBackupError(str(exc)) from exc
        raise FullStateBackupError(f"Could not publish full-state snapshot: {exc}") from exc
    finally:
        writer_lease.release()

    verification.update(
        {
            "snapshot": str(final_path),
            "excludedFileCount": excluded_count,
        }
    )
    return verification


def restore_full_state_snapshot(snapshot_directory, destination_directory) -> dict:
    """Restore a verified snapshot into a new directory; overwrites are forbidden."""
    verification = verify_full_state_snapshot(snapshot_directory)
    snapshot_root = Path(snapshot_directory).resolve()
    destination_path = Path(destination_directory).resolve()
    if destination_path.exists():
        raise FullStateBackupError(
            "Restore destination already exists; full-state restore requires a new directory."
        )
    if _paths_overlap(snapshot_root, destination_path):
        raise FullStateBackupError("Restore destination must be separate from the snapshot.")
    destination_parent = destination_path.parent
    try:
        destination_parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    except OSError as exc:
        raise FullStateBackupError(
            f"Could not create restore parent directory: {destination_parent}"
        ) from exc
    partial_path = destination_parent / f".{destination_path.name}.restore-partial-{uuid4().hex}"
    manifest = _load_manifest(snapshot_root)
    entries = _validated_manifest_entries(manifest)

    try:
        partial_path.mkdir(mode=0o700)
        for root_name in _ALLOWED_TOP_LEVEL_DIRECTORIES:
            (partial_path / root_name).mkdir(mode=0o700)
        for entry in entries:
            source = _safe_join(snapshot_root, entry["relativePath"], must_exist=True)
            destination = _safe_join(partial_path, entry["relativePath"], must_exist=False)
            size, digest = _copy_file_verified(source, destination)
            if size != entry["sizeBytes"] or digest != entry["sha256"]:
                raise FullStateBackupError(
                    f"Snapshot changed while restoring: {entry['relativePath']}"
                )
        manifest_source = snapshot_root / MANIFEST_FILENAME
        manifest_destination = partial_path / MANIFEST_FILENAME
        _copy_file_verified(manifest_source, manifest_destination)
        verify_full_state_snapshot(partial_path)
        if destination_path.exists():
            raise FullStateBackupError("Restore destination appeared while restore was running.")
        _fsync_tree_directories(partial_path)
        os.rename(partial_path, destination_path)
        _fsync_directory(destination_parent)
    except (FullStateBackupError, OSError) as exc:
        if partial_path.exists():
            _remove_owned_staging(partial_path, destination_parent)
        if isinstance(exc, FullStateBackupError):
            raise
        raise FullStateBackupError(f"Could not restore full-state snapshot: {exc}") from exc

    return {
        "snapshot": str(snapshot_root),
        "destination": str(destination_path),
        "restored": True,
        "verified": True,
        "fileCount": verification["fileCount"],
        "totalSizeBytes": verification["totalSizeBytes"],
        "database": verification["database"],
    }
