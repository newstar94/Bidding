# ruff: noqa: S608

from __future__ import annotations

from datetime import datetime

from backend.ai.errors import ai_error
from backend.ai.types import AiRequestContext, ToolResult


def assignment_tool_definitions() -> list[dict]:
    schema = {"type": "object", "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 20}}, "required": ["limit"], "additionalProperties": False}
    return [
        {"type": "function", "name": "get_my_assignments", "description": "Lấy các kế hoạch, gói thầu và hợp đồng đang giao cho người dùng hiện tại.", "parameters": schema, "strict": True},
        {"type": "function", "name": "get_overdue_assignments", "description": "Lấy việc quá hạn theo dữ liệu mốc tiến độ đã lưu; nếu thiếu ngày thì trả minh bạch.", "parameters": schema, "strict": True},
    ]


def execute_assignment_tool(cursor, context: AiRequestContext, tool_name: str, arguments: dict) -> ToolResult:
    limit = arguments.get("limit", 20)
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 20:
        raise ai_error("AI_TOOL_INVALID_ARGUMENTS", "limit không hợp lệ.")
    where = ["pc.organization_id = ?", "pc.id_nhan_vien = ?"]
    params = [context.organization_id, context.user_id]
    overdue = tool_name == "get_overdue_assignments"
    if overdue:
        where.append("pc.loai_doi_tuong = 'goithau'")
        where.append("EXISTS (SELECT 1 FROM goi_thau_moc_tien_do m WHERE m.organization_id = pc.organization_id AND m.goi_thau_id = pc.id_muc_tieu AND m.ngay_du_kien < CURRENT_DATE AND COALESCE(m.trang_thai, '') NOT IN ('completed', 'COMPLETED', 'done'))")
    rows = cursor.execute(  # noqa: S608 - query shape and identifiers are code-owned constants
        """SELECT pc.id, pc.id_muc_tieu, pc.loai_doi_tuong,
                  CASE pc.loai_doi_tuong
                    WHEN 'goithau' THEN (SELECT ten_goi_thau FROM goi_thau WHERE organization_id = pc.organization_id AND id = pc.id_muc_tieu)
                    WHEN 'kehoach' THEN (SELECT ten_ke_hoach FROM ke_hoach_lcnt WHERE organization_id = pc.organization_id AND id = pc.id_muc_tieu)
                    WHEN 'hopdong' THEN (SELECT ten_hop_dong FROM hop_dong WHERE organization_id = pc.organization_id AND id = pc.id_muc_tieu)
                  END AS target_name
           FROM phan_cong_nhan_su pc
           WHERE """ + " AND ".join(where) + " ORDER BY pc.updated_at DESC, pc.id DESC LIMIT ?",
        tuple(params + [limit]),
    ).fetchall()
    records = [{"id": str(row["id"]), "targetId": str(row["id_muc_tieu"]), "type": str(row["loai_doi_tuong"]), "name": str(row["target_name"] or row["id_muc_tieu"])} for row in rows]
    return ToolResult(
        tool_name=tool_name,
        scope={"organizationId": context.organization_id, "organizationName": context.organization_name},
        filters={"user": "current", "overdue": overdue},
        summary={"recordCount": len(records), "truncated": len(records) >= limit},
        records=records,
        generated_at=datetime.now().astimezone().isoformat(),
        source_links=[{"type": "list", "label": "Mở tổng quan công việc", "url": "/tong-quan"}],
    )
