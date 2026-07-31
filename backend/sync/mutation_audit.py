"""Immutable evidence for material records changed through sync."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from typing import Any, Iterable

from backend.activity.service import changed_business_fields
from backend.shared.audit_chain import insert_audit_row


_TECHNICAL_FIELDS = frozenset({
    "organization_id",
    "owner_type",
    "sync_version",
    "row_version",
    "created_at",
    "updated_at",
    "is_latest",
})
_SECRET_KEYS = frozenset({
    "authorization",
    "cookie",
    "matkhau",
    "password",
    "passwordhash",
    "privatekey",
    "secret",
    "session",
    "sessiontoken",
    "token",
    "tokenhash",
})


def _normalized_key(value: object) -> str:
    return "".join(character for character in str(value or "").lower() if character.isalnum())


def _hash_projection(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            str(key): _hash_projection(item)
            for key, item in sorted(value.items(), key=lambda pair: str(pair[0]))
            if str(key) not in _TECHNICAL_FIELDS
            and _normalized_key(key) not in _SECRET_KEYS
            and not str(key).startswith("_")
        }
    if isinstance(value, (list, tuple)):
        return [_hash_projection(item) for item in value]
    return value


def business_record_hash(record: dict[str, Any] | None) -> str | None:
    if record is None:
        return None
    encoded = json.dumps(
        _hash_projection(record),
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
        default=str,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


@dataclass(frozen=True, slots=True)
class MutationAuditEvent:
    action: str
    target_type: str
    target_id: str
    metadata: dict[str, Any]


def build_mutation_audit_event(
    table_name: str,
    previous_record: dict[str, Any] | None,
    current_record: dict[str, Any],
    *,
    client_mutation_id: str | None,
    request_id: str | None,
) -> MutationAuditEvent | None:
    target_id = str(current_record.get("id") or "").strip()
    if not target_id:
        return None
    changed_fields = [
        field
        for field in changed_business_fields(previous_record, current_record)
        if _normalized_key(field) not in _SECRET_KEYS
    ]
    if previous_record is not None and not changed_fields:
        return None
    root_id = str(
        current_record.get("id_goc")
        or current_record.get("rootId")
        or target_id
    ).strip()
    return MutationAuditEvent(
        action="sync.record_created" if previous_record is None else "sync.record_updated",
        target_type=table_name,
        target_id=target_id,
        metadata={
            "rootAggregateId": root_id,
            "changedFields": changed_fields,
            "beforeHash": business_record_hash(previous_record),
            "afterHash": business_record_hash(current_record),
            "clientMutationId": client_mutation_id or None,
            "requestId": request_id or None,
            "redactionClassification": "business-hash-only",
        },
    )


def insert_mutation_audit_events(
    cursor,
    *,
    actor_user_id: str,
    organization_id: str,
    ip_address: str | None,
    events: Iterable[MutationAuditEvent],
) -> int:
    inserted = 0
    for event in events:
        insert_audit_row(
            cursor,
            actor_user_id=actor_user_id,
            organization_id=organization_id,
            action=event.action,
            target_type=event.target_type,
            target_id=event.target_id,
            ip_address=ip_address,
            metadata_json=json.dumps(
                event.metadata,
                ensure_ascii=False,
                separators=(",", ":"),
                default=str,
            ),
        )
        inserted += 1
    return inserted
