"""Nullable QR persistence upgrades independently of immutable purchase snapshots."""

import json

import psycopg
import pytest

from backend.db.postgres_schema import assert_schema_contract
from backend.db.upgrades import DB_SCHEMA_VERSION, apply_database_upgrades
from tests.test_billing_activation import _insert_base_plan_order
from tests.test_postgres_migration_chain import (
    _close_fixture_connection, _open_fixture_connection, _upgrade_context,
)


def test_schema_99_to_100_preserves_existing_orders_and_keeps_legacy_qr_null():
    connection, cursor, schema_name = _open_fixture_connection()
    try:
        context = _upgrade_context()
        assert apply_database_upgrades(cursor, 1, context, target_version=99) == 99
        # Historical table builders use the current column map. Remove this
        # additive column to model the actual released v99 database catalog.
        cursor.execute("ALTER TABLE billing_orders DROP COLUMN IF EXISTS checkout_payment_json")
        cursor.execute("INSERT INTO goi_dich_vu (id, ten_goi, gia_ca, han_muc_nhan_su) VALUES ('diamond', 'Test Diamond', 100000, 1)")
        data = _insert_base_plan_order(cursor)
        before = dict(cursor.execute("SELECT * FROM billing_orders WHERE id=?", (data["order_id"],)).fetchone())
        assert apply_database_upgrades(cursor, 99, context) == DB_SCHEMA_VERSION == 100
        after = dict(cursor.execute("SELECT * FROM billing_orders WHERE id=?", (data["order_id"],)).fetchone())
        assert after.pop("checkout_payment_json") is None
        assert after == before
        assert_schema_contract(cursor)
        assert apply_database_upgrades(cursor, 100, context) == 100
        cursor.execute("UPDATE billing_orders SET checkout_payment_json=? WHERE id=?", (json.dumps({"qrCode": "signed-payload"}), data["order_id"]))
        cursor.execute("SAVEPOINT oversized_qr")
        with pytest.raises(psycopg.errors.CheckViolation):
            cursor.execute("UPDATE billing_orders SET checkout_payment_json=? WHERE id=?", ("x" * 8193, data["order_id"]))
        cursor.execute("ROLLBACK TO SAVEPOINT oversized_qr")
        assert json.loads(cursor.execute("SELECT checkout_payment_json FROM billing_orders WHERE id=?", (data["order_id"],)).fetchone()[0]) == {"qrCode": "signed-payload"}
    finally:
        _close_fixture_connection(connection, cursor, schema_name)


def test_fresh_schema_100_has_the_same_checkout_qr_contract(monkeypatch):
    monkeypatch.setenv("ADMIN_PASSWORD", "Fixture-Only-Password-100!")
    connection, cursor, schema_name = _open_fixture_connection(fresh_catalog=True)
    try:
        assert_schema_contract(cursor)
        column = cursor.execute("""SELECT is_nullable, column_default FROM information_schema.columns
          WHERE table_schema=current_schema() AND table_name='billing_orders'
            AND column_name='checkout_payment_json'""").fetchone()
        assert tuple(column) == ("YES", None)
    finally:
        _close_fixture_connection(connection, cursor, schema_name)
