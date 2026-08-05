from __future__ import annotations

from backend.analytics.semantic_registry import supported_metrics


def _aggregate_schema() -> dict:
    return {
        "type": "object",
        "properties": {
            "metric": {"type": "string", "enum": list(supported_metrics("packages"))},
            "dateField": {"anyOf": [{"type": "string", "enum": ["thoi_gian_dang_tai", "thoi_gian_mo_thau", "ngay_quyet_dinh_ket_qua"]}, {"type": "null"}]},
            "dateFrom": {"anyOf": [{"type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$"}, {"type": "null"}]},
            "dateTo": {"anyOf": [{"type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$"}, {"type": "null"}]},
            "statuses": {"type": "array", "items": {"type": "string"}, "maxItems": 12},
            "groupBy": {"type": "string", "enum": ["none", "year", "month", "status"]},
            "limit": {"type": "integer", "minimum": 1, "maximum": 20},
        },
        "required": ["metric", "dateField", "dateFrom", "dateTo", "statuses", "groupBy", "limit"],
        "additionalProperties": False,
    }


def package_tool_definitions() -> list[dict]:
    return [
        {"type": "function", "name": "aggregate_packages", "description": "Tính COUNT/SUM deterministic cho các gói thầu trong workspace hiện tại. Không tải dữ liệu thô.", "parameters": _aggregate_schema(), "strict": True},
        {"type": "function", "name": "list_packages", "description": "Liệt kê tối đa 20 gói thầu đã được kiểm tra quyền, dùng cho drill-down.", "parameters": {"type": "object", "properties": {"dateField": {"type": "string", "enum": ["thoi_gian_mo_thau", "thoi_gian_dang_tai"]}, "dateFrom": {"type": ["string", "null"]}, "dateTo": {"type": ["string", "null"]}, "status": {"type": "string"}, "limit": {"type": "integer", "minimum": 1, "maximum": 20}}, "required": ["dateField", "dateFrom", "dateTo", "status", "limit"], "additionalProperties": False}, "strict": True},
    ]
