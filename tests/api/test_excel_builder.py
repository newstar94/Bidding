from backend.app import app  # noqa: F401 - initializes backend import paths
from backend.documents.excel_service import (
    create_excel_template,
    create_mothau_template,
    create_phanlo_excel,
    create_tuychonmuathem_excel,
)
import backend.documents.excel_service as excel_service


def _headers(workbook):
    return [cell.value for cell in workbook.active[1]]


def test_configured_excel_builder_preserves_entity_and_opening_templates():
    entity_book = create_excel_template("goithau")
    assert entity_book.active.title == "Nhap Lieu"
    assert "Giá gói thầu" in _headers(entity_book)
    price_column = _headers(entity_book).index("Giá gói thầu") + 1
    assert entity_book.active.cell(2, price_column).number_format == "#,##0"
    assert entity_book["Dropdowns"].sheet_state == "hidden"

    opening_book = create_mothau_template("1G1T_WITH_LOT", ["L01", "L02"])
    assert opening_book.active.title == "Mo Thau"
    assert _headers(opening_book)[:3] == [
        "Loại nhà thầu", "Mã phần lô", "Tên phần lô (Tự động điền)"
    ]
    assert opening_book["Dropdowns"].sheet_state == "hidden"
    assert len(opening_book.active.data_validations.dataValidation) == 2


def test_configured_excel_builder_preserves_list_exports_and_currency():
    lot_book = create_phanlo_excel([{
        "maPhanLo": "L01", "tenPhanLo": "Lô 1",
        "giaTriPhanLo": 1250000, "baoDamDuThau": 50000,
        "thoiGianThucHien": 30,
    }])
    assert [cell.value for cell in lot_book.active[2]] == ["L01", "Lô 1", 1250000, 50000, 30]
    assert lot_book.active.cell(2, 3).number_format == "#,##0"

    option_book = create_tuychonmuathem_excel([{
        "hangMuc": "Thiết bị", "donVi": "Bộ", "soLuong": 2,
        "tyLe": 10, "giaTriUocTinh": 300000,
    }])
    assert option_book.active.cell(2, 5).value == 300000
    assert option_book.active.cell(2, 5).number_format == "#,##0"


def test_opening_builder_rejects_unknown_configuration():
    try:
        create_mothau_template("UNKNOWN", [])
    except ValueError as exc:
        assert "Invalid opening template type" in str(exc)
    else:
        raise AssertionError("Unknown opening template was accepted")


class _FakeConnection:
    def __init__(self, cursor):
        self._cursor = cursor

    def cursor(self):
        return self._cursor

    def close(self):
        pass


class _FakeCursor:
    def __init__(self, one=None, all_rows=None):
        self.one = one
        self.all_rows = all_rows or []

    def execute(self, *_args, **_kwargs):
        return self

    def fetchone(self):
        return self.one

    def fetchall(self):
        return self.all_rows


def test_database_excel_builders_keep_business_rows(monkeypatch):
    opening_bid = (
        "VN01", "Nhà thầu A", 1250000, 5, 1187500, 90, 30,
        "Đạt", "Đạt", "Đạt", "Đạt",
    )
    joint_venture_bid = (
        "VN02", "Liên danh QL8A", 1500000, 0, 1500000, 90, 45,
        "Đạt", "Đạt", "Đạt", "Đạt",
    )
    monkeypatch.setattr(
        excel_service.database, "get_connection",
        lambda: _FakeConnection(_FakeCursor(all_rows=[opening_bid, joint_venture_bid])),
    )
    opening_book = excel_service.create_opening_fin_template("gt-1", "org-1")
    assert opening_book.active.cell(2, 1).value == "VN01"
    assert opening_book.active.cell(2, 5).value == 1250000
    assert opening_book.active.cell(2, 5).number_format == "#,##0"
    assert opening_book.active.cell(3, 2).value == "Liên danh QL8A"

    result_cursor = _FakeCursor(
        one=("nt-1", 1200000, 30, 45),
        all_rows=[("Độc lập", "", "", "nt-1", "Nhà thầu A", 1250000, 5, 1187500, "Xếp hạng 1")],
    )
    monkeypatch.setattr(
        excel_service.database, "get_connection",
        lambda: _FakeConnection(result_cursor),
    )
    result_book = excel_service.create_ketquaqd_template("gt-1", "org-1")
    assert [cell.value for cell in result_book.active[2]][2:6] == [
        "Nhà thầu A", "Trúng thầu", "", 1200000,
    ]
    assert result_book.active.cell(2, 6).number_format == "#,##0"
