"""Published plans activate through immutable, version-specific legacy adapters.

All PostgreSQL writes are inside one unique schema and rolled back. Provider
responses are local fixtures; these tests do not send payments or publish live.
"""

from copy import deepcopy
import os
from pathlib import Path
from types import SimpleNamespace
import uuid

import psycopg
from psycopg import sql
import pytest
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from backend.auth import auth_routes
from backend.auth.auth_helper import SessionRole
from backend.billing.activation import BillingActivationService
from backend.billing.service import BillingService
from backend.commercial_policy.admin_drafts import load_legacy_export_capabilities
from backend.commercial_policy.document import build_initial_draft_document, canonical_json
from backend.commercial_policy.repository import CommercialRepository
from backend.commercial_policy.service import CommercialPolicy
from backend.commercial_policy import config as commercial_config
from backend.commercial_policy.tax import calculate_tax_price
from backend.db.db_helper import PostgresCursor, compat_row_factory
from backend.db.postgres_schema import (
    _create_foreign_keys,
    _create_synced_delete_trigger_function,
    _create_trigger_functions,
    assert_foreign_key_integrity,
    build_create_table_sql,
    create_fresh_database,
    create_indexes_and_triggers,
)
from backend.db.upgrades import DatabaseUpgradeContext
from backend.shared.subscription_policy import get_account_subscription, get_organization_subscription


NOW = 1_800_000_000
LEGACY_EXPORTS = {
    "silver": (0, 1, 0), "gold": (1, 0, 1), "diamond": (0, 0, 1),
}


def _test_database_url():
    if value := os.environ.get("TEST_DATABASE_URL"):
        return value
    path = Path(__file__).resolve().parents[1] / ".env"
    if path.is_file():
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            key, separator, value = line.partition("=")
            if separator and key.strip() == "TEST_DATABASE_URL":
                return value.strip().strip('"').strip("'") or None
    return None


@pytest.fixture
def projection_cursor(monkeypatch):
    url = _test_database_url()
    if not url:
        pytest.skip("TEST_DATABASE_URL is required for isolated PostgreSQL projection tests")
    try:
        connection = psycopg.connect(url, connect_timeout=5, row_factory=compat_row_factory)
    except psycopg.Error as error:
        pytest.skip(f"PostgreSQL test database unavailable: {type(error).__name__}")
    monkeypatch.setenv("ADMIN_PASSWORD", "Test-only!CommercialProjectionPassword")
    # Collection of backend.app can load the developer's live payOS settings.
    # These rollback-only tests deliberately bind both quote and checkout to
    # the local fake provider declared by their published release fixture.
    monkeypatch.setenv("COMMERCIAL_PAYMENT_PROVIDER", "fake")
    monkeypatch.setenv("PAYMENT_PROVIDER_ENVIRONMENT", "test")
    cursor = PostgresCursor(connection.cursor())
    try:
        schema = f"bf_plan_bridge_{uuid.uuid4().hex}"
        cursor.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
        cursor.execute(sql.SQL("SET LOCAL search_path TO {}").format(sql.Identifier(schema)))
        context = DatabaseUpgradeContext(
            build_create_table_sql=build_create_table_sql,
            create_indexes_and_triggers=create_indexes_and_triggers,
            assert_foreign_key_integrity=assert_foreign_key_integrity,
            create_foreign_keys=_create_foreign_keys,
            create_trigger_functions=_create_trigger_functions,
            create_synced_delete_trigger_function=_create_synced_delete_trigger_function,
        )
        create_fresh_database(cursor, context)
        for tier, exports in LEGACY_EXPORTS.items():
            cursor.execute(
                """UPDATE goi_dich_vu SET document_export_word = ?,
                       document_export_excel = ?, document_export_award_result_excel = ?
                     WHERE id = ?""", (*exports, tier),
            )
        _account(cursor, "legacy-account")
        cursor.execute(
            """INSERT INTO account_subscriptions
                   (user_id, package_id, source, status, starts_at, expires_at)
               VALUES ('legacy-account', 'gold', 'legacy', 'active', ?, ?)""",
            (NOW - 100, NOW + 100_000),
        )
        yield cursor
    finally:
        # The schema itself was created in this uncommitted transaction.
        connection.rollback()
        connection.close()


def _account(cursor, user_id):
    cursor.execute(
        """INSERT INTO tai_khoan (id, mat_khau, ho_ten, email, email_norm)
           VALUES (?, 'fixture-only-hash', 'Projection Fixture', ?, ?)""",
        (user_id, f"{user_id}@example.test", f"{user_id}@example.test"),
    )


def _document(cursor):
    return build_initial_draft_document(load_legacy_export_capabilities(cursor))


def _publish(cursor, document, *, at=NOW):
    actor = cursor.execute("SELECT id FROM tai_khoan WHERE vai_tro = 'super_admin'").fetchone()[0]
    policy = CommercialPolicy(cursor, clock=lambda: at, include_shadow=True)
    draft = policy.repository.create_draft(document, actor)
    validated = policy.validate_draft(draft["id"], draft["revision"])
    assert validated["errors"] == []
    return policy.publish_draft(
        draft["id"], draft["revision"], validated["validationDigest"],
        at, "Isolated published-plan activation regression", actor,
    )


def _checkout(cursor, offer, *, at=NOW):
    token = uuid.uuid4().hex
    if offer["ownerKind"] == "account":
        actor_id = owner_id = f"buyer-{token}"
        _account(cursor, actor_id)
    else:
        owner_id = f"org-{token}"
        cursor.execute("INSERT INTO to_chuc (id, ten_to_chuc) VALUES (?, 'Projection Org')", (owner_id,))
        actor_id = cursor.execute("SELECT id FROM tai_khoan WHERE vai_tro = 'super_admin'").fetchone()[0]
    actor = SimpleNamespace(
        user_id=actor_id, platform_role="super_admin", active_role="super_admin",
        active_role_organization_id=owner_id,
    )
    snapshot = CommercialPolicy(cursor, clock=lambda: at, include_shadow=True).evaluate_commercial_command(
        {"skuCode": offer["code"], "operation": "purchase"},
        {"ownerKind": offer["ownerKind"], "ownerId": owner_id, "actorRole": "super_admin"},
    )["snapshot"]
    public_quote = f"quote-{token}"
    price = snapshot["price"]
    cursor.execute(
        """INSERT INTO billing_quotes
               (id, public_id, actor_user_id, account_user_id, organization_id,
                owner_kind, operation, request_hash, release_id, release_checksum,
                decision_json, subtotal_amount, tax_amount, total_amount, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, 'purchase', ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            f"billing-quote-{token}", public_quote, actor_id,
            owner_id if offer["ownerKind"] == "account" else None,
            owner_id if offer["ownerKind"] == "organization" else None,
            offer["ownerKind"], "a" * 64, snapshot["releaseId"], snapshot["releaseChecksum"],
            canonical_json(snapshot), price["subtotal"], price["tax"], price["total"], at + 900,
        ),
    )
    order, _, replay = BillingService(
        cursor, clock=lambda: at,
        environment={"COMMERCIAL_PAYMENT_PROVIDER": "fake", "PAYMENT_PROVIDER_ENVIRONMENT": "test"},
    ).create_checkout(actor, public_quote, f"checkout-{token}")
    assert replay is False
    return order, owner_id


def _paid(cursor, order, *, at=NOW):
    return BillingActivationService(cursor, clock=lambda: at).apply_order_result(
        order["id"],
        {"status": "PAID", "orderCode": order["provider_order_code"],
         "amount": order["total_amount"], "reference": f"paid-{order['id']}",
         "transactionDateTime": at},
        provider_profile_id=order["provider_profile_id"],
    )


def _legacy_facts(cursor):
    return {
        "packages": [dict(row) for row in cursor.execute(
            "SELECT * FROM goi_dich_vu WHERE id IN ('free', 'silver', 'gold', 'diamond') ORDER BY id"
        ).fetchall()],
        "organizations": [dict(row) for row in cursor.execute(
            "SELECT * FROM organization_subscriptions WHERE source = 'legacy' ORDER BY organization_id"
        ).fetchall()],
        "accounts": [dict(row) for row in cursor.execute(
            "SELECT * FROM account_subscriptions WHERE user_id = 'legacy-account'"
        ).fetchall()],
        "accountBenefits": get_account_subscription(cursor, "legacy-account"),
    }


@pytest.mark.parametrize("tier", ["personal", "silver", "gold", "diamond"])
@pytest.mark.parametrize("variant", ["internal", "connected"])
def test_published_plan_activates_exact_snapshot_without_changing_legacy_terms(projection_cursor, tier, variant):
    cursor = projection_cursor
    before = _legacy_facts(cursor)
    document = _document(cursor)
    offer = next(row for row in document["offers"] if row["tier"] == tier and row["variant"] == variant)
    release = _publish(cursor, document)
    order, owner_id = _checkout(cursor, offer)

    outcome = _paid(cursor, order)

    assert outcome["status"] == "applied", outcome
    subscription = (
        get_account_subscription(cursor, owner_id)
        if tier == "personal" else get_organization_subscription(cursor, owner_id)
    )
    assert subscription["status"] == "active"
    assert subscription["entitlements"] == offer["exportCapabilities"]
    assert subscription["expires_at"] - subscription["starts_at"] == 365 * 86400
    plan = dict(cursor.execute(
        "SELECT * FROM billing_plan_versions WHERE release_id = ? AND logical_package_code = ?",
        (release["id"], offer["code"]),
    ).fetchone())
    assert plan["legacy_package_id"] == subscription["package_id"]
    assert plan["legacy_package_id"] not in {"free", "silver", "gold", "diamond"}
    adapter = dict(cursor.execute("SELECT * FROM goi_dich_vu WHERE id = ?", (subscription["package_id"],)).fetchone())
    assert adapter["han_muc_nhan_su"] == offer["memberQuota"]
    assert adapter["gia_ca"] == offer["price"]["total"]
    assert plan["member_quota"] == {"personal": 1, "silver": 5, "gold": 15, "diamond": 50}[tier]
    assert plan["included_procurement_quota"] == offer["includedProcurementQuota"]
    if tier != "personal":
        assert subscription["member_quota"] == offer["memberQuota"]
    grant_total = cursor.execute(
        "SELECT COALESCE(SUM(total), 0) FROM usage_credit_grants WHERE order_item_id IN (SELECT id FROM billing_order_items WHERE order_id = ?)",
        (order["id"],),
    ).fetchone()[0]
    assert grant_total == offer["includedProcurementQuota"]
    assert _paid(cursor, order)["status"] == "applied"
    assert _legacy_facts(cursor) == before


def test_new_release_and_stopped_sales_preserve_older_adapter_and_subscription(projection_cursor):
    cursor = projection_cursor
    before = _legacy_facts(cursor)
    document = _document(cursor)
    offer = next(row for row in document["offers"] if row["code"] == "gold.connected.yearly")
    old_release = _publish(cursor, document)
    order, owner_id = _checkout(cursor, offer)
    assert _paid(cursor, order)["status"] == "applied"
    old_subscription = get_organization_subscription(cursor, owner_id)
    old_package = dict(cursor.execute(
        "SELECT * FROM goi_dich_vu WHERE id = ?", (old_subscription["package_id"],)
    ).fetchone())

    newer = deepcopy(document)
    new_offer = next(row for row in newer["offers"] if row["code"] == offer["code"])
    new_offer["memberQuota"] = 23
    new_offer["exportCapabilities"] = {
        "document.export.word": False,
        "document.export.excel": True,
        "document.export.award_result_excel": False,
    }
    new_release = _publish(cursor, newer, at=NOW + 2)
    new_order, new_owner = _checkout(cursor, new_offer, at=NOW + 2)
    assert _paid(cursor, new_order, at=NOW + 2)["status"] == "applied"
    new_subscription = get_organization_subscription(cursor, new_owner)
    assert new_subscription["package_id"] != old_subscription["package_id"]
    assert new_subscription["member_quota"] == 23
    assert new_subscription["entitlements"] == new_offer["exportCapabilities"]
    assert new_release["id"] != old_release["id"]
    actor = cursor.execute("SELECT id FROM tai_khoan WHERE vai_tro = 'super_admin'").fetchone()[0]
    CommercialRepository(cursor, clock=lambda: NOW + 3).stop_sales(
        old_release["id"], actor, effective_at=NOW + 3,
        reason="Stop sales without changing paid terms", scope={},
    )

    assert get_organization_subscription(cursor, owner_id) == old_subscription
    assert dict(cursor.execute(
        "SELECT * FROM goi_dich_vu WHERE id = ?", (old_subscription["package_id"],)
    ).fetchone()) == old_package
    assert _legacy_facts(cursor) == before


def _package_client(cursor, monkeypatch, mode):
    class CallerTransaction:
        """The public route shares this fixture's rollback-only transaction."""

        def cursor(self):
            return PostgresCursor(cursor._cursor.connection.cursor())

        def execute(self, statement, parameters=()):
            if statement != "BEGIN":
                return self.cursor().execute(statement, parameters)
            return None

        def commit(self):
            pass

        def rollback(self):
            pass

        def close(self):
            pass

    actor_id = cursor.execute("SELECT id FROM tai_khoan WHERE vai_tro = 'super_admin'").fetchone()[0]
    actor = SessionRole("super_admin", actor_id, platform_role="super_admin")
    monkeypatch.setattr(auth_routes, "database", SimpleNamespace(get_connection=CallerTransaction))
    monkeypatch.setattr(auth_routes, "verify_session", lambda *args, **kwargs: (True, actor))
    monkeypatch.setattr(auth_routes, "verify_session_in_transaction", lambda *args, **kwargs: (True, actor))
    monkeypatch.setattr(commercial_config, "commercial_runtime_config", lambda: SimpleNamespace(enabled=mode != "off", mode=mode))
    return TestClient(Starlette(routes=[
        Route("/api/system-packages/update", auth_routes.update_system_package_api, methods=["POST"]),
    ]))


@pytest.mark.parametrize("mode", ["off", "shadow"])
def test_admin_cannot_mutate_published_adapter_while_legacy_packages_remain_editable(projection_cursor, monkeypatch, mode):
    cursor = projection_cursor
    document = _document(cursor)
    _publish(cursor, document)
    offer = next(row for row in document["offers"] if row["code"] == "personal.internal.yearly")
    order, owner_id = _checkout(cursor, offer)
    assert _paid(cursor, order)["status"] == "applied"
    before = get_account_subscription(cursor, owner_id)
    body = {"id": before["package_id"], "name": "Changed package", "price": 777,
            "quota": 9, "description": "Changed description", "status": "inactive"}
    with _package_client(cursor, monkeypatch, mode) as client:
        response = client.post("/api/system-packages/update", json=body)
        assert response.status_code == 409
        assert response.json()["code"] == "COMMERCIAL_PACKAGE_IMMUTABLE"
        assert get_account_subscription(cursor, owner_id) == before
        legacy_response = client.post("/api/system-packages/update", json={
            **body, "id": "silver", "status": "active",
        })
        assert legacy_response.status_code == 200
    legacy = cursor.execute("SELECT ten_goi, gia_ca, han_muc_nhan_su FROM goi_dich_vu WHERE id = 'silver'").fetchone()
    assert tuple(legacy) == ("Changed package", 777, 9)


@pytest.mark.parametrize(("inclusive", "expected"), [
    (False, (99_000, 9_900, 108_900)),
    (True, (90_000, 9_000, 99_000)),
])
def test_credit_pack_projection_and_quote_use_same_configured_tax(projection_cursor, inclusive, expected):
    cursor = projection_cursor
    document = _document(cursor)
    document["taxInvoice"].update({
        "taxInclusive": inclusive, "taxBasisPoints": 1_000,
        "rounding": "half_up", "invoiceTrigger": "verified_payment",
    })
    for offer in document["offers"]:
        offer["price"] = calculate_tax_price(
            offer["price"]["total"], document["taxInvoice"], period="yearly",
        )
    release = _publish(cursor, document)
    projected = cursor.execute(
        """SELECT price.subtotal_amount, price.tax_amount, price.total_amount
             FROM billing_prices AS price JOIN billing_skus AS sku ON sku.id = price.sku_id
            WHERE sku.release_id = ? AND sku.sku_code = 'procurement.20'""",
        (release["id"],),
    ).fetchone()

    assert tuple(projected) == expected
    decision = CommercialPolicy(cursor, clock=lambda: NOW, include_shadow=True).evaluate_commercial_command(
        {"skuCode": "procurement.20", "operation": "credit_pack"},
        {"ownerKind": "account", "ownerId": "legacy-account", "actorRole": "super_admin"},
    )["snapshot"]
    price = decision["price"]
    assert (price["subtotal"], price["tax"], price["total"]) == expected
    assert document["creditPacks"][0]["price"] == 99_000
    assert decision["benefits"]["procurementCredits"] == 20
