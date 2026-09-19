"""Persistent daily AI quota with idempotent token reservations."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import uuid
from zoneinfo import ZoneInfo

from backend.ai.configuration import AiConfig, get_ai_config
from backend.ai.errors import ai_error
from backend.ai.metrics import increment
from backend.ai.types import AiRequestContext
from backend.shared.helpers import database

VIETNAM_TZ = ZoneInfo("Asia/Bangkok")


def _usage_date() -> str:
    return datetime.now(VIETNAM_TZ).date().isoformat()


@dataclass(frozen=True)
class TokenReservation:
    id: str
    usage_date: str
    organization_id: str
    user_id: str
    reserved_tokens: int


def consume_request(context: AiRequestContext, config: AiConfig) -> None:
    usage_date = _usage_date()
    connection = database.get_connection()
    try:
        row = connection.execute(
            """INSERT INTO ai_usage_daily (usage_date, organization_id, user_id, request_count)
               VALUES (?, ?, ?, 1)
               ON CONFLICT (usage_date, organization_id, user_id) DO UPDATE SET
                 request_count = ai_usage_daily.request_count + 1, updated_at = CURRENT_TIMESTAMP
               WHERE ai_usage_daily.request_count < ? RETURNING request_count""",
            (usage_date, context.organization_id, context.user_id, config.daily_request_limit),
        ).fetchone()
        if not row:
            connection.rollback()
            increment("ai_quota_rejections_total")
            raise ai_error("AI_QUOTA_EXCEEDED", "Bạn đã vượt quota AI trong ngày của workspace này.")
        connection.commit()
    finally:
        connection.close()


def record_tokens(context: AiRequestContext, input_tokens: int, output_tokens: int,
                  tool_calls: int = 0, *, config: AiConfig | None = None) -> None:
    config = config or get_ai_config()
    usage_date = _usage_date()
    incoming_input = max(0, int(input_tokens or 0))
    incoming_output = max(0, int(output_tokens or 0))
    connection = database.get_connection()
    try:
        row = connection.execute(
            """INSERT INTO ai_usage_daily
                 (usage_date, organization_id, user_id, input_tokens, output_tokens, tool_call_count)
               SELECT ?, ?, ?, ?, ?, ? WHERE ? + ? <= ?
               ON CONFLICT (usage_date, organization_id, user_id) DO UPDATE SET
                 input_tokens = ai_usage_daily.input_tokens + excluded.input_tokens,
                 output_tokens = ai_usage_daily.output_tokens + excluded.output_tokens,
                 tool_call_count = ai_usage_daily.tool_call_count + excluded.tool_call_count,
                 updated_at = CURRENT_TIMESTAMP
               WHERE ai_usage_daily.input_tokens + ai_usage_daily.output_tokens
                     + ai_usage_daily.reserved_tokens + excluded.input_tokens
                     + excluded.output_tokens <= ?
               RETURNING input_tokens, output_tokens""",
            (usage_date, context.organization_id, context.user_id, incoming_input,
             incoming_output, max(0, int(tool_calls or 0)), incoming_input,
             incoming_output, config.daily_token_limit, config.daily_token_limit),
        ).fetchone()
        if not row:
            connection.rollback()
            increment("ai_quota_rejections_total")
            raise ai_error("AI_QUOTA_EXCEEDED", "Bạn đã vượt quota token AI trong ngày của workspace này.")
        connection.commit()
    finally:
        connection.close()


def reserve_tokens(context: AiRequestContext, estimated_tokens: int, *, config: AiConfig) -> TokenReservation:
    amount = max(0, int(estimated_tokens or 0))
    reservation = TokenReservation(str(uuid.uuid4()), _usage_date(), context.organization_id,
                                   context.user_id, amount)
    connection = database.get_connection()
    try:
        row = connection.execute(
            """INSERT INTO ai_usage_daily (usage_date, organization_id, user_id, reserved_tokens)
               SELECT ?, ?, ?, ? WHERE ? <= ?
               ON CONFLICT (usage_date, organization_id, user_id) DO UPDATE SET
                 reserved_tokens = ai_usage_daily.reserved_tokens + excluded.reserved_tokens,
                 updated_at = CURRENT_TIMESTAMP
               WHERE ai_usage_daily.input_tokens + ai_usage_daily.output_tokens
                     + ai_usage_daily.reserved_tokens + excluded.reserved_tokens <= ?
               RETURNING reserved_tokens""",
            (reservation.usage_date, reservation.organization_id, reservation.user_id,
             amount, amount, config.daily_token_limit, config.daily_token_limit),
        ).fetchone()
        if not row:
            connection.rollback()
            increment("ai_token_reservation_rejections_total")
            increment("ai_quota_rejections_total")
            raise ai_error("AI_QUOTA_EXCEEDED", "Bạn đã vượt quota token AI trong ngày của workspace này.")
        connection.execute(
            """INSERT INTO ai_token_reservations
                 (id, usage_date, organization_id, user_id, reserved_tokens, status)
               VALUES (?, ?, ?, ?, ?, 'reserved')""",
            (reservation.id, reservation.usage_date, reservation.organization_id,
             reservation.user_id, reservation.reserved_tokens),
        )
        connection.commit()
        increment("ai_token_reservations_total")
        return reservation
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def settle_token_reservation(reservation: TokenReservation, actual_input: int,
                             actual_output: int, *, config: AiConfig | None = None) -> bool:
    config = config or get_ai_config()
    actual_input = max(0, int(actual_input or 0))
    actual_output = max(0, int(actual_output or 0))
    connection = database.get_connection()
    try:
        row = connection.execute(
            "SELECT status FROM ai_token_reservations WHERE id = ? FOR UPDATE",
            (reservation.id,),
        ).fetchone()
        if not row or row[0] != "reserved":
            connection.rollback()
            increment("ai_token_settlement_failures_total")
            return False
        usage = connection.execute(
            """UPDATE ai_usage_daily SET reserved_tokens = reserved_tokens - ?,
                 input_tokens = input_tokens + ?, output_tokens = output_tokens + ?,
                 updated_at = CURRENT_TIMESTAMP
               WHERE usage_date = ? AND organization_id = ? AND user_id = ?
                 AND reserved_tokens >= ?
                 AND input_tokens + output_tokens + reserved_tokens - ? + ? + ? <= ?
               RETURNING reserved_tokens""",
            (reservation.reserved_tokens, actual_input, actual_output,
             reservation.usage_date, reservation.organization_id, reservation.user_id,
             reservation.reserved_tokens, reservation.reserved_tokens, actual_input,
             actual_output, config.daily_token_limit),
        ).fetchone()
        if not usage:
            connection.rollback()
            increment("ai_token_settlement_failures_total")
            if actual_input + actual_output > reservation.reserved_tokens:
                increment("ai_token_settlement_overage_total")
            raise ai_error("AI_QUOTA_EXCEEDED", "Mức sử dụng token thực tế vượt quota AI trong ngày.")
        connection.execute(
            """UPDATE ai_token_reservations SET status = 'settled', actual_input_tokens = ?,
                 actual_output_tokens = ?, settled_at = CURRENT_TIMESTAMP WHERE id = ?""",
            (actual_input, actual_output, reservation.id),
        )
        connection.commit()
        return True
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def release_token_reservation(reservation: TokenReservation) -> bool:
    connection = database.get_connection()
    try:
        row = connection.execute(
            "SELECT status FROM ai_token_reservations WHERE id = ? FOR UPDATE",
            (reservation.id,),
        ).fetchone()
        if not row or row[0] != "reserved":
            connection.rollback()
            increment("ai_token_settlement_failures_total")
            return False
        usage = connection.execute(
            """UPDATE ai_usage_daily SET reserved_tokens = reserved_tokens - ?,
                 updated_at = CURRENT_TIMESTAMP
               WHERE usage_date = ? AND organization_id = ? AND user_id = ?
                 AND reserved_tokens >= ? RETURNING reserved_tokens""",
            (reservation.reserved_tokens, reservation.usage_date, reservation.organization_id,
             reservation.user_id, reservation.reserved_tokens),
        ).fetchone()
        if not usage:
            connection.rollback()
            increment("ai_token_settlement_failures_total")
            return False
        connection.execute(
            """UPDATE ai_token_reservations SET status = 'released', settled_at = CURRENT_TIMESTAMP
               WHERE id = ?""",
            (reservation.id,),
        )
        connection.commit()
        increment("ai_token_reservation_releases_total")
        return True
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
