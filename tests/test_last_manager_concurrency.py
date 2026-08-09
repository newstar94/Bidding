from uuid import uuid4

import psycopg
import pytest

from backend.api import org_routes
from backend.db.db_helper import PostgresCursor
from backend.shared.membership_invariants import (
    lock_organization_membership_invariants_many,
)
from tests.test_member_quota_concurrency import _connect, _test_database_url


def test_multi_organization_membership_locks_use_deterministic_order():
    class Cursor:
        def __init__(self):
            self.calls = []

        def execute(self, _sql, params):
            self.calls.append(params[0])
            return self

        def fetchone(self):
            return (self.calls[-1],)

    cursor = Cursor()

    locked = lock_organization_membership_invariants_many(
        cursor,
        ["org-b", "org-a", "org-b", ""],
    )

    assert cursor.calls == ["org-a", "org-b"]
    assert locked == {"org-a", "org-b"}


def _active_manager_count(cursor, organization_id):
    return int(cursor.execute(
        """SELECT count(*) FROM thanh_vien_to_chuc
           WHERE organization_id = ?
             AND lower(trim(vai_tro_trong_to_chuc)) = 'manager'
             AND COALESCE(trang_thai_thanh_vien, 'active') = 'active'""",
        (organization_id,),
    ).fetchone()[0])


def _apply_manager_loss(cursor, organization_id, user_id, action):
    if action == "remove":
        cursor.execute(
            """UPDATE thanh_vien_to_chuc
               SET trang_thai_thanh_vien = 'left', left_at = CURRENT_TIMESTAMP
               WHERE organization_id = ? AND user_id = ?""",
            (organization_id, user_id),
        )
        return
    cursor.execute(
        """UPDATE thanh_vien_to_chuc
           SET vai_tro_trong_to_chuc = 'employee'
           WHERE organization_id = ? AND user_id = ?""",
        (organization_id, user_id),
    )


@pytest.mark.parametrize(
    ("first_action", "second_action"),
    [("remove", "demote"), ("demote", "remove")],
)
def test_concurrent_manager_losses_preserve_one_active_manager(
    first_action,
    second_action,
):
    database_url = _test_database_url()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    suffix = uuid4().hex
    organization_id = f"manager-race-org-{suffix}"
    manager_ids = [
        f"manager-race-{suffix}-1",
        f"manager-race-{suffix}-2",
    ]

    try:
        setup_connection = _connect(database_url)
    except psycopg.Error as error:
        pytest.skip(f"PostgreSQL test database is unavailable: {type(error).__name__}")
    try:
        cursor = PostgresCursor(setup_connection.cursor())
        cursor.execute(
            "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (?, 'Manager race org')",
            (organization_id,),
        )
        for user_id in manager_ids:
            email = f"{user_id}@example.test"
            cursor.execute(
                """INSERT INTO tai_khoan
                   (id, ten_dang_nhap, username_norm, mat_khau, ho_ten,
                    vai_tro, email, email_norm, da_xac_minh, username_da_dat)
                   VALUES (?, ?, ?, 'test-password-hash', 'Race manager',
                           'user', ?, ?, 1, 1)""",
                (user_id, user_id, user_id, email, email),
            )
            cursor.execute(
                """INSERT INTO thanh_vien_to_chuc
                   (user_id, organization_id, vai_tro_trong_to_chuc, ten_nhan_su)
                   VALUES (?, ?, 'manager', 'Race manager')""",
                (user_id, organization_id),
            )
        setup_connection.commit()
    finally:
        setup_connection.close()

    first_connection = _connect(database_url)
    second_connection = _connect(database_url)
    try:
        first = PostgresCursor(first_connection.cursor())
        second = PostgresCursor(second_connection.cursor())
        invariant_lock = getattr(
            org_routes,
            "lock_organization_membership_invariants",
            lambda *_args: True,
        )

        assert invariant_lock(first, organization_id)
        assert _active_manager_count(first, organization_id) == 2

        second.execute("SET LOCAL lock_timeout = '250ms'")
        second_blocked = False
        try:
            assert invariant_lock(second, organization_id)
            second_count = _active_manager_count(second, organization_id)
        except psycopg.errors.LockNotAvailable:
            second_connection.rollback()
            second_blocked = True

        _apply_manager_loss(
            first,
            organization_id,
            manager_ids[0],
            first_action,
        )
        first_connection.commit()

        if second_blocked:
            assert invariant_lock(second, organization_id)
            second_count = _active_manager_count(second, organization_id)
        if second_count > 1:
            _apply_manager_loss(
                second,
                organization_id,
                manager_ids[1],
                second_action,
            )
            second_connection.commit()
        else:
            second_connection.rollback()

        verification_connection = _connect(database_url)
        try:
            manager_count = verification_connection.execute(
                """SELECT count(*) FROM thanh_vien_to_chuc
                   WHERE organization_id = %s
                     AND lower(trim(vai_tro_trong_to_chuc)) = 'manager'
                     AND COALESCE(trang_thai_thanh_vien, 'active') = 'active'""",
                (organization_id,),
            ).fetchone()[0]
        finally:
            verification_connection.close()
        assert manager_count == 1
    finally:
        first_connection.rollback()
        first_connection.close()
        second_connection.rollback()
        second_connection.close()
        cleanup_connection = _connect(database_url)
        try:
            cursor = PostgresCursor(cleanup_connection.cursor())
            cursor.execute(
                "DELETE FROM thanh_vien_to_chuc WHERE organization_id = ?",
                (organization_id,),
            )
            cursor.execute("DELETE FROM to_chuc WHERE id = ?", (organization_id,))
            for user_id in manager_ids:
                cursor.execute("DELETE FROM tai_khoan WHERE id = ?", (user_id,))
            cleanup_connection.commit()
        finally:
            cleanup_connection.close()
