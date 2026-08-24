"""Closed, versioned registry for bulk operations."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class BulkAction:
    key: str
    version: str
    target_types: frozenset[str]
    max_size: int
    execution: str
    side_effect_boundary: str


EXPORT_RECORD_DATA = BulkAction(
    key="EXPORT_RECORD_DATA", version="export-record-data-v1",
    target_types=frozenset({"kehoach", "goithau"}), max_size=100,
    execution="STAGED_FINALIZE", side_effect_boundary="FILESYSTEM",
)
REGISTRY = {EXPORT_RECORD_DATA.key: EXPORT_RECORD_DATA}


def resolve_action(key):
    return REGISTRY.get(str(key or "").strip())

