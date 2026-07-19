"""Persist provider-acceptance state for sensitive authentication email."""

from __future__ import annotations

import hashlib
import random
import re
import time
import uuid

from backend.auth.email_utils import gui_email
from backend.shared.logging_utils import log_structured_event


MAX_DELIVERY_ATTEMPTS = 3
_ERROR_CODE = re.compile(r"^[A-Z0-9_]{1,64}$")


def _recipient_hash(recipient: str) -> str:
    return hashlib.sha256(str(recipient or "").strip().casefold().encode("utf-8")).hexdigest()


def create_email_delivery(cursor, *, user_id: str, purpose: str, recipient: str, now=None) -> str:
    current_time = int(time.time() if now is None else now)
    delivery_id = str(uuid.uuid4())
    cursor.execute(
        """INSERT INTO email_delivery_status (
               id, user_id, purpose, recipient_hash, status, attempt_count,
               created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)""",
        (delivery_id, user_id, purpose, _recipient_hash(recipient), current_time, current_time),
    )
    return delivery_id


def _safe_error_code(value) -> str:
    candidate = str(value or "SMTP_DELIVERY_FAILED").strip().upper()
    return candidate if _ERROR_CODE.fullmatch(candidate) else "SMTP_DELIVERY_FAILED"


def _record_attempt(database, delivery_id: str, result, *, max_attempts: int, now=None) -> tuple[bool, int, str]:
    current_time = int(time.time() if now is None else now)
    connection = database.get_connection()
    try:
        connection.execute("BEGIN")
        row = connection.execute(
            "SELECT status, attempt_count FROM email_delivery_status WHERE id = ? FOR UPDATE",
            (delivery_id,),
        ).fetchone()
        if row is None:
            connection.rollback()
            return False, max_attempts, "failed"
        if row["status"] == "sent":
            connection.commit()
            return True, int(row["attempt_count"]), "sent"

        attempts = int(row["attempt_count"]) + 1
        accepted = bool(result)
        if accepted:
            status = "sent"
            next_attempt_at = None
            accepted_at = current_time
            error_code = None
        else:
            status = "retry" if attempts < max_attempts else "failed"
            next_attempt_at = current_time + min(60, 2 ** max(0, attempts - 1)) if status == "retry" else None
            accepted_at = None
            error_code = _safe_error_code(getattr(result, "error_code", None))

        connection.execute(
            """UPDATE email_delivery_status
               SET status = ?, attempt_count = ?, last_error_code = ?,
                   next_attempt_at = ?, accepted_at = ?, updated_at = ?
               WHERE id = ?""",
            (status, attempts, error_code, next_attempt_at, accepted_at, current_time, delivery_id),
        )
        connection.commit()
        return accepted, attempts, status
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def deliver_email_once(
    database,
    delivery_id: str,
    recipient: str,
    subject: str,
    html_body: str,
    *,
    sensitive_content: bool = True,
    max_attempts: int = MAX_DELIVERY_ATTEMPTS,
) -> bool:
    result = gui_email(recipient, subject, html_body, sensitive_content)
    accepted, _attempts, _status = _record_attempt(
        database,
        delivery_id,
        result,
        max_attempts=max_attempts,
    )
    return accepted


def retry_email_delivery(
    database,
    delivery_id: str,
    recipient: str,
    subject: str,
    html_body: str,
    *,
    sensitive_content: bool = True,
    max_attempts: int = MAX_DELIVERY_ATTEMPTS,
) -> bool:
    """Retry transient failure with bounded exponential backoff and jitter."""

    while True:
        connection = database.get_connection()
        try:
            row = connection.execute(
                "SELECT status, attempt_count, next_attempt_at FROM email_delivery_status WHERE id = ?",
                (delivery_id,),
            ).fetchone()
        finally:
            connection.close()
        if row is None or row["status"] in {"sent", "failed"}:
            return bool(row and row["status"] == "sent")
        attempts = int(row["attempt_count"])
        if attempts >= max_attempts:
            return False
        due_at = int(row["next_attempt_at"] or int(time.time()))
        delay = max(0.0, due_at - time.time()) + random.uniform(0.0, 0.25)
        if delay:
            time.sleep(min(delay, 60.0))
        if deliver_email_once(
            database,
            delivery_id,
            recipient,
            subject,
            html_body,
            sensitive_content=sensitive_content,
            max_attempts=max_attempts,
        ):
            return True


def fail_stale_email_deliveries(database, *, stale_after_seconds=900, retention_days=30) -> None:
    now = int(time.time())
    connection = database.get_connection()
    try:
        connection.execute("BEGIN")
        leader = connection.execute(
            "SELECT pg_try_advisory_xact_lock(hashtext('biddingflow-email-delivery-cleanup'))"
        ).fetchone()
        if not leader or not leader[0]:
            connection.rollback()
            return
        connection.execute(
            """UPDATE email_delivery_status
               SET status = 'failed', last_error_code = 'DELIVERY_CONTEXT_LOST',
                   next_attempt_at = NULL, updated_at = ?
               WHERE status IN ('pending', 'sending', 'retry') AND updated_at < ?""",
            (now, now - max(60, int(stale_after_seconds))),
        )
        connection.execute(
            "DELETE FROM email_delivery_status WHERE created_at < ?",
            (now - max(1, int(retention_days)) * 86400,),
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()

    log_structured_event("email.delivery_status_cleanup")
