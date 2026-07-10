import json
import pathlib
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from helpers_py.schema_contract import build_schema_contract  # noqa: E402


def main():
    contract = build_schema_contract()
    output = ROOT / "models" / "schemaContract.js"
    payload = json.dumps(contract, ensure_ascii=True, indent=2, sort_keys=True)
    output.write_text(
        "/* Generated from backend/helpers_py/schema.py. Do not edit by hand. */\n"
        f"export const SCHEMA_CONTRACT = {payload};\n\n"
        "export const CLIENT_TABLE_MAP = SCHEMA_CONTRACT.clientTableMap;\n"
        "export const COMMON_FIELD_NAME_OVERRIDES = SCHEMA_CONTRACT.commonFieldMap;\n"
        "export const FIELD_MAP_BY_TABLE = Object.fromEntries(\n"
        "  Object.entries(SCHEMA_CONTRACT.tables).map(([table, spec]) => [table, spec.fieldMap || {}])\n"
        ");\n\n"
        "export const resolveSchemaTable = (type) => CLIENT_TABLE_MAP[type] || type;\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
