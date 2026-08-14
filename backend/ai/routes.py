"""Thin HTTP routes for the AI gateway."""

from __future__ import annotations

import json
import time
import asyncio
from contextlib import suppress

from starlette.requests import Request
from starlette.responses import JSONResponse, StreamingResponse
from starlette.routing import Route

from backend.ai.configuration import get_ai_config
from backend.ai.conversation_repository import (
    add_feedback,
    create_conversation,
    delete_conversation,
    get_conversation,
    list_conversations,
    list_messages,
    list_messages_page,
    remove_feedback,
)
from backend.ai.errors import AiError, ai_error
from backend.ai.permission_context import build_request_context
from backend.ai.service import stream_message, validate_message
from backend.ai.metrics import increment
from backend.ai.quota_service import consume_request
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError
from backend.db.db_helper import DatabaseError
from backend.auth.session_utils import OrgPermissionError
from backend.shared.database_io import run_database_read, run_database_write
from backend.shared.logging_utils import error_response, log_error
from backend.shared.request_validation import read_json_object


def _error(request: Request, error: AiError):
    return error_response(request, error.code, error.message, status_code=error.status_code)


async def ai_config_api(request: Request):
    config = get_ai_config()
    return JSONResponse({
        "enabled": config.enabled,
        "modes": ["data", "procurement_advice", "app_help"] if config.enabled else [],
        "capabilities": config.public_capabilities,
        "streaming": config.enabled,
        "readOnly": True,
    }, headers={"Cache-Control": "no-store"})


async def _context_or_response(request):
    config = get_ai_config()
    if not config.enabled:
        return None, _error(request, ai_error("AI_DISABLED", "Trợ lý AI đang được tắt."))
    try:
        context = await run_database_read(build_request_context, request, timeout_seconds=10)
        return context, None
    except AiError as exc:
        return None, _error(request, exc)
    except (DatabaseError, OrgPermissionError, BlockingIOBusyError, BlockingIOTimeoutError) as exc:
        log_error(exc, "ai_permission_context")
        return None, _error(request, ai_error("AI_PERMISSION_DENIED", "Không thể xác định quyền truy cập workspace."))


async def list_ai_conversations_api(request: Request):
    context, response = await _context_or_response(request)
    if response:
        return response
    try:
        conversations = await run_database_read(list_conversations, context, timeout_seconds=10)
        return JSONResponse({"items": conversations, "workspace": {"id": context.organization_id, "name": context.organization_name}})
    except (DatabaseError, BlockingIOBusyError, BlockingIOTimeoutError) as exc:
        log_error(exc, "ai_list_conversations")
        return _error(request, ai_error("AI_DATA_UNAVAILABLE", "Không thể tải lịch sử trợ lý."))


async def create_ai_conversation_api(request: Request):
    context, response = await _context_or_response(request)
    if response:
        return response
    data, json_error = await read_json_object(request)
    if json_error:
        return json_error
    mode = str(data.get("mode") or "").strip()
    if mode not in {"data", "procurement_advice", "app_help"}:
        return _error(request, ai_error("AI_UNSUPPORTED_MODE", "Chế độ trợ lý không được hỗ trợ."))
    try:
        result = await run_database_write(create_conversation, context, mode)
        return JSONResponse(result, status_code=201)
    except (DatabaseError, BlockingIOBusyError, BlockingIOTimeoutError) as exc:
        log_error(exc, "ai_create_conversation")
        return _error(request, ai_error("AI_DATA_UNAVAILABLE", "Không thể tạo cuộc trò chuyện."))


async def get_ai_conversation_api(request: Request):
    context, response = await _context_or_response(request)
    if response:
        return response
    conversation_id = str(request.path_params.get("conversation_id") or "").strip()
    try:
        conversation = await run_database_read(get_conversation, context, conversation_id, timeout_seconds=10)
        messages = await run_database_read(list_messages, context, conversation_id, timeout_seconds=10)
        return JSONResponse({"conversation": conversation, "messages": messages, "workspace": {"id": context.organization_id, "name": context.organization_name}})
    except AiError as exc:
        return _error(request, exc)
    except (DatabaseError, BlockingIOBusyError, BlockingIOTimeoutError) as exc:
        log_error(exc, "ai_get_conversation")
        return _error(request, ai_error("AI_DATA_UNAVAILABLE", "Không thể tải cuộc trò chuyện."))


async def list_ai_messages_api(request: Request):
    context, response = await _context_or_response(request)
    if response:
        return response
    conversation_id = str(request.path_params.get("conversation_id") or "").strip()
    try:
        limit = int(request.query_params.get("limit", "40"))
        offset = int(request.query_params.get("offset", "0"))
    except (TypeError, ValueError):
        return _error(request, ai_error("AI_INVALID_MESSAGE", "Tham số phân trang không hợp lệ."))
    if not 1 <= limit <= 100 or offset < 0:
        return _error(request, ai_error("AI_INVALID_MESSAGE", "Tham số phân trang không hợp lệ."))
    try:
        await run_database_read(get_conversation, context, conversation_id, timeout_seconds=10)
        messages, has_more = await run_database_read(
            list_messages_page,
            context,
            conversation_id,
            limit=limit,
            offset=offset,
            timeout_seconds=10,
        )
        return JSONResponse({
            "items": messages,
            "pagination": {
                "limit": limit,
                "offset": offset,
                "hasMore": has_more,
                "nextOffset": offset + limit if has_more else None,
            },
            "workspace": {"id": context.organization_id, "name": context.organization_name},
        })
    except AiError as exc:
        return _error(request, exc)
    except (DatabaseError, BlockingIOBusyError, BlockingIOTimeoutError) as exc:
        log_error(exc, "ai_list_messages")
        return _error(request, ai_error("AI_DATA_UNAVAILABLE", "Không thể tải tin nhắn trợ lý."))


async def delete_ai_conversation_api(request: Request):
    context, response = await _context_or_response(request)
    if response:
        return response
    conversation_id = str(request.path_params.get("conversation_id") or "").strip()
    try:
        await run_database_write(delete_conversation, context, conversation_id)
        return JSONResponse({"success": True})
    except AiError as exc:
        return _error(request, exc)
    except (DatabaseError, BlockingIOBusyError, BlockingIOTimeoutError) as exc:
        log_error(exc, "ai_delete_conversation")
        return _error(request, ai_error("AI_DATA_UNAVAILABLE", "Không thể xóa cuộc trò chuyện."))


async def send_ai_message_api(request: Request):
    context, response = await _context_or_response(request)
    if response:
        return response
    data, json_error = await read_json_object(request)
    if json_error:
        return json_error
    try:
        content = validate_message(data.get("content"))
        current_route = str(data.get("route") or "/").strip()
        if len(current_route) > 160 or not current_route.startswith("/") or current_route.startswith("//"):
            return _error(request, ai_error("AI_INVALID_MESSAGE", "Route ứng dụng không hợp lệ."))
        conversation_id = str(request.path_params.get("conversation_id") or "").strip()
        await run_database_read(get_conversation, context, conversation_id, timeout_seconds=10)
        await run_database_write(consume_request, context, get_ai_config())
    except AiError as exc:
        return _error(request, exc)
    except (DatabaseError, BlockingIOBusyError, BlockingIOTimeoutError, ValueError, TypeError) as exc:
        log_error(exc, "ai_validate_message")
        return _error(request, ai_error("AI_DATA_UNAVAILABLE", "Không thể xác thực cuộc trò chuyện."))

    increment("ai_requests_total")

    async def event_stream():
        started_at = time.perf_counter()
        increment("ai_active_streams")
        provider_stream = stream_message(
            request,
            context,
            conversation_id,
            content,
            current_route=current_route,
            quota_consumed=True,
        )
        try:
            iterator = provider_stream.__aiter__()
            while True:
                next_event = asyncio.create_task(anext(iterator))
                while not next_event.done():
                    await asyncio.wait({next_event}, timeout=0.25)
                    if await request.is_disconnected():
                        next_event.cancel()
                        with suppress(asyncio.CancelledError):
                            await next_event
                        return
                try:
                    event = next_event.result()
                except StopAsyncIteration:
                    return
                if await request.is_disconnected():
                    return
                yield f"data: {json.dumps(event, ensure_ascii=False, separators=(',', ':'))}\n\n".encode("utf-8")
        finally:
            with suppress(Exception):
                await provider_stream.aclose()
            increment("ai_request_duration_seconds", time.perf_counter() - started_at)
            increment("ai_active_streams", -1)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


async def ai_feedback_api(request: Request):
    context, response = await _context_or_response(request)
    if response:
        return response
    data, json_error = await read_json_object(request)
    if json_error:
        return json_error
    message_id = str(data.get("messageId") or "").strip()
    if request.method == "DELETE":
        if not message_id:
            return _error(request, ai_error("AI_INVALID_MESSAGE", "Feedback không hợp lệ."))
        try:
            await run_database_write(remove_feedback, context, message_id)
            return JSONResponse({"success": True, "removed": True})
        except AiError as exc:
            return _error(request, exc)
        except (DatabaseError, BlockingIOBusyError, BlockingIOTimeoutError) as exc:
            log_error(exc, "ai_feedback_remove")
            return _error(request, ai_error("AI_DATA_UNAVAILABLE", "Không thể bỏ feedback."))
    rating = str(data.get("rating") or "").strip()
    category = str(data.get("category") or "").strip()
    comment = data.get("comment")
    if not message_id or rating not in {"up", "down"} or category not in {"correct", "incorrect_data", "missing_source", "permission_issue", "not_helpful", "too_slow", "other"} or (comment is not None and (not isinstance(comment, str) or len(comment) > 1000)):
        return _error(request, ai_error("AI_INVALID_MESSAGE", "Feedback không hợp lệ."))
    try:
        await run_database_write(add_feedback, context, message_id, rating, category, comment)
        increment("ai_feedback_total")
        return JSONResponse({"success": True})
    except AiError as exc:
        return _error(request, exc)
    except (DatabaseError, BlockingIOBusyError, BlockingIOTimeoutError) as exc:
        log_error(exc, "ai_feedback")
        return _error(request, ai_error("AI_DATA_UNAVAILABLE", "Không thể lưu feedback."))


def _suggested_questions(route: str) -> list[dict[str, str]]:
    normalized = str(route or "/").strip().casefold()
    if "goi-thau-chi-tiet" in normalized:
        return [
            {"label": "Tóm tắt tiến độ gói này", "question": "Tóm tắt tiến độ gói này."},
            {"label": "Còn thiếu bước nào?", "question": "Gói này còn thiếu bước nào?"},
            {"label": "Ai đang được phân công?", "question": "Ai đang được phân công cho gói này?"},
        ]
    if "hop-dong" in normalized:
        return [
            {"label": "Giá trị và tiến độ", "question": "Giá trị và tiến độ hiện tại của hợp đồng này?"},
            {"label": "Có chậm tiến độ không?", "question": "Hợp đồng này có dấu hiệu chậm tiến độ không?"},
        ]
    return [
        {"label": "Gói cần mở thầu hôm nay", "question": "Hôm nay có mấy gói cần mở thầu?"},
        {"label": "Việc sắp đến hạn", "question": "Công việc nào của tôi sắp đến hạn?"},
        {"label": "Hợp đồng đang thực hiện", "question": "Có bao nhiêu hợp đồng đang thực hiện?"},
    ]


async def suggested_questions_api(request: Request):
    config = get_ai_config()
    if not config.enabled:
        return JSONResponse({"items": []})
    return JSONResponse({"items": _suggested_questions(request.query_params.get("route", "/"))})


ai_routes = [
    Route("/api/ai/config", ai_config_api, methods=["GET"]),
    Route("/api/ai/conversations", list_ai_conversations_api, methods=["GET"]),
    Route("/api/ai/conversations", create_ai_conversation_api, methods=["POST"]),
    Route("/api/ai/conversations/{conversation_id}/messages", send_ai_message_api, methods=["POST"]),
    Route("/api/ai/conversations/{conversation_id}/messages", list_ai_messages_api, methods=["GET"]),
    Route("/api/ai/conversations/{conversation_id}", get_ai_conversation_api, methods=["GET"]),
    Route("/api/ai/conversations/{conversation_id}", delete_ai_conversation_api, methods=["DELETE"]),
    Route("/api/ai/feedback", ai_feedback_api, methods=["POST", "DELETE"]),
    Route("/api/ai/suggested-questions", suggested_questions_api, methods=["GET"]),
]
