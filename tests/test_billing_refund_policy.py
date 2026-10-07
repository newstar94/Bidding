"""Pinned refund policy behavior through the public billing service seam."""

import json
import sqlite3

import pytest

from backend.billing.service import BillingService
from backend.commercial_policy.errors import CommercialPolicyError


class _TransactionCursor:
    def __init__(self, connection):
        self.connection = connection

    def execute(self, statement, parameters=()):
        return self.connection.execute(statement.strip().removesuffix(" FOR UPDATE"), parameters)


@pytest.fixture
def refund_database():
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        CREATE TABLE billing_orders (
            id TEXT PRIMARY KEY, public_id TEXT UNIQUE NOT NULL,
            payment_state TEXT NOT NULL, revision INTEGER NOT NULL,
            decision_json TEXT NOT NULL
        );
        CREATE TABLE payment_transactions (
            order_id TEXT NOT NULL, transaction_type TEXT NOT NULL,
            status TEXT NOT NULL, verified_paid_amount INTEGER NOT NULL
        );
        CREATE TABLE billing_refund_intents (
            id TEXT PRIMARY KEY, order_id TEXT NOT NULL,
            idempotency_key TEXT NOT NULL, amount INTEGER NOT NULL,
            reason TEXT, actor_user_id TEXT NOT NULL,
            method TEXT NOT NULL, state TEXT NOT NULL,
            activation_revision INTEGER NOT NULL,
            UNIQUE(order_id, idempotency_key)
        );
        INSERT INTO payment_transactions VALUES ('order-1', 'payment', 'verified', 100000);
        """
    )
    try:
        yield connection
    finally:
        connection.close()


def _insert_order(connection, policy_snapshot=None, *, payment_state="verified_paid"):
    decision = {"policySnapshot": policy_snapshot} if policy_snapshot is not None else {}
    connection.execute(
        "INSERT INTO billing_orders VALUES ('order-1', 'public-order-1', ?, 7, ?)",
        (payment_state, json.dumps(decision)),
    )
    return BillingService(_TransactionCursor(connection))


@pytest.mark.parametrize("amount", [50000, 100000])
def test_no_refunds_order_rejects_new_intent_without_changing_payment_facts(refund_database, amount):
    service = _insert_order(refund_database, {"refund": {"kind": "no_refunds", "partial": False}})
    changes_before = refund_database.total_changes

    with pytest.raises(CommercialPolicyError) as error:
        service.create_manual_refund_intent("public-order-1", "admin-1", amount, "Yêu cầu hoàn tiền", "refund-key-123")

    assert error.value.code == "REFUND_DISABLED_BY_POLICY"
    assert error.value.status_code == 409
    assert refund_database.total_changes == changes_before
    assert refund_database.execute("SELECT COUNT(*) FROM billing_refund_intents").fetchone()[0] == 0
    assert dict(refund_database.execute("SELECT payment_state, revision FROM billing_orders").fetchone()) == {
        "payment_state": "verified_paid", "revision": 7,
    }
    assert refund_database.execute("SELECT SUM(verified_paid_amount) FROM payment_transactions").fetchone()[0] == 100000


@pytest.mark.parametrize("policy_snapshot", [None, {}, {"refund": {"kind": "manual_off_platform", "partial": True}}])
def test_legacy_and_manual_refund_orders_keep_existing_behavior(refund_database, policy_snapshot):
    service = _insert_order(refund_database, policy_snapshot)

    intent, replayed = service.create_manual_refund_intent("public-order-1", "admin-1", 50000, "Hoàn một phần", "refund-key-123")

    assert replayed is False
    assert intent["amount"] == 50000
    assert intent["state"] == "pending"
    assert intent["method"] == "manual_off_platform"
    assert refund_database.execute("SELECT COUNT(*) FROM billing_refund_intents").fetchone()[0] == 1


def test_existing_refund_intent_replay_precedes_policy_gate_and_preserves_request_binding(refund_database):
    service = _insert_order(
        refund_database, {"refund": {"kind": "no_refunds", "partial": False}}, payment_state="refunded",
    )
    refund_database.execute(
        """INSERT INTO billing_refund_intents VALUES
           ('existing-refund', 'order-1', 'refund-key-123', 100000,
            'Hoàn toàn bộ', 'admin-1', 'manual_off_platform', 'succeeded', 7)"""
    )
    changes_before = refund_database.total_changes

    replay, replayed = service.create_manual_refund_intent("public-order-1", "admin-1", 100000, "Hoàn toàn bộ", "refund-key-123")

    assert replayed is True
    assert replay["id"] == "existing-refund"
    assert replay["state"] == "succeeded"
    assert refund_database.total_changes == changes_before
    assert refund_database.execute("SELECT COUNT(*) FROM billing_refund_intents").fetchone()[0] == 1
    with pytest.raises(CommercialPolicyError) as error:
        service.create_manual_refund_intent("public-order-1", "admin-1", 50000, "Hoàn toàn bộ", "refund-key-123")
    assert error.value.code == "IDEMPOTENCY_KEY_REUSED"
    assert refund_database.total_changes == changes_before
