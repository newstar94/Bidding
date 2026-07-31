import os
import uuid

import pytest

from backend.auth.auth_helper import SessionRole
from backend.db.db_helper import PostgresDatabase
from backend.shared.helpers import SCHEMA_DINH_NGHIA
from backend.sync.command import SyncActorContext, SyncTransactionContext
from backend.sync.deletion_service import apply_sync_deletions
from backend.sync.mapper import canonicalize_payload_item
from backend.sync.mutation_tracker import SyncMutationTracker, clean_sync_record_id
from backend.sync.payload_index import SyncPayloadIndex
from backend.sync.record_validator import SyncRecordValidator
from backend.sync.serializer import iter_sync_table_payloads


_CONFLICT_DATA_KEYS = {
    "currentVersion",
    "serverRecord",
    "before",
    "after",
}


def _test_database():
    database_url = str(os.environ.get("TEST_DATABASE_URL") or "").strip()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is required for sync authorization integration tests")
    return PostgresDatabase(database_url)


def _seed_denied_package(cursor):
    suffix = uuid.uuid4().hex
    organization_id = f"org-conflict-{suffix}"
    employee_id = f"employee-conflict-{suffix}"
    other_id = f"assignee-conflict-{suffix}"
    investor_id = f"investor-conflict-{suffix}"
    plan_id = f"plan-conflict-{suffix}"
    package_id = f"package-conflict-{suffix}"

    cursor.execute(
        "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (?, ?)",
        (organization_id, "Tổ chức kiểm thử conflict"),
    )
    for user_id, label in ((employee_id, "Employee"), (other_id, "Assignee")):
        email = f"{user_id}@example.test"
        cursor.execute(
            """INSERT INTO tai_khoan
               (id, ten_dang_nhap, username_norm, mat_khau, ho_ten,
                vai_tro, email, email_norm, da_xac_minh, username_da_dat)
               VALUES (?, ?, ?, ?, ?, 'user', ?, ?, 1, 1)""",
            (user_id, user_id, user_id, "test-password-hash", label, email, email),
        )
        cursor.execute(
            """INSERT INTO thanh_vien_to_chuc
               (user_id, organization_id, vai_tro_trong_to_chuc, ten_nhan_su)
               VALUES (?, ?, 'employee', ?)""",
            (user_id, organization_id, label),
        )
    cursor.execute(
        """INSERT INTO ma_tran_phan_quyen
           (id, organization_id, emp_id, goithau)
           VALUES (?, ?, ?, 'view')""",
        (f"permission-{suffix}", organization_id, employee_id),
    )
    cursor.execute(
        """INSERT INTO chu_dau_tu
           (id, organization_id, id_goc, ten_chu_dau_tu)
           VALUES (?, ?, ?, ?)""",
        (investor_id, organization_id, investor_id, "Chủ đầu tư kiểm thử"),
    )
    cursor.execute(
        """INSERT INTO ke_hoach_lcnt
           (id, organization_id, id_goc, ten_ke_hoach, ten_du_an_du_toan,
            loai_hinh_mua_sam, chu_dau_tu_id, ngay_phe_duyet,
            quyet_dinh_phe_duyet)
           VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_DATE, ?)""",
        (
            plan_id,
            organization_id,
            plan_id,
            "Kế hoạch kiểm thử",
            "Dự án kiểm thử",
            "Mua sắm thường xuyên",
            investor_id,
            "QĐ-TEST",
        ),
    )
    cursor.execute(
        """INSERT INTO goi_thau
           (id, organization_id, id_goc, ke_hoach_id, ten_goi_thau,
            gia_goi_thau, thoi_gian_thuc_hien, nguon_von,
            thoi_gian_to_chuc, thoi_gian_bat_dau_to_chuc, trang_thai)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PREPARING')""",
        (
            package_id,
            organization_id,
            package_id,
            plan_id,
            "Gói thầu kiểm thử conflict",
            100_000_000,
            "30 ngày",
            "Ngân sách kiểm thử",
            "Quý III/2026",
            "Tháng 8/2026",
        ),
    )
    cursor.execute(
        """INSERT INTO phan_cong_nhan_su
           (id, organization_id, id_nhan_vien, id_muc_tieu, loai_doi_tuong)
           VALUES (?, ?, ?, ?, 'goithau')""",
        (f"assignment-{suffix}", organization_id, other_id, package_id),
    )
    return organization_id, employee_id, package_id


def _assert_denied_error_has_no_conflict_data(errors):
    assert errors
    assert any(error.get("code") == "RECORD_ACCESS_DENIED" for error in errors)
    for error in errors:
        assert _CONFLICT_DATA_KEYS.isdisjoint(error)
        serialized = repr(error)
        assert "Gói thầu kiểm thử conflict" not in serialized
        assert "100000000" not in serialized


def test_denied_delete_with_wrong_version_never_returns_server_record():
    database = _test_database()
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        organization_id, employee_id, package_id = _seed_denied_package(cursor)
        role = SessionRole(
            "user",
            employee_id,
            platform_role="user",
            active_role="employee",
        )

        result = apply_sync_deletions(
            cursor,
            [{"table": "goithau", "id": package_id, "expectedVersion": 999}],
            organization_id=organization_id,
            actor_role=role,
            actor_user_id=employee_id,
            current_time="2026-07-30 12:00:00",
            sync_version=2,
            clean_record_id=clean_sync_record_id,
            ip_address="127.0.0.1",
        )

        _assert_denied_error_has_no_conflict_data(result["errors"])
    finally:
        connection.rollback()
        connection.close()
        database.close()


def test_denied_upsert_with_wrong_version_never_returns_server_record():
    database = _test_database()
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        organization_id, employee_id, package_id = _seed_denied_package(cursor)
        stored = dict(
            cursor.execute(
                "SELECT * FROM goi_thau WHERE organization_id = ? AND id = ?",
                (organization_id, package_id),
            ).fetchone()
        )
        payload = {"goithau": [dict(stored, expectedVersion=999)]}
        actor = SyncActorContext(
            request=None,
            role=SessionRole(
                "user",
                employee_id,
                platform_role="user",
                active_role="employee",
            ),
            user_id=employee_id,
            organization_id=organization_id,
            owner_type="organization",
            can_upload_workspace_assets=False,
        )
        transaction = SyncTransactionContext(
            connection=connection,
            cursor=cursor,
            actor=actor,
            owner_type="organization",
            current_time="2026-07-30 12:00:00",
        )
        payload_index = SyncPayloadIndex.build(payload, clean_sync_record_id)
        validator = SyncRecordValidator(
            transaction,
            payload,
            payload_index,
            SyncMutationTracker(
                clean_sync_record_id,
                client_mutation_id="mutation-conflict-test",
            ),
            clean_record_id=clean_sync_record_id,
            schema_definition=SCHEMA_DINH_NGHIA,
            iter_payloads=iter_sync_table_payloads,
            canonicalize_item=canonicalize_payload_item,
        )

        _assert_denied_error_has_no_conflict_data(validator.validate_payload())
    finally:
        connection.rollback()
        connection.close()
        database.close()


def _validate_missing_package(cursor, connection, organization_id, employee_id, stored, *, base_version):
    package_id = stored["id"]
    cursor.execute(
        "UPDATE ma_tran_phan_quyen SET goithau = 'edit' WHERE organization_id = ? AND emp_id = ?",
        (organization_id, employee_id),
    )
    cursor.execute(
        "DELETE FROM phan_cong_nhan_su WHERE organization_id = ? AND id_muc_tieu = ?",
        (organization_id, package_id),
    )
    cursor.execute(
        "DELETE FROM goi_thau WHERE organization_id = ? AND id = ?",
        (organization_id, package_id),
    )
    payload = {
        "goithau": [dict(stored, expectedVersion=1)],
        "baseSyncVersion": base_version,
        "clientMutationId": f"mutation-{uuid.uuid4().hex}",
    }
    actor = SyncActorContext(
        request=None,
        role=SessionRole(
            "user",
            employee_id,
            platform_role="user",
            active_role="employee",
        ),
        user_id=employee_id,
        organization_id=organization_id,
        owner_type="organization",
        can_upload_workspace_assets=False,
    )
    validator = SyncRecordValidator(
        SyncTransactionContext(
            connection=connection,
            cursor=cursor,
            actor=actor,
            owner_type="organization",
            current_time="2026-07-30 12:00:00",
        ),
        payload,
        SyncPayloadIndex.build(payload, clean_sync_record_id),
        SyncMutationTracker(
            clean_sync_record_id,
            client_mutation_id=payload["clientMutationId"],
        ),
        clean_record_id=clean_sync_record_id,
        schema_definition=SCHEMA_DINH_NGHIA,
        iter_payloads=iter_sync_table_payloads,
        canonicalize_item=canonicalize_payload_item,
    )
    return validator.validate_payload()


def test_stale_update_of_tombstoned_record_returns_record_deleted():
    database = _test_database()
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        organization_id, employee_id, package_id = _seed_denied_package(cursor)
        stored = dict(cursor.execute(
            "SELECT * FROM goi_thau WHERE organization_id = ? AND id = ?",
            (organization_id, package_id),
        ).fetchone())
        cursor.execute(
            """INSERT INTO sync_metadata
               (organization_id, current_version, min_available_version)
               VALUES (?, 5, 0)
               ON CONFLICT (organization_id) DO UPDATE
               SET current_version = 5, min_available_version = 0""",
            (organization_id,),
        )
        cursor.execute(
            """INSERT INTO deleted_records
               (table_name, record_id, organization_id, deleted_at, delete_version)
               VALUES ('goi_thau', ?, ?, CURRENT_TIMESTAMP, 5)""",
            (package_id, organization_id),
        )

        errors = _validate_missing_package(
            cursor,
            connection,
            organization_id,
            employee_id,
            stored,
            base_version=1,
        )

        assert any(error.get("code") == "RECORD_DELETED" for error in errors)
        assert not any(error.get("serverRecord") for error in errors)
    finally:
        connection.rollback()
        connection.close()
        database.close()


def test_stale_update_older_than_retention_requires_full_sync():
    database = _test_database()
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        organization_id, employee_id, package_id = _seed_denied_package(cursor)
        stored = dict(cursor.execute(
            "SELECT * FROM goi_thau WHERE organization_id = ? AND id = ?",
            (organization_id, package_id),
        ).fetchone())
        cursor.execute(
            """INSERT INTO sync_metadata
               (organization_id, current_version, min_available_version)
               VALUES (?, 12, 10)
               ON CONFLICT (organization_id) DO UPDATE
               SET current_version = 12, min_available_version = 10""",
            (organization_id,),
        )

        errors = _validate_missing_package(
            cursor,
            connection,
            organization_id,
            employee_id,
            stored,
            base_version=1,
        )

        assert any(error.get("code") == "FULL_SYNC_REQUIRED" for error in errors)
        assert not any(error.get("serverRecord") for error in errors)
    finally:
        connection.rollback()
        connection.close()
        database.close()
