"""Generate the immutable PostgreSQL v1 migration-chain schema fixture."""

from __future__ import annotations

import argparse
import ast
from hashlib import sha256
import json
from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]
SOURCE_COMMIT = "1fe7dd42"
SOURCE_PATH = "backend/db/schema.py"
POSTGRES_SOURCE_PATH = "backend/db/postgres_schema.py"
OUTPUT = ROOT / "tests" / "fixtures" / "postgres_schema_v1.json"
DDL_KEYS = ("columns", "primary_keys", "unique_constraints", "foreign_keys")
CATALOG_BUILDERS = frozenset({
    "_create_indexes",
    "_create_search_indexes",
    "_create_trigger_functions",
    "_create_triggers",
})


def _historical_source(path: str) -> str:
    completed = subprocess.run(
        ("git", "show", f"{SOURCE_COMMIT}:{path}"),
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return completed.stdout


class _StatementRecorder:
    def __init__(self):
        self.statements: list[str] = []

    def execute(self, statement, parameters=None):
        if parameters is not None:
            raise RuntimeError("Historical catalog DDL unexpectedly uses parameters.")
        self.statements.append(str(statement).strip())
        return self


def _historical_catalog_sql(source: str, historical_tables: dict) -> dict[str, list[str]]:
    tree = ast.parse(source, filename=f"{SOURCE_COMMIT}:{POSTGRES_SOURCE_PATH}")
    selected = [
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name in CATALOG_BUILDERS
    ]
    selected_names = {node.name for node in selected}
    if selected_names != CATALOG_BUILDERS:
        missing = ", ".join(sorted(CATALOG_BUILDERS - selected_names))
        raise RuntimeError(f"Historical PostgreSQL catalog builders are missing: {missing}")
    namespace = {"SCHEMA_DINH_NGHIA": historical_tables}
    module = ast.Module(body=selected, type_ignores=[])
    exec(compile(module, f"{SOURCE_COMMIT}:{POSTGRES_SOURCE_PATH}", "exec"), namespace)  # noqa: S102 -- immutable reviewed repository source

    indexes = _StatementRecorder()
    triggers = _StatementRecorder()
    namespace["_create_indexes"](indexes)
    namespace["_create_triggers"](triggers)
    return {
        "indexes": indexes.statements,
        "triggers": triggers.statements,
    }


def build_fixture() -> dict[str, object]:
    source = _historical_source(SOURCE_PATH)
    postgres_source = _historical_source(POSTGRES_SOURCE_PATH)
    namespace: dict[str, object] = {}
    exec(compile(source, f"{SOURCE_COMMIT}:{SOURCE_PATH}", "exec"), namespace)  # noqa: S102 -- immutable reviewed repository source
    historical_tables = namespace.get("SCHEMA_DINH_NGHIA")
    if not isinstance(historical_tables, dict) or len(historical_tables) != 48:
        raise RuntimeError("Unexpected PostgreSQL v1 schema source.")
    tables = {
        str(table_name): {
            key: value
            for key in DDL_KEYS
            if (value := table_spec.get(key)) is not None
        }
        for table_name, table_spec in historical_tables.items()
    }
    return {
        "fixtureVersion": 1,
        "schemaVersion": 1,
        "sourceCommit": SOURCE_COMMIT,
        "sourcePath": SOURCE_PATH,
        "sourceBlobSha256": sha256(source.encode("utf-8")).hexdigest(),
        "postgresSourcePath": POSTGRES_SOURCE_PATH,
        "postgresSourceBlobSha256": sha256(
            postgres_source.encode("utf-8")
        ).hexdigest(),
        "catalogSql": _historical_catalog_sql(
            postgres_source,
            historical_tables,
        ),
        "tables": tables,
    }


def render_fixture() -> str:
    return json.dumps(
        build_fixture(),
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    ) + "\n"


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--write", action="store_true")
    action.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)

    rendered = render_fixture()
    if args.write:
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(rendered, encoding="utf-8", newline="\n")
        print(f"Generated PostgreSQL v1 fixture ({len(build_fixture()['tables'])} tables).")
        return 0
    if not OUTPUT.is_file() or OUTPUT.read_text(encoding="utf-8") != rendered:
        raise RuntimeError("PostgreSQL v1 migration fixture is stale.")
    print("PostgreSQL v1 migration fixture matches its historical source.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
