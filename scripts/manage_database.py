"""Initialize or upgrade the configured PostgreSQL schema.

Run this command once per release with a dedicated migrator credential before
starting application workers.  The runtime ``DATABASE_URL`` should belong to a
role without DDL privileges and production should set
``DATABASE_AUTO_MIGRATE=false``.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.env_utils import load_env


def _read_upgrade_preflight(database) -> dict[str, object]:
    from backend.db.upgrade_preflight import inspect_database_upgrade
    from backend.db.upgrades import read_database_version

    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        current_version = read_database_version(cursor)
        return inspect_database_upgrade(cursor, current_version)
    finally:
        connection.rollback()
        connection.close()


def main(argv=None) -> int:
    load_env(ROOT)
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group()
    action.add_argument(
        "--preflight",
        action="store_true",
        help="Print read-only upgrade cardinality and risk metadata.",
    )
    action.add_argument(
        "--dry-run",
        action="store_true",
        help="Apply and verify migrations in one transaction, then roll it back.",
    )
    args = parser.parse_args(argv)

    from backend.db.db_helper import PostgresDatabase
    from backend.db.postgres_schema import initialize_postgres_database

    database_url = os.environ.get("MIGRATOR_DATABASE_URL") or os.environ.get(
        "DATABASE_URL"
    )
    database = PostgresDatabase(database_url)
    try:
        if args.preflight:
            report = _read_upgrade_preflight(database)
            print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
            return 0
        if args.dry_run:
            report = _read_upgrade_preflight(database)
            print(
                "Database upgrade preflight:\n"
                + json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True)
            )
            version = initialize_postgres_database(database, dry_run=True)
            print(
                "PostgreSQL schema dry-run completed and rolled back "
                f"successfully (target version {version})."
            )
            return 0
        version = initialize_postgres_database(database)
    finally:
        database.close()
    print(f"PostgreSQL schema initialized successfully (version {version}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
