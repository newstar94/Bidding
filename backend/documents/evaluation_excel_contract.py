"""Server access to the shared bid-evaluation Excel column contract."""

from __future__ import annotations

from functools import lru_cache
import json
from pathlib import Path


_MANIFEST_PATH = (
    Path(__file__).resolve().parents[2]
    / "shared"
    / "bid_evaluation_excel_columns.json"
)


@lru_cache(maxsize=1)
def evaluation_excel_columns():
    """Return the versioned cross-runtime evaluation workbook contract."""

    manifest = json.loads(_MANIFEST_PATH.read_text(encoding="utf-8"))
    columns = manifest.get("columns")
    if not isinstance(columns, dict):
        raise ValueError("Bid evaluation Excel column contract is invalid.")
    return columns


def evaluation_excel_header(column_key):
    """Return the canonical export label for an evaluation workbook field."""

    column = evaluation_excel_columns().get(column_key)
    if not isinstance(column, dict) or not isinstance(column.get("canonical"), str):
        raise KeyError(f"Unknown evaluation Excel column: {column_key}")
    return column["canonical"]
