"""Content-addressed immutable storage for sanitized DOCX template bytes."""

from __future__ import annotations

import hashlib
import os
import re
import uuid
from pathlib import Path

from backend.shared.paths import WORD_TEMPLATE_CATALOG_DIR


_STORAGE_KEY = re.compile(
    r"^v1/[0-9a-f]{32}/[0-9a-f]{2}/[0-9a-f]{2}/[0-9a-f]{64}\.docx$"
)
MAX_TEMPLATE_BYTES = 10 * 1024 * 1024


class ImmutableTemplateStorage:
    """Hide all filesystem paths behind validated, tenant-bound storage keys."""

    def __init__(self, root: Path | str | None = None):
        self.root = Path(root or WORD_TEMPLATE_CATALOG_DIR).resolve()

    @staticmethod
    def digest(content: bytes) -> str:
        if not isinstance(content, bytes) or not content:
            raise ValueError("Template content must be non-empty bytes.")
        if len(content) > MAX_TEMPLATE_BYTES:
            raise ValueError("Template content exceeds the 10 MiB limit.")
        return hashlib.sha256(content).hexdigest()

    @staticmethod
    def scope_digest(organization_id: str) -> str:
        scope = str(organization_id or "").strip()
        if not scope:
            raise ValueError("Template storage scope is required.")
        return hashlib.sha256(scope.encode("utf-8")).hexdigest()[:32]

    def key_for(self, organization_id: str, sha256: str) -> str:
        digest = str(sha256 or "").strip().casefold()
        if not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ValueError("Template checksum is invalid.")
        return (
            f"v1/{self.scope_digest(organization_id)}/"
            f"{digest[:2]}/{digest[2:4]}/{digest}.docx"
        )

    def _path(self, storage_key: str) -> Path:
        key = str(storage_key or "").strip()
        if not _STORAGE_KEY.fullmatch(key):
            raise ValueError("Template storage key is invalid.")
        candidate = (self.root / Path(*key.split("/"))).resolve()
        try:
            candidate.relative_to(self.root)
        except ValueError as error:
            raise ValueError("Template storage key escapes its root.") from error
        return candidate

    def put(self, organization_id: str, content: bytes) -> tuple[str, str, int]:
        digest = self.digest(content)
        storage_key = self.key_for(organization_id, digest)
        destination = self._path(storage_key)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            existing = destination.read_bytes()
            if hashlib.sha256(existing).hexdigest() != digest:
                raise RuntimeError("Immutable template storage checksum collision.")
            return storage_key, digest, len(existing)

        temporary = destination.with_name(
            f".{destination.name}.{uuid.uuid4().hex}.tmp"
        )
        try:
            with temporary.open("xb") as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
            try:
                os.link(temporary, destination)
            except FileExistsError:
                pass
            except OSError:
                if not destination.exists():
                    os.replace(temporary, destination)
            if not destination.exists():
                raise RuntimeError("Immutable template content was not persisted.")
            stored = destination.read_bytes()
            if hashlib.sha256(stored).hexdigest() != digest:
                raise RuntimeError("Immutable template storage verification failed.")
            return storage_key, digest, len(stored)
        finally:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass

    def read(
        self,
        organization_id: str,
        storage_key: str,
        expected_sha256: str,
    ) -> bytes:
        expected_key = self.key_for(organization_id, expected_sha256)
        if storage_key != expected_key:
            raise ValueError("Template storage key is not bound to this scope/checksum.")
        path = self._path(storage_key)
        content = path.read_bytes()
        if len(content) > MAX_TEMPLATE_BYTES:
            raise RuntimeError("Stored template exceeds the supported size.")
        if hashlib.sha256(content).hexdigest() != expected_sha256:
            raise RuntimeError("Stored template checksum does not match its version.")
        return content

    def exists(self, organization_id: str, storage_key: str, sha256: str) -> bool:
        try:
            self.read(organization_id, storage_key, sha256)
        except (FileNotFoundError, RuntimeError, ValueError):
            return False
        return True
