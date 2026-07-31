"""Bounded client projection for records returned during sync conflicts."""

from __future__ import annotations

from typing import Any


_BLOCKED_NORMALIZED_KEYS = frozenset({
    "accesstoken",
    "internalsecret",
    "matkhau",
    "password",
    "passwordhash",
    "privatekey",
    "refreshtoken",
    "requesthash",
    "secret",
    "sessiontoken",
    "token",
    "tokenhash",
})


def _normalized_key(value: object) -> str:
    return "".join(character for character in str(value or "").lower() if character.isalnum())


def project_conflict_record(record: dict[str, Any] | None) -> dict[str, Any]:
    """Keep business fields while excluding authentication/internal secret material.

    Callers pass an already schema-mapped record.  This final boundary is kept
    deliberately small so a future mapper field cannot accidentally turn a row
    conflict into a credential disclosure.
    """

    def project(value: Any) -> Any:
        if isinstance(value, dict):
            return {
                str(key): project(item)
                for key, item in value.items()
                if not str(key).startswith("_")
                and _normalized_key(key) not in _BLOCKED_NORMALIZED_KEYS
            }
        if isinstance(value, (list, tuple)):
            return [project(item) for item in value]
        return value

    return project(dict(record or {}))
