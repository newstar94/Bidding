"""Import record limits and bounded worksheet materialization."""

import os


def max_import_records():
    try:
        value = int(os.environ.get("EXCEL_MAX_IMPORT_ROWS", "10000"))
    except (TypeError, ValueError):
        value = 10000
    return min(100_000, max(100, value))


def worksheet_limits(max_records):
    # Either axis can contain the records for horizontal/vertical workbooks.
    # Allow header/auxiliary fields while bounding the rectangular allocation,
    # rather than counting only the few physically present XML cells.
    axis = max(256, max_records + 1)
    return {
        "max_rows": min(1_048_576, axis),
        "max_columns": min(16_384, axis),
        "max_cells": min(8_000_000, max_records * 128 + 128),
    }
