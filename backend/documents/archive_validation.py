"""Fail-closed validation for uploaded OOXML archives.

The checks in this module inspect ZIP metadata and a small number of required XML
parts without extracting files to disk.  They are deliberately stricter than
``zipfile.is_zipfile`` because OOXML input is processed by comparatively complex
parsers later in the request.
"""

from __future__ import annotations

import io
import posixpath
import zipfile
from xml.etree import ElementTree


MAX_ARCHIVE_ENTRIES = 2_048
MAX_ENTRY_UNCOMPRESSED_BYTES = 25 * 1024 * 1024
MAX_TOTAL_UNCOMPRESSED_BYTES = 100 * 1024 * 1024
MAX_TOTAL_XML_BYTES = 30 * 1024 * 1024
MAX_SINGLE_XML_BYTES = 10 * 1024 * 1024
MAX_COMPRESSION_RATIO = 100
MAX_XML_DEPTH = 128

_OFFICE_DOCUMENT_CONTENT_TYPES = {
    "docx": {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    },
    "xlsx": {
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
    },
}

_REQUIRED_PARTS = {
    "docx": {"[Content_Types].xml", "word/document.xml"},
    "xlsx": {"[Content_Types].xml", "xl/workbook.xml"},
}


class UnsafeArchiveError(ValueError):
    """Raised when an uploaded archive violates an OOXML safety limit."""


def _normalise_entry_name(name: str) -> str:
    candidate = name.replace("\\", "/")
    if not candidate or candidate.startswith("/"):
        raise UnsafeArchiveError("Tệp Office chứa đường dẫn nội bộ không hợp lệ.")
    if "\x00" in candidate or candidate.split("/", 1)[0].endswith(":"):
        raise UnsafeArchiveError("Tệp Office chứa đường dẫn nội bộ không hợp lệ.")

    path_without_directory_suffix = candidate[:-1] if candidate.endswith("/") else candidate
    components = path_without_directory_suffix.split("/")
    if any(component in {"", ".", ".."} for component in components):
        raise UnsafeArchiveError("Tệp Office chứa đường dẫn nội bộ không an toàn.")
    normalised = posixpath.normpath(candidate)
    if normalised == ".." or normalised.startswith("../"):
        raise UnsafeArchiveError("Tệp Office chứa đường dẫn nội bộ không an toàn.")
    return normalised


def _validate_content_types(zf: zipfile.ZipFile, archive_kind: str) -> None:
    raw = zf.read("[Content_Types].xml")
    if b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
        raise UnsafeArchiveError("Tệp Office chứa khai báo XML không được hỗ trợ.")
    try:
        root = ElementTree.fromstring(raw)
    except ElementTree.ParseError as exc:
        raise UnsafeArchiveError("Cấu trúc XML của tệp Office không hợp lệ.") from exc

    allowed = _OFFICE_DOCUMENT_CONTENT_TYPES[archive_kind]
    declared = {
        node.attrib.get("ContentType", "").lower()
        for node in root.iter()
        if node.tag.rsplit("}", 1)[-1] == "Override"
    }
    if not {value.lower() for value in allowed}.intersection(declared):
        raise UnsafeArchiveError("Loại nội dung bên trong tệp Office không phù hợp.")


def _validate_xml_part(zf: zipfile.ZipFile, name: str) -> None:
    raw = zf.read(name)
    upper_raw = raw.upper()
    if b"<!DOCTYPE" in upper_raw or b"<!ENTITY" in upper_raw:
        raise UnsafeArchiveError("Tệp Office chứa khai báo XML không được hỗ trợ.")

    depth = 0
    try:
        for event, _node in ElementTree.iterparse(
            io.BytesIO(raw), events=("start", "end")
        ):
            if event == "start":
                depth += 1
                if depth > MAX_XML_DEPTH:
                    raise UnsafeArchiveError("Độ sâu XML của tệp Office vượt quá giới hạn.")
            else:
                depth -= 1
    except ElementTree.ParseError as exc:
        raise UnsafeArchiveError("Cấu trúc XML của tệp Office không hợp lệ.") from exc


def validate_ooxml_archive(content: bytes, archive_kind: str) -> None:
    """Validate DOCX/XLSX bytes without extracting their ZIP entries."""

    if archive_kind not in _REQUIRED_PARTS:
        raise ValueError(f"Unsupported OOXML archive kind: {archive_kind}")
    if not content:
        raise UnsafeArchiveError("Tệp Office đang trống.")

    try:
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            infos = zf.infolist()
            if not infos or len(infos) > MAX_ARCHIVE_ENTRIES:
                raise UnsafeArchiveError("Tệp Office chứa quá nhiều thành phần.")

            names: set[str] = set()
            names_casefolded: set[str] = set()
            total_size = 0
            total_xml_size = 0
            for info in infos:
                name = _normalise_entry_name(info.filename)
                folded_name = name.casefold()
                if name in names or folded_name in names_casefolded:
                    raise UnsafeArchiveError("Tệp Office chứa thành phần trùng tên.")
                names.add(name)
                names_casefolded.add(folded_name)

                if info.flag_bits & 0x1:
                    raise UnsafeArchiveError("Không hỗ trợ tệp Office có thành phần được mã hóa.")
                if info.file_size < 0 or info.file_size > MAX_ENTRY_UNCOMPRESSED_BYTES:
                    raise UnsafeArchiveError("Một thành phần trong tệp Office vượt quá giới hạn.")

                total_size += info.file_size
                if total_size > MAX_TOTAL_UNCOMPRESSED_BYTES:
                    raise UnsafeArchiveError("Kích thước giải nén của tệp Office vượt quá giới hạn.")

                if info.file_size:
                    if info.compress_size <= 0:
                        raise UnsafeArchiveError("Thông tin nén của tệp Office không hợp lệ.")
                    if info.file_size / info.compress_size > MAX_COMPRESSION_RATIO:
                        raise UnsafeArchiveError("Tỷ lệ nén của tệp Office vượt quá giới hạn.")

                if name.lower().endswith((".xml", ".rels")):
                    if info.file_size > MAX_SINGLE_XML_BYTES:
                        raise UnsafeArchiveError("Một thành phần XML vượt quá giới hạn.")
                    total_xml_size += info.file_size
                    if total_xml_size > MAX_TOTAL_XML_BYTES:
                        raise UnsafeArchiveError("Tổng kích thước XML vượt quá giới hạn.")
                    _validate_xml_part(zf, name)

            if not _REQUIRED_PARTS[archive_kind].issubset(names):
                raise UnsafeArchiveError("Cấu trúc tệp Office không hợp lệ.")
            _validate_content_types(zf, archive_kind)
    except zipfile.BadZipFile as exc:
        raise UnsafeArchiveError("Tệp Office không phải là gói ZIP hợp lệ.") from exc
