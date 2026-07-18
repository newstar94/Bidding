"""Online SQLite backup, integrity inspection and controlled restore helpers."""

import hashlib
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from backend.db.db_helper import SQLiteDatabase


class DatabaseMaintenanceError(RuntimeError):
    """Raised when a backup or restore cannot be proven safe."""


def _connect_existing(path):
    database_path = Path(path).resolve()
    if not database_path.is_file():
        raise DatabaseMaintenanceError(f"SQLite database does not exist: {database_path}")
    connection = sqlite3.connect(str(database_path), timeout=30)
    connection.execute("PRAGMA busy_timeout = 30000")
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def _integrity_result(connection):
    integrity_rows = [str(row[0]) for row in connection.execute("PRAGMA integrity_check")]
    foreign_key_rows = connection.execute("PRAGMA foreign_key_check").fetchall()
    if integrity_rows != ["ok"]:
        raise DatabaseMaintenanceError(
            "SQLite integrity_check failed: " + "; ".join(integrity_rows[:10])
        )
    if foreign_key_rows:
        raise DatabaseMaintenanceError(
            f"SQLite foreign_key_check found {len(foreign_key_rows)} violation(s)."
        )
    return {
        "integrity": "ok",
        "foreignKeyViolations": 0,
        "schemaVersion": int(connection.execute("PRAGMA user_version").fetchone()[0]),
    }


def _sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _verified_backup_metadata(backup_path):
    metadata_path = Path(f"{backup_path}.json")
    if not metadata_path.is_file():
        raise DatabaseMaintenanceError(
            f"Backup metadata is missing: {metadata_path}. Restore requires the verified pair."
        )
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise DatabaseMaintenanceError("Backup metadata is unreadable or invalid.") from exc
    expected_digest = str(metadata.get("sha256", "")).strip().lower()
    if len(expected_digest) != 64 or _sha256(backup_path) != expected_digest:
        raise DatabaseMaintenanceError("Backup SHA-256 does not match its metadata.")
    if metadata.get("integrity") != "ok" or metadata.get("foreignKeyViolations") != 0:
        raise DatabaseMaintenanceError("Backup metadata does not record a clean integrity check.")
    return metadata


def inspect_database(database_path):
    """Run full SQLite and foreign-key checks without changing application data."""
    resolved_path = Path(database_path).resolve()
    connection = _connect_existing(resolved_path)
    try:
        try:
            result = _integrity_result(connection)
        except sqlite3.Error as exc:
            raise DatabaseMaintenanceError(f"SQLite integrity inspection failed: {exc}") from exc
    finally:
        connection.close()
    result.update({"database": str(resolved_path), "sizeBytes": resolved_path.stat().st_size})
    return result


def create_verified_database_snapshot(database_path, destination_path):
    """Copy SQLite to a new file with the online backup API and verify the copy.

    This lower-level primitive intentionally does not create legacy sidecar
    metadata.  Full-state snapshots record the returned verification data in
    their own manifest, while ``create_online_backup`` keeps its existing file
    and ``.json`` contract unchanged.
    """
    source_path = Path(database_path).resolve()
    target_path = Path(destination_path).resolve()
    if source_path == target_path:
        raise DatabaseMaintenanceError(
            "SQLite snapshot destination must differ from the source database."
        )
    if target_path.exists():
        raise DatabaseMaintenanceError(
            f"SQLite snapshot destination already exists: {target_path}"
        )

    target_path.parent.mkdir(parents=True, exist_ok=True)
    partial_path = target_path.parent / f".{target_path.name}.partial-{uuid4().hex}"
    source_connection = _connect_existing(source_path)
    destination_connection = None
    snapshot_created = False
    try:
        checkpoint = tuple(
            int(value)
            for value in source_connection.execute("PRAGMA wal_checkpoint(PASSIVE)").fetchone()
        )
        source_check = _integrity_result(source_connection)
        destination_connection = sqlite3.connect(str(partial_path))
        source_connection.backup(destination_connection, pages=256, sleep=0.05)
        destination_connection.commit()
        snapshot_check = _integrity_result(destination_connection)
        if snapshot_check != source_check:
            raise DatabaseMaintenanceError(
                "SQLite snapshot verification differs from the source database."
            )
        snapshot_created = True
    except DatabaseMaintenanceError:
        raise
    except (sqlite3.Error, OSError) as exc:
        raise DatabaseMaintenanceError(f"Online SQLite snapshot failed: {exc}") from exc
    finally:
        if destination_connection is not None:
            destination_connection.close()
        source_connection.close()
        if not snapshot_created:
            partial_path.unlink(missing_ok=True)

    try:
        with partial_path.open("r+b") as snapshot_file:
            os.fsync(snapshot_file.fileno())
        if os.name != "nt":
            partial_path.chmod(0o600)
        os.replace(partial_path, target_path)
    except OSError as exc:
        raise DatabaseMaintenanceError(f"Could not finalize SQLite snapshot: {exc}") from exc
    finally:
        partial_path.unlink(missing_ok=True)

    return {
        "database": str(target_path),
        "sizeBytes": target_path.stat().st_size,
        "sha256": _sha256(target_path),
        "schemaVersion": snapshot_check["schemaVersion"],
        "integrity": snapshot_check["integrity"],
        "foreignKeyViolations": snapshot_check["foreignKeyViolations"],
        "sourceSchemaVersion": source_check["schemaVersion"],
        "walCheckpoint": {
            "busy": checkpoint[0],
            "logFrames": checkpoint[1],
            "checkpointedFrames": checkpoint[2],
        },
    }


def _remove_expired_backups(backup_directory, prefix, retention_count):
    candidates = sorted(
        backup_directory.glob(f"{prefix}-*.db"),
        key=lambda path: (path.stat().st_mtime_ns, path.name),
        reverse=True,
    )
    removed = []
    for expired in candidates[max(1, retention_count):]:
        metadata_path = expired.with_suffix(expired.suffix + ".json")
        expired.unlink(missing_ok=True)
        metadata_path.unlink(missing_ok=True)
        removed.append(str(expired))
    return removed


def create_online_backup(database_path, backup_directory, retention_count=14):
    """Create an atomic, verified SQLite snapshot using the online backup API."""
    source_path = Path(database_path).resolve()
    destination_directory = Path(backup_directory).resolve()
    if source_path.parent == destination_directory:
        raise DatabaseMaintenanceError(
            "Backup directory must be separate from the SQLite database directory."
        )
    try:
        retention_count = int(retention_count)
    except (TypeError, ValueError) as exc:
        raise DatabaseMaintenanceError("Backup retention count must be an integer.") from exc
    if retention_count < 1:
        raise DatabaseMaintenanceError("Backup retention count must be at least 1.")

    destination_directory.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc)
    prefix = source_path.stem
    backup_name = f"{prefix}-{timestamp.strftime('%Y%m%dT%H%M%S.%fZ')}.db"
    final_path = destination_directory / backup_name
    partial_path = destination_directory / f".{backup_name}.partial-{uuid4().hex}"
    metadata_path = final_path.with_suffix(final_path.suffix + ".json")
    metadata_partial_path = metadata_path.with_suffix(metadata_path.suffix + ".partial")

    source_connection = _connect_existing(source_path)
    destination_connection = None
    try:
        checkpoint = tuple(
            int(value)
            for value in source_connection.execute("PRAGMA wal_checkpoint(PASSIVE)").fetchone()
        )
        source_check = _integrity_result(source_connection)
        destination_connection = sqlite3.connect(str(partial_path))
        source_connection.backup(destination_connection, pages=256, sleep=0.05)
        destination_connection.commit()
        backup_check = _integrity_result(destination_connection)
    except DatabaseMaintenanceError:
        partial_path.unlink(missing_ok=True)
        raise
    except (sqlite3.Error, OSError) as exc:
        partial_path.unlink(missing_ok=True)
        raise DatabaseMaintenanceError(f"Online SQLite backup failed: {exc}") from exc
    finally:
        if destination_connection is not None:
            destination_connection.close()
        source_connection.close()

    try:
        if os.name != "nt":
            partial_path.chmod(0o600)
        os.replace(partial_path, final_path)
        metadata = {
            "createdAt": timestamp.isoformat().replace("+00:00", "Z"),
            "sourceDatabase": str(source_path),
            "backupDatabase": str(final_path),
            "sizeBytes": final_path.stat().st_size,
            "sha256": _sha256(final_path),
            "schemaVersion": backup_check["schemaVersion"],
            "integrity": backup_check["integrity"],
            "foreignKeyViolations": backup_check["foreignKeyViolations"],
            "sourceSchemaVersion": source_check["schemaVersion"],
            "walCheckpoint": {
                "busy": checkpoint[0],
                "logFrames": checkpoint[1],
                "checkpointedFrames": checkpoint[2],
            },
        }
        metadata_partial_path.write_text(
            json.dumps(metadata, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        os.replace(metadata_partial_path, metadata_path)
        metadata["removedExpiredBackups"] = _remove_expired_backups(
            destination_directory,
            prefix,
            retention_count,
        )
        return metadata
    except OSError as exc:
        final_path.unlink(missing_ok=True)
        metadata_partial_path.unlink(missing_ok=True)
        raise DatabaseMaintenanceError(f"Could not finalize SQLite backup: {exc}") from exc
    finally:
        partial_path.unlink(missing_ok=True)


def restore_database(backup_path, destination_path, replace=False):
    """Restore a verified backup to a stopped instance or a rehearsal path."""
    source_path = Path(backup_path).resolve()
    target_path = Path(destination_path).resolve()
    if source_path == target_path:
        raise DatabaseMaintenanceError("Backup and restore destination must be different files.")
    backup_metadata = _verified_backup_metadata(source_path)
    if target_path.exists() and not replace:
        raise DatabaseMaintenanceError(
            "Restore destination already exists; use a new rehearsal path or --replace."
        )
    sidecars = [Path(f"{target_path}-wal"), Path(f"{target_path}-shm")]
    if replace and any(path.exists() for path in sidecars):
        raise DatabaseMaintenanceError(
            "Refusing to replace a database with WAL/SHM sidecars; stop the app and checkpoint first."
        )

    source_connection = _connect_existing(source_path)
    try:
        source_check = _integrity_result(source_connection)
    except Exception:
        source_connection.close()
        raise
    if source_check["schemaVersion"] != int(backup_metadata.get("schemaVersion", -1)):
        source_connection.close()
        raise DatabaseMaintenanceError("Backup schema version does not match its metadata.")

    target_path.parent.mkdir(parents=True, exist_ok=True)
    database = SQLiteDatabase(target_path)
    lease = database.acquire_writer_lease()
    partial_path = target_path.parent / f".{target_path.name}.restore-partial-{uuid4().hex}"
    destination_connection = None
    try:
        destination_connection = sqlite3.connect(str(partial_path))
        source_connection.backup(destination_connection, pages=256, sleep=0.05)
        destination_connection.commit()
        restored_check = _integrity_result(destination_connection)
        destination_connection.close()
        destination_connection = None
        if os.name != "nt":
            partial_path.chmod(0o600)
        os.replace(partial_path, target_path)
    except (sqlite3.Error, OSError) as exc:
        raise DatabaseMaintenanceError(f"SQLite restore failed: {exc}") from exc
    finally:
        if destination_connection is not None:
            destination_connection.close()
        source_connection.close()
        partial_path.unlink(missing_ok=True)
        lease.release()

    restored = inspect_database(target_path)
    if restored_check != source_check:
        raise DatabaseMaintenanceError("Restored database metadata differs from the backup.")
    restored.update(
        {
            "backup": str(source_path),
            "sha256": _sha256(target_path),
            "backupMetadataVerified": True,
        }
    )
    return restored
