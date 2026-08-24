"""Private, atomically published ZIP storage for bulk exports."""

import hashlib
import os
import uuid
from pathlib import Path, PurePosixPath

from backend.shared.paths import BULK_EXPORT_DIR


def storage_key(organization_id, operation_id):
    scope = hashlib.sha256(str(organization_id).encode()).hexdigest()[:24]
    operation = hashlib.sha256(str(operation_id).encode()).hexdigest()[:24]
    return PurePosixPath(scope, operation, f"{uuid.uuid4().hex}.zip").as_posix()


def resolve_path(key):
    candidate = PurePosixPath(str(key or ""))
    if candidate.is_absolute() or not candidate.parts or any(
        part in {"", ".", ".."} for part in candidate.parts
    ):
        raise ValueError("BULK_ARTIFACT_STORAGE_KEY_INVALID")
    root = Path(BULK_EXPORT_DIR).resolve()
    path = root.joinpath(*candidate.parts).resolve()
    if os.path.commonpath((str(root), str(path))) != str(root):
        raise ValueError("BULK_ARTIFACT_STORAGE_KEY_INVALID")
    return path


def publish_bytes(key, content):
    path = resolve_path(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("xb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        try:
            path.chmod(0o600)
        except OSError:
            pass
    finally:
        temporary.unlink(missing_ok=True)
    return path


def remove(key):
    resolve_path(key).unlink(missing_ok=True)


def purge_expired_artifacts(database, *, limit=200):
    """Remove expired bytes while retaining DB/audit metadata."""
    connection = database.get_connection()
    try:
        exists = connection.execute(
            """SELECT 1 FROM information_schema.tables
                WHERE table_schema = current_schema()
                  AND table_name = 'bulk_operation_artifact'"""
        ).fetchone()
        if not exists:
            return 0
        rows = connection.execute(
            """SELECT storage_key FROM bulk_operation_artifact
                WHERE expires_at::timestamptz <= CURRENT_TIMESTAMP
                ORDER BY expires_at LIMIT ?""",
            (int(limit),),
        ).fetchall()
    finally:
        connection.close()
    purged = 0
    for row in rows:
        path = resolve_path(row[0])
        if path.is_file():
            path.unlink()
            purged += 1
    return purged
