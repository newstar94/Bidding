"""Creator evidence for deletion; does not replace record/module authorization."""

import json

from backend.shared.workspace_scope import is_personal_scope_for_user


CREATOR_DELETE_TABLES = frozenset({
    "chu_dau_tu", "nha_thau", "chuyen_gia", "ke_hoach_lcnt",
    "goi_thau", "hop_dong", "thong_tin_mo_thau",
})


def creation_root(record):
    return str(record.get("id_goc") or record.get("rootId") or record.get("id") or "").strip()


def load_creator_delete_ids(cursor, organization_id, user_id, table_name, records):
    """Read the first creation audit of each original lineage, in bounded batches.

    Updating a record, receiving an assignment, or creating a later snapshot
    does not transfer the original creator's deletion eligibility.
    """
    if table_name not in CREATOR_DELETE_TABLES or not user_id:
        return set()
    records = list(records)
    roots = sorted(({creation_root(record) for record in records}
                    | {str(record.get("id") or "") for record in records}) - {""})
    evidence = {}
    for offset in range(0, len(roots), 500):
        chunk = roots[offset:offset + 500]
        placeholders = ", ".join("?" for _ in chunk)
        rows = cursor.execute(
            f"""SELECT target_id, actor_user_id, metadata_json FROM audit_log
                WHERE organization_id = ? AND target_type = ?
                  AND action = 'sync.record_created'
                  AND target_id IN ({placeholders})
                ORDER BY id""",  # noqa: S608 - placeholders only
            (organization_id, table_name, *chunk),
        ).fetchall()
        for row in rows:
            record_id = str(row[0])
            if record_id in evidence:
                continue
            try:
                metadata = json.loads(row[2] or "{}")
            except (TypeError, ValueError):
                metadata = {}
            original_root = str(metadata.get("rootAggregateId") or record_id) if isinstance(metadata, dict) else record_id
            evidence[record_id] = (str(row[1] or ""), original_root)
    owned = set()
    for record in records:
        record_id = str(record.get("id") or "")
        root = creation_root(record)
        # A mutable id_goc alone is not evidence that a row belongs to an owned
        # lineage: its immutable creation audit must agree with that lineage.
        if (evidence.get(record_id, (None, None))[1] == root
                and evidence.get(root) == (str(user_id), root)):
            owned.add(record_id)
    return owned


def attach_delete_ownership(cursor, organization_id, user_id, table_name, items):
    """Add an identity-bound UI hint only to already authorized read results.

    Sync writes ignore this non-schema field. Delete commands re-read evidence.
    """
    if table_name not in CREATOR_DELETE_TABLES or not items:
        return
    personal = is_personal_scope_for_user(organization_id, user_id)
    owned = set() if personal else load_creator_delete_ids(cursor, organization_id, user_id, table_name, items)
    for item in items:
        item["deleteOwnerUserId"] = str(user_id) if personal or str(item.get("id") or "") in owned else None
