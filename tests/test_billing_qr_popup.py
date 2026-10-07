"""Popup checkout payload and cancellation races without payment network calls."""

import base64
import json
import sqlite3
from types import SimpleNamespace
import xml.etree.ElementTree as ET

import pytest

from backend.billing.providers.base import PaymentProviderError
from backend.billing.service import BillingService, ProviderCommandExecutor, public_order_payload
from backend.commercial_policy.errors import CommercialPolicyError


NOW = 1_800_000_000
DETAILS = {
    "qrCode": "00020101021238540010A0000007270124000697041501101234567890",
    "bin": "970415", "accountNumber": "1234567890",
    "accountName": "TEST MERCHANT", "description": "ORDERTEST",
}


class _Connection:
    def __init__(self, raw):
        self.raw = raw
        self.statements = []

    def execute(self, statement, parameters=()):
        self.statements.append(" ".join(statement.split()))
        statement = statement.replace(" FOR UPDATE OF command SKIP LOCKED", "")
        statement = statement.replace(" FOR UPDATE OF orders", "").replace(" FOR UPDATE", "")
        return self.raw.execute(statement, parameters)

    def cursor(self):
        return self

    def commit(self):
        self.raw.commit()

    def rollback(self):
        self.raw.rollback()

    def close(self):
        pass


@pytest.fixture
def checkout_db():
    raw = sqlite3.connect(":memory:")
    raw.row_factory = sqlite3.Row
    raw.executescript("""
      CREATE TABLE tai_khoan (id TEXT PRIMARY KEY);
      INSERT INTO tai_khoan VALUES ('buyer');
      CREATE TABLE payment_provider_profiles (
        id TEXT PRIMARY KEY, provider TEXT, credential_reference TEXT,
        timeout_ms INTEGER, max_attempts INTEGER, checkout_ttl_seconds INTEGER
      );
      INSERT INTO payment_provider_profiles VALUES ('profile', 'payos', 'env://payos/default', 5000, 3, 900);
      CREATE TABLE billing_orders (
        id TEXT PRIMARY KEY, public_id TEXT, owner_kind TEXT, account_user_id TEXT,
        organization_id TEXT, operation TEXT, subtotal_amount INTEGER, tax_amount INTEGER,
        total_amount INTEGER, currency TEXT, checkout_state TEXT, payment_state TEXT,
        activation_state TEXT, provider_reference TEXT, provider_profile_id TEXT,
        provider_order_code INTEGER, checkout_url TEXT, checkout_expires_at INTEGER,
        checkout_payment_json TEXT, revision INTEGER, updated_at TEXT
      );
      INSERT INTO billing_orders VALUES (
        'order-id', 'order-public', 'account', 'buyer', NULL, 'purchase', 2000, 0,
        2000, 'VND', 'creating', 'unverified', 'not_ready', 'bf-order', 'profile',
        123, NULL, 1800000900, NULL, 1, NULL
      );
      CREATE TABLE billing_provider_commands (
        id TEXT PRIMARY KEY, order_id TEXT, command_type TEXT, provider_reference TEXT,
        request_json TEXT, status TEXT, attempt_count INTEGER, available_at INTEGER,
        locked_by TEXT, lease_expires_at INTEGER, last_error_code TEXT, updated_at TEXT
      );
      INSERT INTO billing_provider_commands VALUES (
        'create', 'order-id', 'create_checkout', 'bf-order', '{"orderCode":123,"amount":2000}',
        'processing', 1, 1800000000, 'lease', 1800000060, NULL, NULL
      );
      CREATE TABLE billing_subscription_activations (order_id TEXT, after_json TEXT);
      CREATE TABLE commercial_outbox (
        id TEXT, event_type TEXT, aggregate_type TEXT, aggregate_id TEXT,
        payload_json TEXT, available_at INTEGER
      );
    """)
    connection = _Connection(raw)
    database = SimpleNamespace(get_connection=lambda: connection)
    yield database, connection
    raw.close()


def _claimed(command_type="create_checkout", command_id="create"):
    return {
        "id": command_id, "order_id": "order-id", "public_id": "order-public",
        "provider_profile_id": "profile", "provider_order_code": 123,
        "total_amount": 2000, "command_type": command_type, "lock_token": "lease",
        "attempt_count": 1, "checkout_ttl_seconds": 900, "max_attempts": 3,
    }


def _pending_result(**fields):
    return {"status": "PENDING", "orderCode": 123, "amount": 2000,
            "checkoutUrl": "https://pay.payos.vn/web/link", **fields}


def test_checkout_completion_persists_qr_and_reloads_local_image(checkout_db):
    database, connection = checkout_db
    executor = ProviderCommandExecutor(database, clock=lambda: NOW, environment={})
    executor._complete(_claimed(), _pending_result(**DETAILS, apiKey="must-not-project"))
    order = executor._read_order("order-public")
    assert json.loads(order["checkout_payment_json"]) == DETAILS
    assert connection.execute("SELECT request_json FROM billing_provider_commands WHERE id='create'").fetchone()[0] == '{"orderCode":123,"amount":2000}'
    payload = public_order_payload(order)
    assert {key: payload["paymentDetails"][key] for key in DETAILS} == DETAILS
    image = payload["paymentDetails"]["qrCodeImage"]
    assert image.startswith("data:image/svg+xml;base64,")
    svg = ET.fromstring(base64.b64decode(image.split(",", 1)[1]))
    assert svg.tag == "{http://www.w3.org/2000/svg}svg"
    assert svg.find("{http://www.w3.org/2000/svg}path") is not None
    assert "must-not-project" not in json.dumps(payload)


@pytest.mark.parametrize("metadata", [None, "invalid-json", "[]", '{"qrCode":false}'])
def test_legacy_or_invalid_qr_metadata_does_not_break_order_payload(checkout_db, metadata):
    database, connection = checkout_db
    connection.execute("UPDATE billing_orders SET checkout_payment_json=?", (metadata,))
    connection.commit()
    assert public_order_payload(ProviderCommandExecutor(database)._read_order("order-public"))["paymentDetails"] is None


@pytest.mark.parametrize("terminal", ["cancelled", "expired"])
def test_late_create_completion_never_reopens_terminal_checkout(checkout_db, terminal):
    database, connection = checkout_db
    connection.execute("UPDATE billing_orders SET checkout_state=?", (terminal,))
    connection.commit()
    executor = ProviderCommandExecutor(database, clock=lambda: NOW, environment={})
    executor._complete(_claimed(), _pending_result(**DETAILS))
    assert executor._read_order("order-public")["checkout_state"] == terminal


def test_provider_query_does_not_erase_original_qr(checkout_db):
    database, connection = checkout_db
    executor = ProviderCommandExecutor(database, clock=lambda: NOW, environment={})
    executor._complete(_claimed(), _pending_result(**DETAILS))
    connection.execute("INSERT INTO billing_provider_commands VALUES ('query','order-id','query_order','bf-order','{}','processing',1,1800000000,'lease',1800000060,NULL,NULL)")
    connection.commit()
    executor._complete(_claimed("query_order", "query"), _pending_result())
    assert json.loads(executor._read_order("order-public")["checkout_payment_json"]) == DETAILS


def test_cancel_waits_for_create_command_to_finish(checkout_db):
    database, connection = checkout_db
    connection.execute("INSERT INTO billing_provider_commands VALUES ('cancel','order-id','cancel_checkout','bf-order','{" + '"identifier":123' + "}','pending',0,1800000000,NULL,NULL,NULL,NULL)")
    connection.commit()
    executor = ProviderCommandExecutor(database, clock=lambda: NOW, environment={})
    assert executor._claim("cancel") is None
    connection.execute("UPDATE billing_provider_commands SET status='completed' WHERE id='create'")
    connection.commit()
    assert executor._claim("cancel")["command_type"] == "cancel_checkout"


def test_cancel_failure_does_not_label_checkout_creation_failed(checkout_db):
    database, connection = checkout_db
    connection.execute("INSERT INTO billing_provider_commands VALUES ('cancel','order-id','cancel_checkout','bf-order','{}','processing',1,1800000000,'lease',1800000060,NULL,NULL)")
    connection.commit()
    executor = ProviderCommandExecutor(database, clock=lambda: NOW, environment={})
    executor._fail(_claimed("cancel_checkout", "cancel"), PaymentProviderError("PROVIDER_NOT_FOUND", "Not found"))
    assert executor._read_order("order-public")["checkout_state"] == "creating"


def test_cancel_replay_is_idempotent_and_owner_lock_precedes_order_lock(checkout_db):
    _database, connection = checkout_db
    connection.execute("UPDATE billing_orders SET checkout_state='cancelled'")
    connection.execute("INSERT INTO billing_provider_commands VALUES ('cancel','order-id','cancel_checkout','bf-order','{}','completed',1,1800000000,NULL,NULL,NULL,NULL)")
    connection.commit()
    order, command_id, replayed = BillingService(connection, clock=lambda: NOW).request_cancel("order-public", "buyer", "Popup closed")
    assert (order["checkout_state"], command_id, replayed) == ("cancelled", "cancel", True)
    owner_lock = next(index for index, statement in enumerate(connection.statements) if "tai_khoan" in statement and "FOR UPDATE" in statement)
    order_lock = next(index for index, statement in enumerate(connection.statements) if "billing_orders" in statement and "FOR UPDATE" in statement)
    assert owner_lock < order_lock


def test_cancel_cannot_relabel_verified_payment(checkout_db):
    _database, connection = checkout_db
    connection.execute("UPDATE billing_orders SET payment_state='verified_paid', checkout_state='open'")
    connection.commit()
    with pytest.raises(CommercialPolicyError) as error:
        BillingService(connection).request_cancel("order-public", "buyer", "Popup closed")
    assert error.value.code == "TRANSITION_NOT_ALLOWED"


@pytest.mark.parametrize("checkout_state", ["open", "creating"])
def test_explicit_cancel_retry_rearms_same_dead_command_without_rewriting_intent(checkout_db, checkout_state):
    _database, connection = checkout_db
    original_request = '{"identifier":123,"reason":"Popup closed"}'
    connection.execute("UPDATE billing_orders SET checkout_state=?", (checkout_state,))
    connection.execute("INSERT INTO billing_provider_commands VALUES ('cancel','order-id','cancel_checkout','bf-order',?,'dead',3,1800000100,NULL,NULL,'PROVIDER_TRANSPORT_FAILED',NULL)", (original_request,))
    connection.commit()
    order, command_id, replayed = BillingService(connection, clock=lambda: NOW).request_cancel("order-public", "buyer", "Retry cancel")
    row = connection.execute("SELECT status, attempt_count, available_at, request_json FROM billing_provider_commands WHERE id='cancel'").fetchone()
    assert tuple(row) == ("pending", 3, NOW, original_request)
    assert (order["checkout_state"], command_id, replayed) == (checkout_state, "cancel", True)
    assert connection.execute("SELECT COUNT(*) FROM billing_provider_commands WHERE command_type='cancel_checkout'").fetchone()[0] == 1


def test_rearmed_cancel_queries_unknown_previous_result_before_another_mutation(checkout_db):
    database, connection = checkout_db
    connection.execute("UPDATE billing_orders SET checkout_state='open'")
    connection.execute("UPDATE billing_provider_commands SET status='completed' WHERE id='create'")
    connection.execute("INSERT INTO billing_provider_commands VALUES ('cancel','order-id','cancel_checkout','bf-order','{\"identifier\":123}','dead',3,1800000100,NULL,NULL,'PROVIDER_TRANSPORT_FAILED',NULL)")
    connection.commit()
    _, command_id, _ = BillingService(connection, clock=lambda: NOW).request_cancel("order-public", "buyer", "Retry cancel")
    connection.commit()

    class AlreadyCancelledProvider:
        queries = 0

        def get_payment(self, identifier):
            self.queries += 1
            assert identifier == 123
            return {"orderCode": 123, "amount": 2000, "status": "CANCELLED"}

        def cancel_payment(self, *_args):
            pytest.fail("A confirmed cancellation must not be sent again.")

    provider = AlreadyCancelledProvider()
    order = ProviderCommandExecutor(database, clock=lambda: NOW, environment={}, providers={"profile": provider}).execute(command_id)
    assert order["checkout_state"] == "cancelled"
    assert provider.queries == 1
    assert connection.execute("SELECT status FROM billing_provider_commands WHERE id='cancel'").fetchone()[0] == "completed"


@pytest.mark.parametrize("command_state", ["pending", "processing", "completed"])
def test_cancel_replay_does_not_rearm_in_progress_or_completed_command(checkout_db, command_state):
    _database, connection = checkout_db
    connection.execute("UPDATE billing_orders SET checkout_state='open'")
    connection.execute("INSERT INTO billing_provider_commands VALUES ('cancel','order-id','cancel_checkout','bf-order','{}',?,3,1800000100,'existing-lease',1800000200,NULL,NULL)", (command_state,))
    connection.commit()
    BillingService(connection, clock=lambda: NOW).request_cancel("order-public", "buyer", "Retry cancel")
    row = connection.execute("SELECT status, attempt_count, available_at, locked_by FROM billing_provider_commands WHERE id='cancel'").fetchone()
    assert tuple(row) == (command_state, 3, NOW + 100, "existing-lease")


@pytest.mark.parametrize("checkout_state", ["cancelled", "expired"])
def test_terminal_checkout_replay_does_not_rearm_a_dead_cancel(checkout_db, checkout_state):
    _database, connection = checkout_db
    connection.execute("UPDATE billing_orders SET checkout_state=?", (checkout_state,))
    connection.execute("INSERT INTO billing_provider_commands VALUES ('cancel','order-id','cancel_checkout','bf-order','{}','dead',3,1800000100,NULL,NULL,'PROVIDER_TRANSPORT_FAILED',NULL)")
    connection.commit()
    order, command_id, replayed = BillingService(connection, clock=lambda: NOW).request_cancel("order-public", "buyer", "Retry cancel")
    assert (order["checkout_state"], command_id, replayed) == (checkout_state, "cancel", True)
    assert connection.execute("SELECT status FROM billing_provider_commands WHERE id='cancel'").fetchone()[0] == "dead"
