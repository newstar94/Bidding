import sqlite3

from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from backend.admin import platform_billing_routes, platform_directory_routes
from backend.auth.auth_helper import SessionRole


class _ConnectionProxy:
    def __init__(self, connection):
        self._connection = connection

    def cursor(self):
        return self._connection.cursor()

    def close(self):
        pass


class _DatabaseProxy:
    def __init__(self, connection):
        self._connection = connection

    def get_connection(self):
        return _ConnectionProxy(self._connection)


def _database():
    connection = sqlite3.connect(":memory:", check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        CREATE TABLE tai_khoan (
            id TEXT PRIMARY KEY, ten_dang_nhap TEXT, ho_ten TEXT, email TEXT
        );
        CREATE TABLE to_chuc (id TEXT PRIMARY KEY, ten_to_chuc TEXT NOT NULL);
        CREATE TABLE payment_provider_profiles (
            id TEXT PRIMARY KEY, provider TEXT NOT NULL, environment TEXT NOT NULL
        );
        CREATE TABLE billing_orders (
            id TEXT PRIMARY KEY, public_id TEXT NOT NULL, account_user_id TEXT,
            organization_id TEXT, owner_kind TEXT NOT NULL, operation TEXT NOT NULL,
            subtotal_amount INTEGER NOT NULL, tax_amount INTEGER NOT NULL,
            total_amount INTEGER NOT NULL, currency TEXT NOT NULL,
            checkout_state TEXT NOT NULL, payment_state TEXT NOT NULL,
            activation_state TEXT NOT NULL, checkout_expires_at INTEGER,
            provider_profile_id TEXT, provider_order_code INTEGER,
            provider_reference TEXT NOT NULL, created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE account_subscriptions (
            user_id TEXT PRIMARY KEY, package_id TEXT NOT NULL, plan_version_id TEXT,
            status TEXT NOT NULL, source TEXT NOT NULL, source_order_id TEXT,
            starts_at INTEGER NOT NULL, expires_at INTEGER, revision INTEGER NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE organization_subscriptions (
            organization_id TEXT PRIMARY KEY, package_id TEXT NOT NULL,
            plan_version_id TEXT, status TEXT NOT NULL, source TEXT NOT NULL,
            source_order_id TEXT, starts_at INTEGER NOT NULL, expires_at INTEGER,
            member_quota INTEGER NOT NULL, revision INTEGER NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE payment_transactions (
            id TEXT PRIMARY KEY, order_id TEXT NOT NULL,
            provider_transaction_id TEXT NOT NULL, transaction_type TEXT NOT NULL,
            status TEXT NOT NULL, verified_paid_amount INTEGER NOT NULL,
            fee_amount INTEGER NOT NULL, net_settled_amount INTEGER NOT NULL,
            currency TEXT NOT NULL, payment_timing TEXT NOT NULL,
            provider_occurred_at INTEGER NOT NULL, created_at TEXT NOT NULL
        );
        """
    )
    connection.execute(
        "INSERT INTO tai_khoan VALUES ('user-a', 'alpha', 'Alpha User', 'alpha@example.test')"
    )
    connection.execute("INSERT INTO to_chuc VALUES ('org-b', 'Bravo Org')")
    connection.execute("INSERT INTO payment_provider_profiles VALUES ('provider-1', 'payos', 'live')")
    connection.executemany(
        """INSERT INTO billing_orders VALUES
           (?, ?, ?, ?, ?, ?, ?, ?, ?, 'VND', ?, ?, ?, ?, 'provider-1', ?, ?, ?, ?)""",
        (
            (
                "order-a", "order-public-account", "user-a", None, "account", "purchase",
                100000, 10000, 110000, "open", "verified_paid", "applied", 2000,
                101, "provider-account", "2026-01-01", "2026-01-02",
            ),
            (
                "order-b", "order-public-org", None, "org-b", "organization", "renew",
                200000, 20000, 220000, "open", "unverified", "not_ready", 3000,
                102, "provider-org", "2026-01-03", "2026-01-03",
            ),
        ),
    )
    connection.execute(
        """INSERT INTO account_subscriptions VALUES
           ('user-a', 'business', 'plan-v1', 'active', 'order', 'order-a',
            100, 4102444800, 3, '2026-01-01', '2026-01-02')"""
    )
    connection.execute(
        """INSERT INTO organization_subscriptions VALUES
           ('org-b', 'starter', 'plan-v0', 'expired', 'legacy', NULL,
            10, 20, 5, 1, '2025-01-01', '2025-02-01')"""
    )
    connection.execute(
        """INSERT INTO payment_transactions VALUES
           ('tx-a', 'order-a', 'payos-tx-a', 'payment', 'settled',
            110000, 1000, 109000, 'VND', 'on_time', 1500, '2026-01-02')"""
    )
    connection.commit()
    return connection


def _client(monkeypatch, connection, *, allowed=True):
    role = SessionRole("super_admin", "admin-1", platform_role="super_admin")
    calls = []

    def verify_session(_request, required_role=None):
        calls.append(required_role)
        return (True, role) if allowed else (False, "denied")

    async def run_database_read(function, *args, **kwargs):
        return function(*args, **kwargs)

    monkeypatch.setattr(platform_directory_routes, "verify_session", verify_session)
    monkeypatch.setattr(platform_billing_routes, "run_database_read", run_database_read)
    monkeypatch.setattr(platform_billing_routes, "database", _DatabaseProxy(connection))
    app = Starlette(routes=platform_billing_routes.platform_admin_billing_routes(Route))
    return TestClient(app), calls


def test_subscriptions_are_real_unioned_rows_with_bounded_server_pagination(monkeypatch):
    connection = _database()
    try:
        client, calls = _client(monkeypatch, connection)
        with client:
            response = client.get(
                "/api/admin/subscriptions?ownerKind=account&status=active&pageSize=1&sortBy=updated_at&sortDir=desc"
            )

        assert response.status_code == 200
        assert response.headers["cache-control"] == "private, no-store"
        assert calls == ["super_admin"]
        payload = response.json()
        assert payload["pagination"] == {"page": 1, "pageSize": 1, "totalRows": 1, "totalPages": 1}
        assert payload["items"] == [
            {
                "owner": {
                    "kind": "account", "id": "user-a",
                    "name": "Alpha User", "email": "alpha@example.test",
                },
                "packageId": "business",
                "planVersionId": "plan-v1",
                "status": "active",
                "source": "order",
                "sourceOrderPublicId": "order-public-account",
                "startsAt": 100,
                "expiresAt": 4102444800,
                "memberQuota": None,
                "revision": 3,
                "createdAt": "2026-01-01",
                "updatedAt": "2026-01-02",
            }
        ]
    finally:
        connection.close()


def test_payments_return_orders_and_transactions_with_minor_unit_amounts(monkeypatch):
    connection = _database()
    try:
        client, _calls = _client(monkeypatch, connection)
        with client:
            response = client.get(
                "/api/admin/payments?transactionStatus=settled&sortBy=total_amount&sortDir=desc"
            )

        assert response.status_code == 200
        payload = response.json()
        assert payload["pagination"]["totalRows"] == 1
        item = payload["items"][0]
        assert item["publicId"] == "order-public-account"
        assert item["amounts"] == {
            "subtotalMinor": 100000,
            "taxMinor": 10000,
            "totalMinor": 110000,
            "currency": "VND",
        }
        assert item["provider"] == {
            "name": "payos",
            "environment": "live",
            "reference": "provider-account",
            "orderCode": 101,
        }
        assert item["transactions"] == [
            {
                "id": "tx-a",
                "providerTransactionId": "payos-tx-a",
                "type": "payment",
                "status": "settled",
                "verifiedPaidAmountMinor": 110000,
                "feeAmountMinor": 1000,
                "netSettledAmountMinor": 109000,
                "currency": "VND",
                "paymentTiming": "on_time",
                "providerOccurredAt": 1500,
                "createdAt": "2026-01-02",
            }
        ]
        assert "invoice" not in item
    finally:
        connection.close()


def test_billing_admin_reads_require_server_side_super_admin(monkeypatch):
    connection = _database()
    try:
        client, calls = _client(monkeypatch, connection, allowed=False)
        with client:
            subscriptions = client.get("/api/admin/subscriptions")
            payments = client.get("/api/admin/payments")

        assert subscriptions.status_code == 403
        assert payments.status_code == 403
        assert calls == ["super_admin", "super_admin"]
    finally:
        connection.close()


def test_billing_admin_query_allowlists_reject_invalid_values(monkeypatch):
    connection = _database()
    try:
        client, _calls = _client(monkeypatch, connection)
        with client:
            oversized = client.get("/api/admin/subscriptions?pageSize=101")
            invalid_state = client.get("/api/admin/payments?paymentState=paid")
            injected_sort = client.get(
                "/api/admin/payments?sortBy=created_at%20DESC%3B%20DROP%20TABLE%20billing_orders"
            )

        assert oversized.status_code == 400
        assert invalid_state.status_code == 400
        assert injected_sort.status_code == 400
        assert connection.execute("SELECT count(*) FROM billing_orders").fetchone()[0] == 2
    finally:
        connection.close()
