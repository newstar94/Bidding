"""Execute an allowlisted read tool with a fresh authorization check."""

from __future__ import annotations

import time

from backend.ai.errors import AiError, ai_error
from backend.ai.permission_context import build_request_context
from backend.ai.redaction import redact_json
from backend.ai.tool_registry import validate_tool_arguments
from backend.ai.tools import execute_read_tool
from backend.ai.types import AiRequestContext, ToolResult
from backend.shared.helpers import database


def execute_tool(
    request,
    context: AiRequestContext,
    tool_name: str,
    arguments: dict,
    *,
    mode: str = "data",
) -> tuple[ToolResult, dict]:
    started_at = time.perf_counter()
    fresh_context = build_request_context(request)
    if fresh_context.user_id != context.user_id or fresh_context.organization_id != context.organization_id:
        raise ai_error("AI_SCOPE_VALIDATION_FAILED", "Workspace hoặc phiên làm việc đã thay đổi.")
    checked_arguments = validate_tool_arguments(mode, tool_name, arguments)
    connection = database.get_connection()
    try:
        result = execute_read_tool(connection.cursor(), fresh_context, tool_name, checked_arguments)
        if not isinstance(result, ToolResult):
            raise ai_error("AI_TOOL_FAILED", "Tool không trả về kết quả có cấu trúc.")
        for link in result.source_links:
            url = str(link.get("url") or "")
            if not url.startswith("/") or url.startswith("//") or "?" in url or "#" in url:
                raise ai_error("AI_SCOPE_VALIDATION_FAILED", "Source link không hợp lệ.")
        return result, {
            "duration_ms": int((time.perf_counter() - started_at) * 1000),
            "arguments_redacted": redact_json(checked_arguments),
        }
    except AiError:
        raise
    except (KeyError, ValueError) as exc:
        raise ai_error("AI_TOOL_INVALID_ARGUMENTS", "Tham số tool không hợp lệ.") from exc
    finally:
        connection.close()
