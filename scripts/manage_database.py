"""Initialize or upgrade the configured PostgreSQL schema.

Run this command once per release with a dedicated migrator credential before
starting application workers.  The runtime ``DATABASE_URL`` should belong to a
role without DDL privileges and production should set
``DATABASE_AUTO_MIGRATE=false``.
"""

from __future__ import annotations

import os
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.env_utils import load_env


def main() -> int:
    load_env(ROOT)
    from backend.db.db_helper import PostgresDatabase
    from backend.db.postgres_schema import initialize_postgres_database

    database_url = os.environ.get("MIGRATOR_DATABASE_URL") or os.environ.get(
        "DATABASE_URL"
    )
    database = PostgresDatabase(database_url)
    try:
        version = initialize_postgres_database(database)
    finally:
        database.close()
    print(f"PostgreSQL schema initialized successfully (version {version}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
