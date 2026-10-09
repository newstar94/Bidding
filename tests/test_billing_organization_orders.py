"""Individual organization orders follow the approved creator/owner grant."""

import asyncio
import json
import sqlite3
from types import SimpleNamespace

import pytest

from backend.auth.auth_helper import SessionRole
from backend.billing import routes
from backend.billing.service import BillingService, ProviderCommandExecutor
from backend.commercial_policy.errors import CommercialPolicyError


class _Connection:
    def __init__(self, raw):
        self.raw = raw
        self.statements = []
        self.audit = []
        self.commits = 0
        self.rollbacks = 0

    def execute(self, statement, parameters=()):
        self.statements.append(" ".join(statement.split()))
        statement = statement.replace(" FOR UPDATE OF command SKIP LOCKED", "")
        statement = statement.replace(" FOR UPDATE OF orders", "").replace(" FOR UPDATE", "")
        return self.raw.execute(statement, parameters)

    def cursor(self):
        return self

    def commit(self):
        self.commits += 1
        self.raw.commit()

    def rollback(self):
        self.rollbacks += 1
        self.raw.rollback()

    def close(self):
        pass


@pytest.fixture
def order_db():
    raw = sqlite3.connect(":memory:", check_same_thread=False)
    raw.row_factory = sqlite3.Row
    raw.executescript("""
      CREATE TABLE tai_khoan (id TEXT PRIMARY KEY);
      INSERT INTO tai_khoan VALUES ('creator'), ('owner'), ('manager'), ('stranger'), ('admin');
      CREATE TABLE to_chuc (id TEXT PRIMARY KEY, trang_thai TEXT, owner_user_id TEXT);
      INSERT INTO to_chuc VALUES ('org-a', 'active', 'owner'), ('org-b', 'active', 'stranger');
      CREATE TABLE thanh_vien_to_chuc (
        user_id TEXT, organization_id TEXT, trang_thai_thanh_vien TEXT,
        vai_tro_trong_to_chuc TEXT
      );
      INSERT INTO thanh_vien_to_chuc VALUES
        ('creator', 'org-a', 'active', 'manager'), ('owner', 'org-a', 'active', 'manager'),
        ('manager', 'org-a', 'active', 'manager'), ('stranger', 'org-b', 'active', 'manager');
      CREATE TABLE billing_orders (
        id TEXT PRIMARY KEY, public_id TEXT, owner_kind TEXT, account_user_id TEXT,
        organization_id TEXT, actor_user_id TEXT, operation TEXT, subtotal_amount INTEGER,
        tax_amount INTEGER, total_amount INTEGER, currency TEXT, checkout_state TEXT,
        payment_state TEXT, activation_state TEXT, provider_reference TEXT,
        provider_profile_id TEXT, provider_order_code INTEGER, checkout_url TEXT,
        checkout_expires_at INTEGER, revision INTEGER, updated_at TEXT
      );
      INSERT INTO billing_orders VALUES (
        'order-id', 'org-public', 'organization', NULL, 'org-a', 'creator', 'purchase',
        2000, 0, 2000, 'VND', 'open', 'unverified', 'not_ready', 'bf-order', 'profile',
        123, 'https://checkout.example/link', 1800000900, 1, NULL
      );
      INSERT INTO billing_orders VALUES (
        'personal-id', 'personal-public', 'account', 'creator', NULL, 'creator', 'purchase',
        2000, 0, 2000, 'VND', 'open', 'unverified', 'not_ready', 'bf-personal', 'profile',
        124, NULL, 1800000900, 1, NULL
      );
      CREATE TABLE billing_subscription_activations (order_id TEXT, after_json TEXT);
      CREATE TABLE billing_provider_commands (
        id TEXT PRIMARY KEY, order_id TEXT, command_type TEXT, provider_reference TEXT,
        request_json TEXT, status TEXT, attempt_count INTEGER DEFAULT 0,
        available_at INTEGER, locked_by TEXT, lease_expires_at INTEGER,
        last_error_code TEXT, updated_at TEXT
      );
      CREATE TABLE commercial_outbox (
        id TEXT, event_type TEXT, aggregate_type TEXT, aggregate_id TEXT,
        payload_json TEXT, available_at INTEGER
      );
      CREATE TABLE payment_provider_profiles (
        id TEXT PRIMARY KEY, provider TEXT, credential_reference TEXT,
        timeout_ms INTEGER, max_attempts INTEGER, checkout_ttl_seconds INTEGER
      );
      INSERT INTO payment_provider_profiles VALUES ('profile', 'fake', 'env://fake/default', 5000, 3, 900);
    """)
    connection = _Connection(raw)
    yield connection
    raw.close()


def _actor(user_id="creator", *, organization="org-a", role="manager", platform="user"):
    return SessionRole(
        role, user_id, platform_role=platform, active_role=role,
        active_role_organization_id=organization,
    )


def _request(public_id="org-public", reason="Popup closed"):
    async def body():
        return {"reason": reason}

    return SimpleNamespace(path_params={"public_id": public_id}, json=body)


def _install_http(monkeypatch, connection, actor, *, final_actor=None, authenticated=True):
    monkeypatch.setattr(routes.database, "get_connection", lambda: connection)
    monkeypatch.setattr(routes, "verify_session", lambda _request: (True, actor))

    def transaction_auth(cursor, _request):
        cursor.execute("SELECT id FROM tai_khoan WHERE id = ? FOR UPDATE", (actor.user_id,))
        return (True, final_actor or actor) if authenticated else (False, "Phiên bị thu hồi.")

    monkeypatch.setattr(routes, "verify_session_in_transaction", transaction_auth)
    monkeypatch.setattr(routes, "log_audit", lambda _event, **data: connection.audit.append(data))
    provider_calls = []

    class Provider:
        def cancel_payment(self, identifier, reason):
            provider_calls.append((identifier, reason))
            return {"orderCode": identifier, "amount": 2000, "status": "CANCELLED"}

    executor = ProviderCommandExecutor(
        SimpleNamespace(get_connection=lambda: connection),
        clock=lambda: 1800000000, environment={}, providers={"profile": Provider()},
    )

    async def execute(command_id):
        return executor.execute(command_id)

    monkeypatch.setattr(routes, "_execute_provider_command", execute)
    return provider_calls


@pytest.mark.parametrize("user_id,role,platform", [
    ("creator", "manager", "user"), ("creator", "employee", "user"),
    ("owner", "manager", "user"), ("owner", "employee", "user"),
    ("admin", "employee", "super_admin"),
])
def test_status_and_cancel_allow_creator_owner_and_existing_admin_exception(
    monkeypatch, order_db, user_id, role, platform,
):
    actor = _actor(user_id, role=role, platform=platform)
    calls = _install_http(monkeypatch, order_db, actor)
    status = asyncio.run(routes.get_personal_order_api(_request()))
    assert status.status_code == 200
    assert json.loads(status.body)["order"]["ownerKind"] == "organization"
    order_db.statements.clear()

    cancel = asyncio.run(routes.cancel_personal_order_api(_request()))
    assert cancel.status_code == 200
    assert json.loads(cancel.body)["order"]["checkoutState"] == "cancelled"
    assert calls == [(123, "Popup closed")]
    assert order_db.audit[0]["organization_id"] == "org-a"
    owner_lock = next(i for i, sql in enumerate(order_db.statements) if "to_chuc" in sql and "FOR UPDATE" in sql)
    account_lock = next(i for i, sql in enumerate(order_db.statements) if "tai_khoan" in sql and "FOR UPDATE" in sql)
    order_lock = next(i for i, sql in enumerate(order_db.statements) if "billing_orders" in sql and "FOR UPDATE" in sql)
    command_lock = next(i for i, sql in enumerate(order_db.statements) if "FOR UPDATE OF command" in sql)
    assert owner_lock < account_lock < order_lock < command_lock


@pytest.mark.parametrize("actor", [
    _actor("manager"), _actor("stranger"), _actor("creator", organization="org-b"),
    _actor("admin", organization="org-b", platform="super_admin"),
    _actor("creator", organization=None), _actor("creator", role=None),
])
def test_ungranted_and_cross_workspace_actors_cannot_read_or_cancel(monkeypatch, order_db, actor):
    calls = _install_http(monkeypatch, order_db, actor)
    for endpoint in (routes.get_personal_order_api, routes.cancel_personal_order_api):
        response = asyncio.run(endpoint(_request()))
        assert response.status_code == 404
        assert json.loads(response.body)["code"] == "NOT_FOUND"
    assert calls == []
    assert order_db.audit == []
    assert order_db.execute("SELECT COUNT(*) FROM billing_provider_commands").fetchone()[0] == 0


@pytest.mark.parametrize("user_id", ["creator", "owner"])
@pytest.mark.parametrize("membership_status", ["left", "inactive", "invited"])
def test_creator_and_owner_require_current_membership(monkeypatch, order_db, user_id, membership_status):
    order_db.execute("UPDATE thanh_vien_to_chuc SET trang_thai_thanh_vien=? WHERE user_id=?", (membership_status, user_id))
    order_db.commit()
    calls = _install_http(monkeypatch, order_db, _actor(user_id))
    for endpoint in (routes.get_personal_order_api, routes.cancel_personal_order_api):
        assert asyncio.run(endpoint(_request())).status_code == 404
    assert not calls


@pytest.mark.parametrize("owner_id", [None, "", "manager"])
def test_owner_identity_comes_from_organization_not_manager_role(order_db, owner_id):
    order_db.execute("UPDATE to_chuc SET owner_user_id=? WHERE id='org-a'", (owner_id,))
    service = BillingService(order_db)
    assert (service.get_order_for_actor("org-public", _actor("owner")) is None)
    assert service.get_order_for_actor("org-public", _actor("creator")) is not None
    assert (service.get_order_for_actor("org-public", _actor("manager")) is not None) == (owner_id == "manager")


@pytest.mark.parametrize("platform", ["user", "super_admin"])
def test_inactive_organization_never_grants_order_access(order_db, platform):
    order_db.execute("UPDATE to_chuc SET trang_thai='inactive' WHERE id='org-a'")
    actor = _actor("creator", platform=platform)
    service = BillingService(order_db)
    assert service.get_order_for_actor("org-public", actor) is None
    assert service.request_cancel("org-public", actor, "Popup closed") == (None, None, False)


def test_legacy_active_membership_and_cancel_replay_keep_one_intent(order_db):
    order_db.execute("UPDATE thanh_vien_to_chuc SET trang_thai_thanh_vien=NULL WHERE user_id='creator'")
    service = BillingService(order_db, clock=lambda: 1800000000)
    first = service.request_cancel("org-public", _actor(), "Popup closed")
    second = service.request_cancel("org-public", _actor("owner"), "Esc pressed")
    assert first[1] == second[1]
    assert (first[2], second[2]) == (False, True)
    assert order_db.execute("SELECT COUNT(*) FROM billing_provider_commands").fetchone()[0] == 1
    assert json.loads(order_db.execute("SELECT request_json FROM billing_provider_commands").fetchone()[0])["reason"] == "Popup closed"


def test_personal_status_and_cancel_stay_owner_scoped(monkeypatch, order_db):
    calls = _install_http(monkeypatch, order_db, _actor(organization=None))
    assert asyncio.run(routes.get_personal_order_api(_request("personal-public"))).status_code == 200
    assert asyncio.run(routes.cancel_personal_order_api(_request("personal-public"))).status_code == 200
    assert calls == [(124, "Popup closed")]
    assert BillingService(order_db).get_order_for_actor("personal-public", _actor("owner", organization=None)) is None
    assert BillingService(order_db).get_order_for_actor("personal-public", _actor()) is None


def test_revoked_session_and_changed_workspace_abort_cancel_before_provider(monkeypatch, order_db):
    for final_actor, authenticated in [(_actor(), False), (_actor(organization="org-b"), True)]:
        calls = _install_http(monkeypatch, order_db, _actor(), final_actor=final_actor, authenticated=authenticated)
        response = asyncio.run(routes.cancel_personal_order_api(_request()))
        assert response.status_code == 403
        assert not calls
        assert order_db.execute("SELECT COUNT(*) FROM billing_provider_commands").fetchone()[0] == 0


def test_verified_payment_cannot_be_cancelled_by_creator_or_owner(monkeypatch, order_db):
    order_db.execute("UPDATE billing_orders SET payment_state='verified_paid' WHERE id='order-id'")
    order_db.commit()
    for user_id in ("creator", "owner"):
        calls = _install_http(monkeypatch, order_db, _actor(user_id))
        response = asyncio.run(routes.cancel_personal_order_api(_request()))
        assert response.status_code == 409
        assert json.loads(response.body)["code"] == "TRANSITION_NOT_ALLOWED"
        assert not calls
    assert order_db.execute("SELECT payment_state FROM billing_orders WHERE id='order-id'").fetchone()[0] == "verified_paid"


def test_organization_usage_balance_still_requires_separate_business_decision(monkeypatch, order_db):
    _install_http(monkeypatch, order_db, _actor("owner"))
    response = asyncio.run(routes.get_usage_balance_api(_request()))
    assert response.status_code == 409
    assert json.loads(response.body)["code"] == "BLOCKED_DECISION"


def test_non_creator_manager_cannot_bypass_grant_via_service(order_db):
    service = BillingService(order_db)
    assert service.request_cancel("org-public", _actor("manager"), "Popup closed") == (None, None, False)
    with pytest.raises(CommercialPolicyError):
        order_db.execute("UPDATE billing_orders SET payment_state='verified_paid' WHERE id='order-id'")
        service.request_cancel("org-public", _actor("creator"), "Popup closed")
