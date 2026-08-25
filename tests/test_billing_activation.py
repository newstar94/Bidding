import json
import os
from pathlib import Path
import uuid

import psycopg
import pytest

from backend.billing.activation import BillingActivationService
from backend.db.db_helper import PostgresDatabase


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


def _insert_base_plan_order(cursor, *, now=1_800_000_000, checkout_expires_at=None):
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
           VALUES (?, ?, ?, 'account', 'personal', 'connected', 'diamond',
                   1, 3, 1, 1, 1, 1, 'sellable', '{}')""",
        (plan_id, release_id, f"test.personal.{token}"),
    )
    cursor.execute(
        """INSERT INTO billing_skus
               (id, release_id, sku_code, item_type, plan_version_id,
                quantity, repeatable, sales_state)
           VALUES (?, ?, ?, 'base_plan', ?, 1, 0, 'sellable')""",
        (sku_id, release_id, f"test-sku-{token}", plan_id),
    )
    cursor.execute(
        """INSERT INTO billing_prices
               (id, release_id, sku_id, period, subtotal_amount,
                tax_amount, total_amount, effective_at)
           VALUES (?, ?, ?, 'yearly', 100000, 0, 100000, ?)""",
        (price_id, release_id, sku_id, now - 100),
    )
    decision = json.dumps(
        {
            "itemType": "base_plan",
            "releaseChecksum": release_checksum,
            "benefits": {"includedProcurementQuota": 3},
            "policySnapshot": {"baseTerm": {"kind": "fixed_days", "days": 30}},
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
    cursor.execute(
        """INSERT INTO billing_quotes
               (id, public_id, actor_user_id, account_user_id, owner_kind,
                operation, request_hash, release_id, release_checksum,
                decision_json, subtotal_amount, tax_amount, total_amount,
                expires_at)
           VALUES (?, ?, ?, ?, 'account', 'purchase', ?, ?, ?, ?,
                   100000, 0, 100000, ?)""",
        (
            quote_id,
            public_quote,
            user_id,
            user_id,
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
                owner_kind, operation, idempotency_key, request_hash,
                release_id, provider_profile_id, provider_order_code,
                provider_reference, decision_json, subtotal_amount,
                tax_amount, total_amount, checkout_state,
                checkout_expires_at)
           VALUES (?, ?, ?, ?, ?, 'account', 'purchase', ?, ?, ?,
                   'provider-fake-v1', ?, ?, ?, 100000, 0, 100000,
                   'open', ?)""",
        (
            order_id,
            public_order,
            quote_id,
            user_id,
            user_id,
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
        (order_item_id, order_id, sku_id, plan_id, price_id, decision),
    )
    return {
        "order_id": order_id,
        "order_code": order_code,
        "user_id": user_id,
        "now": now,
    }


def _paid_result(order, *, amount=100000, occurred_at=None):
    return {
        "status": "PAID",
        "orderCode": order["order_code"],
        "amount": amount,
        "reference": f"payment-{order['order_id']}",
        "transactionDateTime": occurred_at or order["now"],
    }


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
    subscription = billing_cursor.execute(
        "SELECT source, source_order_id FROM account_subscriptions WHERE user_id = ?",
        (order["user_id"],),
    ).fetchone()
    assert tuple(subscription) == ("order", order["order_id"])


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
