"""Real PostgreSQL ownership/session locks cannot invert membership admin."""

import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

from psycopg import sql
import pytest
from starlette.responses import JSONResponse

from backend.auth.auth_helper import SessionRole
from backend.billing import routes
from backend.db.db_helper import PostgresDatabase


@pytest.mark.parametrize("revoke", [False, True])
def test_cancel_locks_org_before_auth_and_resolves_concurrent_membership(monkeypatch, revoke):
    database_url = os.environ.get("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is required for real billing lock integration")
    database = PostgresDatabase(database_url)
    seed = database.get_connection()
    schema = f"billing_org_order_test_{uuid.uuid4().hex}"
    owner_attempted = threading.Event()
    actor = SessionRole("manager", "creator", platform_role="user", active_role="manager", active_role_organization_id="org-a")

    class ObservedConnection:
        def __init__(self, connection):
            self.connection = connection

        def execute(self, statement, parameters=()):
            if isinstance(statement, str) and "FROM to_chuc" in statement and "FOR UPDATE" in statement:
                owner_attempted.set()
            return self.connection.execute(statement, parameters)

        def cursor(self):
            return self

        def commit(self):
            self.connection.commit()

        def rollback(self):
            self.connection.rollback()

        def close(self):
            self.connection.close()

    def connection():
        result = database.get_connection()
        result.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(schema)))
        result.execute("SET lock_timeout = '2s'")
        result.execute("SET deadlock_timeout = '100ms'")
        result.commit()
        return result

    def reload_session(cursor, _request):
        cursor.execute("SELECT id FROM tai_khoan WHERE id = ? FOR UPDATE", (actor.user_id,)).fetchone()
        return True, actor

    try:
        seed.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
        seed.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(schema)))
        for statement in (
            "CREATE TABLE tai_khoan (id TEXT PRIMARY KEY)",
            "INSERT INTO tai_khoan VALUES ('creator')",
            "CREATE TABLE to_chuc (id TEXT PRIMARY KEY, trang_thai TEXT, owner_user_id TEXT)",
            "INSERT INTO to_chuc VALUES ('org-a', 'active', 'creator')",
            "CREATE TABLE thanh_vien_to_chuc (user_id TEXT, organization_id TEXT, trang_thai_thanh_vien TEXT)",
            "INSERT INTO thanh_vien_to_chuc VALUES ('creator', 'org-a', 'active')",
            "CREATE TABLE billing_orders (id TEXT PRIMARY KEY, public_id TEXT, owner_kind TEXT, account_user_id TEXT, organization_id TEXT, actor_user_id TEXT, payment_state TEXT, checkout_state TEXT, provider_reference TEXT, provider_order_code INTEGER)",
            "INSERT INTO billing_orders VALUES ('order', 'public-order', 'organization', NULL, 'org-a', 'creator', 'unverified', 'open', 'reference', 123)",
            "CREATE TABLE billing_subscription_activations (order_id TEXT, after_json TEXT)",
            "CREATE TABLE billing_provider_commands (id TEXT, order_id TEXT, command_type TEXT, provider_reference TEXT, request_json TEXT, status TEXT, available_at INTEGER)",
            "CREATE TABLE commercial_outbox (id TEXT, event_type TEXT, aggregate_type TEXT, aggregate_id TEXT, payload_json TEXT, available_at INTEGER)",
        ):
            seed.execute(statement)
        seed.commit()
        monkeypatch.setattr(routes.database, "get_connection", lambda: ObservedConnection(connection()))
        monkeypatch.setattr(routes, "verify_session", lambda _request: (True, actor))
        monkeypatch.setattr(routes, "verify_session_in_transaction", reload_session)
        monkeypatch.setattr(routes, "log_audit", lambda *_args, **_kwargs: None)

        administration = connection()
        try:
            administration.execute("BEGIN")
            administration.execute("SELECT id FROM to_chuc WHERE id = 'org-a' FOR UPDATE").fetchone()
            with ThreadPoolExecutor(max_workers=1) as executor:
                cancel = executor.submit(
                    routes._cancel_personal_order_sync,
                    SimpleNamespace(path_params={"public_id": "public-order"}), {"reason": "Popup closed"},
                )
                try:
                    assert owner_attempted.wait(3)
                    # This would deadlock if cancellation took account/session
                    # first, then waited for the organization held here.
                    administration.execute("SELECT id FROM tai_khoan WHERE id = 'creator' FOR UPDATE").fetchone()
                    if revoke:
                        administration.execute("UPDATE thanh_vien_to_chuc SET trang_thai_thanh_vien = 'left'")
                    administration.commit()
                    result = cancel.result(timeout=5)
                finally:
                    administration.rollback()
            if revoke:
                assert isinstance(result, JSONResponse) and result.status_code == 404
            else:
                assert isinstance(result, dict) and result["command_id"]
            check = connection()
            try:
                assert check.execute("SELECT COUNT(*) FROM billing_provider_commands").fetchone()[0] == (0 if revoke else 1)
            finally:
                check.close()
        finally:
            administration.close()
    finally:
        seed.rollback()
        seed.execute("SET search_path TO public")
        seed.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(schema)))
        seed.commit()
        seed.close()
        database.close()
