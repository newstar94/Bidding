import json
import os
from pathlib import Path
import uuid
import asyncio
import time
import threading
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import psycopg
from psycopg import sql
import pytest

from backend.billing.activation import BillingActivationService
from backend.billing.providers.base import PaymentProviderError
from backend.billing.providers.fake import FakePaymentProvider
from backend.billing.providers.payos import PayOSCredentials, PayOSPaymentProvider, sign_signed_data
from backend.billing.runtime import PaymentProviderRegistry
from backend.billing.service import BillingService, ProviderCommandExecutor
from backend.billing import service as billing_service_module
from backend.billing.worker import BillingWorkProcessor
from backend.billing import webhook as billing_webhook
from backend.db.db_helper import PostgresCursor, PostgresDatabase
from backend.auth.auth_helper import SessionRole, verify_session_in_transaction
from backend.auth.session_store import create_session, set_session_active_role
from backend.commercial_policy.errors import CommercialPolicyError
from backend.shared.membership_invariants import lock_organization_membership_invariants
from backend.billing.authorization import authorize_organization_buyer


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
    create_order=True,
    actor_user_id=None,
    period="yearly",
    monthly_term=None,
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
    if not actor and not actor_user_id:
        pytest.skip("Test database has no active account without a subscription")
    user_id = actor_user_id or actor[0]
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
           VALUES (?, ?, ?, ?, 100000, 0, 100000, ?)""",
        (price_id, release_id, sku_id, period, now - 100),
    )
    decision_payload = {
            "itemType": item_type,
            "skuCode": f"test-sku-{token}",
            "releaseChecksum": release_checksum,
            "price": {"period": period},
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
    if monthly_term is not None:
        decision_payload["policySnapshot"]["monthlyBaseTerm"] = monthly_term
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
    if not create_order:
        return {
            "public_quote": public_quote,
            "user_id": user_id,
            "organization_id": organization_id,
            "owner_kind": owner_kind,
            "item_type": item_type,
            "now": now,
        }
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
        "public_quote": public_quote,
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


def test_payos_paid_get_transaction_evidence_activates_exactly_once(billing_cursor):
    occurred_at = 1_791_411_241
    order = _insert_base_plan_order(billing_cursor, now=occurred_at - 30)
    reference = f"bank-reference-{uuid.uuid4().hex}"
    data = {
        "id": f"payos-link-{order['order_id']}", "orderCode": order["order_code"],
        "amount": 100000, "amountPaid": 100000, "amountRemaining": 0,
        "status": "PAID", "createdAt": "2026-10-08T05:13:31+07:00",
        "transactions": [{
            "amount": 100000, "reference": reference,
            "transactionDateTime": "2026-10-08T05:14:01+07:00",
            "counterAccountBankName": None, "virtualAccountName": None,
            "virtualAccountNumber": None,
        }], "canceledAt": None, "cancellationReason": None,
    }
    provider = PayOSPaymentProvider(
        PayOSCredentials("client", "api", "fixture-checksum"),
        transport=lambda *_args: (200, json.dumps({
            "code": "00", "data": data,
            "signature": sign_signed_data(data, "fixture-checksum"),
        }).encode()),
    )
    result = provider.get_payment(order["order_code"])
    service = BillingActivationService(billing_cursor, clock=lambda: occurred_at + 10)
    first = service.apply_order_result(order["order_id"], result, provider_profile_id="provider-fake-v1")
    second = service.apply_order_result(order["order_id"], result, provider_profile_id="provider-fake-v1")
    assert first["status"] == second["status"] == "applied"
    payment = billing_cursor.execute("SELECT provider_transaction_id, provider_occurred_at FROM payment_transactions WHERE order_id=?", (order["order_id"],)).fetchall()
    assert [tuple(row) for row in payment] == [(reference, occurred_at)]
    assert billing_cursor.execute("SELECT COUNT(*) FROM billing_subscription_activations WHERE order_id=?", (order["order_id"],)).fetchone()[0] == 1
    assert billing_cursor.execute("SELECT COUNT(*) FROM usage_credit_grants WHERE account_user_id=?", (order["user_id"],)).fetchone()[0] == 1


@pytest.mark.parametrize("owner_kind", ["account", "organization"])
def test_monthly_plan_uses_its_configured_duration_and_grant_expiry(billing_cursor, owner_kind):
    order = _insert_base_plan_order(billing_cursor, owner_kind=owner_kind, period="monthly",
                                    monthly_term={"kind": "fixed_days", "days": 31})
    service = BillingActivationService(billing_cursor, clock=lambda: order["now"])
    result = service.apply_order_result(order["order_id"], _paid_result(order), provider_profile_id="provider-fake-v1")
    assert result["status"] == "applied"
    if owner_kind == "account":
        row = billing_cursor.execute("SELECT expires_at FROM account_subscriptions WHERE user_id = ?", (order["user_id"],)).fetchone()
    else:
        row = billing_cursor.execute("SELECT expires_at FROM organization_subscriptions WHERE organization_id = ?", (order["organization_id"],)).fetchone()
    expected_expiry = order["now"] + 31 * 86400
    assert row[0] == expected_expiry
    grant = billing_cursor.execute("SELECT expires_at FROM usage_credit_grants WHERE order_item_id IN (SELECT id FROM billing_order_items WHERE order_id = ?)", (order["order_id"],)).fetchone()
    assert grant[0] == expected_expiry
    replay = service.apply_order_result(order["order_id"], _paid_result(order), provider_profile_id="provider-fake-v1")
    assert replay["status"] == "applied"


def test_monthly_plan_missing_term_never_falls_back_to_annual_duration(billing_cursor):
    order = _insert_base_plan_order(billing_cursor, period="monthly")
    service = BillingActivationService(billing_cursor, clock=lambda: order["now"])
    result = service.apply_order_result(order["order_id"], _paid_result(order), provider_profile_id="provider-fake-v1")
    assert result["status"] == "review_required"
    assert billing_cursor.execute("SELECT COUNT(*) FROM account_subscriptions WHERE source_order_id = ?", (order["order_id"],)).fetchone()[0] == 0


def _prepare_renewal(cursor, order, *, remaining_days=10):
    item = cursor.execute(
        "SELECT plan_version_id, snapshot_json FROM billing_order_items WHERE order_id = ?",
        (order["order_id"],),
    ).fetchone()
    snapshot = json.loads(item[1])
    snapshot["policySnapshot"]["baseTerm"] = {"kind": "fixed_days", "days": 365}
    snapshot["policySnapshot"]["renewalAnchor"] = {"kind": "end_of_term"}
    encoded = json.dumps(snapshot)
    cursor.execute("UPDATE billing_order_items SET snapshot_json = ? WHERE order_id = ?", (encoded, order["order_id"]))
    cursor.execute("UPDATE billing_orders SET operation = 'renew', decision_json = ?, expected_subscription_revision = 7 WHERE id = ?", (encoded, order["order_id"]))
    start = order["now"] - 100 * 86400
    end = order["now"] + remaining_days * 86400
    if order["owner_kind"] == "account":
        cursor.execute(
            """INSERT INTO account_subscriptions (user_id, package_id, plan_version_id, status, starts_at, expires_at, revision)
               VALUES (?, 'diamond', ?, 'active', ?, ?, 7)""",
            (order["user_id"], item[0], start, end),
        )
    else:
        cursor.execute(
            """INSERT INTO organization_subscriptions (organization_id, package_id, plan_version_id, status, starts_at, expires_at, member_quota, revision)
               VALUES (?, 'diamond', ?, 'active', ?, ?, 50, 7)""",
            (order["organization_id"], item[0], start, end),
        )
    return start, end


@pytest.mark.parametrize("owner_kind", ["account", "organization"])
def test_early_renewal_preserves_current_term_then_activates_exactly_once(billing_cursor, owner_kind):
    order = _insert_base_plan_order(billing_cursor, owner_kind=owner_kind)
    start, end = _prepare_renewal(billing_cursor, order)
    service = BillingActivationService(billing_cursor, clock=lambda: order["now"])
    first = service.apply_order_result(order["order_id"], _paid_result(order), provider_profile_id="provider-fake-v1")
    replay = service.apply_order_result(order["order_id"], _paid_result(order), provider_profile_id="provider-fake-v1")
    assert first["status"] == replay["status"] == "scheduled"
    assert first["startsAt"] == end
    assert first["expiresAt"] == end + 365 * 86400
    subscription_query = (
        "SELECT starts_at, expires_at, revision FROM account_subscriptions WHERE user_id = ?"
        if owner_kind == "account" else
        "SELECT starts_at, expires_at, revision FROM organization_subscriptions WHERE organization_id = ?"
    )
    owner_id = order["user_id"] if owner_kind == "account" else order["organization_id"]
    current = billing_cursor.execute(subscription_query, (owner_id,)).fetchone()
    assert tuple(current) == (start, end, 7)
    assert billing_cursor.execute("SELECT COUNT(*) FROM usage_credit_grants WHERE order_item_id IN (SELECT id FROM billing_order_items WHERE order_id = ?)", (order["order_id"],)).fetchone()[0] == 0
    worker = BillingWorkProcessor(_TransactionDatabase(billing_cursor), clock=lambda: end - 1)
    assert worker._next_paid_not_applied_order_id() != order["order_id"]
    worker.clock = lambda: end + 60
    assert worker._next_paid_not_applied_order_id() == order["order_id"]
    worker._retry_activation(order["order_id"])
    applied = BillingActivationService(billing_cursor, clock=lambda: end + 60).activate_order(order["order_id"])
    assert applied["status"] == "applied"
    current = billing_cursor.execute(subscription_query, (owner_id,)).fetchone()
    assert tuple(current) == (end, end + 365 * 86400, 8)
    grant = billing_cursor.execute("SELECT issued_at, expires_at FROM usage_credit_grants WHERE order_item_id IN (SELECT id FROM billing_order_items WHERE order_id = ?)", (order["order_id"],)).fetchall()
    assert [tuple(row) for row in grant] == [(end, end + 365 * 86400)]


@pytest.mark.parametrize("trigger, early_count, due_count", [("verified_payment", 1, 1), ("activation_applied", 0, 1), ("manual", 0, 0), ("disabled", 0, 0)])
def test_renewal_invoice_request_obeys_pinned_trigger(billing_cursor, trigger, early_count, due_count):
    order = _insert_base_plan_order(billing_cursor)
    _, end = _prepare_renewal(billing_cursor, order)
    decision = json.loads(billing_cursor.execute("SELECT decision_json FROM billing_orders WHERE id = ?", (order["order_id"],)).fetchone()[0])
    decision["taxInvoiceSnapshot"] = {"invoiceTrigger": trigger}
    billing_cursor.execute("UPDATE billing_orders SET decision_json = ? WHERE id = ?", (json.dumps(decision), order["order_id"]))
    service = BillingActivationService(billing_cursor, clock=lambda: order["now"])
    assert service.apply_order_result(order["order_id"], _paid_result(order), provider_profile_id="provider-fake-v1")["status"] == "scheduled"
    assert billing_cursor.execute("SELECT COUNT(*) FROM billing_invoice_requests WHERE order_id = ?", (order["order_id"],)).fetchone()[0] == early_count
    due = BillingActivationService(billing_cursor, clock=lambda: end)
    assert due.activate_order(order["order_id"])["status"] == "applied"
    assert due.activate_order(order["order_id"])["status"] == "applied"
    assert billing_cursor.execute("SELECT COUNT(*) FROM billing_invoice_requests WHERE order_id = ?", (order["order_id"],)).fetchone()[0] == due_count
    assert billing_cursor.execute("SELECT COUNT(*) FROM commercial_outbox WHERE aggregate_id = ? AND event_type = 'billing.invoice_requested'", (order["order_id"],)).fetchone()[0] == due_count


@pytest.mark.parametrize("intervening_change", [False, True])
def test_multiple_paid_renewals_queue_in_order_and_bind_the_preceding_term(billing_cursor, intervening_change):
    first = _insert_base_plan_order(billing_cursor)
    _, end = _prepare_renewal(billing_cursor, first)
    service = BillingActivationService(billing_cursor, clock=lambda: first["now"])
    assert service.apply_order_result(first["order_id"], _paid_result(first), provider_profile_id="provider-fake-v1")["status"] == "scheduled"
    second = _insert_base_plan_order(billing_cursor, actor_user_id=first["user_id"])
    item = billing_cursor.execute("SELECT plan_version_id, snapshot_json FROM billing_order_items WHERE order_id = ?", (first["order_id"],)).fetchone()
    billing_cursor.execute("UPDATE billing_order_items SET plan_version_id = ?, snapshot_json = ? WHERE order_id = ?", (item[0], item[1], second["order_id"]))
    billing_cursor.execute("UPDATE billing_orders SET operation = 'renew', decision_json = ?, expected_subscription_revision = 7 WHERE id = ?", (item[1], second["order_id"]))
    outcome = service.apply_order_result(second["order_id"], _paid_result(second), provider_profile_id="provider-fake-v1")
    assert outcome["status"] == "scheduled"
    assert outcome["startsAt"] == end + 365 * 86400
    assert outcome["expiresAt"] == end + 730 * 86400
    if intervening_change:
        billing_cursor.execute("UPDATE account_subscriptions SET revision = 8, source = 'admin' WHERE user_id = ?", (first["user_id"],))
        assert BillingActivationService(billing_cursor, clock=lambda: end).activate_order(first["order_id"])["reason"] == "SUBSCRIPTION_REVISION_MISMATCH"
        rejected = BillingActivationService(billing_cursor, clock=lambda: end + 365 * 86400).activate_order(second["order_id"])
        assert rejected["reason"] == "RENEWAL_PREDECESSOR_MISMATCH"
    else:
        assert BillingActivationService(billing_cursor, clock=lambda: end).activate_order(first["order_id"])["status"] == "applied"
        assert BillingActivationService(billing_cursor, clock=lambda: end + 365 * 86400).activate_order(second["order_id"])["status"] == "applied"
        assert billing_cursor.execute("SELECT expires_at, revision FROM account_subscriptions WHERE user_id = ?", (first["user_id"],)).fetchone()[0] == end + 730 * 86400


def test_pending_refund_intent_prevents_scheduled_term_activation_and_payment_replay(billing_cursor):
    order = _insert_base_plan_order(billing_cursor)
    _, end = _prepare_renewal(billing_cursor, order)
    service = BillingActivationService(billing_cursor, clock=lambda: order["now"])
    assert service.apply_order_result(order["order_id"], _paid_result(order), provider_profile_id="provider-fake-v1")["status"] == "scheduled"
    public_id = f"order-public-{order['order_id'].removeprefix('order-test-')}"
    intent, _ = BillingService(billing_cursor).create_manual_refund_intent(public_id, order["user_id"], 100000, "Hoàn kỳ chưa bắt đầu", "refund-renewal-123")
    worker = BillingWorkProcessor(_TransactionDatabase(billing_cursor), clock=lambda: end)
    assert worker._next_paid_not_applied_order_id() != order["order_id"]
    due = BillingActivationService(billing_cursor, clock=lambda: end)
    assert due.activate_order(order["order_id"])["reason"] == "PAYMENT_REFUND_REVIEW_REQUIRED"
    billing_cursor.execute("UPDATE billing_refund_intents SET state = 'succeeded' WHERE id = ?", (intent["id"],))
    billing_cursor.execute("UPDATE billing_orders SET payment_state = 'refunded', activation_state = 'reversed' WHERE id = ?", (order["order_id"],))
    assert due.apply_order_result(order["order_id"], _paid_result(order), provider_profile_id="provider-fake-v1")["status"] == "reversed"
    assert tuple(billing_cursor.execute("SELECT payment_state, activation_state FROM billing_orders WHERE id = ?", (order["order_id"],)).fetchone()) == ("refunded", "reversed")
    assert billing_cursor.execute("SELECT COUNT(*) FROM usage_credit_grants WHERE order_item_id IN (SELECT id FROM billing_order_items WHERE order_id = ?)", (order["order_id"],)).fetchone()[0] == 0


def test_activation_retry_requests_invoice_after_owner_is_restored(billing_cursor):
    order = _insert_base_plan_order(billing_cursor, owner_kind="organization")
    decision = json.loads(billing_cursor.execute("SELECT decision_json FROM billing_orders WHERE id = ?", (order["order_id"],)).fetchone()[0])
    decision["taxInvoiceSnapshot"] = {"invoiceTrigger": "activation_applied"}
    billing_cursor.execute("UPDATE billing_orders SET decision_json = ? WHERE id = ?", (json.dumps(decision), order["order_id"]))
    billing_cursor.execute("UPDATE to_chuc SET trang_thai = 'suspended' WHERE id = ?", (order["organization_id"],))
    service = BillingActivationService(billing_cursor, clock=lambda: order["now"])
    assert service.apply_order_result(order["order_id"], _paid_result(order), provider_profile_id="provider-fake-v1")["reason"] == "OWNER_INACTIVE"
    assert billing_cursor.execute("SELECT COUNT(*) FROM billing_invoice_requests WHERE order_id = ?", (order["order_id"],)).fetchone()[0] == 0
    billing_cursor.execute("UPDATE to_chuc SET trang_thai = 'active' WHERE id = ?", (order["organization_id"],))
    assert service.activate_order(order["order_id"])["status"] == "applied"
    assert service.activate_order(order["order_id"])["status"] == "applied"
    assert billing_cursor.execute("SELECT COUNT(*) FROM billing_invoice_requests WHERE order_id = ?", (order["order_id"],)).fetchone()[0] == 1


@pytest.mark.parametrize("stored_status", ["active", "expired"])
def test_renewal_after_expiry_starts_at_verified_payment_not_delayed_processing(billing_cursor, stored_status):
    order = _insert_base_plan_order(billing_cursor)
    _prepare_renewal(billing_cursor, order, remaining_days=-5)
    billing_cursor.execute("UPDATE account_subscriptions SET status = ? WHERE user_id = ?", (stored_status, order["user_id"]))
    result = BillingActivationService(billing_cursor, clock=lambda: order["now"] + 2 * 86400).apply_order_result(order["order_id"], _paid_result(order), provider_profile_id="provider-fake-v1")
    assert result["status"] == "applied"
    assert tuple(billing_cursor.execute("SELECT starts_at, expires_at FROM account_subscriptions WHERE user_id = ?", (order["user_id"],)).fetchone()) == (order["now"], order["now"] + 365 * 86400)


@pytest.mark.parametrize("enabled, count", [(False, 0), (True, 1)])
def test_invoice_enable_switch_controls_requests_without_changing_paid_benefits(billing_cursor, enabled, count):
    order = _insert_base_plan_order(billing_cursor)
    decision = json.loads(billing_cursor.execute("SELECT decision_json FROM billing_orders WHERE id = ?", (order["order_id"],)).fetchone()[0])
    decision["taxInvoiceSnapshot"] = {"taxInclusive": True, "invoiceEnabled": enabled, "invoiceTrigger": "verified_payment"}
    billing_cursor.execute("UPDATE billing_orders SET decision_json = ? WHERE id = ?", (json.dumps(decision), order["order_id"]))
    service = BillingActivationService(billing_cursor, clock=lambda: order["now"])
    assert service.apply_order_result(order["order_id"], _paid_result(order), provider_profile_id="provider-fake-v1")["status"] == "applied"
    assert service.apply_order_result(order["order_id"], _paid_result(order), provider_profile_id="provider-fake-v1")["status"] == "applied"
    assert billing_cursor.execute("SELECT COUNT(*) FROM billing_invoice_requests WHERE order_id = ?", (order["order_id"],)).fetchone()[0] == count
    assert billing_cursor.execute("SELECT COUNT(*) FROM usage_credit_grants WHERE order_item_id IN (SELECT id FROM billing_order_items WHERE order_id = ?)", (order["order_id"],)).fetchone()[0] == 1


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


@pytest.mark.parametrize("stale_outcome", ["complete", "fail"])
def test_reclaimed_provider_command_rejects_old_callback_from_same_worker(
    billing_cursor, stale_outcome,
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
           VALUES (?, ?, 'create_checkout', ?, '{}', 'pending', ?)""",
        (command_id, order["order_id"], f"lease-{order['order_id']}", order["now"]),
    )
    executor = ProviderCommandExecutor(
        _TransactionDatabase(billing_cursor), worker_id="same-process-worker",
        clock=lambda: order["now"], environment={},
    )
    stale = executor._claim(command_id)
    assert stale is not None
    billing_cursor.execute(
        "UPDATE billing_provider_commands SET lease_expires_at = ? WHERE id = ?",
        (order["now"] - 1, command_id),
    )
    current = executor._claim(command_id)
    assert current is not None
    result = {
        "status": "PENDING", "orderCode": order["order_code"],
        "amount": 100000, "checkoutUrl": "https://example.test/current-checkout",
    }
    if stale_outcome == "complete":
        executor._complete(stale, result)
    else:
        executor._fail(stale, PaymentProviderError(
            "PROVIDER_TRANSPORT_FAILED", "old callback", retryable=True,
        ))
    assert billing_cursor.execute(
        "SELECT status, attempt_count FROM billing_provider_commands WHERE id = ?",
        (command_id,),
    ).fetchone() == {"status": "processing", "attempt_count": 2}
    assert billing_cursor.execute(
        "SELECT checkout_state FROM billing_orders WHERE id = ?", (order["order_id"],),
    ).fetchone()[0] == "creating"

    executor._complete(current, result)
    assert billing_cursor.execute(
        "SELECT status FROM billing_provider_commands WHERE id = ?", (command_id,),
    ).fetchone()[0] == "completed"


def test_checkout_retries_provider_order_code_collision_and_pins_expiry(
    billing_cursor,
    monkeypatch,
):
    existing = _insert_base_plan_order(billing_cursor)
    pending = _insert_base_plan_order(billing_cursor, create_order=False)
    second_code = existing["order_code"] + 1
    while billing_cursor.execute(
        """SELECT 1 FROM billing_orders
             WHERE provider_profile_id = 'provider-fake-v1'
               AND provider_order_code = ?""",
        (second_code,),
    ).fetchone():
        second_code += 1
    generated = iter([existing["order_code"], second_code])
    monkeypatch.setattr(
        billing_service_module,
        "_stable_order_code",
        lambda _order_id, _attempt=0: next(generated),
    )
    actor = SimpleNamespace(
        user_id=pending["user_id"],
        active_role="employee",
        active_role_organization_id=None,
        platform_role="user",
    )

    order, command_id, replayed = BillingService(
        billing_cursor,
        clock=lambda: pending["now"],
        environment={
            "APP_ENV": "development",
            "COMMERCIAL_PAYMENT_PROVIDER": "fake",
            "PAYMENT_PROVIDER_ENVIRONMENT": "test",
            "APP_PUBLIC_URL": "https://app.example",
        },
    ).create_checkout(actor, pending["public_quote"], "collision-retry-123")

    assert replayed is False
    assert command_id
    assert order["provider_order_code"] == second_code
    request = json.loads(billing_cursor.execute(
        "SELECT request_json FROM billing_provider_commands WHERE id = ?",
        (command_id,),
    ).fetchone()[0])
    assert request["expiredAt"] == order["checkout_expires_at"]
    assert request["expiredAt"] > pending["now"]


@pytest.mark.parametrize("change", ["left", "employee"])
def test_checkout_rejects_membership_revoked_after_role_selection(billing_cursor, change):
    token = uuid.uuid4().hex
    user_id = f"buyer-{token}"
    billing_cursor.execute(
        """INSERT INTO tai_khoan (id, ten_dang_nhap, email, email_norm, mat_khau, vai_tro, trang_thai)
           VALUES (?, ?, ?, ?, 'unused-test-password', 'user', 'active')""",
        (user_id, user_id, f"{user_id}@example.test", f"{user_id}@example.test"),
    )
    pending = _insert_base_plan_order(
        billing_cursor, owner_kind="organization", create_order=False,
        actor_user_id=user_id,
    )
    billing_cursor.execute(
        """INSERT INTO thanh_vien_to_chuc
           (user_id, organization_id, vai_tro_trong_to_chuc)
           VALUES (?, ?, 'manager')""",
        (user_id, pending["organization_id"]),
    )
    now = int(time.time())
    session_id = create_session(
        billing_cursor, user_id=user_id, token=token,
        absolute_expires_at=now + 600, idle_timeout_seconds=600, now=now,
    )
    set_session_active_role(
        billing_cursor, session_id, user_id, "manager", pending["organization_id"],
    )
    request = SimpleNamespace(
        cookies={"session_token": token},
        headers={"X-Active-Org": pending["organization_id"]},
    )
    valid, initial_actor = verify_session_in_transaction(billing_cursor, request)
    assert valid and initial_actor.active_role == "manager"
    lock_organization_membership_invariants(billing_cursor, pending["organization_id"])
    if change == "left":
        statement = "UPDATE thanh_vien_to_chuc SET trang_thai_thanh_vien = ? WHERE user_id = ? AND organization_id = ?"
    else:
        statement = "UPDATE thanh_vien_to_chuc SET vai_tro_trong_to_chuc = ? WHERE user_id = ? AND organization_id = ?"
    billing_cursor.execute(statement, (change, user_id, pending["organization_id"]))
    valid, actor = verify_session_in_transaction(billing_cursor, request)
    assert valid and actor.active_role == "manager"  # persisted selection is stale
    with pytest.raises(CommercialPolicyError) as error:
        BillingService(billing_cursor, clock=lambda: pending["now"]).create_checkout(
            actor, pending["public_quote"], f"authority-{token}",
        )
    assert error.value.code == "BUYER_NOT_AUTHORIZED"
    assert billing_cursor.execute(
        "SELECT count(*) FROM billing_orders WHERE quote_id = (SELECT id FROM billing_quotes WHERE public_id = ?)",
        (pending["public_quote"],),
    ).fetchone()[0] == 0


def test_billing_owner_lock_serializes_with_membership_change(billing_cursor):
    membership = billing_cursor.execute(
        """SELECT membership.user_id, membership.organization_id
             FROM thanh_vien_to_chuc AS membership
             JOIN to_chuc AS organization ON organization.id = membership.organization_id
            WHERE membership.vai_tro_trong_to_chuc = 'manager'
              AND membership.trang_thai_thanh_vien = 'active'
              AND organization.trang_thai = 'active'
            LIMIT 1"""
    ).fetchone()
    assert membership, "Test database must contain an active organization manager"
    actor = SessionRole(
        "manager", membership[0], platform_role="user", active_role="manager",
        active_role_organization_id=membership[1],
    )
    BillingService(billing_cursor)._lock_and_authorize_owner(
        actor, {"owner_kind": "organization", "organization_id": membership[1]},
    )
    database = PostgresDatabase(_test_database_url())
    connection = database.get_connection()
    try:
        connection.execute("BEGIN")
        connection.execute("SET LOCAL lock_timeout = '200ms'")
        with pytest.raises(psycopg.errors.LockNotAvailable):
            lock_organization_membership_invariants(connection.cursor(), membership[1])
    finally:
        connection.rollback()
        connection.close()
        database.close()


@pytest.mark.parametrize("owner_kind", ["account", "organization"])
def test_activation_serializes_owner_before_order_across_connections(owner_kind):
    database_url = _test_database_url()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is required for billing lock integration")
    database = PostgresDatabase(database_url)
    seed = database.get_connection()
    schema = f"billing_lock_test_{uuid.uuid4().hex}"
    order_read = threading.Event()

    def schema_connection():
        connection = database.get_connection()
        connection.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(schema)))
        connection.commit()
        return connection

    try:
        seed.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
        for table in (
            "tai_khoan", "to_chuc", "commercial_releases",
            "billing_plan_versions", "billing_skus", "billing_prices",
            "billing_quotes", "billing_orders", "billing_order_items",
            "billing_subscription_activations", "account_subscriptions",
            "organization_subscriptions", "usage_credit_grants", "usage_ledger",
            "payment_transactions", "billing_refund_intents", "billing_invoice_requests", "commercial_outbox",
            "audit_log", "audit_chain_heads",
        ):
            seed.execute(sql.SQL(
                "CREATE TABLE {}.{} (LIKE public.{} INCLUDING ALL)"
            ).format(sql.Identifier(schema), sql.Identifier(table), sql.Identifier(table)))
        for table in ("tai_khoan", "commercial_releases"):
            seed.execute(sql.SQL("INSERT INTO {}.{} SELECT * FROM public.{}").format(
                sql.Identifier(schema), sql.Identifier(table), sql.Identifier(table),
            ))
        seed.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(schema)))
        order = _insert_base_plan_order(seed.cursor(), owner_kind=owner_kind)
        seed.commit()
        owner_table = "tai_khoan" if owner_kind == "account" else "to_chuc"
        owner_id = order["user_id"] if owner_kind == "account" else order["organization_id"]

        class ObservedCursor:
            def __init__(self, cursor):
                self.cursor = cursor

            def execute(self, statement, parameters=()):
                result = self.cursor.execute(statement, parameters)
                if statement.lstrip().startswith("SELECT") and "FROM billing_orders" in statement:
                    order_read.set()
                return result

        def activate():
            connection = schema_connection()
            try:
                connection.execute("BEGIN")
                connection.execute("SET LOCAL deadlock_timeout = '100ms'")
                connection.execute("SET LOCAL lock_timeout = '2s'")
                return BillingActivationService(
                    ObservedCursor(connection.cursor()), clock=lambda: order["now"]
                ).apply_order_result(
                    order["order_id"], _paid_result(order),
                    provider_profile_id="provider-fake-v1",
                )
            finally:
                connection.rollback()
                connection.close()

        owner_transaction = schema_connection()
        try:
            owner_transaction.execute("BEGIN")
            owner_transaction.execute("SET LOCAL deadlock_timeout = '100ms'")
            owner_transaction.execute("SET LOCAL lock_timeout = '2s'")
            owner_transaction.execute(
                f"SELECT id FROM {owner_table} WHERE id = ? FOR UPDATE",  # noqa: S608 - fixed test tables
                (owner_id,),
            ).fetchone()
            with ThreadPoolExecutor(max_workers=1) as executor:
                pending = executor.submit(activate)
                try:
                    assert order_read.wait(timeout=3)
                    # Provider completion holds the stable owner before taking
                    # its order lock. Activation must obey the same ordering.
                    owner_transaction.execute(
                        "SELECT id FROM billing_orders WHERE id = ? FOR UPDATE",
                        (order["order_id"],),
                    ).fetchone()
                finally:
                    owner_transaction.rollback()
                assert pending.result(timeout=5)["status"] == "applied"
        finally:
            owner_transaction.rollback()
            owner_transaction.close()
    finally:
        seed.rollback()
        seed.execute("SET search_path TO public")
        seed.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(schema)))
        seed.commit()
        seed.close()
        database.close()


def test_quote_membership_check_does_not_deadlock_with_member_administration(billing_cursor):
    membership = billing_cursor.execute(
        """SELECT membership.user_id, membership.organization_id
             FROM thanh_vien_to_chuc AS membership
             JOIN to_chuc AS organization ON organization.id = membership.organization_id
            WHERE membership.vai_tro_trong_to_chuc = 'manager'
              AND membership.trang_thai_thanh_vien = 'active'
              AND organization.trang_thai = 'active' LIMIT 1"""
    ).fetchone()
    assert membership, "Test database must contain an active organization manager"
    user_id, organization_id = membership
    database = PostgresDatabase(_test_database_url())
    barrier = threading.Barrier(2)

    def operation(quote):
        connection = database.get_connection()
        try:
            connection.execute("BEGIN")
            connection.execute("SET LOCAL deadlock_timeout = '100ms'")
            connection.execute("SET LOCAL lock_timeout = '2s'")
            cursor = connection.cursor()
            if quote:
                cursor.execute("SELECT id FROM tai_khoan WHERE id = ? FOR UPDATE", (user_id,)).fetchone()
            else:
                lock_organization_membership_invariants(cursor, organization_id)
            barrier.wait(timeout=5)
            if quote:
                actor = SessionRole(
                    "manager", user_id, platform_role="user", active_role="manager",
                    active_role_organization_id=organization_id,
                )
                authorize_organization_buyer(cursor, actor, organization_id, lock_owner=False)
            else:
                cursor.execute("SELECT id FROM tai_khoan WHERE id = ? FOR UPDATE", (user_id,)).fetchone()
            return True
        finally:
            connection.rollback()
            connection.close()

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            operations = [executor.submit(operation, quote) for quote in (True, False)]
            assert all(operation.result(timeout=5) for operation in operations)
    finally:
        database.close()


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


def test_periodic_reconciliation_converges_an_open_order_without_webhook(
    billing_cursor,
):
    order = _insert_base_plan_order(billing_cursor)
    database = _TransactionDatabase(billing_cursor)

    class PaidProvider:
        def get_payment(self, _identifier):
            return _paid_result(order)

    processor = BillingWorkProcessor(
        database,
        environment={
            "PAYMENT_CHECKOUT_ENABLED": "true",
            "PAYMENT_ACTIVATION_ENABLED": "true",
        },
        registry=PaymentProviderRegistry(
            credential_resolver=lambda _reference: None,
        ),
        clock=lambda: order["now"],
    )
    processor.registry.install("provider-fake-v1", PaidProvider())

    assert processor._schedule_open_order_reconciliation() is True
    command = billing_cursor.execute(
        """SELECT id, status FROM billing_provider_commands
             WHERE order_id = ? AND command_type = 'query_order'""",
        (order["order_id"],),
    ).fetchone()
    assert command["status"] == "pending"

    ProviderCommandExecutor(
        database,
        providers={"provider-fake-v1": PaidProvider()},
        clock=lambda: order["now"],
        environment={"PAYMENT_ACTIVATION_ENABLED": "true"},
    ).execute(command["id"])

    reconciled = billing_cursor.execute(
        """SELECT payment_state, activation_state FROM billing_orders
             WHERE id = ?""",
        (order["order_id"],),
    ).fetchone()
    assert tuple(reconciled) == ("verified_paid", "applied")
    assert billing_cursor.execute(
        "SELECT COUNT(*) FROM payment_transactions WHERE order_id = ?",
        (order["order_id"],),
    ).fetchone()[0] == 1


def test_local_checkout_expiry_uses_the_pinned_boundary(billing_cursor):
    order = _insert_base_plan_order(
        billing_cursor,
        checkout_expires_at=1_800_000_100,
    )
    processor = BillingWorkProcessor(
        _TransactionDatabase(billing_cursor),
        environment={"PAYMENT_CHECKOUT_ENABLED": "true"},
        clock=lambda: 1_800_000_100,
    )

    assert processor._expire_local_checkout() is True
    state = billing_cursor.execute(
        "SELECT checkout_state FROM billing_orders WHERE id = ?",
        (order["order_id"],),
    ).fetchone()[0]
    assert state == "expired"


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
    checksum_key = "isolated-inbox-test-checksum"
    profile_id = "provider-payos-production-v1"
    registry.install(
        profile_id,
        PayOSPaymentProvider(PayOSCredentials("test-client", "test-api", checksum_key)),
    )
    monkeypatch.setattr(billing_webhook, "database", database)
    monkeypatch.setattr(billing_webhook, "payment_provider_registry", lambda: registry)
    identity = {
        "orderCode": 987654,
        "amount": 100000,
        "paymentLinkId": "fake-link-987654",
        "reference": "FAKE-987654",
    }

    first_data = {**identity, "status": "PENDING"}
    changed_data = {**identity, "status": "PAID"}
    first = asyncio.run(billing_webhook.payment_webhook_api(
        _WebhookRequest(
            profile_id,
            {"data": first_data, "signature": sign_signed_data(first_data, checksum_key)},
        )
    ))
    changed = asyncio.run(billing_webhook.payment_webhook_api(
        _WebhookRequest(
            profile_id,
            {"data": changed_data, "signature": sign_signed_data(changed_data, checksum_key)},
        )
    ))

    assert first.status_code == changed.status_code == 202
    assert json.loads(first.body)["reviewRequired"] is False
    assert json.loads(changed.body)["reviewRequired"] is True
    rows = billing_cursor.execute(
        """SELECT status, last_error_code FROM payment_webhook_events
            WHERE provider_profile_id = 'provider-payos-production-v1'
              AND dedupe_key = '987654|fake-link-987654|FAKE-987654'
            ORDER BY created_at, id"""
    ).fetchall()
    assert {tuple(row) for row in rows} == {
        ("pending", None),
        ("review", "WEBHOOK_DEDUPE_PAYLOAD_MISMATCH"),
    }
