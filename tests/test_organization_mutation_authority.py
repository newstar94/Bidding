from types import SimpleNamespace
from uuid import uuid4

import psycopg
import pytest

from backend.api.org_routes import _lock_and_can_manage_organization_mutation
from backend.db.db_helper import PostgresCursor
from backend.shared.membership_invariants import (
    lock_organization_membership_invariants,
)
from tests.test_member_quota_concurrency import _connect, _test_database_url


def test_mutation_authority_rechecks_current_membership_after_lock():
    class Cursor:
        def __init__(self):
            self.statements = []
            self.rows = [("org-a",), ("user", "active"), ("employee", "active")]

        def execute(self, statement, params=()):
            self.statements.append((" ".join(statement.split()), params))
            return self

        def fetchone(self):
            return self.rows[len(self.statements) - 1]

    cursor = Cursor()
    stale_manager_session = SimpleNamespace(active_role=None)

    assert not _lock_and_can_manage_organization_mutation(
        cursor,
        stale_manager_session,
        "actor-a",
        "org-a",
    )
    assert "FROM to_chuc" in cursor.statements[0][0]
    assert "FOR UPDATE" in cursor.statements[0][0]
    assert "FROM tai_khoan" in cursor.statements[1][0]
    assert "FROM thanh_vien_to_chuc" in cursor.statements[2][0]


def test_concurrent_demotion_commits_before_waiting_mutation_rechecks_authority():
    database_url = _test_database_url()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    suffix = uuid4().hex
    organization_id = f"mutation-authority-org-{suffix}"
    actor_id = f"mutation-authority-user-{suffix}"

    try:
        setup = _connect(database_url)
    except psycopg.Error as error:
        pytest.skip(f"PostgreSQL test database is unavailable: {type(error).__name__}")
    try:
        cursor = PostgresCursor(setup.cursor())
        cursor.execute(
            "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (?, 'Mutation authority')",
            (organization_id,),
        )
        email = f"{actor_id}@example.test"
        cursor.execute(
            """INSERT INTO tai_khoan
               (id, ten_dang_nhap, username_norm, mat_khau, ho_ten,
                vai_tro, email, email_norm, da_xac_minh, username_da_dat)
               VALUES (?, ?, ?, 'test-password-hash', 'Mutation manager',
                       'user', ?, ?, 1, 1)""",
            (actor_id, actor_id, actor_id, email, email),
        )
        cursor.execute(
            """INSERT INTO thanh_vien_to_chuc
               (user_id, organization_id, vai_tro_trong_to_chuc, ten_nhan_su)
               VALUES (?, ?, 'manager', 'Mutation manager')""",
            (actor_id, organization_id),
        )
        setup.commit()
    finally:
        setup.close()

    demotion_connection = _connect(database_url)
    mutation_connection = _connect(database_url)
    try:
        demotion = PostgresCursor(demotion_connection.cursor())
        mutation = PostgresCursor(mutation_connection.cursor())
        assert lock_organization_membership_invariants(
            demotion, organization_id
        )
        demotion.execute(
            """UPDATE thanh_vien_to_chuc
                  SET vai_tro_trong_to_chuc = 'employee'
                WHERE organization_id = ? AND user_id = ?""",
            (organization_id, actor_id),
        )

        mutation.execute("SET LOCAL lock_timeout = '250ms'")
        with pytest.raises(psycopg.errors.LockNotAvailable):
            _lock_and_can_manage_organization_mutation(
                mutation,
                SimpleNamespace(active_role=None),
                actor_id,
                organization_id,
            )
        mutation_connection.rollback()

        demotion_connection.commit()
        assert not _lock_and_can_manage_organization_mutation(
            mutation,
            SimpleNamespace(active_role=None),
            actor_id,
            organization_id,
        )
        mutation_connection.rollback()
    finally:
        demotion_connection.rollback()
        demotion_connection.close()
        mutation_connection.rollback()
        mutation_connection.close()
        cleanup = _connect(database_url)
        try:
            cursor = PostgresCursor(cleanup.cursor())
            cursor.execute(
                "DELETE FROM thanh_vien_to_chuc WHERE organization_id = ?",
                (organization_id,),
            )
            cursor.execute("DELETE FROM to_chuc WHERE id = ?", (organization_id,))
            cursor.execute("DELETE FROM tai_khoan WHERE id = ?", (actor_id,))
            cleanup.commit()
        finally:
            cleanup.close()
