"""Add default assignee commands for new organization-owned business records."""

from __future__ import annotations

from dataclasses import dataclass

from backend.db.id_utils import generate_record_id
from backend.shared.helpers import clean_id
from backend.sync.request_contract import sync_batch_size


_NEW_RECORD_LOOKUPS = (
    (
        "kehoach",
        "kehoach",
        "ke_hoach_lcnt",
    ),
    (
        "goithau",
        "goithau",
        "goi_thau",
    ),
    (
        "hopdong",
        "hopdong",
        "hop_dong",
    ),
)

_QUERY_CHUNK_SIZE = 500


def _stored_ids(cursor, table_name: str, organization_id: str, record_ids):
    stored = set()
    ordered_ids = list(record_ids)
    for offset in range(0, len(ordered_ids), _QUERY_CHUNK_SIZE):
        chunk = ordered_ids[offset:offset + _QUERY_CHUNK_SIZE]
        placeholders = ", ".join("?" for _ in chunk)
        rows = cursor.execute(
            f"SELECT id FROM {table_name} "
            f"WHERE organization_id = ? AND id IN ({placeholders})",
            (organization_id, *chunk),
        ).fetchall()
        stored.update(clean_id(row[0]) for row in rows if row)
    return stored


@dataclass(frozen=True, slots=True)
class SyncBatchLimitExceeded(ValueError):
    max_items: int
    received_items: int


def augment_default_assignments(
    cursor,
    transaction_context,
    payload,
    *,
    batch_limit: int,
    measure_batch=sync_batch_size,
) -> int:
    if transaction_context.owner_type != "organization":
        return 0

    actor = transaction_context.actor
    assignments = payload.setdefault("assignments", [])
    incoming_targets = {
        (
            clean_id(item.get("targetId") or item.get("id_muc_tieu")),
            str(item.get("type") or item.get("loai_doi_tuong") or "").strip(),
        )
        for item in assignments
        if isinstance(item, dict)
    }
    added = 0
    for payload_key, target_type, table_name in _NEW_RECORD_LOOKUPS:
        candidate_ids = []
        seen_candidate_ids = set()
        for item in payload.get(payload_key, []):
            if not isinstance(item, dict):
                continue
            record_id = clean_id(item.get("id"))
            if (
                not record_id
                or (record_id, target_type) in incoming_targets
                or record_id in seen_candidate_ids
            ):
                continue
            candidate_ids.append(record_id)
            seen_candidate_ids.add(record_id)

        stored_ids = _stored_ids(
            cursor,
            table_name,
            actor.organization_id,
            candidate_ids,
        )
        for record_id in candidate_ids:
            if record_id in stored_ids:
                continue
            assignments.append({
                "id": generate_record_id("assignments"),
                "empId": actor.user_id,
                "targetId": record_id,
                "type": target_type,
            })
            incoming_targets.add((record_id, target_type))
            added += 1

    received_items = measure_batch(payload)
    if received_items > batch_limit:
        raise SyncBatchLimitExceeded(
            max_items=batch_limit,
            received_items=received_items,
        )
    return added
