"""Pinned transition rules apply even when a client selects another operation."""
import json
from types import SimpleNamespace

import pytest

from backend.billing.activation import BillingActivationService
from backend.billing.service import BillingService
from backend.commercial_policy import service as policy_service
from backend.commercial_policy.errors import CommercialPolicyError


POLICY = {"baseTerm": {"kind": "fixed_days", "days": 365},
          "upgrade": {"kind": "start_new_term", "activeTerm": "manual_review"},
          "downgrade": {"kind": "manual_review", "selfService": False}}


@pytest.mark.parametrize("operation,active,expected", [
    ("purchase", True, "review_required"),
    ("upgrade", True, "review_required"),
    ("downgrade", True, "review_required"),
    ("downgrade", False, "review_required"),
    ("upgrade", False, "applied"),
])
def test_activation_applies_pinned_transition_policy(monkeypatch, operation, active, expected):
    snapshot = {"itemType": "base_plan", "policySnapshot": POLICY,
                "price": {"period": "yearly"}}
    item = {"id": "item", "snapshot_json": json.dumps(snapshot), "legacy_package_id": "plan",
            "plan_version_id": "version", "included_procurement_quota": 0}
    class Cursor:
        def __init__(self):
            self.sql = ""
            self.writes = []
        def execute(self, sql, params=()):
            self.sql = sql
            if "INSERT INTO account_subscriptions" in sql:
                self.writes.append(params)
            return self
        def fetchone(self):
            return item if "FROM billing_order_items" in self.sql else None
    cursor = Cursor()
    service = BillingActivationService(cursor, clock=lambda: 1000)
    monkeypatch.setattr(service, "_owner_is_active", lambda *_: True)
    monkeypatch.setattr(service, "_current_subscription", lambda *_: {
        "status": "active" if active else "expired", "expires_at": 2000 if active else 900,
        "revision": 2})
    monkeypatch.setattr(service, "_owner", lambda *_: SimpleNamespace(kind="account", identifier="buyer"))
    monkeypatch.setattr(service, "_mark_review", lambda *_: {"status": "review_required"})
    monkeypatch.setattr(service, "_mark_applied", lambda *_: {"status": "applied"})
    order = {"id": "order", "activation_state": "pending", "payment_state": "paid", "operation": operation, "decision_json": json.dumps(snapshot),
             "release_id": "release"}
    assert service._activate_order(order)["status"] == expected
    assert len(cursor.writes) == (1 if expected == "applied" else 0)


@pytest.mark.parametrize("operation", ["upgrade", "downgrade"])
def test_quote_rejects_transition_before_provider_selection(monkeypatch, operation):
    offer = {"code": "sku", "salesState": "sellable", "ownerKind": "account",
             "price": {"total": 2000}, "memberQuota": 1, "includedProcurementQuota": 0,
             "exportCapabilities": {}, "violationCheckEnabled": False}
    release = {"id": "release", "checksum": "sum", "snapshot": {"offers": [offer], "policies": POLICY}}
    policy = policy_service.CommercialPolicy(object(), clock=lambda: 1000)
    monkeypatch.setattr(policy, "resolve_offer", lambda *_: {"releaseId": "release"})
    monkeypatch.setattr(policy.repository, "get_release", lambda *_: release)
    monkeypatch.setattr(policy_service, "current_subscription", lambda *_: {"status": "active", "expires_at": 2000})
    def forbidden_provider(*_a, **_k):
        raise AssertionError("Rejected transitions must not select/create a payment")
    monkeypatch.setattr(policy_service, "select_payment_provider_profile", forbidden_provider)
    with pytest.raises(CommercialPolicyError) as error:
        policy.evaluate_commercial_command({"skuCode": "sku", "operation": operation},
                                           {"ownerKind": "account", "ownerId": "buyer"})
    assert error.value.code == "TRANSITION_NOT_ALLOWED"


def test_old_quote_is_checked_again_at_checkout(monkeypatch):
    quote = {"id": "quote", "public_id": "q", "actor_user_id": "buyer", "account_user_id": "buyer",
             "owner_kind": "account", "operation": "upgrade", "expires_at": 2000, "release_id": "release",
             "decision_json": json.dumps({"skuCode": "sku", "policySnapshot": POLICY})}
    class Cursor:
        def execute(self, sql, params=()):
            self.sql = sql
            assert not sql.lstrip().startswith("INSERT"), "Rejected checkout wrote an order"
            return self
        def fetchone(self):
            if "FROM billing_quotes" in self.sql:
                return quote
            if "FROM billing_skus" in self.sql:
                return {"item_type": "base_plan"}
            if "FROM account_subscriptions" in self.sql:
                return {"status": "active", "expires_at": 2000, "revision": 1}
            return None
    service = BillingService(Cursor(), clock=lambda: 1000)
    monkeypatch.setattr(service, "_lock_and_authorize_owner", lambda *_: None)
    monkeypatch.setattr(service, "_existing_idempotent_order", lambda *_: None)
    with pytest.raises(CommercialPolicyError) as error:
        service.create_checkout(SimpleNamespace(user_id="buyer"), "q", "transition-test-1")
    assert error.value.code == "TRANSITION_NOT_ALLOWED"
