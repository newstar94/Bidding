import asyncio
import json
import sqlite3
import time
from types import SimpleNamespace

import pytest

from backend.billing import routes
from backend.billing.account_read import personal_order_item


class _ReadConnection:
    def __init__(self, connection):
        self.connection = connection
        self.closed = False

    def execute(self, statement, parameters=()):
        return self.connection.execute(statement, parameters)

    def cursor(self):
        return self.connection.cursor()

    def close(self):
        self.closed = True


@pytest.fixture
def account_billing(monkeypatch):
    connection = sqlite3.connect(":memory:", check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.executescript("""
        CREATE TABLE goi_dich_vu (id TEXT PRIMARY KEY, ten_goi TEXT, trang_thai TEXT,
            document_export_word INTEGER, document_export_excel INTEGER,
            document_export_award_result_excel INTEGER);
        CREATE TABLE account_subscriptions (user_id TEXT PRIMARY KEY, package_id TEXT,
            status TEXT, starts_at INTEGER, expires_at INTEGER, revision INTEGER,
            plan_version_id TEXT, source TEXT, source_order_id TEXT);
        CREATE TABLE billing_plan_versions (id TEXT PRIMARY KEY, logical_package_code TEXT,
            variant TEXT, display_json TEXT, legacy_package_id TEXT);
        CREATE TABLE billing_orders (id TEXT PRIMARY KEY, public_id TEXT, owner_kind TEXT,
            account_user_id TEXT, organization_id TEXT, actor_user_id TEXT,
            operation TEXT, subtotal_amount INTEGER, tax_amount INTEGER, total_amount INTEGER,
            currency TEXT, checkout_state TEXT, payment_state TEXT, activation_state TEXT,
            checkout_url TEXT, checkout_expires_at INTEGER, created_at TEXT, updated_at TEXT,
            decision_json TEXT);
        CREATE TABLE billing_subscription_activations (order_id TEXT, after_json TEXT);
        CREATE TABLE billing_order_items (id TEXT PRIMARY KEY, order_id TEXT, sku_id TEXT,
            plan_version_id TEXT, snapshot_json TEXT, created_at TEXT);
        CREATE TABLE billing_skus (id TEXT PRIMARY KEY, sku_code TEXT, item_type TEXT, quantity INTEGER);
        CREATE TABLE payment_transactions (order_id TEXT, transaction_type TEXT,
            status TEXT, provider_occurred_at INTEGER);
        CREATE TABLE usage_credit_grants (account_user_id TEXT, organization_id TEXT, owner_kind TEXT,
            feature TEXT, total INTEGER, remaining INTEGER, reserved INTEGER, expires_at INTEGER);
    """)
    actor = SimpleNamespace(user_id="account-current", active_role_organization_id="org-active")
    handles = []

    def get_connection():
        handle = _ReadConnection(connection)
        handles.append(handle)
        return handle

    monkeypatch.setattr(routes, "verify_session", lambda _request: (True, actor))
    monkeypatch.setattr(routes.database, "get_connection", get_connection)
    now = int(time.time())
    snapshot = {
        "skuCode": "personal.connected.yearly",
        "itemType": "base_plan",
        "price": {"period": "yearly"},
        "policySnapshot": {"baseTerm": {"kind": "fixed_days", "days": 365}},
        "benefits": {"includedProcurementQuota": 1000},
    }
    connection.execute("INSERT INTO goi_dich_vu VALUES ('package-old', 'Tên gói tương thích', 'active', 1, 1, 1)")
    connection.execute(
        "INSERT INTO billing_plan_versions VALUES ('plan-old', 'personal.connected.yearly', 'connected', ?, 'package-old')",
        (json.dumps({"name": "Cá nhân Nâng cao đã mua"}),),
    )
    connection.execute("INSERT INTO billing_skus VALUES ('sku-old', 'personal.connected.yearly', 'base_plan', 1)")

    def add_order(identifier, *, user_id="account-current", owner_kind="account", date="2026-10-08 00:00:00"):
        connection.execute(
            """INSERT INTO billing_orders VALUES (?, ?, ?, ?, ?, 'account-current', 'purchase',
                2000, 0, 2000, 'VND', 'open', 'verified_paid', 'applied', NULL, NULL, ?, ?, ?)""",
            (identifier, f"public-{identifier}", owner_kind,
             user_id if owner_kind == "account" else None,
             "org-active" if owner_kind == "organization" else None,
             date, date, json.dumps(snapshot)),
        )
        connection.execute(
            "INSERT INTO billing_order_items VALUES (?, ?, 'sku-old', 'plan-old', ?, ?)",
            (f"item-{identifier}", identifier, json.dumps(snapshot), date),
        )

    add_order("own-1", date="2026-10-08 01:00:00")
    add_order("own-2", date="2026-10-08 02:00:00")
    add_order("own-3", date="2026-10-08 03:00:00")
    add_order("other", user_id="account-other", date="2026-10-08 04:00:00")
    add_order("organization", owner_kind="organization", date="2026-10-08 05:00:00")
    connection.execute(
        "INSERT INTO account_subscriptions VALUES ('account-current', 'package-old', 'active', ?, ?, 2, 'plan-old', 'order', 'own-3')",
        (now - 100, now + 365 * 86400),
    )
    connection.execute("INSERT INTO payment_transactions VALUES ('own-3', 'payment', 'verified', ?)", (now - 100,))
    connection.execute("INSERT INTO payment_transactions VALUES ('own-3', 'refund', 'settled', ?)", (now - 50,))
    connection.executemany(
        "INSERT INTO usage_credit_grants VALUES (?, ?, ?, 'procurement.source_fetch', ?, ?, ?, ?)",
        [
            ("account-current", None, "account", 1000, 980, 2, now + 86400),
            ("account-other", None, "account", 9000, 9000, 0, now + 86400),
            (None, "org-active", "organization", 8000, 8000, 0, now + 86400),
            ("account-current", None, "account", 4000, 4000, 0, now - 100),
        ],
    )
    yield SimpleNamespace(connection=connection, handles=handles, add_order=add_order, now=now)
    connection.close()


def _response(function, *, query=None):
    result = asyncio.run(function(SimpleNamespace(query_params=query or {})))
    return result, json.loads(result.body)


def test_summary_uses_own_account_when_organization_is_active(account_billing):
    response, payload = _response(routes.get_personal_account_summary_api)

    assert response.status_code == 200
    subscription = payload["subscription"]
    assert subscription["packageName"] == "Cá nhân Nâng cao đã mua"
    assert subscription["status"] == "active"
    assert subscription["skuCode"] == "personal.connected.yearly"
    assert subscription["variant"] == "connected"
    assert subscription["billingCycle"] == "yearly"
    assert subscription["termDays"] == 365
    assert subscription["sourceOrderPublicId"] == "public-own-3"
    assert subscription["entitlements"]["document.export.word"] is True
    assert payload["usage"] == {
        "ownerKind": "account", "ownerId": "account-current",
        "feature": "procurement.source_fetch", "total": 1000,
        "used": 20, "remaining": 980, "reserved": 2,
        "available": 978, "nextExpiryAt": account_billing.now + 86400,
    }
    assert account_billing.handles[-1].closed


def test_history_pages_all_own_purchases_and_projects_bought_version(account_billing):
    response, first = _response(routes.list_personal_orders_api, query={"page": "1", "pageSize": "2"})
    _, second = _response(routes.list_personal_orders_api, query={"page": "2", "pageSize": "2"})

    assert response.status_code == 200
    assert first["pagination"] == {"page": 1, "pageSize": 2, "total": 3, "totalPages": 2}
    assert [order["publicId"] for order in first["orders"]] == ["public-own-3", "public-own-2"]
    assert [order["publicId"] for order in second["orders"]] == ["public-own-1"]
    assert first["orders"][0]["item"] == {
        "skuCode": "personal.connected.yearly", "itemType": "base_plan",
        "displayName": "Cá nhân Nâng cao đã mua", "planCode": "personal.connected.yearly",
        "variant": "connected", "billingCycle": "yearly", "termDays": 365, "credits": 1000,
    }
    assert first["orders"][0]["paymentConfirmedAt"] == account_billing.now - 100
    assert account_billing.handles[-1].closed


def test_legacy_history_call_retains_latest_100_and_all_pages_remain_reachable(account_billing):
    for number in range(4, 105):
        account_billing.add_order(f"own-{number:03}", date=f"2026-10-09 {number:03}")
    _, legacy = _response(routes.list_personal_orders_api)
    _, last = _response(routes.list_personal_orders_api, query={"page": "11", "pageSize": "10"})

    assert len(legacy["orders"]) == 100
    assert "pagination" not in legacy
    assert last["pagination"]["total"] == 104
    assert len(last["orders"]) == 4


def test_summary_handles_free_and_manual_accounts_without_inventing_terms(account_billing):
    account_billing.connection.execute(
        "UPDATE account_subscriptions SET source = 'admin', source_order_id = NULL, plan_version_id = NULL"
    )
    _, manual = _response(routes.get_personal_account_summary_api)
    assert manual["subscription"]["packageName"] == "Tên gói tương thích"
    assert manual["subscription"]["source"] == "admin"
    assert manual["subscription"]["billingCycle"] is None
    assert manual["subscription"]["termDays"] is None
    account_billing.connection.execute("DELETE FROM account_subscriptions")
    _, free = _response(routes.get_personal_account_summary_api)
    assert free["subscription"] is None
    assert free["usage"]["ownerKind"] == "account"


def test_one_time_credit_pack_does_not_inherit_subscription_term():
    item = personal_order_item({"item_snapshot_json": json.dumps({
        "skuCode": "credits.1000", "itemType": "procurement_credit_pack",
        "price": {"period": "one_time"},
        "policySnapshot": {"baseTerm": {"kind": "fixed_days", "days": 365}},
        "benefits": {"procurementCredits": 1000},
    })})
    assert item["displayName"] == "1.000 lượt Mua Sắm Công"
    assert item["billingCycle"] == "one_time"
    assert item["termDays"] is None


@pytest.mark.parametrize("benefit_expiry, expected_days", [
    (None, 90),
    ({"kind": "fixed_days", "days": 45}, 45),
    ({"kind": "no_expiry"}, None),
    ({"kind": "fixed_days", "days": False}, None),
])
def test_credit_pack_uses_its_pinned_expiry_policy(benefit_expiry, expected_days):
    benefits = {"procurementCredits": 1000}
    if benefit_expiry is not None:
        benefits["expiryPolicy"] = benefit_expiry
    item = personal_order_item({"item_snapshot_json": json.dumps({
        "skuCode": "credits.1000", "itemType": "procurement_credit_pack",
        "price": {"period": "one_time"},
        "policySnapshot": {
            "baseTerm": {"kind": "fixed_days", "days": 365},
            "creditPackExpiry": {"kind": "fixed_days", "days": 90},
        },
        "benefits": benefits,
    })})
    assert item["billingCycle"] == "one_time"
    assert item["termDays"] == expected_days


@pytest.mark.parametrize("query", [
    {"page": "0"}, {"page": "invalid"}, {"pageSize": "0"},
    {"pageSize": "101"}, {"page": "1000001"},
])
def test_invalid_pages_are_rejected_before_database_read(account_billing, query):
    response, payload = _response(routes.list_personal_orders_api, query=query)
    assert response.status_code == 400
    assert payload["code"] == "BILLING_PAGINATION_INVALID"
    assert account_billing.handles == []


@pytest.mark.parametrize("function", [routes.list_personal_orders_api, routes.get_personal_account_summary_api])
def test_billing_account_reads_require_a_valid_session(account_billing, monkeypatch, function):
    monkeypatch.setattr(routes, "verify_session", lambda _request: (False, "Phiên hết hạn"))
    response, payload = _response(function)
    assert response.status_code == 403
    assert payload["code"] == "FORBIDDEN"
    assert account_billing.handles == []
