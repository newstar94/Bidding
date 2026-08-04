from __future__ import annotations

from copy import copy
from decimal import Decimal
from io import BytesIO
import sqlite3

from openpyxl import Workbook, load_workbook
from openpyxl.comments import Comment
from openpyxl.worksheet.datavalidation import DataValidation
import pytest

from backend.documents import award_result_excel_service as service


def _workbook_bytes(headers, row, *, header_row=1):
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Danh sách nhà thầu"
    if header_row == 2:
        sheet.append(["Hướng dẫn nhập dữ liệu", *([""] * (len(headers) - 1))])
    sheet.append(headers)
    sheet.append(row)
    for cell in sheet[header_row]:
        font = copy(cell.font)
        font.bold = True
        cell.font = font
        fill = copy(cell.fill)
        fill.fill_type = "solid"
        fill.fgColor.rgb = "EEEEEE"
        cell.fill = fill
    for column in range(1, len(headers) + 1):
        sheet.column_dimensions[service._get_column_letter(column) if hasattr(service, "_get_column_letter") else chr(64 + column)].width = 18
    status_column = headers.index("Kết quả") + 1
    validation = DataValidation(type="list", formula1='"Trúng thầu,Không trúng thầu"')
    validation.add(sheet.cell(header_row + 1, status_column))
    sheet.add_data_validation(validation)
    sheet.freeze_panes = sheet.cell(header_row + 1, 1)
    sheet.print_area = f"A1:{service._get_column_letter(len(headers)) if hasattr(service, '_get_column_letter') else chr(64 + len(headers))}{header_row + 1}"
    sheet.row_dimensions[header_row + 1].height = 27
    sheet.column_dimensions["B"].hidden = True
    sheet.cell(header_row + 1, status_column).number_format = "@"
    sheet.cell(header_row + 1, status_column).comment = Comment(
        "Chỉ cập nhật trường kết quả", "Test"
    )
    hidden = workbook.create_sheet("Metadata")
    hidden.sheet_state = "hidden"
    hidden["A1"] = "=1+1"
    hidden.merge_cells("B2:C2")
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


def standard_workbook_bytes(*, permuted=False):
    headers = list(service.EXPECTED_HEADERS)
    row = [
        "L01", "Lô 01", "vn001", "001", "Nhà thầu 01", 1_000,
        "", "", "", "", "", "", "", "", "",
    ]
    if permuted:
        order = [4, 0, 2, 1, 3, 5, 7, 6, 8, 9, 10, 11, 12, 13, 14]
        headers = [headers[index] for index in order]
        row = [row[index] for index in order]
    return _workbook_bytes(headers, row)


def standard_multi_lot_workbook_bytes():
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Danh sách nhà thầu"
    sheet.append(list(service.EXPECTED_HEADERS))
    rows = [
        ["L01", "Lô 01", "vn001", "001", "Nhà thầu A", 1_000],
        ["L02", "Lô 02", "vn001", "001", "Nhà thầu A", 1_100],
        ["L03", "Lô 03", "vn002", "002", "Nhà thầu B", 1_200],
        ["L04", "Lô 04", "vn003", "003", "Nhà thầu C", 1_300],
        ["L99", "Không khớp", "vn999", "999", "Nhà thầu Z", 9_999],
    ]
    for source in rows:
        sheet.append([*source, *("" for _ in range(9))])
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


def medicine_workbook_bytes():
    row = [
        1, "THUOC-01", "Atropin sulfat", "vn001", "001", "Nhà thầu 01",
        1_014_000, "", "", "", "", "", "", 5, "", "", "", "", "",
    ]
    return _workbook_bytes(
        list(service.MEDICINE_EXPECTED_HEADERS), row, header_row=2
    )


def _record(**overrides):
    values = {
        "opening_id": "opening-1",
        "lot_code": "L01",
        "bidder_identifier": "vn001",
        "tax_code": "001",
        "bidder_name": "Nhà thầu 01",
        "status": "Trúng thầu",
        "corrected_price": 950,
        "award_price": 900,
        "package_duration": "30 ngày",
        "contract_duration": "60 ngày",
    }
    values.update(overrides)
    return service.AwardRecord(**values)


def test_inspection_finds_source_and_output_columns_after_reordering():
    inspection = service.inspect_award_result_workbook(
        standard_workbook_bytes(permuted=True)
    )

    assert inspection["templateType"] == "standard"
    assert inspection["columnMap"]["source"] == [2, 4, 3, 5, 1, 6]
    assert inspection["columnMap"]["output"][:2] == [8, 7]
    assert inspection["rows"][0]["lotCode"] == "L01"
    assert inspection["rows"][0]["bidderIdentifier"] == "vn001"
    assert inspection["blockingErrors"] == []


def test_inspection_rejects_invalid_workbook_and_missing_template_sheet():
    with pytest.raises(service.AwardResultExcelError) as invalid:
        service.inspect_award_result_workbook(b"not-an-xlsx")
    assert invalid.value.code == "WORKBOOK_INVALID"

    workbook = Workbook()
    workbook.active["A1"] = "Dữ liệu không liên quan"
    output = BytesIO()
    workbook.save(output)
    inspection = service.inspect_award_result_workbook(output.getvalue())

    assert {item["code"] for item in inspection["blockingErrors"]} == {
        "WORKSHEET_NOT_FOUND"
    }


def test_inspection_reports_missing_required_result_header():
    headers = list(service.EXPECTED_HEADERS)
    headers[10] = ""
    content = _workbook_bytes(
        headers,
        ["L01", "Lô 01", "vn001", "001", "Nhà thầu 01", 1_000, *("" for _ in range(9))],
    )

    inspection = service.inspect_award_result_workbook(content)

    assert any(
        item["code"] == "REQUIRED_HEADER_MISSING"
        and item["expectedHeader"] == "Giá trúng thầu"
        for item in inspection["blockingErrors"]
    )


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("  L01  ", "l01"),
        ("001", "001"),
        ("001.0", "001"),
        (1.0, "1"),
        (Decimal("12.50"), "12.50"),
        (None, ""),
    ],
)
def test_identifier_normalization_is_stable(value, expected):
    assert service.normalize_code(value) == expected
    assert service.normalize_tax_code(value) == expected


def test_decimal_mapping_never_uses_float_arithmetic():
    assert service._number(Decimal("123.456789012345678")) == {
        "decimal": "123.456789012345678"
    }
    assert service._number("123.456789012345678") == {
        "decimal": "123.456789012345678"
    }


def test_matching_uses_primary_then_fallback_and_never_name_only():
    inspection = {
        "templateType": "standard",
        "sheetName": "Danh sách nhà thầu",
        "totalRows": 3,
        "existingResultRows": 0,
        "blockingErrors": [],
        "warnings": [],
        "rows": [
            {"excelRow": 2, "lotCode": "L01", "bidderIdentifier": "vn001", "taxCode": "001", "bidderName": "Tên khác", "sourceFingerprint": "a"},
            {"excelRow": 3, "lotCode": "L02", "bidderIdentifier": "", "taxCode": "002", "bidderName": "Nhà thầu 02", "sourceFingerprint": "b"},
            {"excelRow": 4, "lotCode": "L03", "bidderIdentifier": "", "taxCode": "", "bidderName": "Nhà thầu 03", "sourceFingerprint": "c"},
        ],
    }
    records = [
        _record(),
        _record(opening_id="opening-2", lot_code="L02", bidder_identifier="vn002", tax_code="002"),
        _record(opening_id="opening-3", lot_code="L03", bidder_identifier="vn003", tax_code="003", bidder_name="Nhà thầu 03"),
    ]

    result = service.match_award_result_rows(inspection, records)

    assert result["exactMatches"] == 1
    assert result["fallbackMatches"] == 1
    assert result["unmatchedRows"] == 1
    assert result["missingBidderIdentityRows"] == 1
    assert result["rows"][0]["matchMethod"] == "lot_code_and_bidder_identifier"
    assert any(item["code"] == "BIDDER_NAME_DIFFERS" for item in result["rows"][0]["warnings"])


def test_matching_blocks_duplicate_and_identifier_tax_conflicts():
    inspection = {
        "templateType": "standard",
        "sheetName": "Danh sách nhà thầu",
        "totalRows": 2,
        "existingResultRows": 0,
        "blockingErrors": [],
        "warnings": [],
        "rows": [
            {"excelRow": 2, "lotCode": "L01", "bidderIdentifier": "vn001", "taxCode": "001", "bidderName": "", "sourceFingerprint": "a"},
            {"excelRow": 3, "lotCode": "L02", "bidderIdentifier": "vn002", "taxCode": "009", "bidderName": "", "sourceFingerprint": "b"},
        ],
    }
    records = [
        _record(),
        _record(opening_id="duplicate", bidder_name="Nhà thầu trùng"),
        _record(opening_id="identifier", lot_code="L02", bidder_identifier="vn002", tax_code="002"),
        _record(opening_id="tax", lot_code="L02", bidder_identifier="vn009", tax_code="009"),
    ]

    result = service.match_award_result_rows(inspection, records)

    assert result["duplicateRows"] == 1
    assert result["conflictRows"] == 1
    assert {item["code"] for item in result["blockingErrors"]} == {
        "DUPLICATE_MATCH_KEY", "IDENTIFIER_TAX_CONFLICT",
    }
    assert result["canExport"] is False


def test_standard_export_preserves_source_order_styles_validation_and_hidden_sheet():
    content = standard_workbook_bytes(permuted=True)
    inspection = service.inspect_award_result_workbook(content)
    match = service.match_award_result_rows(inspection, [_record()])

    output = service.write_award_result_workbook(
        content, service.export_updates_from_match(match)
    )

    before = load_workbook(BytesIO(content), data_only=False)
    after = load_workbook(BytesIO(output), data_only=False)
    assert before.sheetnames == after.sheetnames
    assert after["Metadata"].sheet_state == "hidden"
    assert after["Metadata"]["A1"].value == "=1+1"
    assert str(after["Metadata"].merged_cells.ranges) == str(
        before["Metadata"].merged_cells.ranges
    )
    assert after.worksheets[0].freeze_panes == before.worksheets[0].freeze_panes
    assert str(after.worksheets[0].print_area) == str(before.worksheets[0].print_area)
    assert after.worksheets[0].row_dimensions[2].height == 27
    assert after.worksheets[0].column_dimensions["B"].hidden is True
    source_columns = inspection["columnMap"]["source"]
    assert [before.worksheets[0].cell(2, column).value for column in source_columns] == [
        after.worksheets[0].cell(2, column).value for column in source_columns
    ]
    output_columns = inspection["columnMap"]["output"]
    assert after.worksheets[0].cell(2, output_columns[0]).value == "Trúng thầu"
    assert after.worksheets[0].cell(2, output_columns[4]).value == 900
    assert after.worksheets[0].cell(2, output_columns[0]).style_id == (
        before.worksheets[0].cell(2, output_columns[0]).style_id
    )
    assert after.worksheets[0].cell(2, output_columns[0]).comment.text == (
        before.worksheets[0].cell(2, output_columns[0]).comment.text
    )
    assert len(after.worksheets[0].data_validations.dataValidation) == 1


def test_medicine_export_writes_quantity_and_unit_price_but_preserves_discount():
    content = medicine_workbook_bytes()
    inspection = service.inspect_award_result_workbook(content)
    record = _record(
        lot_code="THUOC-01",
        corrected_price=1_014_000,
        award_quantity=1_300,
        award_unit_price=780,
        award_price=1_014_000,
    )
    match = service.match_award_result_rows(inspection, [record])

    output = service.write_award_result_workbook(
        content, service.export_updates_from_match(match)
    )
    sheet = load_workbook(BytesIO(output)).worksheets[0]

    assert inspection["templateType"] == "medicine"
    assert sheet["H3"].value == "Trúng thầu"
    assert sheet["L3"].value == 1_300
    assert sheet["M3"].value == 780
    assert sheet["N3"].value == 5
    assert sheet["O3"].value == 1_014_000


def test_multi_lot_pipeline_keeps_each_bidder_lot_independent_and_leaves_unmatched_row():
    content = standard_multi_lot_workbook_bytes()
    inspection = service.inspect_award_result_workbook(content)
    records = [
        _record(
            opening_id="l01-a",
            lot_code="L01",
            bidder_identifier="vn001",
            tax_code="001",
            bidder_name="Nhà thầu A",
            status="Trúng thầu",
            corrected_price=900,
            technical_score=90,
            evaluated_price=None,
            award_price=850,
        ),
        _record(
            opening_id="l02-a",
            lot_code="L02",
            bidder_identifier="vn001",
            tax_code="001",
            bidder_name="Nhà thầu A",
            status="Không trúng thầu",
            corrected_price=1_050,
            award_price=None,
            rejection_reason="Xếp hạng sau nhà thầu khác",
        ),
        _record(
            opening_id="l03-b",
            lot_code="L03",
            bidder_identifier="vn002",
            tax_code="002",
            bidder_name="Nhà thầu B",
            status="Không trúng thầu",
            corrected_price=1_200,
            award_price=None,
            rejection_reason="Lô bị hủy theo quyết định phê duyệt",
            lot_cancelled=True,
        ),
        _record(
            opening_id="l04-c",
            lot_code="L04",
            bidder_identifier="vn003",
            tax_code="003",
            bidder_name="Nhà thầu C",
            status="Trúng thầu",
            corrected_price=1_100,
            evaluated_price=1_080,
            award_price=1_050,
        ),
    ]

    match = service.match_award_result_rows(
        inspection,
        records,
        known_lot_codes=["L01", "L02", "L03", "L04"],
    )
    output = service.write_award_result_workbook(
        content, service.export_updates_from_match(match)
    )
    before = load_workbook(BytesIO(content)).worksheets[0]
    after = load_workbook(BytesIO(output)).worksheets[0]

    assert match["exactMatches"] == 4
    assert match["unmatchedRows"] == 1
    assert match["canExport"] is True
    assert [after.cell(row, 1).value for row in range(2, 7)] == [
        "L01", "L02", "L03", "L04", "L99"
    ]
    assert after["G2"].value == "Trúng thầu"
    assert after["I2"].value == 90
    assert after["J2"].value is None
    assert after["K2"].value == 850
    assert after["G3"].value == "Không trúng thầu"
    assert after["K3"].value is None
    assert after["L3"].value == "Xếp hạng sau nhà thầu khác"
    assert after["G4"].value == "Không trúng thầu"
    assert after["L4"].value == "Lô bị hủy theo quyết định phê duyệt"
    assert after["H5"].value == 1_100
    assert after["K5"].value == 1_050
    assert [after.cell(6, column).value for column in range(7, 16)] == [
        before.cell(6, column).value for column in range(7, 16)
    ]
    assert [
        service._row_fingerprint(after[row][0:6]) for row in range(2, 7)
    ] == [service._row_fingerprint(before[row][0:6]) for row in range(2, 7)]


class _Database:
    def __init__(self, connection):
        self.connection = connection

    def get_connection(self):
        return _Connection(self.connection)


class _Connection:
    def __init__(self, connection):
        self.connection = connection

    def cursor(self):
        return self.connection.cursor()

    def close(self):
        pass


def test_medicine_dataset_uses_official_lot_and_bidder_goods_without_n_plus_one():
    connection = sqlite3.connect(":memory:")
    try:
        connection.row_factory = sqlite3.Row
        statements = []
        connection.set_trace_callback(statements.append)
        connection.executescript(
            """
        CREATE TABLE goi_thau (id TEXT, organization_id TEXT, ma_goi_thau TEXT, ten_goi_thau TEXT, phan_lo TEXT, trang_thai TEXT, nha_thau_trung_thau_id TEXT, gia_trung_thau INTEGER, thoi_gian_goi_thau TEXT, thoi_gian_hop_dong TEXT, phuong_phap_danh_gia TEXT, is_thuoc INTEGER);
        CREATE TABLE goi_thau_phan_lo (id TEXT, organization_id TEXT, goi_thau_id TEXT, ma_phan_lo TEXT, ten_phan_lo TEXT, nha_thau_trung_thau_id TEXT, gia_trung_thau INTEGER, thoi_gian_goi_thau TEXT, thoi_gian_hop_dong TEXT, archived_at TEXT, sort_order INTEGER);
        CREATE TABLE dot_xu_ly_phan_lo_chi_tiet (organization_id TEXT, lot_id TEXT, batch_id TEXT, current_stage TEXT, outcome TEXT);
        CREATE TABLE dot_xu_ly_phan_lo (organization_id TEXT, id TEXT, sequence_no INTEGER);
        CREATE TABLE nha_thau (id TEXT, organization_id TEXT, ten_nha_thau TEXT, ma_nha_thau TEXT, ma_so_thue TEXT);
        CREATE TABLE thong_tin_mo_thau (id TEXT, organization_id TEXT, goi_thau_id TEXT, nha_thau_id TEXT, ma_phan_lo TEXT, ma_dinh_danh TEXT, ten_nha_thau TEXT, gia_du_thau INTEGER, gia_sau_giam_gia INTEGER, gia_danh_gia_sau_uu_dai INTEGER, thoi_gian_thuc_hien TEXT, archived_at TEXT);
        CREATE TABLE ket_qua_danh_gia_nha_thau (organization_id TEXT, thong_tin_mo_thau_id TEXT, diem REAL, ly_do_loai TEXT, danh_gia_ket_luan TEXT);
        CREATE TABLE hang_hoa_du_thau_nha_thau (id TEXT, organization_id TEXT, goi_thau_id TEXT, thong_tin_mo_thau_id TEXT, khoi_luong REAL, don_gia_du_thau INTEGER, gia_tri_co_so_sau_giam_gia INTEGER, goi_thau_hang_hoa_id TEXT, sort_order INTEGER, is_draft INTEGER);
        INSERT INTO goi_thau VALUES ('pkg','org','IB-01','Thuốc','Có','AWARDED',NULL,1014000,NULL,NULL,NULL,1);
        INSERT INTO goi_thau_phan_lo VALUES ('lot','org','pkg','THUOC-01','Atropin','bidder',1014000,'220 ngày','220 ngày + nghĩa vụ',NULL,1);
        INSERT INTO dot_xu_ly_phan_lo VALUES ('org','batch',1);
        INSERT INTO dot_xu_ly_phan_lo_chi_tiet VALUES ('org','lot','batch','RESULT_APPROVED','AWARDED');
        INSERT INTO nha_thau VALUES ('bidder','org','Nhà thầu 01','vn001','001');
        INSERT INTO thong_tin_mo_thau VALUES ('opening','org','pkg','bidder','THUOC-01','vn001','Nhà thầu 01',1014000,1014000,NULL,'220 ngày',NULL);
        INSERT INTO ket_qua_danh_gia_nha_thau VALUES ('org','opening',NULL,NULL,'Đạt');
        INSERT INTO hang_hoa_du_thau_nha_thau VALUES ('goods','org','pkg','opening',1300,780,1014000,'requirement',1,0);
            """
        )
        statements.clear()

        dataset = service.load_award_result_dataset(
            "pkg", "org", database_obj=_Database(connection)
        )

        record = dataset["records"][0]
        assert dataset["package"]["is_thuoc"] == 1
        assert record.status == "Trúng thầu"
        assert record.award_quantity == 1_300
        assert record.award_unit_price == 780
        assert record.award_price == 1_014_000
        assert dataset["blockingErrors"] == []
        assert len(
            [sql for sql in statements if sql.lstrip().upper().startswith("SELECT")]
        ) == 4
    finally:
        connection.close()


def test_validation_token_is_bound_to_user_org_package_hash_and_expiry(tmp_path, monkeypatch):
    monkeypatch.setattr(
        service,
        "resolve_runtime_path",
        lambda _name: tmp_path / "document-worker-temp",
    )
    monkeypatch.setenv("AWARD_RESULT_EXCEL_TOKEN_KEY", "x" * 32)
    content = standard_workbook_bytes()
    inspection = service.inspect_award_result_workbook(content)
    token, _metadata = service.create_validation_artifact(
        content,
        inspection,
        user_id="user",
        organization_id="org",
        package_id="pkg",
        original_filename="input.xlsx",
        now=100,
    )

    metadata, stored = service.load_validation_artifact(
        token, user_id="user", organization_id="org", package_id="pkg", now=101
    )
    assert stored == content
    assert metadata["sha256"]
    with pytest.raises(service.AwardResultExcelError) as wrong_user:
        service.load_validation_artifact(
            token, user_id="other", organization_id="org", package_id="pkg", now=101
        )
    assert wrong_user.value.code == "VALIDATION_TOKEN_SCOPE_MISMATCH"
    with pytest.raises(service.AwardResultExcelError) as wrong_org:
        service.load_validation_artifact(
            token, user_id="user", organization_id="other", package_id="pkg", now=101
        )
    assert wrong_org.value.code == "VALIDATION_TOKEN_SCOPE_MISMATCH"
    with pytest.raises(service.AwardResultExcelError) as wrong_package:
        service.load_validation_artifact(
            token, user_id="user", organization_id="org", package_id="other", now=101
        )
    assert wrong_package.value.code == "VALIDATION_TOKEN_SCOPE_MISMATCH"
    with pytest.raises(service.AwardResultExcelError) as expired:
        service.load_validation_artifact(
            token,
            user_id="user",
            organization_id="org",
            package_id="pkg",
            now=100 + service.VALIDATION_TTL_SECONDS + 1,
        )
    assert expired.value.code == "VALIDATION_TOKEN_EXPIRED"


def test_validation_artifact_detects_changed_workbook(tmp_path, monkeypatch):
    monkeypatch.setattr(
        service,
        "resolve_runtime_path",
        lambda _name: tmp_path / "document-worker-temp",
    )
    monkeypatch.setenv("AWARD_RESULT_EXCEL_TOKEN_KEY", "x" * 32)
    content = standard_workbook_bytes()
    token, metadata = service.create_validation_artifact(
        content,
        service.inspect_award_result_workbook(content),
        user_id="user",
        organization_id="org",
        package_id="pkg",
        original_filename="input.xlsx",
        now=100,
    )
    validation_dir = (
        tmp_path
        / "document-worker-temp"
        / "award-result-validations"
        / f"validation-{metadata['validationId']}"
    )
    (validation_dir / "workbook.xlsx").write_bytes(content + b"changed")

    with pytest.raises(service.AwardResultExcelError) as changed:
        service.load_validation_artifact(
            token,
            user_id="user",
            organization_id="org",
            package_id="pkg",
            now=101,
        )

    assert changed.value.code == "WORKBOOK_CHANGED_AFTER_VALIDATION"


def test_output_filename_is_sanitized():
    assert service.output_filename('../35:"bad".xlsx') == "35__bad_da_dien_ket_qua.xlsx"
