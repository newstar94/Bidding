"""Authoritative payment reconciliation and exactly-once commercial activation.

The webhook inbox is intentionally a durable queue.  This module is the worker
seam: it asks the provider for the authoritative order state, records the
payment fact, then applies the pinned order snapshot in one short transaction.
No redirect or client supplied value can activate a subscription or grant.
"""

from __future__ import annotations

import json
import time

from backend.commercial_policy.document import canonical_json
from backend.commercial_policy.repository import new_id
from backend.usage_credits import UsageCreditService, UsageOwner


def _dict(row):
    return dict(row) if row is not None else None


class BillingActivationService:
    """Reconcile one inbox event or one provider order.

    ``cursor`` must be inside a caller-owned transaction for ``apply_verified``.
    Network calls are made by :meth:`reconcile_event` before that transaction.
    """

    def __init__(self, cursor, *, clock=None):
        self.cursor = cursor
        self.clock = clock or time.time

    def reconcile_event(self, event_id, provider):
        """Claim an inbox event, query provider, and atomically apply it.

        Returns a bounded status payload suitable for worker telemetry.  A
        duplicate/processed event is a no-op and never creates a second grant.
        """
        row = _dict(self.cursor.execute(
            """SELECT id, provider_profile_id, signed_fields_json, status
                 FROM payment_webhook_events WHERE id = ? FOR UPDATE""",
            (str(event_id),),
        ).fetchone())
        if not row:
            return {"status": "missing", "eventId": str(event_id)}
        if row["status"] in {"processed", "ignored", "dead"}:
            return {"status": row["status"], "eventId": str(event_id)}
        signed = json.loads(row["signed_fields_json"])
        order_code = int(signed.get("orderCode") or 0)
        # Provider query is deliberately outside the transaction.  The caller
        # should commit this claim before invoking this method in a worker.
        result = provider.get_payment(order_code)
        return self.apply_verified(
            event_id,
            result,
            provider_profile_id=row["provider_profile_id"],
        )

    def apply_verified(self, event_id, provider_result, *, provider_profile_id):
        """Apply a provider snapshot.  Must run in a transaction."""
        event = _dict(self.cursor.execute(
            "SELECT * FROM payment_webhook_events WHERE id = ? FOR UPDATE",
            (str(event_id),),
        ).fetchone())
        if not event:
            return {"status": "missing", "eventId": str(event_id)}
        if event["status"] in {"processed", "ignored", "dead"}:
            return {"status": event["status"], "eventId": str(event_id)}
        signed = json.loads(event["signed_fields_json"])
        order_code = int(signed.get("orderCode") or 0)
        order = _dict(self.cursor.execute(
            """SELECT * FROM billing_orders
                WHERE provider_profile_id = ? AND provider_order_code = ? FOR UPDATE""",
            (str(provider_profile_id), order_code),
        ).fetchone())
        if not order:
            self._event_state(event_id, "review", "ORDER_NOT_FOUND")
            return {"status": "review_required", "reason": "ORDER_NOT_FOUND"}
        result = dict(provider_result or {})
        status = str(result.get("status") or signed.get("status") or "").upper()
        amount = int(result.get("amountPaid") or result.get("amount") or 0)
        if int(result.get("orderCode") or order_code) != order_code:
            return self._review(event_id, order, "PROVIDER_ORDER_CODE_MISMATCH")
        expected = int(order["total_amount"])
        if amount > 0 and amount != expected:
            return self._review(event_id, order, "PAYMENT_AMOUNT_MISMATCH")
        if status not in {"PAID", "SUCCESS", "COMPLETED", "SETTLED"} or amount < expected:
            self._event_state(event_id, "processed", None)
            return {"status": "not_paid", "orderId": order["id"], "providerStatus": status}

        timing = self._payment_timing(order, result)
        tx_id = str(result.get("reference") or result.get("paymentLinkId") or f"{order_code}-payment")
        self.cursor.execute(
            """INSERT INTO payment_transactions
                   (id, order_id, provider_profile_id, provider_transaction_id,
                    transaction_type, status, verified_paid_amount,
                    net_settled_amount, currency, payment_timing,
                    provider_occurred_at, evidence_json)
               VALUES (?, ?, ?, ?, 'payment', 'verified', ?, ?, 'VND', ?, ?, ?)
               ON CONFLICT(provider_profile_id, provider_transaction_id, transaction_type)
               DO NOTHING""",
            (
                new_id("payment-tx"), order["id"], str(provider_profile_id),
                tx_id, expected, expected, timing,
                int(result.get("transactionDateTime") or result.get("createdAt") or self.clock()),
                canonical_json({"provider": result, "webhook": signed}),
            ),
        )
        self.cursor.execute(
            """UPDATE billing_orders
                  SET payment_state = 'verified_paid', activation_state =
                      CASE WHEN activation_state = 'applied' THEN activation_state ELSE 'pending' END,
                      revision = revision + 1, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?""",
            (order["id"],),
        )
        outcome = (
            self._mark_review(order, "LATE_PAYMENT_REVIEW_REQUIRED")
            if timing != "on_time"
            else self._activate_order(order)
        )
        self._event_state(event_id, "processed" if outcome["status"] != "review_required" else "review", outcome.get("reason"))
        return {**outcome, "orderId": order["id"], "eventId": str(event_id)}

    def activate_order(self, order_id):
        """Activate an already verified order, useful for reconciliation jobs."""
        order = _dict(self.cursor.execute(
            "SELECT * FROM billing_orders WHERE id = ? FOR UPDATE", (str(order_id),)
        ).fetchone())
        if not order:
            return {"status": "missing"}
        if order["activation_state"] == "applied":
            return {"status": "applied", "orderId": order["id"]}
        if order["payment_state"] != "verified_paid":
            return {"status": "review_required", "reason": "PAYMENT_NOT_VERIFIED"}
        return self._activate_order(order)

    def apply_order_result(self, order_id, provider_result, *, provider_profile_id):
        """Apply a provider query result when no webhook event exists."""
        order = _dict(self.cursor.execute(
            "SELECT * FROM billing_orders WHERE id = ? FOR UPDATE", (str(order_id),)
        ).fetchone())
        if not order:
            return {"status": "missing"}
        result = dict(provider_result or {})
        status = str(result.get("status") or "").upper()
        amount = int(result.get("amountPaid") or result.get("amount") or 0)
        if int(result.get("orderCode") or order["provider_order_code"]) != int(order["provider_order_code"]):
            return self._mark_review(order, "PROVIDER_ORDER_CODE_MISMATCH")
        if amount != int(order["total_amount"]):
            return self._mark_review(order, "PAYMENT_AMOUNT_MISMATCH")
        if status not in {"PAID", "SUCCESS", "COMPLETED", "SETTLED"}:
            return {"status": "not_paid", "providerStatus": status}
        tx_id = str(result.get("reference") or result.get("paymentLinkId") or f"{order['provider_order_code']}-payment")
        timing = self._payment_timing(order, result)
        self.cursor.execute(
            """INSERT INTO payment_transactions
                   (id, order_id, provider_profile_id, provider_transaction_id,
                    transaction_type, status, verified_paid_amount,
                    net_settled_amount, currency, payment_timing,
                    provider_occurred_at, evidence_json)
               VALUES (?, ?, ?, ?, 'payment', 'verified', ?, ?, 'VND', ?, ?, ?)
               ON CONFLICT(provider_profile_id, provider_transaction_id, transaction_type) DO NOTHING""",
            (new_id("payment-tx"), order["id"], str(provider_profile_id), tx_id,
             amount, amount, timing, int(result.get("transactionDateTime") or result.get("createdAt") or self.clock()),
             canonical_json({"provider": result})),
        )
        self.cursor.execute(
            """UPDATE billing_orders
                  SET payment_state = 'verified_paid',
                      activation_state = CASE
                        WHEN activation_state = 'applied' THEN activation_state
                        ELSE 'pending'
                      END,
                      revision = revision + 1, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?""",
            (order["id"],),
        )
        return (
            self._mark_review(order, "LATE_PAYMENT_REVIEW_REQUIRED")
            if timing != "on_time"
            else self._activate_order(order)
        )

    def _activate_order(self, order):
        existing = _dict(self.cursor.execute(
            "SELECT * FROM billing_subscription_activations WHERE order_id = ? FOR UPDATE",
            (order["id"],),
        ).fetchone())
        if existing and existing["state"] == "applied":
            return {"status": "applied"}
        if not self._owner_is_active(order):
            return self._mark_review(order, "OWNER_INACTIVE")
        decision = json.loads(order["decision_json"])
        item = _dict(self.cursor.execute(
            """SELECT item.*, plan.legacy_package_id, plan.member_quota,
                      plan.included_procurement_quota
                 FROM billing_order_items AS item
                 LEFT JOIN billing_plan_versions AS plan ON plan.id = item.plan_version_id
                WHERE item.order_id = ? ORDER BY item.created_at, item.id LIMIT 1""",
            (order["id"],),
        ).fetchone())
        if not item:
            return self._mark_review(order, "ORDER_ITEM_MISSING")
        snapshot = json.loads(item["snapshot_json"])
        benefits = snapshot.get("benefits") or decision.get("benefits") or {}
        if order.get("expected_subscription_revision") is not None:
            current = self._current_subscription(order)
            if current and int(current["revision"]) != int(order["expected_subscription_revision"]):
                return self._mark_review(order, "SUBSCRIPTION_REVISION_MISMATCH")
        if snapshot.get("itemType") == "procurement_credit_pack":
            return self._apply_credit_pack(order, item, benefits)
        policy = snapshot.get("policySnapshot") or {}
        term = (policy.get("baseTerm") or {}).get("kind")
        if term in {None, "blocked_decision", "calendar_anniversary"}:
            return self._mark_review(order, "BASE_TERM_DECISION_REQUIRED")
        if not item.get("legacy_package_id"):
            return self._mark_review(order, "PLAN_PACKAGE_MAPPING_MISSING")
        now = int(self.clock())
        if term == "fixed_days":
            days = int((policy.get("baseTerm") or {}).get("days") or 0)
            if days <= 0:
                return self._mark_review(order, "BASE_TERM_INVALID")
            expires = now + days * 86400
        else:
            return self._mark_review(order, "BASE_TERM_UNSUPPORTED")
        owner = self._owner(order)
        current = self._current_subscription(order)
        if current and current["status"] == "active" and order["operation"] in {"purchase", "renew"}:
            return self._mark_review(order, "ACTIVE_TERM_REQUIRES_TRANSITION_REVIEW")
        before = dict(current) if current else {}
        if owner.kind == "account":
            self.cursor.execute(
                """INSERT INTO account_subscriptions
                       (user_id, package_id, plan_version_id, source,
                        source_order_id, status, starts_at, expires_at, revision)
                   VALUES (?, ?, ?, 'order', ?, 'active', ?, ?, 1)
                   ON CONFLICT(user_id) DO UPDATE SET package_id = excluded.package_id,
                     plan_version_id = excluded.plan_version_id, source = 'order',
                     source_order_id = excluded.source_order_id, status = 'active',
                     starts_at = excluded.starts_at, expires_at = excluded.expires_at,
                     revision = account_subscriptions.revision + 1,
                     updated_at = CURRENT_TIMESTAMP""",
                (owner.identifier, item["legacy_package_id"], item.get("plan_version_id"), order["id"], now, expires),
            )
        else:
            self.cursor.execute(
                """INSERT INTO organization_subscriptions
                       (organization_id, package_id, plan_version_id, source,
                        source_order_id, status, starts_at, expires_at,
                        member_quota, revision)
                   VALUES (?, ?, ?, 'order', ?, 'active', ?, ?, ?, 1)
                   ON CONFLICT(organization_id) DO UPDATE SET package_id = excluded.package_id,
                     plan_version_id = excluded.plan_version_id, source = 'order',
                     source_order_id = excluded.source_order_id, status = 'active',
                     starts_at = excluded.starts_at, expires_at = excluded.expires_at,
                     member_quota = excluded.member_quota,
                     revision = organization_subscriptions.revision + 1,
                     updated_at = CURRENT_TIMESTAMP""",
                (owner.identifier, item["legacy_package_id"], item.get("plan_version_id"), order["id"], now, expires, int(item.get("member_quota") or benefits.get("memberQuota") or 1)),
            )
        if int(item.get("included_procurement_quota") or benefits.get("includedProcurementQuota") or 0) > 0:
            UsageCreditService(self.cursor, clock=self.clock).grant(
                owner,
                int(item.get("included_procurement_quota") or benefits.get("includedProcurementQuota")),
                source="plan", release_id=order["release_id"],
                policy_checksum=str(snapshot.get("releaseChecksum") or decision.get("releaseChecksum")), issued_at=now,
                expires_at=expires, order_item_id=item["id"],
            )
        return self._mark_applied(order, before, {"startsAt": now, "expiresAt": expires, "planVersionId": item.get("plan_version_id")})

    def _apply_credit_pack(self, order, item, benefits):
        owner = self._owner(order)
        current = self._current_subscription(order)
        now = int(self.clock())
        if not current or current["status"] != "active" or (current.get("expires_at") and int(current["expires_at"]) <= now):
            return self._mark_review(order, "BASE_SUBSCRIPTION_REQUIRED")
        expiry = (benefits.get("expiryPolicy") or {}).get("days")
        try:
            expiry = int(expiry)
        except (TypeError, ValueError):
            expiry = 0
        if expiry <= 0:
            return self._mark_review(order, "CREDIT_PACK_EXPIRY_INVALID")
        quantity = int(benefits.get("procurementCredits") or item.get("quantity") or 0)
        if quantity <= 0:
            return self._mark_review(order, "CREDIT_PACK_QUANTITY_INVALID")
        UsageCreditService(self.cursor, clock=self.clock).grant(
            owner, quantity, source="purchase", release_id=order["release_id"],
            policy_checksum=str((json.loads(item["snapshot_json"])).get("releaseChecksum")), issued_at=now,
            expires_at=now + expiry * 86400, order_item_id=item["id"],
        )
        return self._mark_applied(
            order, {}, {"credits": quantity, "expiresAt": now + expiry * 86400}
        )

    def _current_subscription(self, order):
        if order["owner_kind"] == "account":
            return _dict(self.cursor.execute("SELECT * FROM account_subscriptions WHERE user_id = ? FOR UPDATE", (order["account_user_id"],)).fetchone())
        return _dict(self.cursor.execute("SELECT * FROM organization_subscriptions WHERE organization_id = ? FOR UPDATE", (order["organization_id"],)).fetchone())

    def _owner_is_active(self, order):
        if order["owner_kind"] == "account":
            row = self.cursor.execute(
                "SELECT trang_thai FROM tai_khoan WHERE id = ? FOR UPDATE",
                (order["account_user_id"],),
            ).fetchone()
        else:
            row = self.cursor.execute(
                "SELECT trang_thai FROM to_chuc WHERE id = ? FOR UPDATE",
                (order["organization_id"],),
            ).fetchone()
        return bool(row and str(row[0]).strip().casefold() == "active")

    @staticmethod
    def _owner(order):
        return UsageOwner("account", order["account_user_id"]) if order["owner_kind"] == "account" else UsageOwner("organization", order["organization_id"])

    def _mark_applied(self, order, before, after):
        activation_id = new_id("subscription-activation")
        self.cursor.execute(
            """INSERT INTO billing_subscription_activations
                   (id, order_id, state, before_json, after_json,
                    expected_revision, applied_revision, reason_code)
               VALUES (?, ?, 'applied', ?, ?, ?, ?, 'APPLIED')
               ON CONFLICT(order_id) DO UPDATE SET state = 'applied',
                 before_json = excluded.before_json, after_json = excluded.after_json,
                 applied_revision = excluded.applied_revision, reason_code = 'APPLIED',
                 updated_at = CURRENT_TIMESTAMP""",
            (activation_id, order["id"], canonical_json(before), canonical_json(after), order.get("expected_subscription_revision"), int(order["revision"]) + 1),
        )
        self.cursor.execute("UPDATE billing_orders SET activation_state = 'applied', revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (order["id"],))
        return {"status": "applied"}

    def _mark_review(self, order, reason):
        activation_id = new_id("subscription-activation")
        self.cursor.execute(
            """INSERT INTO billing_subscription_activations
                   (id, order_id, state, before_json, after_json, reason_code)
               VALUES (?, ?, 'review_required', '{}', '{}', ?)
               ON CONFLICT(order_id) DO UPDATE SET state = 'review_required', reason_code = excluded.reason_code,
                 updated_at = CURRENT_TIMESTAMP""",
            (activation_id, order["id"], str(reason)[:200]),
        )
        self.cursor.execute("UPDATE billing_orders SET activation_state = 'review_required', revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (order["id"],))
        return {"status": "review_required", "reason": str(reason)}

    def _review(self, event_id, order, reason):
        self._mark_review(order, reason)
        self._event_state(event_id, "review", reason)
        return {"status": "review_required", "reason": reason, "orderId": order["id"]}

    def _event_state(self, event_id, state, error):
        self.cursor.execute(
            """UPDATE payment_webhook_events SET status = ?, last_error_code = ?,
                      lease_expires_at = NULL, locked_by = NULL,
                      processed_at = CASE WHEN ? IN ('processed', 'ignored') THEN ? ELSE processed_at END
                WHERE id = ?""",
            (state, error, state, int(self.clock()), str(event_id)),
        )

    def _payment_timing(self, order, result):
        occurred = int(result.get("transactionDateTime") or result.get("createdAt") or self.clock())
        try:
            expiry = int(order.get("checkout_expires_at") or 0)
        except (TypeError, ValueError):
            expiry = 0
        if order.get("checkout_state") == "cancelled":
            return "late_after_cancel"
        if expiry and occurred > expiry:
            return "late_after_expiry"
        return "on_time"
