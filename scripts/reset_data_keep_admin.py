"""Delete application data while preserving super-admin accounts and packages.

This is a destructive operation. It keeps ``database_metadata``, the system
subscription catalogue (``goi_dich_vu``), and every account whose platform
role is ``super_admin``. All organizations, memberships, business records,
sessions, notifications, audit records and non-admin accounts are removed.

Usage:
    python scripts/reset_data_keep_admin.py --confirm-reset
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import sys

import psycopg
from psycopg import sql


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.env_utils import load_env


def main() -> int:
    load_env(ROOT)
    from backend.db.schema import SCHEMA_DINH_NGHIA

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirm-reset", action="store_true", help="Required because this permanently deletes data.")
    parser.add_argument("--allow-production", action="store_true", help="Allow running when APP_ENV=production.")
    args = parser.parse_args()
    if not args.confirm_reset:
        parser.error("Pass --confirm-reset to delete application data.")
    if os.environ.get("APP_ENV", "development").strip().lower() == "production" and not args.allow_production:
        parser.error("Refusing to reset production. Use --allow-production only if this is intentional.")

    database_url = str(os.environ.get("MIGRATOR_DATABASE_URL") or os.environ.get("DATABASE_URL") or "").strip()
    if not database_url:
        parser.error("DATABASE_URL or MIGRATOR_DATABASE_URL is required.")

    preserved_tables = {"database_metadata", "goi_dich_vu", "tai_khoan"}
    reset_tables = [name for name in SCHEMA_DINH_NGHIA if name not in preserved_tables]

    with psycopg.connect(database_url, autocommit=False, application_name="biddingflow-data-reset") as connection:
        with connection.cursor() as cursor:
            metadata = cursor.execute("SELECT schema_version FROM database_metadata WHERE id = 1").fetchone()
            if not metadata:
                raise RuntimeError("Database schema is not initialized.")
            admin_count = cursor.execute(
                "SELECT count(*) FROM tai_khoan WHERE vai_tro = 'super_admin'"
            ).fetchone()[0]
            if not admin_count:
                raise RuntimeError("No super_admin account found; refusing to run reset.")

            truncate_statement = sql.SQL("TRUNCATE TABLE {} RESTART IDENTITY CASCADE").format(
                sql.SQL(", ").join(sql.Identifier(table) for table in reset_tables)
            )
            cursor.execute(truncate_statement)
            deleted_users = cursor.execute(
                "DELETE FROM tai_khoan WHERE vai_tro <> 'super_admin'"
            ).rowcount
        connection.commit()

    print("Application data reset successfully.")
    print(f"  preserved super-admin accounts: {admin_count}")
    print(f"  deleted non-admin accounts: {deleted_users}")
    print("  preserved system service packages: yes")
    print("  organizations and all business data: deleted")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
