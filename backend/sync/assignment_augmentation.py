"""Normalize explicit assignment commands without choosing an assignee."""

from __future__ import annotations

from dataclasses import dataclass

from backend.shared.helpers import clean_id
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
    received_items = measure_batch(payload)
    if received_items > batch_limit:
        raise SyncBatchLimitExceeded(
            max_items=batch_limit,
            received_items=received_items,
        )
    return 0
