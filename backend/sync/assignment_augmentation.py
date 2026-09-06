"""Normalize assignments and self-assign newly created specialist records."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import NAMESPACE_URL, uuid5

from backend.shared.helpers import clean_id
from backend.shared.access_principals import (
    is_assignment_scoped_active_role,
    is_organization_manager,
)
from backend.shared.access_policy import ASSIGNED_TABLE_TYPES
from backend.sync.request_contract import sync_batch_size


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

    assignments = payload.setdefault("assignments", [])
    deduplicated_assignments = []
    seen_memberships = set()
    for item in assignments:
        if not isinstance(item, dict):
            deduplicated_assignments.append(item)
            continue
        membership = (
            clean_id(item.get("empId") or item.get("id_nhan_vien")),
            clean_id(item.get("targetId") or item.get("id_muc_tieu")),
            str(item.get("type") or item.get("loai_doi_tuong") or "").strip(),
        )
        if all(membership) and membership in seen_memberships:
            continue
        if all(membership):
            seen_memberships.add(membership)
        deduplicated_assignments.append(item)
    if len(deduplicated_assignments) != len(assignments):
        assignments[:] = deduplicated_assignments
    added = 0
    actor = transaction_context.actor
    if is_assignment_scoped_active_role(
        getattr(actor.role, "active_role", None) or str(actor.role),
        transaction_context.owner_type,
    ) and not is_organization_manager(
        cursor, actor.role, actor.user_id, actor.organization_id,
    ):
        for table, kind in ASSIGNED_TABLE_TYPES.items():
            records = payload.get(kind, [])
            record_ids = {clean_id(item.get("id")) for item in records}
            record_ids.discard(None)
            lookup_ids = record_ids | {
                clean_id(item.get("rootId") or item.get("id_goc"))
                for item in records
            }
            lookup_ids.discard(None)
            lookup_ids.discard("")
            existing = set()
            ordered_ids = sorted(lookup_ids)
            for start in range(0, len(ordered_ids), 500):
                chunk = ordered_ids[start:start + 500]
                placeholders = ", ".join("?" for _ in chunk)
                rows = cursor.execute(
                    f"SELECT id FROM {table} WHERE organization_id = ? AND id IN ({placeholders})",
                    (actor.organization_id, *chunk),
                ).fetchall()
                existing.update(str(row[0]) for row in rows)
            for item in records:
                record_id = clean_id(item.get("id"))
                root_id = clean_id(item.get("rootId") or item.get("id_goc")) or record_id
                membership = (clean_id(actor.user_id), record_id, kind)
                # Never re-grant a transferred record, or turn a new snapshot of
                # an existing lineage into an independent create permission.
                if (not record_id or record_id in existing or root_id in existing
                        or root_id not in record_ids or membership in seen_memberships):
                    continue
                assignments.append({
                    "id": str(uuid5(NAMESPACE_URL, f"biddingflow:create-assignment:{actor.organization_id}:{kind}:{record_id}:{actor.user_id}")),
                    "empId": actor.user_id,
                    "targetId": record_id,
                    "type": kind,
                })
                seen_memberships.add(membership)
                added += 1
    received_items = measure_batch(payload)
    if received_items > batch_limit:
        raise SyncBatchLimitExceeded(
            max_items=batch_limit,
            received_items=received_items,
        )
    return added
