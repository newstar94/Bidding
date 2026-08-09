"""Generate the browser-safe schema name maps from the backend contract."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.db.schema import SCHEMA_DINH_NGHIA
from backend.documents.schema_contract import CLIENT_TABLE_MAP, json_key_for_column


TARGET = ROOT / "frontend" / "documents" / "schemaRuntime.js"


def build_runtime_schema():
    field_map_by_table = {}
    common_candidates = {}
    conflicting_columns = set()
    runtime_tables = set(CLIENT_TABLE_MAP.values())
    for table_name, table_spec in sorted(SCHEMA_DINH_NGHIA.items()):
        if table_name not in runtime_tables:
            continue
        table_map = {
            column: json_key_for_column(table_name, column)
            for column in sorted(table_spec.get("columns", {}))
        }
        field_map_by_table[table_name] = table_map
        for column, json_key in table_map.items():
            previous = common_candidates.get(column)
            if previous is not None and previous != json_key:
                conflicting_columns.add(column)
            else:
                common_candidates[column] = json_key
    common_field_map = {
        column: json_key
        for column, json_key in sorted(common_candidates.items())
        if column not in conflicting_columns
    }
    return {
        "clientTableMap": dict(sorted(CLIENT_TABLE_MAP.items())),
        "commonFieldMap": common_field_map,
        "fieldMapByTable": field_map_by_table,
    }


def render_runtime_schema():
    payload = json.dumps(build_runtime_schema(), ensure_ascii=False, indent=2)
    return (
        "/* Generated runtime-only schema maps. Do not edit by hand. */\n"
        f"const RUNTIME_SCHEMA = {payload};\n\n"
        "export const CLIENT_TABLE_MAP = RUNTIME_SCHEMA.clientTableMap;\n"
        "export const COMMON_FIELD_NAME_OVERRIDES = RUNTIME_SCHEMA.commonFieldMap;\n"
        "export const FIELD_MAP_BY_TABLE = RUNTIME_SCHEMA.fieldMapByTable;\n"
        "export const resolveSchemaTable = (type) => CLIENT_TABLE_MAP[type] || type;\n"
    )


def write_runtime_schema(target=TARGET):
    target.write_text(
        render_runtime_schema(),
        encoding="utf-8",
    )


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Generate the browser-safe schema runtime contract.",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail when the committed runtime differs from the backend schema",
    )
    args = parser.parse_args(argv)
    if args.check:
        current = TARGET.read_text(encoding="utf-8") if TARGET.exists() else ""
        if current != render_runtime_schema():
            print(
                "Generated schema runtime is stale; run "
                "`python scripts/generate_schema_runtime.py`.",
                file=sys.stderr,
            )
            return 1
        return 0
    write_runtime_schema()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
