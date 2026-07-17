"""Expand data-driven columns in DOCX table templates.

Column loops use ``{#col list_name}`` and ``{/col list_name}`` markers in the
same table column.  They are resolved before the remaining template syntax is
translated for docxtpl/Jinja.
"""

from __future__ import annotations

import logging
import re
import zipfile
from bisect import bisect_right
from collections import defaultdict
from copy import deepcopy
from dataclasses import dataclass
from io import BytesIO
from typing import Mapping, Sequence

from lxml import etree


LOGGER = logging.getLogger(__name__)

WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
XML_NS = "http://www.w3.org/XML/1998/namespace"
NS = {"w": WORD_NS}

START_MARKER_RE = re.compile(
    r"\{#col\s+([A-Za-z0-9_]+)\s*\}",
    re.IGNORECASE,
)
END_MARKER_RE = re.compile(
    r"\{/col\s+([A-Za-z0-9_]+)\s*\}",
    re.IGNORECASE,
)
VARIABLE_RE = re.compile(r"(?<!\{)\{([A-Za-z0-9_]+)\}(?!\})")
COLUMN_LITERAL_CONTEXT = {
    "docx_column_literal_open_brace": "{",
    "docx_column_literal_close_brace": "}",
}
OPEN_BRACE_TEMPLATE = "{{ docx_column_literal_open_brace }}"
CLOSE_BRACE_TEMPLATE = "{{ docx_column_literal_close_brace }}"


def _w_tag(local_name: str) -> str:
    return f"{{{WORD_NS}}}{local_name}"


@dataclass(frozen=True)
class ColumnLoop:
    """Location of one matched column-loop region."""

    table: object
    col_idx: int
    start_row: int
    end_row: int
    list_name: str


def _text_nodes(cell) -> list:
    owning_tables = cell.xpath("ancestor::w:tbl[1]", namespaces=NS)
    owning_table = owning_tables[0] if owning_tables else None
    nodes = []
    for node in cell.xpath(".//w:t", namespaces=NS):
        ancestor_tables = node.xpath("ancestor::w:tbl[1]", namespaces=NS)
        if owning_table is None and not ancestor_tables:
            nodes.append(node)
        elif owning_table is not None and ancestor_tables and ancestor_tables[0] == owning_table:
            nodes.append(node)
    return nodes


def _cell_plain_text(cell) -> str:
    """Return a cell's logical text, including text split across Word runs."""

    return "".join(node.text or "" for node in _text_nodes(cell))


def _clean_cell_braces(cell) -> str:
    """Return text with run-split brace expressions logically reassembled."""

    return _cell_plain_text(cell)


def _find_column_loops(doc_xml) -> list[ColumnLoop]:
    """Find valid marker pairs in each table and column."""

    loops = []
    for table in doc_xml.xpath(".//w:tbl", namespaces=NS):
        open_markers = defaultdict(list)
        rows = table.xpath("./w:tr", namespaces=NS)
        for row_idx, row in enumerate(rows):
            cells = row.xpath("./w:tc", namespaces=NS)
            for col_idx, cell in enumerate(cells):
                text = _clean_cell_braces(cell)
                for match in START_MARKER_RE.finditer(text):
                    name = match.group(1).lower()
                    open_markers[(col_idx, name)].append(row_idx)
                for match in END_MARKER_RE.finditer(text):
                    name = match.group(1).lower()
                    key = (col_idx, name)
                    candidates = open_markers.get(key)
                    if not candidates:
                        LOGGER.warning(
                            "Ignoring unmatched DOCX column-loop end marker: %s",
                            name,
                        )
                        continue
                    start_row = candidates.pop()
                    if start_row >= row_idx:
                        LOGGER.warning(
                            "Ignoring zero-height DOCX column loop: %s",
                            name,
                        )
                        continue
                    loops.append(
                        ColumnLoop(table, col_idx, start_row, row_idx, name)
                    )

        for (_col_idx, name), start_rows in open_markers.items():
            if start_rows:
                LOGGER.warning(
                    "Ignoring unmatched DOCX column-loop start marker: %s",
                    name,
                )
    return loops


def _set_node_text(node, value: str) -> None:
    node.text = value
    xml_space = f"{{{XML_NS}}}space"
    if value[:1].isspace() or value[-1:].isspace():
        node.set(xml_space, "preserve")
    else:
        node.attrib.pop(xml_space, None)


def _rewrite_matches(cell, pattern, replacement_for_match) -> None:
    """Rewrite regex matches even when Word split them across text runs."""

    nodes = _text_nodes(cell)
    if not nodes:
        return
    original_parts = [node.text or "" for node in nodes]
    combined = "".join(original_parts)
    matches = list(pattern.finditer(combined))
    if not matches:
        return

    starts = []
    cursor = 0
    for part in original_parts:
        starts.append(cursor)
        cursor += len(part)

    for match in reversed(matches):
        replacement = replacement_for_match(match)
        if replacement is None:
            continue
        start_idx = max(0, bisect_right(starts, match.start()) - 1)
        end_idx = max(0, bisect_right(starts, match.end() - 1) - 1)
        start_offset = match.start() - starts[start_idx]
        end_offset = match.end() - starts[end_idx]

        if start_idx == end_idx:
            current = nodes[start_idx].text or ""
            value = current[:start_offset] + replacement + current[end_offset:]
            _set_node_text(nodes[start_idx], value)
            continue

        start_text = nodes[start_idx].text or ""
        end_text = nodes[end_idx].text or ""
        _set_node_text(nodes[start_idx], start_text[:start_offset] + replacement)
        for node_idx in range(start_idx + 1, end_idx):
            _set_node_text(nodes[node_idx], "")
        _set_node_text(nodes[end_idx], end_text[end_offset:])


def _replace_vars_in_cell(
    cell,
    item: Mapping,
    *,
    clear_unknown: bool = False,
) -> None:
    """Replace variables supplied by one list item, preserving unknown ones."""

    exact_values = {str(key): value for key, value in item.items()}
    folded_values = {str(key).lower(): value for key, value in item.items()}

    def replacement(match):
        name = match.group(1)
        if name in exact_values:
            value = exact_values[name]
        elif name.lower() in folded_values:
            value = folded_values[name.lower()]
        else:
            return "" if clear_unknown else None
        if value is None:
            return ""
        return str(value).translate(
            {
                ord("{"): OPEN_BRACE_TEMPLATE,
                ord("}"): CLOSE_BRACE_TEMPLATE,
            }
        )

    _rewrite_matches(cell, VARIABLE_RE, replacement)


def _remove_text_pattern(cell, pattern) -> None:
    _rewrite_matches(cell, pattern, lambda _match: "")


def _ensure_cell_properties(cell):
    properties = cell.find(_w_tag("tcPr"))
    if properties is None:
        properties = etree.Element(_w_tag("tcPr"))
        cell.insert(0, properties)
    return properties


def _set_cell_width(cell, width: int) -> None:
    properties = _ensure_cell_properties(cell)
    cell_width = properties.find(_w_tag("tcW"))
    if cell_width is None:
        cell_width = etree.Element(_w_tag("tcW"))
        properties.insert(0, cell_width)
    cell_width.set(_w_tag("w"), str(max(1, width)))
    cell_width.set(_w_tag("type"), "dxa")


def _merge_header_cells(row, col_idx: int, count: int, total_width: int) -> None:
    if count <= 1:
        return
    cells = row.xpath("./w:tc", namespaces=NS)
    if col_idx >= len(cells):
        return
    header_cell = cells[col_idx]
    properties = _ensure_cell_properties(header_cell)
    grid_span = properties.find(_w_tag("gridSpan"))
    if grid_span is None:
        grid_span = etree.Element(_w_tag("gridSpan"))
        properties.append(grid_span)
    grid_span.set(_w_tag("val"), str(count))
    _set_cell_width(header_cell, total_width)

    for cell in cells[col_idx + 1:col_idx + count]:
        row.remove(cell)


def _split_width(total_width: int, count: int) -> list[int]:
    quotient, remainder = divmod(max(total_width, count), count)
    return [quotient + (1 if index < remainder else 0) for index in range(count)]


def _update_table_grid(table, col_idx: int, count: int) -> list[int]:
    """Replace one grid column with ``count`` equal-width columns."""

    grid = table.find(_w_tag("tblGrid"))
    if grid is None:
        return [1_440] * count
    columns = grid.findall(_w_tag("gridCol"))
    if col_idx >= len(columns):
        return [1_440] * count

    original = columns[col_idx]
    try:
        original_width = int(original.get(_w_tag("w"), "1440"))
    except ValueError:
        original_width = 1_440
    widths = _split_width(original_width, count)
    position = grid.index(original)
    grid.remove(original)
    for offset, width in enumerate(widths):
        column = etree.Element(_w_tag("gridCol"))
        column.set(_w_tag("w"), str(width))
        grid.insert(position + offset, column)
    return widths


def _normalise_items(value) -> Sequence[Mapping]:
    if not isinstance(value, (list, tuple)):
        return []
    return [item for item in value if isinstance(item, Mapping)]


def _context_list(context: Mapping, name: str) -> Sequence[Mapping]:
    if name in context:
        return _normalise_items(context[name])
    folded = name.lower()
    for key, value in context.items():
        if str(key).lower() == folded:
            return _normalise_items(value)
    return []


def _expand_one_loop(
    table,
    col_idx: int,
    start_row: int,
    end_row: int,
    items: Sequence[Mapping],
) -> None:
    count = max(len(items), 1)
    widths = _update_table_grid(table, col_idx, count)
    total_width = sum(widths)
    rows = table.xpath("./w:tr", namespaces=NS)

    for row_idx in range(start_row, min(end_row + 1, len(rows))):
        row = rows[row_idx]
        cells = row.xpath("./w:tc", namespaces=NS)
        if col_idx >= len(cells):
            continue
        template_cell = cells[col_idx]
        insert_at = row.index(template_cell)
        row.remove(template_cell)

        for item_idx in range(count):
            cell_copy = deepcopy(template_cell)
            item = items[item_idx] if items else {}
            _replace_vars_in_cell(
                cell_copy,
                item,
                clear_unknown=not items,
            )
            _remove_text_pattern(cell_copy, START_MARKER_RE)
            _remove_text_pattern(cell_copy, END_MARKER_RE)
            _set_cell_width(cell_copy, widths[item_idx])
            row.insert(insert_at + item_idx, cell_copy)

        if row_idx == start_row:
            _merge_header_cells(row, col_idx, count, total_width)


def expand_column_loops(template_bytes: bytes, context: Mapping) -> bytes:
    """Expand all valid column loops in ``word/document.xml``.

    The original byte object is returned when the document has no matched
    column-loop region.  This also supplies a cheap signal to callers deciding
    whether a context-independent translation cache is safe.
    """

    with zipfile.ZipFile(BytesIO(template_bytes), "r") as archive:
        document_xml = archive.read("word/document.xml")

    parser = etree.XMLParser(resolve_entities=False, no_network=True, huge_tree=False)
    root = etree.fromstring(document_xml, parser=parser)
    loops = _find_column_loops(root)
    if not loops:
        return template_bytes

    loops_by_table = defaultdict(list)
    table_order = []
    for loop in loops:
        table_key = id(loop.table)
        if table_key not in loops_by_table:
            table_order.append(table_key)
        loops_by_table[table_key].append(loop)

    for table_key in table_order:
        table_loops = sorted(
            loops_by_table[table_key],
            key=lambda loop: (loop.col_idx, loop.start_row),
            reverse=True,
        )
        for loop in table_loops:
            _expand_one_loop(
                loop.table,
                loop.col_idx,
                loop.start_row,
                loop.end_row,
                _context_list(context, loop.list_name),
            )

    rewritten_xml = etree.tostring(
        root,
        encoding="UTF-8",
        xml_declaration=True,
        standalone=True,
    )
    output = BytesIO()
    with zipfile.ZipFile(BytesIO(template_bytes), "r") as source:
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as target:
            for info in source.infolist():
                data = rewritten_xml if info.filename == "word/document.xml" else source.read(info.filename)
                target.writestr(info, data)
    return output.getvalue()
