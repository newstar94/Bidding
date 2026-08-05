"""Keep tool payloads bounded and explicitly mark them as untrusted data."""

from __future__ import annotations

import json

from backend.ai.types import ToolResult


def format_tool_result(result: ToolResult) -> str:
    payload = {"untrustedData": True, **result.as_dict()}
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"), default=str)[:24000]
