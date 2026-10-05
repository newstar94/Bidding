"""Billing must resolve membership again, not trust a selected session role."""

import asyncio
import json
import sqlite3
from types import SimpleNamespace

import pytest

from backend.auth.auth_helper import SessionRole
from backend.billing.service import BillingService
from backend.commercial_policy import routes
from backend.commercial_policy.errors import CommercialPolicyError


class _Cursor:
    def __init__(self, connection):
        self.connection = connection
        self.statements = []
        self.result = None

    def execute(self, statement, parameters=()):
        self.statements.append(" ".join(statement.split()))
        self.result = self.connection.execute(
            statement.replace(" FOR UPDATE", "").replace(" FOR SHARE", ""), parameters
        )
        return self

    def fetchone(self):
        return self.result.fetchone()


@pytest.fixture
def cursor():
    connection = sqlite3.connect(":memory:", check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        CREATE TABLE to_chuc (id TEXT PRIMARY KEY, trang_thai TEXT);
        CREATE TABLE tai_khoan (id TEXT PRIMARY KEY, trang_thai TEXT);
        CREATE TABLE thanh_vien_to_chuc (
            user_id TEXT, organization_id TEXT,
            vai_tro_trong_to_chuc TEXT, trang_thai_thanh_vien TEXT
        );
        INSERT INTO to_chuc VALUES ('org-a', 'active');
        INSERT INTO tai_khoan VALUES ('buyer', 'active');
        """
    )
    yield _Cursor(connection)
    connection.close()


def _actor(*, role="manager", platform="user", organization="org-a"):
    return SessionRole(
        role, "buyer", platform_role=platform,
        active_role=role, active_role_organization_id=organization,
    )


@pytest.mark.parametrize("role,status", [("manager", "left"), ("employee", "active"), (None, None)])
def test_checkout_rejects_stale_manager_membership(cursor, role, status):
    if role:
        cursor.execute(
            "INSERT INTO thanh_vien_to_chuc VALUES (?, ?, ?, ?)",
            ("buyer", "org-a", role, status),
        )
    with pytest.raises(CommercialPolicyError) as error:
        BillingService(cursor)._lock_and_authorize_owner(
            _actor(), {"owner_kind": "organization", "organization_id": "org-a"}
        )
    assert error.value.code == "BUYER_NOT_AUTHORIZED"
    assert error.value.status_code == 403


@pytest.mark.parametrize("status", ["active", None])
def test_checkout_keeps_active_manager_and_legacy_membership(cursor, status):
    cursor.execute(
        "INSERT INTO thanh_vien_to_chuc VALUES (?, ?, ?, ?)",
        ("buyer", "org-a", " Manager ", status),
    )
    BillingService(cursor)._lock_and_authorize_owner(
        _actor(), {"owner_kind": "organization", "organization_id": "org-a"}
    )


def test_checkout_keeps_selected_employee_restriction(cursor):
    cursor.execute(
        "INSERT INTO thanh_vien_to_chuc VALUES (?, ?, ?, ?)",
        ("buyer", "org-a", "manager", "active"),
    )
    with pytest.raises(CommercialPolicyError) as error:
        BillingService(cursor)._lock_and_authorize_owner(
            _actor(role="employee"),
            {"owner_kind": "organization", "organization_id": "org-a"},
        )
    assert error.value.code == "BUYER_NOT_AUTHORIZED"


def test_checkout_keeps_existing_platform_admin_authority(cursor):
    BillingService(cursor)._lock_and_authorize_owner(
        _actor(role="employee", platform="super_admin"),
        {"owner_kind": "organization", "organization_id": "org-a"},
    )


def test_checkout_keeps_personal_owner_without_organization_membership(cursor):
    BillingService(cursor)._lock_and_authorize_owner(
        _actor(role="employee", organization=None),
        {"owner_kind": "account", "account_user_id": "buyer"},
    )


@pytest.mark.parametrize("role,status", [("manager", "left"), ("employee", "active"), (None, None)])
def test_quote_rechecks_membership_after_request_authentication(monkeypatch, cursor, role, status):
    if role:
        cursor.execute(
            "INSERT INTO thanh_vien_to_chuc VALUES (?, ?, ?, ?)",
            ("buyer", "org-a", role, status),
        )
    cursor.connection.commit()
    events = []

    class Connection:
        def execute(self, statement):
            return cursor.execute(statement)

        def cursor(self):
            return cursor

        def rollback(self):
            events.append("rollback")
            cursor.connection.rollback()

        def close(self):
            pass

    async def body():
        return {"ownerKind": "organization", "ownerId": "org-a", "skuCode": "plan"}

    class Policy:
        def __init__(self, _cursor):
            pass

        def evaluate_commercial_command(self, *_args):
            events.append("policy")
            raise CommercialPolicyError("REACHED_POLICY", "Must authorize before pricing.")

    monkeypatch.setattr(routes, "commercial_runtime_config", lambda: SimpleNamespace(enabled=True, mode="enforce"))
    monkeypatch.setattr(routes, "verify_session", lambda _request: (True, _actor()))
    monkeypatch.setattr(routes, "verify_session_in_transaction", lambda *_args: (True, _actor()))
    monkeypatch.setattr(routes.database, "get_connection", Connection)
    monkeypatch.setattr(routes, "CommercialPolicy", Policy)

    response = asyncio.run(routes.create_billing_quote_api(SimpleNamespace(json=body)))

    assert response.status_code == 403
    assert json.loads(response.body)["code"] == "BUYER_NOT_AUTHORIZED"
    assert events == ["rollback"]
    assert not any("FROM to_chuc" in sql and "FOR UPDATE" in sql for sql in cursor.statements)
    assert any("FROM thanh_vien_to_chuc" in sql and "FOR SHARE" in sql for sql in cursor.statements)
