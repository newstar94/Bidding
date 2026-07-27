from backend.db.schema import MONEY_COLUMNS, SCHEMA_DINH_NGHIA
from backend.db.upgrades import DB_SCHEMA_VERSION
from backend.sync.mapper import (
    _attach_bid_evaluation_results,
    _save_bid_evaluation_result,
)
from backend.sync.payload_validation import SYNC_VIRTUAL_FIELDS, validate_sync_item


class _CaptureCursor:
    def __init__(self):
        self.sql = ""
        self.params = ()

    def execute(self, sql, params=()):
        self.sql = sql
        self.params = params
        return self


class _EvaluationReadCursor:
    def execute(self, _sql, _params=()):
        return self

    def fetchall(self):
        return [{
            "id": "result-1",
            "thong_tin_mo_thau_id": "bid-1",
            "gia_xep_hang": 9_007_199_254_740_993,
            "gia_de_nghi_trung_thau": 9_007_199_254_740_992,
            "chap_thuan_gia_de_nghi_trung_thau_duoi_50": 0,
        }]


def test_schema_and_upgrade_include_bid_evaluation_prices():
    columns = SCHEMA_DINH_NGHIA["ket_qua_danh_gia_nha_thau"]["columns"]
    assert "gia_xep_hang" in columns
    assert "gia_de_nghi_trung_thau" in columns
    assert "chap_thuan_gia_de_nghi_trung_thau_duoi_50" in columns
    assert ("ket_qua_danh_gia_nha_thau", "gia_xep_hang") in MONEY_COLUMNS
    assert ("ket_qua_danh_gia_nha_thau", "gia_de_nghi_trung_thau") in MONEY_COLUMNS
    assert DB_SCHEMA_VERSION >= 21


def test_sync_contract_persists_both_bid_evaluation_prices():
    virtual_fields = SYNC_VIRTUAL_FIELDS["thong_tin_mo_thau"]
    assert {
        "giaXepHang",
        "giaDeNghiTrungThau",
        "chapThuanGiaDeNghiTrungThauDuoi50",
    } <= virtual_fields

    item, errors, _ = validate_sync_item("thong_tin_mo_thau", {
        "giaXepHang": "1200000",
        "giaDeNghiTrungThau": "1150000",
        "chapThuanGiaDeNghiTrungThauDuoi50": False,
    })
    assert errors == []
    assert item["giaXepHang"] == "1200000"
    assert item["giaDeNghiTrungThau"] == "1150000"
    assert item["chapThuanGiaDeNghiTrungThauDuoi50"] is False

    cursor = _CaptureCursor()
    _save_bid_evaluation_result(
        cursor,
        "bid-1",
        {
            "goiThauId": "gt-1",
            "giaXepHang": "1200000",
            "giaDeNghiTrungThau": "1150000",
            "chapThuanGiaDeNghiTrungThauDuoi50": False,
        },
        "org-1",
        "organization",
        3,
        "2026-07-27 12:00:00",
    )
    assert "gia_xep_hang" in cursor.sql
    assert "gia_de_nghi_trung_thau" in cursor.sql
    assert "chap_thuan_gia_de_nghi_trung_thau_duoi_50" in cursor.sql
    assert cursor.sql.count("?") == len(cursor.params)
    assert 1200000 in cursor.params
    assert 1150000 in cursor.params


def test_sync_rejects_negative_bid_evaluation_prices():
    _, errors, _ = validate_sync_item("thong_tin_mo_thau", {
        "giaXepHang": -1,
        "giaDeNghiTrungThau": -2,
    })
    assert "Giá xếp hạng không được nhỏ hơn 0." in errors
    assert "Giá đề nghị trúng thầu không được nhỏ hơn 0." in errors


def test_sync_reads_bid_evaluation_prices_as_bigint_safe_strings():
    bids = {"bid-1": {"id": "bid-1"}}
    _attach_bid_evaluation_results(
        _EvaluationReadCursor(),
        bids,
        ["bid-1"],
        "org-1",
        "camel",
    )
    assert bids["bid-1"]["giaXepHang"] == "9007199254740993"
    assert bids["bid-1"]["giaDeNghiTrungThau"] == "9007199254740992"
    assert bids["bid-1"]["chapThuanGiaDeNghiTrungThauDuoi50"] is False


def test_sync_rejects_invalid_low_price_acceptance():
    _, errors, _ = validate_sync_item("thong_tin_mo_thau", {
        "chapThuanGiaDeNghiTrungThauDuoi50": "maybe",
    })
    assert "Lựa chọn xử lý giá đề nghị trúng thầu dưới 50% không hợp lệ." in errors
