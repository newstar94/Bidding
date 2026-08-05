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
    return dict(arguments)
