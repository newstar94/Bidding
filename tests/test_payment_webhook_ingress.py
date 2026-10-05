import asyncio
import json
import os
import sqlite3
import uuid
from types import SimpleNamespace

import psycopg
from psycopg import sql
import pytest

from backend.billing import webhook
from backend.billing.providers.payos import (
    PayOSCredentials,
    PayOSPaymentProvider,
    sign_signed_data,
)
from backend.billing.runtime import PaymentProviderRegistry
from backend.db.db_helper import PostgresCursor, compat_row_factory


CHECKSUM_KEY = "isolated-webhook-test-checksum"


class WebhookConnection(sqlite3.Connection):
    def execute(self, statement, parameters=()):
        return super().execute(statement.replace(" FOR UPDATE", ""), parameters)

    def __exit__(self, *args):
        try:
            return super().__exit__(*args)
        finally:
            self.close()


class WebhookDatabase:
    def __init__(self, path):
        self.path = path

    def get_connection(self):
        connection = sqlite3.connect(self.path, factory=WebhookConnection)
        connection.row_factory = sqlite3.Row
        return connection


class PostgresWebhookConnection:
    def __init__(self, connection):
        self.connection = connection

    def execute(self, statement, parameters=None):
        return PostgresCursor(self.connection.cursor()).execute(statement, parameters)

    def commit(self):
        self.connection.commit()

    def rollback(self):
        self.connection.rollback()

    def close(self):
        self.connection.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, *_args):
        try:
            if exc_type is None:
                self.commit()
            else:
                self.rollback()
        finally:
            self.close()


class PostgresWebhookDatabase:
    def __init__(self, url):
        self.url = url
        self.schema = "webhook_test_" + uuid.uuid4().hex
        with psycopg.connect(url, autocommit=True) as connection:
            connection.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(self.schema)))

    def get_connection(self):
        connection = psycopg.connect(self.url, autocommit=True, row_factory=compat_row_factory)
        connection.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(self.schema)))
        return PostgresWebhookConnection(connection)

    def close(self):
        with psycopg.connect(self.url, autocommit=True) as connection:
            connection.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(self.schema)))


class RecordingRegistry(PaymentProviderRegistry):
    def __init__(self):
        super().__init__(environment={})
        self.resolved = []
        self.install("payos-profile", PayOSPaymentProvider(
            PayOSCredentials("test-client", "test-api", CHECKSUM_KEY),
        ))

    def resolve(self, profile):
        self.resolved.append(profile["id"])
        return super().resolve(profile)


@pytest.fixture(params=["sqlite", "postgres"])
def inbox(request, tmp_path, monkeypatch):
    if request.param == "postgres":
        url = os.environ.get("WEBHOOK_TEST_DATABASE_URL")
        if not url:
            pytest.skip("WEBHOOK_TEST_DATABASE_URL is not configured")
        database = PostgresWebhookDatabase(url)
    else:
        database = WebhookDatabase(tmp_path / "webhook.sqlite")
    with database.get_connection() as connection:
        schema_sql = """
            CREATE TABLE payment_provider_profiles (
                id TEXT PRIMARY KEY, provider TEXT, environment TEXT,
                mode TEXT, readiness_status TEXT, credential_reference TEXT,
                timeout_ms INTEGER, max_attempts INTEGER
            );
            CREATE TABLE payment_webhook_events (
                id TEXT PRIMARY KEY, provider_profile_id TEXT, dedupe_key TEXT,
                payload_hash TEXT, signed_fields_json TEXT, status TEXT,
                available_at INTEGER, last_error_code TEXT,
                UNIQUE(provider_profile_id, dedupe_key, payload_hash)
            );
            INSERT INTO payment_provider_profiles VALUES
                ('provider-fake-v1', 'fake', 'test', 'shadow', 'ready', NULL, 1000, 3),
                ('payos-profile', 'payos', 'production', 'live', 'ready', NULL, 1000, 3);
        """
        if request.param == "postgres":
            connection.execute(schema_sql)
        else:
            connection.executescript(schema_sql)
    registry = RecordingRegistry()
    monkeypatch.setattr(webhook, "database", database)
    monkeypatch.setattr(webhook, "payment_provider_registry", lambda: registry)
    try:
        yield database, registry
    finally:
        if request.param == "postgres":
            database.close()


def send(profile_id, envelope):
    async def body():
        return json.dumps(envelope, ensure_ascii=False).encode()

    return asyncio.run(webhook.payment_webhook_api(SimpleNamespace(
        path_params={"profile_id": profile_id}, body=body,
    )))


@pytest.mark.parametrize("environment", ["production", "development", "test"])
@pytest.mark.parametrize("provider_name", ["fake", " FAKE "])
def test_unsigned_fake_http_events_never_reach_provider_or_persistence(
    inbox, monkeypatch, environment, provider_name,
):
    database, registry = inbox
    monkeypatch.setenv("APP_ENV", environment)
    monkeypatch.setenv("PAYMENT_CHECKOUT_ENABLED", "false")
    with database.get_connection() as connection:
        connection.execute(
            "UPDATE payment_provider_profiles SET provider = ? WHERE id = ?",
            (provider_name, "provider-fake-v1"),
        )

    for index in range(2):
        response = send("provider-fake-v1", {
            "provider": "fake", "data": {"orderCode": 1000 + index, "padding": "x" * 1000},
        })
        assert response.status_code == 400
        assert json.loads(response.body)["code"] == "PROVIDER_EVENT_UNVERIFIED"
    assert registry.resolved == []
    with database.get_connection() as connection:
        assert connection.execute("SELECT COUNT(*) FROM payment_webhook_events").fetchone()[0] == 0


def test_signed_payos_receipt_and_dedupe_remain_available_with_checkout_disabled(inbox):
    database, _registry = inbox
    data = {"orderCode": 123, "amount": 100000, "paymentLinkId": "link", "reference": "ref"}
    envelope = {"data": data, "signature": sign_signed_data(data, CHECKSUM_KEY)}
    first = send("payos-profile", envelope)
    duplicate = send("payos-profile", envelope)
    changed_data = {**data, "amount": 100001}
    changed = send("payos-profile", {
        "data": changed_data, "signature": sign_signed_data(changed_data, CHECKSUM_KEY),
    })
    assert first.status_code == duplicate.status_code == changed.status_code == 202
    assert json.loads(first.body)["duplicate"] is False
    assert json.loads(duplicate.body)["duplicate"] is True
    assert json.loads(changed.body)["reviewRequired"] is True
    with database.get_connection() as connection:
        assert {tuple(row) for row in connection.execute(
            "SELECT status, last_error_code FROM payment_webhook_events"
        )} == {("pending", None), ("review", "WEBHOOK_DEDUPE_PAYLOAD_MISMATCH")}


def test_identical_signed_events_are_independent_between_provider_profiles(inbox):
    database, registry = inbox
    with database.get_connection() as connection:
        connection.execute(
            """INSERT INTO payment_provider_profiles VALUES
                ('payos-profile-2', 'payos', 'production', 'live', 'ready', NULL, 1000, 3)"""
        )
    registry.install("payos-profile-2", PayOSPaymentProvider(
        PayOSCredentials("test-client", "test-api", CHECKSUM_KEY),
    ))
    data = {"orderCode": 123, "amount": 100000, "paymentLinkId": "link", "reference": "ref"}
    envelope = {"data": data, "signature": sign_signed_data(data, CHECKSUM_KEY)}
    first = send("payos-profile", envelope)
    other = send("payos-profile-2", envelope)
    duplicate = send("payos-profile-2", envelope)
    assert first.status_code == other.status_code == duplicate.status_code == 202
    assert json.loads(other.body)["duplicate"] is False
    assert json.loads(duplicate.body)["duplicate"] is True
    with database.get_connection() as connection:
        rows = connection.execute("SELECT id, provider_profile_id FROM payment_webhook_events").fetchall()
        assert len(rows) == 2
        assert len({row["id"] for row in rows}) == 2


@pytest.mark.parametrize("signature", [None, "bad-signature"])
def test_unsigned_or_invalid_payos_signature_cannot_create_events(inbox, signature):
    database, _registry = inbox
    response = send("payos-profile", {
        "data": {"orderCode": 123, "amount": 100000}, "signature": signature,
    })
    assert response.status_code == 400
    with database.get_connection() as connection:
        assert connection.execute("SELECT COUNT(*) FROM payment_webhook_events").fetchone()[0] == 0
