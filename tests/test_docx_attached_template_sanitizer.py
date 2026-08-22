import asyncio
from io import BytesIO
import json
from pathlib import Path
from types import SimpleNamespace
from zipfile import ZIP_DEFLATED, ZipFile

import pytest
from lxml import etree

from backend.documents.archive_validation import (
    UnsafeArchiveError,
    sanitize_docx_attached_template,
    validate_ooxml_archive,
)
from backend.documents.document_worker_entry import _run_operation
from backend.documents import custom_exporter
from backend.documents.routes_docx import upload_template_api


REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
OFFICE_REL_NS = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
)
WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


class _Upload:
    def __init__(self, filename, content):
        self.filename = filename
        self._content = content
        self._offset = 0

    async def read(self, size=-1):
        if self._offset >= len(self._content):
            return b""
        end = len(self._content) if size < 0 else self._offset + size
        chunk = self._content[self._offset:end]
        self._offset += len(chunk)
        return chunk


class _Request:
    def __init__(self, upload):
        self._upload = upload

    async def form(self):
        return {"file": self._upload}


def _docx_with_external_relationship(*, relationship_type, target):
    content_types = b"""<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
</Types>"""
    document = (
        f'<w:document xmlns:w="{WORD_NS}"><w:body><w:p/></w:body></w:document>'
    ).encode()
    settings = (
        f'<w:settings xmlns:w="{WORD_NS}" xmlns:r="{OFFICE_REL_NS}">'
        '<w:attachedTemplate r:id="rId1"/><w:zoom w:percent="100"/>'
        '</w:settings>'
    ).encode()
    relationships = (
        f'<Relationships xmlns="{REL_NS}">'
        f'<Relationship Id="rId1" Type="{relationship_type}" '
        f'Target="{target}" TargetMode="External"/>'
        '</Relationships>'
    ).encode()
    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("word/document.xml", document)
        archive.writestr("word/settings.xml", settings)
        archive.writestr("word/_rels/settings.xml.rels", relationships)
    return output.getvalue(), document


def test_sanitizer_removes_only_external_attached_template():
    content, original_document = _docx_with_external_relationship(
        relationship_type=f"{OFFICE_REL_NS}/attachedTemplate",
        target="file:///C:/Users/example/Desktop/Quyet%20dinh.dot",
    )

    with pytest.raises(UnsafeArchiveError, match="liên kết ngoài"):
        validate_ooxml_archive(content, "docx")

    sanitized = sanitize_docx_attached_template(content)
    validate_ooxml_archive(sanitized, "docx")

    with ZipFile(BytesIO(sanitized)) as archive:
        assert archive.read("word/document.xml") == original_document
        settings = etree.fromstring(archive.read("word/settings.xml"))
        relationships = etree.fromstring(
            archive.read("word/_rels/settings.xml.rels")
        )
    assert settings.xpath("count(w:attachedTemplate)", namespaces={"w": WORD_NS}) == 0
    assert relationships.xpath(
        "count(r:Relationship)", namespaces={"r": REL_NS}
    ) == 0


def test_sanitizer_still_rejects_other_external_relationships():
    content, _ = _docx_with_external_relationship(
        relationship_type=f"{OFFICE_REL_NS}/hyperlink",
        target="https://example.com",
    )

    with pytest.raises(UnsafeArchiveError, match="liên kết ngoài"):
        sanitize_docx_attached_template(content)


def test_document_worker_returns_a_sanitized_valid_template():
    content, _ = _docx_with_external_relationship(
        relationship_type=f"{OFFICE_REL_NS}/attachedTemplate",
        target="file:///C:/Users/example/Desktop/Quyet%20dinh.dot",
    )

    sanitized = _run_operation(
        "sanitize_docx_template",
        {"content": content},
    )

    assert isinstance(sanitized, bytes)
    validate_ooxml_archive(sanitized, "docx")


def test_upload_route_sanitizes_attached_template_before_persisting(
    tmp_path,
    monkeypatch,
):
    content, _ = _docx_with_external_relationship(
        relationship_type=f"{OFFICE_REL_NS}/attachedTemplate",
        target="file:///C:/Users/example/Desktop/Quyet%20dinh.dot",
    )
    filename = "4.4. Quyết định phê duyệt E-HSMT.docx"
    request = _Request(_Upload(filename, content))
    monkeypatch.setattr(custom_exporter, "TEMPLATE_DIR", str(tmp_path))
    monkeypatch.setattr(
        "backend.documents.routes_docx.verify_session",
        lambda _request: (True, SimpleNamespace(user_id="user-a")),
    )
    monkeypatch.setattr(
        "backend.documents.routes_docx._word_config_access_response",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "backend.documents.routes_docx._word_template_upload_access_response",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "backend.documents.routes_docx.get_active_org",
        lambda *_args: "org-a",
    )
    audits = []
    monkeypatch.setattr(
        "backend.documents.routes_docx.log_audit",
        lambda event, **kwargs: audits.append((event, kwargs)),
    )
    async def run_worker(operation, payload, **_kwargs):
        return _run_operation(
            operation,
            {"content": Path(payload["content_path"]).read_bytes()},
        )

    monkeypatch.setattr(
        "backend.documents.routes_docx.run_document_job_async",
        run_worker,
    )

    response = asyncio.run(upload_template_api(request))

    assert response.status_code == 200
    assert json.loads(response.body)["filename"] == filename
    stored = (
        Path(custom_exporter.get_scope_template_dir("organization", "org-a"))
        / filename
    )
    validate_ooxml_archive(stored.read_bytes(), "docx")
    assert [event for event, _kwargs in audits] == [
        "document.word_template_upload_requested",
        "document.word_template_uploaded",
    ]
