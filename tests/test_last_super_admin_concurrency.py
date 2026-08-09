from uuid import uuid4

import psycopg
import pytest

from backend.auth import auth_routes
from backend.db.db_helper import PostgresCursor
from tests.test_member_quota_concurrency import _connect, _test_database_url


def _super_admin_count(cursor):
    return int(cursor.execute(
        "SELECT count(*) FROM tai_khoan WHERE vai_tro = 'super_admin'"
    ).fetchone()[0])


def _apply_platform_admin_loss(cursor, user_id, action):
    if action == "delete":
        cursor.execute("DELETE FROM tai_khoan WHERE id = ?", (user_id,))
        return
    cursor.execute(
        "UPDATE tai_khoan SET vai_tro = 'user' WHERE id = ?",
        (user_id,),
    )


@pytest.mark.parametrize(
    ("first_action", "second_action"),
    [("delete", "demote"), ("demote", "delete")],
)
def test_concurrent_platform_admin_losses_preserve_one_super_admin(
    first_action,
    second_action,
):
    database_url = _test_database_url()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    suffix = uuid4().hex
    admin_ids = [
        f"super-admin-race-{suffix}-1",
        f"super-admin-race-{suffix}-2",
    ]

    try:
        setup_connection = _connect(database_url)
    except psycopg.Error as error:
        pytest.skip(f"PostgreSQL test database is unavailable: {type(error).__name__}")
    existing_admin_ids = []
    try:
        cursor = PostgresCursor(setup_connection.cursor())
        existing_admin_ids = [
            str(row[0])
            for row in cursor.execute(
                "SELECT id FROM tai_khoan WHERE vai_tro = 'super_admin' ORDER BY id"
            ).fetchall()
        ]
        assert existing_admin_ids
        for user_id in admin_ids:
            email = f"{user_id}@example.test"
            cursor.execute(
                """INSERT INTO tai_khoan
                   (id, ten_dang_nhap, username_norm, mat_khau, ho_ten,
                    vai_tro, email, email_norm, da_xac_minh, username_da_dat)
                   VALUES (?, ?, ?, 'test-password-hash', 'Race super admin',
                           'super_admin', ?, ?, 1, 1)""",
                (user_id, user_id, user_id, email, email),
            )
        cursor.execute(
            """UPDATE tai_khoan SET vai_tro = 'user'
               WHERE vai_tro = 'super_admin' AND id NOT IN (?, ?)""",
            tuple(admin_ids),
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
            auth_routes,
            "lock_platform_role_invariants",
            lambda _cursor: True,
        )

        assert invariant_lock(first)
        assert _super_admin_count(first) == 2

        second.execute("SET LOCAL lock_timeout = '250ms'")
        second_blocked = False
        try:
            assert invariant_lock(second)
            second_count = _super_admin_count(second)
        except psycopg.errors.LockNotAvailable:
            second_connection.rollback()
            second_blocked = True

        _apply_platform_admin_loss(first, admin_ids[0], first_action)
        first_connection.commit()

        if second_blocked:
            assert invariant_lock(second)
            second_count = _super_admin_count(second)
        if second_count > 1:
            _apply_platform_admin_loss(second, admin_ids[1], second_action)
            second_connection.commit()
        else:
            second_connection.rollback()

        verification_connection = _connect(database_url)
        try:
            super_admin_count = verification_connection.execute(
                "SELECT count(*) FROM tai_khoan WHERE vai_tro = 'super_admin'"
            ).fetchone()[0]
        finally:
            verification_connection.close()
        assert super_admin_count == 1
    finally:
        first_connection.rollback()
        first_connection.close()
        second_connection.rollback()
        second_connection.close()
        cleanup_connection = _connect(database_url)
        try:
            cursor = PostgresCursor(cleanup_connection.cursor())
            if existing_admin_ids:
                placeholders = ", ".join("?" for _ in existing_admin_ids)
                cursor.execute(
                    f"UPDATE tai_khoan SET vai_tro = 'super_admin' WHERE id IN ({placeholders})",  # noqa: S608 - generated placeholders only
                    tuple(existing_admin_ids),
                )
            for user_id in admin_ids:
                cursor.execute("DELETE FROM tai_khoan WHERE id = ?", (user_id,))
            cleanup_connection.commit()
        finally:
            cleanup_connection.close()
