"""Single allowlist for model-visible tools."""

from __future__ import annotations

from backend.ai.errors import ai_error
from backend.ai.tools import tool_definitions_for_mode


WRITE_PREFIXES = ("create_", "update_", "delete_", "approve_", "publish_", "award_", "sign_")


def tool_definitions(mode: str) -> list[dict]:
    return tool_definitions_for_mode(mode)


def tool_definition(mode: str, name: str) -> dict:
    for definition in tool_definitions(mode):
        if definition.get("name") == name:
            return definition
    raise ai_error("AI_TOOL_NOT_ALLOWED", "Công cụ không được phép trong chế độ hiện tại.")


def validate_tool_arguments(mode: str, name: str, arguments: object) -> dict:
    definition = tool_definition(mode, name)
    if any(name.startswith(prefix) for prefix in WRITE_PREFIXES):
        raise ai_error("AI_TOOL_NOT_ALLOWED", "MVP chỉ cho phép công cụ chỉ đọc.")
    if not isinstance(arguments, dict):
        raise ai_error("AI_TOOL_INVALID_ARGUMENTS", "Tham số tool phải là JSON object.")
    schema = definition.get("parameters") or {}
    properties = schema.get("properties") or {}
    unknown = set(arguments) - set(properties)
    if unknown or not schema.get("additionalProperties") is False:
        if unknown:
            raise ai_error("AI_TOOL_INVALID_ARGUMENTS", "Tool arguments chứa trường không được hỗ trợ.")
    for field in schema.get("required", []):
        if field not in arguments:
            raise ai_error("AI_TOOL_INVALID_ARGUMENTS", f"Thiếu tham số tool: {field}.")
    if name.startswith("aggregate_") or name.startswith("list_"):
        if "limit" in arguments and (not isinstance(arguments["limit"], int) or isinstance(arguments["limit"], bool) or not 1 <= arguments["limit"] <= 20):
            raise ai_error("AI_TOOL_INVALID_ARGUMENTS", "limit phải nằm trong khoảng 1-20.")
        if "statuses" in arguments and (not isinstance(arguments["statuses"], list) or len(arguments["statuses"]) > 12):
            raise ai_error("AI_TOOL_INVALID_ARGUMENTS", "statuses không hợp lệ.")
    if name == "search_workspace":
        if arguments.get("operation") not in {"count", "list"}:
            raise ai_error("AI_TOOL_INVALID_ARGUMENTS", "operation không hợp lệ.")
        if "limit" in arguments and (not isinstance(arguments["limit"], int) or isinstance(arguments["limit"], bool) or not 1 <= arguments["limit"] <= 20):
            raise ai_error("AI_TOOL_INVALID_ARGUMENTS", "limit phải nằm trong khoảng 1-20.")
    if name == "describe_workspace_schema":
        if not isinstance(arguments.get("query"), str) or len(arguments["query"]) > 200:
            raise ai_error("AI_TOOL_INVALID_ARGUMENTS", "query schema không hợp lệ.")
        if not isinstance(arguments.get("includeRelationships"), bool):
            raise ai_error("AI_TOOL_INVALID_ARGUMENTS", "includeRelationships không hợp lệ.")
        if not isinstance(arguments.get("limit"), int) or isinstance(arguments["limit"], bool) or not 1 <= arguments["limit"] <= 50:
            raise ai_error("AI_TOOL_INVALID_ARGUMENTS", "limit schema phải nằm trong khoảng 1-50.")
    if name == "query_workspace":
        if arguments.get("operation") not in {"count", "list"}:
            raise ai_error("AI_TOOL_INVALID_ARGUMENTS", "operation query không hợp lệ.")
        fields = arguments.get("fields")
        if (
            not isinstance(fields, list)
            or len(fields) > 20
            or any(not isinstance(field, str) for field in fields)
            or len(set(fields)) != len(fields)
        ):
            raise ai_error("AI_TOOL_INVALID_ARGUMENTS", "fields query phải là danh sách tối đa 20 cột.")
        for field in ("query", "status", "packageId"):
            if not isinstance(arguments.get(field), str) or len(arguments[field]) > {"query": 200, "status": 120, "packageId": 160}[field]:
                raise ai_error("AI_TOOL_INVALID_ARGUMENTS", f"{field} query không hợp lệ.")
        if not isinstance(arguments.get("limit"), int) or isinstance(arguments["limit"], bool) or not 1 <= arguments["limit"] <= 50:
            raise ai_error("AI_TOOL_INVALID_ARGUMENTS", "limit query phải nằm trong khoảng 1-50.")
    return dict(arguments)
