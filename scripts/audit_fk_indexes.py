"""Fail when a PostgreSQL foreign key lacks a usable child-side index prefix."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

import psycopg

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.env_utils import load_env


def index_covers_foreign_key(index_attnums, foreign_key_attnums):
    foreign_key = tuple(int(value) for value in foreign_key_attnums)
    index = tuple(int(value) for value in index_attnums)
    return bool(foreign_key) and index[: len(foreign_key)] == foreign_key


def find_missing_foreign_key_indexes(connection):
    with connection.cursor() as cursor:
        foreign_keys = cursor.execute(
            """SELECT constraints.conrelid::regclass::text,
                      constraints.conname,
                      constraints.conkey
               FROM pg_constraint AS constraints
               JOIN pg_namespace AS namespaces
                 ON namespaces.oid = constraints.connamespace
               WHERE constraints.contype = 'f'
                 AND namespaces.nspname = current_schema()
               ORDER BY 1, 2"""
        ).fetchall()
        index_rows = cursor.execute(
            """SELECT indexes.indrelid::regclass::text,
                      index_classes.relname,
                      indexes.indkey::int2[],
                      indexes.indisvalid
               FROM pg_index AS indexes
               JOIN pg_class AS index_classes
                 ON index_classes.oid = indexes.indexrelid
               JOIN pg_namespace AS namespaces
                 ON namespaces.oid = index_classes.relnamespace
               WHERE namespaces.nspname = current_schema()
                 AND indexes.indisready"""
        ).fetchall()

    indexes_by_table = {}
    for table_name, index_name, attnums, is_valid in index_rows:
        indexes_by_table.setdefault(table_name, []).append(
            (index_name, tuple(attnums), bool(is_valid))
        )
    missing = []
    for table_name, constraint_name, attnums in foreign_keys:
        candidates = indexes_by_table.get(table_name, ())
        if not any(
            is_valid and index_covers_foreign_key(index_attnums, attnums)
            for _index_name, index_attnums, is_valid in candidates
        ):
            missing.append({"table": table_name, "constraint": constraint_name})
    return {"foreignKeyCount": len(foreign_keys), "missing": missing}


def main():
    load_env(ROOT)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL", ""))
    arguments = parser.parse_args()
    if not arguments.database_url:
        parser.error("DATABASE_URL is required")
    with psycopg.connect(arguments.database_url) as connection:
        result = find_missing_foreign_key_indexes(connection)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 1 if result["missing"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
