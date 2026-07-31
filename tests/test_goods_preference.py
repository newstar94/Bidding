import sqlite3
import json
from pathlib import Path

from backend.domain.goods_preference import calculate_goods_preference, preference_rate_bp
from backend.sync.mapper import _aggregate_persisted_detailed_evaluation_group


SHARED_VECTORS = json.loads(
    (Path(__file__).parent / "fixtures" / "goods_preference_vectors.json").read_text(
        encoding="utf-8"
    )
)


def test_preference_rate_contract_and_difference_matrix():
    assert [preference_rate_bp(code) for code in range(6)] == [0, 750, 1000, 1000, 1200, 1500]
    result = calculate_goods_preference([
        {"id": str(code), "khoiLuong": 1, "thanhTienDuThau": 100, "maUuDai": code}
        for code in range(6)
    ])
    assert result["heSoUuDaiCaoNhatBp"] == 1500
    assert [line["heSoCongUuDaiBp"] for line in result["lines"]] == [1500, 750, 500, 500, 300, 0]


def test_backend_calculator_matches_every_shared_frontend_preference_vector():
    for vector in SHARED_VECTORS:
        result = calculate_goods_preference([
            {
                "id": f"{vector['name']}-{index}",
                "khoiLuong": 1,
                "thanhTienDuThau": 100,
                "maUuDai": code,
            }
            for index, code in enumerate(vector["codes"])
        ])
        assert result["heSoUuDaiCaoNhatBp"] == vector["maximumRateBp"], vector["name"]
        assert [
            line["heSoCongUuDaiBp"] for line in result["lines"]
        ] == vector["surchargeRatesBp"], vector["name"]


def test_item_price_discount_half_up_and_large_integer_money():
    result = calculate_goods_preference([
        {"id": "a", "sortOrder": 0, "khoiLuong": 1, "thanhTienDuThau": 50, "maUuDai": 0},
        {"id": "b", "sortOrder": 1, "khoiLuong": 1, "thanhTienDuThau": 50, "maUuDai": 5},
    ], scope_after_discount=99)
    assert sum(line["giaTriCoSoSauGiamGia"] for line in result["lines"]) == 100
    assert result["lines"][0]["giaTriCongUuDai"] == 8
    assert result["tongGiaTriCongUuDai"] == sum(
        line["giaTriCongUuDai"] for line in result["lines"]
    )
    huge = calculate_goods_preference([
        {"id": "large", "khoiLuong": 1, "thanhTienDuThau": 9_007_199_254_740_993_000, "maUuDai": 0},
        {"id": "best", "khoiLuong": 1, "thanhTienDuThau": 1, "maUuDai": 1},
    ])
    assert huge["giaSoSanhSauUuDai"] > 9_007_199_254_740_993_000
    fractional_discount = calculate_goods_preference([
        {"id": "fractional", "khoiLuong": 1, "thanhTienDuThau": 10_000, "maUuDai": 0},
    ], discount_rate="7.1234")
    assert fractional_discount["tongSauGiamGia"] == 9_288


def test_line_preference_price_uses_its_item_amount_not_the_opening_scope_total():
    result = calculate_goods_preference([
        {
            "id": "item-1",
            "khoiLuong": 18,
            "donGiaDuThau": 1,
            "thanhTienDuThau": 18,
            "maUuDai": 0,
        },
    ], scope_after_discount=200_000_000)

    assert result["lines"][0]["giaDuThauSauUuDai"] == "1"
    assert result["lines"][0]["thanhTienSauUuDai"] == 18
    assert result["giaSoSanhSauUuDai"] == 200_000_000


def test_each_lot_scope_is_calculated_independently_by_call():
    low_scope = calculate_goods_preference([
        {"id": "a", "khoiLuong": 1, "thanhTienDuThau": 100, "maUuDai": 0},
        {"id": "b", "khoiLuong": 1, "thanhTienDuThau": 100, "maUuDai": 1},
    ])
    high_scope = calculate_goods_preference([
        {"id": "c", "khoiLuong": 1, "thanhTienDuThau": 100, "maUuDai": 4},
        {"id": "d", "khoiLuong": 1, "thanhTienDuThau": 100, "maUuDai": 5},
    ])
    assert low_scope["heSoUuDaiCaoNhatBp"] == 750
    assert high_scope["heSoUuDaiCaoNhatBp"] == 1500
    assert [line["heSoCongUuDaiBp"] for line in high_scope["lines"]] == [300, 0]


def test_backend_derives_group_result_from_persisted_required_leaf_rows():
    connection = sqlite3.connect(":memory:")
    connection.executescript(
        """
        CREATE TABLE tieu_chi_danh_gia (
            id TEXT, organization_id TEXT, vong_danh_gia_id TEXT,
            ma_tieu_chi TEXT, ten_tieu_chi TEXT, nhom_danh_gia TEXT,
            bat_buoc INTEGER, tieu_chi_cha_id TEXT
        );
        CREATE TABLE bao_cao_danh_gia_nha_thau (
            id TEXT, organization_id TEXT, vong_danh_gia_id TEXT,
            thong_tin_mo_thau_id TEXT
        );
        CREATE TABLE thong_tin_mo_thau (
            id TEXT, organization_id TEXT, loai_nha_thau TEXT
        );
        CREATE TABLE chi_tiet_danh_gia_nha_thau (
            organization_id TEXT, bao_cao_danh_gia_nha_thau_id TEXT,
            tieu_chi_danh_gia_id TEXT, ket_qua TEXT
        );
        INSERT INTO thong_tin_mo_thau VALUES ('opening-1', 'org-1', 'Độc lập');
        INSERT INTO bao_cao_danh_gia_nha_thau VALUES ('report-1', 'org-1', 'round-1', 'opening-1');
        INSERT INTO tieu_chi_danh_gia VALUES
            ('parent', 'org-1', 'round-1', 'P', 'Nhóm cha', 'validity', 1, NULL),
            ('leaf-1', 'org-1', 'round-1', '1', 'Tiêu chí 1', 'validity', 1, 'parent'),
            ('leaf-2', 'org-1', 'round-1', '2', 'Tiêu chí 2', 'validity', 1, 'parent');
        INSERT INTO chi_tiet_danh_gia_nha_thau VALUES
            ('org-1', 'report-1', 'leaf-1', 'pass'),
            ('org-1', 'report-1', 'leaf-2', 'fail');
        """
    )
    cursor = connection.cursor()
    assert _aggregate_persisted_detailed_evaluation_group(
        cursor, "org-1", "round-1", "report-1", "validity"
    ) == "Không đạt"
    cursor.execute(
        "UPDATE chi_tiet_danh_gia_nha_thau SET ket_qua = 'pass' WHERE tieu_chi_danh_gia_id = 'leaf-2'"
    )
    assert _aggregate_persisted_detailed_evaluation_group(
        cursor, "org-1", "round-1", "report-1", "validity"
    ) == "Đạt"
    cursor.execute(
        "UPDATE chi_tiet_danh_gia_nha_thau SET ket_qua = 'pending' WHERE tieu_chi_danh_gia_id = 'leaf-2'"
    )
    assert _aggregate_persisted_detailed_evaluation_group(
        cursor, "org-1", "round-1", "report-1", "validity"
    ) == ""
    connection.close()
