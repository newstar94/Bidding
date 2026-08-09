import sqlite3
import time
import uuid

import pytest

from backend.auth.auth_helper import SessionRole
from backend.documents.docx_context_policy import project_docx_context
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


def _enable_organization_word_export(cursor, organization_id):
    package_id = f"word-package-{uuid.uuid4().hex}"
    cursor.execute(
        """INSERT INTO goi_dich_vu
           (id, ten_goi, gia_ca, han_muc_nhan_su, trang_thai)
           VALUES (?, 'Word test', 0, 10, 'active')""",
        (package_id,),
    )
    cursor.execute(
        """INSERT INTO organization_subscriptions
           (organization_id, package_id, status, starts_at, expires_at,
            member_quota, revision)
           VALUES (?, ?, 'active', ?, ?, 10, 1)""",
        (
            organization_id,
            package_id,
            int(time.time()) - 60,
            int(time.time()) + 3600,
        ),
    )


def _insert_document_export_capabilities(cursor, organization_id, user_id, grants):
    cursor.execute(
        """INSERT INTO document_export_capabilities
           (organization_id, user_id, financial, identity, signature)
           VALUES (?, ?, ?, ?, ?)""",
        (organization_id, user_id, *grants),
    )


def _word_policy_database():
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        CREATE TABLE to_chuc (
            id TEXT PRIMARY KEY,
            ten_to_chuc TEXT NOT NULL,
            trang_thai TEXT NOT NULL DEFAULT 'active'
        );
        CREATE TABLE tai_khoan (
            id TEXT PRIMARY KEY,
            vai_tro TEXT NOT NULL DEFAULT 'user'
        );
        CREATE TABLE thanh_vien_to_chuc (
            user_id TEXT NOT NULL,
            organization_id TEXT NOT NULL,
            vai_tro_trong_to_chuc TEXT NOT NULL,
            ten_nhan_su TEXT,
            trang_thai_thanh_vien TEXT NOT NULL DEFAULT 'active',
            PRIMARY KEY (user_id, organization_id)
        );
        CREATE TABLE goi_dich_vu (
            id TEXT PRIMARY KEY,
            ten_goi TEXT NOT NULL,
            gia_ca INTEGER NOT NULL,
            han_muc_nhan_su INTEGER NOT NULL,
            trang_thai TEXT NOT NULL,
            document_export_word INTEGER NOT NULL DEFAULT 1,
            document_export_excel INTEGER NOT NULL DEFAULT 1,
            document_export_award_result_excel INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE organization_subscriptions (
            organization_id TEXT PRIMARY KEY,
            package_id TEXT NOT NULL,
            status TEXT NOT NULL,
            starts_at INTEGER NOT NULL,
            expires_at INTEGER,
            member_quota INTEGER NOT NULL,
            revision INTEGER NOT NULL
        );
        CREATE TABLE document_export_capabilities (
            organization_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            financial INTEGER NOT NULL DEFAULT 0,
            identity INTEGER NOT NULL DEFAULT 0,
            signature INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (organization_id, user_id)
        );
        """
    )
    return connection


def _seed_word_policy_member(cursor, *, membership_role="employee"):
    suffix = uuid.uuid4().hex
    organization_id = f"org-word-{suffix}"
    user_id = f"user-word-{suffix}"
    cursor.execute(
        "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (?, ?)",
        (organization_id, "Tổ chức kiểm thử Word"),
    )
    cursor.execute(
        "INSERT INTO tai_khoan (id, vai_tro) VALUES (?, 'user')",
        (user_id,),
    )
    cursor.execute(
        """INSERT INTO thanh_vien_to_chuc
           (user_id, organization_id, vai_tro_trong_to_chuc, ten_nhan_su)
           VALUES (?, ?, ?, 'Thành viên kiểm thử')""",
        (user_id, organization_id, membership_role),
    )
    _enable_organization_word_export(cursor, organization_id)
    return organization_id, user_id


def test_record_access_and_word_export_have_distinct_sensitive_policies():
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

        _enable_organization_word_export(cursor, organization_id)
        _insert_document_export_capabilities(
            cursor, organization_id, employee_id, (0, 0, 0)
        )

        capabilities = resolve_document_export_capabilities(
            cursor, role, employee_id, organization_id,
        )
        assert capabilities.as_dict() == {
            "financial": False,
            "identity": False,
            "signature": False,
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


@pytest.mark.parametrize(
    ("grants", "expected"),
    [
        ((0, 0, 0), (False, False, False)),
        ((1, 0, 0), (True, False, False)),
        ((0, 1, 0), (False, True, False)),
        ((0, 0, 1), (False, False, True)),
        ((1, 1, 0), (True, True, False)),
        ((1, 0, 1), (True, False, True)),
        ((0, 1, 1), (False, True, True)),
        ((1, 1, 1), (True, True, True)),
    ],
)
def test_employee_word_context_enforces_each_stored_capability_combination(
    grants,
    expected,
):
    connection = _word_policy_database()
    try:
        cursor = connection.cursor()
        organization_id, employee_id = _seed_word_policy_member(cursor)
        _insert_document_export_capabilities(
            cursor, organization_id, employee_id, grants
        )
        role = SessionRole(
            "user",
            employee_id,
            platform_role="user",
            active_role="employee",
        )

        capabilities = resolve_document_export_capabilities(
            cursor, role, employee_id, organization_id
        )
        assert tuple(capabilities.as_dict().values()) == expected

        projected = project_docx_context(
            "result",
            {
                "nha_thau": [
                    {
                        "ten_nha_thau": "Nhà thầu kiểm thử",
                        "so_tai_khoan": "0123456789",
                        "anh_dau": "images/nha_thau/stamp.webp",
                    }
                ],
                "to_chuyen_gia": [
                    {
                        "ho_ten": "Chuyên gia kiểm thử",
                        "so_cccd": "012345678901",
                        "anh_chu_ky": "images/chuyen_gia/signature.webp",
                    }
                ],
            },
            capabilities,
        )
        contractor = projected["nha_thau"][0]
        expert = projected["to_chuyen_gia"][0]
        assert ("so_tai_khoan" in contractor) is expected[0]
        assert ("so_cccd" in expert) is expected[1]
        assert ("anh_dau" in contractor) is expected[2]
        assert ("anh_chu_ky" in expert) is expected[2]
    finally:
        connection.close()


def test_manager_inherits_all_word_capabilities_despite_stored_denies():
    connection = _word_policy_database()
    try:
        cursor = connection.cursor()
        organization_id, manager_id = _seed_word_policy_member(
            cursor, membership_role="manager"
        )
        _insert_document_export_capabilities(
            cursor, organization_id, manager_id, (0, 0, 0)
        )
        role = SessionRole(
            "user",
            manager_id,
            platform_role="user",
            active_role="manager",
        )

        capabilities = resolve_document_export_capabilities(
            cursor, role, manager_id, organization_id
        )

        assert capabilities.as_dict() == {
            "financial": True,
            "identity": True,
            "signature": True,
        }
    finally:
        connection.close()


def test_employee_word_capabilities_are_scoped_to_the_active_organization():
    connection = _word_policy_database()
    try:
        cursor = connection.cursor()
        first_organization_id, employee_id = _seed_word_policy_member(cursor)
        second_organization_id = f"org-word-{uuid.uuid4().hex}"
        cursor.execute(
            "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (?, ?)",
            (second_organization_id, "Tổ chức Word thứ hai"),
        )
        cursor.execute(
            """INSERT INTO thanh_vien_to_chuc
               (user_id, organization_id, vai_tro_trong_to_chuc, ten_nhan_su)
               VALUES (?, ?, 'employee', 'Employee')""",
            (employee_id, second_organization_id),
        )
        _enable_organization_word_export(cursor, second_organization_id)
        _insert_document_export_capabilities(
            cursor, first_organization_id, employee_id, (0, 0, 0)
        )
        _insert_document_export_capabilities(
            cursor, second_organization_id, employee_id, (1, 1, 1)
        )
        role = SessionRole(
            "user",
            employee_id,
            platform_role="user",
            active_role="employee",
        )

        first = resolve_document_export_capabilities(
            cursor, role, employee_id, first_organization_id
        )
        second = resolve_document_export_capabilities(
            cursor, role, employee_id, second_organization_id
        )

        assert first.as_dict() == {
            "financial": False,
            "identity": False,
            "signature": False,
        }
        assert second.as_dict() == {
            "financial": True,
            "identity": True,
            "signature": True,
        }
    finally:
        connection.close()
