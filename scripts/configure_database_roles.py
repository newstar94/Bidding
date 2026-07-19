"""Create and grant least-privilege PostgreSQL migrator/runtime roles."""

from __future__ import annotations

import os
from pathlib import Path
import re
import sys

import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.shared.date_utils import VIETNAM_TIMEZONE_NAME


def _load_env() -> None:
    path = ROOT / ".env"
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _role_name(name: str, default: str) -> str:
    value = os.environ.get(name, default).strip()
    if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", value):
        raise RuntimeError(f"Invalid PostgreSQL role name in {name}.")
    return value


def _ensure_login_role(cursor, role: str, password: str) -> None:
    if len(password) < 16:
        raise RuntimeError(f"Password for PostgreSQL role {role} is too short.")
    exists = cursor.execute(
        "SELECT 1 FROM pg_roles WHERE rolname = %s", (role,)
    ).fetchone()
    if exists:
        cursor.execute(
            sql.SQL("ALTER ROLE {} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD {}").format(
                sql.Identifier(role), sql.Literal(password)
            )
        )
    else:
        cursor.execute(
            sql.SQL("CREATE ROLE {} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD {}").format(
                sql.Identifier(role), sql.Literal(password)
            )
        )


def main() -> int:
    _load_env()
    admin_url = os.environ.get("DATABASE_ADMIN_URL") or os.environ.get("DATABASE_URL", "")
    runtime_role = _role_name("DATABASE_RUNTIME_ROLE", "biddingflow_app")
    migrator_role = _role_name("DATABASE_MIGRATOR_ROLE", "biddingflow_migrator")
    runtime_password = os.environ.get("DATABASE_RUNTIME_PASSWORD", "")
    migrator_password = os.environ.get("DATABASE_MIGRATOR_PASSWORD", "")
    if runtime_role == migrator_role:
        raise RuntimeError("Runtime and migrator roles must be different.")

    from backend.db.schema import SCHEMA_DINH_NGHIA

    with psycopg.connect(admin_url, autocommit=True) as connection:
        cursor = connection.cursor()
        _ensure_login_role(cursor, runtime_role, runtime_password)
        _ensure_login_role(cursor, migrator_role, migrator_password)
        database_name = cursor.execute("SELECT current_database()").fetchone()[0]
        cursor.execute(
            sql.SQL("ALTER DATABASE {} SET timezone TO {}").format(
                sql.Identifier(database_name), sql.Literal(VIETNAM_TIMEZONE_NAME)
            )
        )
        cursor.execute("REVOKE CREATE ON SCHEMA public FROM PUBLIC")
        cursor.execute(
            sql.SQL("REVOKE CREATE, TEMP ON DATABASE {} FROM PUBLIC").format(
                sql.Identifier(database_name)
            )
        )
        cursor.execute(
            sql.SQL("REVOKE ALL PRIVILEGES ON DATABASE {} FROM {}").format(
                sql.Identifier(database_name), sql.Identifier(runtime_role)
            )
        )
        cursor.execute(
            sql.SQL("REVOKE ALL PRIVILEGES ON SCHEMA public FROM {}").format(
                sql.Identifier(runtime_role)
            )
        )
        cursor.execute(
            sql.SQL("GRANT CONNECT ON DATABASE {} TO {}, {}").format(
                sql.Identifier(database_name),
                sql.Identifier(runtime_role),
                sql.Identifier(migrator_role),
            )
        )
        cursor.execute(
            sql.SQL("GRANT CREATE ON DATABASE {} TO {}").format(
                sql.Identifier(database_name), sql.Identifier(migrator_role)
            )
        )
        cursor.execute(
            sql.SQL("GRANT USAGE ON SCHEMA public TO {}, {}").format(
                sql.Identifier(runtime_role), sql.Identifier(migrator_role)
            )
        )
        cursor.execute(
            sql.SQL("GRANT CREATE ON SCHEMA public TO {}").format(
                sql.Identifier(migrator_role)
            )
        )
        cursor.execute(
            sql.SQL("ALTER ROLE {} IN DATABASE {} SET search_path TO public").format(
                sql.Identifier(runtime_role), sql.Identifier(database_name)
            )
        )

        existing_tables = {
            row[0]
            for row in cursor.execute(
                """SELECT table_name FROM information_schema.tables
                   WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"""
            ).fetchall()
        }
        for table_name in sorted(set(SCHEMA_DINH_NGHIA) & existing_tables):
            cursor.execute(
                sql.SQL("ALTER TABLE public.{} OWNER TO {}").format(
                    sql.Identifier(table_name), sql.Identifier(migrator_role)
                )
            )
        sequences = cursor.execute(
            "SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public'"
        ).fetchall()
        for (sequence_name,) in sequences:
            cursor.execute(
                sql.SQL("ALTER SEQUENCE public.{} OWNER TO {}").format(
                    sql.Identifier(sequence_name), sql.Identifier(migrator_role)
                )
            )
        functions = cursor.execute(
            """SELECT p.oid::regprocedure::text
               FROM pg_proc p
               JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND p.proname LIKE 'bf_%'
                 AND NOT EXISTS (
                   SELECT 1 FROM pg_depend d
                   WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid
                     AND d.deptype = 'e'
                 )"""
        ).fetchall()
        for (function_signature,) in functions:
            cursor.execute(
                sql.SQL("ALTER FUNCTION {} OWNER TO {}").format(
                    sql.SQL(function_signature), sql.Identifier(migrator_role)
                )
            )

        cursor.execute(
            sql.SQL("REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM {}").format(
                sql.Identifier(runtime_role)
            )
        )
        cursor.execute(
            sql.SQL("REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM {}").format(
                sql.Identifier(runtime_role)
            )
        )
        cursor.execute(
            "REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC"
        )
        cursor.execute(
            sql.SQL("REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM {}").format(
                sql.Identifier(runtime_role)
            )
        )
        cursor.execute(
            sql.SQL("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {}").format(
                sql.Identifier(runtime_role)
            )
        )
        cursor.execute(
            sql.SQL("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO {}").format(
                sql.Identifier(runtime_role)
            )
        )
        cursor.execute(
            sql.SQL("GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO {}").format(
                sql.Identifier(runtime_role)
            )
        )
        cursor.execute(
            sql.SQL("ALTER DEFAULT PRIVILEGES FOR ROLE {} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {}").format(
                sql.Identifier(migrator_role), sql.Identifier(runtime_role)
            )
        )
        cursor.execute(
            sql.SQL("ALTER DEFAULT PRIVILEGES FOR ROLE {} IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO {}").format(
                sql.Identifier(migrator_role), sql.Identifier(runtime_role)
            )
        )
        cursor.execute(
            sql.SQL("ALTER DEFAULT PRIVILEGES FOR ROLE {} IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC").format(
                sql.Identifier(migrator_role)
            )
        )
        cursor.execute(
            sql.SQL("ALTER DEFAULT PRIVILEGES FOR ROLE {} IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO {}").format(
                sql.Identifier(migrator_role), sql.Identifier(runtime_role)
            )
        )
        memberships = cursor.execute(
            """
            SELECT parent.rolname
            FROM pg_auth_members AS memberships
            JOIN pg_roles AS parent ON parent.oid = memberships.roleid
            JOIN pg_roles AS member ON member.oid = memberships.member
            WHERE member.rolname = %s
            ORDER BY parent.rolname
            """,
            (runtime_role,),
        ).fetchall()
        if memberships:
            raise RuntimeError(
                "Runtime role inherits other PostgreSQL roles; revoke memberships first: "
                + ", ".join(row[0] for row in memberships)
            )
    print("PostgreSQL migrator/runtime roles configured successfully.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
