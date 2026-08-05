"""Persistent daily quota, scoped by user and workspace."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from backend.ai.configuration import AiConfig, get_ai_config
from backend.ai.errors import ai_error
from backend.ai.types import AiRequestContext
from backend.shared.helpers import database
from backend.ai.metrics import increment


VIETNAM_TZ = ZoneInfo("Asia/Bangkok")


def _usage_date() -> str:
    return datetime.now(VIETNAM_TZ).date().isoformat()


def consume_request(context: AiRequestContext, config: AiConfig) -> None:
    connection = database.get_connection()
    try:
        existing = connection.execute(
            """SELECT request_count FROM ai_usage_daily
               WHERE usage_date = ? AND organization_id = ? AND user_id = ?
               LIMIT 1""",
            (_usage_date(), context.organization_id, context.user_id),
        ).fetchone()
        if existing and int(existing[0] or 0) >= config.daily_request_limit:
            connection.rollback()
            increment("ai_quota_rejections_total")
            raise ai_error("AI_QUOTA_EXCEEDED", "Bạn đã vượt quota AI trong ngày của workspace này.")
        row = connection.execute(
            """INSERT INTO ai_usage_daily (usage_date, organization_id, user_id, request_count)
               VALUES (?, ?, ?, 1)
               ON CONFLICT (usage_date, organization_id, user_id) DO UPDATE SET
                 request_count = ai_usage_daily.request_count + 1,
                 updated_at = CURRENT_TIMESTAMP
               WHERE ai_usage_daily.request_count < ?
               RETURNING request_count""",
            (_usage_date(), context.organization_id, context.user_id, config.daily_request_limit),
        ).fetchone()
        if not row:
            connection.rollback()
            increment("ai_quota_rejections_total")
            raise ai_error("AI_QUOTA_EXCEEDED", "Bạn đã vượt quota AI trong ngày của workspace này.")
        connection.commit()
    finally:
        connection.close()


def record_tokens(
    context: AiRequestContext,
    input_tokens: int,
    output_tokens: int,
    tool_calls: int = 0,
    *,
    config: AiConfig | None = None,
) -> None:
    config = config or get_ai_config()
    connection = database.get_connection()
    try:
        row = connection.execute(
            """INSERT INTO ai_usage_daily (usage_date, organization_id, user_id, input_tokens, output_tokens, tool_call_count)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT (usage_date, organization_id, user_id) DO UPDATE SET
                 input_tokens = ai_usage_daily.input_tokens + excluded.input_tokens,
                 output_tokens = ai_usage_daily.output_tokens + excluded.output_tokens,
                 tool_call_count = ai_usage_daily.tool_call_count + excluded.tool_call_count,
                 updated_at = CURRENT_TIMESTAMP
               RETURNING input_tokens, output_tokens""",
            (_usage_date(), context.organization_id, context.user_id, max(0, int(input_tokens or 0)), max(0, int(output_tokens or 0)), max(0, int(tool_calls or 0))),
        ).fetchone()
        total_tokens = (int(row[0] or 0) + int(row[1] or 0)) if row else 0
        if total_tokens > config.daily_token_limit:
            connection.rollback()
            increment("ai_quota_rejections_total")
            raise ai_error("AI_QUOTA_EXCEEDED", "Bạn đã vượt quota token AI trong ngày của workspace này.")
        connection.commit()
    finally:
        connection.close()
