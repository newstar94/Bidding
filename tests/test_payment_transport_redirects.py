"""Payment redirects cannot forward API credentials to a different origin."""

import io
from email.message import Message
import urllib.request
import urllib.response

import pytest

from backend.billing.providers import base


ORIGIN = "https://api-merchant.payos.vn"
AUTH_HEADERS = {"x-api-key": "fixture-api-key", "x-client-id": "fixture-client-id"}


def _transport(monkeypatch, *, target=None, status=302, payload=b'{"code":"00"}', response_status=200, responses=None, redirect_targets=None):
    calls = []

    class MemoryHTTPS(urllib.request.HTTPSHandler):
        def https_open(self, request):
            calls.append(request)
            headers = Message()
            targets = redirect_targets if redirect_targets is not None else ([target] if target else [])
            if len(calls) <= len(targets):
                headers["Location"] = targets[len(calls) - 1]
                response = urllib.response.addinfourl(io.BytesIO(b""), headers, request.full_url, status)
            else:
                response = urllib.response.addinfourl(io.BytesIO(payload), headers, request.full_url, response_status)
            response.msg = "fixture"
            if responses is not None:
                responses.append(response)
            return response

    build_opener = urllib.request.build_opener
    monkeypatch.setattr(base.urllib.request, "build_opener", lambda *handlers: build_opener(
        urllib.request.ProxyHandler({}), MemoryHTTPS(), *handlers,
    ))
    return calls


@pytest.mark.parametrize("target", [
    "https://example.invalid/collect",
    "http://api-merchant.payos.vn/collect",
    "https://api-merchant.payos.vn:444/collect",
    "https://api-merchant.payos.vn:0/collect",
    "https://user:pass@api-merchant.payos.vn/collect",
])
@pytest.mark.parametrize("method", ["GET", "POST"])
def test_redirect_rejects_external_origin_before_any_credential_forwarding(monkeypatch, target, method):
    responses = []
    calls = _transport(monkeypatch, target=target, responses=responses)
    with pytest.raises(base.PaymentProviderError) as raised:
        base.bounded_json_transport(method, f"{ORIGIN}/v2/payment-requests", AUTH_HEADERS,
                                    {} if method == "POST" else None, 5)
    assert raised.value.code == "PROVIDER_REDIRECT_REJECTED"
    assert raised.value.outcome_unknown is (method == "POST")
    assert raised.value.retryable is False
    assert len(calls) == 1
    assert responses[0].closed
    assert calls[0].get_header("X-api-key") == AUTH_HEADERS["x-api-key"]


@pytest.mark.parametrize("target", ["/v2/canonical", f"{ORIGIN}:443/v2/canonical"])
def test_same_origin_redirect_keeps_existing_get_behavior(monkeypatch, target):
    calls = _transport(monkeypatch, target=target)
    assert base.bounded_json_transport("GET", f"{ORIGIN}/v2/status", AUTH_HEADERS, None, 5) == (200, b'{"code":"00"}')
    assert len(calls) == 2
    assert calls[1].get_header("X-api-key") == AUTH_HEADERS["x-api-key"]


def test_rejected_redirect_chain_preserves_original_write_outcome(monkeypatch):
    calls = _transport(monkeypatch, redirect_targets=["/v2/canonical", "https://example.invalid/collect"])
    with pytest.raises(base.PaymentProviderError) as raised:
        base.bounded_json_transport("POST", f"{ORIGIN}/v2/payment-requests", AUTH_HEADERS, {}, 5)
    assert [request.get_method() for request in calls] == ["POST", "GET"]
    assert raised.value.code == "PROVIDER_REDIRECT_REJECTED"
    assert raised.value.outcome_unknown is True
    assert raised.value.retryable is False


def test_normal_payment_response_and_size_limit_are_unchanged(monkeypatch):
    calls = _transport(monkeypatch)
    assert base.bounded_json_transport("POST", f"{ORIGIN}/v2/payment-requests", AUTH_HEADERS, {"amount": 100}, 5)[0] == 200
    assert len(calls) == 1
    assert calls[0].data == b'{"amount":100}'


def test_payment_response_remains_bounded(monkeypatch):
    _transport(monkeypatch, payload=b"x" * 262_145)
    with pytest.raises(base.PaymentProviderError, match="too large"):
        base.bounded_json_transport("GET", f"{ORIGIN}/v2/status", AUTH_HEADERS, None, 5)


def test_http_error_body_is_bounded_and_its_connection_is_closed(monkeypatch):
    responses = []
    _transport(monkeypatch, response_status=503, payload=b"x" * 300_000, responses=responses)
    status, body = base.bounded_json_transport("GET", f"{ORIGIN}/v2/status", AUTH_HEADERS, None, 5)
    assert status == 503
    assert len(body) == 262_144
    assert responses[0].closed
