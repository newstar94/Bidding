"""Render a generated Word document (or a ZIP of them) as bounded preview HTML.

The preview is a reading aid before download: paragraphs, headings, basic
run formatting, lists and tables. Every text node is HTML-escaped here and the
browser sanitizes again (DOMPurify/Trusted Types). Images are shown as a
placeholder; the downloaded file stays the authoritative document.
"""

from __future__ import annotations

import html
import io
import zipfile

from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph


MAX_BLOCKS = 4_000
MAX_HTML_CHARS = 1_500_000
MAX_ZIP_DOCUMENTS = 10
MAX_ENTRY_BYTES = 30 * 1024 * 1024
_W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


class PreviewTooLarge(ValueError):
    """The document is larger than an inline preview should render."""


def _run_html(run):
    text = html.escape(run.text or "")
    if not text:
        if run.element.findall(f".//{_W_NS}drawing") or run.element.findall(".//{urn:schemas-microsoft-com:vml}imagedata"):
            return '<span class="bf-doc-image">[Hình ảnh]</span>'
        if run.element.findall(f"{_W_NS}br"):
            return "<br>"
        return ""
    text = text.replace("\n", "<br>")
    if run.bold:
        text = f"<strong>{text}</strong>"
    if run.italic:
        text = f"<em>{text}</em>"
    if run.underline:
        text = f"<u>{text}</u>"
    return text


def _paragraph_html(paragraph):
    content = "".join(_run_html(run) for run in paragraph.runs) or "&nbsp;"
    style = str(getattr(paragraph.style, "name", "") or "").lower()
    alignment = {0: "left", 1: "center", 2: "right", 3: "justify"}.get(
        getattr(paragraph.alignment, "value", paragraph.alignment) if paragraph.alignment is not None else None,
        "",
    )
    align_class = f' class="bf-doc-align-{alignment}"' if alignment else ""
    if style.startswith("title"):
        return f"<h1{align_class}>{content}</h1>"
    if style.startswith("heading"):
        level = "".join(ch for ch in style if ch.isdigit())[:1] or "2"
        level = str(min(6, max(2, int(level) + 1)))
        return f"<h{level}{align_class}>{content}</h{level}>"
    if "list" in style:
        return f'<p class="bf-doc-list-item">• {content}</p>'
    return f"<p{align_class}>{content}</p>"


def _table_html(table, budget):
    rows = []
    for row in table.rows:
        cells = []
        previous = None
        for cell in row.cells:
            # python-docx repeats merged cells; render each underlying cell once.
            if previous is not None and cell._tc is previous:
                continue
            previous = cell._tc
            inner = "".join(_block_html(block, budget) for block in _iter_blocks(cell))
            cells.append(f"<td>{inner or '&nbsp;'}</td>")
        rows.append(f"<tr>{''.join(cells)}</tr>")
    return f'<table class="bf-doc-table"><tbody>{"".join(rows)}</tbody></table>'


def _iter_blocks(parent):
    tc = getattr(parent, "_tc", None)
    element = tc if tc is not None else parent.element.body
    for child in element.iterchildren():
        if child.tag == f"{_W_NS}p":
            yield Paragraph(child, parent)
        elif child.tag == f"{_W_NS}tbl":
            yield Table(child, parent)


def _block_html(block, budget):
    budget["blocks"] += 1
    if budget["blocks"] > MAX_BLOCKS:
        raise PreviewTooLarge("Tài liệu quá dài để xem trước.")
    if isinstance(block, Table):
        return _table_html(block, budget)
    return _paragraph_html(block)


def docx_to_preview_html(content: bytes) -> str:
    document = Document(io.BytesIO(content))
    budget = {"blocks": 0}
    parts = []
    size = 0
    for block in _iter_blocks(document):
        fragment = _block_html(block, budget)
        size += len(fragment)
        if size > MAX_HTML_CHARS:
            raise PreviewTooLarge("Tài liệu quá dài để xem trước.")
        parts.append(fragment)
    return "".join(parts)


def build_document_preview(content: bytes, filename: str = "") -> list[dict]:
    """Return ``[{"filename", "html"}]`` for one DOCX or a ZIP of DOCX files."""

    data = bytes(content or b"")
    if data[:2] != b"PK":
        raise ValueError("Tài liệu không đúng định dạng Word.")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = archive.namelist()
        is_docx = "word/document.xml" in names
        if is_docx:
            return [{"filename": filename or "tai-lieu.docx", "html": docx_to_preview_html(data)}]
        documents = []
        for info in archive.infolist():
            if not info.filename.lower().endswith(".docx") or info.is_dir():
                continue
            if info.file_size > MAX_ENTRY_BYTES:
                raise PreviewTooLarge("Tài liệu quá lớn để xem trước.")
            documents.append({
                "filename": info.filename.rsplit("/", 1)[-1],
                "html": docx_to_preview_html(archive.read(info)),
            })
            if len(documents) >= MAX_ZIP_DOCUMENTS:
                break
    if not documents:
        raise ValueError("Không có tài liệu Word để xem trước.")
    return documents
