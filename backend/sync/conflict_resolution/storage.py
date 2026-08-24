"""Encrypted PostgreSQL repository for actor/workspace conflict drafts."""

from __future__ import annotations

import hashlib
import json
import os
import time
import uuid

from cryptography.fernet import Fernet, InvalidToken


RETENTION_SECONDS = 30 * 24 * 60 * 60
MAX_ACTIVE_DRAFTS = 20


class DraftStorageError(ValueError):
    pass


def _fernet(environ=None) -> Fernet:
    environment = os.environ if environ is None else environ
    value = str(environment.get("CONFLICT_DRAFT_ENCRYPTION_KEY") or "").strip()
    try:
        return Fernet(value.encode("ascii"))
    except (ValueError, TypeError) as error:
        raise RuntimeError("CONFLICT_DRAFT_ENCRYPTION_KEY must be a valid Fernet key.") from error


def _canonical_bytes(payload: dict) -> bytes:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


class ConflictDraftRepository:
    def __init__(self, cursor, *, environ=None, now=None):
        self.cursor = cursor
        self.environ = environ
        self.now = int(time.time() if now is None else now)

    def _encrypt(self, payload: dict) -> tuple[str, str]:
        raw = _canonical_bytes(payload)
        return (
            _fernet(self.environ).encrypt(raw).decode("ascii"),
            hashlib.sha256(raw).hexdigest(),
        )

    def _decrypt(self, ciphertext: str, expected_digest: str) -> dict:
        try:
            raw = _fernet(self.environ).decrypt(str(ciphertext).encode("ascii"))
        except (InvalidToken, ValueError, TypeError) as error:
            raise DraftStorageError("CORRUPT_DRAFT") from error
        if hashlib.sha256(raw).hexdigest() != str(expected_digest):
            raise DraftStorageError("CORRUPT_DRAFT")
        try:
            payload = json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise DraftStorageError("CORRUPT_DRAFT") from error
        if not isinstance(payload, dict):
            raise DraftStorageError("CORRUPT_DRAFT")
        return payload

    def purge_expired(self) -> int:
        self.cursor.execute(
            "DELETE FROM conflict_resolution_drafts WHERE expires_at <= ?",
            (self.now,),
        )
        return int(self.cursor.rowcount or 0)

    def create(
        self,
        *,
        organization_id: str,
        actor_user_id: str,
        workspace_fingerprint: str,
        batch_id: str,
        mutation_id: str,
        entity_type: str,
        table_name: str,
        record_id: str,
        expected_row_version: int,
        server_row_version: int,
        payload: dict,
    ) -> dict:
        ciphertext, digest = self._encrypt(payload)
        self.purge_expired()
        existing = self.cursor.execute(
            """SELECT id, payload_sha256, status FROM conflict_resolution_drafts
               WHERE organization_id = ? AND actor_user_id = ?
                 AND workspace_fingerprint = ? AND batch_id = ?
                 AND mutation_id = ? AND table_name = ? AND record_id = ?
               LIMIT 1""",
            (
                organization_id, actor_user_id, workspace_fingerprint, batch_id,
                mutation_id, table_name, record_id,
            ),
        ).fetchone()
        if existing:
            if str(existing[1]) != digest or str(existing[2]) != "ACTIVE":
                raise DraftStorageError("IDEMPOTENCY_CONFLICT")
            return self.get_metadata(
                organization_id=organization_id,
                actor_user_id=actor_user_id,
                workspace_fingerprint=workspace_fingerprint,
                draft_id=str(existing[0]),
            )

        # Protect the newly captured draft even when many inserts share the
        # same second-level timestamp: reduce existing active rows to 19 first.
        self.cursor.execute(
            """DELETE FROM conflict_resolution_drafts
               WHERE organization_id = ? AND actor_user_id = ?
                 AND workspace_fingerprint = ? AND id IN (
                 SELECT id FROM conflict_resolution_drafts
                 WHERE organization_id = ? AND actor_user_id = ?
                   AND workspace_fingerprint = ? AND status = 'ACTIVE'
                 ORDER BY created_at DESC, id DESC OFFSET ?
               )""",
            (
                organization_id,
                actor_user_id,
                workspace_fingerprint,
                organization_id,
                actor_user_id,
                workspace_fingerprint,
                MAX_ACTIVE_DRAFTS - 1,
            ),
        )

        draft_id = str(uuid.uuid4())
        expires_at = self.now + RETENTION_SECONDS
        self.cursor.execute(
            """INSERT INTO conflict_resolution_drafts (
                 id, organization_id, actor_user_id, workspace_fingerprint,
                 batch_id, mutation_id, entity_type, table_name, record_id,
                 expected_row_version, server_row_version, payload_ciphertext,
                 payload_sha256, status, created_at, updated_at, expires_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)""",
            (
                draft_id, organization_id, actor_user_id, workspace_fingerprint,
                batch_id, mutation_id, entity_type, table_name, record_id,
                expected_row_version, server_row_version, ciphertext, digest,
                self.now, self.now, expires_at,
            ),
        )
        return self.get_metadata(
            organization_id=organization_id,
            actor_user_id=actor_user_id,
            workspace_fingerprint=workspace_fingerprint,
            draft_id=draft_id,
        )

    def get_metadata(self, *, organization_id, actor_user_id, workspace_fingerprint, draft_id):
        row = self.cursor.execute(
            """SELECT id, entity_type, table_name, record_id, expected_row_version,
                      server_row_version, status, created_at, updated_at, expires_at,
                      payload_sha256
               FROM conflict_resolution_drafts
               WHERE organization_id = ? AND actor_user_id = ?
                 AND workspace_fingerprint = ? AND id = ? AND expires_at > ?
               LIMIT 1""",
            (organization_id, actor_user_id, workspace_fingerprint, draft_id, self.now),
        ).fetchone()
        if not row:
            return None
        return {
            "id": str(row[0]), "entityType": str(row[1]), "tableName": str(row[2]),
            "recordId": str(row[3]), "expectedRowVersion": int(row[4]),
            "serverRowVersion": int(row[5]), "status": str(row[6]),
            "createdAt": int(row[7]), "updatedAt": int(row[8]),
            "expiresAt": int(row[9]), "payloadDigest": str(row[10]),
        }

    def load(self, *, organization_id, actor_user_id, workspace_fingerprint, draft_id):
        row = self.cursor.execute(
            """SELECT id, entity_type, table_name, record_id, expected_row_version,
                      server_row_version, status, created_at, updated_at, expires_at,
                      payload_sha256, payload_ciphertext
               FROM conflict_resolution_drafts
               WHERE organization_id = ? AND actor_user_id = ?
                 AND workspace_fingerprint = ? AND id = ? AND status = 'ACTIVE'
                 AND expires_at > ? LIMIT 1""",
            (organization_id, actor_user_id, workspace_fingerprint, draft_id, self.now),
        ).fetchone()
        if not row:
            return None
        metadata = {
            "id": str(row[0]), "entityType": str(row[1]), "tableName": str(row[2]),
            "recordId": str(row[3]), "expectedRowVersion": int(row[4]),
            "serverRowVersion": int(row[5]), "status": str(row[6]),
            "createdAt": int(row[7]), "updatedAt": int(row[8]),
            "expiresAt": int(row[9]), "payloadDigest": str(row[10]),
        }
        metadata["payload"] = self._decrypt(str(row[11]), str(row[10]))
        return metadata

    def list_active(self, *, organization_id, actor_user_id, workspace_fingerprint):
        self.purge_expired()
        rows = self.cursor.execute(
            """SELECT id FROM conflict_resolution_drafts
               WHERE organization_id = ? AND actor_user_id = ?
                 AND workspace_fingerprint = ? AND status = 'ACTIVE'
                 AND expires_at > ? ORDER BY updated_at DESC, id DESC LIMIT ?""",
            (organization_id, actor_user_id, workspace_fingerprint, self.now, MAX_ACTIVE_DRAFTS),
        ).fetchall()
        return [
            self.get_metadata(
                organization_id=organization_id,
                actor_user_id=actor_user_id,
                workspace_fingerprint=workspace_fingerprint,
                draft_id=str(row[0]),
            )
            for row in rows
        ]

    def discard(self, *, organization_id, actor_user_id, workspace_fingerprint, draft_id) -> bool:
        self.cursor.execute(
            """DELETE FROM conflict_resolution_drafts
               WHERE organization_id = ? AND actor_user_id = ?
                 AND workspace_fingerprint = ? AND id = ?""",
            (organization_id, actor_user_id, workspace_fingerprint, draft_id),
        )
        return self.cursor.rowcount == 1

    def mark_resolved(self, *, organization_id, actor_user_id, workspace_fingerprint, draft_id, mutation_id):
        self.cursor.execute(
            """UPDATE conflict_resolution_drafts
               SET status = 'RESOLVED', payload_ciphertext = NULL,
                   resolution_mutation_id = ?, updated_at = ?
               WHERE organization_id = ? AND actor_user_id = ?
                 AND workspace_fingerprint = ? AND id = ? AND status = 'ACTIVE'""",
            (mutation_id, self.now, organization_id, actor_user_id, workspace_fingerprint, draft_id),
        )
        return self.cursor.rowcount == 1
