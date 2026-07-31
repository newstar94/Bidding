"""Pure in-memory Excel builders that do not import application/database state."""

from __future__ import annotations

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation


HEADER_FONT = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
HEADER_FILL = PatternFill(
    start_color="1F4E78",
    end_color="1F4E78",
    fill_type="solid",
)
CENTER_ALIGN = Alignment(horizontal="center", vertical="center")
BORDER_SIDE = Side(border_style="thin", color="D9D9D9")
THIN_BORDER = Border(
    left=BORDER_SIDE,
    right=BORDER_SIDE,
    top=BORDER_SIDE,
    bottom=BORDER_SIDE,
)

def _safe_spreadsheet_text(value):
    if isinstance(value, str) and value.startswith(
        ("=", "+", "-", "@", "\t", "\r", "\n")
    ):
        return f"'{value}"
    return value


def _add_dropdown_sheet(workbook, options_map):
    ranges = {}
    if not options_map:
        return ranges
    sheet = workbook.create_sheet(title="Dropdowns")
    sheet.sheet_state = "hidden"
    for option_index, (header, values) in enumerate(options_map.items(), start=1):
        column_letter = get_column_letter(option_index)
        for value_index, value in enumerate(values, start=1):
            sheet.cell(row=value_index, column=option_index, value=_safe_spreadsheet_text(value))
        ranges[header] = (
            f"Dropdowns!${column_letter}$1:${column_letter}${len(values)}"
        )
    return ranges


def _format_cell(cell, field_format):
    if field_format == "currency":
        cell.number_format = "#,##0"
    elif field_format == "date":
        cell.number_format = "dd/mm/yyyy"
    elif field_format == "datetime":
        cell.number_format = 'hh:mm "ngày" dd/mm/yyyy'


def _finalize_widths(sheet):
    for column in sheet.columns:
        max_len = max(len(str(cell.value or "")) for cell in column)
        sheet.column_dimensions[get_column_letter(column[0].column)].width = max(
            max_len + 3,
            15,
        )


def _build_configured_workbook(
    title,
    headers,
    rows=None,
    options_map=None,
    formats_map=None,
    empty_rows=0,
    validation_padding=10,
):
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = title
    rows = list(rows or [])
    formats_map = formats_map or {}
    option_ranges = _add_dropdown_sheet(workbook, options_map or {})

    sheet.append(headers)
    sheet.row_dimensions[1].height = 28
    for column_index in range(1, len(headers) + 1):
        cell = sheet.cell(row=1, column=column_index)
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
        cell.alignment = CENTER_ALIGN
        cell.border = THIN_BORDER

    total_rows = max(len(rows), empty_rows)
    for row_index in range(2, total_rows + 2):
        sheet.row_dimensions[row_index].height = 22
        values = rows[row_index - 2] if row_index - 2 < len(rows) else []
        for column_index, header in enumerate(headers, start=1):
            value = (
                values[column_index - 1]
                if column_index - 1 < len(values)
                else None
            )
            cell = sheet.cell(
                row=row_index,
                column=column_index,
                value=_safe_spreadsheet_text(value),
            )
            cell.border = THIN_BORDER
            _format_cell(cell, formats_map.get(header))

    validation_end = max(2 + len(rows) + validation_padding, 1 + empty_rows)
    for column_index, header in enumerate(headers, start=1):
        formula = option_ranges.get(header)
        if not formula:
            continue
        column_letter = get_column_letter(column_index)
        validation = DataValidation(
            type="list",
            formula1=formula,
            allow_blank=True,
        )
        validation.error = "Giá trị nhập không hợp lệ, vui lòng chọn từ danh sách"
        validation.errorTitle = "Lỗi nhập dữ liệu"
        validation.prompt = "Vui lòng chọn giá trị từ danh sách"
        validation.promptTitle = header
        sheet.add_data_validation(validation)
        validation.add(f"{column_letter}2:{column_letter}{validation_end}")

    _finalize_widths(sheet)
    return workbook


def create_excel_from_spec(spec):
    """Build a workbook from a JSON-compatible, data-only export contract."""
    if not isinstance(spec, dict):
        raise ValueError("Excel export spec must be an object.")
    allowed_keys = {
        "title",
        "headers",
        "rows",
        "options_map",
        "formats_map",
        "empty_rows",
        "validation_padding",
    }
    if set(spec) - allowed_keys:
        raise ValueError("Excel export spec contains unsupported fields.")
    title = spec.get("title")
    headers = spec.get("headers")
    if not isinstance(title, str) or not title.strip():
        raise ValueError("Excel export spec requires a title.")
    if not isinstance(headers, list) or not headers or not all(
        isinstance(header, str) and header for header in headers
    ):
        raise ValueError("Excel export spec requires headers.")
    return _build_configured_workbook(**spec)


def create_excel_template(import_type):
    """Create a schema-based import template without application state."""
    from backend.documents.excel_handler import (
        _schema_to_formats,
        _schema_to_headers,
        _schema_to_options,
    )

    headers = _schema_to_headers(import_type)
    if not headers:
        raise ValueError(f"Invalid type: {import_type}")
    return _build_configured_workbook(
        "Nhap Lieu",
        headers,
        options_map=_schema_to_options(import_type),
        formats_map=_schema_to_formats(import_type),
        empty_rows=50,
    )


OPENING_TEMPLATE_HEADERS = {
    "TU_VAN": [
        "Loại nhà thầu",
        "Mã nhà thầu",
        "Tên nhà thầu (Nhập chính xác)",
        "Hiệu lực E-HSĐXKT (ngày)",
        "Thời gian thực hiện (ngày)",
    ],
    "1G2T_NO_LOT": [
        "Loại nhà thầu",
        "Mã nhà thầu",
        "Tên nhà thầu (Nhập chính xác)",
        "Đảm bảo dự thầu (VND)",
        "Hiệu lực đảm bảo (ngày)",
        "Hiệu lực E-HSĐXKT (ngày)",
    ],
    "1G2T_WITH_LOT": [
        "Loại nhà thầu",
        "Mã phần lô",
        "Tên phần lô (Tự động điền)",
        "Mã nhà thầu",
        "Tên nhà thầu (Nhập chính xác)",
        "Đảm bảo dự thầu (VND)",
        "Hiệu lực đảm bảo (ngày)",
        "Hiệu lực E-HSĐXKT (ngày)",
    ],
    "1G1T_NO_LOT": [
        "Loại nhà thầu",
        "Mã nhà thầu",
        "Tên nhà thầu (Nhập chính xác)",
        "Giá dự thầu (VND)",
        "Tỷ lệ giảm giá (%)",
        "Giá sau giảm giá (nếu có)",
        "Hiệu lực E-HSDT (ngày)",
        "Giá trị ĐB DT (VND)",
        "Hiệu lực ĐB (ngày)",
        "Thời gian thực hiện (ngày)",
    ],
    "1G1T_WITH_LOT": [
        "Loại nhà thầu",
        "Mã phần lô",
        "Tên phần lô (Tự động điền)",
        "Mã nhà thầu",
        "Tên nhà thầu (Nhập chính xác)",
        "Giá dự thầu (VND)",
        "Tỷ lệ giảm (%)",
        "Giá sau giảm giá (nếu có)",
        "Hiệu lực E-HSDT (ngày)",
        "Giá trị ĐB (VND)",
        "Hiệu lực ĐB",
        "Thời gian thực hiện (ngày)",
    ],
}


def create_mothau_template(case_type, lot_codes):
    """Create an opening workbook without importing database state."""
    headers = OPENING_TEMPLATE_HEADERS.get(case_type)
    if not headers:
        raise ValueError(f"Invalid opening template type: {case_type}")
    options_map = {"Loại nhà thầu": ["Độc lập", "Liên danh"]}
    if "_WITH_LOT" in case_type and lot_codes:
        options_map["Mã phần lô"] = lot_codes
    currency_headers = {
        header: "currency"
        for header in headers
        if "(VND)" in header or header.startswith("Giá sau giảm")
    }
    return _build_configured_workbook(
        "Mo Thau",
        headers,
        options_map=options_map,
        formats_map=currency_headers,
        empty_rows=50,
    )


def create_phanlo_excel(phan_lo_list):
    """Export package-lot rows without importing database state."""
    headers = [
        "Mã phần lô",
        "Tên phần lô",
        "Giá trị phần lô (VND)",
        "Bảo đảm dự thầu (VND)",
        "Thời gian thực hiện (ngày)",
    ]
    rows = [
        [
            item.get("maPhanLo", ""),
            item.get("tenPhanLo", ""),
            item.get("giaTriPhanLo", 0),
            item.get("baoDamDuThau", 0),
            item.get("thoiGianThucHien", 0),
        ]
        for item in phan_lo_list
    ]
    return _build_configured_workbook(
        "Phan Lo",
        headers,
        rows=rows,
        formats_map={
            "Giá trị phần lô (VND)": "currency",
            "Bảo đảm dự thầu (VND)": "currency",
        },
    )


def create_tuychonmuathem_excel(tuy_chon_list):
    """Export optional-purchase rows without importing database state."""
    headers = [
        "Hạng mục",
        "Đơn vị",
        "Số lượng",
        "Tỷ lệ phần trăm (%)",
        "Giá trị ước tính",
    ]
    rows = [
        [
            item.get("hangMuc", ""),
            item.get("donVi", ""),
            item.get("soLuong", 0),
            item.get("tyLe", 0),
            item.get("giaTriUocTinh", 0),
        ]
        for item in tuy_chon_list
    ]
    return _build_configured_workbook(
        "Tuy Chon Mua Them",
        headers,
        rows=rows,
        formats_map={"Giá trị ước tính": "currency"},
    )
