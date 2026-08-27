"""Checkout persistence and durable provider-command execution."""

from __future__ import annotations

from hashlib import sha256
import json
import os
import time

from backend.commercial_policy.document import canonical_json
from backend.commercial_policy.errors import (
    CommercialPolicyError,
    NO_HEALTHY_PROVIDER,
    OFFER_NOT_SELLABLE,
    QUOTE_EXPIRED,
    TRANSITION_NOT_ALLOWED,
)
from backend.commercial_policy.repository import CommercialRepository, new_id

from .providers.base import PaymentProviderError
from .runtime import payment_provider_registry


def _stable_order_code(order_id):
    # billing_orders.provider_order_code is a PostgreSQL INTEGER. Keep the
    # deterministic provider identity inside the positive signed 31-bit range;
    # uniqueness is still enforced per immutable provider profile.
    return int(sha256(order_id.encode("utf-8")).hexdigest()[:8], 16) % 2_147_483_647 + 1


def _row_dict(row):
    return dict(row) if row is not None else None


def public_order_payload(order):
    return {
        "publicId": order["public_id"],
        "ownerKind": order["owner_kind"],
        "operation": order["operation"],
        "subtotalAmount": int(order["subtotal_amount"]),
        "taxAmount": int(order["tax_amount"]),
        "totalAmount": int(order["total_amount"]),
        "currency": order["currency"],
        "checkoutState": order["checkout_state"],
        "paymentState": order["payment_state"],
        "activationState": order["activation_state"],
        "checkoutUrl": order.get("checkout_url"),
        "checkoutExpiresAt": order.get("checkout_expires_at"),
        "createdAt": order.get("created_at"),
        "updatedAt": order.get("updated_at"),
    }


class BillingService:
    """Create immutable order intent inside the caller's short transaction."""

    def __init__(self, cursor, *, clock=None, environment=None):
        self.cursor = cursor
        self.clock = clock or time.time
        self.environment = os.environ if environment is None else environment

    def create_checkout(self, actor, quote_public_id, idempotency_key):
        now = int(self.clock())
        idempotency_key = str(idempotency_key or "").strip()
        if not 8 <= len(idempotency_key) <= 128:
            raise CommercialPolicyError("INVALID_IDEMPOTENCY_KEY", "Thiếu Idempotency-Key hợp lệ.")
        quote = _row_dict(self.cursor.execute(
            """SELECT id, public_id, actor_user_id, account_user_id,
                      organization_id, owner_kind, operation, request_hash,
                      release_id, release_checksum, decision_json,
                      subtotal_amount, tax_amount, total_amount, currency,
                      expected_subscription_revision, expires_at
                 FROM billing_quotes WHERE public_id = ? FOR UPDATE""",
            (str(quote_public_id),),
        ).fetchone())
        if not quote or str(quote["actor_user_id"]) != str(actor.user_id):
            raise CommercialPolicyError("QUOTE_NOT_AVAILABLE", "Không tìm thấy báo giá của phiên mua.", status_code=404)
        if int(quote["expires_at"]) <= now:
            raise CommercialPolicyError(QUOTE_EXPIRED, "Báo giá đã hết hạn.", status_code=409)
        self._lock_and_authorize_owner(actor, quote)
        request_hash = sha256(canonical_json({
            "quotePublicId": quote["public_id"],
            "ownerKind": quote["owner_kind"],
            "accountUserId": quote.get("account_user_id"),
            "organizationId": quote.get("organization_id"),
        }).encode("utf-8")).hexdigest()
        existing = self._existing_idempotent_order(quote, actor.user_id, idempotency_key)
        if existing:
            if existing["request_hash"] != request_hash or existing["quote_id"] != quote["id"]:
                raise CommercialPolicyError(
                    "IDEMPOTENCY_KEY_REUSED",
                    "Idempotency-Key đã được dùng cho checkout khác.",
                    status_code=409,
                )
            return existing, None, True
        by_quote = _row_dict(self.cursor.execute(
            "SELECT * FROM billing_orders WHERE quote_id = ? FOR UPDATE",
            (quote["id"],),
        ).fetchone())
        if by_quote:
            return by_quote, None, True
        decision = json.loads(quote["decision_json"])
        sku_code = str(decision.get("skuCode") or "")
        projection = _row_dict(self.cursor.execute(
            """SELECT sku.id AS sku_id, sku.item_type, sku.plan_version_id,
                      sku.quantity, price.id AS price_id
                 FROM billing_skus AS sku
                 JOIN billing_prices AS price
                   ON price.sku_id = sku.id AND price.release_id = sku.release_id
                WHERE sku.release_id = ? AND sku.sku_code = ?
                  AND sku.sales_state = 'sellable' AND price.effective_at <= ?
                  AND NOT EXISTS (
                      SELECT 1 FROM commercial_release_timeline AS timeline
                       WHERE timeline.release_id = sku.release_id
                         AND timeline.event_type = 'stop_sales'
                         AND timeline.effective_at <= ?
                  )
                ORDER BY price.effective_at DESC LIMIT 1""",
            (quote["release_id"], sku_code, now, now),
        ).fetchone())
        if not projection:
            raise CommercialPolicyError(
                OFFER_NOT_SELLABLE,
                "Offer đã dừng bán sau khi tạo báo giá.",
                status_code=409,
            )
        item_type = str(projection["item_type"] or "")
        operation = str(quote["operation"] or "")
        operation_allowed = (
            item_type == "procurement_credit_pack" and operation == "credit_pack"
        ) or (
            item_type == "base_plan"
            and operation in {"purchase", "renew", "upgrade", "downgrade"}
        )
        if not operation_allowed:
            raise CommercialPolicyError(
                TRANSITION_NOT_ALLOWED,
                "Operation không phù hợp với loại sản phẩm thương mại.",
                status_code=409,
            )
        provider = self._select_provider(int(quote["total_amount"]))
        order_id = new_id("billing-order")
        public_id = new_id("order")
        provider_reference = f"bf-{public_id}"
        provider_order_code = _stable_order_code(order_id)
        self.cursor.execute(
            """INSERT INTO billing_orders
                   (id, public_id, quote_id, actor_user_id, account_user_id,
                    organization_id, owner_kind, operation, idempotency_key,
                    request_hash, release_id, provider_profile_id,
                    provider_order_code, provider_reference, decision_json,
                    subtotal_amount, tax_amount, total_amount, currency,
                    expected_subscription_revision)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                order_id, public_id, quote["id"], actor.user_id,
                quote.get("account_user_id"), quote.get("organization_id"),
                quote["owner_kind"], quote["operation"], idempotency_key,
                request_hash, quote["release_id"], provider["id"],
                provider_order_code, provider_reference, quote["decision_json"],
                quote["subtotal_amount"], quote["tax_amount"],
                quote["total_amount"], quote["currency"],
                quote.get("expected_subscription_revision"),
            ),
        )
        order_item_id = new_id("billing-order-item")
        self.cursor.execute(
            """INSERT INTO billing_order_items
                   (id, order_id, sku_id, plan_version_id, price_id,
                    quantity, snapshot_json)
               VALUES (?, ?, ?, ?, ?, 1, ?)""",
            (
                order_item_id, order_id, projection["sku_id"],
                projection.get("plan_version_id"), projection["price_id"],
                quote["decision_json"],
            ),
        )
        origin = str(self.environment.get("APP_PUBLIC_URL") or "http://localhost").rstrip("/")
        provider_request = {
            "orderCode": provider_order_code,
            "amount": int(quote["total_amount"]),
            "description": public_id[-9:].upper(),
            "cancelUrl": f"{origin}/thanh-toan/huy",
            "returnUrl": f"{origin}/thanh-toan/ket-qua",
        }
        command_id = new_id("billing-command")
        self.cursor.execute(
            """INSERT INTO billing_provider_commands
                   (id, order_id, command_type, provider_reference,
                    request_json, status, available_at)
               VALUES (?, ?, 'create_checkout', ?, ?, 'pending', ?)""",
            (
                command_id, order_id, provider_reference,
                canonical_json(provider_request), now,
            ),
        )
        CommercialRepository(self.cursor, clock=self.clock).insert_outbox(
            "billing.checkout_requested", "billing_order", order_id,
            {"publicId": public_id, "commandId": command_id},
        )
        return self.get_order(public_id, lock=True), command_id, False

    def get_order(self, public_id, *, lock=False):
        statement = (
            "SELECT * FROM billing_orders WHERE public_id = ? FOR UPDATE"
            if lock else "SELECT * FROM billing_orders WHERE public_id = ?"
        )
        return _row_dict(self.cursor.execute(statement, (str(public_id),)).fetchone())

    def request_cancel(self, public_id, actor_user_id, reason):
        order = _row_dict(self.cursor.execute(
            """SELECT * FROM billing_orders
                WHERE public_id = ? AND owner_kind = 'account'
                  AND account_user_id = ? FOR UPDATE""",
            (str(public_id), str(actor_user_id)),
        ).fetchone())
        if not order:
            return None, None, False
        self.cursor.execute(
            "SELECT id FROM tai_khoan WHERE id = ? FOR UPDATE",
            (actor_user_id,),
        ).fetchone()
        if order["payment_state"] != "unverified" or order["checkout_state"] not in {"creating", "open"}:
            raise CommercialPolicyError(
                TRANSITION_NOT_ALLOWED,
                "Chỉ checkout chưa thanh toán đang mở mới được hủy.",
                status_code=409,
            )
        existing = self.cursor.execute(
            """SELECT id FROM billing_provider_commands
                WHERE order_id = ? AND command_type = 'cancel_checkout'""",
            (order["id"],),
        ).fetchone()
        if existing:
            return order, existing[0], True
        command_id = new_id("billing-command")
        self.cursor.execute(
            """INSERT INTO billing_provider_commands
                   (id, order_id, command_type, provider_reference,
                    request_json, status, available_at)
               VALUES (?, ?, 'cancel_checkout', ?, ?, 'pending', ?)""",
            (
                command_id,
                order["id"],
                order["provider_reference"],
                canonical_json({
                    "identifier": order["provider_order_code"],
                    "reason": str(reason or "Người mua hủy checkout")[:500],
                }),
                int(self.clock()),
            ),
        )
        CommercialRepository(self.cursor, clock=self.clock).insert_outbox(
            "billing.checkout_cancel_requested", "billing_order", order["id"],
            {"publicId": order["public_id"], "commandId": command_id},
        )
        return order, command_id, False

    def create_manual_refund_intent(self, public_id, actor_user_id, amount, reason, idempotency_key):
        order = _row_dict(self.cursor.execute(
            "SELECT * FROM billing_orders WHERE public_id = ? FOR UPDATE",
            (str(public_id),),
        ).fetchone())
        if not order:
            return None, False
        try:
            amount = int(amount)
        except (TypeError, ValueError, OverflowError) as error:
            raise CommercialPolicyError(
                "REFUND_AMOUNT_INVALID", "Số tiền hoàn không hợp lệ.", status_code=400
            ) from error
        if amount <= 0:
            raise CommercialPolicyError("REFUND_AMOUNT_INVALID", "Số tiền hoàn phải dương.", status_code=400)
        normalized_key = str(idempotency_key or "").strip()
        if not 8 <= len(normalized_key) <= 128:
            raise CommercialPolicyError(
                "INVALID_IDEMPOTENCY_KEY", "Thiếu Idempotency-Key hợp lệ.", status_code=400
            )
        normalized_reason = str(reason or "")[:2000]
        existing = self.cursor.execute(
            """SELECT * FROM billing_refund_intents
                WHERE order_id = ? AND idempotency_key = ? FOR UPDATE""",
            (order["id"], normalized_key),
        ).fetchone()
        if existing:
            existing = dict(existing)
            if (
                int(existing["amount"]) != amount
                or str(existing.get("reason") or "") != normalized_reason
                or str(existing.get("actor_user_id") or "") != str(actor_user_id)
            ):
                raise CommercialPolicyError(
                    "IDEMPOTENCY_KEY_REUSED",
                    "Idempotency-Key đã được dùng cho yêu cầu refund khác.",
                    status_code=409,
                )
            return existing, True
        if order["payment_state"] not in {"verified_paid", "partially_refunded"}:
            raise CommercialPolicyError(
                "PAYMENT_NOT_REFUNDABLE",
                "Order chưa có payment fact đã xác minh.",
                status_code=409,
            )
        paid = int(self.cursor.execute(
            """SELECT COALESCE(SUM(verified_paid_amount), 0)
                 FROM payment_transactions
                WHERE order_id = ? AND transaction_type = 'payment'
                  AND status IN ('verified', 'settled')""",
            (order["id"],),
        ).fetchone()[0] or 0)
        already_refunded = int(self.cursor.execute(
            """SELECT COALESCE(SUM(amount), 0) FROM billing_refund_intents
                WHERE order_id = ? AND state IN ('pending', 'succeeded')""",
            (order["id"],),
        ).fetchone()[0] or 0)
        if already_refunded + amount > paid:
            raise CommercialPolicyError(
                "REFUND_AMOUNT_INVALID",
                "Tổng refund pending/succeeded vượt payment đã xác minh.",
                status_code=409,
            )
        intent_id = new_id("refund-intent")
        self.cursor.execute(
            """INSERT INTO billing_refund_intents
                   (id, order_id, idempotency_key, amount, reason,
                    actor_user_id, method, state, activation_revision)
               VALUES (?, ?, ?, ?, ?, ?, 'manual_off_platform', 'pending', ?)""",
            (
                intent_id, order["id"], normalized_key, amount,
                normalized_reason, actor_user_id, int(order["revision"]),
            ),
        )
        return _row_dict(self.cursor.execute(
            "SELECT * FROM billing_refund_intents WHERE id = ?", (intent_id,)
        ).fetchone()), False

    def _lock_and_authorize_owner(self, actor, quote):
        if quote["owner_kind"] == "account":
            if str(quote["account_user_id"]) != str(actor.user_id):
                raise CommercialPolicyError("BUYER_NOT_AUTHORIZED", "Không được checkout cho tài khoản khác.", status_code=403)
            row = self.cursor.execute(
                "SELECT id, trang_thai FROM tai_khoan WHERE id = ? FOR UPDATE",
                (quote["account_user_id"],),
            ).fetchone()
        else:
            active_role = str(getattr(actor, "active_role", "") or actor)
            if (
                str(quote["organization_id"]) != str(actor.active_role_organization_id or "")
                or (
                    str(actor.platform_role) != "super_admin"
                    and active_role not in {"manager", "super_admin"}
                )
            ):
                raise CommercialPolicyError("BUYER_NOT_AUTHORIZED", "Không có thẩm quyền checkout cho tổ chức.", status_code=403)
            row = self.cursor.execute(
                "SELECT id, trang_thai FROM to_chuc WHERE id = ? FOR UPDATE",
                (quote["organization_id"],),
            ).fetchone()
        if not row or str(row[1]) != "active":
            raise CommercialPolicyError("OWNER_INACTIVE", "Owner không còn hoạt động.", status_code=409)

    def _existing_idempotent_order(self, quote, actor_user_id, key):
        if quote["owner_kind"] == "account":
            statement = """SELECT * FROM billing_orders
                WHERE actor_user_id = ? AND owner_kind = 'account'
                  AND account_user_id = ? AND organization_id IS NULL
                  AND operation = ? AND idempotency_key = ? FOR UPDATE"""
            owner_id = quote["account_user_id"]
        else:
            statement = """SELECT * FROM billing_orders
                WHERE actor_user_id = ? AND owner_kind = 'organization'
                  AND organization_id = ? AND account_user_id IS NULL
                  AND operation = ? AND idempotency_key = ? FOR UPDATE"""
            owner_id = quote["organization_id"]
        return _row_dict(self.cursor.execute(
            statement, (actor_user_id, owner_id, quote["operation"], key),
        ).fetchone())

    def _select_provider(self, total_amount):
        provider_name = str(self.environment.get("COMMERCIAL_PAYMENT_PROVIDER", "fake")).strip().casefold()
        app_environment = str(self.environment.get("APP_ENV", "development")).strip().casefold()
        provider_environment = str(
            self.environment.get(
                "PAYMENT_PROVIDER_ENVIRONMENT",
                "production" if app_environment in {"prod", "production"} else "test",
            )
        ).strip().casefold()
        row = self.cursor.execute(
            """SELECT id, provider, environment, min_amount, max_amount,
                      checkout_ttl_seconds, timeout_ms, max_attempts, mode
                 FROM payment_provider_profiles
                WHERE provider = ? AND environment = ? AND readiness_status = 'ready'
                  AND mode IN ('shadow', 'live')
                  AND min_amount <= ? AND max_amount >= ?
                ORDER BY CASE mode WHEN 'live' THEN 0 ELSE 1 END,
                         routing_priority, version DESC LIMIT 1""",
            (provider_name, provider_environment, int(total_amount), int(total_amount)),
        ).fetchone()
        if not row:
            raise CommercialPolicyError(NO_HEALTHY_PROVIDER, "Không có payment provider sẵn sàng.", status_code=503)
        return dict(row)


class ProviderCommandExecutor:
    """Claim/commit around network I/O; never hold a DB transaction over it."""

    def __init__(
        self,
        database,
        *,
        providers=None,
        provider_registry=None,
        clock=None,
        worker_id=None,
        environment=None,
    ):
        self.database = database
        self.clock = clock or time.time
        self.worker_id = worker_id or new_id("billing-worker")
        self.environment = os.environ if environment is None else environment
        self.providers = providers or {}
        self.provider_registry = provider_registry or payment_provider_registry()

    def execute(self, command_id):
        claimed = self._claim(command_id)
        if not claimed:
            return None
        try:
            provider = self.providers.get(claimed["provider_profile_id"])
            if provider is None:
                provider = self.provider_registry.resolve(claimed)
        except (PaymentProviderError, ValueError) as error:
            if not isinstance(error, PaymentProviderError):
                error = PaymentProviderError(
                    "PROVIDER_CREDENTIAL_UNAVAILABLE", str(error), retryable=True
                )
            self._fail(claimed, error)
            return self._read_order(claimed["public_id"])
        request = json.loads(claimed["request_json"])
        try:
            if claimed["command_type"] == "cancel_checkout":
                if int(claimed["attempt_count"]) > 1:
                    result = provider.get_payment(request["identifier"])
                    if str(result.get("status") or "").upper() not in {
                        "CANCELLED",
                        "EXPIRED",
                        "PAID",
                    }:
                        result = provider.cancel_payment(
                            request["identifier"], request.get("reason")
                        )
                else:
                    result = provider.cancel_payment(
                        request["identifier"], request.get("reason")
                    )
            elif claimed["command_type"] == "query_order" or int(claimed["attempt_count"]) > 1:
                result = provider.get_payment(claimed["provider_order_code"])
            else:
                result = provider.create_payment(request)
            if claimed["command_type"] == "create_checkout" and (
                int(result.get("orderCode") or 0) != int(claimed["provider_order_code"])
                or int(result.get("amount") or 0) != int(claimed["total_amount"])
            ):
                raise PaymentProviderError("PAYMENT_MISMATCH", "Provider checkout không khớp order snapshot.")
            self._complete(claimed, result)
        except PaymentProviderError as error:
            self._fail(claimed, error)
        return self._read_order(claimed["public_id"])

    def _claim(self, command_id):
        connection = self.database.get_connection()
        try:
            connection.execute("BEGIN")
            row = connection.execute(
                """SELECT command.id, command.order_id, command.command_type,
                          command.request_json,
                          command.status, command.attempt_count,
                          orders.public_id, orders.provider_profile_id,
                          orders.provider_order_code, orders.total_amount,
                          profile.provider, profile.credential_reference,
                          profile.timeout_ms, profile.max_attempts,
                          profile.checkout_ttl_seconds,
                          command.last_error_code
                     FROM billing_provider_commands AS command
                     JOIN billing_orders AS orders ON orders.id = command.order_id
                     JOIN payment_provider_profiles AS profile
                       ON profile.id = orders.provider_profile_id
                    WHERE command.id = ? AND (
                          (command.status IN ('pending', 'retry')
                           AND command.available_at <= ?)
                       OR (command.status = 'processing'
                           AND command.lease_expires_at <= ?))
                    FOR UPDATE OF command SKIP LOCKED""",
                (command_id, int(self.clock()), int(self.clock())),
            ).fetchone()
            if not row:
                connection.rollback()
                return None
            claimed = dict(row)
            claimed["attempt_count"] = int(claimed["attempt_count"]) + 1
            connection.execute(
                """UPDATE billing_provider_commands
                      SET status = 'processing', attempt_count = ?, locked_by = ?,
                          lease_expires_at = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?""",
                (claimed["attempt_count"], self.worker_id, int(self.clock()) + 60, command_id),
            )
            connection.commit()
            claimed["id"] = command_id
            return claimed
        finally:
            connection.close()

    def _complete(self, claimed, result):
        connection = self.database.get_connection()
        try:
            connection.execute("BEGIN")
            if not self._lock_owner_order_command(connection, claimed):
                connection.rollback()
                return
            current_order = connection.execute(
                """SELECT checkout_state, checkout_url, checkout_expires_at
                     FROM billing_orders WHERE id = ?""",
                (claimed["order_id"],),
            ).fetchone()
            status = str(result.get("status") or "PENDING").upper()
            checkout_state = str(current_order[0] or "creating")
            if status == "CANCELLED":
                checkout_state = "cancelled"
            elif status == "EXPIRED":
                checkout_state = "expired"
            elif claimed["command_type"] == "create_checkout":
                checkout_state = "open"
            checkout_url = result.get("checkoutUrl") or current_order[1]
            expires_at = current_order[2]
            if claimed["command_type"] == "create_checkout":
                profile_deadline = int(self.clock()) + max(
                    60, int(claimed.get("checkout_ttl_seconds") or 900)
                )
                provider_deadline = int(result.get("expiredAt") or profile_deadline)
                expires_at = min(profile_deadline, provider_deadline)
            elif result.get("expiredAt") is not None:
                provider_deadline = int(result["expiredAt"])
                expires_at = (
                    min(int(expires_at), provider_deadline)
                    if expires_at is not None else provider_deadline
                )
            connection.execute(
                """UPDATE billing_orders
                      SET checkout_state = ?, checkout_url = ?,
                          checkout_expires_at = ?, revision = revision + 1,
                          updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?""",
                (
                    checkout_state,
                    checkout_url,
                    int(expires_at) if expires_at is not None else None,
                    claimed["order_id"],
                ),
            )

            # A terminal paid query must not acknowledge the provider command
            # until its payment fact and activation transaction have committed.
            # Otherwise a failure in the second transaction leaves a paid
            # provider result outside every automatic retry selector.
            activation_enabled = str(
                self.environment.get("PAYMENT_ACTIVATION_ENABLED", "false")
            ).strip().casefold() == "true"
            if activation_enabled and status in {
                "PAID", "SUCCESS", "COMPLETED", "SETTLED"
            }:
                from .activation import BillingActivationService

                BillingActivationService(
                    connection.cursor(),
                    clock=self.clock,
                ).apply_order_result(
                    claimed["order_id"],
                    result,
                    provider_profile_id=claimed["provider_profile_id"],
                )
            connection.execute(
                """UPDATE billing_provider_commands
                      SET status = 'completed', lease_expires_at = NULL,
                          locked_by = NULL, last_error_code = NULL,
                          updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
                (claimed["id"],),
            )
            connection.commit()
        except PaymentProviderError:
            connection.rollback()
            raise
        except Exception as error:  # noqa: BLE001 - keep paid command retryable
            connection.rollback()
            raise PaymentProviderError(
                "BILLING_ACTIVATION_RETRY",
                "Không thể hoàn tất giao dịch thanh toán; sẽ thử lại.",
                retryable=True,
            ) from error
        finally:
            connection.close()

    def _fail(self, claimed, error):
        connection = self.database.get_connection()
        try:
            connection.execute("BEGIN")
            if not self._lock_owner_order_command(connection, claimed):
                connection.rollback()
                return
            attempts = int(claimed["attempt_count"])
            retry = error.outcome_unknown or error.retryable
            status = (
                "retry"
                if retry and attempts < max(1, int(claimed.get("max_attempts") or 3))
                else "dead"
            )
            available_at = int(self.clock()) + min(30, 2 ** attempts)
            connection.execute(
                """UPDATE billing_provider_commands
                      SET status = ?, available_at = ?, lease_expires_at = NULL,
                          locked_by = NULL, last_error_code = ?,
                          updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
                (status, available_at, error.code, claimed["id"]),
            )
            if status == "dead":
                connection.execute(
                    """UPDATE billing_orders SET checkout_state = 'create_failed',
                              revision = revision + 1, updated_at = CURRENT_TIMESTAMP
                        WHERE id = ? AND checkout_state = 'creating'""",
                    (claimed["order_id"],),
                )
            connection.commit()
        finally:
            connection.close()

    def _lock_owner_order_command(self, connection, claimed):
        owner = connection.execute(
            "SELECT owner_kind, account_user_id, organization_id FROM billing_orders WHERE id = ?",
            (claimed["order_id"],),
        ).fetchone()
        if not owner:
            raise RuntimeError("Billing order disappeared.")
        if owner[0] == "account":
            connection.execute("SELECT id FROM tai_khoan WHERE id = ? FOR UPDATE", (owner[1],)).fetchone()
        else:
            connection.execute("SELECT id FROM to_chuc WHERE id = ? FOR UPDATE", (owner[2],)).fetchone()
        connection.execute("SELECT id FROM billing_orders WHERE id = ? FOR UPDATE", (claimed["order_id"],)).fetchone()
        command = connection.execute(
            """SELECT status, locked_by FROM billing_provider_commands
                 WHERE id = ? FOR UPDATE""",
            (claimed["id"],),
        ).fetchone()
        return bool(
            command
            and str(command[0]) == "processing"
            and str(command[1] or "") == str(self.worker_id)
        )

    def _read_order(self, public_id):
        connection = self.database.get_connection()
        try:
            return _row_dict(connection.execute(
                "SELECT * FROM billing_orders WHERE public_id = ?", (public_id,)
            ).fetchone())
        finally:
            connection.close()
