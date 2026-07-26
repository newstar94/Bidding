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
        "SELECT 1 FROM ke_hoach_lcnt WHERE organization_id = ? AND id = ? LIMIT 1",
    ),
    (
        "goithau",
        "goithau",
        "SELECT 1 FROM goi_thau WHERE organization_id = ? AND id = ? LIMIT 1",
    ),
    (
        "hopdong",
        "hopdong",
        "SELECT 1 FROM hop_dong WHERE organization_id = ? AND id = ? LIMIT 1",
    ),
)


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
    for payload_key, target_type, exists_sql in _NEW_RECORD_LOOKUPS:
        for item in payload.get(payload_key, []):
            if not isinstance(item, dict):
                continue
            record_id = clean_id(item.get("id"))
            if not record_id or (record_id, target_type) in incoming_targets:
                continue
            exists = cursor.execute(
                exists_sql,
                (actor.organization_id, record_id),
            ).fetchone()
            if exists:
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
