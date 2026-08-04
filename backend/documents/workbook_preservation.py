"""Minimal OOXML worksheet patching and archive preservation evidence."""

from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
from io import BytesIO
import posixpath
from typing import Any
from xml.etree import ElementTree
import zipfile


_MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
_DOC_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
_XML_NS = "http://www.w3.org/XML/1998/namespace"

ElementTree.register_namespace("", _MAIN_NS)
ElementTree.register_namespace("r", _DOC_REL_NS)


def archive_manifest(content: bytes) -> dict[str, dict[str, Any]]:
    with zipfile.ZipFile(BytesIO(content)) as archive:
        content_types_root = ElementTree.fromstring(
            archive.read("[Content_Types].xml")
        )
        defaults = {}
        overrides = {}
        for node in content_types_root:
            local_name = node.tag.rsplit("}", 1)[-1]
            if local_name == "Default":
                defaults[str(node.attrib.get("Extension") or "").casefold()] = str(
                    node.attrib.get("ContentType") or ""
                )
            elif local_name == "Override":
                overrides[str(node.attrib.get("PartName") or "").lstrip("/")] = str(
                    node.attrib.get("ContentType") or ""
                )

        def relationships(name: str) -> list[dict[str, str]]:
            if not name.endswith(".rels"):
                return []
            root = ElementTree.fromstring(archive.read(name))
            return sorted(
                (
                    {
                        "id": str(node.attrib.get("Id") or ""),
                        "type": str(node.attrib.get("Type") or ""),
                        "target": str(node.attrib.get("Target") or ""),
                        "targetMode": str(node.attrib.get("TargetMode") or ""),
                    }
                    for node in root
                    if node.tag.rsplit("}", 1)[-1] == "Relationship"
                ),
                key=lambda item: item["id"],
            )

        return {
            info.filename: {
                "sha256": sha256(archive.read(info.filename)).hexdigest(),
                "size": info.file_size,
                "compressType": info.compress_type,
                "contentType": overrides.get(
                    info.filename,
                    defaults.get(info.filename.rsplit(".", 1)[-1].casefold(), ""),
                ),
                "relationships": relationships(info.filename),
            }
            for info in archive.infolist()
        }


def _worksheet_part(archive: zipfile.ZipFile, sheet_name: str) -> str:
    workbook = ElementTree.fromstring(archive.read("xl/workbook.xml"))
    relationship_id = None
    for sheet in workbook.findall(f".//{{{_MAIN_NS}}}sheet"):
        if sheet.attrib.get("name") == sheet_name:
            relationship_id = sheet.attrib.get(f"{{{_DOC_REL_NS}}}id")
            break
    if not relationship_id:
        raise ValueError("Worksheet relationship is missing.")
    relationships = ElementTree.fromstring(
        archive.read("xl/_rels/workbook.xml.rels")
    )
    for relationship in relationships.findall(f"{{{_PKG_REL_NS}}}Relationship"):
        if relationship.attrib.get("Id") == relationship_id:
            target = str(relationship.attrib.get("Target") or "")
            if target.startswith("/"):
                return target.lstrip("/")
            return posixpath.normpath(posixpath.join("xl", target))
    raise ValueError("Worksheet target is missing.")


def _set_cell_value(cell, value: Any) -> None:
    for child in list(cell):
        if child.tag.rsplit("}", 1)[-1] in {"f", "v", "is"}:
            cell.remove(child)
    cell.attrib.pop("t", None)
    if value is None:
        return
    if isinstance(value, str):
        cell.set("t", "inlineStr")
        inline = ElementTree.SubElement(cell, f"{{{_MAIN_NS}}}is")
        text = ElementTree.SubElement(inline, f"{{{_MAIN_NS}}}t")
        if value != value.strip():
            text.set(f"{{{_XML_NS}}}space", "preserve")
        text.text = value
        return
    cell.set("t", "n")
    number = ElementTree.SubElement(cell, f"{{{_MAIN_NS}}}v")
    number.text = str(value)


def _cell_payloads(root) -> dict[str, bytes]:
    return {
        str(cell.attrib.get("r") or ""): ElementTree.tostring(cell)
        for cell in root.findall(f".//{{{_MAIN_NS}}}c")
    }


def _structure_without_cells(root) -> bytes:
    clone = deepcopy(root)
    for row in clone.findall(f".//{{{_MAIN_NS}}}row"):
        for cell in list(row):
            if cell.tag == f"{{{_MAIN_NS}}}c":
                row.remove(cell)
    return ElementTree.tostring(clone)


def _assert_only_cells_changed(
    before_xml: bytes, after_xml: bytes, allowed_coordinates: set[str]
) -> None:
    before = ElementTree.fromstring(before_xml)
    after = ElementTree.fromstring(after_xml)
    before_rows = [
        row.attrib.get("r") for row in before.findall(f".//{{{_MAIN_NS}}}row")
    ]
    after_rows = [
        row.attrib.get("r") for row in after.findall(f".//{{{_MAIN_NS}}}row")
    ]
    if before_rows != after_rows:
        raise ValueError("Worksheet row order changed during export.")
    if _structure_without_cells(before) != _structure_without_cells(after):
        raise ValueError("Worksheet structure changed outside cells during export.")
    before_cells = _cell_payloads(before)
    after_cells = _cell_payloads(after)
    if set(before_cells) != set(after_cells):
        raise ValueError("Worksheet cell set changed during export.")
    changed = {
        coordinate
        for coordinate in before_cells
        if before_cells[coordinate] != after_cells[coordinate]
    }
    if not changed.issubset(allowed_coordinates):
        raise ValueError("Worksheet cell changed outside the export allowlist.")


def patch_worksheet_cells(
    content: bytes,
    sheet_name: str,
    values_by_coordinate: dict[str, Any],
) -> tuple[bytes, str]:
    """Patch existing cells while copying every other ZIP entry byte-for-byte."""

    with zipfile.ZipFile(BytesIO(content)) as source:
        worksheet_part = _worksheet_part(source, sheet_name)
        before_xml = source.read(worksheet_part)
        root = ElementTree.fromstring(before_xml)
        cells = {
            str(cell.attrib.get("r") or ""): cell
            for cell in root.findall(f".//{{{_MAIN_NS}}}c")
        }
        missing = set(values_by_coordinate) - set(cells)
        if missing:
            raise ValueError("Export target cell is missing from worksheet XML.")
        for coordinate, value in values_by_coordinate.items():
            _set_cell_value(cells[coordinate], value)
        after_xml = ElementTree.tostring(
            root, encoding="utf-8", xml_declaration=True
        )
        # XML parsers normalize literal CR characters; a character reference
        # preserves the user's exact text when Excel/openpyxl reopens the cell.
        after_xml = after_xml.replace(b"\r", b"&#13;")
        _assert_only_cells_changed(before_xml, after_xml, set(values_by_coordinate))

        output = BytesIO()
        with zipfile.ZipFile(output, "w") as destination:
            for info in source.infolist():
                payload = after_xml if info.filename == worksheet_part else source.read(
                    info.filename
                )
                destination.writestr(info, payload)
    result = output.getvalue()
    before_manifest = archive_manifest(content)
    after_manifest = archive_manifest(result)
    if set(before_manifest) != set(after_manifest):
        raise ValueError("OOXML ZIP entry set changed during export.")
    for name, entry in before_manifest.items():
        if name != worksheet_part and entry["sha256"] != after_manifest[name]["sha256"]:
            raise ValueError("OOXML part changed outside the worksheet allowlist.")
    return result, worksheet_part
