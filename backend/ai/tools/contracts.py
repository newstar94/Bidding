from __future__ import annotations

from backend.analytics.semantic_registry import supported_metrics


def contract_tool_definitions() -> list[dict]:
    aggregate = {
        "type": "object",
        "properties": {
            "metric": {"type": "string", "enum": list(supported_metrics("contracts"))},
            "dateField": {"anyOf": [{"type": "string", "enum": ["signed_date", "liquidation_date"]}, {"type": "null"}]},
            "dateFrom": {"anyOf": [{"type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$"}, {"type": "null"}]},
            "dateTo": {"anyOf": [{"type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$"}, {"type": "null"}]},
            "statuses": {"type": "array", "items": {"type": "string"}, "maxItems": 12},
            "groupBy": {"type": "string", "enum": ["none", "year", "month", "status", "contract_type"]},
            "limit": {"type": "integer", "minimum": 1, "maximum": 20},
        },
        "required": ["metric", "dateField", "dateFrom", "dateTo", "statuses", "groupBy", "limit"],
        "additionalProperties": False,
    }
    listing = {"type": "object", "properties": {"dateField": {"type": "string", "enum": ["signed_date", "liquidation_date"]}, "dateFrom": {"type": ["string", "null"]}, "dateTo": {"type": ["string", "null"]}, "status": {"type": "string"}, "limit": {"type": "integer", "minimum": 1, "maximum": 20}}, "required": ["dateField", "dateFrom", "dateTo", "status", "limit"], "additionalProperties": False}
    return [
        {"type": "function", "name": "aggregate_contracts", "description": "Tính COUNT/SUM deterministic cho hợp đồng; tiền trả về dạng decimal string. Nêu rõ trường ngày.", "parameters": aggregate, "strict": True},
        {"type": "function", "name": "list_contracts", "description": "Liệt kê tối đa 20 hợp đồng đã kiểm tra quyền.", "parameters": listing, "strict": True},
    ]
