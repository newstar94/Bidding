"""Tamper-evident SHA-256 chain for security audit rows.

Audit appenders must hold a database write reservation while reading the tip
and inserting the next row.  :func:`append_audit_row` provides that guarantee
for standalone events.  Callers that already own a ``BEGIN IMMEDIATE``
transaction can use :func:`insert_audit_row` so the business mutation and its
audit record commit or roll back together.
"""

import hashlib
import hmac
import json
import os
import threading
import uuid
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
from backend.shared.date_utils import utc_now_sql


EMPTY_AUDIT_HASH = "0" * 64
_audit_health_lock = threading.Lock()
_audit_health_state = "unknown"


class AuditChainUnavailableError(RuntimeError):
    """A required audit write is unsafe after verifier failure."""


def set_audit_chain_health(state):
    """Publish the latest verifier result for fail-closed mutation paths."""

    normalized = str(state or "error").strip().casefold()
    if normalized not in {"unknown", "valid", "invalid", "error"}:
        normalized = "error"
    global _audit_health_state
    with _audit_health_lock:
        _audit_health_state = normalized


def require_audit_chain_available():
    """Reject required audit writes after an invalid/error verifier result.

    ``unknown`` keeps isolated unit/service calls usable when they intentionally
    do not run the ASGI lifespan. Production traffic cannot become ready until
    startup verification publishes ``valid``.
    """

    with _audit_health_lock:
        state = _audit_health_state
    if state in {"invalid", "error"}:
        raise AuditChainUnavailableError(
            "Required audit logging is unavailable because chain verification failed."
        )
    return state


@dataclass(frozen=True)
class AuditChainVerification:
    valid: bool
    row_count: int
    first_id: int | None
    first_previous_hash: str | None
    last_id: int | None
    last_hash: str | None
    failure: str | None = None


def _canonical_event(event):
    return json.dumps(event, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _entry_hash(previous_hash, event):
    payload = f"{previous_hash}\n{_canonical_event(event)}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def insert_audit_row(
    cursor,
    *,
    actor_user_id=None,
    organization_id=None,
    action,
    target_type=None,
    target_id=None,
    ip_address=None,
    metadata_json=None,
    created_at=None,
):
    timestamp = created_at or utc_now_sql()
    previous_row = cursor.execute(
        "SELECT entry_hash FROM audit_log ORDER BY id DESC LIMIT 1"
    ).fetchone()
    previous_hash = str(previous_row[0]) if previous_row else EMPTY_AUDIT_HASH
    event = {
        "actor_user_id": actor_user_id,
        "organization_id": organization_id,
        "action": action,
        "target_type": target_type,
        "target_id": target_id,
        "ip_address": ip_address,
        "metadata_json": metadata_json,
        "created_at": timestamp,
    }
    entry_hash = _entry_hash(previous_hash, event)
    cursor.execute(
        """
        INSERT INTO audit_log (
            actor_user_id, organization_id, action, target_type, target_id,
            ip_address, metadata_json, created_at, previous_hash, entry_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            actor_user_id,
            organization_id,
            action,
            target_type,
            target_id,
            ip_address,
            metadata_json,
            timestamp,
            previous_hash,
            entry_hash,
        ),
    )
    return entry_hash


def append_audit_row(connection, **event):
    """Append one event under a SQLite write reservation.

    This helper intentionally refuses an existing transaction because it
    cannot prove that a deferred transaction already owns the write lock.
    Transactional business mutations should start with ``BEGIN IMMEDIATE``
    and call :func:`insert_audit_row` on their cursor instead.
    """

    if connection.in_transaction:
        raise RuntimeError(
            "append_audit_row requires no active transaction; use "
            "insert_audit_row inside an existing BEGIN IMMEDIATE transaction."
        )
    try:
        connection.execute("BEGIN IMMEDIATE")
        entry_hash = insert_audit_row(connection.cursor(), **event)
        connection.commit()
        return entry_hash
    except Exception:
        connection.rollback()
        raise


def inspect_audit_chain(cursor):
    """Verify the current retained chain and return non-sensitive diagnostics."""

    previous_hash = None
    row_count = int(cursor.execute("SELECT count(*) FROM audit_log").fetchone()[0])
    rows = cursor.execute(
        """
        SELECT id, actor_user_id, organization_id, action, target_type, target_id,
               ip_address, metadata_json, created_at, previous_hash, entry_hash
        FROM audit_log ORDER BY id
        """
    )
    first_id = None
    first_previous_hash = None
    last_id = None
    for row in rows:
        if first_id is None:
            first_id = int(row[0])
            first_previous_hash = str(row[9])
        last_id = int(row[0])
        stored_previous = str(row[9])
        if previous_hash is not None and stored_previous != previous_hash:
            return AuditChainVerification(
                False,
                row_count,
                first_id,
                first_previous_hash,
                last_id,
                previous_hash,
                "previous_hash_mismatch",
            )
        event = {
            "actor_user_id": row[1],
            "organization_id": row[2],
            "action": row[3],
            "target_type": row[4],
            "target_id": row[5],
            "ip_address": row[6],
            "metadata_json": row[7],
            "created_at": row[8],
        }
        if _entry_hash(stored_previous, event) != str(row[10]):
            return AuditChainVerification(
                False,
                row_count,
                first_id,
                first_previous_hash,
                last_id,
                previous_hash,
                "entry_hash_mismatch",
            )
        previous_hash = str(row[10])
    return AuditChainVerification(
        True,
        row_count,
        first_id,
        first_previous_hash,
        last_id,
        previous_hash,
    )


def verify_audit_chain(cursor):
    return inspect_audit_chain(cursor).valid


def inspect_audit_chain_against_checkpoint(cursor, checkpoint, *, hmac_key=None):
    """Detect chain rollback/truncation relative to a previously anchored head."""

    verification = inspect_audit_chain(cursor)
    if not verification.valid:
        return verification
    if not verify_audit_checkpoint(checkpoint, hmac_key=hmac_key):
        return replace(verification, valid=False, failure="checkpoint_invalid")
    head = checkpoint.get("head") or {}
    checkpoint_id = head.get("id")
    checkpoint_hash = head.get("entryHash")
    if checkpoint_id is None and checkpoint_hash is None:
        return verification
    if not isinstance(checkpoint_id, int) or not isinstance(checkpoint_hash, str):
        return replace(verification, valid=False, failure="checkpoint_shape_invalid")
    anchored_row = cursor.execute(
        "SELECT entry_hash FROM audit_log WHERE id = ?", (checkpoint_id,)
    ).fetchone()
    if anchored_row:
        if not hmac.compare_digest(str(anchored_row[0]), checkpoint_hash):
            return replace(verification, valid=False, failure="checkpoint_head_mismatch")
        return verification
    # Prefix retention is provable only when the first retained event directly
    # references the anchored head.  Any other missing anchor is treated as a
    # rollback/truncation rather than silently accepting a self-consistent fork.
    if (
        verification.first_id is not None
        and verification.first_previous_hash
        and hmac.compare_digest(verification.first_previous_hash, checkpoint_hash)
    ):
        return verification
    return replace(verification, valid=False, failure="checkpoint_head_missing")


def _checkpoint_material(payload):
    return json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def build_audit_checkpoint(cursor, *, hmac_key=None):
    """Build a structural chain checkpoint without copying audit event data."""

    verification = inspect_audit_chain(cursor)
    if not verification.valid:
        raise RuntimeError(
            f"Cannot checkpoint an invalid audit chain ({verification.failure})."
        )
    payload = {
        "format": "biddingflow-audit-checkpoint",
        "version": 1,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "rowCount": verification.row_count,
        "first": {
            "id": verification.first_id,
            "previousHash": verification.first_previous_hash,
        },
        "head": {
            "id": verification.last_id,
            "entryHash": verification.last_hash,
        },
    }
    digest = hashlib.sha256(_checkpoint_material(payload)).hexdigest()
    integrity = {"algorithm": "SHA-256", "digest": digest}
    if hmac_key:
        key = str(hmac_key).encode("utf-8")
        integrity["hmacSha256"] = hmac.new(
            key, _checkpoint_material(payload), hashlib.sha256
        ).hexdigest()
    return {**payload, "integrity": integrity}


def verify_audit_checkpoint(checkpoint, *, hmac_key=None):
    if not isinstance(checkpoint, dict):
        return False
    integrity = checkpoint.get("integrity")
    if not isinstance(integrity, dict):
        return False
    payload = {key: value for key, value in checkpoint.items() if key != "integrity"}
    expected_digest = hashlib.sha256(_checkpoint_material(payload)).hexdigest()
    if not hmac.compare_digest(str(integrity.get("digest") or ""), expected_digest):
        return False
    if hmac_key:
        expected_hmac = hmac.new(
            str(hmac_key).encode("utf-8"),
            _checkpoint_material(payload),
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(
            str(integrity.get("hmacSha256") or ""), expected_hmac
        ):
            return False
    return (
        payload.get("format") == "biddingflow-audit-checkpoint"
        and payload.get("version") == 1
    )


def export_audit_checkpoint(cursor, destination, *, hmac_key=None):
    """Atomically export a uniquely named checkpoint for off-host anchoring."""

    checkpoint = build_audit_checkpoint(cursor, hmac_key=hmac_key)
    directory = Path(destination).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    head = checkpoint["head"]["entryHash"] or EMPTY_AUDIT_HASH
    filename = f"audit-checkpoint-{timestamp}-{head[:12]}.json"
    final_path = (directory / filename).resolve()
    if final_path.parent != directory:
        raise ValueError("Invalid audit checkpoint destination.")
    temporary_path = directory / f".{filename}.{uuid.uuid4().hex}.tmp"
    serialized = json.dumps(
        checkpoint, ensure_ascii=False, indent=2, sort_keys=True
    ).encode("utf-8")
    descriptor = os.open(
        temporary_path,
        os.O_CREAT | os.O_EXCL | os.O_WRONLY,
        0o600,
    )
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(serialized)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, final_path)
    except Exception:
        try:
            temporary_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise
    return final_path
