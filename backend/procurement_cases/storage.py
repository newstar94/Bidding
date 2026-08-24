"""Private storage primitives for ProcurementCase attachments."""

import hashlib
import os
import uuid
from pathlib import Path, PurePosixPath

from backend.shared.paths import IMAGE_DIR


ROOT = (Path(IMAGE_DIR) / "procurement-cases").resolve()


def create_key(organization_id, case_id, extension):
    scope = hashlib.sha256(str(organization_id).encode()).hexdigest()[:24]
    case = hashlib.sha256(str(case_id).encode()).hexdigest()[:24]
    return PurePosixPath(scope, case, f"{uuid.uuid4().hex}{extension}").as_posix()


def resolve_key(key):
    candidate = PurePosixPath(str(key or ""))
    if candidate.is_absolute() or not candidate.parts or any(
        part in {"", ".", ".."} for part in candidate.parts
    ):
        raise ValueError("CASE_ATTACHMENT_STORAGE_KEY_INVALID")
    path = ROOT.joinpath(*candidate.parts).resolve()
    if os.path.commonpath((str(ROOT), str(path))) != str(ROOT):
        raise ValueError("CASE_ATTACHMENT_STORAGE_KEY_INVALID")
    return path


def persist(source_path, key):
    source = Path(source_path)
    destination = resolve_key(key)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.tmp")
    digest = hashlib.sha256(); size = 0
    try:
        with source.open("rb") as incoming, temporary.open("xb") as outgoing:
            while chunk := incoming.read(1024 * 1024):
                size += len(chunk); digest.update(chunk); outgoing.write(chunk)
            outgoing.flush(); os.fsync(outgoing.fileno())
        os.replace(temporary, destination)
        try:
            destination.chmod(0o600)
        except OSError:
            pass
    finally:
        temporary.unlink(missing_ok=True)
    return size, digest.hexdigest()


def remove(key):
    resolve_key(key).unlink(missing_ok=True)

