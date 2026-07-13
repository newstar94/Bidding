import json
import pathlib
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from helpers_py.schema_contract import build_schema_contract
from helpers_py.word_defaults import build_default_word_mappings


def main():
    contract = build_schema_contract(build_default_word_mappings())
    output = ROOT / "models" / "schemaContract.js"
    payload = json.dumps(contract, ensure_ascii=True, indent=2, sort_keys=True)
    output.write_text(
        "/* Generated from backend field/schema manifests. Do not edit by hand. */\n"
        f"export const SCHEMA_CONTRACT = {payload};\n\n"
        "export const CLIENT_TABLE_MAP = SCHEMA_CONTRACT.clientTableMap;\n"
        "export const COMMON_FIELD_NAME_OVERRIDES = SCHEMA_CONTRACT.commonFieldMap;\n"
        "export const FIELD_MAP_BY_TABLE = Object.fromEntries(\n"
        "  Object.entries(SCHEMA_CONTRACT.tables).map(([table, spec]) => [table, spec.fieldMap || {}])\n"
        ");\n\n"
        "export const FIELD_MANIFEST = SCHEMA_CONTRACT.fieldManifest;\n"
        "export const FIELD_METADATA_BY_TABLE = Object.fromEntries(\n"
        "  Object.entries(FIELD_MANIFEST.tables).map(([table, spec]) => [table, spec.fields || {}])\n"
        ");\n\n"
        "export const DEFAULT_WORD_VARIABLES = Object.entries(FIELD_METADATA_BY_TABLE).flatMap(\n"
        "  ([sourceTable, fields]) => Object.values(fields)\n"
        "    .filter((field) => field.wordVariable)\n"
        "    .map((field) => ({\n"
        "      name: field.wordVariable, sourceTable, sourceColumn: field.column,\n"
        "      label: field.label, format: field.format\n"
        "    }))\n"
        ");\n\n"
        "export const resolveSchemaTable = (type) => CLIENT_TABLE_MAP[type] || type;\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
