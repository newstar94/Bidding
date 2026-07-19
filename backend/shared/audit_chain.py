"""Tamper-evident SHA-256 chain for security audit rows.

Audit appenders must hold a database write reservation while reading the tip
and inserting the next row.  :func:`append_audit_row` provides that guarantee
for standalone events.  Callers that already own a ``BEGIN``
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
from backend.shared.date_utils import vietnam_now_sql


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
    heads: tuple[dict, ...] = ()


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
    timestamp = created_at or vietnam_now_sql()
    chain_id = str(organization_id or "global")
    cursor.execute(
        """INSERT INTO audit_chain_heads (
             chain_id, last_sequence, last_log_id, last_hash
           ) VALUES (?, 0, NULL, ?)
           ON CONFLICT (chain_id) DO NOTHING""",
        (chain_id, EMPTY_AUDIT_HASH),
    )
    head = cursor.execute(
        """SELECT last_sequence, last_hash
           FROM audit_chain_heads WHERE chain_id = ? FOR UPDATE""",
        (chain_id,),
    ).fetchone()
    if not head:
        raise RuntimeError("Audit chain head could not be locked.")
    sequence = int(head[0]) + 1
    previous_hash = str(head[1])
    event = {
        "chain_id": chain_id,
        "sequence": sequence,
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
    inserted = cursor.execute(
        """
        INSERT INTO audit_log (
            chain_id, sequence, actor_user_id, organization_id, action, target_type, target_id,
            ip_address, metadata_json, created_at, previous_hash, entry_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id
        """,
        (
            chain_id,
            sequence,
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
    ).fetchone()
    if not inserted:
        raise RuntimeError("Audit log row was not inserted.")
    cursor.execute(
        """UPDATE audit_chain_heads
           SET last_sequence = ?, last_log_id = ?, last_hash = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE chain_id = ?""",
        (sequence, int(inserted[0]), entry_hash, chain_id),
    )
    return entry_hash


def append_audit_row(connection, **event):
    """Append one event while locking only the applicable chain head."""

    if connection.in_transaction:
        raise RuntimeError(
            "append_audit_row requires no active transaction; use "
            "insert_audit_row inside an existing BEGIN transaction."
        )
    try:
        connection.execute("BEGIN")
        entry_hash = insert_audit_row(connection.cursor(), **event)
        connection.commit()
        return entry_hash
    except Exception:
        connection.rollback()
        raise


def inspect_audit_chain(cursor):
    """Verify every tenant chain and its materialized head."""

    row_count = int(cursor.execute("SELECT count(*) FROM audit_log").fetchone()[0])
    rows = cursor.execute(
        """
        SELECT id, chain_id, sequence, actor_user_id, organization_id, action, target_type, target_id,
               ip_address, metadata_json, created_at, previous_hash, entry_hash
        FROM audit_log ORDER BY chain_id, sequence
        """
    )
    first_id = None
    first_previous_hash = None
    last_id = None
    current_chain = None
    previous_hash = None
    expected_sequence = 0
    heads = []
    for row in rows:
        chain_id = str(row[1])
        sequence = int(row[2])
        if chain_id != current_chain:
            if current_chain is not None:
                heads.append(
                    {
                        "chainId": current_chain,
                        "sequence": expected_sequence,
                        "id": last_chain_id,
                        "entryHash": previous_hash,
                    }
                )
            current_chain = chain_id
            previous_hash = EMPTY_AUDIT_HASH
            expected_sequence = 0
            last_chain_id = None
        if first_id is None:
            first_id = int(row[0])
            first_previous_hash = str(row[11])
        last_id = int(row[0])
        last_chain_id = int(row[0])
        stored_previous = str(row[11])
        if sequence != expected_sequence + 1:
            return AuditChainVerification(
                False,
                row_count,
                first_id,
                first_previous_hash,
                last_id,
                previous_hash,
                "sequence_mismatch",
            )
        if stored_previous != previous_hash:
            return AuditChainVerification(
                False, row_count, first_id, first_previous_hash,
                last_id, previous_hash, "previous_hash_mismatch"
            )
        event = {
            "chain_id": chain_id,
            "sequence": sequence,
            "actor_user_id": row[3],
            "organization_id": row[4],
            "action": row[5],
            "target_type": row[6],
            "target_id": row[7],
            "ip_address": row[8],
            "metadata_json": row[9],
            "created_at": row[10],
        }
        if _entry_hash(stored_previous, event) != str(row[12]):
            return AuditChainVerification(
                False,
                row_count,
                first_id,
                first_previous_hash,
                last_id,
                previous_hash,
                "entry_hash_mismatch",
            )
        previous_hash = str(row[12])
        expected_sequence = sequence
    if current_chain is not None:
        heads.append(
            {
                "chainId": current_chain,
                "sequence": expected_sequence,
                "id": last_chain_id,
                "entryHash": previous_hash,
            }
        )
    stored_heads = {
        str(row[0]): (int(row[1]), row[2], str(row[3]))
        for row in cursor.execute(
            "SELECT chain_id, last_sequence, last_log_id, last_hash FROM audit_chain_heads"
        ).fetchall()
    }
    calculated_heads = {
        head["chainId"]: (head["sequence"], head["id"], head["entryHash"])
        for head in heads
    }
    empty_heads = {
        chain_id: values
        for chain_id, values in stored_heads.items()
        if values == (0, None, EMPTY_AUDIT_HASH)
    }
    if {**calculated_heads, **empty_heads} != stored_heads:
        return AuditChainVerification(
            False, row_count, first_id, first_previous_hash,
            last_id, previous_hash, "materialized_head_mismatch", tuple(heads)
        )
    aggregate_hash = hashlib.sha256(_checkpoint_material(heads)).hexdigest()
    return AuditChainVerification(
        True,
        row_count,
        first_id,
        first_previous_hash,
        last_id,
        aggregate_hash,
        heads=tuple(heads),
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
    installation_row = cursor.execute(
        "SELECT installation_id FROM database_metadata WHERE id = 1"
    ).fetchone()
    if (
        not installation_row
        or not hmac.compare_digest(
            str(installation_row[0]), str(checkpoint.get("installationId") or "")
        )
    ):
        return replace(verification, valid=False, failure="checkpoint_installation_mismatch")
    checkpoint_heads = checkpoint.get("heads")
    if not isinstance(checkpoint_heads, list):
        return replace(verification, valid=False, failure="checkpoint_shape_invalid")
    for head in checkpoint_heads:
        if not isinstance(head, dict):
            return replace(verification, valid=False, failure="checkpoint_shape_invalid")
        chain_id = head.get("chainId")
        checkpoint_id = head.get("id")
        checkpoint_hash = head.get("entryHash")
        if not isinstance(chain_id, str) or not isinstance(checkpoint_id, int) or not isinstance(checkpoint_hash, str):
            return replace(verification, valid=False, failure="checkpoint_shape_invalid")
        anchored_row = cursor.execute(
            "SELECT entry_hash FROM audit_log WHERE chain_id = ? AND id = ?",
            (chain_id, checkpoint_id),
        ).fetchone()
        if not anchored_row:
            return replace(verification, valid=False, failure="checkpoint_head_missing")
        if not hmac.compare_digest(str(anchored_row[0]), checkpoint_hash):
            return replace(verification, valid=False, failure="checkpoint_head_mismatch")
    return verification


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
    installation_row = cursor.execute(
        "SELECT installation_id FROM database_metadata WHERE id = 1"
    ).fetchone()
    if not installation_row or not str(installation_row[0] or "").strip():
        raise RuntimeError("Database installation identity is unavailable.")
    payload = {
        "format": "biddingflow-audit-checkpoint",
        "version": 3,
        "installationId": str(installation_row[0]),
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "rowCount": verification.row_count,
        "heads": list(verification.heads),
        "aggregateHash": verification.last_hash,
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
        and payload.get("version") == 3
        and isinstance(payload.get("installationId"), str)
        and bool(payload.get("installationId"))
    )


def export_audit_checkpoint(cursor, destination, *, hmac_key=None):
    """Atomically export a uniquely named checkpoint for off-host anchoring."""

    checkpoint = build_audit_checkpoint(cursor, hmac_key=hmac_key)
    directory = Path(destination).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    aggregate_hash = checkpoint.get("aggregateHash") or EMPTY_AUDIT_HASH
    filename = f"audit-checkpoint-{timestamp}-{aggregate_hash[:12]}.json"
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
