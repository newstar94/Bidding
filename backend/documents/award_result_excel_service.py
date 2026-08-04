"""Validation, matching and loss-minimising export for muasamcong award workbooks."""

from __future__ import annotations

import base64
from dataclasses import asdict, dataclass, field
from datetime import date, datetime
from decimal import Decimal
import hashlib
import hmac
from io import BytesIO
import json
import os
from pathlib import Path
import re
import shutil
import time
import unicodedata
import uuid
from typing import Any, Iterable
import zipfile

from openpyxl import load_workbook

from backend.shared.paths import resolve_runtime_path


XLSX_CONTENT_TYPE = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)
MAX_AWARD_RESULT_ROWS = 10_000
MAX_WORKBOOK_CELLS = 1_000_000
VALIDATION_TTL_SECONDS = 15 * 60
_VALIDATION_ID = re.compile(r"[a-f0-9]{32}")

EXPECTED_HEADERS = (
    "Mã phần (lô)",
    "Tên phần (lô)",
    "Mã định danh",
    "Mã số thuế",
    "Tên nhà thầu",
    "Giá dự thầu",
    "Kết quả",
    "Giá dự thầu sau hiệu chỉnh sai lệch thừa (nếu có), giảm giá (nếu có)",
    "Điểm kỹ thuật (nếu có)",
    "Giá đánh giá (nếu có)",
    "Giá trúng thầu",
    "Lý do không đáp ứng",
    "Thời gian thực hiện gói thầu",
    "Thời gian thực hiện hợp đồng",
    "Các nội dung khác (nếu có)",
)

MEDICINE_EXPECTED_HEADERS = (
    "STT",
    "Mã phần (lô)",
    "Tên hoạt chất/ Tên thành phần thuốc",
    "Mã định danh",
    "Mã số thuế",
    "Tên nhà thầu",
    "Giá dự thầu",
    "Kết quả",
    "Giá dự thầu sau hiệu chỉnh sai lệch thừa (nếu có), giảm giá (nếu có)",
    "Điểm kỹ thuật (nếu có)",
    "Giá đánh giá (nếu có)",
    "Số lượng trúng thầu",
    "Đơn giá trúng thầu (VND)",
    "Tỷ lệ giảm giá",
    "Giá trúng thầu",
    "Lý do không đáp ứng",
    "Thời gian thực hiện gói thầu",
    "Thời gian thực hiện hợp đồng",
    "Các nội dung khác (nếu có)",
)

_STANDARD_HEADER_ALIASES = {
    0: {"Mã phần/lô", "Mã lô", "Mã phần"},
    1: {"Tên phần/lô", "Tên lô", "Tên phần"},
    2: {"Mã định danh nhà thầu", "Mã nhà thầu"},
    3: {"Mã số thuế nhà thầu"},
    4: {"Tên nhà thầu (Nhập chính xác)"},
    5: {"Giá dự thầu (VND)"},
    7: {
        "Giá sau sửa lỗi, hiệu chỉnh sai lệch hoặc giảm giá",
        "Giá dự thầu sau hiệu chỉnh sai lệch thừa (nếu có), giảm giá (nếu có)",
    },
    8: {"Điểm kỹ thuật"},
    9: {"Giá đánh giá"},
    10: {"Giá trúng thầu (VND)"},
    11: {
        "Lý do không đáp ứng",
        "Lý do không đáp ứng hoặc lý do không trúng thầu",
    },
    12: {"Thời gian thực hiện gói thầu (ngày)"},
    13: {"Thời gian thực hiện hợp đồng (ngày)"},
    14: {
        "Các nội dung khác (nếu có)",
        "Nội dung khác (nếu có)",
    },
}

_MEDICINE_HEADER_ALIASES = {
    1: {"Mã phần/lô", "Mã lô", "Mã phần"},
    2: {"Tên hoạt chất/Tên thành phần thuốc", "Tên hoạt chất", "Tên thành phần thuốc"},
    3: {"Mã định danh nhà thầu", "Mã nhà thầu"},
    4: {"Mã số thuế nhà thầu"},
    5: {"Tên nhà thầu (Nhập chính xác)"},
    6: {"Giá dự thầu (VND)"},
    8: {
        "Giá sau sửa lỗi, hiệu chỉnh sai lệch hoặc giảm giá",
        "Giá dự thầu sau hiệu chỉnh sai lệch thừa (nếu có), giảm giá (nếu có)",
    },
    9: {"Điểm kỹ thuật"},
    10: {"Giá đánh giá"},
    12: {"Đơn giá trúng thầu"},
    14: {"Giá trúng thầu (VND)"},
    15: {"Lý do không đáp ứng hoặc lý do không trúng thầu"},
    16: {"Thời gian thực hiện gói thầu (ngày)"},
    17: {"Thời gian thực hiện hợp đồng (ngày)"},
    18: {"Nội dung khác (nếu có)"},
}


@dataclass(frozen=True)
class WorkbookTemplateDefinition:
    template_type: str
    headers: tuple[str, ...]
    aliases: dict[int, set[str]]
    source_indices: tuple[int, ...]
    output_indices: tuple[int, ...]
    output_roles: tuple[str, ...]
    lot_index: int
    bidder_identifier_index: int
    tax_code_index: int
    bidder_name_index: int


STANDARD_TEMPLATE = WorkbookTemplateDefinition(
    template_type="standard",
    headers=EXPECTED_HEADERS,
    aliases=_STANDARD_HEADER_ALIASES,
    source_indices=(0, 1, 2, 3, 4, 5),
    output_indices=(6, 7, 8, 9, 10, 11, 12, 13, 14),
    output_roles=(
        "status", "corrected_price", "technical_score", "evaluated_price",
        "award_price", "rejection_reason", "package_duration",
        "contract_duration", "other_content",
    ),
    lot_index=0,
    bidder_identifier_index=2,
    tax_code_index=3,
    bidder_name_index=4,
)

MEDICINE_TEMPLATE = WorkbookTemplateDefinition(
    template_type="medicine",
    headers=MEDICINE_EXPECTED_HEADERS,
    aliases=_MEDICINE_HEADER_ALIASES,
    # Tỷ lệ giảm giá is system-extracted input even though it sits inside H–S.
    source_indices=(0, 1, 2, 3, 4, 5, 6, 13),
    output_indices=(7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18),
    output_roles=(
        "status", "corrected_price", "technical_score", "evaluated_price",
        "award_quantity", "award_unit_price", "award_price",
        "rejection_reason", "package_duration", "contract_duration",
        "other_content",
    ),
    lot_index=1,
    bidder_identifier_index=3,
    tax_code_index=4,
    bidder_name_index=5,
)

TEMPLATE_DEFINITIONS = (STANDARD_TEMPLATE, MEDICINE_TEMPLATE)


class AwardResultExcelError(ValueError):
    """A safe error with an API-level status and stable code."""

    def __init__(self, code: str, message: str, *, status_code: int = 400):
        super().__init__(message)
        self.code = code
        self.status_code = status_code


@dataclass(frozen=True)
class AwardRecord:
    opening_id: str
    lot_code: str
    bidder_identifier: str
    tax_code: str
    bidder_name: str
    status: str | None
    corrected_price: Any = None
    technical_score: Any = None
    evaluated_price: Any = None
    award_quantity: Any = None
    award_unit_price: Any = None
    award_price: Any = None
    rejection_reason: str | None = None
    package_duration: str | None = None
    contract_duration: str | None = None
    other_content: str | None = None
    lot_cancelled: bool = False

    def output_values(self, output_roles: Iterable[str]) -> list[Any]:
        return [getattr(self, role) for role in output_roles]


@dataclass
class RowMatch:
    excel_row: int
    lot_code: str
    bidder_identifier: str
    tax_code: str
    bidder_name: str
    source_fingerprint: str
    status: str
    match_method: str | None = None
    warnings: list[dict[str, Any]] = field(default_factory=list)
    errors: list[dict[str, Any]] = field(default_factory=list)
    record: AwardRecord | None = field(default=None, repr=False)

    def public_dict(self) -> dict[str, Any]:
        value = asdict(self)
        value.pop("record", None)
        value.pop("source_fingerprint", None)
        return {
            "excelRow": value.pop("excel_row"),
            "lotCode": value.pop("lot_code"),
            "bidderIdentifier": value.pop("bidder_identifier"),
            "taxCode": value.pop("tax_code"),
            "bidderName": value.pop("bidder_name"),
            "matchMethod": value.pop("match_method"),
            **value,
        }


def _normalised_text(value: Any) -> str:
    return " ".join(
        unicodedata.normalize("NFKC", str(value or "")).strip().split()
    ).casefold()


def normalize_code(value: Any) -> str:
    """Normalise Excel identifiers without discarding string leading zeroes."""

    if value is None or isinstance(value, bool):
        return ""
    if isinstance(value, Decimal):
        value = int(value) if value == value.to_integral_value() else format(value, "f")
    elif isinstance(value, float) and value.is_integer():
        value = int(value)
    text = unicodedata.normalize("NFKC", str(value)).strip()
    if re.fullmatch(r"[+-]?\d+\.0+", text):
        text = text[: text.index(".")]
    return text.casefold()


def normalize_tax_code(value: Any) -> str:
    return normalize_code(value)


def _json_value(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else format(value, "f")
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _row_fingerprint(cells: Iterable[Any]) -> str:
    payload = [
        {"value": _json_value(cell.value), "dataType": str(cell.data_type or "")}
        for cell in cells
    ]
    encoded = json.dumps(
        payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _issue(code: str, message: str, *, excel_row: int | None = None, **extra):
    value: dict[str, Any] = {"code": code, "message": message}
    if excel_row is not None:
        value["excelRow"] = int(excel_row)
    value.update(extra)
    return value


def _header_matches(
    definition: WorkbookTemplateDefinition, index: int, value: Any
) -> bool:
    accepted = {definition.headers[index], *definition.aliases.get(index, set())}
    return _normalised_text(value) in {_normalised_text(item) for item in accepted}


def _candidate_headers(workbook):
    candidates = []
    for sheet_index, worksheet in enumerate(workbook.worksheets):
        for row_index in range(1, min(20, worksheet.max_row) + 1):
            for definition in TEMPLATE_DEFINITIONS:
                columns_by_header: dict[int, list[int]] = {}
                for actual_column in range(1, min(256, worksheet.max_column) + 1):
                    value = worksheet.cell(row_index, actual_column).value
                    for header_index in range(len(definition.headers)):
                        if _header_matches(definition, header_index, value):
                            columns_by_header.setdefault(header_index, []).append(actual_column)
                matches = [
                    index in columns_by_header
                    for index in range(len(definition.headers))
                ]
                source_matches = sum(
                    matches[index] for index in definition.source_indices
                )
                if source_matches >= len(definition.source_indices) - 1:
                    candidates.append(
                        (
                            sum(matches), source_matches, len(definition.headers),
                            -sheet_index, definition, worksheet, row_index,
                            columns_by_header,
                        )
                    )
    return sorted(candidates, key=lambda item: item[:4], reverse=True)


def inspect_award_result_workbook(content: bytes) -> dict[str, Any]:
    """Read only the template contract and matching fields from an XLSX."""

    try:
        workbook = load_workbook(
            BytesIO(content), data_only=False, keep_links=False, rich_text=True
        )
    except Exception as exc:  # openpyxl error classes vary across malformed inputs
        raise AwardResultExcelError(
            "WORKBOOK_INVALID", "Tệp không phải workbook Excel hợp lệ."
        ) from exc

    if sum(sheet.max_row * sheet.max_column for sheet in workbook.worksheets) > MAX_WORKBOOK_CELLS:
        raise AwardResultExcelError(
            "WORKBOOK_CELL_LIMIT_EXCEEDED",
            "Workbook có phạm vi ô sử dụng vượt quá giới hạn an toàn.",
        )

    blocking_errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    candidates = _candidate_headers(workbook)
    if not candidates:
        return {
            "sheetName": None,
            "headerRow": None,
            "totalRows": 0,
            "rows": [],
            "blockingErrors": [
                _issue(
                    "WORKSHEET_NOT_FOUND",
                    "Không tìm thấy sheet có cấu trúc danh sách nhà thầu của muasamcong.",
                )
            ],
            "warnings": [],
        }

    best = candidates[0]
    tied = [item for item in candidates if item[:3] == best[:3]]
    if len(tied) > 1:
        blocking_errors.append(
            _issue(
                "WORKSHEET_AMBIGUOUS",
                "Có nhiều vị trí tiêu đề phù hợp; không thể xác định sheet cần xử lý.",
            )
        )
    _, _, _, _, definition, worksheet, header_row, columns_by_header = best
    for index in range(len(definition.headers)):
        columns = columns_by_header.get(index, [])
        if not columns:
            blocking_errors.append(
                _issue(
                    "REQUIRED_HEADER_MISSING",
                    f"Thiếu tiêu đề bắt buộc: {definition.headers[index]}.",
                    excel_row=header_row,
                    expectedHeader=definition.headers[index],
                )
            )
        elif len(columns) > 1:
            blocking_errors.append(
                _issue(
                    "REQUIRED_HEADER_DUPLICATED",
                    f"Tiêu đề xuất hiện nhiều lần: {definition.headers[index]}.",
                    excel_row=header_row,
                    expectedHeader=definition.headers[index],
                    columns=columns,
                )
            )
    if worksheet.sheet_state != "visible":
        warnings.append(
            _issue(
                "TARGET_SHEET_HIDDEN",
                "Sheet chứa danh sách nhà thầu đang bị ẩn.",
            )
        )

    rows = []
    existing_result_rows = 0
    source_columns = [
        columns_by_header[index][0]
        for index in definition.source_indices
        if len(columns_by_header.get(index, [])) == 1
    ]
    output_columns = [
        columns_by_header[index][0]
        for index in definition.output_indices
        if len(columns_by_header.get(index, [])) == 1
    ]
    for row_index in range(header_row + 1, worksheet.max_row + 1):
        if len(source_columns) != len(definition.source_indices):
            break
        cells_by_header = {
            index: worksheet.cell(row_index, columns_by_header[index][0])
            for index in definition.source_indices
        }
        source_cells = [cells_by_header[index] for index in definition.source_indices]
        if all(cell.value in (None, "") for cell in source_cells):
            continue
        if len(rows) >= MAX_AWARD_RESULT_ROWS:
            raise AwardResultExcelError(
                "WORKBOOK_ROW_LIMIT_EXCEEDED",
                f"Workbook vượt quá giới hạn {MAX_AWARD_RESULT_ROWS} dòng dữ liệu.",
            )
        output_cells = [worksheet.cell(row_index, column) for column in output_columns]
        has_existing_result = any(cell.value not in (None, "") for cell in output_cells)
        existing_result_rows += int(has_existing_result)
        rows.append(
            {
                "excelRow": row_index,
                "lotCode": _json_value(cells_by_header[definition.lot_index].value),
                "bidderIdentifier": _json_value(
                    cells_by_header[definition.bidder_identifier_index].value
                ),
                "taxCode": _json_value(
                    cells_by_header[definition.tax_code_index].value
                ),
                "bidderName": _json_value(
                    cells_by_header[definition.bidder_name_index].value
                ),
                "sourceFingerprint": _row_fingerprint(source_cells),
                "hasExistingResult": has_existing_result,
            }
        )

    for merged_range in worksheet.merged_cells.ranges:
        if (
            merged_range.max_row > header_row
            and merged_range.min_row <= worksheet.max_row
            and any(
                merged_range.min_col <= column <= merged_range.max_col
                for column in output_columns
            )
        ):
            blocking_errors.append(
                _issue(
                    "MERGED_WRITE_RANGE",
                    f"Vùng dữ liệu được phép ghi giao với ô gộp {merged_range}.",
                )
            )

    return {
        "sheetName": worksheet.title,
        "templateType": definition.template_type,
        "headerRow": header_row,
        "columnMap": {
            "source": source_columns,
            "output": output_columns,
            "headers": {
                definition.headers[index]: columns[0]
                for index, columns in columns_by_header.items()
                if len(columns) == 1
            },
            "outputRoles": list(definition.output_roles),
        },
        "dataStartRow": header_row + 1,
        "maxRow": worksheet.max_row,
        "totalRows": len(rows),
        "existingResultRows": existing_result_rows,
        "rows": rows,
        "blockingErrors": blocking_errors,
        "warnings": warnings,
    }


def _award_record(value: AwardRecord | dict[str, Any]) -> AwardRecord:
    return value if isinstance(value, AwardRecord) else AwardRecord(**value)


def _append_index(index, key, record):
    if key[1]:
        index.setdefault(key, []).append(record)


def match_award_result_rows(
    inspection: dict[str, Any],
    records: Iterable[AwardRecord | dict[str, Any]],
    *,
    known_lot_codes: Iterable[Any] = (),
    foreign_lot_codes: Iterable[Any] = (),
) -> dict[str, Any]:
    """Match sanitized workbook rows without using bidder names as keys."""

    award_records = [_award_record(item) for item in records]
    primary_index: dict[tuple[str, str], list[AwardRecord]] = {}
    fallback_index: dict[tuple[str, str], list[AwardRecord]] = {}
    for record in award_records:
        lot_key = normalize_code(record.lot_code)
        _append_index(
            primary_index,
            (lot_key, normalize_code(record.bidder_identifier)),
            record,
        )
        _append_index(
            fallback_index,
            (lot_key, normalize_tax_code(record.tax_code)),
            record,
        )

    known_lots = {normalize_code(item) for item in known_lot_codes}
    known_lots.update(normalize_code(item.lot_code) for item in award_records)
    foreign_lots = {normalize_code(item) for item in foreign_lot_codes}
    blocking_errors = list(inspection.get("blockingErrors") or [])
    warnings = list(inspection.get("warnings") or [])
    matched_rows: list[RowMatch] = []
    exact_matches = fallback_matches = unmatched_rows = 0
    duplicate_rows = conflict_rows = 0
    missing_lot_rows = missing_identity_rows = 0

    for source in inspection.get("rows") or []:
        excel_row = int(source["excelRow"])
        lot_key = normalize_code(source.get("lotCode"))
        identifier_key = normalize_code(source.get("bidderIdentifier"))
        tax_key = normalize_tax_code(source.get("taxCode"))
        row = RowMatch(
            excel_row=excel_row,
            lot_code=str(source.get("lotCode") or ""),
            bidder_identifier=str(source.get("bidderIdentifier") or ""),
            tax_code=str(source.get("taxCode") or ""),
            bidder_name=str(source.get("bidderName") or ""),
            source_fingerprint=str(source.get("sourceFingerprint") or ""),
            status="unmatched",
        )
        if not lot_key:
            missing_lot_rows += 1
            row.warnings.append(
                _issue("LOT_CODE_MISSING", "Dòng thiếu mã phần/lô.", excel_row=excel_row)
            )
        elif lot_key not in known_lots and lot_key in foreign_lots:
            issue = _issue(
                "LOT_BELONGS_TO_OTHER_PACKAGE",
                "Mã phần/lô thuộc gói thầu khác trong cùng tổ chức.",
                excel_row=excel_row,
            )
            row.errors.append(issue)
            blocking_errors.append(issue)

        if not identifier_key and not tax_key:
            missing_identity_rows += 1
            row.warnings.append(
                _issue(
                    "BIDDER_IDENTITY_MISSING",
                    "Dòng thiếu cả mã định danh và mã số thuế nhà thầu.",
                    excel_row=excel_row,
                )
            )

        primary = primary_index.get((lot_key, identifier_key), []) if identifier_key else []
        fallback = fallback_index.get((lot_key, tax_key), []) if tax_key else []
        if len(primary) > 1 or len(fallback) > 1:
            duplicate_rows += 1
            issue = _issue(
                "DUPLICATE_MATCH_KEY",
                "Khóa đối chiếu cho ra nhiều kết quả trong dữ liệu ứng dụng.",
                excel_row=excel_row,
            )
            row.errors.append(issue)
            blocking_errors.append(issue)
        elif primary and fallback and primary[0].opening_id != fallback[0].opening_id:
            conflict_rows += 1
            issue = _issue(
                "IDENTIFIER_TAX_CONFLICT",
                "Mã định danh và mã số thuế khớp với hai nhà thầu khác nhau.",
                excel_row=excel_row,
            )
            row.errors.append(issue)
            blocking_errors.append(issue)
        else:
            record = primary[0] if primary else (fallback[0] if fallback else None)
            if record is None:
                unmatched_rows += 1
                row.warnings.append(
                    _issue(
                        "RESULT_NOT_FOUND",
                        "Không tìm thấy kết quả phù hợp cho dòng Excel.",
                        excel_row=excel_row,
                    )
                )
            else:
                row.record = record
                row.status = "matched"
                if primary:
                    row.match_method = "lot_code_and_bidder_identifier"
                    exact_matches += 1
                else:
                    row.match_method = "lot_code_and_tax_code"
                    fallback_matches += 1
                if (
                    _normalised_text(source.get("bidderName"))
                    and _normalised_text(record.bidder_name)
                    and _normalised_text(source.get("bidderName"))
                    != _normalised_text(record.bidder_name)
                ):
                    row.warnings.append(
                        _issue(
                            "BIDDER_NAME_DIFFERS",
                            "Tên nhà thầu trong Excel khác dữ liệu ứng dụng nhưng mã vẫn khớp.",
                            excel_row=excel_row,
                        )
                    )
                if record.status is None:
                    row.warnings.append(
                        _issue(
                            "RESULT_NOT_APPROVED",
                            "Nhà thầu khớp nhưng chưa có kết quả được phê duyệt để điền.",
                            excel_row=excel_row,
                        )
                    )
                missing_fields = []
                if record.status == "Trúng thầu" and record.award_price is None:
                    missing_fields.append("Giá trúng thầu")
                if record.status == "Không trúng thầu" and not record.rejection_reason:
                    missing_fields.append("Lý do không đáp ứng")
                if missing_fields:
                    row.warnings.append(
                        _issue(
                            "RESULT_FIELDS_MISSING",
                            "Một số trường kết quả chưa có dữ liệu.",
                            excel_row=excel_row,
                            fields=missing_fields,
                        )
                    )
        if source.get("hasExistingResult"):
            row.warnings.append(
                _issue(
                    "EXISTING_RESULT_WILL_BE_OVERWRITTEN",
                    "Dòng đã có dữ liệu ở các trường kết quả; các ô tương ứng của dòng khớp sẽ được ghi đè.",
                    excel_row=excel_row,
                )
            )
        warnings.extend(row.warnings)
        matched_rows.append(row)

    return {
        "sheetName": inspection.get("sheetName"),
        "templateType": inspection.get("templateType"),
        "headerRow": inspection.get("headerRow"),
        "totalRows": int(inspection.get("totalRows") or 0),
        "exactMatches": exact_matches,
        "fallbackMatches": fallback_matches,
        "unmatchedRows": unmatched_rows,
        "duplicateRows": duplicate_rows,
        "conflictRows": conflict_rows,
        "missingLotRows": missing_lot_rows,
        "missingBidderIdentityRows": missing_identity_rows,
        "existingResultRows": int(inspection.get("existingResultRows") or 0),
        "blockingErrors": blocking_errors,
        "warnings": warnings,
        "canExport": not blocking_errors,
        "rows": [row.public_dict() for row in matched_rows],
        "_rowMatches": matched_rows,
    }


def export_updates_from_match(match_result: dict[str, Any]) -> list[dict[str, Any]]:
    template_type = str(match_result.get("templateType") or "standard")
    definition = next(
        (item for item in TEMPLATE_DEFINITIONS if item.template_type == template_type),
        STANDARD_TEMPLATE,
    )
    updates = []
    for row in match_result.get("_rowMatches") or []:
        if row.errors or row.record is None or row.record.status is None:
            continue
        updates.append(
            {
                "excelRow": row.excel_row,
                "sourceFingerprint": row.source_fingerprint,
                "values": row.record.output_values(definition.output_roles),
            }
        )
    return updates


def public_validation_result(match_result: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in match_result.items() if not key.startswith("_")}


def _color_payload(color):
    if color is None:
        return None
    return {
        "type": color.type,
        "rgb": color.rgb if color.type == "rgb" else None,
        "indexed": color.indexed if color.type == "indexed" else None,
        "theme": color.theme if color.type == "theme" else None,
        "tint": color.tint,
    }


def _side_payload(side):
    return {"style": side.style, "color": _color_payload(side.color)}


def _cell_style_payload(cell):
    font = cell.font
    fill = cell.fill
    alignment = cell.alignment
    protection = cell.protection
    border = cell.border
    return {
        "numberFormat": cell.number_format,
        "font": {
            "name": font.name,
            "size": font.sz,
            "bold": font.bold,
            "italic": font.italic,
            "underline": font.underline,
            "strike": font.strike,
            "color": _color_payload(font.color),
        },
        "fill": {
            "type": fill.fill_type,
            "fg": _color_payload(fill.fgColor),
            "bg": _color_payload(fill.bgColor),
        },
        "border": {
            "left": _side_payload(border.left),
            "right": _side_payload(border.right),
            "top": _side_payload(border.top),
            "bottom": _side_payload(border.bottom),
        },
        "alignment": {
            "horizontal": alignment.horizontal,
            "vertical": alignment.vertical,
            "wrap": alignment.wrap_text,
            "rotation": alignment.text_rotation,
            "shrink": alignment.shrink_to_fit,
            "indent": alignment.indent,
        },
        "protection": {"locked": protection.locked, "hidden": protection.hidden},
    }


def _dimension_payload(dimensions):
    return {
        str(key): {
            "width": getattr(value, "width", None),
            "height": getattr(value, "height", None),
            "hidden": value.hidden,
            "outline": value.outlineLevel,
            "collapsed": value.collapsed,
            "style": value.style,
        }
        for key, value in dimensions.items()
    }


def _validation_payload(worksheet):
    if not worksheet.data_validations:
        return []
    return [
        {
            "sqref": str(item.sqref),
            "type": item.type,
            "operator": item.operator,
            "formula1": item.formula1,
            "formula2": item.formula2,
            "allowBlank": item.allow_blank,
            "error": item.error,
            "prompt": item.prompt,
        }
        for item in worksheet.data_validations.dataValidation
    ]


def _preservation_digest(
    workbook,
    target_sheet: str,
    allowed_rows: set[int],
    allowed_columns: set[int],
) -> str:
    digest = hashlib.sha256()

    def update(value):
        digest.update(
            json.dumps(
                value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                default=str,
            ).encode("utf-8")
        )
        digest.update(b"\n")

    properties = workbook.properties
    update(
        {
            "sheets": workbook.sheetnames,
            "definedNames": [
                {
                    "name": item.name,
                    "text": item.attr_text,
                    "localSheetId": item.localSheetId,
                    "hidden": item.hidden,
                }
                for item in workbook.defined_names.values()
            ],
            "properties": {
                name: _json_value(getattr(properties, name, None))
                for name in (
                    "title", "subject", "creator", "keywords", "description",
                    "lastModifiedBy", "category", "contentStatus", "identifier",
                    "language", "version", "created", "modified",
                )
            },
            "calculation": {
                "calcMode": workbook.calculation.calcMode,
                "fullCalcOnLoad": workbook.calculation.fullCalcOnLoad,
                "forceFullCalc": workbook.calculation.forceFullCalc,
            },
        }
    )
    for worksheet in workbook.worksheets:
        update(
            {
                "sheet": worksheet.title,
                "state": worksheet.sheet_state,
                "maxRow": worksheet.max_row,
                "maxColumn": worksheet.max_column,
                "merged": sorted(str(item) for item in worksheet.merged_cells.ranges),
                "freeze": str(worksheet.freeze_panes or ""),
                "gridlines": worksheet.sheet_view.showGridLines,
                "autoFilter": str(worksheet.auto_filter.ref or ""),
                "printArea": str(worksheet.print_area or ""),
                "printTitleRows": worksheet.print_title_rows,
                "printTitleCols": worksheet.print_title_cols,
                "columns": _dimension_payload(worksheet.column_dimensions),
                "rows": _dimension_payload(worksheet.row_dimensions),
                "validations": _validation_payload(worksheet),
                "pageSetup": {
                    "orientation": worksheet.page_setup.orientation,
                    "paperSize": worksheet.page_setup.paperSize,
                    "fitToWidth": worksheet.page_setup.fitToWidth,
                    "fitToHeight": worksheet.page_setup.fitToHeight,
                    "scale": worksheet.page_setup.scale,
                },
                "margins": {
                    name: getattr(worksheet.page_margins, name)
                    for name in ("left", "right", "top", "bottom", "header", "footer")
                },
                "tables": sorted(worksheet.tables.keys()),
                "charts": len(worksheet._charts),
                "images": len(worksheet._images),
            }
        )
        for row in worksheet.iter_rows():
            for cell in row:
                allowed_value = (
                    worksheet.title == target_sheet
                    and cell.row in allowed_rows
                    and cell.column in allowed_columns
                )
                original_value = _json_value(cell.value)
                semantically_blank = original_value in (None, "")
                update(
                    {
                        "sheet": worksheet.title,
                        "cell": cell.coordinate,
                        "value": None if allowed_value or semantically_blank else original_value,
                        "dataType": None if allowed_value or semantically_blank else cell.data_type,
                        "style": _cell_style_payload(cell),
                        "comment": (
                            {"text": cell.comment.text, "author": cell.comment.author}
                            if cell.comment else None
                        ),
                        "hyperlink": (
                            {
                                "target": cell.hyperlink.target,
                                "location": cell.hyperlink.location,
                            }
                            if cell.hyperlink else None
                        ),
                    }
                )
    return digest.hexdigest()


def _restore_document_properties(original: bytes, generated: bytes) -> bytes:
    """Keep OOXML document properties byte-for-byte from the uploaded workbook."""

    preserved_parts = {"docProps/core.xml", "docProps/app.xml"}
    with zipfile.ZipFile(BytesIO(original)) as source, zipfile.ZipFile(
        BytesIO(generated)
    ) as produced:
        available = preserved_parts.intersection(source.namelist())
        if not available:
            return generated
        output = BytesIO()
        with zipfile.ZipFile(output, "w") as destination:
            for info in produced.infolist():
                data = source.read(info.filename) if info.filename in available else produced.read(info.filename)
                destination.writestr(info, data)
        return output.getvalue()


def _materialize_excel_value(value: Any) -> Any:
    if isinstance(value, dict) and set(value) == {"decimal"}:
        text = str(value["decimal"])
        if not re.fullmatch(r"-?\d+(?:\.\d+)?", text):
            raise AwardResultExcelError(
                "DECIMAL_VALUE_INVALID", "Giá trị số thập phân không hợp lệ."
            )
        return Decimal(text)
    return value


def write_award_result_workbook(content: bytes, updates: list[dict[str, Any]]) -> bytes:
    """Write only header-detected result cells and prove all other state is stable."""

    inspection = inspect_award_result_workbook(content)
    if inspection.get("blockingErrors"):
        raise AwardResultExcelError(
            "WORKBOOK_STRUCTURE_INVALID",
            "Workbook có lỗi cấu trúc nên không thể xuất.",
        )
    sheet_name = str(inspection["sheetName"])
    output_columns = [int(value) for value in inspection["columnMap"]["output"]]
    output_roles = list(inspection["columnMap"].get("outputRoles") or [])
    if not output_roles or len(output_columns) != len(output_roles):
        raise AwardResultExcelError(
            "WORKBOOK_STRUCTURE_INVALID",
            "Không xác định đủ các cột kết quả để xuất.",
        )
    rows_by_number = {int(item["excelRow"]): item for item in inspection["rows"]}
    updates_by_row = {int(item["excelRow"]): item for item in updates}
    if len(updates_by_row) != len(updates):
        raise AwardResultExcelError(
            "DUPLICATE_UPDATE_ROW", "Danh sách cập nhật chứa dòng trùng nhau."
        )
    for row_number, update in updates_by_row.items():
        source = rows_by_number.get(row_number)
        if not source or not hmac.compare_digest(
            str(source.get("sourceFingerprint") or ""),
            str(update.get("sourceFingerprint") or ""),
        ):
            raise AwardResultExcelError(
                "WORKBOOK_CHANGED_AFTER_VALIDATION",
                "File đã thay đổi sau bước kiểm tra; vui lòng tải lên và kiểm tra lại.",
                status_code=409,
            )
        values = update.get("values")
        if not isinstance(values, list) or len(values) != len(output_columns):
            raise AwardResultExcelError(
                "UPDATE_VALUES_INVALID", "Dữ liệu cập nhật workbook không hợp lệ."
            )

    workbook = load_workbook(
        BytesIO(content), data_only=False, keep_links=False, rich_text=True
    )
    allowed_rows = set(updates_by_row)
    allowed_columns = set(output_columns)
    before_digest = _preservation_digest(
        workbook, sheet_name, allowed_rows, allowed_columns
    )
    worksheet = workbook[sheet_name]
    for row_number, update in updates_by_row.items():
        for column, value in zip(output_columns, update["values"], strict=True):
            worksheet.cell(row_number, column).value = _materialize_excel_value(value)

    output = BytesIO()
    workbook.save(output)
    result = _restore_document_properties(content, output.getvalue())
    reopened = load_workbook(
        BytesIO(result), data_only=False, keep_links=False, rich_text=True
    )
    after_digest = _preservation_digest(
        reopened, sheet_name, allowed_rows, allowed_columns
    )
    if not hmac.compare_digest(before_digest, after_digest):
        raise AwardResultExcelError(
            "WORKBOOK_PRESERVATION_FAILED",
            "Không thể chứng minh workbook được bảo toàn ngoài các trường kết quả.",
        )
    return result


def _row_mapping(row, columns: tuple[str, ...]):
    if row is None:
        return None
    if hasattr(row, "keys"):
        row_keys = set(row.keys())
        if all(name in row_keys for name in columns):
            return {name: row[name] for name in columns}
    return dict(zip(columns, row, strict=False))


def _number(value):
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, Decimal):
        return _exact_number(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return value
    return _exact_number(value)


def _exact_number(value):
    if value is None or value == "":
        return None
    decimal_value = Decimal(str(value))
    if not decimal_value.is_finite():
        raise AwardResultExcelError(
            "NUMBER_INVALID", "Dữ liệu số trong kết quả không hợp lệ."
        )
    if decimal_value == decimal_value.to_integral_value():
        return int(decimal_value)
    return {"decimal": format(decimal_value, "f")}


def _decimal_from_exact(value):
    if value is None:
        return None
    if isinstance(value, dict) and set(value) == {"decimal"}:
        return Decimal(str(value["decimal"]))
    return Decimal(str(value))


def load_award_result_dataset(package_id: str, organization_id: str, *, database_obj=None):
    """Load package, lots, bidders and bidder goods in bounded queries (never N+1)."""

    if database_obj is None:
        from backend.shared.helpers import database as database_obj

    connection = database_obj.get_connection()
    try:
        cursor = connection.cursor()
        package_columns = (
            "id", "ma_goi_thau", "ten_goi_thau", "phan_lo", "trang_thai",
            "nha_thau_trung_thau_id", "gia_trung_thau", "thoi_gian_goi_thau",
            "thoi_gian_hop_dong", "phuong_phap_danh_gia", "is_thuoc",
        )
        package = _row_mapping(
            cursor.execute(
                """SELECT id, ma_goi_thau, ten_goi_thau, phan_lo, trang_thai,
                          nha_thau_trung_thau_id, gia_trung_thau,
                          thoi_gian_goi_thau, thoi_gian_hop_dong,
                          phuong_phap_danh_gia, is_thuoc
                   FROM goi_thau
                   WHERE id = ? AND organization_id = ?""",
                (package_id, organization_id),
            ).fetchone(),
            package_columns,
        )
        if not package:
            raise AwardResultExcelError(
                "PACKAGE_NOT_FOUND", "Không tìm thấy gói thầu.", status_code=404
            )

        lot_columns = (
            "id", "ma_phan_lo", "ten_phan_lo", "nha_thau_trung_thau_id",
            "gia_trung_thau", "thoi_gian_goi_thau", "thoi_gian_hop_dong",
            "outcome", "sequence_no",
        )
        lot_rows = cursor.execute(
            """SELECT lot.id, lot.ma_phan_lo, lot.ten_phan_lo,
                      lot.nha_thau_trung_thau_id, lot.gia_trung_thau,
                      lot.thoi_gian_goi_thau, lot.thoi_gian_hop_dong,
                      detail.outcome, batch.sequence_no
               FROM goi_thau_phan_lo AS lot
               LEFT JOIN dot_xu_ly_phan_lo_chi_tiet AS detail
                 ON detail.organization_id = lot.organization_id
                AND detail.lot_id = lot.id
                AND detail.current_stage = 'RESULT_APPROVED'
               LEFT JOIN dot_xu_ly_phan_lo AS batch
                 ON batch.organization_id = detail.organization_id
                AND batch.id = detail.batch_id
               WHERE lot.goi_thau_id = ? AND lot.organization_id = ?
                 AND lot.archived_at IS NULL
               ORDER BY lot.sort_order, lot.id, batch.sequence_no DESC""",
            (package_id, organization_id),
        ).fetchall()
        lots = {}
        for raw_row in lot_rows:
            row = _row_mapping(raw_row, lot_columns)
            lots.setdefault(str(row["id"]), row)
        lots_by_code = {
            normalize_code(row["ma_phan_lo"]): row
            for row in lots.values()
            if normalize_code(row["ma_phan_lo"])
        }

        opening_columns = (
            "opening_id", "ma_phan_lo", "ma_dinh_danh", "nha_thau_id",
            "ten_nha_thau", "ma_nha_thau", "ma_so_thue", "gia_du_thau",
            "gia_sau_giam_gia", "gia_danh_gia_sau_uu_dai",
            "thoi_gian_thuc_hien", "diem", "ly_do_loai", "danh_gia_ket_luan",
        )
        opening_rows = cursor.execute(
            """SELECT opening.id, opening.ma_phan_lo, opening.ma_dinh_danh,
                      opening.nha_thau_id,
                      COALESCE(NULLIF(opening.ten_nha_thau, ''), bidder.ten_nha_thau),
                      bidder.ma_nha_thau, bidder.ma_so_thue,
                      opening.gia_du_thau, opening.gia_sau_giam_gia,
                      opening.gia_danh_gia_sau_uu_dai,
                      opening.thoi_gian_thuc_hien, result.diem,
                      result.ly_do_loai, result.danh_gia_ket_luan
               FROM thong_tin_mo_thau AS opening
               JOIN nha_thau AS bidder
                 ON bidder.organization_id = opening.organization_id
                AND bidder.id = opening.nha_thau_id
               LEFT JOIN ket_qua_danh_gia_nha_thau AS result
                 ON result.organization_id = opening.organization_id
                AND result.thong_tin_mo_thau_id = opening.id
               WHERE opening.goi_thau_id = ? AND opening.organization_id = ?
                 AND opening.archived_at IS NULL
               ORDER BY opening.ma_phan_lo, opening.id""",
            (package_id, organization_id),
        ).fetchall()
        goods_columns = (
            "thong_tin_mo_thau_id", "khoi_luong", "don_gia_du_thau",
            "gia_tri_co_so_sau_giam_gia", "goi_thau_hang_hoa_id", "sort_order",
        )
        goods_rows = cursor.execute(
            """SELECT thong_tin_mo_thau_id, khoi_luong, don_gia_du_thau,
                      gia_tri_co_so_sau_giam_gia, goi_thau_hang_hoa_id, sort_order
               FROM hang_hoa_du_thau_nha_thau
               WHERE goi_thau_id = ? AND organization_id = ? AND is_draft = 0
               ORDER BY thong_tin_mo_thau_id, sort_order, id""",
            (package_id, organization_id),
        ).fetchall()
    finally:
        connection.close()

    goods_by_opening: dict[str, list[dict[str, Any]]] = {}
    for raw_row in goods_rows:
        goods = _row_mapping(raw_row, goods_columns)
        goods_by_opening.setdefault(str(goods["thong_tin_mo_thau_id"]), []).append(goods)

    records = []
    dataset_errors: list[dict[str, Any]] = []
    package_is_lotted = str(package["phan_lo"] or "") == "Có"
    package_is_medicine = bool(int(package["is_thuoc"] or 0))
    package_status = str(package["trang_thai"] or "")
    for raw_row in opening_rows:
        opening = _row_mapping(raw_row, opening_columns)
        lot = lots_by_code.get(normalize_code(opening["ma_phan_lo"]))
        winner_id = None
        award_price = package_duration = contract_duration = None
        outcome = None
        if package_is_lotted and lot:
            winner_id = lot["nha_thau_trung_thau_id"]
            award_price = lot["gia_trung_thau"]
            package_duration = lot["thoi_gian_goi_thau"]
            contract_duration = lot["thoi_gian_hop_dong"]
            outcome = str(lot["outcome"] or "") or None
        elif not package_is_lotted:
            winner_id = package["nha_thau_trung_thau_id"]
            award_price = package["gia_trung_thau"]
            package_duration = package["thoi_gian_goi_thau"]
            contract_duration = package["thoi_gian_hop_dong"]

        approved = False
        lot_cancelled = False
        if package_is_lotted:
            approved = bool(lot and (outcome or winner_id))
            lot_cancelled = outcome in {
                "CANCELLED_LOT", "REPROCUREMENT_REQUIRED", "NO_BID",
                "NO_TECHNICAL_QUALIFIER", "NO_FINANCIAL_QUALIFIER",
                "NO_RESPONSIVE_BID", "OTHER_APPROVED_OUTCOME",
            }
        else:
            approved = package_status in {"AWARDED", "CANCELLED"}
            lot_cancelled = package_status == "CANCELLED"

        status = None
        is_winner = False
        if approved:
            is_winner = bool(
                not lot_cancelled
                and winner_id
                and str(winner_id) == str(opening["nha_thau_id"])
            )
            status = "Trúng thầu" if is_winner else "Không trúng thầu"
        corrected_price = (
            opening["gia_sau_giam_gia"]
            if opening["gia_sau_giam_gia"] is not None
            else opening["gia_du_thau"]
        )
        award_quantity = award_unit_price = None
        if is_winner and package_is_medicine:
            goods_for_opening = goods_by_opening.get(str(opening["opening_id"]), [])
            if len(goods_for_opening) != 1:
                dataset_errors.append(
                    _issue(
                        "MEDICINE_WINNING_GOODS_AMBIGUOUS",
                        "Không xác định duy nhất hàng thuốc trúng thầu để lấy số lượng và đơn giá.",
                        openingId=str(opening["opening_id"]),
                    )
                )
            else:
                goods = goods_for_opening[0]
                award_quantity = _exact_number(goods["khoi_luong"])
                quantity_decimal = _decimal_from_exact(award_quantity)
                if not quantity_decimal or quantity_decimal <= 0:
                    dataset_errors.append(
                        _issue(
                            "MEDICINE_AWARD_QUANTITY_MISSING",
                            "Hàng thuốc trúng thầu chưa có số lượng hợp lệ.",
                            openingId=str(opening["opening_id"]),
                        )
                    )
                else:
                    allocated_total = goods["gia_tri_co_so_sau_giam_gia"]
                    if allocated_total is not None:
                        unit_decimal = Decimal(str(allocated_total)) / quantity_decimal
                        award_unit_price = _exact_number(unit_decimal)
                    else:
                        award_unit_price = _exact_number(goods["don_gia_du_thau"])
                    unit_decimal = _decimal_from_exact(award_unit_price)
                    if unit_decimal is None:
                        dataset_errors.append(
                            _issue(
                                "MEDICINE_AWARD_UNIT_PRICE_MISSING",
                                "Hàng thuốc trúng thầu chưa có đơn giá hợp lệ.",
                                openingId=str(opening["opening_id"]),
                            )
                        )
                    elif award_price is not None:
                        computed_total = quantity_decimal * unit_decimal
                        if computed_total != Decimal(str(award_price)):
                            dataset_errors.append(
                                _issue(
                                    "MEDICINE_AWARD_VALUE_CONFLICT",
                                    "Số lượng nhân đơn giá không khớp giá trúng thầu đã phê duyệt.",
                                    openingId=str(opening["opening_id"]),
                                )
                            )
        records.append(
            AwardRecord(
                opening_id=str(opening["opening_id"]),
                lot_code=str(opening["ma_phan_lo"] or ""),
                bidder_identifier=str(opening["ma_dinh_danh"] or ""),
                tax_code=str(opening["ma_so_thue"] or ""),
                bidder_name=str(opening["ten_nha_thau"] or ""),
                status=status,
                corrected_price=_number(corrected_price),
                technical_score=_number(opening["diem"]),
                evaluated_price=_number(opening["gia_danh_gia_sau_uu_dai"]),
                award_quantity=award_quantity,
                award_unit_price=award_unit_price,
                award_price=_number(award_price) if is_winner else None,
                rejection_reason=(
                    None if is_winner else str(opening["ly_do_loai"] or "").strip() or None
                ),
                package_duration=(str(package_duration or "").strip() or None) if is_winner else None,
                contract_duration=(str(contract_duration or "").strip() or None) if is_winner else None,
                lot_cancelled=lot_cancelled,
            )
        )
    return {
        "package": package,
        "records": records,
        "lotCodes": [row["ma_phan_lo"] for row in lots.values()],
        "blockingErrors": dataset_errors,
    }


def find_foreign_lot_codes(
    lot_codes: Iterable[Any], package_id: str, organization_id: str, *, database_obj=None
) -> set[str]:
    if database_obj is None:
        from backend.shared.helpers import database as database_obj

    codes = sorted({normalize_code(item) for item in lot_codes if normalize_code(item)})
    if not codes:
        return set()
    found = set()
    connection = database_obj.get_connection()
    try:
        cursor = connection.cursor()
        for offset in range(0, len(codes), 500):
            chunk = codes[offset : offset + 500]
            placeholders = ", ".join("?" for _ in chunk)
            query = (
                "SELECT ma_phan_lo FROM goi_thau_phan_lo "  # noqa: S608
                "WHERE organization_id = ? AND goi_thau_id != ? "
                f"AND lower(trim(ma_phan_lo)) IN ({placeholders})"
            )
            rows = cursor.execute(
                query,
                (organization_id, package_id, *chunk),
            ).fetchall()
            found.update(normalize_code(row[0]) for row in rows)
    finally:
        connection.close()
    return found


def _validation_root() -> Path:
    root = (resolve_runtime_path("DOCUMENT_WORKER_TEMP_DIR") / "award-result-validations").resolve()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    return root


def _signing_key(environ=None) -> bytes:
    environment = os.environ if environ is None else environ
    configured = str(
        environment.get("AWARD_RESULT_EXCEL_TOKEN_KEY")
        or environment.get("SYNC_CURSOR_SIGNING_KEY")
        or ""
    )
    production = str(environment.get("APP_ENV", "development")).casefold() in {
        "prod", "production"
    }
    if production and len(configured.encode("utf-8")) < 32:
        raise RuntimeError(
            "AWARD_RESULT_EXCEL_TOKEN_KEY or SYNC_CURSOR_SIGNING_KEY must be at least 32 bytes."
        )
    if not configured:
        configured = "biddingflow-development-award-result-excel-token"
    return hashlib.sha256(("award-result-excel\0" + configured).encode("utf-8")).digest()


def _encode_signature(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _token(validation_id: str) -> str:
    signature = hmac.new(_signing_key(), validation_id.encode("ascii"), hashlib.sha256).digest()
    return f"{validation_id}.{_encode_signature(signature)}"


def _validation_path(validation_id: str) -> Path:
    root = _validation_root()
    path = (root / f"validation-{validation_id}").resolve()
    if path.parent != root:
        raise AwardResultExcelError("VALIDATION_TOKEN_INVALID", "Validation token không hợp lệ.")
    return path


def cleanup_expired_validation_artifacts(*, now: int | None = None, limit: int = 128) -> int:
    current = int(time.time() if now is None else now)
    removed = 0
    root = _validation_root()
    for path in list(root.glob("validation-*"))[: max(1, min(limit, 512))]:
        try:
            if path.is_symlink() or path.resolve().parent != root:
                continue
            metadata_path = path / "metadata.json"
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            if int(metadata.get("expiresAt") or 0) <= current:
                shutil.rmtree(path)
                removed += 1
        except (OSError, ValueError, json.JSONDecodeError):
            continue
    return removed


def create_validation_artifact(
    content: bytes,
    inspection: dict[str, Any],
    *,
    user_id: str,
    organization_id: str,
    package_id: str,
    original_filename: str,
    now: int | None = None,
) -> tuple[str, dict[str, Any]]:
    cleanup_expired_validation_artifacts(now=now)
    created_at = int(time.time() if now is None else now)
    validation_id = uuid.uuid4().hex
    path = _validation_path(validation_id)
    path.mkdir(mode=0o700)
    workbook_path = path / "workbook.xlsx"
    metadata_path = path / "metadata.json"
    digest = hashlib.sha256(content).hexdigest()
    metadata = {
        "version": 1,
        "validationId": validation_id,
        "userId": str(user_id),
        "organizationId": str(organization_id),
        "packageId": str(package_id),
        "originalFilename": os.path.basename(str(original_filename or "workbook.xlsx")),
        "sha256": digest,
        "sizeBytes": len(content),
        "createdAt": created_at,
        "expiresAt": created_at + VALIDATION_TTL_SECONDS,
        "inspection": inspection,
    }
    try:
        with workbook_path.open("xb") as handle:
            handle.write(content)
        workbook_path.chmod(0o600)
        with metadata_path.open("x", encoding="utf-8") as handle:
            json.dump(metadata, handle, ensure_ascii=False, separators=(",", ":"))
        metadata_path.chmod(0o600)
    except Exception:
        shutil.rmtree(path, ignore_errors=True)
        raise
    return _token(validation_id), metadata


def load_validation_artifact(
    token: str,
    *,
    user_id: str,
    organization_id: str,
    package_id: str,
    now: int | None = None,
) -> tuple[dict[str, Any], bytes]:
    try:
        validation_id, supplied_signature = str(token or "").split(".", 1)
    except ValueError as exc:
        raise AwardResultExcelError(
            "VALIDATION_TOKEN_INVALID", "Validation token không hợp lệ.", status_code=409
        ) from exc
    if not _VALIDATION_ID.fullmatch(validation_id):
        raise AwardResultExcelError(
            "VALIDATION_TOKEN_INVALID", "Validation token không hợp lệ.", status_code=409
        )
    expected = _token(validation_id).split(".", 1)[1]
    if not hmac.compare_digest(expected, supplied_signature):
        raise AwardResultExcelError(
            "VALIDATION_TOKEN_INVALID", "Validation token không hợp lệ.", status_code=409
        )
    path = _validation_path(validation_id)
    try:
        metadata = json.loads((path / "metadata.json").read_text(encoding="utf-8"))
        content = (path / "workbook.xlsx").read_bytes()
    except (OSError, json.JSONDecodeError) as exc:
        raise AwardResultExcelError(
            "VALIDATION_TOKEN_NOT_FOUND", "Validation token không còn tồn tại.", status_code=410
        ) from exc
    current = int(time.time() if now is None else now)
    if int(metadata.get("expiresAt") or 0) <= current:
        shutil.rmtree(path, ignore_errors=True)
        raise AwardResultExcelError(
            "VALIDATION_TOKEN_EXPIRED", "Validation token đã hết hạn.", status_code=410
        )
    binding = (
        str(metadata.get("userId")),
        str(metadata.get("organizationId")),
        str(metadata.get("packageId")),
    )
    if binding != (str(user_id), str(organization_id), str(package_id)):
        raise AwardResultExcelError(
            "VALIDATION_TOKEN_SCOPE_MISMATCH",
            "Validation token không thuộc user, tổ chức hoặc gói thầu hiện tại.",
            status_code=403,
        )
    if not hmac.compare_digest(
        hashlib.sha256(content).hexdigest(), str(metadata.get("sha256") or "")
    ):
        raise AwardResultExcelError(
            "WORKBOOK_CHANGED_AFTER_VALIDATION",
            "File đã thay đổi sau bước kiểm tra.",
            status_code=409,
        )
    return metadata, content


def consume_validation_artifact(token: str) -> None:
    validation_id = str(token or "").split(".", 1)[0]
    if _VALIDATION_ID.fullmatch(validation_id):
        shutil.rmtree(_validation_path(validation_id), ignore_errors=True)


def output_filename(original_filename: str) -> str:
    name = os.path.basename(str(original_filename or "workbook.xlsx"))
    stem = Path(name).stem
    stem = unicodedata.normalize("NFKC", stem)
    stem = re.sub(r"[<>:\"/\\|?*\x00-\x1f]", "_", stem)
    stem = re.sub(r"\s+", " ", stem).strip(" ._")[:120] or "workbook"
    return f"{stem}_da_dien_ket_qua.xlsx"
