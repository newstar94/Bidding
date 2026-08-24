"""Allowlisted read-only business tools."""

from backend.ai.app_structure import app_structure_tool_definitions, execute_app_structure_tool
from backend.ai.tools.assignments import execute_assignment_tool, assignment_tool_definitions
from backend.ai.tools.contracts import contract_tool_definitions
from backend.ai.tools.compliance import (
    compliance_tool_definitions,
    execute_compliance_tool,
)
from backend.ai.tools.packages import package_tool_definitions
from backend.ai.tools.plans import plan_tool_definitions
from backend.ai.tools.reports import report_tool_definitions, execute_report_tool
from backend.ai.workspace_search import search_workspace_records, workspace_search_tool_definitions
from backend.ai.workspace_schema import (
    describe_workspace_schema,
    query_workspace_records,
    workspace_query_tool_definitions,
    workspace_schema_tool_definitions,
)


def tool_definitions_for_mode(mode: str) -> list[dict]:
    if mode == "app_help":
        return app_structure_tool_definitions()
    if mode == "procurement_advice":
        return compliance_tool_definitions()
    if mode != "data":
        return []
    return [
        *workspace_schema_tool_definitions(),
        *workspace_query_tool_definitions(),
        *workspace_search_tool_definitions(),
        *package_tool_definitions(),
        *plan_tool_definitions(),
        *contract_tool_definitions(),
        *assignment_tool_definitions(),
        *report_tool_definitions(),
    ]


def execute_read_tool(cursor, context, tool_name: str, arguments: dict) -> object:
    if tool_name == "get_compliance_context":
        return execute_compliance_tool(cursor, context, arguments)
    if tool_name == "search_app_structure":
        return execute_app_structure_tool(context, arguments)
    if tool_name == "search_workspace":
        return search_workspace_records(cursor, context, arguments)
    if tool_name == "describe_workspace_schema":
        return describe_workspace_schema(
            context,
            query=arguments.get("query", ""),
            include_relationships=arguments.get("includeRelationships", True),
            limit=arguments.get("limit", 50),
        )
    if tool_name == "query_workspace":
        return query_workspace_records(cursor, context, arguments)
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
