"""Guards for SQL identifiers that must be interpolated into statements.

Values always travel as bound parameters. Table/column names cannot, so any
identifier that reaches an f-string must be a plain lowercase identifier and,
where the caller knows the closed set, a member of an explicit allowlist.
"""

from __future__ import annotations

import re
from collections.abc import Collection

_IDENTIFIER = re.compile(r"[a-z_][a-z0-9_]{0,62}")


def sql_identifier(name: str, *, allowed: Collection[str] | None = None) -> str:
    """Return ``name`` unchanged when it is a safe identifier, else raise ValueError."""
    if not isinstance(name, str) or not _IDENTIFIER.fullmatch(name):
        raise ValueError(f"Unsafe SQL identifier: {name!r}")
    if allowed is not None and name not in allowed:
        raise ValueError(f"SQL identifier is not allowlisted: {name!r}")
    return name


def sql_alias(label: str) -> str:
    """Return a double-quoted output alias, rejecting quote/control characters."""
    if not isinstance(label, str) or not label or len(label) > 63:
        raise ValueError(f"Unsafe SQL alias: {label!r}")
    if any(character == '"' or ord(character) < 32 for character in label):
        raise ValueError(f"Unsafe SQL alias: {label!r}")
    return f'"{label}"'
