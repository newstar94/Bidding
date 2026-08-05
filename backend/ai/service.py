"""Conversation orchestration: provider stream → tool validation → provider stream."""

from __future__ import annotations

import asyncio
import json
import queue
import threading
from datetime import datetime
from typing import AsyncIterator

from backend.ai.audit_service import audit_chat, audit_tool_execution
from backend.ai.client import ResponsesProvider
from backend.ai.configuration import get_ai_config
from backend.ai.conversation_repository import (
    add_message,
    add_tool_execution,
    get_conversation,
    list_messages,
)
from backend.ai.errors import AiError, ai_error
from backend.ai.prompt_policy import policy_for_mode
from backend.ai.quota_service import consume_request, record_tokens
from backend.ai.tool_executor import execute_tool
from backend.ai.tool_result_formatter import format_tool_result
from backend.ai.tool_registry import tool_definitions
from backend.ai.types import AiRequestContext
from backend.ai.metrics import increment
from backend.shared.async_io import BlockingIOTimeoutError
from backend.shared.database_io import run_database_read, run_database_write


def validate_message(content: object, config=None) -> str:
    config = config or get_ai_config()
    if not isinstance(content, str):
        raise ai_error("AI_INVALID_MESSAGE", "Nội dung tin nhắn phải là chuỗi.")
    normalized = content.strip()
    if not normalized:
        raise ai_error("AI_INVALID_MESSAGE", "Vui lòng nhập câu hỏi.")
    if len(normalized) > config.max_message_chars:
        raise ai_error("AI_INVALID_MESSAGE", f"Câu hỏi không được vượt quá {config.max_message_chars} ký tự.")
    return normalized


def _provider_event_stream(provider: ResponsesProvider, input_items: list[dict], instructions: str, tools: list[dict]):
    event_queue: queue.Queue = queue.Queue()

    def worker():
        try:
            for event in provider.stream_response(input_items=input_items, instructions=instructions, tools=tools):
                event_queue.put(("event", event))
        except (AiError, OSError, TimeoutError, ValueError, TypeError) as error:
            event_queue.put(("error", error))
        finally:
            event_queue.put(("done", None))

    threading.Thread(target=worker, daemon=True, name="bidding-ai-provider").start()

    async def consume():
        while True:
            kind, payload = await asyncio.to_thread(event_queue.get)
            if kind == "event":
                yield payload
            elif kind == "error":
                if isinstance(payload, AiError):
                    raise payload
                raise ai_error("AI_PROVIDER_UNAVAILABLE", "AI provider không trả về kết quả hợp lệ.") from payload
            else:
                return

    return consume()


def _input_items(messages: list[dict]) -> list[dict]:
    items = []
    for message in messages:
        role = str(message.get("role") or "")
        if role not in {"user", "assistant"}:
            continue
        items.append({"role": role, "content": str(message.get("content") or "")[:12000]})
    return items


async def stream_message(request, context: AiRequestContext, conversation_id: str, content: str, *, quota_consumed: bool = False) -> AsyncIterator[dict]:
    config = get_ai_config()
    if not config.enabled:
        raise ai_error("AI_DISABLED", "Trợ lý AI đang được tắt.")
    content = validate_message(content, config)
    conversation = await run_database_read(get_conversation, context, conversation_id, timeout_seconds=10)
    mode = str(conversation.get("mode") or "")
    if mode not in {"data", "procurement_advice", "app_help"}:
        raise ai_error("AI_UNSUPPORTED_MODE", "Chế độ trợ lý không được hỗ trợ.")
    if not quota_consumed:
        await run_database_write(consume_request, context, config)
    user_message_id = await run_database_write(add_message, context, conversation_id, "user", content)
    messages = await run_database_read(list_messages, context, conversation_id, config.max_history_messages, timeout_seconds=10)
    input_items = _input_items(messages)
    instructions = policy_for_mode(mode) + f"\nWorkspace hiện tại: {context.organization_name}. Múi giờ: {context.timezone}."
    provider = ResponsesProvider(config)
    tools = tool_definitions(mode)
    all_sources: list[dict] = []
    assistant_text_parts: list[str] = []
    total_tool_calls = 0
    input_tokens = 0
    output_tokens = 0

    yield {"type": "message.started", "messageId": user_message_id, "workspace": {"id": context.organization_id, "name": context.organization_name}, "mode": mode}
    try:
        for _attempt in range(3):
            function_calls: dict[int, dict] = {}
            response_output: list[dict] = []
            async for event in _provider_event_stream(provider, input_items, instructions, tools):
                event_type = str(event.get("type") or "")
                if event_type == "response.output_text.delta":
                    delta = str(event.get("delta") or "")
                    if delta:
                        assistant_text_parts.append(delta)
                        yield {"type": "message.delta", "delta": delta}
                elif event_type == "response.output_item.added":
                    item = event.get("item") or {}
                    if item.get("type") == "function_call":
                        index = int(event.get("output_index") or 0)
                        function_calls[index] = {**item, "arguments": str(item.get("arguments") or "")}
                elif event_type == "response.function_call_arguments.delta":
                    index = int(event.get("output_index") or 0)
                    call = function_calls.setdefault(index, {"type": "function_call", "arguments": ""})
                    call["arguments"] = str(call.get("arguments") or "") + str(event.get("delta") or "")
                elif event_type == "response.function_call_arguments.done":
                    index = int(event.get("output_index") or 0)
                    call = function_calls.setdefault(index, {"type": "function_call"})
                    call["arguments"] = str(event.get("arguments") or call.get("arguments") or "")
                elif event_type == "response.output_item.done":
                    item = event.get("item") or {}
                    if item.get("type") == "function_call":
                        index = int(event.get("output_index") or 0)
                        function_calls[index] = {**function_calls.get(index, {}), **item}
                elif event_type == "response.completed":
                    response = event.get("response") or {}
                    response_output = [item for item in response.get("output", []) if isinstance(item, dict)]
                    usage = response.get("usage") or {}
                    input_tokens += max(0, int(usage.get("input_tokens") or 0))
                    output_tokens += max(0, int(usage.get("output_tokens") or 0))
                elif event_type == "error":
                    raise ai_error("AI_PROVIDER_UNAVAILABLE", "AI provider trả về lỗi.")

            calls = [function_calls[index] for index in sorted(function_calls)]
            if not calls:
                break
            if total_tool_calls + len(calls) > config.max_tool_calls_per_message:
                raise ai_error("AI_QUOTA_EXCEEDED", "Tin nhắn vượt quá số lần gọi tool cho phép.")
            total_tool_calls += len(calls)
            if response_output:
                input_items.extend(response_output)
            else:
                input_items.extend(calls)
            for call in calls:
                name = str(call.get("name") or "")
                try:
                    arguments = json.loads(str(call.get("arguments") or "{}"))
                except json.JSONDecodeError as exc:
                    raise ai_error("AI_TOOL_INVALID_ARGUMENTS", "Tool arguments không phải JSON hợp lệ.") from exc
                yield {"type": "tool.started", "toolName": name}
                increment("ai_tool_calls_total")
                try:
                    result, execution_meta = await run_database_read(
                        execute_tool,
                        request,
                        context,
                        name,
                        arguments,
                        mode=mode,
                        timeout_seconds=config.tool_timeout_seconds,
                    )
                    increment("ai_tool_duration_seconds", execution_meta["duration_ms"] / 1000)
                except BlockingIOTimeoutError as exc:
                    increment("ai_tool_errors_total")
                    audit_tool_execution(request, context, conversation_id, name, mode=mode, arguments=arguments, record_count=0, duration_ms=config.tool_timeout_seconds * 1000, status="timeout", error_code="AI_TOOL_TIMEOUT")
                    yield {"type": "tool.completed", "toolName": name, "status": "timeout", "errorCode": "AI_TOOL_TIMEOUT"}
                    raise ai_error("AI_TOOL_TIMEOUT", "Tool phản hồi quá thời gian cho phép.") from exc
                except AiError as exc:
                    increment("ai_tool_errors_total")
                    if exc.code in {"AI_PERMISSION_DENIED", "AI_SCOPE_VALIDATION_FAILED", "AI_TOOL_NOT_ALLOWED"}:
                        increment("ai_permission_denials_total")
                    audit_tool_execution(request, context, conversation_id, name, mode=mode, arguments=arguments, record_count=0, duration_ms=0, status="denied" if exc.code in {"AI_PERMISSION_DENIED", "AI_TOOL_NOT_ALLOWED", "AI_SCOPE_VALIDATION_FAILED"} else "failed", error_code=exc.code)
                    yield {"type": "tool.completed", "toolName": name, "status": "failed", "errorCode": exc.code}
                    raise
                result_payload = result.as_dict()
                all_sources.extend(result.source_links)
                audit_tool_execution(request, context, conversation_id, name, mode=mode, arguments=arguments, record_count=result.record_count, duration_ms=execution_meta["duration_ms"], status="completed")
                await run_database_write(
                    add_tool_execution,
                    context,
                    conversation_id,
                    user_message_id,
                    tool_name=name,
                    arguments_redacted=execution_meta["arguments_redacted"],
                    result_summary=json.dumps(result.summary, ensure_ascii=False, separators=(",", ":")),
                    record_count=result.record_count,
                    duration_ms=execution_meta["duration_ms"],
                    status="completed",
                )
                yield {"type": "tool.completed", "toolName": name, "status": "completed", "result": result_payload}
                for source in result.source_links:
                    yield {"type": "source.added", "source": source}
                input_items.append({"type": "function_call_output", "call_id": str(call.get("call_id") or ""), "output": format_tool_result(result)})
        answer = "".join(assistant_text_parts).strip()
        if not answer:
            answer = "Mình chưa nhận được câu trả lời từ AI provider. Vui lòng thử lại."
            yield {"type": "message.delta", "delta": answer}
        assistant_message_id = await run_database_write(
            add_message,
            context,
            conversation_id,
            "assistant",
            answer,
            model=config.model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )
        await run_database_write(
            record_tokens,
            context,
            input_tokens,
            output_tokens,
            total_tool_calls,
            config=config,
        )
        increment("ai_input_tokens_total", input_tokens)
        increment("ai_output_tokens_total", output_tokens)
        audit_chat(
            request,
            context,
            conversation_id,
            mode=mode,
            status="completed",
            model=config.model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            tool_call_count=total_tool_calls,
        )
        yield {"type": "message.completed", "messageId": assistant_message_id, "workspace": {"id": context.organization_id, "name": context.organization_name}, "generatedAt": datetime.now().astimezone().isoformat(), "sources": all_sources}
    except AiError as exc:
        if exc.code.startswith("AI_PROVIDER_"):
            increment("ai_provider_errors_total")
        audit_chat(request, context, conversation_id, mode=mode, status="failed", model=config.model, input_tokens=input_tokens, output_tokens=output_tokens, tool_call_count=total_tool_calls, error_code=exc.code)
        yield {"type": "message.failed", "code": exc.code, "message": exc.message}
