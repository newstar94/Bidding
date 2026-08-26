"""Deterministic provider that exercises the production provider contract."""

from __future__ import annotations

import time

from backend.commercial_policy.errors import CommercialPolicyError, REFUND_NOT_SUPPORTED

from .base import PaymentProviderError


class FakePaymentProvider:
    name = "fake"
    supports_refund = False
    SCENARIOS = frozenset(
        {"success", "duplicate", "delayed", "wrong_amount", "cancel", "expiry", "timeout", "failure"}
    )

    def __init__(self, *, scenario="success", clock=None, profile_id="fake-local"):
        if scenario not in self.SCENARIOS:
            raise ValueError("Unsupported fake payment scenario.")
        self.scenario = scenario
        self.clock = clock or time.time
        self.profile_id = str(profile_id or "fake-local")
        self._payments = {}
        self._reads = {}

    def create_payment(self, request):
        order_code = int(request["orderCode"])
        amount = int(request["amount"])
        if order_code in self._payments:
            return dict(self._payments[order_code])
        if self.scenario == "timeout":
            self._payments[order_code] = self._payment(order_code, amount, "PENDING")
            raise PaymentProviderError(
                "PROVIDER_TRANSPORT_FAILED", "Fake ambiguous timeout.", outcome_unknown=True, retryable=True
            )
        if self.scenario == "failure":
            raise PaymentProviderError("PROVIDER_REQUEST_FAILED", "Fake provider failure.")
        status = {
            "cancel": "CANCELLED",
            "expiry": "EXPIRED",
            "delayed": "PROCESSING",
        }.get(self.scenario, "PENDING")
        payment = self._payment(order_code, amount, status)
        if self.scenario == "wrong_amount":
            payment["settlementAmount"] = amount - 1
        self._payments[order_code] = payment
        return dict(payment)

    def get_payment(self, identifier):
        order_code = int(identifier)
        if order_code not in self._payments:
            raise PaymentProviderError("PROVIDER_NOT_FOUND", "Fake payment not found.")
        self._reads[order_code] = self._reads.get(order_code, 0) + 1
        payment = self._payments[order_code]
        if (
            self.scenario in {"success", "duplicate", "wrong_amount", "timeout"}
            and self._reads[order_code] >= 1
        ) or (self.scenario == "delayed" and self._reads[order_code] >= 2):
            paid = int(payment.get("settlementAmount") or payment["amount"])
            payment = {**payment, "status": "PAID", "amountPaid": paid, "amountRemaining": max(0, payment["amount"] - paid), "transactionDateTime": int(self.clock())}
            self._payments[order_code] = payment
        return dict(payment)

    def cancel_payment(self, identifier, reason=None):
        payment = self.get_payment(identifier)
        payment.update({
            "status": "CANCELLED",
            "cancellationReason": str(reason or "Fake cancellation"),
            "canceledAt": int(self.clock()),
        })
        self._payments[int(identifier)] = payment
        return dict(payment)

    def verify_webhook(self, envelope):
        if not isinstance(envelope, dict) or envelope.get("provider") != "fake" or not isinstance(envelope.get("data"), dict):
            raise PaymentProviderError("PROVIDER_EVENT_UNVERIFIED", "Fake webhook invalid.")
        return dict(envelope["data"])

    def refund_payment(self, *_args, **_kwargs):
        raise CommercialPolicyError(
            REFUND_NOT_SUPPORTED,
            "Fake Payment Request follows MVP manual-refund capability.",
            status_code=409,
        )

    def simulate_payment(self, identifier, action):
        """Drive the local hosted simulator without bypassing reconciliation."""

        order_code = int(identifier)
        if order_code not in self._payments:
            raise PaymentProviderError("PROVIDER_NOT_FOUND", "Fake payment not found.")
        normalized = str(action or "").strip().casefold()
        if normalized not in {"complete", "cancel", "expire"}:
            raise PaymentProviderError("FAKE_ACTION_INVALID", "Fake payment action invalid.")
        payment = dict(self._payments[order_code])
        if normalized == "complete":
            payment.update({
                "status": "PAID",
                "amountPaid": int(payment["amount"]),
                "amountRemaining": 0,
                "transactionDateTime": int(self.clock()),
            })
        elif normalized == "cancel":
            payment.update({"status": "CANCELLED", "canceledAt": int(self.clock())})
        else:
            payment.update({"status": "EXPIRED", "expiredAt": int(self.clock())})
        self._payments[order_code] = payment
        return dict(payment)

    def webhook_for(self, order_code):
        payment = self.get_payment(order_code)
        return {
            "provider": "fake",
            "data": {
                "orderCode": payment["orderCode"],
                "amount": payment["amount"],
                "paymentLinkId": payment["id"],
                "reference": f"FAKE-{payment['orderCode']}",
                "status": payment["status"],
            },
        }

    def _payment(self, order_code, amount, status):
        paid = amount if status == "PAID" else 0
        return {
            "id": f"fake-link-{order_code}",
            "paymentLinkId": f"fake-link-{order_code}",
            "orderCode": order_code,
            "amount": amount,
            "amountPaid": paid,
            "amountRemaining": amount - paid,
            "status": status,
            "createdAt": int(self.clock()),
            "transactions": [],
            "checkoutUrl": (
                f"/thanh-toan-gia-lap/{self.profile_id}/{order_code}"
            ),
        }
