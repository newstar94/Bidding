"""Bounded webhook inbox: verify first, persist, ACK quickly."""

from __future__ import annotations

from hashlib import sha256
import json
import time

from starlette.responses import JSONResponse

from backend.db.db_helper import database
from backend.shared.logging_utils import log_error

from .providers.base import PaymentProviderError
from .runtime import payment_provider_registry


MAX_WEBHOOK_BYTES = 262_144


async def payment_webhook_api(request):
    connection = None
    try:
        profile_id = str(request.path_params["profile_id"] or "").strip()
        raw = await request.body()
        if len(raw) > MAX_WEBHOOK_BYTES:
            return JSONResponse({"error": "Webhook quá lớn.", "code": "WEBHOOK_TOO_LARGE"}, status_code=413)
        try:
            envelope = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return JSONResponse({"error": "Webhook không phải JSON hợp lệ.", "code": "WEBHOOK_INVALID"}, status_code=400)
        connection = database.get_connection()
        connection.execute("BEGIN")
        profile = connection.execute(
            """SELECT id, provider, environment, mode, readiness_status,
                      credential_reference, timeout_ms, max_attempts
                 FROM payment_provider_profiles WHERE id = ?""",
            (profile_id,),
        ).fetchone()
        if not profile:
            connection.rollback()
            return JSONResponse({"error": "Provider profile không tồn tại.", "code": "NOT_FOUND"}, status_code=404)
        try:
            provider = payment_provider_registry().resolve(profile)
            signed_data = provider.verify_webhook(envelope)
        except PaymentProviderError as error:
            connection.rollback()
            status_code = (
                503 if error.code == "PROVIDER_CREDENTIAL_UNAVAILABLE" else 400
            )
            return JSONResponse(
                {"error": str(error), "code": error.code}, status_code=status_code
            )
        payload_hash = sha256(raw).hexdigest()
        order_code = str(signed_data.get("orderCode") or "")
        payment_link_id = str(signed_data.get("paymentLinkId") or "")
        reference = str(signed_data.get("reference") or "")
        dedupe_key = "|".join((order_code, payment_link_id, reference))[:500]
        if not dedupe_key.strip("|"):
            connection.rollback()
            return JSONResponse({"error": "Webhook thiếu identity.", "code": "WEBHOOK_INVALID"}, status_code=400)
        event_id = f"payment-event-{payload_hash[:32]}"
        inserted = connection.execute(
            """INSERT INTO payment_webhook_events
                   (id, provider_profile_id, dedupe_key, payload_hash,
                    signed_fields_json, status, available_at)
               VALUES (?, ?, ?, ?, ?, 'pending', ?)
               ON CONFLICT(provider_profile_id, dedupe_key, payload_hash) DO NOTHING""",
            (
                event_id, profile_id, dedupe_key, payload_hash,
                json.dumps(signed_data, ensure_ascii=False, separators=(",", ":")),
                int(time.time()),
            ),
        )
        connection.commit()
        return JSONResponse({"received": True, "duplicate": inserted.rowcount == 0}, status_code=202)
    except Exception as error:  # noqa: BLE001 - webhook returns bounded public error
        if connection:
            connection.rollback()
        log_error(error, "payment_webhook_api")
        return JSONResponse({"error": "Không thể tiếp nhận webhook.", "code": "WEBHOOK_FAILED"}, status_code=500)
    finally:
        if connection:
            connection.close()
