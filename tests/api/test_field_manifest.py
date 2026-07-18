from backend.app import app  # noqa: F401 - initializes backend import paths
from backend.documents.field_manifest import build_field_manifest
from backend.documents.schema_contract import json_key_for_column
from backend.documents.word_defaults import build_default_word_mappings
from backend.documents.excel_handler import _schema_to_formats
from backend.documents.excel_service import create_excel_template


def test_manifest_shares_vietnamese_formats_and_word_variables():
    manifest = build_field_manifest(json_key_for_column, build_default_word_mappings())
    package_fields = manifest["tables"]["goi_thau"]["fields"]

    assert package_fields["ngay_quyet_dinh_ket_qua"]["format"] == "date"
    assert package_fields["thoi_gian_mo_thau"]["format"] == "datetime"
    assert package_fields["gia_goi_thau"]["format"] == "currency"
    assert package_fields["gia_goi_thau"]["wordVariable"] == "gia_gt"
    assert package_fields["gia_goi_thau"]["label"] == "Giá gói thầu"


def test_plain_business_period_is_not_misclassified_as_datetime():
    manifest = build_field_manifest(json_key_for_column)
    package_fields = manifest["tables"]["goi_thau"]["fields"]

    assert package_fields["thoi_gian_bat_dau_to_chuc"]["format"] == "text"
    assert package_fields["ngay_quyet_dinh"]["jsonKey"] == "ngayQuyetDinh"


def test_excel_schema_uses_the_same_field_formats():
    formats = _schema_to_formats("goithau")

    assert formats["Giá gói thầu"] == "currency"
    assert formats["Ngày QĐ phê duyệt"] == "date"
    assert formats["Thời gian mở thầu"] == "datetime"

    workbook = create_excel_template("goithau")
    sheet = workbook.active
    header_columns = {cell.value: cell.column for cell in sheet[1]}
    assert sheet.cell(2, header_columns["Giá gói thầu"]).number_format == "#,##0"
    assert sheet.cell(2, header_columns["Ngày QĐ phê duyệt"]).number_format == "dd/mm/yyyy"
    assert sheet.cell(2, header_columns["Thời gian mở thầu"]).number_format == 'hh:mm "ngày" dd/mm/yyyy'
