"""Translate the canonical Responses-style history to vendor message shapes."""

from __future__ import annotations

import json
from typing import Any


def content_text(content: object) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for block in content:
        if isinstance(block, str):
            parts.append(block)
        elif isinstance(block, dict):
            text = block.get("text")
            if text is not None:
                parts.append(str(text))
    return "".join(parts)


def arguments_object(value: object) -> dict:
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(str(value or "{}"))
    except json.JSONDecodeError as exc:
        raise ValueError("Tool arguments trong lịch sử không phải JSON hợp lệ.") from exc
    if not isinstance(parsed, dict):
        raise ValueError("Tool arguments trong lịch sử phải là JSON object.")
    return parsed


def result_object(value: object) -> dict:
    if isinstance(value, dict):
        return value
    text = str(value or "")
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return {"result": text}
    if isinstance(parsed, dict):
        return parsed
    return {"result": parsed}


def chat_tools(tools: list[dict]) -> list[dict]:
    converted = []
    for tool in tools:
        function = {
            "name": str(tool.get("name") or ""),
            "description": str(tool.get("description") or ""),
            "parameters": tool.get("parameters") or {"type": "object", "properties": {}},
        }
        if "strict" in tool:
            function["strict"] = bool(tool.get("strict"))
        converted.append({"type": "function", "function": function})
    return converted


def anthropic_tools(tools: list[dict]) -> list[dict]:
    return [
        {
            "name": str(tool.get("name") or ""),
            "description": str(tool.get("description") or ""),
            "input_schema": tool.get("parameters") or {"type": "object", "properties": {}},
        }
        for tool in tools
    ]


def interaction_tools(tools: list[dict]) -> list[dict]:
    return [
        {
            "type": "function",
            "name": str(tool.get("name") or ""),
            "description": str(tool.get("description") or ""),
            "parameters": tool.get("parameters") or {"type": "object", "properties": {}},
        }
        for tool in tools
    ]


def gemini_legacy_tools(tools: list[dict]) -> list[dict]:
    if not tools:
        return []
    declarations = []
    for tool in tools:
        declarations.append(
            {
                "name": str(tool.get("name") or ""),
                "description": str(tool.get("description") or ""),
                "parametersJsonSchema": tool.get("parameters")
                or {"type": "object", "properties": {}},
            }
        )
    return [{"functionDeclarations": declarations}]


def _canonical_role(item: dict) -> str:
    role = str(item.get("role") or "")
    if role in {"user", "assistant"}:
        return role
    return ""


def chat_messages(input_items: list[dict], instructions: str, *, ollama: bool = False) -> list[dict]:
    messages: list[dict] = []
    if instructions:
        messages.append({"role": "system", "content": instructions})
    call_names: dict[str, str] = {}
    assistant_open = False
    call_index = 0
    for item in input_items:
        if not isinstance(item, dict):
            continue
        item_type = str(item.get("type") or "")
        role = _canonical_role(item)
        if role:
            messages.append({"role": role, "content": content_text(item.get("content"))})
            assistant_open = role == "assistant"
            continue
        if item_type == "message":
            role = str(item.get("role") or "assistant")
            if role not in {"user", "assistant"}:
                role = "assistant"
            messages.append({"role": role, "content": content_text(item.get("content"))})
            assistant_open = role == "assistant"
            continue
        if item_type == "function_call":
            call_id = str(item.get("call_id") or item.get("id") or f"call_{call_index}")
            name = str(item.get("name") or "")
            call_names[call_id] = name
            if not assistant_open:
                messages.append({"role": "assistant", "content": "", "tool_calls": []})
            target = messages[-1]
            target.setdefault("tool_calls", [])
            if ollama:
                tool_call = {
                    "type": "function",
                    "function": {
                        "index": call_index,
                        "name": name,
                        "arguments": arguments_object(item.get("arguments")),
                    },
                }
            else:
                tool_call = {
                    "id": call_id,
                    "type": "function",
                    "function": {
                        "name": name,
                        "arguments": str(item.get("arguments") or "{}"),
                    },
                }
            target["tool_calls"].append(tool_call)
            assistant_open = True
            call_index += 1
            continue
        if item_type == "function_call_output":
            call_id = str(item.get("call_id") or "")
            name = call_names.get(call_id, "")
            if ollama:
                messages.append(
                    {"role": "tool", "tool_name": name, "content": str(item.get("output") or "")}
                )
            else:
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call_id,
                        "content": str(item.get("output") or ""),
                    }
                )
            assistant_open = False
    return messages


def anthropic_messages(input_items: list[dict]) -> list[dict]:
    messages: list[dict] = []

    def add_block(role: str, block: dict) -> None:
        if messages and messages[-1]["role"] == role:
            messages[-1]["content"].append(block)
        else:
            messages.append({"role": role, "content": [block]})

    for item in input_items:
        if not isinstance(item, dict):
            continue
        item_type = str(item.get("type") or "")
        role = _canonical_role(item)
        if role:
            add_block(role, {"type": "text", "text": content_text(item.get("content"))})
        elif item_type == "message":
            role = str(item.get("role") or "assistant")
            if role not in {"user", "assistant"}:
                role = "assistant"
            add_block(role, {"type": "text", "text": content_text(item.get("content"))})
        elif item_type == "function_call":
            add_block(
                "assistant",
                {
                    "type": "tool_use",
                    "id": str(item.get("call_id") or item.get("id") or ""),
                    "name": str(item.get("name") or ""),
                    "input": arguments_object(item.get("arguments")),
                },
            )
        elif item_type == "function_call_output":
            add_block(
                "user",
                {
                    "type": "tool_result",
                    "tool_use_id": str(item.get("call_id") or ""),
                    "content": str(item.get("output") or ""),
                },
            )
    return messages


def gemini_contents(input_items: list[dict]) -> list[dict]:
    contents: list[dict] = []
    call_names: dict[str, str] = {}

    def add_part(role: str, part: dict) -> None:
        if contents and contents[-1]["role"] == role:
            contents[-1]["parts"].append(part)
        else:
            contents.append({"role": role, "parts": [part]})

    for item in input_items:
        if not isinstance(item, dict):
            continue
        item_type = str(item.get("type") or "")
        role = _canonical_role(item)
        if role:
            add_part("model" if role == "assistant" else "user", {"text": content_text(item.get("content"))})
        elif item_type == "message":
            mapped_role = "model" if str(item.get("role") or "assistant") == "assistant" else "user"
            add_part(mapped_role, {"text": content_text(item.get("content"))})
        elif item_type == "function_call":
            call_id = str(item.get("call_id") or item.get("id") or "")
            name = str(item.get("name") or "")
            call_names[call_id] = name
            function_call: dict[str, Any] = {
                "name": name,
                "args": arguments_object(item.get("arguments")),
            }
            if call_id:
                function_call["id"] = call_id
            part = {"functionCall": function_call}
            provider_data = item.get("provider_data")
            if isinstance(provider_data, dict) and provider_data.get("thoughtSignature"):
                part["thoughtSignature"] = provider_data["thoughtSignature"]
            add_part("model", part)
        elif item_type == "function_call_output":
            call_id = str(item.get("call_id") or "")
            function_response: dict[str, Any] = {
                "name": call_names.get(call_id, ""),
                "response": result_object(item.get("output")),
            }
            if call_id:
                function_response["id"] = call_id
            add_part("user", {"functionResponse": function_response})
    return contents


def interaction_steps(input_items: list[dict]) -> list[dict]:
    steps: list[dict] = []
    call_names: dict[str, str] = {}
    for item in input_items:
        if not isinstance(item, dict):
            continue
        item_type = str(item.get("type") or "")
        role = _canonical_role(item)
        if role:
            text = content_text(item.get("content"))
            if role == "user":
                steps.append({"type": "user_input", "content": [{"type": "text", "text": text}]})
            else:
                steps.append({"type": "model_output", "content": [{"type": "text", "text": text}]})
        elif item_type == "message":
            text = content_text(item.get("content"))
            step_type = "model_output" if str(item.get("role") or "assistant") == "assistant" else "user_input"
            steps.append({"type": step_type, "content": [{"type": "text", "text": text}]})
        elif item_type == "function_call":
            call_id = str(item.get("call_id") or item.get("id") or "")
            name = str(item.get("name") or "")
            call_names[call_id] = name
            steps.append(
                {
                    "type": "function_call",
                    "id": call_id,
                    "name": name,
                    "arguments": arguments_object(item.get("arguments")),
                }
            )
        elif item_type == "function_call_output":
            call_id = str(item.get("call_id") or "")
            steps.append(
                {
                    "type": "function_result",
                    "call_id": call_id,
                    "name": call_names.get(call_id, ""),
                    "result": [{"type": "text", "text": str(item.get("output") or "")}],
                }
            )
    return steps
