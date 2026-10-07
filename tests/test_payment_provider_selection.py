"""Quote to checkout routing without a database or payment network call."""

from copy import deepcopy
import json
from types import SimpleNamespace

import pytest

from backend.billing.service import BillingService, public_order_payload
from backend.commercial_policy.errors import CommercialPolicyError
from backend.commercial_policy.service import CommercialPolicy


NOW = 1_800_000_000
FAKE = {
    "id": "provider-fake-v1", "provider": "fake", "environment": "test",
    "min_amount": 1, "max_amount": 100_000_000,
    "checkout_ttl_seconds": 900, "timeout_ms": 5000, "max_attempts": 3,
    "mode": "shadow", "readiness_status": "ready",
}
PAYOS = {**FAKE, "id": "provider-payos-production-v2", "provider": "payos", "environment": "production", "mode": "live"}
FAKE["credential_reference"] = None
PAYOS["credential_reference"] = "env://payos/default"


class Result:
    def __init__(self, row=None):
        self.row = row

    def fetchone(self):
        return self.row


class CheckoutCursor:
    def __init__(self, profiles):
        self.profiles = deepcopy(profiles)
        self.quote = None
        self.order = None
        self.calls = []
        self.subscription = {"status": "active", "expires_at": NOW + 86400, "revision": 3, "plan_version_id": "plan"}
        self.same_plan = True

    def execute(self, statement, parameters=()):
        normalized = " ".join(statement.split())
        self.calls.append((normalized, parameters))
        if "FROM payment_provider_profiles" in normalized:
            if "WHERE id = ?" in normalized:
                candidates = [row for row in self.profiles if row["id"] == parameters[0]]
                amount = parameters[1]
            else:
                candidates = [row for row in self.profiles if (row["provider"], row["environment"]) == parameters[:2]]
                amount = parameters[2]
            return Result(next((row for row in candidates if row["readiness_status"] == "ready" and row["mode"] in {"live", "shadow"} and row["min_amount"] <= amount <= row["max_amount"]), None))
        if "FROM billing_quotes" in normalized:
            return Result(self.quote)
        if "FROM account_subscriptions" in normalized:
            return Result(self.subscription)
        if "FROM billing_plan_versions" in normalized:
            return Result((1,) if self.same_plan else None)
        if "FROM tai_khoan" in normalized:
            return Result(("buyer", "active"))
        if "FROM billing_orders" in normalized:
            return Result(self.order)
        if "FROM billing_skus" in normalized:
            return Result({"sku_id": "sku", "item_type": "base_plan", "plan_version_id": "plan", "quantity": 1, "price_id": "price"})
        if "INSERT INTO billing_orders" in normalized:
            columns = ["id", "public_id", "quote_id", "actor_user_id", "account_user_id", "organization_id", "owner_kind", "operation", "idempotency_key", "request_hash", "release_id", "provider_profile_id", "provider_order_code", "provider_reference", "decision_json", "subtotal_amount", "tax_amount", "total_amount", "currency", "expected_subscription_revision", "checkout_expires_at"]
            self.order = dict(zip(columns, parameters, strict=True))
            return Result({"id": self.order["id"]})
        if normalized.startswith("INSERT INTO"):
            return Result()
        raise AssertionError(f"Unexpected SQL: {normalized}")


def quote_policy(cursor, *, tax_invoice=None, provider_profiles=None, credit_packs=None):
    offer = {
        "code": "personal.internal.yearly", "ownerKind": "account", "salesState": "sellable",
        "price": {"period": "yearly", "currency": "VND", "subtotal": 100000, "tax": 0, "total": 100000},
        "memberQuota": 1, "includedProcurementQuota": 0,
        "exportCapabilities": {"document.export.word": True}, "violationCheckEnabled": False,
    }
    release = {
        "id": "release", "checksum": "a" * 64, "effective_from": NOW - 100,
        "snapshot": {
            "currency": "VND", "timezone": "Asia/Ho_Chi_Minh", "offers": [offer],
            "providerProfiles": provider_profiles if provider_profiles is not None else [
                {"provider": "fake", "environment": "test", "mode": "shadow", "readiness": "ready", "credentialReference": None, "minAmount": 1, "maxAmount": 100_000_000, "checkoutTtlSeconds": 900},
                {"provider": "payos", "environment": "production", "mode": "live", "readiness": "ready", "credentialReference": "env://payos/default", "minAmount": 1, "maxAmount": 100_000_000, "checkoutTtlSeconds": 900},
            ],
            "taxInvoice": tax_invoice or {}, "creditPacks": credit_packs or [],
            "policies": {},
        },
    }
    policy = CommercialPolicy(cursor, clock=lambda: NOW)
    policy.repository = SimpleNamespace(cursor=cursor, effective_release=lambda *args, **kwargs: release, get_release=lambda _id: release, next_effective_at=lambda _at: None)
    return policy


def quote_snapshot(cursor, **kwargs):
    policy = quote_policy(cursor, **kwargs)
    return policy.evaluate_commercial_command(
        {"skuCode": "personal.internal.yearly", "operation": "purchase"},
        {"ownerKind": "account", "ownerId": "buyer"},
    )["snapshot"]


def checkout(cursor, snapshot, *, environment=None):
    cursor.quote = {
        "id": "quote", "public_id": "quote-public", "actor_user_id": "buyer", "account_user_id": "buyer",
        "organization_id": None, "owner_kind": "account", "operation": snapshot.get("operation", "purchase"), "request_hash": "b" * 64,
        "release_id": "release", "release_checksum": "a" * 64, "decision_json": json.dumps(snapshot),
        "subtotal_amount": 100000, "tax_amount": 0, "total_amount": 100000, "currency": "VND",
        "expected_subscription_revision": snapshot.get("expectedSubscriptionRevision"), "expires_at": NOW + 900,
    }
    return BillingService(cursor, clock=lambda: NOW, environment=environment).create_checkout(SimpleNamespace(user_id="buyer"), "quote-public", "checkout-test-key")


def configure_payos(monkeypatch):
    monkeypatch.setenv("COMMERCIAL_PAYMENT_PROVIDER", "payos")
    monkeypatch.setenv("PAYMENT_PROVIDER_ENVIRONMENT", "production")


def test_quote_and_checkout_use_same_configured_provider_instead_of_first_release_profile(monkeypatch):
    configure_payos(monkeypatch)
    cursor = CheckoutCursor([FAKE, PAYOS])
    snapshot = quote_snapshot(cursor)
    order, command_id, replayed = checkout(cursor, snapshot)

    assert snapshot["provider"]["provider"] == "payos"
    assert order["provider_profile_id"] == snapshot["provider"]["id"] == PAYOS["id"]
    assert command_id and replayed is False
    assert json.loads(order["decision_json"]) == snapshot


def test_checkout_retains_quoted_profile_after_environment_and_routing_changes(monkeypatch):
    configure_payos(monkeypatch)
    cursor = CheckoutCursor([FAKE, PAYOS])
    snapshot = quote_snapshot(cursor)
    cursor.profiles.insert(0, {**PAYOS, "id": "provider-payos-production-v3"})

    order, _, _ = checkout(cursor, snapshot, environment={
        "COMMERCIAL_PAYMENT_PROVIDER": "fake", "PAYMENT_PROVIDER_ENVIRONMENT": "test",
    })

    assert order["provider_profile_id"] == PAYOS["id"]
    provider_calls = [(statement, values) for statement, values in cursor.calls if "FROM payment_provider_profiles" in statement]
    assert provider_calls[-1][1] == (PAYOS["id"], 100000, 100000)
    assert "WHERE id = ?" in provider_calls[-1][0]
    assert json.loads(order["decision_json"]) == snapshot


@pytest.mark.parametrize("state", ["missing", "paused", "unhealthy", "amount_outside_range"])
def test_checkout_does_not_switch_provider_when_quoted_profile_is_unavailable(monkeypatch, state):
    configure_payos(monkeypatch)
    cursor = CheckoutCursor([FAKE, PAYOS])
    snapshot = quote_snapshot(cursor)
    pinned = next(row for row in cursor.profiles if row["id"] == PAYOS["id"])
    if state == "missing":
        cursor.profiles.remove(pinned)
    elif state == "paused":
        pinned["mode"] = "paused"
    elif state == "unhealthy":
        pinned["readiness_status"] = "unhealthy"
    else:
        pinned["max_amount"] = 99999
    cursor.profiles.insert(0, {**PAYOS, "id": "provider-payos-production-v3"})

    with pytest.raises(CommercialPolicyError) as error:
        checkout(cursor, snapshot)

    assert error.value.code == "NO_HEALTHY_PROVIDER"
    assert cursor.order is None
    assert not any(statement.startswith("INSERT INTO") for statement, _ in cursor.calls)


@pytest.mark.parametrize("legacy_provider", ["absent", None, {"provider": "fake", "environment": "test", "mode": "shadow", "readiness": "ready"}])
def test_legacy_quote_without_a_pinned_profile_keeps_configured_routing(legacy_provider):
    cursor = CheckoutCursor([FAKE, PAYOS])
    snapshot = {"skuCode": "personal.internal.yearly", "itemType": "base_plan"}
    if legacy_provider != "absent":
        snapshot["provider"] = legacy_provider

    order, command_id, replayed = checkout(cursor, snapshot, environment={
        "COMMERCIAL_PAYMENT_PROVIDER": "payos", "PAYMENT_PROVIDER_ENVIRONMENT": "production",
    })

    assert order["provider_profile_id"] == PAYOS["id"]
    assert command_id and replayed is False
    assert json.loads(order["decision_json"]) == snapshot


def test_idempotent_order_replay_keeps_original_provider_without_new_selection(monkeypatch):
    configure_payos(monkeypatch)
    cursor = CheckoutCursor([FAKE, PAYOS])
    snapshot = quote_snapshot(cursor)
    first, command_id, _ = checkout(cursor, snapshot)
    provider_call_count = sum("FROM payment_provider_profiles" in statement for statement, _ in cursor.calls)
    cursor.profiles.clear()

    replay, replay_command_id, replayed = checkout(cursor, snapshot, environment={
        "COMMERCIAL_PAYMENT_PROVIDER": "fake", "PAYMENT_PROVIDER_ENVIRONMENT": "test",
    })

    assert replay == first
    assert command_id and replay_command_id is None and replayed is True
    assert sum("FROM payment_provider_profiles" in statement for statement, _ in cursor.calls) == provider_call_count


def test_quote_does_not_use_ready_release_profile_when_configured_provider_is_unavailable(monkeypatch):
    configure_payos(monkeypatch)
    cursor = CheckoutCursor([FAKE])

    with pytest.raises(CommercialPolicyError) as error:
        quote_snapshot(cursor)

    assert error.value.code == "NO_HEALTHY_PROVIDER"
    assert cursor.order is None


def release_payos_profile(**overrides):
    return {"provider": "payos", "environment": "production", "mode": "live", "readiness": "ready", "credentialReference": "env://payos/default", "minAmount": 1, "maxAmount": 200000, "checkoutTtlSeconds": 300, **overrides}


def test_pinned_release_provider_controls_checkout_ttl(monkeypatch):
    configure_payos(monkeypatch)
    cursor = CheckoutCursor([FAKE, PAYOS])
    snapshot = quote_snapshot(cursor, provider_profiles=[release_payos_profile()])
    order, _, _ = checkout(cursor, snapshot)

    assert snapshot["provider"]["checkoutTtlSeconds"] == 300
    assert order["checkout_expires_at"] == NOW + 300
    assert cursor.profiles[1]["checkout_ttl_seconds"] == 900


@pytest.mark.parametrize("overrides", [{"maxAmount": 99999}, {"minAmount": 100001}, {"credentialReference": "env://another-merchant"}])
def test_release_provider_limits_and_reference_must_match_selected_database_profile(monkeypatch, overrides):
    configure_payos(monkeypatch)
    cursor = CheckoutCursor([FAKE, PAYOS])
    with pytest.raises(CommercialPolicyError) as error:
        quote_snapshot(cursor, provider_profiles=[release_payos_profile(**overrides)])
    assert error.value.code == "NO_HEALTHY_PROVIDER"
    assert cursor.order is None


def test_shadow_release_profile_cannot_route_through_live_database_profile(monkeypatch):
    configure_payos(monkeypatch)
    cursor = CheckoutCursor([PAYOS])
    with pytest.raises(CommercialPolicyError) as error:
        quote_snapshot(cursor, provider_profiles=[release_payos_profile(mode="shadow")])
    assert error.value.code == "NO_HEALTHY_PROVIDER"


@pytest.mark.parametrize("reference", [42, True, {"reference": "merchant"}, ["merchant"]])
def test_release_credential_reference_does_not_match_by_coercing_nonstring_values(monkeypatch, reference):
    configure_payos(monkeypatch)
    cursor = CheckoutCursor([{**PAYOS, "credential_reference": str(reference)}])
    with pytest.raises(CommercialPolicyError) as error:
        quote_snapshot(cursor, provider_profiles=[release_payos_profile(credentialReference=reference)])
    assert error.value.code == "NO_HEALTHY_PROVIDER"


@pytest.mark.parametrize("reason", ["policy", "missing_subscription", "changed_plan", "revision"])
def test_renewal_is_rejected_before_order_or_provider_command_when_current_term_is_unsuitable(monkeypatch, reason):
    configure_payos(monkeypatch)
    cursor = CheckoutCursor([FAKE, PAYOS])
    snapshot = quote_snapshot(cursor)
    snapshot.update(operation="renew", expectedSubscriptionRevision=3)
    snapshot["policySnapshot"] = {"renewalAnchor": {"kind": "end_of_term"}}
    expected_code = {
        "policy": "RENEWAL_ANCHOR_DECISION_REQUIRED", "missing_subscription": "RENEWAL_BASE_SUBSCRIPTION_REQUIRED",
        "changed_plan": "RENEWAL_PLAN_TRANSITION_REVIEW_REQUIRED", "revision": "SUBSCRIPTION_REVISION_MISMATCH",
    }[reason]
    if reason == "policy":
        snapshot["policySnapshot"]["renewalAnchor"] = {"kind": "immediate"}
    elif reason == "missing_subscription":
        cursor.subscription = None
    elif reason == "changed_plan":
        cursor.same_plan = False
    else:
        cursor.subscription["revision"] = 4
    with pytest.raises(CommercialPolicyError) as error:
        checkout(cursor, snapshot)
    assert error.value.code == expected_code
    assert cursor.order is None
    assert not any(statement.startswith("INSERT INTO") for statement, _ in cursor.calls)


def test_credit_pack_quote_and_catalog_share_configured_tax_price(monkeypatch):
    configure_payos(monkeypatch)
    cursor = CheckoutCursor([FAKE, PAYOS])
    policy = quote_policy(cursor,
        tax_invoice={"taxInclusive": False, "taxBasisPoints": 1000, "rounding": "half_up"},
        credit_packs=[{"code": "credits.100", "price": 100000, "quantity": 100}],
    )
    snapshot = policy.evaluate_commercial_command(
        {"skuCode": "credits.100", "operation": "credit_pack"}, {"ownerKind": "account", "ownerId": "buyer"},
    )["snapshot"]
    catalog = policy.resolve_offer()
    expected = {"period": "one_time", "currency": "VND", "subtotal": 100000, "tax": 10000, "total": 110000}
    assert snapshot["price"] == expected
    assert catalog["creditPacks"][0]["price"] == 110000
    assert catalog["creditPacks"][0]["priceDetails"] == expected
    assert policy.repository.get_release("release")["snapshot"]["creditPacks"][0]["price"] == 100000


@pytest.mark.parametrize("state, metadata, scheduled", [
    ("pending", '{"scheduled":true,"startsAt":1800000000,"expiresAt":1800086400}', True),
    ("applied", '{"scheduled":true,"startsAt":1800000000,"expiresAt":1800086400}', False),
    ("pending", "invalid-json", False),
    ("pending", None, False),
])
def test_public_order_reports_authoritative_scheduled_activation(state, metadata, scheduled):
    order = {
        "public_id": "order", "owner_kind": "account", "operation": "renew",
        "subtotal_amount": 100000, "tax_amount": 0, "total_amount": 100000, "currency": "VND",
        "checkout_state": "open", "payment_state": "verified_paid", "activation_state": state,
        "activation_schedule_json": metadata,
    }
    payload = public_order_payload(order)
    assert payload["activationScheduled"] is scheduled
    assert payload["activationStartsAt"] == (1800000000 if scheduled else None)
    assert payload["activationExpiresAt"] == (1800086400 if scheduled else None)
