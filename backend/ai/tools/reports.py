from __future__ import annotations

from datetime import datetime

from backend.ai.errors import ai_error
from backend.ai.types import AiRequestContext, ToolResult
from backend.analytics.aggregation_engine import aggregate_entity


def report_tool_definitions() -> list[dict]:
    return [{
        "type": "function",
        "name": "get_organization_dashboard",
        "description": "Trả snapshot tổng quan workspace hiện tại bằng các phép tính deterministic, không trả raw rows.",
        "parameters": {"type": "object", "properties": {"year": {"type": "integer", "minimum": 2000, "maximum": 2200}}, "required": ["year"], "additionalProperties": False},
        "strict": True,
    }]


def execute_report_tool(cursor, context: AiRequestContext, tool_name: str, arguments: dict) -> ToolResult:
    year = arguments.get("year")
    if not isinstance(year, int) or isinstance(year, bool) or not 2000 <= year <= 2200:
        raise ai_error("AI_TOOL_INVALID_ARGUMENTS", "Năm phải nằm trong khoảng 2000-2200.")
    results = []
    for entity, metric in (("packages", "count"), ("plans", "count"), ("contracts", "current_count")):
        result = aggregate_entity(cursor, context, entity, {"metric": metric, "dateField": None, "dateFrom": None, "dateTo": None, "statuses": [], "groupBy": "none", "limit": 20})
        results.append({"entity": entity, **result.summary})
    return ToolResult(
        tool_name=tool_name,
        scope={"organizationId": context.organization_id, "organizationName": context.organization_name},
        filters={"year": year},
        summary={"recordCount": sum(int(item.get("recordCount", 0)) for item in results), "widgets": results},
        records=[],
        generated_at=datetime.now().astimezone().isoformat(),
        source_links=[{"type": "list", "label": "Mở dashboard", "url": "/tong-quan"}],
    )
