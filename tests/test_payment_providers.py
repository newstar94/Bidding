import hashlib
import hmac
import json

import pytest

from backend.billing.providers.base import PaymentProviderError
from backend.billing.service import _stable_order_code
from backend.billing.providers.fake import FakePaymentProvider
from backend.billing.providers.payos import (
    PayOSCredentials,
    PayOSPaymentProvider,
    canonicalize_signed_data,
    sign_create_request,
    sign_signed_data,
    validate_checkout_url,
    verify_signed_data,
)
from backend.commercial_policy.errors import CommercialPolicyError, REFUND_NOT_SUPPORTED


KEY = "test-checksum"


@pytest.mark.parametrize(
    "credentials",
    [
        (None, "api", KEY),
        ("client", None, KEY),
        ("client", "api", None),
        ("client", "api", "   "),
    ],
)
def test_payos_credentials_reject_missing_values(credentials):
    with pytest.raises(ValueError, match="Incomplete payOS credentials"):
        PayOSCredentials(*credentials)


def test_payos_create_signature_uses_the_exact_five_field_contract():
    payload = {
        "orderCode": 123456789,
        "amount": 150000,
        "description": "DH123456",
        "cancelUrl": "https://app.example/cancel",
        "returnUrl": "https://app.example/return",
        "buyerName": "Ignored by create signature",
    }
    assert sign_create_request(payload, KEY) == (
        "403ecc973ce51ff3a13ef2a5670e78d48ebfdf774cd8e0fd8189490d7af8d7fb"
    )


def test_payos_webhook_canonicalization_sorts_keys_not_array_items_and_preserves_unicode():
    data = {
        "orderCode": 123456789,
        "items": [{"quantity": 1, "name": "Gói Việt", "price": 150000}],
        "description": "Thanh toan",
        "amount": 150000,
    }
    canonical = (
        'amount=150000&description=Thanh toan&items='
        '[{"name":"Gói Việt","price":150000,"quantity":1}]&orderCode=123456789'
    )
    assert canonicalize_signed_data(data) == canonical
    expected = hmac.new(KEY.encode(), canonical.encode(), hashlib.sha256).hexdigest()
    assert sign_signed_data(data, KEY) == expected
    assert verify_signed_data(data, expected, KEY)


@pytest.mark.parametrize(
    "url",
    [
        "http://pay.payos.vn/web/1",
        "https://pay.payos.vn.evil.example/web/1",
        "https://user@pay.payos.vn/web/1",
        "https://pay.payos.vn:444/web/1",
    ],
)
def test_payos_checkout_url_uses_an_exact_https_host_allowlist(url):
    with pytest.raises(PaymentProviderError):
        validate_checkout_url(url)


def test_payos_create_verifies_signed_response_and_does_not_send_idempotency_header():
    captured = {}

    def transport(method, url, headers, body, timeout):
        captured.update({"method": method, "url": url, "headers": headers, "body": body, "timeout": timeout})
        data = {
            "orderCode": body["orderCode"],
            "amount": body["amount"],
            "status": "PENDING",
            "paymentLinkId": "link-1",
            "checkoutUrl": "https://pay.payos.vn/web/link-1",
        }
        envelope = {"code": "00", "data": data, "signature": sign_signed_data(data, KEY)}
        return 200, json.dumps(envelope).encode()

    provider = PayOSPaymentProvider(
        PayOSCredentials("client", "api", KEY), transport=transport
    )
    result = provider.create_payment({
        "orderCode": 123,
        "amount": 99000,
        "description": "DH0000123",
        "cancelUrl": "https://app.example/cancel",
        "returnUrl": "https://app.example/return",
    })
    assert result["paymentLinkId"] == "link-1"
    assert "x-idempotency-key" not in captured["headers"]
    assert captured["body"]["signature"] == sign_create_request(captured["body"], KEY)


def test_payos_rejects_unsigned_success_and_refund_capability():
    provider = PayOSPaymentProvider(
        PayOSCredentials("client", "api", KEY),
        transport=lambda *_args: (200, b'{"code":"00","data":{}}'),
    )
    with pytest.raises(PaymentProviderError, match="chữ ký"):
        provider.get_payment(123)
    with pytest.raises(CommercialPolicyError) as error:
        provider.refund_payment(123)
    assert error.value.code == REFUND_NOT_SUPPORTED


def test_payos_get_normalizes_the_official_id_as_payment_link_id():
    data = {
        "id": "link-from-get",
        "orderCode": 123,
        "amount": 99000,
        "amountPaid": 0,
        "amountRemaining": 99000,
        "status": "PENDING",
        "transactions": [],
    }
    provider = PayOSPaymentProvider(
        PayOSCredentials("client", "api", KEY),
        transport=lambda *_args: (
            200,
            json.dumps(
                {
                    "code": "00",
                    "data": data,
                    "signature": sign_signed_data(data, KEY),
                }
            ).encode(),
        ),
    )

    result = provider.get_payment(123)

    assert result["paymentLinkId"] == "link-from-get"


def test_fake_provider_duplicate_timeout_reconciliation_and_delayed_payment():
    timeout_provider = FakePaymentProvider(scenario="timeout", clock=lambda: 100)
    request = {"orderCode": 101, "amount": 99000}
    with pytest.raises(PaymentProviderError) as error:
        timeout_provider.create_payment(request)
    assert error.value.outcome_unknown
    assert timeout_provider.get_payment(101)["orderCode"] == 101

    delayed = FakePaymentProvider(scenario="delayed", clock=lambda: 100)
    first = delayed.create_payment({"orderCode": 202, "amount": 399000})
    duplicate = delayed.create_payment({"orderCode": 202, "amount": 399000})
    assert duplicate == first
    assert delayed.get_payment(202)["status"] == "PROCESSING"
    assert delayed.get_payment(202)["status"] == "PAID"


def test_fake_provider_exposes_local_hosted_simulator_and_explicit_actions():
    provider = FakePaymentProvider(
        scenario="success",
        clock=lambda: 123,
        profile_id="provider-fake-v1",
    )
    payment = provider.create_payment({"orderCode": 303, "amount": 129000})

    assert payment["checkoutUrl"] == (
        "/thanh-toan-gia-lap/provider-fake-v1/303"
    )
    assert provider.simulate_payment(303, "complete")["status"] == "PAID"
    assert provider.simulate_payment(303, "cancel")["status"] == "CANCELLED"
    assert provider.simulate_payment(303, "expire")["status"] == "EXPIRED"


def test_stable_provider_order_code_fits_postgres_integer():
    first = _stable_order_code("billing-order-example")

    assert first == _stable_order_code("billing-order-example")
    assert 1 <= first <= 2_147_483_647
