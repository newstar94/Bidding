"""Durable, encrypted outbox for sensitive authentication email."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import os
import random
import re
import time
import uuid
from types import SimpleNamespace

from cryptography.fernet import Fernet, InvalidToken

from backend.auth.email_utils import gui_email
from backend.shared.async_io import BlockingIOBusyError, run_blocking_io
from backend.shared.logging_utils import log_error, log_structured_event


MAX_DELIVERY_ATTEMPTS = 3
_ERROR_CODE = re.compile(r"^[A-Z0-9_]{1,64}$")
_WORKER_ID = f"{os.getpid()}-{uuid.uuid4().hex[:12]}"


class EmailOutboxConfigurationError(RuntimeError):
    pass


class EmailOutboxPayloadError(RuntimeError):
    pass


def _recipient_hash(recipient: str) -> str:
    return hashlib.sha256(
        str(recipient or "").strip().casefold().encode("utf-8")
    ).hexdigest()


def _configured_key(environ=None) -> str:
    environ = os.environ if environ is None else environ
    dedicated = str(environ.get("EMAIL_OUTBOX_ENCRYPTION_KEY", "")).strip()
    if dedicated:
        return dedicated
    # Development/test installs may reuse the already protected MFA key so a
    # fresh install remains convenient. Production validation rejects this
    # fallback and requires an independently rotatable outbox key.
    if str(environ.get("APP_ENV", "development")).strip().lower() not in {
        "prod",
        "production",
    }:
        return str(environ.get("MFA_ENCRYPTION_KEY", "")).strip()
    return ""


def validate_email_outbox_configuration(environ=None, *, required=False) -> None:
    environ = os.environ if environ is None else environ
    key = _configured_key(environ)
    if not key:
        if required:
            raise EmailOutboxConfigurationError(
                "EMAIL_OUTBOX_ENCRYPTION_KEY is required."
            )
        return
    try:
        decoded = base64.urlsafe_b64decode(key.encode("ascii"))
        Fernet(key.encode("ascii"))
    except Exception as exc:
        raise EmailOutboxConfigurationError(
            "EMAIL_OUTBOX_ENCRYPTION_KEY is not a valid Fernet key."
        ) from exc
    if len(decoded) != 32:
        raise EmailOutboxConfigurationError(
            "EMAIL_OUTBOX_ENCRYPTION_KEY must decode to 32 bytes."
        )
    if required and not str(
        environ.get("EMAIL_OUTBOX_ENCRYPTION_KEY", "")
    ).strip():
        raise EmailOutboxConfigurationError(
            "Production requires a dedicated EMAIL_OUTBOX_ENCRYPTION_KEY."
        )


def _fernet() -> Fernet:
    key = _configured_key()
    if not key:
        raise EmailOutboxConfigurationError(
            "EMAIL_OUTBOX_ENCRYPTION_KEY is not configured."
        )
    return Fernet(key.encode("ascii"))


def _encrypt(value: str) -> str:
    return _fernet().encrypt(str(value).encode("utf-8")).decode("ascii")


def _decrypt(value: str) -> str:
    try:
        return _fernet().decrypt(str(value).encode("ascii")).decode("utf-8")
    except (InvalidToken, UnicodeError, ValueError) as exc:
        raise EmailOutboxPayloadError(
            "Encrypted email payload cannot be authenticated."
        ) from exc


def create_email_delivery(
    cursor,
    *,
    user_id: str,
    purpose: str,
    recipient: str,
    subject: str | None = None,
    html_body: str | None = None,
    sensitive_content: bool = True,
    now=None,
) -> str:
    """Insert the outbox row in the caller's account-creation transaction."""

    if (subject is None) != (html_body is None):
        raise ValueError("Email subject and body must be supplied together.")
    current_time = int(time.time() if now is None else now)
    delivery_id = str(uuid.uuid4())
    payload = (
        (_encrypt(recipient), _encrypt(subject), _encrypt(html_body))
        if subject is not None
        else (None, None, None)
    )
    cursor.execute(
        """INSERT INTO email_delivery_status (
               id, user_id, purpose, recipient_hash,
               recipient_ciphertext, subject_ciphertext, body_ciphertext,
               sensitive_content, status, attempt_count, next_attempt_at,
               created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)""",
        (
            delivery_id,
            user_id,
            purpose,
            _recipient_hash(recipient),
            *payload,
            1 if sensitive_content else 0,
            current_time,
            current_time,
            current_time,
        ),
    )
    return delivery_id


def _safe_error_code(value) -> str:
    candidate = str(value or "SMTP_DELIVERY_FAILED").strip().upper()
    return candidate if _ERROR_CODE.fullmatch(candidate) else "SMTP_DELIVERY_FAILED"


def _store_payload_if_missing(
    database,
    delivery_id: str,
    recipient: str,
    subject: str,
    html_body: str,
    sensitive_content: bool,
) -> None:
    connection = database.get_connection()
    try:
        connection.execute("BEGIN")
        row = connection.execute(
            """SELECT status, recipient_ciphertext
               FROM email_delivery_status WHERE id = ? FOR UPDATE""",
            (delivery_id,),
        ).fetchone()
        if row is None:
            connection.rollback()
            raise EmailOutboxPayloadError("Email delivery row no longer exists.")
        if row["recipient_ciphertext"] is None:
            now = int(time.time())
            connection.execute(
                """UPDATE email_delivery_status
                   SET recipient_ciphertext = ?, subject_ciphertext = ?,
                       body_ciphertext = ?, sensitive_content = ?,
                       next_attempt_at = COALESCE(next_attempt_at, ?),
                       updated_at = ?
                   WHERE id = ?""",
                (
                    _encrypt(recipient),
                    _encrypt(subject),
                    _encrypt(html_body),
                    1 if sensitive_content else 0,
                    now,
                    now,
                    delivery_id,
                ),
            )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _claim_email_delivery(
    database,
    *,
    delivery_id: str | None = None,
    max_attempts: int = MAX_DELIVERY_ATTEMPTS,
):
    now = int(time.time())
    try:
        stale_seconds = max(
            60,
            min(3_600, int(os.environ.get("EMAIL_OUTBOX_STALE_SECONDS", "300"))),
        )
    except ValueError:
        stale_seconds = 300
    connection = database.get_connection()
    try:
        connection.execute("BEGIN")
        row = connection.execute(
            """SELECT id, recipient_ciphertext, subject_ciphertext,
                      body_ciphertext, sensitive_content, attempt_count
               FROM email_delivery_status
               WHERE (CAST(? AS TEXT) IS NULL OR id = ?)
                 AND (CAST(? AS TEXT) IS NOT NULL OR created_at <= ?)
                 AND recipient_ciphertext IS NOT NULL
                 AND subject_ciphertext IS NOT NULL
                 AND body_ciphertext IS NOT NULL
                 AND attempt_count < ?
                 AND (
                       (status IN ('pending', 'retry')
                        AND COALESCE(next_attempt_at, 0) <= ?)
                    OR (status = 'sending' AND locked_at <= ?)
                 )
               ORDER BY COALESCE(next_attempt_at, created_at), created_at, id
               FOR UPDATE SKIP LOCKED
               LIMIT 1""",
            (
                delivery_id,
                delivery_id,
                delivery_id,
                now - 2,
                max_attempts,
                now,
                now - stale_seconds,
            ),
        ).fetchone()
        if row is None:
            connection.commit()
            return None
        lock_token = f"{_WORKER_ID}:{uuid.uuid4().hex}"
        attempt_count = int(row["attempt_count"] or 0) + 1
        connection.execute(
            """UPDATE email_delivery_status
               SET status = 'sending', attempt_count = ?, locked_at = ?,
                   locked_by = ?, updated_at = ?
               WHERE id = ?""",
            (attempt_count, now, lock_token, now, row["id"]),
        )
        connection.commit()
        claimed = dict(row)
        claimed["attempt_count"] = attempt_count
        claimed["lock_token"] = lock_token
        return claimed
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _finish_email_delivery(
    database,
    claimed,
    result,
    *,
    max_attempts: int,
    now=None,
) -> bool:
    current_time = int(time.time() if now is None else now)
    attempts = int(claimed["attempt_count"])
    accepted = bool(getattr(result, "accepted", result))
    if accepted:
        status = "sent"
        next_attempt_at = None
        accepted_at = current_time
        error_code = None
    else:
        status = "retry" if attempts < max_attempts else "failed"
        next_attempt_at = (
            current_time + min(300, 2 ** max(0, attempts - 1))
            if status == "retry"
            else None
        )
        accepted_at = None
        error_code = _safe_error_code(getattr(result, "error_code", None))

    connection = database.get_connection()
    try:
        updated = connection.execute(
            """UPDATE email_delivery_status
               SET status = ?, last_error_code = ?, next_attempt_at = ?,
                   accepted_at = ?, locked_at = NULL, locked_by = NULL,
                   updated_at = ?
               WHERE id = ? AND status = 'sending' AND locked_by = ?""",
            (
                status,
                error_code,
                next_attempt_at,
                accepted_at,
                current_time,
                claimed["id"],
                claimed["lock_token"],
            ),
        )
        connection.commit()
        return accepted and updated.rowcount == 1
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _deliver_claimed(
    database,
    claimed,
    *,
    max_attempts: int = MAX_DELIVERY_ATTEMPTS,
) -> bool:
    try:
        recipient = _decrypt(claimed["recipient_ciphertext"])
        subject = _decrypt(claimed["subject_ciphertext"])
        html_body = _decrypt(claimed["body_ciphertext"])
        result = gui_email(
            recipient,
            subject,
            html_body,
            bool(claimed["sensitive_content"]),
        )
    except Exception as exc:
        result = SimpleNamespace(
            accepted=False,
            error_code=(
                "OUTBOX_PAYLOAD_INVALID"
                if isinstance(exc, EmailOutboxPayloadError)
                else "SMTP_DELIVERY_FAILED"
            ),
        )
    return _finish_email_delivery(
        database,
        claimed,
        result,
        max_attempts=max_attempts,
    )


def deliver_email_once(
    database,
    delivery_id: str,
    recipient: str | None = None,
    subject: str | None = None,
    html_body: str | None = None,
    *,
    sensitive_content: bool = True,
    max_attempts: int = MAX_DELIVERY_ATTEMPTS,
) -> bool:
    """Claim and deliver one outbox row; payload arguments support old callers."""

    supplied = (recipient, subject, html_body)
    if any(value is not None for value in supplied):
        if not all(value is not None for value in supplied):
            raise ValueError("Recipient, subject and body must be supplied together.")
        _store_payload_if_missing(
            database,
            delivery_id,
            str(recipient),
            str(subject),
            str(html_body),
            sensitive_content,
        )
    claimed = _claim_email_delivery(
        database,
        delivery_id=delivery_id,
        max_attempts=max_attempts,
    )
    if claimed is None:
        connection = database.get_connection()
        try:
            row = connection.execute(
                "SELECT status FROM email_delivery_status WHERE id = ?",
                (delivery_id,),
            ).fetchone()
            return bool(row and row["status"] == "sent")
        finally:
            connection.close()
    return _deliver_claimed(database, claimed, max_attempts=max_attempts)


def retry_email_delivery(
    database,
    delivery_id: str,
    recipient: str | None = None,
    subject: str | None = None,
    html_body: str | None = None,
    *,
    sensitive_content: bool = True,
    max_attempts: int = MAX_DELIVERY_ATTEMPTS,
) -> bool:
    """Compatibility helper; durable workers normally perform these retries."""

    supplied = (recipient, subject, html_body)
    if any(value is not None for value in supplied):
        if not all(value is not None for value in supplied):
            raise ValueError("Recipient, subject and body must be supplied together.")
        _store_payload_if_missing(
            database,
            delivery_id,
            str(recipient),
            str(subject),
            str(html_body),
            sensitive_content,
        )
    while True:
        connection = database.get_connection()
        try:
            row = connection.execute(
                """SELECT status, attempt_count, next_attempt_at
                   FROM email_delivery_status WHERE id = ?""",
                (delivery_id,),
            ).fetchone()
        finally:
            connection.close()
        if row is None or row["status"] in {"sent", "failed"}:
            return bool(row and row["status"] == "sent")
        if int(row["attempt_count"]) >= max_attempts:
            return False
        due_at = int(row["next_attempt_at"] or int(time.time()))
        delay = max(0.0, due_at - time.time()) + random.uniform(0.0, 0.25)
        if delay:
            time.sleep(min(delay, 300.0))
        if deliver_email_once(
            database,
            delivery_id,
            max_attempts=max_attempts,
        ):
            return True


def process_next_email_delivery(database) -> bool:
    claimed = _claim_email_delivery(database)
    if claimed is None:
        return False
    _deliver_claimed(database, claimed)
    return True


async def run_email_delivery_worker(database) -> None:
    """Continuously drain durable outbox rows across any number of web workers."""

    while True:
        try:
            processed = await run_blocking_io(
                process_next_email_delivery,
                database,
                timeout_seconds=30.0,
            )
        except BlockingIOBusyError:
            processed = False
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log_error(exc, "email_outbox_worker", level="WARN")
            processed = False
        try:
            idle_poll_seconds = max(
                1.0,
                min(
                    30.0,
                    float(os.environ.get("EMAIL_OUTBOX_POLL_SECONDS", "5")),
                ),
            )
        except ValueError:
            idle_poll_seconds = 5.0
        await asyncio.sleep(0.05 if processed else idle_poll_seconds)


def fail_stale_email_deliveries(
    database,
    *,
    stale_after_seconds=900,
    retention_days=30,
) -> None:
    """Recover abandoned claims and purge terminal rows under one leader lock."""

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
        stale_before = now - max(60, int(stale_after_seconds))
        connection.execute(
            """UPDATE email_delivery_status
               SET status = CASE
                       WHEN attempt_count < ? THEN 'retry'
                       ELSE 'failed'
                   END,
                   last_error_code = CASE
                       WHEN attempt_count < ? THEN 'WORKER_INTERRUPTED'
                       ELSE 'MAX_ATTEMPTS_EXCEEDED'
                   END,
                   next_attempt_at = CASE
                       WHEN attempt_count < ? THEN ?
                       ELSE NULL
                   END,
                   locked_at = NULL, locked_by = NULL, updated_at = ?
               WHERE status = 'sending' AND locked_at < ?""",
            (
                MAX_DELIVERY_ATTEMPTS,
                MAX_DELIVERY_ATTEMPTS,
                MAX_DELIVERY_ATTEMPTS,
                now,
                now,
                stale_before,
            ),
        )
        connection.execute(
            """UPDATE email_delivery_status
               SET status = 'failed', last_error_code = 'DELIVERY_PAYLOAD_MISSING',
                   next_attempt_at = NULL, updated_at = ?
               WHERE status IN ('pending', 'retry')
                 AND recipient_ciphertext IS NULL AND updated_at < ?""",
            (now, stale_before),
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
