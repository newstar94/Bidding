"""Restricted Jinja environment and template policy for DOCX rendering."""

from __future__ import annotations

import html
import io
import re
import zipfile
from collections.abc import Iterable

from jinja2 import StrictUndefined
from jinja2 import nodes
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
_EXPRESSION_PATTERN = re.compile(r"{{\s*(.*?)\s*}}", re.DOTALL)
_XML_TAG_PATTERN = re.compile(r"<[^>]+>")

_FORBIDDEN_EXPRESSION_NODES = (
    nodes.Add,
    nodes.Assign,
    nodes.AssignBlock,
    nodes.Block,
    nodes.Call,
    nodes.CallBlock,
    nodes.Concat,
    nodes.Div,
    nodes.EnvironmentAttribute,
    nodes.ExprStmt,
    nodes.Extends,
    nodes.FilterBlock,
    nodes.FloorDiv,
    nodes.FromImport,
    nodes.Import,
    nodes.Include,
    nodes.InternalName,
    nodes.Macro,
    nodes.MarkSafe,
    nodes.MarkSafeIfAutoescape,
    nodes.Mod,
    nodes.Mul,
    nodes.OverlayScope,
    nodes.Pow,
    nodes.Scope,
    nodes.Sub,
    nodes.With,
)


def _validate_expression_source(expression: str) -> None:
    if not expression:
        raise ValueError("Mẫu Word chứa biểu thức trống.")
    try:
        parsed = create_template_environment().parse("{{ " + expression + " }}")
    except Exception as exc:
        raise ValueError("Mẫu Word chứa biểu thức không hợp lệ.") from exc

    for node in parsed.find_all(nodes.Node):
        if isinstance(node, _FORBIDDEN_EXPRESSION_NODES):
            raise ValueError(
                "Mẫu Word chỉ hỗ trợ placeholder, bộ lọc cho phép, "
                "vòng lặp và điều kiện đơn giản."
            )
        if isinstance(node, nodes.Filter) and node.name not in ALLOWED_FILTERS:
            raise ValueError(
                f"Mẫu Word chứa bộ lọc không được hỗ trợ: {node.name}."
            )
        if isinstance(node, nodes.Getattr) and node.attr.startswith("_"):
            raise ValueError("Mẫu Word không được truy cập thuộc tính riêng tư.")
        if isinstance(node, nodes.Getitem):
            argument = node.arg
            if not isinstance(argument, nodes.Const) or not isinstance(
                argument.value, (str, int)
            ):
                raise ValueError(
                    "Mẫu Word chỉ hỗ trợ chỉ mục cố định trong placeholder."
                )
            if isinstance(argument.value, str) and argument.value.startswith("_"):
                raise ValueError("Mẫu Word không được truy cập khóa dữ liệu riêng tư.")


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
    """Reject content outside the small placeholder/loop/condition grammar.

    Business templates need row loops and simple conditions, so the accepted
    language is intentionally a little wider than plain placeholders. Function
    calls, assignments, imports, macros and arithmetic are rejected before the
    document reaches docxtpl/Jinja.
    """

    for xml in xml_parts:
        for statement in _STATEMENT_PATTERN.findall(xml):
            plain_statement = html.unescape(_XML_TAG_PATTERN.sub("", statement)).strip()
            tag = plain_statement.split(None, 1)[0].lower() if plain_statement else ""
            # docxtpl supports paragraph/row/cell/run prefixes, e.g. ``{%tr for ...%}``.
            if tag in {"p", "tr", "tc", "r"}:
                remainder = plain_statement[len(tag):].strip()
                plain_statement = remainder
                tag = remainder.split(None, 1)[0].lower() if remainder else ""
            if tag not in ALLOWED_STATEMENT_TAGS:
                raise ValueError(
                    f"Mẫu Word chứa thẻ điều khiển không được hỗ trợ: {tag or 'trống'}."
                )
            remainder = plain_statement[len(tag):].strip()
            if tag == "for":
                match = re.fullmatch(
                    r"([A-Za-z][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z][A-Za-z0-9_]*)*)"
                    r"\s+in\s+(.+)",
                    remainder,
                    flags=re.DOTALL,
                )
                if not match:
                    raise ValueError("Mẫu Word chứa vòng lặp không hợp lệ.")
                _validate_expression_source(match.group(2).strip())
            elif tag in {"if", "elif"}:
                _validate_expression_source(remainder)
            elif remainder:
                raise ValueError(
                    f"Thẻ {tag} trong mẫu Word không được chứa biểu thức."
                )

        for expression in _EXPRESSION_PATTERN.findall(xml):
            plain_expression = html.unescape(
                _XML_TAG_PATTERN.sub("", expression)
            ).strip()
            _validate_expression_source(plain_expression)


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
