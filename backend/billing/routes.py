"""Authenticated HTTP adapters for checkout and personal billing history."""

from __future__ import annotations

import os
import re
import time
from hashlib import sha256
import json
from pathlib import Path

from starlette.responses import HTMLResponse, JSONResponse, RedirectResponse

from backend.auth.auth_helper import verify_session, verify_session_in_transaction
from backend.commercial_policy.config import commercial_runtime_config
from backend.commercial_policy.errors import CommercialPolicyError
from backend.commercial_policy.repository import new_id
from backend.db.db_helper import database
from backend.shared.logging_utils import log_audit, log_error
from backend.shared.request_validation import read_json_object
from backend.shared.async_io import (
    BlockingIOBusyError,
    BlockingIOTimeoutError,
    run_blocking_io,
)
from backend.shared.database_io import run_database_read, run_database_write

from .service import BillingService, ProviderCommandExecutor, public_order_payload
from .webhook import payment_webhook_api, webhook_event_id
from .providers.fake import FakePaymentProvider
from .runtime import payment_provider_registry
from backend.usage_credits import UsageCreditService, UsageOwner


_IDEMPOTENCY_KEY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$")
_executor = None
_FAKE_CHECKOUT_HTML = (
    Path(__file__).resolve().parents[2] / "views" / "fake_checkout.html"
)


def _database_lane_unavailable(message, code):
    response = JSONResponse({"error": message, "code": code}, status_code=503)
    response.headers["Retry-After"] = "1"
    return response


def _fake_checkout_environment_allowed():
    return (
        not commercial_runtime_config().trial_full_access_enabled
        and str(os.environ.get("APP_ENV", "development")).strip().casefold() in {
        "development", "dev", "test", "testing",
        }
    )


def _fake_checkout_context(connection, request):
    if not _fake_checkout_environment_allowed():
        raise CommercialPolicyError("NOT_FOUND", "Không tìm thấy trang.", status_code=404)
    profile_id = str(request.path_params["profile_id"] or "").strip()
    try:
        order_code = int(request.path_params["order_code"])
    except (TypeError, ValueError):
        raise CommercialPolicyError("NOT_FOUND", "Không tìm thấy checkout.", status_code=404)
    row = connection.execute(
        """SELECT orders.*, profile.provider, profile.environment,
                  profile.credential_reference, profile.timeout_ms,
                  profile.max_attempts
             FROM billing_orders AS orders
             JOIN payment_provider_profiles AS profile
               ON profile.id = orders.provider_profile_id
            WHERE orders.provider_profile_id = ?
              AND orders.provider_order_code = ?
              AND profile.provider = 'fake'""",
        (profile_id, order_code),
    ).fetchone()
    if not row:
        raise CommercialPolicyError("NOT_FOUND", "Không tìm thấy checkout giả lập.", status_code=404)
    return dict(row)


def _fake_checkout_page_sync(request):
    connection = None
    try:
        connection = database.get_connection()
        _fake_checkout_context(connection, request)
        return HTMLResponse(
            _FAKE_CHECKOUT_HTML.read_text(encoding="utf-8"),
            headers={"Cache-Control": "no-store"},
        )
    except Exception as error:  # noqa: BLE001 - translated at HTTP seam
        return _error(error)
    finally:
        if connection:
            connection.close()


async def fake_checkout_page(request):
    try:
        return await run_database_read(_fake_checkout_page_sync, request)
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _database_lane_unavailable(
            "Hệ thống đang bận tải checkout giả lập.", "FAKE_CHECKOUT_UNAVAILABLE"
        )


def _get_fake_checkout_sync(request):
    connection = None
    try:
        connection = database.get_connection()
        order = _fake_checkout_context(connection, request)
        return JSONResponse({
            "simulator": True,
            "order": public_order_payload(order),
        })
    except Exception as error:  # noqa: BLE001
        return _error(error)
    finally:
        if connection:
            connection.close()


async def get_fake_checkout_api(request):
    try:
        return await run_database_read(_get_fake_checkout_sync, request)
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _database_lane_unavailable(
            "Hệ thống đang bận tải checkout giả lập.", "FAKE_CHECKOUT_UNAVAILABLE"
        )


def _update_fake_checkout_sync(request, body):
    connection = None
    command_id = None
    try:
        connection = database.get_connection()
        order = _fake_checkout_context(connection, request)
        provider = payment_provider_registry().resolve(order)
        if not isinstance(provider, FakePaymentProvider):
            raise CommercialPolicyError("NOT_FOUND", "Không tìm thấy checkout giả lập.", status_code=404)
        provider_result = provider.simulate_payment(
            order["provider_order_code"], body["action"]
        )
        connection.execute("BEGIN")
        if str(provider_result.get("status") or "").upper() == "PAID":
            signed = {
                "orderCode": int(order["provider_order_code"]),
                "amount": int(order["total_amount"]),
                "paymentLinkId": provider_result.get("paymentLinkId"),
                "reference": f"FAKE-{order['provider_order_code']}",
                "status": "PAID",
            }
            signed_json = json.dumps(
                signed, ensure_ascii=False, sort_keys=True, separators=(",", ":")
            )
            payload_hash = sha256(signed_json.encode("utf-8")).hexdigest()
            event_id = webhook_event_id(order["provider_profile_id"], payload_hash)
            connection.execute(
                """INSERT INTO payment_webhook_events
                       (id, provider_profile_id, dedupe_key, payload_hash,
                        signed_fields_json, status, available_at)
                   VALUES (?, ?, ?, ?, ?, 'pending', ?)
                   ON CONFLICT(provider_profile_id, dedupe_key, payload_hash)
                   DO NOTHING""",
                (
                    event_id,
                    order["provider_profile_id"],
                    f"{order['provider_order_code']}|{provider_result.get('paymentLinkId')}|FAKE",
                    payload_hash,
                    signed_json,
                    int(time.time()),
                ),
            )
        existing_command = connection.execute(
            """SELECT id, status FROM billing_provider_commands
                 WHERE order_id = ? AND command_type = 'query_order'
                 FOR UPDATE""",
            (order["id"],),
        ).fetchone()
        if existing_command:
            command_id = existing_command["id"]
            connection.execute(
                """UPDATE billing_provider_commands
                      SET status = 'pending', available_at = ?,
                          lease_expires_at = NULL, locked_by = NULL,
                          last_error_code = NULL, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ? AND status IN ('completed', 'dead', 'retry')""",
                (int(time.time()), command_id),
            )
        else:
            command_id = new_id("billing-command")
            connection.execute(
                """INSERT INTO billing_provider_commands
                       (id, order_id, command_type, provider_reference,
                        request_json, status, available_at)
                   VALUES (?, ?, 'query_order', ?, '{}', 'pending', ?)""",
                (
                    command_id,
                    order["id"],
                    order["provider_reference"],
                    int(time.time()),
                ),
            )
        connection.commit()
        connection.close()
        connection = None
        return {
            "order": order,
            "command_id": command_id,
            "provider_status": provider_result.get("status"),
        }
    except Exception as error:  # noqa: BLE001
        if connection:
            connection.rollback()
        return _error(error)
    finally:
        if connection:
            connection.close()


async def update_fake_checkout_api(request):
    try:
        body, invalid = await read_json_object(request)
        if invalid:
            return invalid
        if set(body) != {"action"}:
            raise CommercialPolicyError(
                "FAKE_ACTION_INVALID",
                "Thao tác checkout giả lập không hợp lệ.",
            )
        result = await run_database_write(_update_fake_checkout_sync, request, body)
        if isinstance(result, JSONResponse):
            return result
        reconciled_order = (
            await _execute_provider_command(result["command_id"])
            if result["command_id"] else None
        )
        return JSONResponse({
            "accepted": True,
            "providerStatus": result["provider_status"],
            "order": public_order_payload(reconciled_order or result["order"]),
            "message": "Sự kiện giả lập đã được đưa vào hàng đợi đối soát.",
        }, status_code=202)
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _database_lane_unavailable(
            "Hệ thống đang bận xử lý checkout giả lập.", "FAKE_CHECKOUT_UNAVAILABLE"
        )
    except Exception as error:  # noqa: BLE001 - translated at HTTP seam
        return _error(error)


def _error(error):
    if isinstance(error, CommercialPolicyError):
        return JSONResponse(
            {"error": error.message, "code": error.code, "details": error.details},
            status_code=error.status_code,
        )
    log_error(error, "billing_routes")
    return JSONResponse(
        {"error": "Không thể xử lý giao dịch thanh toán.", "code": "BILLING_FAILED"},
        status_code=500,
    )


def _provider_executor():
    global _executor
    if _executor is None:
        _executor = ProviderCommandExecutor(database, environment=os.environ)
    return _executor


async def _execute_provider_command(command_id):
    """Keep provider-pool saturation on the route's generic error path."""

    try:
        return await run_blocking_io(
            _provider_executor().execute,
            command_id,
            timeout_seconds=35,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError) as error:
        # The 503 contract belongs to the database lane. Provider execution
        # failures retain the pre-offload BILLING_FAILED response.
        raise RuntimeError("provider command execution unavailable") from error


async def payment_result_page(_request):
    """Return users to durable order history; redirects never activate orders."""

    return RedirectResponse(
        "/trang-ca-nhan?payment=result",
        status_code=303,
        headers={"Cache-Control": "no-store"},
    )


async def payment_cancel_page(_request):
    return RedirectResponse(
        "/trang-ca-nhan?payment=cancelled",
        status_code=303,
        headers={"Cache-Control": "no-store"},
    )


def _create_checkout_sync(request, quote_public_id, idempotency_key):
    connection = None
    try:
        connection = database.get_connection()
        connection.execute("BEGIN")
        cursor = connection.cursor()
        valid, actor = verify_session_in_transaction(cursor, request)
        if not valid:
            connection.rollback()
            return JSONResponse({"error": actor, "code": "FORBIDDEN"}, status_code=403)
        order, command_id, replayed = BillingService(cursor).create_checkout(
            actor, quote_public_id, idempotency_key
        )
        if not replayed:
            log_audit(
                "billing.checkout_requested",
                actor_user_id=actor.user_id,
                organization_id=order.get("organization_id"),
                target_type="billing_order",
                target_id=order["id"],
                request=request,
                metadata={
                    "publicId": order["public_id"],
                    "ownerKind": order["owner_kind"],
                    "operation": order["operation"],
                    "totalAmount": int(order["total_amount"]),
                    "providerProfileId": order["provider_profile_id"],
                },
                cursor=cursor,
                required=True,
            )
        connection.commit()
        return {"order": order, "command_id": command_id, "replayed": replayed}
    except Exception:
        if connection:
            connection.rollback()
        raise
    finally:
        if connection:
            connection.close()


async def create_checkout_api(request):
    try:
        config = commercial_runtime_config()
        if not config.payment_checkout_enabled:
            raise CommercialPolicyError(
                "PAYMENT_CHECKOUT_DISABLED",
                "Checkout mới đang tắt; order đã tạo vẫn được reconcile theo cấu hình activation.",
                status_code=503,
            )
        body, invalid = await read_json_object(request)
        if invalid:
            return invalid
        if set(body) != {"quotePublicId"}:
            raise CommercialPolicyError("CHECKOUT_REQUEST_INVALID", "Checkout chỉ nhận quotePublicId.")
        quote_public_id = str(body.get("quotePublicId") or "").strip()
        idempotency_key = str(request.headers.get("Idempotency-Key") or "").strip()
        if not quote_public_id or not _IDEMPOTENCY_KEY.fullmatch(idempotency_key):
            raise CommercialPolicyError("CHECKOUT_REQUEST_INVALID", "Thiếu quote hoặc Idempotency-Key hợp lệ.")
        result = await run_database_write(
            _create_checkout_sync,
            request,
            quote_public_id,
            idempotency_key,
        )
        if isinstance(result, JSONResponse):
            return result
        order = result["order"]
        if result["command_id"]:
            order = await _execute_provider_command(result["command_id"]) or order
        return JSONResponse(
            {"order": public_order_payload(order), "replayed": result["replayed"]},
            status_code=200 if result["replayed"] else 201,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _database_lane_unavailable(
            "Hệ thống đang bận xử lý checkout.", "CHECKOUT_UNAVAILABLE"
        )
    except Exception as error:  # noqa: BLE001 - translated at the HTTP seam
        return _error(error)


def _list_personal_orders_sync(request):
    valid, actor = verify_session(request)
    if not valid:
        return JSONResponse({"error": actor, "code": "FORBIDDEN"}, status_code=403)
    connection = database.get_connection()
    try:
        # Account information always shows the signed-in user's own purchases,
        # even while that user is operating in an organization workspace. This
        # query deliberately cannot return organization-owned billing history.
        rows = connection.execute(
            """SELECT * FROM billing_orders
                WHERE owner_kind = 'account' AND account_user_id = ?
                ORDER BY created_at DESC, id DESC LIMIT 100""",
            (actor.user_id,),
        ).fetchall()
        return JSONResponse({"orders": [public_order_payload(dict(row)) for row in rows]})
    finally:
        connection.close()


async def list_personal_orders_api(request):
    try:
        return await run_database_read(_list_personal_orders_sync, request)
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _database_lane_unavailable(
            "Hệ thống đang bận tải lịch sử thanh toán.", "BILLING_HISTORY_UNAVAILABLE"
        )
    except Exception as error:  # noqa: BLE001 - translated at HTTP seam
        return _error(error)


def _get_usage_balance_sync(request):
    valid, actor = verify_session(request)
    if not valid:
        return JSONResponse({"error": actor, "code": "FORBIDDEN"}, status_code=403)
    if actor.active_role_organization_id:
        return JSONResponse(
            {"error": "Chưa chốt quyền đọc usage/billing của tổ chức.", "code": "BLOCKED_DECISION"},
            status_code=409,
        )
    connection = database.get_connection()
    try:
        balance = UsageCreditService(connection.cursor()).get_balance(
            UsageOwner("account", actor.user_id)
        )
        return JSONResponse(balance)
    finally:
        connection.close()


async def get_usage_balance_api(request):
    try:
        return await run_database_read(_get_usage_balance_sync, request)
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _database_lane_unavailable(
            "Hệ thống đang bận tải số dư sử dụng.", "BILLING_BALANCE_UNAVAILABLE"
        )
    except Exception as error:  # noqa: BLE001 - translated at HTTP seam
        return _error(error)


def _get_personal_order_sync(request):
    valid, actor = verify_session(request)
    if not valid:
        return JSONResponse({"error": actor, "code": "FORBIDDEN"}, status_code=403)
    if actor.active_role_organization_id:
        return JSONResponse(
            {"error": "Chưa chốt quyền đọc lịch sử thanh toán của tổ chức.", "code": "BLOCKED_DECISION"},
            status_code=409,
        )
    connection = database.get_connection()
    try:
        row = connection.execute(
            """SELECT * FROM billing_orders
                WHERE public_id = ? AND owner_kind = 'account'
                  AND account_user_id = ?""",
            (request.path_params["public_id"], actor.user_id),
        ).fetchone()
        if not row:
            return JSONResponse({"error": "Không tìm thấy order.", "code": "NOT_FOUND"}, status_code=404)
        return JSONResponse({"order": public_order_payload(dict(row))})
    finally:
        connection.close()


async def get_personal_order_api(request):
    try:
        return await run_database_read(_get_personal_order_sync, request)
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _database_lane_unavailable(
            "Hệ thống đang bận tải đơn thanh toán.", "BILLING_ORDER_UNAVAILABLE"
        )
    except Exception as error:  # noqa: BLE001 - translated at HTTP seam
        return _error(error)


def _cancel_personal_order_sync(request, body):
    connection = None
    try:
        connection = database.get_connection()
        connection.execute("BEGIN")
        cursor = connection.cursor()
        valid, actor = verify_session_in_transaction(cursor, request)
        if not valid:
            connection.rollback()
            return JSONResponse({"error": actor, "code": "FORBIDDEN"}, status_code=403)
        if actor.active_role_organization_id:
            connection.rollback()
            return JSONResponse(
                {
                    "error": "Chưa chốt quyền đọc/thao tác lịch sử thanh toán của tổ chức.",
                    "code": "BLOCKED_DECISION",
                },
                status_code=409,
            )
        order, command_id, replayed = BillingService(cursor).request_cancel(
            request.path_params["public_id"], actor.user_id, body.get("reason")
        )
        if not order:
            connection.rollback()
            return JSONResponse(
                {"error": "Không tìm thấy order.", "code": "NOT_FOUND"},
                status_code=404,
            )
        if not replayed:
            log_audit(
                "billing.checkout_cancel_requested",
                actor_user_id=actor.user_id,
                target_type="billing_order",
                target_id=order["id"],
                request=request,
                metadata={
                    "publicId": order["public_id"],
                    "reason": str(body.get("reason") or "")[:500],
                },
                cursor=cursor,
                required=True,
            )
        connection.commit()
        return {"order": order, "command_id": command_id, "replayed": replayed}
    except Exception as error:  # noqa: BLE001
        if connection:
            connection.rollback()
        return _error(error)
    finally:
        if connection:
            connection.close()


async def cancel_personal_order_api(request):
    try:
        body, invalid = await read_json_object(request)
        if invalid:
            return invalid
        if set(body) - {"reason"}:
            raise CommercialPolicyError(
                "CHECKOUT_REQUEST_INVALID",
                "Cancel request chứa field không hỗ trợ.",
            )
        result = await run_database_write(_cancel_personal_order_sync, request, body)
        if isinstance(result, JSONResponse):
            return result
        order = result["order"]
        if result["command_id"]:
            order = await _execute_provider_command(result["command_id"]) or order
        return JSONResponse(
            {"order": public_order_payload(order), "replayed": result["replayed"]}
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _database_lane_unavailable(
            "Hệ thống đang bận hủy đơn thanh toán.", "BILLING_CANCEL_UNAVAILABLE"
        )
    except Exception as error:  # noqa: BLE001 - translated at HTTP seam
        return _error(error)


async def admin_review_order_api(request):
    return await _admin_order_action(request, "review")


async def admin_reconcile_order_api(request):
    return await _admin_order_action(request, "reconcile")


def _admin_refund_order_sync(request, body, key):
    connection = None
    try:
        connection = database.get_connection()
        connection.execute("BEGIN")
        cursor = connection.cursor()
        valid, actor = verify_session_in_transaction(cursor, request, required_role="super_admin")
        if not valid:
            connection.rollback()
            return JSONResponse({"error": actor, "code": "FORBIDDEN"}, status_code=403)
        intent, replayed = BillingService(cursor).create_manual_refund_intent(
            request.path_params["public_id"], actor.user_id,
            body.get("amount"), body.get("reason"), key,
        )
        if not intent:
            connection.rollback()
            return JSONResponse({"error": "Không tìm thấy order.", "code": "NOT_FOUND"}, status_code=404)
        if not replayed:
            log_audit(
                "billing.refund_intent_created",
                actor_user_id=actor.user_id,
                target_type="billing_refund_intent",
                target_id=intent["id"],
                request=request,
                metadata={"publicId": request.path_params["public_id"], "amount": int(intent["amount"]), "method": "manual_off_platform"},
                cursor=cursor,
                required=True,
            )
        connection.commit()
        return JSONResponse({"refundIntent": {"id": intent["id"], "amount": int(intent["amount"]), "state": intent["state"], "method": intent["method"]}, "replayed": replayed}, status_code=200 if replayed else 201)
    except Exception as error:  # noqa: BLE001
        if connection:
            connection.rollback()
        return _error(error)
    finally:
        if connection:
            connection.close()


async def admin_refund_order_api(request):
    try:
        body, invalid = await read_json_object(request)
        if invalid:
            return invalid
        if set(body) - {"amount", "reason"} or not str(body.get("reason") or "").strip():
            raise CommercialPolicyError("REFUND_REQUEST_INVALID", "Refund cần amount và reason.")
        key = str(request.headers.get("Idempotency-Key") or "").strip()
        if not _IDEMPOTENCY_KEY.fullmatch(key):
            raise CommercialPolicyError("INVALID_IDEMPOTENCY_KEY", "Thiếu Idempotency-Key hợp lệ.")
        return await run_database_write(_admin_refund_order_sync, request, body, key)
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _database_lane_unavailable(
            "Hệ thống đang bận xử lý hoàn tiền.", "BILLING_REFUND_UNAVAILABLE"
        )
    except Exception as error:  # noqa: BLE001 - translated at HTTP seam
        return _error(error)


def _admin_order_action_sync(request, action, body):
    connection = None
    command_id = None
    try:
        connection = database.get_connection()
        connection.execute("BEGIN")
        cursor = connection.cursor()
        valid, actor = verify_session_in_transaction(cursor, request, required_role="super_admin")
        if not valid:
            connection.rollback()
            return JSONResponse({"error": actor, "code": "FORBIDDEN"}, status_code=403)
        order = cursor.execute(
            "SELECT * FROM billing_orders WHERE public_id = ? FOR UPDATE",
            (request.path_params["public_id"],),
        ).fetchone()
        if not order:
            connection.rollback()
            return JSONResponse({"error": "Không tìm thấy order.", "code": "NOT_FOUND"}, status_code=404)
        if action == "review":
            cursor.execute(
                """UPDATE billing_orders SET activation_state = 'review_required',
                          revision = revision + 1, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?""",
                (order["id"],),
            )
        else:
            existing_command = cursor.execute(
                """SELECT id, status FROM billing_provider_commands
                    WHERE order_id = ? AND command_type = 'query_order'""",
                (order["id"],),
            ).fetchone()
            if not existing_command:
                command_id = new_id("billing-command")
                cursor.execute(
                    """INSERT INTO billing_provider_commands
                           (id, order_id, command_type, provider_reference,
                            request_json, status, available_at)
                       VALUES (?, ?, 'query_order', ?, ?, 'pending', ?)""",
                    (command_id, order["id"], order["provider_reference"], "{}", int(time.time())),
                )
            else:
                command_id = existing_command["id"]
                cursor.execute(
                    """UPDATE billing_provider_commands
                          SET status = 'pending', available_at = ?,
                              lease_expires_at = NULL, locked_by = NULL,
                              last_error_code = NULL, updated_at = CURRENT_TIMESTAMP
                        WHERE id = ? AND status IN ('completed', 'dead', 'retry')""",
                    (int(time.time()), command_id),
                )
        log_audit(
            f"billing.order_{action}", actor_user_id=actor.user_id,
            target_type="billing_order", target_id=order["id"], request=request,
            metadata={"publicId": order["public_id"], "reason": str(body.get("reason") or "")[:500]},
            cursor=cursor, required=True,
        )
        connection.commit()
        return {"order": dict(order), "command_id": command_id, "action": action}
    except Exception as error:  # noqa: BLE001
        if connection:
            connection.rollback()
        return _error(error)
    finally:
        if connection:
            connection.close()


async def _admin_order_action(request, action):
    try:
        body, invalid = await read_json_object(request)
        if invalid:
            return invalid
        result = await run_database_write(_admin_order_action_sync, request, action, body)
        if isinstance(result, JSONResponse):
            return result
        reconciled = (
            await _execute_provider_command(result["command_id"])
            if result["command_id"] else None
        )
        return JSONResponse({
            "success": True,
            "action": result["action"],
            "publicId": result["order"]["public_id"],
            "order": public_order_payload(reconciled) if reconciled else None,
        })
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _database_lane_unavailable(
            "Hệ thống đang bận xử lý đơn thanh toán.", "BILLING_ADMIN_UNAVAILABLE"
        )
    except Exception as error:  # noqa: BLE001 - translated at HTTP seam
        return _error(error)


def billing_routes(Route):
    return [
        Route("/thanh-toan/ket-qua", payment_result_page, methods=["GET"]),
        Route("/thanh-toan/huy", payment_cancel_page, methods=["GET"]),
        Route(
            "/thanh-toan-gia-lap/{profile_id}/{order_code}",
            fake_checkout_page,
            methods=["GET"],
        ),
        Route(
            "/api/billing/fake-checkout/{profile_id}/{order_code}",
            get_fake_checkout_api,
            methods=["GET"],
        ),
        Route(
            "/api/billing/fake-checkout/{profile_id}/{order_code}",
            update_fake_checkout_api,
            methods=["POST"],
        ),
        Route("/api/billing/checkouts", create_checkout_api, methods=["POST"]),
        Route("/api/billing/orders", list_personal_orders_api, methods=["GET"]),
        Route("/api/billing/usage", get_usage_balance_api, methods=["GET"]),
        Route("/api/billing/orders/{public_id}", get_personal_order_api, methods=["GET"]),
        Route(
            "/api/billing/orders/{public_id}/cancel",
            cancel_personal_order_api,
            methods=["POST"],
        ),
        Route(
            "/api/billing/providers/{profile_id}/webhook",
            payment_webhook_api,
            methods=["POST"],
        ),
        Route("/api/billing/admin/orders/{public_id}/reconcile", admin_reconcile_order_api, methods=["POST"]),
        Route("/api/billing/admin/orders/{public_id}/review", admin_review_order_api, methods=["POST"]),
        Route("/api/billing/admin/orders/{public_id}/refund", admin_refund_order_api, methods=["POST"]),
    ]
