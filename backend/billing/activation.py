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
from backend.commercial_policy.repository import CommercialRepository, new_id
from backend.shared.logging_utils import log_audit
from backend.usage_credits import UsageCreditService, UsageOwner
from .provider_timestamp import parse_provider_transaction_time


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
        order_identity = self.cursor.execute(
            """SELECT id FROM billing_orders
                WHERE provider_profile_id = ? AND provider_order_code = ?""",
            (str(provider_profile_id), order_code),
        ).fetchone()
        order = self._lock_order(order_identity[0]) if order_identity else None
        if not order:
            self._event_state(event_id, "review", "ORDER_NOT_FOUND")
            return {"status": "review_required", "reason": "ORDER_NOT_FOUND"}
        result = dict(provider_result or {})
        status = str(result.get("status") or signed.get("status") or "").upper()
        amount = int(result.get("amountPaid") or result.get("amount") or 0)
        if int(result.get("orderCode") or order_code) != order_code:
            return self._review(event_id, order, "PROVIDER_ORDER_CODE_MISMATCH")
        expected = int(order["total_amount"])
        signed_amount = int(signed.get("amount") or 0)
        if signed_amount != expected:
            return self._review(event_id, order, "WEBHOOK_AMOUNT_MISMATCH")
        signed_payment_link_id = str(signed.get("paymentLinkId") or "").strip()
        result_payment_link_id = str(
            result.get("paymentLinkId") or result.get("id") or ""
        ).strip()
        if (
            not signed_payment_link_id
            or result_payment_link_id != signed_payment_link_id
        ):
            return self._review(event_id, order, "PAYMENT_LINK_ID_MISMATCH")
        if amount > 0 and amount != expected:
            return self._review(event_id, order, "PAYMENT_AMOUNT_MISMATCH")
        if status not in {"PAID", "SUCCESS", "COMPLETED", "SETTLED"} or amount < expected:
            self._event_state(event_id, "processed", None)
            return {"status": "not_paid", "orderId": order["id"], "providerStatus": status}

        transaction_time = parse_provider_transaction_time(result)
        if not transaction_time.ok:
            return self._review(
                event_id,
                order,
                transaction_time.reason,
                evidence=self._timestamp_review_evidence(result),
            )
        timing = self._payment_timing(order, transaction_time.unix_seconds)
        tx_id = str(result.get("reference") or result.get("paymentLinkId") or f"{order_code}-payment")
        payment = self._insert_or_validate_payment(
            order,
            provider_profile_id=str(provider_profile_id),
            provider_transaction_id=tx_id,
            amount=expected,
            timing=timing,
            occurred_at=transaction_time.unix_seconds,
            evidence={"provider": result, "webhook": signed},
        )
        if payment["mismatch"]:
            return self._review(event_id, order, payment["mismatch"])
        payment_transaction_id = payment["id"]
        payment_was_inserted = payment["inserted"]
        self.cursor.execute(
            """UPDATE billing_orders
                  SET payment_state = CASE WHEN payment_state IN ('refund_pending', 'partially_refunded', 'refunded', 'refund_failed') THEN payment_state ELSE 'verified_paid' END,
                      activation_state = CASE WHEN activation_state IN ('applied', 'reversed') THEN activation_state ELSE 'pending' END,
                      revision = revision + 1, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?""",
            (order["id"],),
        )
        outcome = (
            self._mark_review(order, "LATE_PAYMENT_REVIEW_REQUIRED")
            if timing != "on_time"
            else self._activate_order(order)
        )
        if payment_was_inserted:
            self._record_verified_payment_effects(
                order,
                payment_transaction_id,
                timing=timing,
                outcome=outcome,
            )
        self._event_state(event_id, "processed" if outcome["status"] != "review_required" else "review", outcome.get("reason"))
        return {**outcome, "orderId": order["id"], "eventId": str(event_id)}

    def activate_order(self, order_id):
        """Activate an already verified order, useful for reconciliation jobs."""
        order = self._lock_order(order_id)
        if not order:
            return {"status": "missing"}
        if order["activation_state"] == "applied":
            return {"status": "applied", "orderId": order["id"]}
        if order["payment_state"] != "verified_paid":
            return {"status": "review_required", "reason": "PAYMENT_NOT_VERIFIED"}
        return self._activate_order(order)

    def apply_order_result(self, order_id, provider_result, *, provider_profile_id):
        """Apply a provider query result when no webhook event exists."""
        order = self._lock_order(order_id)
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
        transaction_time = parse_provider_transaction_time(result)
        if not transaction_time.ok:
            return self._mark_review(
                order,
                transaction_time.reason,
                evidence=self._timestamp_review_evidence(result),
            )
        timing = self._payment_timing(order, transaction_time.unix_seconds)
        payment = self._insert_or_validate_payment(
            order,
            provider_profile_id=str(provider_profile_id),
            provider_transaction_id=tx_id,
            amount=amount,
            timing=timing,
            occurred_at=transaction_time.unix_seconds,
            evidence={"provider": result},
        )
        if payment["mismatch"]:
            return self._mark_review(order, payment["mismatch"])
        payment_transaction_id = payment["id"]
        payment_was_inserted = payment["inserted"]
        self.cursor.execute(
            """UPDATE billing_orders
                  SET payment_state = CASE WHEN payment_state IN ('refund_pending', 'partially_refunded', 'refunded', 'refund_failed') THEN payment_state ELSE 'verified_paid' END,
                      activation_state = CASE
                        WHEN activation_state IN ('applied', 'reversed') THEN activation_state
                        ELSE 'pending'
                      END,
                      revision = revision + 1, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?""",
            (order["id"],),
        )
        outcome = (
            self._mark_review(order, "LATE_PAYMENT_REVIEW_REQUIRED")
            if timing != "on_time"
            else self._activate_order(order)
        )
        if payment_was_inserted:
            self._record_verified_payment_effects(
                order,
                payment_transaction_id,
                timing=timing,
                outcome=outcome,
            )
        return outcome

    def _lock_order(self, order_id):
        """Match checkout/provider completion's stable owner -> order locks."""
        owner = self.cursor.execute(
            """SELECT owner_kind, account_user_id, organization_id
                 FROM billing_orders WHERE id = ?""",
            (str(order_id),),
        ).fetchone()
        if not owner:
            return None
        if owner[0] == "account":
            self.cursor.execute(
                "SELECT id FROM tai_khoan WHERE id = ? FOR UPDATE", (owner[1],)
            ).fetchone()
        else:
            self.cursor.execute(
                "SELECT id FROM to_chuc WHERE id = ? FOR UPDATE", (owner[2],)
            ).fetchone()
        return _dict(self.cursor.execute(
            "SELECT * FROM billing_orders WHERE id = ? FOR UPDATE", (str(order_id),)
        ).fetchone())

    def _insert_or_validate_payment(
        self,
        order,
        *,
        provider_profile_id,
        provider_transaction_id,
        amount,
        timing,
        occurred_at,
        evidence,
    ):
        """Bind one provider payment identity to exactly one order.

        The unique provider identity is the exactly-once seam.  A conflict is
        an idempotent replay only when the durable financial fact belongs to
        this order and matches its immutable amount/currency snapshot.
        """

        payment_transaction_id = new_id("payment-tx")
        inserted = self.cursor.execute(
            """INSERT INTO payment_transactions
                   (id, order_id, provider_profile_id, provider_transaction_id,
                    transaction_type, status, verified_paid_amount,
                    net_settled_amount, currency, payment_timing,
                    provider_occurred_at, evidence_json)
               VALUES (?, ?, ?, ?, 'payment', 'verified', ?, ?, ?, ?, ?, ?)
               ON CONFLICT(provider_profile_id, provider_transaction_id, transaction_type)
               DO NOTHING""",
            (
                payment_transaction_id,
                order["id"],
                str(provider_profile_id),
                str(provider_transaction_id),
                int(amount),
                int(amount),
                str(order.get("currency") or "VND"),
                str(timing),
                int(occurred_at),
                canonical_json(evidence),
            ),
        ).rowcount == 1
        if inserted:
            return {
                "id": payment_transaction_id,
                "inserted": True,
                "mismatch": None,
            }

        existing = _dict(self.cursor.execute(
            """SELECT id, order_id, status, verified_paid_amount, currency
                 FROM payment_transactions
                WHERE provider_profile_id = ?
                  AND provider_transaction_id = ?
                  AND transaction_type = 'payment'
                FOR UPDATE""",
            (str(provider_profile_id), str(provider_transaction_id)),
        ).fetchone())
        if not existing or str(existing["order_id"]) != str(order["id"]):
            return {
                "id": existing.get("id") if existing else None,
                "inserted": False,
                "mismatch": "PAYMENT_TRANSACTION_ORDER_MISMATCH",
            }
        if (
            str(existing.get("status")) != "verified"
            or int(existing.get("verified_paid_amount") or 0) != int(amount)
            or str(existing.get("currency") or "")
            != str(order.get("currency") or "VND")
        ):
            return {
                "id": existing["id"],
                "inserted": False,
                "mismatch": "PAYMENT_TRANSACTION_EVIDENCE_MISMATCH",
            }
        return {"id": existing["id"], "inserted": False, "mismatch": None}

    def _record_verified_payment_effects(
        self,
        order,
        payment_transaction_id,
        *,
        timing,
        outcome,
    ):
        """Append financial evidence and delivery work in Transaction B.

        This method is called only when the provider transaction was newly
        inserted.  The unique payment identity therefore becomes the
        exactly-once seam for invoice, audit and notification outbox rows.
        """

        self._request_invoice_if_due(order, payment_transaction_id, outcome["status"])
        activation_event = (
            "billing.activation_applied"
            if outcome["status"] == "applied"
            else "billing.activation_scheduled"
            if outcome["status"] == "scheduled"
            else "billing.activation_review_required"
        )
        repository = CommercialRepository(self.cursor, clock=self.clock)
        repository.insert_outbox(
            "billing.payment_verified", "billing_order", order["id"],
            {"publicId": order["public_id"], "paymentTransactionId": payment_transaction_id, "timing": timing},
        )
        repository.insert_outbox(
            activation_event, "billing_order", order["id"],
            {"publicId": order["public_id"], "status": outcome["status"], "reason": outcome.get("reason")},
        )
        organization_id = order.get("organization_id") if order["owner_kind"] == "organization" else None
        log_audit(
            "billing.payment_verified", actor_user_id=order["actor_user_id"],
            organization_id=organization_id, target_type="billing_order", target_id=order["id"],
            metadata={"publicId": order["public_id"], "paymentTransactionId": payment_transaction_id,
                      "timing": timing, "totalAmount": int(order["total_amount"]), "currency": order["currency"]},
            cursor=self.cursor, required=True,
        )
        log_audit(
            activation_event, actor_user_id=order["actor_user_id"], organization_id=organization_id,
            target_type="billing_order", target_id=order["id"],
            metadata={"publicId": order["public_id"], "status": outcome["status"], "reason": outcome.get("reason")},
            cursor=self.cursor, required=True,
        )

    def _request_invoice_if_due(self, order, payment_transaction_id, activation_status):
        decision = json.loads(order["decision_json"])
        invoice_policy = decision.get("taxInvoiceSnapshot") or {}
        if invoice_policy.get("invoiceEnabled") is False:
            return
        trigger = invoice_policy.get("invoiceTrigger")
        # Null is compatibility behavior for already pinned legacy orders.
        if trigger in {"manual", "disabled"} or (trigger == "activation_applied" and activation_status != "applied"):
            return
        if trigger not in {None, "verified_payment", "activation_applied"}:
            return
        tax_snapshot = {
            "currency": order["currency"],
            "subtotalAmount": int(order["subtotal_amount"]),
            "taxAmount": int(order["tax_amount"]),
            "totalAmount": int(order["total_amount"]),
            "policy": decision.get("taxInvoiceSnapshot") or {},
        }
        buyer_profile = {
            "ownerKind": order["owner_kind"],
            "ownerId": (
                order.get("account_user_id")
                if order["owner_kind"] == "account"
                else order.get("organization_id")
            ),
        }
        invoice_request_id = new_id("invoice-request")
        invoice_insert = self.cursor.execute(
            """INSERT INTO billing_invoice_requests
                   (id, order_id, payment_transaction_id, tax_snapshot_json,
                    buyer_profile_json, idempotency_key)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(order_id) DO NOTHING""",
            (
                invoice_request_id,
                order["id"],
                payment_transaction_id,
                canonical_json(tax_snapshot),
                canonical_json(buyer_profile),
                f"invoice:{order['id']}",
            ),
        )
        if invoice_insert.rowcount == 1:
            CommercialRepository(self.cursor, clock=self.clock).insert_outbox(
                "billing.invoice_requested",
                "billing_order",
                order["id"],
                {
                    "publicId": order["public_id"],
                    "invoiceRequestId": invoice_request_id,
                },
            )

    def _activate_order(self, order):
        if order["activation_state"] == "reversed":
            return {"status": "reversed"}
        if order["payment_state"] in {"refund_pending", "partially_refunded", "refunded", "refund_failed"}:
            return {"status": "review_required", "reason": "PAYMENT_REFUND_REVIEW_REQUIRED"}
        if self.cursor.execute("SELECT 1 FROM billing_refund_intents WHERE order_id = ? AND state = 'pending' LIMIT 1", (order["id"],)).fetchone():
            return {"status": "review_required", "reason": "PAYMENT_REFUND_REVIEW_REQUIRED"}
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
        current = self._current_subscription(order)
        scheduled = json.loads(existing["after_json"]) if existing else {}
        is_scheduled = existing and existing["state"] == "pending" and scheduled.get("scheduled") is True
        expected_revision = existing["expected_revision"] if is_scheduled else order.get("expected_subscription_revision")
        if expected_revision is not None:
            if not current or int(current["revision"]) != int(expected_revision):
                # A queued renewal expects the preceding paid term to activate
                # first. Do not reject it while that earlier term is pending.
                if is_scheduled and int(self.clock()) < int(scheduled["startsAt"]):
                    return {"status": "scheduled", **scheduled}
                return self._mark_review(order, "SUBSCRIPTION_REVISION_MISMATCH")
        if snapshot.get("itemType") == "procurement_credit_pack":
            return self._apply_credit_pack(order, item, benefits)
        policy = snapshot.get("policySnapshot") or {}
        period = (snapshot.get("price") or decision.get("price") or {}).get("period", "yearly")
        term_policy = policy.get("monthlyBaseTerm" if period == "monthly" else "baseTerm") or {}
        term = term_policy.get("kind")
        if term in {None, "blocked_decision", "calendar_anniversary"}:
            return self._mark_review(order, "BASE_TERM_DECISION_REQUIRED")
        if not item.get("legacy_package_id"):
            return self._mark_review(order, "PLAN_PACKAGE_MAPPING_MISSING")
        now = int(self.clock())
        if term == "fixed_days":
            days = int(term_policy.get("days") or 0)
            if days <= 0:
                return self._mark_review(order, "BASE_TERM_INVALID")
            starts = now
            expires = starts + days * 86400
        else:
            return self._mark_review(order, "BASE_TERM_UNSUPPORTED")
        owner = self._owner(order)
        if is_scheduled:
            starts = int(scheduled["startsAt"])
            expires = int(scheduled["expiresAt"])
            if now < starts:
                return {"status": "scheduled", **scheduled}
            if (not current or current["status"] != "active"
                    or current.get("plan_version_id") != scheduled.get("expectedPlanVersionId")
                    or current.get("source_order_id") != scheduled.get("expectedSourceOrderId")):
                return self._mark_review(order, "RENEWAL_PREDECESSOR_MISMATCH")
        elif order["operation"] == "renew":
            if (policy.get("renewalAnchor") or {}).get("kind") != "end_of_term":
                return self._mark_review(order, "RENEWAL_ANCHOR_DECISION_REQUIRED")
            if not current or current["status"] not in {"active", "expired"} or not current.get("expires_at"):
                return self._mark_review(order, "RENEWAL_BASE_SUBSCRIPTION_REQUIRED")
            if not self._same_renewal_plan(current, item):
                return self._mark_review(order, "RENEWAL_PLAN_TRANSITION_REVIEW_REQUIRED")
            payment = self.cursor.execute(
                "SELECT provider_occurred_at FROM payment_transactions WHERE order_id = ? AND transaction_type = 'payment' AND status = 'verified'",
                (order["id"],),
            ).fetchone()
            if not payment or not payment[0]:
                return self._mark_review(order, "RENEWAL_PAYMENT_TIME_REQUIRED")
            starts = max(int(payment[0]), int(current["expires_at"]))
            next_revision = int(current["revision"])
            predecessor = None
            for queued in self._queued_renewals(order):
                starts = max(starts, int(queued["after"]["expiresAt"]))
                next_revision = max(next_revision, int(queued["expected_revision"]) + 1)
                predecessor = queued
            expires = starts + days * 86400
            if starts > now:
                return self._schedule_renewal(order, current, item, starts, expires, next_revision, predecessor)
        elif current and current["status"] == "active" and (not current.get("expires_at") or int(current["expires_at"]) > now) and order["operation"] == "purchase":
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
                (owner.identifier, item["legacy_package_id"], item.get("plan_version_id"), order["id"], starts, expires),
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
                (owner.identifier, item["legacy_package_id"], item.get("plan_version_id"), order["id"], starts, expires, int(item.get("member_quota") or benefits.get("memberQuota") or 1)),
            )
        if int(item.get("included_procurement_quota") or benefits.get("includedProcurementQuota") or 0) > 0:
            UsageCreditService(self.cursor, clock=self.clock).grant(
                owner,
                int(item.get("included_procurement_quota") or benefits.get("includedProcurementQuota")),
                source="plan", release_id=order["release_id"],
                policy_checksum=str(snapshot.get("releaseChecksum") or decision.get("releaseChecksum")), issued_at=starts,
                expires_at=expires, order_item_id=item["id"],
            )
        outcome = self._mark_applied(order, before, {"startsAt": starts, "expiresAt": expires, "planVersionId": item.get("plan_version_id")})
        if is_scheduled:
            CommercialRepository(self.cursor, clock=self.clock).insert_outbox(
                "billing.activation_applied", "billing_order", order["id"],
                {"publicId": order["public_id"], "startsAt": starts, "expiresAt": expires},
            )
            log_audit(
                "billing.activation_applied", actor_user_id=order["actor_user_id"],
                organization_id=order.get("organization_id"), target_type="billing_order",
                target_id=order["id"], metadata={"startsAt": starts, "expiresAt": expires},
                cursor=self.cursor, required=True,
            )
        return outcome

    def _same_renewal_plan(self, current, item):
        """New releases may renew a logical plan, never silently switch plans."""
        if not current.get("plan_version_id"):
            return False
        row = self.cursor.execute(
            """SELECT 1 FROM billing_plan_versions AS current_plan
                 JOIN billing_plan_versions AS next_plan
                   ON next_plan.logical_package_code = current_plan.logical_package_code
                  AND next_plan.owner_kind = current_plan.owner_kind
                  AND next_plan.tier = current_plan.tier
                  AND next_plan.variant = current_plan.variant
                WHERE current_plan.id = ? AND next_plan.id = ?""",
            (current["plan_version_id"], item.get("plan_version_id")),
        ).fetchone()
        return bool(row)

    def _queued_renewals(self, order):
        owner_column = "account_user_id" if order["owner_kind"] == "account" else "organization_id"
        rows = self.cursor.execute(
            f"""SELECT activation.after_json, activation.expected_revision, queued.id
                  FROM billing_subscription_activations AS activation
                  JOIN billing_orders AS queued ON queued.id = activation.order_id
                 WHERE queued.owner_kind = ? AND queued.{owner_column} = ?
                   AND queued.id != ? AND queued.operation = 'renew'
                   AND queued.payment_state = 'verified_paid'
                   AND queued.activation_state = 'pending' AND activation.state = 'pending'
                 ORDER BY (activation.after_json::jsonb ->> 'expiresAt')::bigint, queued.id""",  # noqa: S608 - fixed owner column
            (order["owner_kind"], order[owner_column], order["id"]),
        ).fetchall()
        queued = []
        for row in rows:
            after = json.loads(row["after_json"])
            if after.get("scheduled") is True:
                queued.append({"after": after, "expected_revision": row["expected_revision"], "order_id": row["id"]})
        return queued

    def _schedule_renewal(self, order, current, item, starts, expires, expected_revision, predecessor):
        after = {"scheduled": True, "startsAt": starts, "expiresAt": expires, "planVersionId": item.get("plan_version_id"),
                 "expectedPlanVersionId": predecessor["after"]["planVersionId"] if predecessor else current.get("plan_version_id"),
                 "expectedSourceOrderId": predecessor["order_id"] if predecessor else current.get("source_order_id")}
        self.cursor.execute(
            """INSERT INTO billing_subscription_activations
                   (id, order_id, state, before_json, after_json, expected_revision, reason_code)
               VALUES (?, ?, 'pending', ?, ?, ?, 'RENEWAL_SCHEDULED')
               ON CONFLICT(order_id) DO UPDATE SET state = 'pending',
                 before_json = excluded.before_json, after_json = excluded.after_json,
                 expected_revision = excluded.expected_revision, reason_code = 'RENEWAL_SCHEDULED',
                 updated_at = CURRENT_TIMESTAMP""",
            (new_id("subscription-activation"), order["id"], canonical_json(current), canonical_json(after), expected_revision),
        )
        self.cursor.execute("UPDATE billing_orders SET activation_state = 'pending', revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (order["id"],))
        return {"status": "scheduled", **after}

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
        payment = self.cursor.execute("SELECT id FROM payment_transactions WHERE order_id = ? AND transaction_type = 'payment' AND status = 'verified'", (order["id"],)).fetchone()
        if payment:
            self._request_invoice_if_due(order, payment[0], "applied")
        return {"status": "applied"}

    def _mark_review(self, order, reason, *, evidence=None):
        activation_id = new_id("subscription-activation")
        self.cursor.execute(
            """INSERT INTO billing_subscription_activations
                   (id, order_id, state, before_json, after_json, reason_code)
               VALUES (?, ?, 'review_required', '{}', '{}', ?)
               ON CONFLICT(order_id) DO UPDATE SET state = 'review_required', reason_code = excluded.reason_code,
                 updated_at = CURRENT_TIMESTAMP""",
            (
                activation_id,
                order["id"],
                str(reason)[:200],
            ),
        )
        if evidence:
            self.cursor.execute(
                "UPDATE billing_subscription_activations SET after_json = ? WHERE order_id = ?",
                (canonical_json(evidence), order["id"]),
            )
        self.cursor.execute("UPDATE billing_orders SET activation_state = 'review_required', revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (order["id"],))
        return {"status": "review_required", "reason": str(reason)}

    def _review(self, event_id, order, reason, *, evidence=None):
        self._mark_review(order, reason, evidence=evidence)
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

    @staticmethod
    def _timestamp_review_evidence(result):
        payload = result if isinstance(result, dict) else {}
        return {
            "providerOrderCode": payload.get("orderCode"),
            "paymentLinkId": payload.get("paymentLinkId") or payload.get("id"),
            "providerReference": payload.get("reference"),
            "providerStatus": payload.get("status"),
            "transactionDateTime": payload.get("transactionDateTime"),
            "createdAt": payload.get("createdAt"),
        }

    def _payment_timing(self, order, occurred):
        try:
            expiry = int(order.get("checkout_expires_at") or 0)
        except (TypeError, ValueError):
            expiry = 0
        if order.get("checkout_state") == "cancelled":
            return "late_after_cancel"
        if expiry and occurred > expiry:
            return "late_after_expiry"
        return "on_time"
