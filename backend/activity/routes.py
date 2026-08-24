"""Authorized read-only API for domain activity timelines."""

from __future__ import annotations

import json
from starlette.responses import JSONResponse

from backend.shared.access_policy import can_read_record
from backend.shared.helpers import database, get_active_org, verify_session


_TARGETS = {
    "goithau": ("goithau", "goi_thau"),
    "hopdong": ("hopdong", "hop_dong"),
    "procurement_case": ("procurement_case", "procurement_case"),
}
_ACTIONS = frozenset({
    "goithau.created", "goithau.updated", "hopdong.created", "hopdong.updated",
    "package_document.uploaded", "package_document.replaced",
    "package_document.deleted", "assignment.added", "assignment.removed",
    "procurement_case.created", "procurement_case.response_revision_saved",
    "procurement_case.assign", "procurement_case.start_review",
    "procurement_case.draft_response", "procurement_case.submit_review",
    "procurement_case.return", "procurement_case.approve",
    "procurement_case.issue", "procurement_case.close",
    "procurement_case.reject", "procurement_case.withdraw",
    "procurement_case.reopen", "procurement_case.due_date_set",
    "procurement_case.party_added", "procurement_case.legal_basis_added",
    "procurement_case.source_observed", "procurement_case.attachment_added",
})


def _error(message: str, code: str, status: int) -> JSONResponse:
    return JSONResponse({"error": message, "code": code}, status_code=status)


async def list_activity_timeline_api(request):
    valid, session = verify_session(request)
    if not valid:
        return _error(str(session), "SESSION_REQUIRED", 403)
    target_type = str(request.path_params.get("target_type") or "").strip().lower()
    target_id = str(request.path_params.get("target_id") or "").strip()
    target_spec = _TARGETS.get(target_type)
    if not target_spec or not target_id:
        return _error("Đối tượng lịch sử không hợp lệ.", "ACTIVITY_TARGET_INVALID", 400)
    payload_key, table_name = target_spec
    try:
        limit = min(100, max(1, int(request.query_params.get("limit") or 30)))
    except (TypeError, ValueError):
        return _error("Giới hạn phân trang không hợp lệ.", "ACTIVITY_LIMIT_INVALID", 400)
    action = str(request.query_params.get("action") or "").strip()
    actor_id = str(request.query_params.get("actorId") or "").strip()
    before_at = str(request.query_params.get("beforeOccurredAt") or "").strip()
    before_id = str(request.query_params.get("beforeId") or "").strip()
    if action and action not in _ACTIONS:
        return _error("Bộ lọc hành động không hợp lệ.", "ACTIVITY_ACTION_INVALID", 400)

    organization_id = get_active_org(request, session.user_id)
    with database.get_connection() as connection:
        cursor = connection.cursor()
        if target_type == "procurement_case":
            row = cursor.execute(
                """SELECT case_row.id, case_row.id,
                          target.current_package_version_id
                     FROM procurement_case AS case_row
                     JOIN procurement_case_package_target AS target
                       ON target.organization_id = case_row.organization_id
                      AND target.case_id = case_row.id
                    WHERE case_row.organization_id = ? AND case_row.id = ?""",
                (organization_id, target_id),
            ).fetchone()
        else:
            row = cursor.execute(
                f"""SELECT id, COALESCE(NULLIF(id_goc, ''), id) AS root_id
                    FROM {table_name}
                    WHERE organization_id = ? AND id = ? LIMIT 1""",  # noqa: S608
                (organization_id, target_id),
            ).fetchone()
        if not row:
            return _error("Không tìm thấy đối tượng.", "ACTIVITY_TARGET_NOT_FOUND", 404)
        authorization_id = row[2] if target_type == "procurement_case" else target_id
        authorization_key = "goithau" if target_type == "procurement_case" else payload_key
        authorization_table = "goi_thau" if target_type == "procurement_case" else table_name
        if not can_read_record(
            cursor, session, session.user_id, organization_id,
            authorization_key, authorization_table, authorization_id,
        ):
            return _error("Không có quyền xem lịch sử thực hiện.", "ACTIVITY_ACCESS_DENIED", 403)

        clauses = [
            "organization_id = ?", "target_type = ?", "target_root_id = ?",
        ]
        params: list[object] = [organization_id, target_type, str(row[1])]
        if action:
            clauses.append("action = ?")
            params.append(action)
        if actor_id:
            clauses.append("actor_user_id = ?")
            params.append(actor_id)
        if before_at and before_id:
            clauses.append("(occurred_at, id) < (?, ?)")
            params.extend([before_at, before_id])
        rows = cursor.execute(
            f"""SELECT id, target_type, target_id, target_root_id, action,
                       actor_user_id, actor_name_snapshot, occurred_at,
                       related_document_id, related_assignment_id, metadata_json
                FROM nhat_ky_thuc_hien
                WHERE {' AND '.join(clauses)}
                ORDER BY occurred_at DESC, id DESC
                LIMIT ?""",
            (*params, limit + 1),
        ).fetchall()
        has_more = len(rows) > limit
        rows = rows[:limit]
        items = []
        for item in rows:
            try:
                metadata = json.loads(item[10] or "{}")
            except (TypeError, json.JSONDecodeError):
                metadata = {}
            items.append({
                "id": str(item[0]),
                "targetType": str(item[1]),
                "targetId": str(item[2]),
                "targetRootId": str(item[3]),
                "action": str(item[4]),
                "actorUserId": str(item[5]) if item[5] is not None else None,
                "actorName": str(item[6] or "Không xác định"),
                "occurredAt": item[7].isoformat() if hasattr(item[7], "isoformat") else str(item[7]),
                "relatedDocumentId": str(item[8]) if item[8] is not None else None,
                "relatedAssignmentId": str(item[9]) if item[9] is not None else None,
                "metadata": metadata,
            })
        next_cursor = None
        if has_more and items:
            next_cursor = {
                "beforeOccurredAt": items[-1]["occurredAt"],
                "beforeId": items[-1]["id"],
            }
        return JSONResponse({"items": items, "nextCursor": next_cursor})
