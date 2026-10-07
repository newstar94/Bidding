"""payOS Payment Request adapter pinned to the official primary-source contract."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import hmac
import json
from urllib.parse import urlsplit

from backend.commercial_policy.errors import CommercialPolicyError, REFUND_NOT_SUPPORTED

from .base import PaymentProviderError, bounded_json_transport


PAYOS_API_ORIGIN = "https://api-merchant.payos.vn"
PAYOS_CHECKOUT_HOSTS = frozenset({"pay.payos.vn", "next.pay.payos.vn"})
PAYOS_STATUSES = frozenset(
    {"PENDING", "CANCELLED", "UNDERPAID", "PAID", "EXPIRED", "PROCESSING", "FAILED"}
)


def _scalar(value):
    if value is None or value in {"null", "undefined"}:
        return ""
    if value is True:
        return "true"
    if value is False:
        return "false"
    return str(value)


def _normalized_json(value):
    # Transaction JSON retains null and literal string values when payOS signs
    # a response. Only top-level scalar fields use the empty-string convention.
    if isinstance(value, dict):
        return {key: _normalized_json(value[key]) for key in sorted(value)}
    if isinstance(value, list):
        return [_normalized_json(item) for item in value]
    return value


def canonicalize_signed_data(data):
    if not isinstance(data, dict):
        raise ValueError("payOS signed data must be an object.")
    pairs = []
    for key in sorted(data):
        value = data[key]
        if isinstance(value, (dict, list)):
            encoded = json.dumps(
                _normalized_json(value), ensure_ascii=False, separators=(",", ":")
            )
        else:
            encoded = _scalar(value)
        pairs.append(f"{key}={encoded}")
    return "&".join(pairs)


def sign_signed_data(data, checksum_key):
    return hmac.new(
        str(checksum_key).encode("utf-8"),
        canonicalize_signed_data(data).encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def sign_create_request(payload, checksum_key):
    canonical = (
        f"amount={int(payload['amount'])}"
        f"&cancelUrl={payload['cancelUrl']}"
        f"&description={payload['description']}"
        f"&orderCode={int(payload['orderCode'])}"
        f"&returnUrl={payload['returnUrl']}"
    )
    return hmac.new(
        str(checksum_key).encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256
    ).hexdigest()


def verify_signed_data(data, signature, checksum_key):
    expected = sign_signed_data(data, checksum_key)
    return hmac.compare_digest(expected, str(signature or "").strip().casefold())


def validate_checkout_url(value):
    try:
        parsed = urlsplit(str(value or ""))
        invalid = (
            parsed.scheme != "https"
            or parsed.hostname not in PAYOS_CHECKOUT_HOSTS
            or parsed.username is not None
            or parsed.password is not None
            or parsed.port not in {None, 443}
        )
    except ValueError as error:
        raise PaymentProviderError("PROVIDER_CHECKOUT_URL_INVALID", "payOS checkout URL không hợp lệ.") from error
    if invalid:
        raise PaymentProviderError("PROVIDER_CHECKOUT_URL_INVALID", "payOS checkout URL không hợp lệ.")
    return parsed.geturl()


def _validate_callback_url(value):
    parsed = urlsplit(str(value or ""))
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Payment callback URL must be an absolute HTTPS URL.")
    return parsed.geturl()


@dataclass(frozen=True)
class PayOSCredentials:
    client_id: str
    api_key: str
    checksum_key: str

    def __post_init__(self):
        if not all(
            value is not None and str(value).strip()
            for value in (self.client_id, self.api_key, self.checksum_key)
        ):
            raise ValueError("Incomplete payOS credentials.")


class PayOSPaymentProvider:
    name = "payos"
    supports_refund = False

    def __init__(self, credentials, *, transport=None, timeout_seconds=5, api_origin=PAYOS_API_ORIGIN):
        if str(api_origin).rstrip("/") != PAYOS_API_ORIGIN:
            raise ValueError("payOS API origin must match the official production host.")
        self.credentials = credentials
        self.transport = transport or bounded_json_transport
        self.timeout_seconds = max(0.1, min(30.0, float(timeout_seconds)))

    def create_payment(self, request):
        payload = {
            "orderCode": int(request["orderCode"]),
            "amount": int(request["amount"]),
            "description": str(request["description"]),
            "cancelUrl": _validate_callback_url(request["cancelUrl"]),
            "returnUrl": _validate_callback_url(request["returnUrl"]),
        }
        if payload["orderCode"] <= 0 or payload["amount"] <= 0:
            raise ValueError("payOS orderCode and amount must be positive integers.")
        for key in ("buyerName", "buyerEmail", "buyerPhone", "buyerAddress", "items", "expiredAt"):
            if key in request and request[key] is not None:
                payload[key] = request[key]
        payload["signature"] = sign_create_request(payload, self.credentials.checksum_key)
        data = self._call("POST", "/v2/payment-requests", payload, mutation=True)
        checkout_url = validate_checkout_url(data.get("checkoutUrl"))
        self._match_order(data, payload["orderCode"], payload["amount"])
        return {**data, "checkoutUrl": checkout_url}

    def get_payment(self, identifier):
        identifier = self._identifier(identifier)
        data = self._call("GET", f"/v2/payment-requests/{identifier}", None)
        self._validate_status(data)
        if data.get("id") and not data.get("paymentLinkId"):
            data["paymentLinkId"] = str(data["id"])
        transactions = data.get("transactions")
        if transactions == {}:
            data["transactions"] = []
        elif not isinstance(transactions, list):
            raise PaymentProviderError("PROVIDER_SCHEMA_INVALID", "payOS transactions shape không hợp lệ.")
        self._project_paid_transaction_evidence(data)
        return data

    def cancel_payment(self, identifier, reason=None):
        identifier = self._identifier(identifier)
        body = {"cancellationReason": str(reason)[:500]} if reason else {}
        data = self._call("POST", f"/v2/payment-requests/{identifier}/cancel", body, mutation=True)
        self._validate_status(data)
        return data

    def verify_webhook(self, envelope):
        if not isinstance(envelope, dict) or not isinstance(envelope.get("data"), dict):
            raise PaymentProviderError("PROVIDER_EVENT_SCHEMA_INVALID", "Webhook payOS không hợp lệ.")
        if not verify_signed_data(envelope["data"], envelope.get("signature"), self.credentials.checksum_key):
            raise PaymentProviderError("PROVIDER_EVENT_UNVERIFIED", "Sai chữ ký webhook payOS.")
        return dict(envelope["data"])

    def refund_payment(self, *_args, **_kwargs):
        raise CommercialPolicyError(
            REFUND_NOT_SUPPORTED,
            "payOS Payment Request không công bố refund API; cần xử lý thủ công ngoài nền tảng.",
            status_code=409,
        )

    def _call(self, method, path, body, *, mutation=False):
        headers = {
            "x-client-id": self.credentials.client_id,
            "x-api-key": self.credentials.api_key,
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": "BiddingFlow-Payments/1.0",
        }
        try:
            status, raw = self.transport(
                method, f"{PAYOS_API_ORIGIN}{path}", headers, body, self.timeout_seconds
            )
        except PaymentProviderError as error:
            if mutation:
                error.outcome_unknown = True
            raise
        try:
            envelope = json.loads(bytes(raw).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError, TypeError) as error:
            raise PaymentProviderError("PROVIDER_RESPONSE_INVALID", "payOS trả dữ liệu không hợp lệ.") from error
        if status < 200 or status >= 300 or envelope.get("code") != "00":
            raise PaymentProviderError(
                "PROVIDER_REQUEST_FAILED",
                "payOS từ chối payment request.",
                outcome_unknown=mutation and status >= 500,
                retryable=status in {408, 429} or status >= 500,
            )
        data = envelope.get("data")
        if not isinstance(data, dict) or not verify_signed_data(
            data, envelope.get("signature"), self.credentials.checksum_key
        ):
            raise PaymentProviderError("PROVIDER_RESPONSE_UNVERIFIED", "Sai chữ ký response payOS.")
        data = dict(data)
        checkout_url = data.get("checkoutUrl")
        if checkout_url is not None and checkout_url != "":
            data["checkoutUrl"] = validate_checkout_url(checkout_url)
        return data

    @staticmethod
    def _project_paid_transaction_evidence(data):
        """Expose one complete signed payment's reference/time after verification.

        payOS GET places occurrence time inside transactions; createdAt is the
        link creation time. Several transfers or incomplete amounts remain for
        the existing activation review path instead of choosing a timestamp.
        """
        transactions = data.get("transactions")
        if str(data.get("status") or "").upper() != "PAID" or len(transactions) != 1:
            return
        transaction = transactions[0]
        if not isinstance(transaction, dict):
            return
        amount, paid, transaction_amount = data.get("amount"), data.get("amountPaid"), transaction.get("amount")
        if not (type(amount) is int and type(paid) is int and type(transaction_amount) is int
                and amount > 0 and amount == paid == transaction_amount):
            return
        reference, occurrence = transaction.get("reference"), transaction.get("transactionDateTime")
        if not isinstance(reference, str) or not reference.strip():
            return
        if isinstance(occurrence, bool) or not isinstance(occurrence, (str, int, float)) or occurrence == "":
            return
        if not data.get("reference"):
            data["reference"] = reference
        if data.get("transactionDateTime") is None or data.get("transactionDateTime") == "":
            # Preserve the original value and let the shared strict parser
            # enforce the existing timezone and validity policy.
            data["transactionDateTime"] = occurrence

    @staticmethod
    def _identifier(value):
        text = str(value or "").strip()
        if not text or len(text) > 128 or any(character not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_" for character in text):
            raise ValueError("Invalid payOS payment identifier.")
        return text

    @staticmethod
    def _validate_status(data):
        if str(data.get("status") or "").upper() not in PAYOS_STATUSES:
            raise PaymentProviderError("PROVIDER_SCHEMA_INVALID", "Trạng thái payOS không được hỗ trợ.")

    @staticmethod
    def _match_order(data, order_code, amount):
        if int(data.get("orderCode") or 0) != int(order_code) or int(data.get("amount") or 0) != int(amount):
            raise PaymentProviderError("PAYMENT_MISMATCH", "payOS response không khớp order snapshot.")
