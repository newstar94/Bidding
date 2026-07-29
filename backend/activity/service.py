"""Transactional activity collection, persistence, and timeline queries."""

from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Any, Iterable

from backend.db.id_utils import generate_record_id


_QUERY_CHUNK_SIZE = 200
_MAX_METADATA_BYTES = 32_768
_REDACTED_KEYS = frozenset({
    "password", "mat_khau", "token", "secret", "session",
    "authorization", "cookie", "storage_key", "sha256",
})
_TECHNICAL_FIELDS = frozenset({
    "id", "organization_id", "owner_type", "sync_version", "row_version",
    "created_at", "updated_at", "is_latest",
})
_RECORD_ACTIONS = {
    "goi_thau": ("goithau", "goithau.created", "goithau.updated"),
    "hop_dong": ("hopdong", "hopdong.created", "hopdong.updated"),
}


@dataclass(frozen=True, slots=True)
class ActivityEvent:
    target_type: str
    target_id: str
    target_root_id: str
    action: str
    metadata: dict[str, Any]
    related_document_id: str | None = None
    related_assignment_id: str | None = None
    client_mutation_id: str | None = None
    request_id: str | None = None


def _normalized(value: Any) -> Any:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        return {str(key): _normalized(item) for key, item in sorted(value.items())}
    if isinstance(value, (list, tuple)):
        return [_normalized(item) for item in value]
    return value


def changed_business_fields(
    previous: dict[str, Any] | None,
    current: dict[str, Any],
) -> list[str]:
    if previous is None:
        return sorted(key for key in current if key not in _TECHNICAL_FIELDS)
    keys = (set(previous) | set(current)) - _TECHNICAL_FIELDS
    return sorted(
        key for key in keys
        if _normalized(previous.get(key)) != _normalized(current.get(key))
    )


def build_record_activity_event(
    table_name: str,
    previous: dict[str, Any] | None,
    current: dict[str, Any],
    *,
    client_mutation_id: str | None,
) -> ActivityEvent | None:
    action_names = _RECORD_ACTIONS.get(table_name)
    if not action_names:
        return None
    changed_fields = changed_business_fields(previous, current)
    if previous is not None and not changed_fields:
        return None
    target_type, created_action, updated_action = action_names
    target_id = str(current.get("id") or "").strip()
    target_root_id = str(
        current.get("id_goc")
        or current.get("rootId")
        or target_id
    ).strip()
    if not target_id or not target_root_id:
        return None
    return ActivityEvent(
        target_type=target_type,
        target_id=target_id,
        target_root_id=target_root_id,
        action=created_action if previous is None else updated_action,
        metadata={"changedFields": changed_fields},
        client_mutation_id=client_mutation_id or None,
    )


def build_assignment_activity_events(
    before: dict,
    after: dict,
    *,
    client_mutation_id: str | None,
) -> list[ActivityEvent]:
    events: list[ActivityEvent] = []
    for key in sorted(set(before) | set(after)):
        old = before.get(key)
        new = after.get(key)
        if old is not None and new is not None:
            continue
        item = new or old
        events.append(ActivityEvent(
            target_type=item["target_type"],
            target_id=item["target_id"],
            target_root_id=item.get("target_root_id") or item["target_id"],
            action="assignment.added" if new else "assignment.removed",
            related_assignment_id=item.get("assignment_id"),
            client_mutation_id=client_mutation_id or None,
            metadata={
                "assigneeId": item["user_id"],
                "assigneeName": item.get("user_name") or "Không xác định",
            },
        ))
    return events


def _sanitize(value: Any, *, depth: int = 0) -> Any:
    if depth > 4:
        return "[truncated]"
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return value[:1000]
    if isinstance(value, dict):
        result = {}
        for raw_key, item in list(value.items())[:100]:
            key = str(raw_key)[:100]
            if key.casefold() in _REDACTED_KEYS:
                continue
            result[key] = _sanitize(item, depth=depth + 1)
        return result
    if isinstance(value, (list, tuple, set)):
        return [_sanitize(item, depth=depth + 1) for item in list(value)[:100]]
    return str(value)[:1000]


def sanitize_metadata(metadata: dict[str, Any] | None) -> str:
    safe = _sanitize(metadata or {})
    encoded = json.dumps(safe, ensure_ascii=False, separators=(",", ":"))
    if len(encoded.encode("utf-8")) <= _MAX_METADATA_BYTES:
        return encoded
    return json.dumps(
        {"truncated": True, "changedFields": safe.get("changedFields", [])[:100]},
        ensure_ascii=False,
        separators=(",", ":"),
    )


def _actor_snapshot(cursor, actor_user_id: str | None) -> str:
    if not actor_user_id:
        return "Không xác định"
    row = cursor.execute(
        """SELECT COALESCE(NULLIF(trim(ho_ten), ''), ten_dang_nhap, email, ?)
           FROM tai_khoan WHERE id = ? LIMIT 1""",
        (actor_user_id, actor_user_id),
    ).fetchone()
    return str(row[0] or actor_user_id).strip() if row else str(actor_user_id)


def insert_activity_events(
    cursor,
    *,
    organization_id: str,
    owner_type: str,
    actor_user_id: str | None,
    occurred_at: Any,
    events: Iterable[ActivityEvent],
) -> int:
    unique_events = []
    seen = set()
    for event in events:
        identity = (
            event.action,
            event.target_type,
            event.target_id,
            event.related_document_id or "",
            event.related_assignment_id or "",
        )
        if identity in seen:
            continue
        seen.add(identity)
        unique_events.append(event)
    if not unique_events:
        return 0
    actor_name = _actor_snapshot(cursor, actor_user_id)
    inserted = 0
    for offset in range(0, len(unique_events), _QUERY_CHUNK_SIZE):
        chunk = unique_events[offset:offset + _QUERY_CHUNK_SIZE]
        rows = [(
            generate_record_id("nhat_ky_thuc_hien"),
            organization_id,
            owner_type,
            event.target_type,
            event.target_id,
            event.target_root_id,
            event.action,
            actor_user_id,
            actor_name,
            occurred_at,
            event.related_document_id,
            event.related_assignment_id,
            event.client_mutation_id,
            event.request_id,
            sanitize_metadata(event.metadata),
        ) for event in chunk]
        value_sql = ", ".join("(" + ", ".join("?" for _ in row) + ")" for row in rows)
        cursor.execute(
            f"""INSERT INTO nhat_ky_thuc_hien (
                    id, organization_id, owner_type, target_type, target_id,
                    target_root_id, action, actor_user_id, actor_name_snapshot,
                    occurred_at, related_document_id, related_assignment_id,
                    client_mutation_id, request_id, metadata_json
                ) VALUES {value_sql}
                ON CONFLICT DO NOTHING""",
            tuple(value for row in rows for value in row),
        )
        inserted += max(0, int(getattr(cursor, "rowcount", len(rows)) or 0))
    return inserted


def insert_assignment_removal_history(
    cursor,
    *,
    organization_id: str,
    actor_user_id: str,
    occurred_at: Any,
    before: dict,
    after: dict,
) -> int:
    removed = [before[key] for key in sorted(set(before) - set(after))]
    if not removed:
        return 0
    rows = [(
        organization_id,
        item["assignment_id"],
        item["user_id"],
        item["target_id"],
        item["target_type"],
        item.get("assigned_at"),
        occurred_at,
        actor_user_id,
        None,
        "assignment_removed",
    ) for item in removed]
    value_sql = ", ".join("(" + ", ".join("?" for _ in row) + ")" for row in rows)
    cursor.execute(
        f"""INSERT INTO phan_cong_nhan_su_lich_su (
                organization_id, assignment_id, id_nhan_vien, id_muc_tieu,
                loai_doi_tuong, assigned_at, ended_at, ended_by,
                successor_user_id, reason
            ) VALUES {value_sql}
            ON CONFLICT (organization_id, assignment_id, ended_at) DO NOTHING""",
        tuple(value for row in rows for value in row),
    )
    return len(rows)


def document_activity_event(
    *,
    action: str,
    package: dict[str, Any],
    document_id: str,
    filename: str,
    document_type: str,
    size_bytes: int | None,
    client_mutation_id: str | None,
    request_id: str | None,
) -> ActivityEvent:
    package_id = str(package["id"])
    return ActivityEvent(
        target_type="goithau",
        target_id=package_id,
        target_root_id=str(package.get("id_goc") or package_id),
        action=action,
        related_document_id=str(document_id),
        client_mutation_id=client_mutation_id or None,
        request_id=request_id or None,
        metadata={
            "documentId": str(document_id),
            "documentName": str(filename or "")[:500],
            "documentType": str(document_type or "")[:100],
            "sizeBytes": size_bytes,
        },
    )
