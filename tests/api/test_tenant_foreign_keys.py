import sqlite3

import pytest

from backend.db.db_helper import SQLiteDatabase
from backend.db.db_utils import (
    _build_create_table_sql,
    _ensure_assignment_tenant_triggers,
)
from backend.db.schema import SCHEMA_DINH_NGHIA


def _clean_schema_connection():
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    for table_name, table_spec in SCHEMA_DINH_NGHIA.items():
        connection.execute(_build_create_table_sql(table_name, table_spec))
    _ensure_assignment_tenant_triggers(connection.cursor())
    connection.executemany(
        "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (?, ?)",
        (("org-a", "Organization A"), ("org-b", "Organization B")),
    )
    connection.execute(
        """INSERT INTO tai_khoan (
               id, ten_dang_nhap, username_norm, mat_khau, email, email_norm
           ) VALUES (
               'user-a', 'user_a', 'user_a', 'test-hash',
               'user-a@example.com', 'user-a@example.com'
           )"""
    )
    connection.execute(
        """
        INSERT INTO thanh_vien_to_chuc (user_id, organization_id)
        VALUES ('user-a', 'org-a')
        """
    )
    return connection


def _insert_investor(connection, organization_id):
    connection.execute(
        "INSERT INTO chu_dau_tu (id, organization_id, ten_chu_dau_tu) VALUES (?, ?, ?)",
        (f"investor-{organization_id}", organization_id, f"Investor {organization_id}"),
    )


def _insert_plan(connection, plan_id, organization_id, name):
    investor_id = f"investor-{organization_id}"
    if not connection.execute("SELECT 1 FROM chu_dau_tu WHERE id = ?", (investor_id,)).fetchone():
        _insert_investor(connection, organization_id)
    connection.execute(
        """INSERT INTO ke_hoach_lcnt (
               id, organization_id, ten_ke_hoach, ten_du_an_du_toan,
               loai_hinh_mua_sam, chu_dau_tu_id, ngay_phe_duyet, quyet_dinh_phe_duyet
           ) VALUES (?, ?, ?, ?, 'Dự toán mua sắm', ?, '2026-01-01', 'QD-01')""",
        (plan_id, organization_id, name, f"Estimate {name}", investor_id),
    )


def test_every_tenant_parent_and_reference_has_composite_constraint():
    tenant_tables = {
        table_name
        for table_name, table_spec in SCHEMA_DINH_NGHIA.items()
        if "organization_id" in table_spec.get("columns", {})
    }

    for table_name in tenant_tables:
        table_spec = SCHEMA_DINH_NGHIA[table_name]
        columns = table_spec.get("columns", {})
        foreign_keys = table_spec.get("foreign_keys", [])
        if "owner_type" in columns:
            assert "CHECK(owner_type IN ('organization', 'personal'))" in columns["owner_type"]
            assert any(
                "REFERENCES to_chuc(id, scope_type)" in item
                for item in foreign_keys
            )
        else:
            assert any("REFERENCES to_chuc(id)" in item for item in foreign_keys)
        if "id" in columns:
            assert "UNIQUE(organization_id, id)" in table_spec.get("unique_constraints", [])

        for foreign_key in foreign_keys:
            for parent_table in tenant_tables:
                if f"REFERENCES {parent_table}(" not in foreign_key:
                    continue
                if parent_table == "thanh_vien_to_chuc":
                    assert "organization_id" in foreign_key
                elif parent_table != table_name:
                    assert (
                        f"REFERENCES {parent_table}(organization_id, id)" in foreign_key
                        or f"REFERENCES {parent_table}(organization_id," in foreign_key
                    )


def test_database_rejects_cross_tenant_business_reference():
    connection = _clean_schema_connection()
    try:
        connection.execute(
            """
            INSERT INTO chu_dau_tu (id, organization_id, ten_chu_dau_tu)
            VALUES ('investor-a', 'org-a', 'Investor A')
            """
        )

        with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
            connection.execute(
                """
                INSERT INTO ke_hoach_lcnt (
                    id, organization_id, ten_ke_hoach, ten_du_an_du_toan,
                    loai_hinh_mua_sam, chu_dau_tu_id, ngay_phe_duyet, quyet_dinh_phe_duyet
                ) VALUES ('plan-cross', 'org-b', 'Cross tenant plan', 'Estimate',
                          'Dự toán mua sắm', 'investor-a', '2026-01-01', 'QD-01')
                """
            )

        connection.execute(
            """
            INSERT INTO ke_hoach_lcnt (
                id, organization_id, ten_ke_hoach, ten_du_an_du_toan,
                loai_hinh_mua_sam, chu_dau_tu_id, ngay_phe_duyet, quyet_dinh_phe_duyet
            ) VALUES ('plan-a', 'org-a', 'Valid plan', 'Estimate',
                      'Dự toán mua sắm', 'investor-a', '2026-01-01', 'QD-01')
            """
        )
        assert connection.execute(
            "SELECT organization_id FROM ke_hoach_lcnt WHERE id = 'plan-a'"
        ).fetchone()[0] == "org-a"
    finally:
        connection.close()


def test_database_rejects_cross_tenant_join_and_child_rows():
    connection = _clean_schema_connection()
    try:
        _insert_plan(connection, "plan-a", "org-a", "Plan A")
        _insert_plan(connection, "plan-b", "org-b", "Plan B")
        connection.execute(
            """
            INSERT INTO goi_thau (
                id, organization_id, ke_hoach_id, ten_goi_thau, gia_goi_thau,
                thoi_gian_thuc_hien, nguon_von, thoi_gian_to_chuc, thoi_gian_bat_dau_to_chuc
            ) VALUES ('package-a', 'org-a', 'plan-a', 'Package A', 0,
                      '30 ngày', 'Ngân sách', '30 ngày', 'Quý I/2026')
            """
        )

        with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
            connection.execute(
                """
                INSERT INTO goi_thau_tuy_chon_mua_them (
                    id, organization_id, goi_thau_id, hang_muc
                ) VALUES ('option-cross', 'org-b', 'package-a', 'Cross tenant option')
                """
            )

        connection.execute("INSERT INTO nha_thau (id, organization_id, ten_nha_thau) VALUES ('contractor-b', 'org-b', 'Contractor B')")
        connection.execute(
            """
            INSERT INTO hop_dong (
                id, organization_id, ten_hop_dong, so_hop_dong, ngay_ky,
                chu_dau_tu_id, nha_thau_id, ke_hoach_id, gia_tri,
                loai_hop_dong, thoi_gian_thuc_hien, co_qd_chi_dinh,
                so_qd_chi_dinh, ngay_qd_chi_dinh
            ) VALUES ('contract-b', 'org-b', 'Contract B', 'HD-B', '2026-02-01',
                      'investor-org-b', 'contractor-b', 'plan-b', 0,
                      'Trọn gói', '30 ngày', 1, 'QD-CD', '2026-01-20')
            """
        )
        with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
            connection.execute(
                """
                INSERT INTO hop_dong_goi_thau (
                    organization_id, hop_dong_id, goi_thau_id
                ) VALUES ('org-b', 'contract-b', 'package-a')
                """
            )
    finally:
        connection.close()


def test_polymorphic_assignment_trigger_enforces_tenant_and_target_type():
    connection = _clean_schema_connection()
    try:
        _insert_plan(connection, "plan-a", "org-a", "Plan A")
        _insert_plan(connection, "plan-b", "org-b", "Plan B")

        with pytest.raises(sqlite3.IntegrityError, match="ASSIGNMENT_TENANT_MISMATCH"):
            connection.execute(
                """
                INSERT INTO phan_cong_nhan_su (
                    id, organization_id, id_nhan_vien, id_muc_tieu, loai_doi_tuong
                ) VALUES ('assignment-cross', 'org-a', 'user-a', 'plan-b', 'kehoach')
                """
            )

        with pytest.raises(sqlite3.IntegrityError, match="ASSIGNMENT_TENANT_MISMATCH"):
            connection.execute(
                """
                INSERT INTO phan_cong_nhan_su (
                    id, organization_id, id_nhan_vien, id_muc_tieu, loai_doi_tuong
                ) VALUES ('assignment-invalid', 'org-a', 'user-a', 'plan-a', 'unknown')
                """
            )

        connection.execute(
            """
            INSERT INTO phan_cong_nhan_su (
                id, organization_id, id_nhan_vien, id_muc_tieu, loai_doi_tuong
            ) VALUES ('assignment-a', 'org-a', 'user-a', 'plan-a', 'kehoach')
            """
        )
        assert connection.execute(
            "SELECT 1 FROM phan_cong_nhan_su WHERE id = 'assignment-a'"
        ).fetchone()
    finally:
        connection.close()


def test_membership_bound_tables_reject_non_member():
    connection = _clean_schema_connection()
    try:
        with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
            connection.execute(
                """
                INSERT INTO ma_tran_phan_quyen (id, organization_id, emp_id)
                VALUES ('permission-cross', 'org-b', 'user-a')
                """
            )
    finally:
        connection.close()


def test_connection_factory_enables_foreign_keys(tmp_path):
    database = SQLiteDatabase(tmp_path / "tenant.db")
    connection = database.get_connection()
    try:
        assert connection.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    finally:
        connection.close()


def test_clean_schema_passes_foreign_key_check():
    connection = _clean_schema_connection()
    try:
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
    finally:
        connection.close()
