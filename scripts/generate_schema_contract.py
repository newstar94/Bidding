import json
import pathlib
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.documents.schema_contract import build_schema_contract
from backend.documents.word_defaults import build_default_word_mappings


def main():
    contract = build_schema_contract(build_default_word_mappings())
    runtime_table_names = set(contract["clientTableMap"].values())
    runtime_field_maps = {
        table: spec.get("fieldMap", {})
        for table, spec in contract["tables"].items()
        if table in runtime_table_names
    }
    runtime_columns = {
        column
        for field_map in runtime_field_maps.values()
        for column in field_map
    }
    runtime_contract = {
        "clientTableMap": contract["clientTableMap"],
        "commonFieldMap": {
            column: client_field
            for column, client_field in contract["commonFieldMap"].items()
            if column in runtime_columns
        },
        "fieldMapByTable": runtime_field_maps,
    }
    runtime_payload = json.dumps(runtime_contract, ensure_ascii=True, indent=2, sort_keys=True)
    runtime_output = ROOT / "frontend" / "documents" / "schemaRuntime.js"
    runtime_output.write_text(
        "/* Generated runtime-only schema maps. Do not edit by hand. */\n"
        f"const RUNTIME_SCHEMA = {runtime_payload};\n\n"
        "export const CLIENT_TABLE_MAP = RUNTIME_SCHEMA.clientTableMap;\n"
        "export const COMMON_FIELD_NAME_OVERRIDES = RUNTIME_SCHEMA.commonFieldMap;\n"
        "export const FIELD_MAP_BY_TABLE = RUNTIME_SCHEMA.fieldMapByTable;\n"
        "export const resolveSchemaTable = (type) => CLIENT_TABLE_MAP[type] || type;\n",
        encoding="utf-8",
    )

    field_tables = contract["fieldManifest"]["tables"]
    word_metadata = {
        table: {
            column: field for column, field in spec.get("fields", {}).items()
            if field.get("wordVariable")
        }
        for table, spec in field_tables.items()
    }
    word_metadata = {table: fields for table, fields in word_metadata.items() if fields}
    word_variables = [
        {
            "name": field["wordVariable"],
            "sourceTable": table,
            "sourceColumn": field["column"],
            "label": field.get("label"),
            "format": field.get("format"),
        }
        for table, fields in word_metadata.items()
        for field in fields.values()
    ]
    word_output = ROOT / "frontend" / "documents" / "wordVariableManifest.js"
    word_output.write_text(
        "/* Generated Word-variable manifest. Loaded only with Word integration. */\n"
        f"export const FIELD_METADATA_BY_TABLE = {json.dumps(word_metadata, ensure_ascii=True, indent=2, sort_keys=True)};\n\n"
        f"export const DEFAULT_WORD_VARIABLES = {json.dumps(word_variables, ensure_ascii=True, indent=2, sort_keys=True)};\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
