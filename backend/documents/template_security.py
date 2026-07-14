"""Restricted Jinja environment and template policy for DOCX rendering."""

from __future__ import annotations

import html
import io
import re
import zipfile
from collections.abc import Iterable

from jinja2 import StrictUndefined
from jinja2.defaults import DEFAULT_FILTERS
from jinja2.sandbox import SandboxedEnvironment


ALLOWED_FILTERS = {
    "capitalize",
    "default",
    "first",
    "float",
    "int",
    "join",
    "last",
    "length",
    "list",
    "lower",
    "replace",
    "reverse",
    "round",
    "sort",
    "string",
    "title",
    "trim",
    "upper",
}
ALLOWED_STATEMENT_TAGS = {"for", "endfor", "if", "elif", "else", "endif"}

_STATEMENT_PATTERN = re.compile(r"{%\s*(.*?)\s*%}", re.DOTALL)
_XML_TAG_PATTERN = re.compile(r"<[^>]+>")


def create_template_environment() -> SandboxedEnvironment:
    """Return a fresh, minimal Jinja sandbox for a single render."""

    environment = SandboxedEnvironment(
        undefined=StrictUndefined,
        autoescape=False,
    )
    environment.globals.clear()
    environment.tests.clear()
    environment.filters.clear()
    environment.filters.update(
        {name: DEFAULT_FILTERS[name] for name in ALLOWED_FILTERS}
    )
    return environment


def validate_template_statements(xml_parts: Iterable[str]) -> None:
    """Reject control statements outside the small document-template grammar."""

    for xml in xml_parts:
        for statement in _STATEMENT_PATTERN.findall(xml):
            plain_statement = html.unescape(_XML_TAG_PATTERN.sub("", statement)).strip()
            tag = plain_statement.split(None, 1)[0].lower() if plain_statement else ""
            # docxtpl supports paragraph/row/cell/run prefixes, e.g. ``{%tr for ...%}``.
            if tag in {"p", "tr", "tc", "r"}:
                remainder = plain_statement[len(tag):].strip()
                tag = remainder.split(None, 1)[0].lower() if remainder else ""
            if tag not in ALLOWED_STATEMENT_TAGS:
                raise ValueError(
                    f"Mẫu Word chứa thẻ điều khiển không được hỗ trợ: {tag or 'trống'}."
                )


def validate_docx_template_statements(content: bytes) -> None:
    """Validate Jinja statement tags in all Word XML parts of a DOCX archive."""

    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        xml_parts = (
            archive.read(name).decode("utf-8", errors="strict")
            for name in archive.namelist()
            if name.startswith("word/") and name.lower().endswith(".xml")
        )
        try:
            validate_template_statements(xml_parts)
        except UnicodeDecodeError as exc:
            raise ValueError("Mẫu Word chứa XML không đúng mã hóa UTF-8.") from exc
