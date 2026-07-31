import time
import uuid

from backend.auth.auth_helper import SessionRole
from backend.shared.access_policy import (
    can_read_record,
    resolve_document_export_capabilities,
)
from backend.shared.sensitive_data import (
    resolve_sensitive_read_policy,
    serialize_sensitive_read_item,
)

from tests.test_sync_conflict_authorization import (
    _seed_denied_package,
    _test_database,
)


def test_record_access_controls_full_business_projection_not_legacy_field_flags():
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
        package = dict(cursor.execute(
            "SELECT * FROM goi_thau WHERE organization_id = ? AND id = ?",
            (organization_id, package_id),
        ).fetchone())

        assert not can_read_record(
            cursor, role, employee_id, organization_id,
            "goithau", "goi_thau", package,
        )
        cursor.execute(
            """INSERT INTO phan_cong_nhan_su
               (id, organization_id, id_nhan_vien, id_muc_tieu, loai_doi_tuong)
               VALUES (?, ?, ?, ?, 'goithau')""",
            (f"assigned-{uuid.uuid4().hex}", organization_id, employee_id, package_id),
        )
        assert can_read_record(
            cursor, role, employee_id, organization_id,
            "goithau", "goi_thau", package,
        )

        plan_id = f"word-plan-{uuid.uuid4().hex}"
        cursor.execute(
            """INSERT INTO goi_dich_vu
               (id, ten_goi, gia_ca, han_muc_nhan_su, trang_thai)
               VALUES (?, 'Word test', 0, 10, 'active')""",
            (plan_id,),
        )
        cursor.execute(
            """INSERT INTO organization_subscriptions
               (organization_id, package_id, status, starts_at, expires_at,
                member_quota, revision)
               VALUES (?, ?, 'active', ?, ?, 10, 1)""",
            (
                organization_id,
                plan_id,
                int(time.time()) - 60,
                int(time.time()) + 3600,
            ),
        )
        cursor.execute(
            """INSERT INTO document_export_capabilities
               (organization_id, user_id, financial, identity, signature)
               VALUES (?, ?, 0, 0, 0)""",
            (organization_id, employee_id),
        )

        capabilities = resolve_document_export_capabilities(
            cursor, role, employee_id, organization_id,
        )
        assert capabilities.as_dict() == {
            "financial": True,
            "identity": True,
            "signature": True,
        }

        sensitive_policy = resolve_sensitive_read_policy(
            cursor,
            role,
            employee_id,
            organization_id,
            table_names={"nha_thau"},
        )
        contractor = serialize_sensitive_read_item(
            "nha_thau",
            {
                "id": "contractor-1",
                "soTaiKhoan": "0123456789",
                "maNganHang": "VCB",
                "anhDau": "images/nha_thau/stamp.png",
            },
            sensitive_policy,
        )
        assert contractor["soTaiKhoan"] == "0123456789"
        assert contractor["maNganHang"] == "VCB"
        assert contractor["anhDau"] == "images/nha_thau/stamp.png"
        assert "sensitiveFinancialDataMasked" not in contractor
    finally:
        connection.rollback()
        connection.close()
        database.close()
