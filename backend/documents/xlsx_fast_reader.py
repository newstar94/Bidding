"""Small, dependency-light reader for the first worksheet of validated XLSX."""

from __future__ import annotations

from datetime import datetime, timedelta
from io import BytesIO
import posixpath
import re
import zipfile

from defusedxml import ElementTree


_MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
_DOC_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
_BUILTIN_DATE_FORMAT_IDS = frozenset({
    *range(14, 23),
    *range(27, 37),
    *range(45, 48),
    *range(50, 59),
})
_CELL_REFERENCE = re.compile(r"^([A-Z]+)", re.IGNORECASE)


def _first_worksheet_path(archive, workbook_root):
    first_sheet = workbook_root.find(f".//{{{_MAIN_NS}}}sheet")
    relationship_id = (
        first_sheet.attrib.get(f"{{{_DOC_REL_NS}}}id")
        if first_sheet is not None
        else None
    )
    if not relationship_id:
        raise ValueError("Tệp Excel không có trang tính để nhập dữ liệu.")
    relationships = ElementTree.fromstring(
        archive.read("xl/_rels/workbook.xml.rels")
    )
    for relationship in relationships.findall(f"{{{_PKG_REL_NS}}}Relationship"):
        if relationship.attrib.get("Id") != relationship_id:
            continue
        target = str(relationship.attrib.get("Target") or "")
        path = target.lstrip("/") if target.startswith("/") else posixpath.normpath(
            posixpath.join("xl", target)
        )
        if not path.startswith("xl/worksheets/") or path not in archive.namelist():
            raise ValueError("Đường dẫn trang tính Excel không hợp lệ.")
        return path
    raise ValueError("Không tìm thấy trang tính Excel cần nhập.")


def _shared_strings(archive):
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
    return [
        "".join(text.text or "" for text in item.iter(f"{{{_MAIN_NS}}}t"))
        for item in root.findall(f"{{{_MAIN_NS}}}si")
    ]


def _looks_like_date_format(format_code):
    normalized = re.sub(r'"[^"]*"|\\.|_.|\*.', "", str(format_code or ""))
    normalized = re.sub(r"\[(?![hms]+\])[^\]]*\]", "", normalized, flags=re.I)
    return bool(re.search(r"(?:^|[^a-z])[ymdhis]+", normalized, flags=re.I))


def _date_style_indexes(archive):
    if "xl/styles.xml" not in archive.namelist():
        return set()
    root = ElementTree.fromstring(archive.read("xl/styles.xml"))
    custom_formats = {
        int(node.attrib["numFmtId"]): node.attrib.get("formatCode", "")
        for node in root.findall(f".//{{{_MAIN_NS}}}numFmt")
        if str(node.attrib.get("numFmtId") or "").isdigit()
    }
    cell_formats = root.find(f"{{{_MAIN_NS}}}cellXfs")
    if cell_formats is None:
        return set()
    indexes = set()
    for index, cell_format in enumerate(cell_formats.findall(f"{{{_MAIN_NS}}}xf")):
        try:
            format_id = int(cell_format.attrib.get("numFmtId", "0"))
        except ValueError:
            continue
        if (
            format_id in _BUILTIN_DATE_FORMAT_IDS
            or _looks_like_date_format(custom_formats.get(format_id, ""))
        ):
            indexes.add(index)
    return indexes


def _column_index(reference):
    match = _CELL_REFERENCE.match(str(reference or ""))
    if not match:
        return None
    result = 0
    for character in match.group(1).upper():
        result = result * 26 + ord(character) - ord("A") + 1
    return result - 1


def _excel_datetime(serial, *, date_1904):
    origin = datetime(1904, 1, 1) if date_1904 else datetime(1899, 12, 30)
    # XLSX stores dates as floating-point days. Millisecond rounding removes
    # binary artifacts such as 08:29:59.999999 while retaining workbook time.
    return origin + timedelta(milliseconds=round(float(serial) * 86_400_000))


def _cell_value(cell, shared_strings, date_styles, *, date_1904):
    cell_type = str(cell.attrib.get("t") or "n")
    if cell_type == "inlineStr":
        return "".join(
            text.text or "" for text in cell.iter(f"{{{_MAIN_NS}}}t")
        )
    value_node = cell.find(f"{{{_MAIN_NS}}}v")
    raw = value_node.text if value_node is not None else None
    if raw is None:
        return None
    if cell_type == "s":
        try:
            return shared_strings[int(raw)]
        except (IndexError, ValueError):
            raise ValueError("Bảng chuỗi dùng chung của Excel không hợp lệ.") from None
    if cell_type in {"str", "e"}:
        return raw
    if cell_type == "b":
        return raw == "1"
    if cell_type == "d":
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return raw
    try:
        number = float(raw)
    except ValueError:
        return raw
    try:
        style_index = int(cell.attrib.get("s", "0"))
    except ValueError:
        style_index = 0
    if style_index in date_styles:
        return _excel_datetime(number, date_1904=date_1904)
    return int(number) if number.is_integer() else number


def read_first_worksheet_rows(content):
    """Return a rectangular row iterator without importing pandas/openpyxl."""

    with zipfile.ZipFile(BytesIO(content)) as archive:
        workbook_root = ElementTree.fromstring(archive.read("xl/workbook.xml"))
        workbook_properties = workbook_root.find(f"{{{_MAIN_NS}}}workbookPr")
        date_1904 = str(
            workbook_properties.attrib.get("date1904", "0")
            if workbook_properties is not None
            else "0"
        ).casefold() in {"1", "true"}
        worksheet_path = _first_worksheet_path(archive, workbook_root)
        shared_strings = _shared_strings(archive)
        date_styles = _date_style_indexes(archive)
        worksheet = ElementTree.fromstring(archive.read(worksheet_path))
        rows = []
        for row_node in worksheet.findall(f".//{{{_MAIN_NS}}}row"):
            try:
                row_number = max(1, int(row_node.attrib.get("r", len(rows) + 1)))
            except ValueError:
                row_number = len(rows) + 1
            while len(rows) < row_number - 1:
                rows.append([])
            values = {}
            for cell in row_node.findall(f"{{{_MAIN_NS}}}c"):
                column_index = _column_index(cell.attrib.get("r"))
                if column_index is None:
                    continue
                values[column_index] = _cell_value(
                    cell,
                    shared_strings,
                    date_styles,
                    date_1904=date_1904,
                )
            width = max(values, default=-1) + 1
            rows.append([values.get(index) for index in range(width)])
        return rows
