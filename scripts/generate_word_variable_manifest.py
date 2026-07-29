"""Synchronize frontend Word-variable metadata with backend defaults."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.documents.field_manifest import (  # noqa: E402
    build_field_manifest,
    field_label,
)
from backend.documents.schema_contract import json_key_for_column  # noqa: E402
from backend.documents.word_defaults import (  # noqa: E402
    WORD_SINGLE_SOURCES,
    build_default_word_mappings,
)


MANIFEST_PATH = ROOT / "frontend" / "documents" / "wordVariableManifest.js"


def build_frontend_field_metadata():
    mappings = build_default_word_mappings()
    manifest = build_field_manifest(json_key_for_column, mappings)
    result = {}
    for table_name in WORD_SINGLE_SOURCES:
        fields = manifest["tables"].get(table_name, {}).get("fields", {})
        visible_fields = {
            column: metadata
            for column, metadata in fields.items()
            if metadata.get("wordVariable")
        }
        if visible_fields:
            result[table_name] = visible_fields
    return result


def build_frontend_defaults():
    result = []
    for mapping in build_default_word_mappings():
        source_table = mapping["source_table"]
        source_column = mapping["source_column"]
        label = (
            field_label(source_column, source_table)
            if source_column
            else mapping["mo_ta"]
        )
        result.append(
            {
                "format": mapping.get("format", "text"),
                "label": label,
                "name": mapping["ten_bien"],
                "sourceColumn": source_column,
                "sourceTable": source_table,
            }
        )
    return result


def render_manifest(source):
    field_metadata = json.dumps(
        build_frontend_field_metadata(),
        ensure_ascii=False,
        indent=2,
    )
    metadata_replacement = f"export const FIELD_METADATA_BY_TABLE = {field_metadata};\n\n"
    updated, metadata_count = re.subn(
        r"export const FIELD_METADATA_BY_TABLE = \{.*?\};\s*"
        r"(?=export const WORD_SOURCE_TABLE_LABELS)",
        lambda _: metadata_replacement,
        source,
        flags=re.DOTALL,
    )
    defaults = json.dumps(
        build_frontend_defaults(),
        ensure_ascii=False,
        indent=2,
    )
    defaults_replacement = f"export const DEFAULT_WORD_VARIABLES = {defaults};\n"
    updated, defaults_count = re.subn(
        r"export const DEFAULT_WORD_VARIABLES = \[.*?\];\s*$",
        lambda _: defaults_replacement,
        updated,
        flags=re.DOTALL,
    )
    if metadata_count != 1 or defaults_count != 1:
        raise RuntimeError("Could not locate generated sections in Word manifest.")
    return updated


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail when the committed frontend manifest is stale",
    )
    args = parser.parse_args()
    source = MANIFEST_PATH.read_text(encoding="utf-8")
    updated = render_manifest(source)
    if args.check:
        if updated != source:
            raise SystemExit(
                "Word-variable manifest is stale; run "
                "python scripts/generate_word_variable_manifest.py"
            )
        print("Word-variable manifest is synchronized.")
        return
    MANIFEST_PATH.write_text(updated, encoding="utf-8")


if __name__ == "__main__":
    main()
