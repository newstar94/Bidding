"""Bounded traversal and exact identifier rules for browser artifacts."""

from __future__ import annotations

from backend.procurement_import.domain import normalize_procurement_code
from backend.procurement_lookup.domain import ProcurementLookupError


def walk_artifact(
    value,
    *,
    max_depth=7,
    max_objects=2000,
    max_array_items=200,
):
    """Yield bounded container nodes without trusting an upstream shape."""

    pending = [(value, 0)]
    seen = set()
    visited = 0
    while pending:
        current, depth = pending.pop()
        if depth > max_depth or not isinstance(current, (dict, list)):
            continue
        marker = id(current)
        if marker in seen:
            continue
        seen.add(marker)
        visited += 1
        if visited > max_objects:
            raise ProcurementLookupError("PROCUREMENT_SCHEMA_CHANGED")
        yield current
        children = (
            current.values()
            if isinstance(current, dict)
            else current[:max_array_items]
        )
        pending.extend((item, depth + 1) for item in children)


def artifact_objects(value, **bounds):
    return (
        node for node in walk_artifact(value, **bounds)
        if isinstance(node, dict)
    )


def artifact_arrays(value, **bounds):
    return (
        node for node in walk_artifact(value, **bounds)
        if isinstance(node, list)
    )


def same_procurement_family(actual, expected):
    """Accept only the same canonical PL/IB family and optional revision."""

    try:
        return (
            normalize_procurement_code(actual).base_code
            == normalize_procurement_code(expected).base_code
        )
    except ValueError:
        return False
