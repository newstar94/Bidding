"""Tamper-evident SHA-256 chain for security audit rows."""

import hashlib
import json
from backend.shared.date_utils import utc_now_sql


EMPTY_AUDIT_HASH = "0" * 64


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


def verify_audit_chain(cursor):
    previous_hash = None
    for row in cursor.execute(
        """
        SELECT actor_user_id, organization_id, action, target_type, target_id,
               ip_address, metadata_json, created_at, previous_hash, entry_hash
        FROM audit_log ORDER BY id
        """
    ).fetchall():
        stored_previous = str(row[8])
        if previous_hash is not None and stored_previous != previous_hash:
            return False
        event = {
            "actor_user_id": row[0],
            "organization_id": row[1],
            "action": row[2],
            "target_type": row[3],
            "target_id": row[4],
            "ip_address": row[5],
            "metadata_json": row[6],
            "created_at": row[7],
        }
        if _entry_hash(stored_previous, event) != str(row[9]):
            return False
        previous_hash = str(row[9])
    return True
