"""Generate or verify the normalized PostgreSQL 17 schema contract.

Run this only against a freshly initialized schema produced by
``scripts/manage_database.py``.  The generated JSON snapshot is shipped with
the production application and is the immutable startup reference catalog.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

import psycopg


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "backend" / "db" / "postgres_schema_contract.json"
sys.path.insert(0, str(ROOT))

from scripts.env_utils import load_env


def render_snapshot(catalog: dict[str, object]) -> str:
    return (
        json.dumps(
            catalog,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n"
    )


def _validate_generation_source(catalog: dict[str, object]) -> None:
    from backend.db.postgres_schema_contract import CATALOG_CONTRACT_VERSION
    from backend.db.schema import SCHEMA_DINH_NGHIA
    from backend.db.upgrades import DB_SCHEMA_VERSION

    if catalog.get("contractVersion") != CATALOG_CONTRACT_VERSION:
        raise RuntimeError("Unexpected normalized catalog contract version.")
    if catalog.get("postgresMajor") != 17:
        raise RuntimeError(
            "The committed schema contract must be generated with PostgreSQL 17."
        )
    if catalog.get("schemaVersion") != DB_SCHEMA_VERSION:
        raise RuntimeError(
            "Generation database is not at the current BiddingFlow schema version."
        )
    actual_tables = set(catalog.get("tables") or {})
    expected_tables = set(SCHEMA_DINH_NGHIA)
    if actual_tables != expected_tables:
        raise RuntimeError(
            "Generation database table set is not canonical: "
            f"missing={sorted(expected_tables - actual_tables)}, "
            f"unexpected={sorted(actual_tables - expected_tables)}"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument(
        "--write",
        action="store_true",
        help="Replace the generated snapshot from the configured fresh database.",
    )
    action.add_argument(
        "--check",
        action="store_true",
        help="Compare the configured database with the committed snapshot.",
    )
    args = parser.parse_args()

    load_env(ROOT)
    database_url = (
        os.environ.get("MIGRATOR_DATABASE_URL")
        or os.environ.get("DATABASE_URL")
        or ""
    ).strip()
    if not database_url:
        raise RuntimeError("MIGRATOR_DATABASE_URL or DATABASE_URL is required.")

    from backend.db.postgres_schema_contract import (
        assert_catalog_contract,
        load_expected_postgres_schema_catalog,
        read_postgres_schema_catalog,
    )

    with psycopg.connect(database_url, connect_timeout=10) as connection:
        with connection.cursor() as cursor:
            catalog = read_postgres_schema_catalog(cursor)
    _validate_generation_source(catalog)

    if args.write:
        OUTPUT.write_text(render_snapshot(catalog), encoding="utf-8", newline="\n")
        print(
            "Generated PostgreSQL schema contract "
            f"({len(catalog['tables'])} tables, "
            f"{len(catalog['indexes'])} indexes, "
            f"{len(catalog['triggers'])} triggers)."
        )
        return 0

    assert_catalog_contract(load_expected_postgres_schema_catalog(), catalog)
    print(
        "PostgreSQL normalized schema contract matches "
        f"({len(catalog['tables'])} tables, "
        f"{len(catalog['indexes'])} indexes, "
        f"{len(catalog['triggers'])} triggers)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
