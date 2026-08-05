from __future__ import annotations

from backend.analytics.semantic_registry import supported_metrics


def plan_tool_definitions() -> list[dict]:
    aggregate = {
        "type": "object",
        "properties": {
            "metric": {"type": "string", "enum": list(supported_metrics("plans"))},
            "dateField": {"anyOf": [{"type": "string", "enum": ["ngay_phe_duyet"]}, {"type": "null"}]},
            "dateFrom": {"anyOf": [{"type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$"}, {"type": "null"}]},
            "dateTo": {"anyOf": [{"type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$"}, {"type": "null"}]},
            "statuses": {"type": "array", "items": {"type": "string"}, "maxItems": 12},
            "groupBy": {"type": "string", "enum": ["none", "year", "month"]},
            "limit": {"type": "integer", "minimum": 1, "maximum": 20},
        },
        "required": ["metric", "dateField", "dateFrom", "dateTo", "statuses", "groupBy", "limit"],
        "additionalProperties": False,
    }
    listing = {"type": "object", "properties": {"dateField": {"type": "string", "enum": ["ngay_phe_duyet"]}, "dateFrom": {"type": ["string", "null"]}, "dateTo": {"type": ["string", "null"]}, "status": {"type": "string"}, "limit": {"type": "integer", "minimum": 1, "maximum": 20}}, "required": ["dateField", "dateFrom", "dateTo", "status", "limit"], "additionalProperties": False}
    return [
        {"type": "function", "name": "aggregate_plans", "description": "Tính số lượng hoặc tổng giá trị kế hoạch theo semantic registry và workspace hiện tại.", "parameters": aggregate, "strict": True},
        {"type": "function", "name": "list_plans", "description": "Liệt kê tối đa 20 kế hoạch đã kiểm tra quyền.", "parameters": listing, "strict": True},
    ]
