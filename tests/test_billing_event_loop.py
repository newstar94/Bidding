"""Billing routes keep synchronous database work off the request loop."""

import asyncio
import json
import time
from threading import Event, get_ident
from types import SimpleNamespace

import pytest
from starlette.responses import JSONResponse

from backend.billing import routes as billing_routes
from backend.billing import webhook
from backend.billing.providers.payos import PayOSCredentials, PayOSPaymentProvider, sign_signed_data
from backend.billing.runtime import PaymentProviderRegistry
from backend.commercial_policy import routes as commercial_routes
from backend.shared.async_io import BlockingIOBusyError


def test_webhook_database_wait_does_not_block_event_loop(monkeypatch):
    started, release = Event(), Event()
    worker_threads = []
    data = {"orderCode": 123, "amount": 100, "paymentLinkId": "link", "reference": "ref"}
    raw = json.dumps({"data": data, "signature": sign_signed_data(data, "key")}).encode()

    class Result:
        rowcount = 1

        def fetchone(self):
            if "payment_provider_profiles" in self.statement:
                return {"id": "payos-profile", "provider": "payos"}
            return None

    class Connection:
        def execute(self, statement, _parameters=()):
            result = Result()
            result.statement = statement
            return result

        def commit(self):
            pass

        def rollback(self):
            pass

        def close(self):
            pass

    def connect():
        worker_threads.append(get_ident())
        started.set()
        assert release.wait(2)
        return Connection()

    class Registry(PaymentProviderRegistry):
        def __init__(self):
            super().__init__(environment={})
            self.install("payos-profile", PayOSPaymentProvider(PayOSCredentials("c", "a", "key")))

    monkeypatch.setattr(webhook, "database", SimpleNamespace(get_connection=connect))
    monkeypatch.setattr(webhook, "payment_provider_registry", Registry)

    class Request:
        path_params = {"profile_id": "payos-profile"}

        async def body(self):
            return raw

    async def scenario():
        loop_thread = get_ident()
        task = asyncio.create_task(webhook.payment_webhook_api(Request()))
        async with asyncio.timeout(2):
            while not started.is_set():
                await asyncio.sleep(0)
            assert worker_threads == [worker_threads[0]]
            assert worker_threads[0] != loop_thread
            ticker_start = time.perf_counter()
            await asyncio.sleep(0.01)
            ticker_delay = time.perf_counter() - ticker_start
            assert ticker_delay < 0.1
            release.set()
            response = await task
        assert response.status_code == 202

    try:
        asyncio.run(scenario())
    finally:
        release.set()


@pytest.mark.parametrize(
    "module, endpoint",
    [
        (billing_routes, billing_routes.list_personal_orders_api),
        (commercial_routes, commercial_routes.commercial_admin_overview_api),
    ],
)
def test_billing_and_commercial_authentication_runs_off_loop(monkeypatch, module, endpoint):
    auth_threads = []

    def verify(_request, **_kwargs):
        auth_threads.append(get_ident())
        return False, "Phiên đã hết hạn."

    monkeypatch.setattr(module, "verify_session", verify)

    async def scenario():
        loop_thread = get_ident()
        response = await endpoint(SimpleNamespace())
        assert response.status_code == 403
        assert auth_threads and auth_threads[0] != loop_thread

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "enabled, authenticated, body, expected_status, expected_code, reads_body",
    [
        (False, True, {}, 503, "QUOTE_NOT_AVAILABLE", False),
        (True, False, {}, 403, "FORBIDDEN", False),
        (True, True, {"ownerKind": "account", "ownerId": "other"}, 403, "BUYER_NOT_AUTHORIZED", True),
        (True, True, {"ownerKind": "organization", "ownerId": "other"}, 403, "BUYER_NOT_AUTHORIZED", True),
    ],
)
def test_quote_preserves_pre_transaction_authority(
    monkeypatch, enabled, authenticated, body, expected_status, expected_code, reads_body,
):
    body_calls = []
    actor = SimpleNamespace(user_id="buyer", active_role_organization_id="org-a")
    monkeypatch.setattr(
        commercial_routes, "commercial_runtime_config",
        lambda: SimpleNamespace(enabled=enabled, mode="enforce" if enabled else "off"),
    )
    monkeypatch.setattr(
        commercial_routes, "verify_session",
        lambda _request: (True, actor) if authenticated else (False, "Phiên đã hết hạn."),
    )

    async def read_body(_request):
        body_calls.append(True)
        return body

    async def forbidden_write(*_args, **_kwargs):
        pytest.fail("Rejected quote must not enter the transaction lane.")

    monkeypatch.setattr(commercial_routes, "_json_body", read_body)
    monkeypatch.setattr(commercial_routes, "run_database_write", forbidden_write)
    response = asyncio.run(commercial_routes.create_billing_quote_api(SimpleNamespace()))
    assert response.status_code == expected_status
    assert json.loads(response.body)["code"] == expected_code
    assert bool(body_calls) is reads_body


def test_checkout_keeps_transaction_auth_response(monkeypatch):
    monkeypatch.setattr(
        billing_routes, "commercial_runtime_config",
        lambda: SimpleNamespace(payment_checkout_enabled=True),
    )

    async def body(_request):
        return {"quotePublicId": "quote-a"}, None

    async def forbidden_transaction(*_args):
        return JSONResponse({"error": "Phiên đã hết hạn.", "code": "FORBIDDEN"}, status_code=403)

    monkeypatch.setattr(billing_routes, "read_json_object", body)
    monkeypatch.setattr(billing_routes, "run_database_write", forbidden_transaction)
    request = SimpleNamespace(headers={"Idempotency-Key": "checkout-key"})
    response = asyncio.run(billing_routes.create_checkout_api(request))
    assert response.status_code == 403
    assert json.loads(response.body)["code"] == "FORBIDDEN"


def test_checkout_provider_busy_keeps_generic_failure(monkeypatch):
    monkeypatch.setattr(
        billing_routes, "commercial_runtime_config",
        lambda: SimpleNamespace(payment_checkout_enabled=True),
    )
    monkeypatch.setattr(billing_routes, "_provider_executor", lambda: SimpleNamespace(execute=lambda _command: None))
    monkeypatch.setattr(billing_routes, "log_error", lambda *_args: None)

    async def body(_request):
        return {"quotePublicId": "quote-a"}, None

    async def committed_transaction(*_args):
        return {"order": {}, "command_id": "command-a", "replayed": False}

    async def provider_busy(*_args, **_kwargs):
        raise BlockingIOBusyError("Provider lane saturated")

    monkeypatch.setattr(billing_routes, "read_json_object", body)
    monkeypatch.setattr(billing_routes, "run_database_write", committed_transaction)
    monkeypatch.setattr(billing_routes, "run_blocking_io", provider_busy)
    request = SimpleNamespace(headers={"Idempotency-Key": "checkout-key"})
    response = asyncio.run(billing_routes.create_checkout_api(request))
    assert response.status_code == 500
    assert json.loads(response.body)["code"] == "BILLING_FAILED"


def test_disabled_storefront_does_not_use_database_lane(monkeypatch):
    monkeypatch.setattr(
        commercial_routes, "commercial_runtime_config",
        lambda: SimpleNamespace(enabled=False, mode="off"),
    )

    async def rejected_read(*_args):
        pytest.fail("The disabled storefront must not enter the database lane.")

    monkeypatch.setattr(commercial_routes, "run_database_read", rejected_read)
    response = asyncio.run(commercial_routes.public_commercial_offers_api(SimpleNamespace()))
    assert response.status_code == 200
    assert json.loads(response.body)["availability"] == "off"
