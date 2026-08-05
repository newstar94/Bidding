"""Allowlisted read-only business tools."""

from backend.ai.tools.assignments import execute_assignment_tool, assignment_tool_definitions
from backend.ai.tools.contracts import contract_tool_definitions
from backend.ai.tools.packages import package_tool_definitions
from backend.ai.tools.plans import plan_tool_definitions
from backend.ai.tools.reports import report_tool_definitions, execute_report_tool


def tool_definitions_for_mode(mode: str) -> list[dict]:
    if mode != "data":
        return []
    return [
        *package_tool_definitions(),
        *plan_tool_definitions(),
        *contract_tool_definitions(),
        *assignment_tool_definitions(),
        *report_tool_definitions(),
    ]


def execute_read_tool(cursor, context, tool_name: str, arguments: dict) -> object:
    if tool_name in {"get_my_assignments", "get_overdue_assignments"}:
        return execute_assignment_tool(cursor, context, tool_name, arguments)
    if tool_name == "get_organization_dashboard":
        return execute_report_tool(cursor, context, tool_name, arguments)
    if tool_name.startswith("aggregate_"):
        from backend.analytics.aggregation_engine import aggregate_entity

        entity = tool_name.removeprefix("aggregate_")
        return aggregate_entity(cursor, context, entity, arguments)
    if tool_name.startswith("list_"):
        from backend.analytics.aggregation_engine import list_entity

        entity = tool_name.removeprefix("list_")
        return list_entity(cursor, context, entity, arguments)
    raise KeyError(tool_name)
