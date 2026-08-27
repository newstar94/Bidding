import asyncio
import json
from types import SimpleNamespace

from backend.billing import routes


class _Connection:
    def __init__(self, rows):
        self.rows = rows
        self.statement = ""
        self.parameters = ()
        self.closed = False

    def execute(self, statement, parameters=()):
        self.statement = statement
        self.parameters = parameters
        return self

    def fetchall(self):
        return self.rows

    def close(self):
        self.closed = True


def test_personal_history_stays_account_scoped_in_organization_context(monkeypatch):
    connection = _Connection([{
        "public_id": "order-personal-00000001",
        "owner_kind": "account",
        "operation": "credit_pack",
        "subtotal_amount": 99_000,
        "tax_amount": 0,
        "total_amount": 99_000,
        "currency": "VND",
        "checkout_state": "open",
        "payment_state": "unverified",
        "activation_state": "not_ready",
        "checkout_url": None,
        "checkout_expires_at": None,
        "created_at": "2026-08-27 09:30:00",
        "updated_at": "2026-08-27 09:30:00",
    }])
    actor = SimpleNamespace(
        user_id="user-current",
        active_role_organization_id="organization-active",
    )
    monkeypatch.setattr(routes, "verify_session", lambda _request: (True, actor))
    monkeypatch.setattr(
        routes.database,
        "get_connection",
        lambda: connection,
    )

    response = asyncio.run(routes.list_personal_orders_api(SimpleNamespace()))
    payload = json.loads(response.body)

    assert response.status_code == 200
    assert payload["orders"][0]["ownerKind"] == "account"
    assert "owner_kind = 'account'" in connection.statement
    assert "account_user_id = ?" in connection.statement
    assert connection.parameters == ("user-current",)
    assert connection.closed is True


def test_payment_redirects_return_to_account_purchase_history():
    success = asyncio.run(routes.payment_result_page(SimpleNamespace()))
    cancelled = asyncio.run(routes.payment_cancel_page(SimpleNamespace()))

    assert success.headers["location"] == "/trang-ca-nhan?payment=result"
    assert cancelled.headers["location"] == "/trang-ca-nhan?payment=cancelled"
