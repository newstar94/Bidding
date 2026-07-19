from __future__ import annotations

import io
import time
import zipfile

import pytest

from backend.documents import archive_validation
from backend.documents.archive_validation import UnsafeArchiveError
from backend.shared import subscription_policy
from backend.shared.workspace_scope import (
    is_personal_scope_for_user,
    personal_scope_id,
    personal_scope_owner_id,
    personal_workspace_payload,
)


CONTENT_TYPES = {
    "docx": (
        b'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        b'<Override PartName="/word/document.xml" '
        b'ContentType="application/vnd.openxmlformats-officedocument.'
        b'wordprocessingml.document.main+xml"/></Types>'
    ),
    "xlsx": (
        b'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        b'<Override PartName="/xl/workbook.xml" '
        b'ContentType="application/vnd.openxmlformats-officedocument.'
        b'spreadsheetml.sheet.main+xml"/></Types>'
    ),
}


def _archive(kind: str, extra: dict[str, bytes] | None = None) -> bytes:
    required = (
        {"word/document.xml": b"<document/>"}
        if kind == "docx"
        else {"xl/workbook.xml": b"<workbook/>"}
    )
    entries = {"[Content_Types].xml": CONTENT_TYPES[kind], **required, **(extra or {})}
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as package:
        for name, content in entries.items():
            package.writestr(name, content)
    return output.getvalue()


@pytest.mark.parametrize("kind", ["docx", "xlsx"])
def test_valid_ooxml_archives_are_accepted(kind: str) -> None:
    archive_validation.validate_ooxml_archive(_archive(kind), kind)


@pytest.mark.parametrize(
    ("content", "kind", "error_type"),
    [
        (b"", "docx", UnsafeArchiveError),
        (b"not-a-zip", "docx", UnsafeArchiveError),
        (_archive("docx"), "pptx", ValueError),
    ],
)
def test_archive_rejects_empty_invalid_and_unsupported_inputs(
    content: bytes, kind: str, error_type: type[Exception]
) -> None:
    with pytest.raises(error_type):
        archive_validation.validate_ooxml_archive(content, kind)


@pytest.mark.parametrize(
    "name",
    [
        "/absolute.xml",
        "C:drive.xml",
        "../escape.xml",
        "word//duplicate-separator.xml",
        "word/./dot.xml",
        "word/../escape.xml",
    ],
)
def test_archive_rejects_unsafe_internal_paths(name: str) -> None:
    with pytest.raises(UnsafeArchiveError):
        archive_validation.validate_ooxml_archive(
            _archive("docx", {name: b"<x/>"}), "docx"
        )


def test_archive_rejects_case_insensitive_duplicate_names() -> None:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as package:
        package.writestr("[Content_Types].xml", CONTENT_TYPES["docx"])
        package.writestr("word/document.xml", b"<document/>")
        package.writestr("word/item.xml", b"<x/>")
        package.writestr("WORD/ITEM.XML", b"<x/>")
    with pytest.raises(UnsafeArchiveError):
        archive_validation.validate_ooxml_archive(output.getvalue(), "docx")


@pytest.mark.parametrize(
    ("kind", "extra"),
    [
        ("xlsx", {"xl/externalLinks/externalLink1.xml": b"<external/>"}),
        (
            "docx",
            {
                "word/_rels/document.xml.rels": (
                    b'<Relationships><Relationship TargetMode="External" '
                    b'Target="https://example.com"/></Relationships>'
                )
            },
        ),
        (
            "xlsx",
            {"xl/worksheets/sheet1.xml": b"<worksheet><c><f>1+1</f></c></worksheet>"},
        ),
    ],
)
def test_archive_rejects_external_links_and_excel_formulas(
    kind: str, extra: dict[str, bytes]
) -> None:
    with pytest.raises(UnsafeArchiveError):
        archive_validation.validate_ooxml_archive(_archive(kind, extra), kind)


@pytest.mark.parametrize(
    ("entry", "payload"),
    [
        ("word/document.xml", b"<!DOCTYPE x><document/>"),
        ("word/document.xml", b"<document>"),
        ("[Content_Types].xml", b"<!ENTITY x 'bad'><Types/>"),
        ("[Content_Types].xml", b"<Types>"),
        (
            "[Content_Types].xml",
            b"<Types><Override ContentType='application/not-office'/></Types>",
        ),
    ],
)
def test_archive_rejects_unsafe_or_malformed_xml(entry: str, payload: bytes) -> None:
    with pytest.raises(UnsafeArchiveError):
        archive_validation.validate_ooxml_archive(
            _archive("docx", {entry: payload}), "docx"
        )


def test_archive_rejects_missing_required_part() -> None:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as package:
        package.writestr("[Content_Types].xml", CONTENT_TYPES["docx"])
    with pytest.raises(UnsafeArchiveError):
        archive_validation.validate_ooxml_archive(output.getvalue(), "docx")


def test_archive_enforces_entry_and_xml_limits(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(archive_validation, "MAX_ARCHIVE_ENTRIES", 2)
    with pytest.raises(UnsafeArchiveError):
        archive_validation.validate_ooxml_archive(
            _archive("docx", {"word/extra.xml": b"<x/>"}), "docx"
        )

    monkeypatch.setattr(archive_validation, "MAX_ARCHIVE_ENTRIES", 10)
    monkeypatch.setattr(archive_validation, "MAX_ENTRY_UNCOMPRESSED_BYTES", 5)
    with pytest.raises(UnsafeArchiveError):
        archive_validation.validate_ooxml_archive(_archive("docx"), "docx")

    monkeypatch.setattr(archive_validation, "MAX_ENTRY_UNCOMPRESSED_BYTES", 10_000)
    monkeypatch.setattr(archive_validation, "MAX_TOTAL_UNCOMPRESSED_BYTES", 20)
    with pytest.raises(UnsafeArchiveError):
        archive_validation.validate_ooxml_archive(_archive("docx"), "docx")

    monkeypatch.setattr(archive_validation, "MAX_TOTAL_UNCOMPRESSED_BYTES", 10_000)
    monkeypatch.setattr(archive_validation, "MAX_SINGLE_XML_BYTES", 10)
    with pytest.raises(UnsafeArchiveError):
        archive_validation.validate_ooxml_archive(_archive("docx"), "docx")


def test_archive_rejects_compression_bombs_and_deep_xml(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(archive_validation, "MAX_COMPRESSION_RATIO", 1)
    with pytest.raises(UnsafeArchiveError):
        archive_validation.validate_ooxml_archive(_archive("docx"), "docx")

    monkeypatch.setattr(archive_validation, "MAX_COMPRESSION_RATIO", 100)
    monkeypatch.setattr(archive_validation, "MAX_XML_DEPTH", 2)
    with pytest.raises(UnsafeArchiveError):
        archive_validation.validate_ooxml_archive(
            _archive("docx", {"word/document.xml": b"<a><b><c/></b></a>"}),
            "docx",
        )


class _Result:
    def __init__(self, row):
        self._row = row

    def fetchone(self):
        return self._row


class _Cursor:
    def __init__(self, rows):
        self.rows = list(rows)
        self.calls = []

    def execute(self, sql, parameters=()):
        self.calls.append((sql, parameters))
        return _Result(self.rows.pop(0) if self.rows else None)


def _subscription_row(**overrides):
    row = {
        "package_id": "package-1",
        "status": "active",
        "starts_at": 1_700_000_000,
        "expires_at": int(time.time()) + 3_600,
        "revision": 2,
        "package_status": "active",
        "member_quota": 25,
    }
    row.update(overrides)
    return row


def test_subscription_normalization_and_statuses() -> None:
    assert subscription_policy._normalized_subscription(None) is None
    active = subscription_policy._normalized_subscription(
        _subscription_row(), include_quota=True
    )
    assert active["status"] == "active"
    assert active["member_quota"] == 25
    assert active["start_date"]
    assert active["end_date"]

    expired = subscription_policy._normalized_subscription(
        _subscription_row(expires_at=int(time.time()) - 1)
    )
    assert expired["status"] == "expired"
    package_inactive = subscription_policy._normalized_subscription(
        _subscription_row(package_status="inactive")
    )
    assert package_inactive["status"] == "package_inactive"
    assert subscription_policy.subscription_is_active(active)
    assert not subscription_policy.subscription_is_active(expired)
    assert not subscription_policy.subscription_is_active(None)


def test_subscription_queries_bind_scope_identifiers() -> None:
    account_cursor = _Cursor([_subscription_row()])
    assert (
        subscription_policy.get_account_subscription(account_cursor, "user-1")[
            "package_id"
        ]
        == "package-1"
    )
    assert account_cursor.calls[0][1] == ("user-1",)

    organization_cursor = _Cursor([_subscription_row()])
    assert (
        subscription_policy.get_organization_subscription(
            organization_cursor, "org-1"
        )["member_quota"]
        == 25
    )
    assert organization_cursor.calls[0][1] == ("org-1",)


def test_word_export_entitlement_follows_active_scope_subscription() -> None:
    assert subscription_policy.can_use_word_export(
        _Cursor([]), "super_admin", "admin", "personal:admin"
    )

    personal_active = _Cursor([_subscription_row()])
    assert subscription_policy.can_use_word_export(
        personal_active, "employee", "user-1", "personal:user-1"
    )
    personal_inactive = _Cursor([_subscription_row(status="inactive")])
    assert not subscription_policy.can_use_word_export(
        personal_inactive, "employee", "user-1", "personal:user-1"
    )

    assert not subscription_policy.can_use_word_export(
        _Cursor([None]), "employee", "user-1", "org-1"
    )
    assert subscription_policy.can_use_word_export(
        _Cursor([(1,), _subscription_row()]),
        "employee",
        "user-1",
        "org-1",
    )
    assert not subscription_policy.can_use_word_export(
        _Cursor([(1,), _subscription_row(status="inactive")]),
        "employee",
        "user-1",
        "org-1",
    )


@pytest.mark.parametrize(
    ("role", "scope", "source"),
    [
        ("super_admin", "org-1", "platform"),
        ("employee", "personal:user-1", "account_subscription"),
        ("employee", "org-1", "organization_subscription"),
    ],
)
def test_word_export_payload_reports_entitlement_source(
    role: str, scope: str, source: str
) -> None:
    rows = [] if role == "super_admin" else [_subscription_row()]
    if scope == "org-1" and role != "super_admin":
        rows.insert(0, (1,))
    payload = subscription_policy.word_export_entitlement_payload(
        _Cursor(rows), role, "user-1", scope
    )
    assert payload == {"word_export": True, "source": source}


def test_virtual_personal_workspace_identifiers_and_payload() -> None:
    assert personal_scope_id(" user-1 ") == "personal:user-1"
    with pytest.raises(ValueError):
        personal_scope_id(" ")
    assert personal_scope_owner_id("personal:user-1") == "user-1"
    assert personal_scope_owner_id("personal: ") is None
    assert personal_scope_owner_id("org-1") is None
    assert is_personal_scope_for_user("personal:user-1", "user-1")
    assert not is_personal_scope_for_user("personal:user-2", "user-1")

    active = personal_workspace_payload(
        "user-1", display_name="ignored", subscription={"status": "active"}
    )
    assert active["id"] == "personal:user-1"
    assert active["scope_type"] == "personal"
    assert active["entitlements"]["word_export"] is True
    inactive = personal_workspace_payload("user-1")
    assert inactive["entitlements"]["word_export"] is False
