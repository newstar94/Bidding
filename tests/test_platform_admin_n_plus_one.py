import json
from types import SimpleNamespace

import pytest

from backend.admin import (
    platform_billing_routes,
    platform_directory_routes,
    platform_system_routes,
    security_routes,
)


SCALES = (1, 10, 50, 100)


class _Result:
    def __init__(self, *, row=None, rows=None):
        self.row = row
        self.rows = rows or []

    def fetchone(self):
        return self.row

    def fetchall(self):
        return self.rows


class _TracingCursor:
    def __init__(self, scale):
        self.scale = scale
        self.calls = []
        self.result = _Result()

    def execute(self, statement, parameters=()):
        sql = " ".join(str(statement).split())
        self.calls.append((sql, parameters))
        self.result = self._dispatch(sql)
        return self

    def fetchone(self):
        return self.result.fetchone()

    def fetchall(self):
        return self.result.fetchall()

    def _dispatch(self, sql):
        if "GROUP BY status ORDER BY status" in sql:
            return _Result(rows=[{"status": "pending", "count": self.scale}])
        if "websocket_connection_leases" in sql and "COUNT(*) AS count" in sql:
            return _Result(row={"count": self.scale})
        if "sync_mutations" in sql and "COUNT(*) AS count" in sql:
            return _Result(row={"count": self.scale})
        if "COUNT(*) AS total_rows" in sql:
            return _Result(row={"total_rows": self.scale})
        if "COUNT(*) AS total" in sql:
            return _Result(row={"total": self.scale})
        if "FROM tai_khoan account" in sql and "AS active_session_count" in sql:
            return _Result(row=self._user_detail())
        if "FROM to_chuc organization" in sql and "subscription.plan_version_id" in sql:
            return _Result(row=self._organization_detail())
        if "SELECT COUNT(*) AS count FROM thanh_vien_to_chuc WHERE user_id" in sql:
            return _Result(row={"count": self.scale})
        if "FROM auth_sessions session" in sql and "COUNT(*) AS count" in sql:
            return _Result(row={"count": self.scale})
        if "FROM audit_log" in sql and "ORDER BY created_at DESC" in sql:
            return _Result(rows=[self._detail_audit(index) for index in range(min(self.scale, 10))])
        if "FROM thanh_vien_to_chuc membership" in sql and "MAX(session.last_seen_at)" in sql:
            return _Result(rows=[self._organization_member(index) for index in range(min(self.scale, 20))])
        if "membership.vai_tro_trong_to_chuc IN ('owner', 'manager')" in sql:
            return _Result(rows=[self._organization_contact(index) for index in range(self.scale)])
        if "FROM thanh_vien_to_chuc membership" in sql and "LIMIT ?" in sql:
            return _Result(rows=[self._membership(index) for index in range(min(self.scale, 20))])
        if "FROM thanh_vien_to_chuc membership" in sql:
            return _Result(rows=[self._membership(index) for index in range(self.scale)])
        if "FROM tai_khoan account" in sql and "account.anh_dai_dien" in sql:
            return _Result(rows=[self._user(index) for index in range(self.scale)])
        if "FROM to_chuc organization" in sql and "member_counts.member_count" in sql:
            return _Result(rows=[self._organization(index) for index in range(self.scale)])
        if "FROM product_usage_hourly" in sql:
            return _Result(row={"event_count": self.scale, "last_seen_at": 100})
        if "SELECT subscription.*" in sql:
            return _Result(rows=[self._subscription(index) for index in range(self.scale)])
        if "FROM payment_transactions" in sql:
            return _Result(rows=[self._transaction(index) for index in range(self.scale)])
        if "FROM billing_orders orders" in sql and "orders.subtotal_amount" in sql:
            return _Result(rows=[self._payment(index) for index in range(self.scale)])
        if "FROM audit_log audit" in sql and "audit.chain_id" in sql:
            return _Result(rows=[self._audit(index) for index in range(self.scale)])
        if "FROM document_jobs" in sql and "record_type" in sql:
            return _Result(rows=[self._job(index) for index in range(self.scale)])
        if "FROM websocket_events" in sql and "event_type" in sql:
            return _Result(rows=[self._sync(index) for index in range(self.scale)])
        raise AssertionError(f"Unexpected SQL: {sql}")

    @staticmethod
    def _user(index):
        return {
            "id": f"user-{index}", "username": f"user{index}",
            "name": f"User {index}", "role": "user",
            "email": f"user{index}@example.test", "avatar": None,
            "status": "active", "created_at": "2026-01-01",
            "updated_at": "2026-01-01", "last_active_at": 100,
            "package_id": "business", "plan_version_id": "plan-v1",
            "subscription_status": "active",
        }

    @staticmethod
    def _membership(index):
        return {
            "user_id": f"user-{index}", "id": f"org-{index}",
            "name": f"Organization {index}", "role": "employee",
            "employee_name": f"User {index}", "employee_phone": None,
            "status": "active",
        }

    @staticmethod
    def _organization(index):
        return {
            "id": f"org-{index}", "name": f"Organization {index}",
            "status": "active", "created_at": "2026-01-01",
            "updated_at": "2026-01-01", "member_count": 1,
            "package_id": "business", "subscription_status": "active",
            "starts_at": 1, "expires_at": 4_102_444_800,
            "member_quota": 20, "revision": 1, "last_active_at": 100,
        }

    @staticmethod
    def _organization_contact(index):
        return {
            "organization_id": f"org-{index}", "user_id": f"user-{index}",
            "name": f"User {index}", "email": f"user{index}@example.test",
            "phone": None, "role": "owner",
        }

    @staticmethod
    def _user_detail():
        return {
            "id": "user-1", "username": "user1", "name": "User 1",
            "email": "user1@example.test", "role": "user", "status": "active",
            "created_at": "2026-01-01", "updated_at": "2026-01-01",
            "package_id": "business", "plan_version_id": "plan-v1",
            "subscription_status": "active", "subscription_source": "admin",
            "starts_at": 1, "expires_at": 4_102_444_800, "member_quota": None,
            "subscription_revision": 1, "last_active_at": 100,
            "active_session_count": 1,
        }

    @staticmethod
    def _organization_detail():
        return {
            "id": "org-1", "name": "Organization 1", "status": "active",
            "created_at": "2026-01-01", "updated_at": "2026-01-01",
            "package_id": "business", "plan_version_id": "plan-v1",
            "subscription_status": "active", "subscription_source": "admin",
            "starts_at": 1, "expires_at": 4_102_444_800, "member_quota": 20,
            "subscription_revision": 1, "member_count": 1,
        }

    @staticmethod
    def _organization_member(index):
        return {
            "id": f"user-{index}", "name": f"User {index}",
            "email": f"user{index}@example.test",
            "role": "owner" if index == 0 else "employee",
            "employee_name": f"Employee {index}", "employee_phone": None,
            "membership_status": "active", "last_active_at": 100,
        }

    @staticmethod
    def _detail_audit(index):
        return {
            "id": index + 1, "actor_user_id": "admin-1",
            "organization_id": "org-1", "action": "admin.test",
            "target_type": "test", "target_id": str(index),
            "created_at": "2026-01-01",
        }

    @staticmethod
    def _subscription(index):
        return {
            "owner_kind": "account", "owner_id": f"user-{index}",
            "owner_name": f"User {index}",
            "owner_email": f"user{index}@example.test",
            "package_id": "business", "plan_version_id": "plan-v1",
            "status": "active", "source": "order",
            "source_order_id": f"order-{index}",
            "source_order_public_id": f"public-{index}",
            "starts_at": 1, "expires_at": 4_102_444_800,
            "member_quota": None, "revision": 1,
            "created_at": "2026-01-01", "updated_at": "2026-01-01",
        }

    @staticmethod
    def _payment(index):
        return {
            "id": f"order-{index}", "public_id": f"public-{index}",
            "account_user_id": f"user-{index}", "organization_id": None,
            "owner_kind": "account", "operation": "purchase",
            "subtotal_amount": 100, "tax_amount": 0, "total_amount": 100,
            "currency": "VND", "checkout_state": "open",
            "payment_state": "verified_paid", "activation_state": "applied",
            "checkout_expires_at": 100, "provider_order_code": index,
            "provider_reference": f"reference-{index}",
            "created_at": "2026-01-01", "updated_at": "2026-01-01",
            "account_name": f"User {index}", "organization_name": None,
            "provider": "payos", "provider_environment": "test",
        }

    @staticmethod
    def _transaction(index):
        return {
            "id": f"transaction-{index}", "order_id": f"order-{index}",
            "provider_transaction_id": f"provider-transaction-{index}",
            "transaction_type": "payment", "status": "settled",
            "verified_paid_amount": 100, "fee_amount": 0,
            "net_settled_amount": 100, "currency": "VND",
            "payment_timing": "on_time", "provider_occurred_at": 1,
            "created_at": "2026-01-01",
        }

    @staticmethod
    def _audit(index):
        return {
            "id": index + 1, "chain_id": "global", "sequence": index + 1,
            "actor_user_id": "admin-1", "organization_id": None,
            "action": "admin.test", "target_type": "test",
            "target_id": str(index), "created_at": "2026-01-01",
            "metadata_json": None, "result": "success",
        }

    @staticmethod
    def _job(index):
        return {
            "id": f"job-{index}", "organization_id": f"org-{index}",
            "operation": "render", "record_type": "goi_thau",
            "status": "pending", "attempt_count": 0, "available_at": 1,
            "created_at": 1, "updated_at": 1, "completed_at": None,
            "cancelled_at": None, "expires_at": 100, "progress_phase": "queued",
            "progress_completed_items": 0, "progress_total_items": 1,
            "last_error_code": None,
        }

    @staticmethod
    def _sync(index):
        return {
            "id": index + 1, "organization_id": f"org-{index}",
            "event_type": "broadcast", "status": "pending",
            "attempt_count": 0, "available_at": 1,
            "created_at": "2026-01-01", "dispatched_at": None,
            "delivered_at": None, "last_error_code": None,
        }


class _Connection:
    def __init__(self, cursor):
        self.cursor_value = cursor

    def cursor(self):
        return self.cursor_value

    def close(self):
        pass


class _Database:
    def __init__(self, cursor):
        self.cursor = cursor

    def get_connection(self):
        return _Connection(self.cursor)


def _request():
    return SimpleNamespace(query_params={"page": "1", "pageSize": "100"})


def _detail_request(kind):
    key = "user_id" if kind == "user" else "organization_id"
    return SimpleNamespace(query_params={}, path_params={key: f"{kind}-1"})


def _allow(monkeypatch):
    allowed = lambda _request: (None, "super_admin")
    monkeypatch.setattr(platform_directory_routes, "_forbidden_or_role", allowed)
    monkeypatch.setattr(platform_billing_routes, "_forbidden_or_role", allowed)
    monkeypatch.setattr(security_routes, "_forbidden_or_role", allowed)


CASES = (
    ("users", platform_directory_routes, platform_directory_routes._list_admin_users_sync, 3),
    ("organizations", platform_directory_routes, platform_directory_routes._list_admin_organizations_sync, 3),
    ("subscriptions", platform_billing_routes, platform_billing_routes._list_admin_subscriptions_sync, 2),
    ("payments", platform_billing_routes, platform_billing_routes._list_admin_payments_sync, 3),
    ("audit", security_routes, security_routes._list_admin_audit_sync, 2),
    ("jobs", platform_system_routes, platform_system_routes._read_jobs, 3),
    ("sync", platform_system_routes, platform_system_routes._read_sync, 5),
)


@pytest.mark.parametrize(("name", "module", "operation", "query_budget"), CASES)
def test_platform_admin_query_count_is_constant_at_scale(
    monkeypatch, name, module, operation, query_budget
):
    _allow(monkeypatch)
    observed = []
    for scale in SCALES:
        cursor = _TracingCursor(scale)
        monkeypatch.setattr(module, "database", _Database(cursor))

        result = operation(_request())
        if hasattr(result, "body"):
            assert len(json.loads(result.body)["items"]) == scale, name
        else:
            assert len(result["items"]) == scale, name
        observed.append(len(cursor.calls))

    assert observed == [query_budget] * len(SCALES), name


@pytest.mark.parametrize(
    ("kind", "operation", "collection_key"),
    (
        ("user", platform_directory_routes._user_detail, "organizations"),
        ("organization", platform_directory_routes._organization_detail, "users"),
    ),
)
def test_platform_admin_detail_queries_are_constant_and_collections_are_bounded(
    monkeypatch, kind, operation, collection_key
):
    _allow(monkeypatch)
    observed = []
    for scale in SCALES:
        cursor = _TracingCursor(scale)
        monkeypatch.setattr(platform_directory_routes, "database", _Database(cursor))

        response = operation(_detail_request(kind))
        detail = json.loads(response.body)[kind]
        observed.append(len(cursor.calls))

        assert len(detail[collection_key]) <= 20
        assert len(detail["recentAudit"]) <= 10
        assert any(parameters and parameters[-1] == 20 for _, parameters in cursor.calls)
        assert any(parameters and parameters[-1] == 10 for _, parameters in cursor.calls)

    assert observed == [5] * len(SCALES)
