"""Generate the browser-safe schema name maps from the backend contract."""

from __future__ import annotations

import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.db.schema import SCHEMA_DINH_NGHIA
from backend.documents.schema_contract import CLIENT_TABLE_MAP, json_key_for_column


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


def main():
    target = ROOT / "frontend" / "documents" / "schemaRuntime.js"
    payload = json.dumps(build_runtime_schema(), ensure_ascii=False, indent=2)
    target.write_text(
        "/* Generated runtime-only schema maps. Do not edit by hand. */\n"
        f"const RUNTIME_SCHEMA = {payload};\n\n"
        "export const CLIENT_TABLE_MAP = RUNTIME_SCHEMA.clientTableMap;\n"
        "export const COMMON_FIELD_NAME_OVERRIDES = RUNTIME_SCHEMA.commonFieldMap;\n"
        "export const FIELD_MAP_BY_TABLE = RUNTIME_SCHEMA.fieldMapByTable;\n"
        "export const resolveSchemaTable = (type) => CLIENT_TABLE_MAP[type] || type;\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
