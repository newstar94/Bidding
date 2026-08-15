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
from backend.ai.knowledge.repository import retrieve_for_context as retrieve_knowledge
from backend.ai.prompt_policy import policy_for_mode
from backend.ai.providers.legal_search import LegalSearchResult, create_legal_search_adapter
from backend.ai.quota_service import consume_request, record_tokens
from backend.ai.tool_executor import execute_tool
from backend.ai.tool_result_formatter import format_tool_result
from backend.ai.tool_registry import tool_definitions
from backend.ai.types import AiRequestContext
from backend.ai.metrics import increment
from backend.shared.async_io import BlockingIOTimeoutError
from backend.db.db_helper import OperationalError
from backend.shared.database_io import run_database_read, run_database_write


_PROVIDER_EVENT_QUEUE_SIZE = 64
_PROVIDER_QUEUE_TIMEOUT_SECONDS = 0.1
_PROVIDER_THREAD_LIMIT = 32
_PROVIDER_THREAD_SLOTS = threading.BoundedSemaphore(_PROVIDER_THREAD_LIMIT)


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
    if not _PROVIDER_THREAD_SLOTS.acquire(blocking=False):
        raise ai_error(
            "AI_PROVIDER_UNAVAILABLE",
            "AI provider is processing the maximum number of concurrent streams.",
        )
    event_queue: queue.Queue = queue.Queue(maxsize=_PROVIDER_EVENT_QUEUE_SIZE)
    cancel_event = threading.Event()

    def enqueue(kind, payload):
        while not cancel_event.is_set():
            try:
                event_queue.put((kind, payload), timeout=_PROVIDER_QUEUE_TIMEOUT_SECONDS)
                return True
            except queue.Full:
                continue
        return False

    def cancel_provider():
        for candidate in (provider, getattr(provider, "adapter", None)):
            if candidate is None:
                continue
            for method_name in ("cancel", "abort", "close"):
                method = getattr(candidate, method_name, None)
                if callable(method):
                    try:
                        method()
                    except (OSError, RuntimeError, TypeError, ValueError):
                        pass
                    break

    def worker():
        provider_stream = None
        try:
            provider_stream = provider.stream_response(input_items=input_items, instructions=instructions, tools=tools)
            for event in provider_stream:
                if cancel_event.is_set() or not enqueue("event", event):
                    break
        except Exception as error:  # noqa: BLE001 - provider adapters are an isolation boundary
            enqueue("error", error)
        finally:
            close_stream = getattr(provider_stream, "close", None)
            if callable(close_stream):
                try:
                    close_stream()
                except (OSError, RuntimeError, TypeError, ValueError):
                    pass
            enqueue("done", None)
            _PROVIDER_THREAD_SLOTS.release()

    worker_thread = threading.Thread(target=worker, daemon=True, name="bidding-ai-provider")
    try:
        worker_thread.start()
    except RuntimeError:
        _PROVIDER_THREAD_SLOTS.release()
        raise

    async def consume():
        try:
            while True:
                try:
                    kind, payload = await asyncio.to_thread(
                        event_queue.get, True, _PROVIDER_QUEUE_TIMEOUT_SECONDS
                    )
                except queue.Empty:
                    if worker_thread.is_alive():
                        continue
                    return
                if kind == "event":
                    yield payload
                elif kind == "error":
                    if isinstance(payload, AiError):
                        raise payload
                    raise ai_error(
                        "AI_PROVIDER_UNAVAILABLE",
                        "AI provider returned an invalid result.",
                    ) from payload
                else:
                    return
        except asyncio.CancelledError:
            raise
        finally:
            cancel_event.set()
            cancel_provider()

    return consume()


def _input_items(messages: list[dict]) -> list[dict]:
    items = []
    for message in messages:
        role = str(message.get("role") or "")
        if role not in {"user", "assistant"}:
            continue
        items.append({"role": role, "content": str(message.get("content") or "")[:12000]})
    return items


def _search_legal_sources(content: str, config) -> LegalSearchResult:
    adapter = create_legal_search_adapter(config)
    return adapter.search_official_law(content, config.web_search_allowed_domains)


def _merge_sources(*groups: list[dict] | tuple[dict, ...] | None) -> list[dict]:
    merged: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for group in groups:
        for source in group or ():
            if not isinstance(source, dict):
                continue
            key = (str(source.get("documentId") or ""), str(source.get("url") or source.get("sourceUrl") or ""))
            if key in seen:
                continue
            seen.add(key)
            merged.append(source)
    return merged


def _legal_source_footer(sources: tuple[dict, ...] | list[dict]) -> str:
    lines = ["\n\nNguồn pháp luật kiểm chứng (hệ thống):"]
    for index, source in enumerate(sources, start=1):
        lines.extend(
            (
                f"[W{index}] {source.get('title') or 'Nguồn pháp luật chính thống'}",
                f"URL: {source.get('url') or source.get('sourceUrl') or 'chưa xác định'}",
                f"Cơ quan ban hành: {source.get('issuingAuthority') or 'chưa xác định'}; "
                f"ngày ban hành: {source.get('issuedDate') or 'chưa xác định'}; "
                f"ngày hiệu lực: {source.get('effectiveFrom') or 'chưa xác định'}.",
                f"Trích dẫn: {source.get('citationText') or 'chưa có trích đoạn được provider trả về.'}",
            )
        )
    return "\n".join(lines)


async def stream_message(
    request,
    context: AiRequestContext,
    conversation_id: str,
    content: str,
    *,
    current_route: str = "/",
    client_request_id: str | None = None,
    quota_consumed: bool = False,
) -> AsyncIterator[dict]:
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
    user_message_id = await run_database_write(
        add_message,
        context,
        conversation_id,
        "user",
        content,
        client_request_id=client_request_id,
    )
    messages = await run_database_read(list_messages, context, conversation_id, config.max_history_messages, timeout_seconds=10)
    input_items = _input_items(messages)
    instructions = policy_for_mode(mode) + f"\nWorkspace hiện tại: {context.organization_name}. Múi giờ: {context.timezone}."
    if mode == "app_help":
        instructions += f"\nRoute ứng dụng hiện tại: {current_route or '/'}"
    knowledge = None
    if config.knowledge_enabled and mode in {"procurement_advice", "app_help"}:
        try:
            knowledge = await run_database_read(
                retrieve_knowledge,
                context,
                content,
                mode=mode,
                limit=config.knowledge_top_k,
                min_score=config.knowledge_min_score,
                max_context_chars=config.knowledge_max_context_chars,
                candidate_limit=config.knowledge_candidate_limit,
                timeout_seconds=10,
            )
        except (BlockingIOTimeoutError, OperationalError) as exc:
            raise ai_error(
                "AI_SOURCE_UNAVAILABLE",
                "Kho tài liệu đã kiểm chứng tạm thời không khả dụng.",
            ) from exc
        if knowledge.prompt_context:
            instructions += f"\n\n{knowledge.prompt_context}"
    web_search: LegalSearchResult | None = None
    if mode == "procurement_advice" and config.web_search_enabled:
        try:
            web_search = await asyncio.to_thread(_search_legal_sources, content, config)
        except AiError as exc:
            if not knowledge or not knowledge.sources:
                raise ai_error(
                    "AI_SOURCE_UNAVAILABLE",
                    "Không thể tìm nguồn pháp luật chính thống trên Internet.",
                ) from exc
            instructions += (
                "\n\nWEB_SEARCH_STATUS: Không thể truy cập Internet trong lượt này. "
                "Chỉ sử dụng tài liệu RAG đã được backend duyệt; không tự tạo nguồn ngoài."
            )
        else:
            if web_search.prompt_context:
                instructions += f"\n\n{web_search.prompt_context}"
            if not web_search.sources and (not knowledge or not knowledge.sources):
                raise ai_error(
                    "AI_SOURCE_UNAVAILABLE",
                    "Chưa tìm thấy nguồn pháp luật chính thống phù hợp để trả lời.",
                )
    provider = ResponsesProvider(config)
    tools = tool_definitions(mode)
    all_sources = _merge_sources(
        knowledge.sources if knowledge else (),
        web_search.sources if web_search else (),
    )
    assistant_text_parts: list[str] = []
    total_tool_calls = 0
    input_tokens = 0
    output_tokens = 0

    yield {"type": "message.started", "messageId": user_message_id, "workspace": {"id": context.organization_id, "name": context.organization_name}, "mode": mode}
    for source in all_sources:
        yield {"type": "source.added", "source": source}
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
        if mode == "procurement_advice" and web_search and web_search.sources:
            footer = _legal_source_footer(web_search.sources)
            answer += footer
            yield {"type": "message.delta", "delta": footer}
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
