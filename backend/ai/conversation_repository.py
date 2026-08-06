"""Tenant-scoped persistence for conversations, messages and feedback."""

from __future__ import annotations

from datetime import datetime, timezone
import uuid

from backend.ai.errors import ai_error
from backend.ai.types import AiRequestContext
from backend.shared.helpers import database


def _id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def create_conversation(context: AiRequestContext, mode: str) -> dict:
    conversation_id = _id("aic")
    connection = database.get_connection()
    try:
        connection.execute(
            """INSERT INTO ai_conversations (id, organization_id, user_id, mode, title)
               VALUES (?, ?, ?, ?, ?)""",
            (conversation_id, context.organization_id, context.user_id, mode, None),
        )
        connection.commit()
        return {
            "id": conversation_id,
            "organizationId": context.organization_id,
            "organizationName": context.organization_name,
            "mode": mode,
            "title": None,
            "status": "active",
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }
    finally:
        connection.close()


def list_conversations(context: AiRequestContext, limit: int = 50) -> list[dict]:
    connection = database.get_connection()
    try:
        rows = connection.execute(
            """SELECT id, mode, title, status, created_at, updated_at
               FROM ai_conversations
               WHERE organization_id = ? AND user_id = ? AND status = 'active'
               ORDER BY updated_at DESC, id DESC LIMIT ?""",
            (context.organization_id, context.user_id, limit),
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        connection.close()


def get_conversation(context: AiRequestContext, conversation_id: str) -> dict:
    connection = database.get_connection()
    try:
        row = connection.execute(
            """SELECT id, organization_id, user_id, mode, title, status, created_at, updated_at
               FROM ai_conversations
               WHERE organization_id = ? AND user_id = ? AND id = ? AND status = 'active'
               LIMIT 1""",
            (context.organization_id, context.user_id, conversation_id),
        ).fetchone()
        if not row:
            raise ai_error("AI_CONVERSATION_NOT_FOUND", "Không tìm thấy cuộc trò chuyện trong workspace hiện tại.")
        return dict(row)
    finally:
        connection.close()


def delete_conversation(context: AiRequestContext, conversation_id: str) -> None:
    connection = database.get_connection()
    try:
        result = connection.execute(
            """UPDATE ai_conversations
               SET status = 'deleted', deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
               WHERE organization_id = ? AND user_id = ? AND id = ? AND status = 'active'""",
            (context.organization_id, context.user_id, conversation_id),
        )
        connection.commit()
        if result.rowcount != 1:
            raise ai_error("AI_CONVERSATION_NOT_FOUND", "Không tìm thấy cuộc trò chuyện trong workspace hiện tại.")
    finally:
        connection.close()


def add_message(context: AiRequestContext, conversation_id: str, role: str, content: str, *, status: str = "completed", model: str | None = None, input_tokens: int | None = None, output_tokens: int | None = None, error_code: str | None = None) -> str:
    message_id = _id("aim")
    connection = database.get_connection()
    try:
        connection.execute(
            """INSERT INTO ai_messages
               (id, organization_id, conversation_id, role, content, status, model, input_tokens, output_tokens, error_code)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (message_id, context.organization_id, conversation_id, role, content, status, model, input_tokens, output_tokens, error_code),
        )
        connection.execute(
            """UPDATE ai_conversations SET updated_at = CURRENT_TIMESTAMP,
                      title = CASE WHEN title IS NULL AND ? = 'user' THEN LEFT(?, 120) ELSE title END
               WHERE organization_id = ? AND user_id = ? AND id = ? AND status = 'active'""",
            (role, content, context.organization_id, context.user_id, conversation_id),
        )
        connection.commit()
        return message_id
    finally:
        connection.close()


def list_messages(context: AiRequestContext, conversation_id: str, limit: int = 40) -> list[dict]:
    connection = database.get_connection()
    try:
        rows = connection.execute(
            """SELECT m.id, m.role, m.content, m.status, m.model,
                      m.input_tokens, m.output_tokens, m.error_code, m.created_at,
                      f.rating AS feedback_rating
               FROM ai_messages m JOIN ai_conversations c
                 ON c.organization_id = m.organization_id AND c.id = m.conversation_id
               LEFT JOIN ai_feedback f
                 ON f.organization_id = m.organization_id AND f.message_id = m.id AND f.user_id = c.user_id
               WHERE m.organization_id = ? AND c.user_id = ? AND m.conversation_id = ?
                 AND c.status = 'active'
               ORDER BY m.created_at DESC, m.id DESC LIMIT ?""",
            (context.organization_id, context.user_id, conversation_id, limit),
        ).fetchall()
        return [dict(row) for row in reversed(rows)]
    finally:
        connection.close()


def list_messages_page(
    context: AiRequestContext,
    conversation_id: str,
    *,
    limit: int = 40,
    offset: int = 0,
) -> tuple[list[dict], bool]:
    """Return a bounded chronological page and whether newer pages remain."""

    safe_limit = max(1, min(100, int(limit)))
    safe_offset = max(0, int(offset))
    connection = database.get_connection()
    try:
        rows = connection.execute(
            """SELECT m.id, m.role, m.content, m.status, m.model,
                      m.input_tokens, m.output_tokens, m.error_code, m.created_at,
                      f.rating AS feedback_rating
               FROM ai_messages m JOIN ai_conversations c
                 ON c.organization_id = m.organization_id AND c.id = m.conversation_id
               LEFT JOIN ai_feedback f
                 ON f.organization_id = m.organization_id AND f.message_id = m.id AND f.user_id = c.user_id
               WHERE m.organization_id = ? AND c.user_id = ? AND m.conversation_id = ?
                 AND c.status = 'active'
               ORDER BY m.created_at DESC, m.id DESC LIMIT ? OFFSET ?""",
            (context.organization_id, context.user_id, conversation_id, safe_limit + 1, safe_offset),
        ).fetchall()
        has_more = len(rows) > safe_limit
        page = rows[:safe_limit]
        return [dict(row) for row in reversed(page)], has_more
    finally:
        connection.close()


def add_tool_execution(context: AiRequestContext, conversation_id: str, message_id: str | None, *, tool_name: str, arguments_redacted: str, result_summary: str | None, record_count: int, duration_ms: int, status: str, error_code: str | None = None) -> None:
    connection = database.get_connection()
    try:
        connection.execute(
            """INSERT INTO ai_tool_executions
               (id, organization_id, conversation_id, message_id, user_id, tool_name,
                arguments_redacted, result_summary, record_count, duration_ms, status, error_code)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (_id("ait"), context.organization_id, conversation_id, message_id, context.user_id, tool_name, arguments_redacted, result_summary, max(0, int(record_count)), max(0, int(duration_ms)), status, error_code),
        )
        connection.commit()
    finally:
        connection.close()


def _assert_message_access(connection, context: AiRequestContext, message_id: str) -> None:
    message = connection.execute(
        """SELECT 1 FROM ai_messages m JOIN ai_conversations c
            ON c.organization_id = m.organization_id AND c.id = m.conversation_id
           WHERE m.organization_id = ? AND m.id = ? AND c.user_id = ? LIMIT 1""",
        (context.organization_id, message_id, context.user_id),
    ).fetchone()
    if not message:
        raise ai_error("AI_CONVERSATION_NOT_FOUND", "Không tìm thấy tin nhắn trong workspace hiện tại.")


def add_feedback(context: AiRequestContext, message_id: str, rating: str, category: str, comment: str | None) -> None:
    connection = database.get_connection()
    try:
        _assert_message_access(connection, context, message_id)
        connection.execute(
            """INSERT INTO ai_feedback (id, organization_id, message_id, user_id, rating, category, comment)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (organization_id, message_id, user_id) DO UPDATE SET
                 rating = excluded.rating, category = excluded.category,
                 comment = excluded.comment, created_at = CURRENT_TIMESTAMP""",
            (_id("aif"), context.organization_id, message_id, context.user_id, rating, category, comment),
        )
        connection.commit()
    finally:
        connection.close()


def remove_feedback(context: AiRequestContext, message_id: str) -> None:
    connection = database.get_connection()
    try:
        _assert_message_access(connection, context, message_id)
        connection.execute(
            "DELETE FROM ai_feedback WHERE organization_id = ? AND message_id = ? AND user_id = ?",
            (context.organization_id, message_id, context.user_id),
        )
        connection.commit()
    finally:
        connection.close()


def cleanup_expired_conversations(retention_days: int) -> int:
    connection = database.get_connection()
    try:
        result = connection.execute(
            """UPDATE ai_conversations SET status = 'deleted', deleted_at = CURRENT_TIMESTAMP
               WHERE status = 'active' AND updated_at < CURRENT_TIMESTAMP - (? * INTERVAL '1 day')""",
            (max(1, int(retention_days)),),
        )
        connection.commit()
        return int(result.rowcount or 0)
    finally:
        connection.close()
