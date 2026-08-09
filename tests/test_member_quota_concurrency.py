import os
import time
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest

from backend.api import org_routes
from backend.db.db_helper import PostgresCursor, compat_row_factory


def _test_database_url():
    if value := os.environ.get("TEST_DATABASE_URL"):
        return value
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.is_file():
        return None
    for line in env_path.read_text(encoding="utf-8-sig").splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() == "TEST_DATABASE_URL":
            return value.strip().strip('"').strip("'") or None
    return None


def _connect(database_url):
    return psycopg.connect(
        database_url,
        connect_timeout=5,
        row_factory=compat_row_factory,
    )


def _legacy_member_quota_state(cursor, organization_id):
    subscription = cursor.execute(
        """SELECT sub.status, sub.expires_at, sub.member_quota,
                  tc.trang_thai AS organization_status,
                  pkg.trang_thai AS package_status
           FROM organization_subscriptions sub
           JOIN to_chuc tc ON tc.id = sub.organization_id
           JOIN goi_dich_vu pkg ON pkg.id = sub.package_id
           WHERE sub.organization_id = ?""",
        (organization_id,),
    ).fetchone()
    member_count = int(cursor.execute(
        """SELECT count(*) FROM thanh_vien_to_chuc
           WHERE organization_id = ?
             AND COALESCE(trang_thai_thanh_vien, 'active') = 'active'""",
        (organization_id,),
    ).fetchone()[0])
    return subscription, member_count


def _activate_employee(cursor, organization_id, user_id):
    updated = cursor.execute(
        """UPDATE thanh_vien_to_chuc
           SET trang_thai_thanh_vien = 'active', left_at = NULL, left_by = NULL
           WHERE organization_id = ? AND user_id = ?""",
        (organization_id, user_id),
    )
    if int(updated.rowcount or 0) == 1:
        return
    cursor.execute(
        """INSERT INTO thanh_vien_to_chuc
           (user_id, organization_id, vai_tro_trong_to_chuc, ten_nhan_su)
           VALUES (?, ?, 'employee', 'Quota candidate')""",
        (user_id, organization_id),
    )


@pytest.mark.parametrize("reactivate_first_candidate", [False, True])
def test_concurrent_last_quota_slot_allows_exactly_one_member(
    reactivate_first_candidate,
):
    database_url = _test_database_url()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    suffix = uuid4().hex
    organization_id = f"quota-race-org-{suffix}"
    package_id = f"quota-race-package-{suffix}"
    manager_id = f"quota-race-manager-{suffix}"
    candidate_ids = [
        f"quota-race-candidate-{suffix}-1",
        f"quota-race-candidate-{suffix}-2",
    ]

    try:
        setup_connection = _connect(database_url)
    except psycopg.Error as error:
        pytest.skip(f"PostgreSQL test database is unavailable: {type(error).__name__}")
    try:
        cursor = PostgresCursor(setup_connection.cursor())
        cursor.execute(
            "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (?, 'Quota race org')",
            (organization_id,),
        )
        cursor.execute(
            """INSERT INTO goi_dich_vu
               (id, ten_goi, gia_ca, han_muc_nhan_su, trang_thai)
               VALUES (?, 'Quota race package', 0, 2, 'active')""",
            (package_id,),
        )
        for user_id in (manager_id, *candidate_ids):
            email = f"{user_id}@example.test"
            cursor.execute(
                """INSERT INTO tai_khoan
                   (id, ten_dang_nhap, username_norm, mat_khau, ho_ten,
                    vai_tro, email, email_norm, da_xac_minh, username_da_dat)
                   VALUES (?, ?, ?, 'test-password-hash', 'Quota user',
                           'user', ?, ?, 1, 1)""",
                (user_id, user_id, user_id, email, email),
            )
        cursor.execute(
            """INSERT INTO thanh_vien_to_chuc
               (user_id, organization_id, vai_tro_trong_to_chuc, ten_nhan_su)
               VALUES (?, ?, 'manager', 'Quota manager')""",
            (manager_id, organization_id),
        )
        if reactivate_first_candidate:
            cursor.execute(
                """INSERT INTO thanh_vien_to_chuc
                   (user_id, organization_id, vai_tro_trong_to_chuc,
                    ten_nhan_su, trang_thai_thanh_vien)
                   VALUES (?, ?, 'employee', 'Former quota candidate', 'left')""",
                (candidate_ids[0], organization_id),
            )
        cursor.execute(
            """INSERT INTO organization_subscriptions
               (organization_id, package_id, status, starts_at, expires_at,
                member_quota, revision)
               VALUES (?, ?, 'active', ?, ?, 2, 1)""",
            (
                organization_id,
                package_id,
                int(time.time()) - 60,
                int(time.time()) + 3600,
            ),
        )
        setup_connection.commit()
    finally:
        setup_connection.close()

    first_connection = _connect(database_url)
    second_connection = _connect(database_url)
    try:
        first = PostgresCursor(first_connection.cursor())
        second = PostgresCursor(second_connection.cursor())
        quota_state = getattr(
            org_routes,
            "_lock_organization_member_quota",
            _legacy_member_quota_state,
        )

        first_subscription, first_count = quota_state(first, organization_id)
        assert int(first_subscription["member_quota"]) == 2
        assert first_count == 1

        second.execute("SET LOCAL lock_timeout = '250ms'")
        second_blocked = False
        try:
            second_subscription, second_count = quota_state(second, organization_id)
        except psycopg.errors.LockNotAvailable:
            second_connection.rollback()
            second_blocked = True

        _activate_employee(first, organization_id, candidate_ids[0])
        first_connection.commit()

        if second_blocked:
            second_subscription, second_count = quota_state(second, organization_id)
        if second_count < int(second_subscription["member_quota"]):
            _activate_employee(second, organization_id, candidate_ids[1])
            second_connection.commit()
        else:
            second_connection.rollback()

        verification_connection = _connect(database_url)
        try:
            active_rows = verification_connection.execute(
                """SELECT user_id FROM thanh_vien_to_chuc
                   WHERE organization_id = %s
                     AND COALESCE(trang_thai_thanh_vien, 'active') = 'active'
                   ORDER BY user_id""",
                (organization_id,),
            ).fetchall()
        finally:
            verification_connection.close()
        assert len(active_rows) == 2
        assert sum(row[0] in candidate_ids for row in active_rows) == 1
    finally:
        first_connection.rollback()
        first_connection.close()
        second_connection.rollback()
        second_connection.close()
        cleanup_connection = _connect(database_url)
        try:
            cursor = PostgresCursor(cleanup_connection.cursor())
            cursor.execute(
                "DELETE FROM organization_subscriptions WHERE organization_id = ?",
                (organization_id,),
            )
            cursor.execute(
                "DELETE FROM thanh_vien_to_chuc WHERE organization_id = ?",
                (organization_id,),
            )
            cursor.execute("DELETE FROM to_chuc WHERE id = ?", (organization_id,))
            cursor.execute("DELETE FROM goi_dich_vu WHERE id = ?", (package_id,))
            for user_id in (manager_id, *candidate_ids):
                cursor.execute("DELETE FROM tai_khoan WHERE id = ?", (user_id,))
            cleanup_connection.commit()
        finally:
            cleanup_connection.close()
