import json
import os
from pathlib import Path
import uuid
import asyncio

import psycopg
import pytest

from backend.billing.activation import BillingActivationService
from backend.billing.providers.base import PaymentProviderError
from backend.billing.providers.fake import FakePaymentProvider
from backend.billing.runtime import PaymentProviderRegistry
from backend.billing.service import BillingService, ProviderCommandExecutor
from backend.billing import webhook as billing_webhook
from backend.db.db_helper import PostgresCursor, PostgresDatabase


def _test_database_url():
    if value := os.environ.get("TEST_DATABASE_URL"):
        return value
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.is_file():
        return None
    for line in env_path.read_text(encoding="utf-8-sig").splitlines():
        key, separator, value = line.partition("=")
        if separator and key.strip() == "TEST_DATABASE_URL":
            return value.strip().strip('"').strip("'") or None
    return None


@pytest.fixture
def billing_cursor():
    database_url = _test_database_url()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    database = PostgresDatabase(database_url)
    try:
        connection = database.get_connection()
    except psycopg.Error as error:
        pytest.skip(f"PostgreSQL test database unavailable: {type(error).__name__}")
    try:
        connection.execute("BEGIN")
        yield connection.cursor()
    finally:
        connection.rollback()
        connection.close()
        database.close()


def _insert_base_plan_order(
    cursor,
    *,
    now=1_800_000_000,
    checkout_expires_at=None,
    owner_kind="account",
    item_type="base_plan",
):
    token = uuid.uuid4().hex
    actor = cursor.execute(
        """SELECT account.id
             FROM tai_khoan AS account
             LEFT JOIN account_subscriptions AS subscription
               ON subscription.user_id = account.id
            WHERE account.trang_thai = 'active' AND subscription.user_id IS NULL
            ORDER BY CASE WHEN account.vai_tro = 'super_admin' THEN 0 ELSE 1 END,
                     account.created_at, account.id
            LIMIT 1"""
    ).fetchone()
    if not actor:
        pytest.skip("Test database has no active account without a subscription")
    user_id = actor[0]
    organization_id = None
    if owner_kind == "organization":
        organization_id = f"org-test-{token}"
        cursor.execute(
            "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (?, ?)",
            (organization_id, "Tổ chức giả lập kỹ thuật"),
        )
    release = cursor.execute(
        """SELECT id, checksum FROM commercial_releases
            ORDER BY created_at, id LIMIT 1"""
    ).fetchone()
    assert release
    release_id, release_checksum = release
    plan_id = f"plan-test-{token}"
    sku_id = f"sku-test-{token}"
    price_id = f"price-test-{token}"
    quote_id = f"quote-test-{token}"
    order_id = f"order-test-{token}"
    order_item_id = f"item-test-{token}"
    public_quote = f"quote-public-{token}"
    public_order = f"order-public-{token}"
    cursor.execute(
        """INSERT INTO billing_plan_versions
               (id, release_id, logical_package_code, owner_kind, tier,
                variant, legacy_package_id, member_quota,
                included_procurement_quota, document_export_word,
                document_export_excel, document_export_award_result_excel,
                violation_check_enabled, sales_state, display_json)
           VALUES (?, ?, ?, ?, ?, 'connected', 'diamond',
                   1, 3, 1, 1, 1, 1, 'sellable', '{}')""",
        (
            plan_id,
            release_id,
            f"test.{owner_kind}.{token}",
            owner_kind,
            "personal" if owner_kind == "account" else "diamond",
        ),
    )
    cursor.execute(
        """INSERT INTO billing_skus
               (id, release_id, sku_code, item_type, plan_version_id,
                quantity, repeatable, sales_state)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'sellable')""",
        (
            sku_id,
            release_id,
            f"test-sku-{token}",
            item_type,
            plan_id if item_type == "base_plan" else None,
            25 if item_type == "procurement_credit_pack" else 1,
            1 if item_type == "procurement_credit_pack" else 0,
        ),
    )
    cursor.execute(
        """INSERT INTO billing_prices
               (id, release_id, sku_id, period, subtotal_amount,
                tax_amount, total_amount, effective_at)
           VALUES (?, ?, ?, 'yearly', 100000, 0, 100000, ?)""",
        (price_id, release_id, sku_id, now - 100),
    )
    decision_payload = {
            "itemType": item_type,
            "releaseChecksum": release_checksum,
            "benefits": (
                {
                    "procurementCredits": 25,
                    "expiryPolicy": {"kind": "fixed_days", "days": 365},
                }
                if item_type == "procurement_credit_pack"
                else {"includedProcurementQuota": 3}
            ),
            "policySnapshot": {"baseTerm": {"kind": "fixed_days", "days": 30}},
        }
    decision = json.dumps(
        decision_payload,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    operation = "credit_pack" if item_type == "procurement_credit_pack" else "purchase"
    if item_type == "procurement_credit_pack":
        if owner_kind == "account":
            cursor.execute(
                """INSERT INTO account_subscriptions
                       (user_id, package_id, status, starts_at, expires_at)
                   VALUES (?, 'diamond', 'active', ?, ?)""",
                (user_id, now - 1_000, now + 100_000),
            )
        else:
            cursor.execute(
                """INSERT INTO organization_subscriptions
                       (organization_id, package_id, status, starts_at,
                        expires_at, member_quota)
                   VALUES (?, 'diamond', 'active', ?, ?, 50)""",
                (organization_id, now - 1_000, now + 100_000),
            )
    cursor.execute(
        """INSERT INTO billing_quotes
               (id, public_id, actor_user_id, account_user_id,
                organization_id, owner_kind,
                operation, request_hash, release_id, release_checksum,
                decision_json, subtotal_amount, tax_amount, total_amount,
                expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                   100000, 0, 100000, ?)""",
        (
            quote_id,
            public_quote,
            user_id,
            user_id if owner_kind == "account" else None,
            organization_id,
            owner_kind,
            operation,
            "a" * 64,
            release_id,
            release_checksum,
            decision,
            now + 900,
        ),
    )
    order_code = int(token[:7], 16) + 1
    cursor.execute(
        """INSERT INTO billing_orders
               (id, public_id, quote_id, actor_user_id, account_user_id,
                organization_id,
                owner_kind, operation, idempotency_key, request_hash,
                release_id, provider_profile_id, provider_order_code,
                provider_reference, decision_json, subtotal_amount,
                tax_amount, total_amount, checkout_state,
                checkout_expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                   'provider-fake-v1', ?, ?, ?, 100000, 0, 100000,
                   'open', ?)""",
        (
            order_id,
            public_order,
            quote_id,
            user_id,
            user_id if owner_kind == "account" else None,
            organization_id,
            owner_kind,
            operation,
            f"idem-{token}",
            "b" * 64,
            release_id,
            order_code,
            f"provider-ref-{token}",
            decision,
            checkout_expires_at or now + 600,
        ),
    )
    cursor.execute(
        """INSERT INTO billing_order_items
               (id, order_id, sku_id, plan_version_id, price_id,
                quantity, snapshot_json)
           VALUES (?, ?, ?, ?, ?, 1, ?)""",
        (
            order_item_id,
            order_id,
            sku_id,
            plan_id if item_type == "base_plan" else None,
            price_id,
            decision,
        ),
    )
    return {
        "order_id": order_id,
        "order_code": order_code,
        "user_id": user_id,
        "organization_id": organization_id,
        "owner_kind": owner_kind,
        "item_type": item_type,
        "now": now,
    }


def _paid_result(order, *, amount=100000, occurred_at=None, reference=None):
    return {
        "status": "PAID",
        "orderCode": order["order_code"],
        "amount": amount,
        "reference": reference or f"payment-{order['order_id']}",
        "transactionDateTime": occurred_at or order["now"],
    }


class _TransactionDatabase:
    """Let multi-connection billing code share one rollback-only test tx."""

    class _Connection:
        def __init__(self, raw_connection):
            self.raw_connection = raw_connection

        def execute(self, statement, parameters=None):
            return self.cursor().execute(statement, parameters)

        def cursor(self):
            return PostgresCursor(self.raw_connection.cursor())

        def commit(self):
            return None

        def rollback(self):
            return None

        def close(self):
            return None

    def __init__(self, cursor):
        self.raw_connection = cursor._cursor.connection

    def get_connection(self):
        return self._Connection(self.raw_connection)


class _WebhookRequest:
    def __init__(self, profile_id, payload):
        self.path_params = {"profile_id": profile_id}
        self._payload = json.dumps(payload, separators=(",", ":")).encode()

    async def body(self):
        return self._payload


def test_verified_base_plan_activation_is_exactly_once(billing_cursor):
    order = _insert_base_plan_order(billing_cursor)
    service = BillingActivationService(billing_cursor, clock=lambda: order["now"])

    first = service.apply_order_result(
        order["order_id"],
        _paid_result(order),
        provider_profile_id="provider-fake-v1",
    )
    second = service.apply_order_result(
        order["order_id"],
        _paid_result(order),
        provider_profile_id="provider-fake-v1",
    )

    assert first["status"] == second["status"] == "applied"
    assert billing_cursor.execute(
        "SELECT activation_state FROM billing_orders WHERE id = ?", (order["order_id"],)
    ).fetchone()[0] == "applied"
    assert billing_cursor.execute(
        "SELECT COUNT(*) FROM payment_transactions WHERE order_id = ?",
        (order["order_id"],),
    ).fetchone()[0] == 1
    assert billing_cursor.execute(
        "SELECT COUNT(*) FROM billing_subscription_activations WHERE order_id = ?",
        (order["order_id"],),
    ).fetchone()[0] == 1
    assert billing_cursor.execute(
        "SELECT COUNT(*) FROM usage_credit_grants WHERE account_user_id = ?",
        (order["user_id"],),
    ).fetchone()[0] == 1
    assert billing_cursor.execute(
        "SELECT COUNT(*) FROM billing_invoice_requests WHERE order_id = ?",
        (order["order_id"],),
    ).fetchone()[0] == 1
    assert billing_cursor.execute(
        """SELECT COUNT(*) FROM commercial_outbox
             WHERE aggregate_id = ? AND event_type IN (
                 'billing.payment_verified',
                 'billing.activation_applied',
                 'billing.invoice_requested'
             )""",
        (order["order_id"],),
    ).fetchone()[0] == 3
    assert billing_cursor.execute(
        """SELECT COUNT(*) FROM audit_log
             WHERE target_id = ? AND action = 'billing.payment_verified'""",
        (order["order_id"],),
    ).fetchone()[0] == 1
    subscription = billing_cursor.execute(
        "SELECT source, source_order_id FROM account_subscriptions WHERE user_id = ?",
        (order["user_id"],),
    ).fetchone()
    assert tuple(subscription) == ("order", order["order_id"])


def test_provider_transaction_cannot_activate_two_orders(billing_cursor):
    first_order = _insert_base_plan_order(billing_cursor)
    second_order = _insert_base_plan_order(
        billing_cursor,
        owner_kind="organization",
    )
    service = BillingActivationService(
        billing_cursor,
        clock=lambda: first_order["now"],
    )
    shared_reference = f"shared-payment-{uuid.uuid4().hex}"

    first = service.apply_order_result(
        first_order["order_id"],
        _paid_result(first_order, reference=shared_reference),
        provider_profile_id="provider-fake-v1",
    )
    second = service.apply_order_result(
        second_order["order_id"],
        _paid_result(second_order, reference=shared_reference),
        provider_profile_id="provider-fake-v1",
    )

    assert first["status"] == "applied"
    assert second == {
        "status": "review_required",
        "reason": "PAYMENT_TRANSACTION_ORDER_MISMATCH",
    }
    assert tuple(billing_cursor.execute(
        "SELECT payment_state, activation_state FROM billing_orders WHERE id = ?",
        (second_order["order_id"],),
    ).fetchone()) == ("unverified", "review_required")
    assert billing_cursor.execute(
        "SELECT COUNT(*) FROM payment_transactions WHERE provider_transaction_id = ?",
        (shared_reference,),
    ).fetchone()[0] == 1
    assert billing_cursor.execute(
        "SELECT COUNT(*) FROM organization_subscriptions WHERE source_order_id = ?",
        (second_order["order_id"],),
    ).fetchone()[0] == 0


def test_wrong_amount_is_reviewed_without_payment_fact_or_entitlement(billing_cursor):
    order = _insert_base_plan_order(billing_cursor)

    result = BillingActivationService(
        billing_cursor, clock=lambda: order["now"]
    ).apply_order_result(
        order["order_id"],
        _paid_result(order, amount=99999),
        provider_profile_id="provider-fake-v1",
    )

    assert result == {"status": "review_required", "reason": "PAYMENT_AMOUNT_MISMATCH"}
    assert billing_cursor.execute(
        "SELECT COUNT(*) FROM payment_transactions WHERE order_id = ?",
        (order["order_id"],),
    ).fetchone()[0] == 0
    assert billing_cursor.execute(
        "SELECT COUNT(*) FROM account_subscriptions WHERE user_id = ?",
        (order["user_id"],),
    ).fetchone()[0] == 0


@pytest.mark.parametrize(
    ("signed_overrides", "provider_overrides", "reason"),
    [
        ({"amount": 99999}, {}, "WEBHOOK_AMOUNT_MISMATCH"),
        (
            {},
            {"paymentLinkId": "different-link"},
            "PAYMENT_LINK_ID_MISMATCH",
        ),
    ],
)
def test_webhook_identity_mismatch_is_reviewed_before_activation(
    billing_cursor,
    signed_overrides,
    provider_overrides,
    reason,
):
    order = _insert_base_plan_order(billing_cursor)
    event_id = f"payment-event-{uuid.uuid4().hex}"
    signed = {
        "orderCode": order["order_code"],
        "amount": 100000,
        "paymentLinkId": f"link-{order['order_code']}",
        "reference": f"reference-{order['order_code']}",
        **signed_overrides,
    }
    billing_cursor.execute(
        """INSERT INTO payment_webhook_events
               (id, provider_profile_id, dedupe_key, payload_hash,
                signed_fields_json, status, available_at)
           VALUES (?, 'provider-fake-v1', ?, ?, ?, 'pending', ?)""",
        (
            event_id,
            f"dedupe-{uuid.uuid4().hex}",
            uuid.uuid4().hex * 2,
            json.dumps(signed, separators=(",", ":")),
            order["now"],
        ),
    )
    provider_result = {
        **_paid_result(order),
        "paymentLinkId": signed["paymentLinkId"],
        **provider_overrides,
    }

    result = BillingActivationService(
        billing_cursor, clock=lambda: order["now"]
    ).apply_verified(
        event_id,
        provider_result,
        provider_profile_id="provider-fake-v1",
    )

    assert result["status"] == "review_required"
    assert result["reason"] == reason
    assert billing_cursor.execute(
        "SELECT COUNT(*) FROM payment_transactions WHERE order_id = ?",
        (order["order_id"],),
    ).fetchone()[0] == 0


def test_late_payment_fact_is_preserved_but_sent_to_review(billing_cursor):
    now = 1_800_000_000
    order = _insert_base_plan_order(
        billing_cursor, now=now, checkout_expires_at=now - 10
    )

    result = BillingActivationService(
        billing_cursor, clock=lambda: now
    ).apply_order_result(
        order["order_id"],
        _paid_result(order, occurred_at=now),
        provider_profile_id="provider-fake-v1",
    )

    assert result == {
        "status": "review_required",
        "reason": "LATE_PAYMENT_REVIEW_REQUIRED",
    }
    transaction = billing_cursor.execute(
        """SELECT payment_timing, verified_paid_amount
             FROM payment_transactions WHERE order_id = ?""",
        (order["order_id"],),
    ).fetchone()
    assert tuple(transaction) == ("late_after_expiry", 100000)
    assert billing_cursor.execute(
        "SELECT COUNT(*) FROM account_subscriptions WHERE user_id = ?",
        (order["user_id"],),
    ).fetchone()[0] == 0


@pytest.mark.parametrize("owner_kind", ["account", "organization"])
def test_verified_credit_pack_increases_only_the_exact_owner_balance(
    billing_cursor,
    owner_kind,
):
    order = _insert_base_plan_order(
        billing_cursor,
        owner_kind=owner_kind,
        item_type="procurement_credit_pack",
    )
    service = BillingActivationService(billing_cursor, clock=lambda: order["now"])

    for _attempt in range(50):
        result = service.apply_order_result(
            order["order_id"],
            _paid_result(order),
            provider_profile_id="provider-fake-v1",
        )

    assert result["status"] == "applied"
    owner_column = (
        "account_user_id" if owner_kind == "account" else "organization_id"
    )
    owner_id = (
        order["user_id"]
        if owner_kind == "account"
        else order["organization_id"]
    )
    other_column = (
        "organization_id" if owner_kind == "account" else "account_user_id"
    )
    grant = billing_cursor.execute(
        f"""SELECT total, remaining, {other_column}
              FROM usage_credit_grants
             WHERE {owner_column} = ? AND source = 'purchase'""",  # noqa: S608 - columns are closed test constants
        (owner_id,),
    ).fetchone()
    assert tuple(grant) == (25, 25, None)
    assert billing_cursor.execute(
        "SELECT COUNT(*) FROM payment_transactions WHERE order_id = ?",
        (order["order_id"],),
    ).fetchone()[0] == 1
    assert billing_cursor.execute(
        "SELECT COUNT(*) FROM billing_subscription_activations WHERE order_id = ?",
        (order["order_id"],),
    ).fetchone()[0] == 1
    assert billing_cursor.execute(
        "SELECT COUNT(*) FROM billing_invoice_requests WHERE order_id = ?",
        (order["order_id"],),
    ).fetchone()[0] == 1


def test_verified_organization_base_plan_activates_only_the_organization(
    billing_cursor,
):
    order = _insert_base_plan_order(
        billing_cursor,
        owner_kind="organization",
    )

    result = BillingActivationService(
        billing_cursor,
        clock=lambda: order["now"],
    ).apply_order_result(
        order["order_id"],
        _paid_result(order),
        provider_profile_id="provider-fake-v1",
    )

    assert result["status"] == "applied"
    subscription = billing_cursor.execute(
        """SELECT source, source_order_id
             FROM organization_subscriptions WHERE organization_id = ?""",
        (order["organization_id"],),
    ).fetchone()
    assert tuple(subscription) == ("order", order["order_id"])
    assert billing_cursor.execute(
        """SELECT COUNT(*) FROM account_subscriptions
             WHERE source_order_id = ?""",
        (order["order_id"],),
    ).fetchone()[0] == 0
    grant = billing_cursor.execute(
        """SELECT total, account_user_id
             FROM usage_credit_grants
            WHERE organization_id = ? AND source = 'plan'""",
        (order["organization_id"],),
    ).fetchone()
    assert tuple(grant) == (3, None)


def test_fake_timeout_recovers_with_stable_command_and_activates_once(
    billing_cursor,
):
    order = _insert_base_plan_order(billing_cursor)
    billing_cursor.execute(
        """UPDATE billing_orders
              SET checkout_state = 'creating', checkout_url = NULL
            WHERE id = ?""",
        (order["order_id"],),
    )
    command_id = f"command-{uuid.uuid4().hex}"
    billing_cursor.execute(
        """INSERT INTO billing_provider_commands
               (id, order_id, command_type, provider_reference,
                request_json, status, available_at)
           VALUES (?, ?, 'create_checkout', ?, ?, 'pending', ?)""",
        (
            command_id,
            order["order_id"],
            f"provider-ref-{order['order_id']}",
            json.dumps({
                "orderCode": order["order_code"],
                "amount": 100000,
                "description": "FAKEE2E",
                "cancelUrl": "http://localhost/huy",
                "returnUrl": "http://localhost/ket-qua",
            }),
            order["now"],
        ),
    )
    fake = FakePaymentProvider(
        scenario="timeout",
        clock=lambda: order["now"],
        profile_id="provider-fake-v1",
    )
    database = _TransactionDatabase(billing_cursor)
    environment = {"PAYMENT_ACTIVATION_ENABLED": "true"}
    executor = ProviderCommandExecutor(
        database,
        providers={"provider-fake-v1": fake},
        clock=lambda: order["now"],
        environment=environment,
    )

    first = executor.execute(command_id)
    assert first["checkout_state"] == "creating"
    assert billing_cursor.execute(
        "SELECT status, attempt_count FROM billing_provider_commands WHERE id = ?",
        (command_id,),
    ).fetchone() == {"status": "retry", "attempt_count": 1}

    billing_cursor.execute(
        "UPDATE billing_provider_commands SET available_at = ? WHERE id = ?",
        (order["now"], command_id),
    )
    second = executor.execute(command_id)

    assert second["checkout_state"] == "open"
    assert second["payment_state"] == "verified_paid"
    assert second["activation_state"] == "applied"
    assert billing_cursor.execute(
        "SELECT COUNT(*) FROM payment_transactions WHERE order_id = ?",
        (order["order_id"],),
    ).fetchone()[0] == 1
    assert billing_cursor.execute(
        "SELECT COUNT(*) FROM usage_credit_grants WHERE account_user_id = ?",
        (order["user_id"],),
    ).fetchone()[0] == 1


def test_ambiguous_cancel_queries_before_repeating_the_mutation(billing_cursor):
    order = _insert_base_plan_order(billing_cursor)
    command_id = f"command-{uuid.uuid4().hex}"
    billing_cursor.execute(
        """INSERT INTO billing_provider_commands
               (id, order_id, command_type, provider_reference,
                request_json, status, available_at)
           VALUES (?, ?, 'cancel_checkout', ?, ?, 'pending', ?)""",
        (
            command_id,
            order["order_id"],
            f"cancel-{order['order_id']}",
            json.dumps(
                {
                    "identifier": order["order_code"],
                    "reason": "Người mua hủy",
                },
                separators=(",", ":"),
            ),
            order["now"],
        ),
    )

    class AmbiguousCancelProvider:
        cancel_calls = 0
        get_calls = 0

        def cancel_payment(self, identifier, _reason=None):
            self.cancel_calls += 1
            raise PaymentProviderError(
                "PROVIDER_TRANSPORT_FAILED",
                "ambiguous cancel",
                outcome_unknown=True,
                retryable=True,
            )

        def get_payment(self, identifier):
            self.get_calls += 1
            return {
                "id": f"link-{identifier}",
                "paymentLinkId": f"link-{identifier}",
                "orderCode": int(identifier),
                "amount": 100000,
                "amountPaid": 0,
                "amountRemaining": 100000,
                "status": "CANCELLED",
                "transactions": [],
            }

    provider = AmbiguousCancelProvider()
    executor = ProviderCommandExecutor(
        _TransactionDatabase(billing_cursor),
        providers={"provider-fake-v1": provider},
        clock=lambda: order["now"],
    )

    first = executor.execute(command_id)
    assert first["checkout_state"] == "open"
    billing_cursor.execute(
        "UPDATE billing_provider_commands SET available_at = ? WHERE id = ?",
        (order["now"], command_id),
    )
    second = executor.execute(command_id)

    assert second["checkout_state"] == "cancelled"
    assert provider.cancel_calls == 1
    assert provider.get_calls == 1


def test_paid_provider_result_stays_retryable_when_activation_transaction_fails(
    billing_cursor,
    monkeypatch,
):
    order = _insert_base_plan_order(billing_cursor)
    billing_cursor.execute(
        "UPDATE billing_orders SET checkout_state = 'creating' WHERE id = ?",
        (order["order_id"],),
    )
    command_id = f"command-{uuid.uuid4().hex}"
    billing_cursor.execute(
        """INSERT INTO billing_provider_commands
               (id, order_id, command_type, provider_reference,
                request_json, status, available_at)
           VALUES (?, ?, 'query_order', ?, '{}', 'pending', ?)""",
        (
            command_id,
            order["order_id"],
            f"provider-ref-{order['order_id']}",
            order["now"],
        ),
    )

    class PaidProvider:
        def get_payment(self, _identifier):
            return _paid_result(order)

    original_apply = BillingActivationService.apply_order_result
    calls = {"count": 0}

    def fail_once(self, *args, **kwargs):
        calls["count"] += 1
        if calls["count"] == 1:
            raise RuntimeError("simulated activation database failure")
        return original_apply(self, *args, **kwargs)

    monkeypatch.setattr(BillingActivationService, "apply_order_result", fail_once)
    database = _TransactionDatabase(billing_cursor)
    executor = ProviderCommandExecutor(
        database,
        providers={"provider-fake-v1": PaidProvider()},
        clock=lambda: order["now"],
        environment={"PAYMENT_ACTIVATION_ENABLED": "true"},
    )

    first = executor.execute(command_id)
    assert first["activation_state"] == "not_ready"
    assert billing_cursor.execute(
        "SELECT status, attempt_count FROM billing_provider_commands WHERE id = ?",
        (command_id,),
    ).fetchone() == {"status": "retry", "attempt_count": 1}
    assert billing_cursor.execute(
        "SELECT COUNT(*) FROM payment_transactions WHERE order_id = ?",
        (order["order_id"],),
    ).fetchone()[0] == 0

    billing_cursor.execute(
        "UPDATE billing_provider_commands SET available_at = ? WHERE id = ?",
        (order["now"], command_id),
    )
    second = executor.execute(command_id)
    assert second["activation_state"] == "applied"
    assert billing_cursor.execute(
        "SELECT status FROM billing_provider_commands WHERE id = ?",
        (command_id,),
    ).fetchone()[0] == "completed"
    assert billing_cursor.execute(
        "SELECT COUNT(*) FROM payment_transactions WHERE order_id = ?",
        (order["order_id"],),
    ).fetchone()[0] == 1


def test_manual_refund_replay_survives_terminal_refund_state_and_binds_request(
    billing_cursor,
):
    order = _insert_base_plan_order(billing_cursor)
    BillingActivationService(
        billing_cursor, clock=lambda: order["now"]
    ).apply_order_result(
        order["order_id"],
        _paid_result(order),
        provider_profile_id="provider-fake-v1",
    )
    service = BillingService(billing_cursor, clock=lambda: order["now"])
    created, replayed = service.create_manual_refund_intent(
        f"order-public-{order['order_id'].removeprefix('order-test-')}",
        order["user_id"],
        100000,
        "Hoàn toàn bộ",
        "refund-request-123",
    )
    assert replayed is False
    billing_cursor.execute(
        "UPDATE billing_refund_intents SET state = 'succeeded' WHERE id = ?",
        (created["id"],),
    )
    billing_cursor.execute(
        "UPDATE billing_orders SET payment_state = 'refunded' WHERE id = ?",
        (order["order_id"],),
    )

    replay, replayed = service.create_manual_refund_intent(
        f"order-public-{order['order_id'].removeprefix('order-test-')}",
        order["user_id"],
        100000,
        "Hoàn toàn bộ",
        "refund-request-123",
    )
    assert replayed is True
    assert replay["id"] == created["id"]
    with pytest.raises(Exception) as error:
        service.create_manual_refund_intent(
            f"order-public-{order['order_id'].removeprefix('order-test-')}",
            order["user_id"],
            99999,
            "Hoàn khác",
            "refund-request-123",
        )
    assert getattr(error.value, "code", None) == "IDEMPOTENCY_KEY_REUSED"


def test_same_webhook_identity_with_changed_payload_is_held_for_review(
    billing_cursor,
    monkeypatch,
):
    database = _TransactionDatabase(billing_cursor)
    registry = PaymentProviderRegistry(environment={})
    registry.install(
        "provider-fake-v1",
        FakePaymentProvider(profile_id="provider-fake-v1"),
    )
    monkeypatch.setattr(billing_webhook, "database", database)
    monkeypatch.setattr(billing_webhook, "payment_provider_registry", lambda: registry)
    identity = {
        "orderCode": 987654,
        "amount": 100000,
        "paymentLinkId": "fake-link-987654",
        "reference": "FAKE-987654",
    }

    first = asyncio.run(billing_webhook.payment_webhook_api(
        _WebhookRequest(
            "provider-fake-v1",
            {"provider": "fake", "data": {**identity, "status": "PENDING"}},
        )
    ))
    changed = asyncio.run(billing_webhook.payment_webhook_api(
        _WebhookRequest(
            "provider-fake-v1",
            {"provider": "fake", "data": {**identity, "status": "PAID"}},
        )
    ))

    assert first.status_code == changed.status_code == 202
    assert json.loads(first.body)["reviewRequired"] is False
    assert json.loads(changed.body)["reviewRequired"] is True
    rows = billing_cursor.execute(
        """SELECT status, last_error_code FROM payment_webhook_events
            WHERE provider_profile_id = 'provider-fake-v1'
              AND dedupe_key = '987654|fake-link-987654|FAKE-987654'
            ORDER BY created_at, id"""
    ).fetchall()
    assert {tuple(row) for row in rows} == {
        ("pending", None),
        ("review", "WEBHOOK_DEDUPE_PAYLOAD_MISMATCH"),
    }
