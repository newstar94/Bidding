import sqlite3

import pytest

from backend.db.db_utils import (
    _build_create_table_sql,
    _create_baseline_indexes_and_triggers,
    recalculate_tong_muc_dau_tu,
)
from backend.db.schema import SCHEMA_DINH_NGHIA
from backend.shared.numeric_utils import MAX_SQLITE_INTEGER, parse_vnd_amount
from backend.sync.mapper import map_db_to_json
from backend.shared.domain_enums import enum_code


def _connection_with(*table_names):
    connection = sqlite3.connect(":memory:")
    for table_name in table_names:
        connection.execute(
            _build_create_table_sql(table_name, SCHEMA_DINH_NGHIA[table_name])
        )
    return connection


def test_vnd_amount_is_exact_and_has_sqlite_integer_bounds():
    assert parse_vnd_amount("9007199254740993") == 9_007_199_254_740_993
    assert parse_vnd_amount(MAX_SQLITE_INTEGER) == MAX_SQLITE_INTEGER
    assert parse_vnd_amount("1.5") is None
    assert parse_vnd_amount(-1) is None
    assert parse_vnd_amount(MAX_SQLITE_INTEGER + 1) is None
    assert parse_vnd_amount(True) is None


def test_stable_status_codes_are_persisted_and_vietnamese_labels_are_serialized():
    assert enum_code("goi_thau", "trang_thai", "Đang mời thầu") == "INVITED"
    assert enum_code("hop_dong", "trang_thai_hop_dong", "Đã thanh lý") == "LIQUIDATED"
    package = map_db_to_json("goi_thau", {"trang_thai": "AWARDED"})
    contract = map_db_to_json("hop_dong", {"trang_thai_hop_dong": "ACTIVE"})
    assert package["trangThai"] == "Đã có kết quả"
    assert contract["trangThaiHopDong"] == "Đang thực hiện"


def test_every_explicit_json_mapping_targets_a_real_column():
    for table_name, table_spec in SCHEMA_DINH_NGHIA.items():
        columns = set(table_spec.get("columns", {}))
        mapped_columns = set(table_spec.get("field_map", {}))
        assert mapped_columns <= columns, f"{table_name}: {sorted(mapped_columns - columns)}"


def test_money_is_stored_as_integer_and_serialized_as_decimal_string():
    connection = _connection_with("goi_dich_vu")
    amount = 9_007_199_254_740_993
    connection.execute(
        "INSERT INTO goi_dich_vu (id, ten_goi, gia_ca, han_muc_nhan_su) VALUES (?, ?, ?, ?)",
        ("package-large", "Large", amount, 1),
    )
    cursor = connection.execute(
        "SELECT *, typeof(gia_ca) AS amount_type FROM goi_dich_vu WHERE id = ?",
        ("package-large",),
    )
    columns = [item[0] for item in cursor.description]
    row = cursor.fetchone()
    assert row[2] == amount
    assert row[-1] == "integer"
    payload = map_db_to_json("goi_dich_vu", dict(zip(columns[:-1], row[:-1])))
    assert payload["giaCa"] == "9007199254740993"

    for index, invalid_amount in enumerate((-1, 1.5, "not-money")):
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "INSERT INTO goi_dich_vu (id, ten_goi, gia_ca, han_muc_nhan_su) VALUES (?, ?, ?, ?)",
                (f"invalid-{index}", "Invalid", invalid_amount, 1),
            )
    connection.close()


def test_database_rejects_invalid_flags_ranges_permissions_and_timeline():
    connection = _connection_with("goi_thau", "ma_tran_phan_quyen", "hop_dong")

    with pytest.raises(sqlite3.IntegrityError):
        connection.execute(
            "INSERT INTO goi_thau (id, organization_id, ten_goi_thau, is_thuoc) VALUES (?, ?, ?, ?)",
            ("bid-bool", "org-1", "Invalid boolean", 2),
        )
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute(
            "INSERT INTO goi_thau (id, organization_id, ten_goi_thau, trong_so_ky_thuat) VALUES (?, ?, ?, ?)",
            ("bid-weight", "org-1", "Invalid weight", 101),
        )
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute(
            """
            INSERT INTO goi_thau (
                id, organization_id, ten_goi_thau,
                thoi_gian_dang_tai, thoi_gian_dong_thau, thoi_gian_mo_thau
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                "bid-time", "org-1", "Invalid timeline",
                "2026-07-15 09:00:00", "2026-07-15 08:00:00", "2026-07-15 08:30:00",
            ),
        )
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute(
            "INSERT INTO ma_tran_phan_quyen (id, organization_id, emp_id, kehoach) VALUES (?, ?, ?, ?)",
            ("permission-1", "org-1", "user-1", "admin"),
        )
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute(
            "INSERT INTO hop_dong (id, organization_id, ngay_ky, ngay_thanh_ly) VALUES (?, ?, ?, ?)",
            ("contract-1", "org-1", "2026-07-15", "2026-07-14"),
        )
    connection.close()


def test_ratio_score_and_weight_precision_is_limited_to_four_decimal_places():
    connection = _connection_with("goi_thau", "tieu_chi_danh_gia", "ket_qua_danh_gia_nha_thau")
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute(
            "INSERT INTO goi_thau (id, organization_id, ten_goi_thau, ty_le_bao_dam_hop_dong) VALUES (?, ?, ?, ?)",
            ("precision", "org-1", "Precision", 12.34567),
        )
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute(
            "INSERT INTO tieu_chi_danh_gia (id, organization_id, vong_danh_gia_id, ma_tieu_chi, trong_so) VALUES (?, ?, ?, ?, ?)",
            ("criterion", "org-1", "round-1", "C1", 10.12345),
        )
    connection.close()


def test_database_enforces_rebid_pair_and_plan_total_excludes_rebids():
    connection = _connection_with("ke_hoach_lcnt", "ke_hoach_cong_viec", "goi_thau")
    connection.execute(
        """
        INSERT INTO ke_hoach_lcnt (
            id, organization_id, ten_ke_hoach, ten_du_an_du_toan,
            loai_hinh_mua_sam, chu_dau_tu_id, ngay_phe_duyet,
            quyet_dinh_phe_duyet, is_tong_muc_tu_dong
        ) VALUES ('plan-1', 'org-1', 'Plan', 'Estimate', 'Dự toán mua sắm',
                  'investor-1', '2026-01-01', 'QD-01', 1)
        """
    )
    connection.execute(
        """
        INSERT INTO goi_thau (
            id, organization_id, ke_hoach_id, ten_goi_thau, gia_goi_thau,
            thoi_gian_thuc_hien, nguon_von, thoi_gian_to_chuc,
            thoi_gian_bat_dau_to_chuc, trang_thai
        ) VALUES ('source', 'org-1', 'plan-1', 'Source', 100,
                  '30 ngày', 'Ngân sách', '30 ngày', 'Quý I/2026', 'CANCELLED')
        """
    )
    connection.execute(
        """
        INSERT INTO goi_thau (
            id, organization_id, ke_hoach_id, ten_goi_thau, gia_goi_thau,
            thoi_gian_thuc_hien, nguon_von, thoi_gian_to_chuc,
            thoi_gian_bat_dau_to_chuc, is_rebid, rebid_from_package_id
        ) VALUES ('rebid', 'org-1', 'plan-1', 'Rebid', 150,
                  '30 ngày', 'Ngân sách', '30 ngày', 'Quý I/2026', 1, 'source')
        """
    )

    with pytest.raises(sqlite3.IntegrityError):
        connection.execute(
            """
            INSERT INTO goi_thau (
                id, organization_id, ke_hoach_id, ten_goi_thau, is_rebid
            ) VALUES ('missing-source', 'org-1', 'plan-1', 'Invalid', 1)
            """
        )

    recalculate_tong_muc_dau_tu(connection.cursor(), organization_id="org-1")
    total = connection.execute(
        "SELECT tong_muc_dau_tu FROM ke_hoach_lcnt WHERE id = 'plan-1'"
    ).fetchone()[0]
    assert total == 100
    connection.close()


def test_opening_bid_uses_one_numeric_field_per_security_concept():
    columns = SCHEMA_DINH_NGHIA["thong_tin_mo_thau"]["columns"]
    assert {"gia_tri_dam_bao", "hieu_luc_bao_dam_ngay", "hieu_luc_hsdt"} <= set(columns)
    assert {"dam_bao_du_thau", "hieu_luc_dam_bao", "hieu_luc_hsdxt"}.isdisjoint(columns)

    payload = map_db_to_json("thong_tin_mo_thau", {
        "id": "opening-1",
        "organization_id": "org-1",
        "goi_thau_id": "package-1",
        "nha_thau_id": "contractor-1",
        "ma_phan_lo": "",
        "gia_tri_dam_bao": 1_500_000,
        "hieu_luc_bao_dam_ngay": 120,
        "hieu_luc_hsdt": 90,
    })
    assert payload["giaTriDamBao"] == "1500000"
    assert payload["hieuLucBaoDamNgay"] == 120
    assert payload["hieuLucHsdt"] == 90
    assert "damBaoDuThau" not in payload
    assert "hieuLucDamBao" not in payload
    assert "hieuLucHsdxt" not in payload


def test_opening_bid_business_key_is_unique_only_while_active():
    connection = sqlite3.connect(":memory:")
    for table_name, table_spec in SCHEMA_DINH_NGHIA.items():
        connection.execute(_build_create_table_sql(table_name, table_spec))
    _create_baseline_indexes_and_triggers(connection.cursor())
    values = ("org-1", "package-1", "contractor-1", "")
    connection.execute(
        """INSERT INTO thong_tin_mo_thau
        (id, organization_id, goi_thau_id, nha_thau_id, ma_phan_lo, archived_at)
        VALUES ('archived', ?, ?, ?, ?, '2026-07-14 00:00:00')""",
        values,
    )
    connection.execute(
        """INSERT INTO thong_tin_mo_thau
        (id, organization_id, goi_thau_id, nha_thau_id, ma_phan_lo)
        VALUES ('active', ?, ?, ?, ?)""",
        values,
    )
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute(
            """INSERT INTO thong_tin_mo_thau
            (id, organization_id, goi_thau_id, nha_thau_id, ma_phan_lo)
            VALUES ('duplicate', ?, ?, ?, ?)""",
            values,
        )
    connection.close()


def test_normalized_contractor_tax_code_is_unique_per_workspace_latest_record():
    connection = _connection_with("to_chuc", "nha_thau")
    connection.execute("""
        CREATE UNIQUE INDEX idx_nha_thau_ma_so_thue_owner_latest_unique
        ON nha_thau (organization_id, lower(trim(ma_so_thue)))
        WHERE is_latest = 1 AND ma_so_thue IS NOT NULL AND trim(ma_so_thue) != ''
    """)
    connection.execute("INSERT INTO to_chuc (id, ten_to_chuc) VALUES ('org-1', 'Workspace')")
    connection.execute(
        """INSERT INTO nha_thau
           (id, organization_id, ten_nha_thau, ma_so_thue, is_latest)
           VALUES ('contractor-a', 'org-1', 'A', ' 0312345678 ', 1)"""
    )

    with pytest.raises(sqlite3.IntegrityError):
        connection.execute(
            """INSERT INTO nha_thau
               (id, organization_id, ten_nha_thau, ma_so_thue, is_latest)
               VALUES ('contractor-b', 'org-1', 'B', '0312345678', 1)"""
        )

    # A historical version is legal; only the latest record represents the
    # logical contractor in current catalog lookups.
    connection.execute(
        """INSERT INTO nha_thau
           (id, organization_id, ten_nha_thau, ma_so_thue, is_latest)
           VALUES ('contractor-history', 'org-1', 'History', '0312345678', 0)"""
    )
    connection.close()
