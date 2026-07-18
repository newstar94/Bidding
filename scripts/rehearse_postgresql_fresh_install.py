"""Rehearse a fresh PostgreSQL install and clean rollback/recreate cycle."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import time
import uuid
from urllib.parse import quote, urlsplit, urlunsplit

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.db.postgresql import PostgreSQLDatabase
from backend.db.postgresql_migrations import initialize_postgresql_database
from backend.startup import verify_database_readiness, verify_database_responsive
from scripts.provision_postgresql_roles import provision_roles


SCRATCH_PREFIX = "bidding_rehearsal_"


def _database_url(base_url, database_name, *, username=None, password=None):
    parsed = urlsplit(base_url)
    host = parsed.hostname or ""
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    port = f":{parsed.port}" if parsed.port else ""
    if username is None:
        user_info = ""
        if parsed.username:
            user_info = quote(parsed.username, safe="")
            if parsed.password is not None:
                user_info += f":{quote(parsed.password, safe='')}"
            user_info += "@"
    else:
        user_info = quote(username, safe="")
        if password is not None:
            user_info += f":{quote(password, safe='')}"
        user_info += "@"
    return urlunsplit(
        (
            parsed.scheme,
            f"{user_info}{host}{port}",
            f"/{database_name}",
            parsed.query,
            parsed.fragment,
        )
    )


def _create_database(admin_url, database_name):
    import psycopg
    from psycopg import sql

    with psycopg.connect(_database_url(admin_url, "postgres"), autocommit=True) as connection:
        connection.execute(
            sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database_name))
        )


def _drop_database_and_roles(admin_url, database_name, roles):
    import psycopg
    from psycopg import sql

    maintenance_url = _database_url(admin_url, "postgres")
    with psycopg.connect(maintenance_url, autocommit=True) as connection:
        connection.execute(
            sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(
                sql.Identifier(database_name)
            )
        )
        monitor = roles["monitor"]
        if connection.execute(
            "SELECT 1 FROM pg_roles WHERE rolname = %s", (monitor,)
        ).fetchone():
            connection.execute(
                sql.SQL("REVOKE pg_read_all_data, pg_monitor FROM {}").format(
                    sql.Identifier(monitor)
                )
            )
        for role_name in (
            roles["application"],
            roles["monitor"],
            roles["migration"],
        ):
            connection.execute(
                sql.SQL("DROP ROLE IF EXISTS {}").format(
                    sql.Identifier(role_name)
                )
            )


def _install_once(admin_url, database_name, roles, passwords, require_verified_tls):
    target_admin_url = _database_url(admin_url, database_name)
    provision_roles(
        target_admin_url,
        roles,
        passwords,
        require_verified_tls=require_verified_tls,
        connection_limits={"migration": 2, "application": 7, "monitor": 3},
    )
    environment = {
        "ADMIN_PASSWORD": "Fresh-install-rehearsal-only-2026!",  # pragma: allowlist secret -- disposable scratch DB
        "ADMIN_USERNAME": "freshinstalladmin",
        "ADMIN_NAME": "Fresh Install Rehearsal",
        "ADMIN_EMAIL": "fresh-install@example.test",
        "DEFAULT_ORG_NAME": "Fresh Install Rehearsal",
        "POSTGRES_POOL_MIN_SIZE": "0",
        "POSTGRES_POOL_MAX_SIZE": "2",
    }
    migration_url = _database_url(
        admin_url,
        database_name,
        username=roles["migration"],
        password=passwords["migration"],
    )
    application_url = _database_url(
        admin_url,
        database_name,
        username=roles["application"],
        password=passwords["application"],
    )

    migration_database = PostgreSQLDatabase(migration_url, environ=environment)
    started = time.perf_counter()
    try:
        first_version = initialize_postgresql_database(
            migration_database, environment
        )
        second_version = initialize_postgresql_database(
            migration_database, environment
        )
    finally:
        migration_database.close()

    application_database = PostgreSQLDatabase(application_url, environ=environment)
    try:
        assert verify_database_readiness(application_database, first_version) is True
        verify_database_responsive(application_database, first_version)
        connection = application_database.get_connection()
        try:
            table_count = connection.execute(
                """
                SELECT count(*) FROM information_schema.tables
                WHERE table_schema = current_schema()
                """
            ).fetchone()[0]
            user_count = connection.execute("SELECT count(*) FROM tai_khoan").fetchone()[0]
            organization_count = connection.execute("SELECT count(*) FROM to_chuc").fetchone()[0]
            connection.execute(
                """
                INSERT INTO rate_limit_buckets (
                    bucket_key, window_started_at, attempt_count, expires_at
                ) VALUES (?, 1, 1, 4102444800)
                """,
                (f"fresh-install-{uuid.uuid4().hex}",),
            )
            connection.rollback()
            can_create = connection.execute(
                "SELECT has_schema_privilege(current_user, 'public', 'CREATE')"
            ).fetchone()[0]
        finally:
            connection.close()
    finally:
        application_database.close()
    if first_version != second_version:
        raise RuntimeError("PostgreSQL migration is not idempotent.")
    if can_create:
        raise RuntimeError("Application role unexpectedly has schema CREATE privilege.")
    return {
        "schemaVersion": first_version,
        "tableCount": int(table_count),
        "userCount": int(user_count),
        "organizationCount": int(organization_count),
        "applicationCanCreateSchemaObjects": bool(can_create),
        "durationSeconds": round(time.perf_counter() - started, 3),
    }


def run_rehearsal(admin_url, *, require_verified_tls=True):
    database_name = f"{SCRATCH_PREFIX}{uuid.uuid4().hex[:12]}"
    suffix = uuid.uuid4().hex[:8]
    roles = {
        "migration": f"bf_rehearse_m_{suffix}",
        "application": f"bf_rehearse_a_{suffix}",
        "monitor": f"bf_rehearse_o_{suffix}",
    }
    passwords = {
        "migration": f"Migration-{suffix}-rehearsal!",
        "application": f"Application-{suffix}-rehearsal!",
        "monitor": f"Monitor-{suffix}-rehearsal!",
    }
    initial = None
    rollback_recreate = None
    try:
        _create_database(admin_url, database_name)
        initial = _install_once(
            admin_url,
            database_name,
            roles,
            passwords,
            require_verified_tls,
        )
        import psycopg
        from psycopg import sql

        with psycopg.connect(
            _database_url(admin_url, "postgres"), autocommit=True
        ) as connection:
            connection.execute(
                sql.SQL("DROP DATABASE {} WITH (FORCE)").format(
                    sql.Identifier(database_name)
                )
            )
            connection.execute(
                sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database_name))
            )
        rollback_recreate = _install_once(
            admin_url,
            database_name,
            roles,
            passwords,
            require_verified_tls,
        )
        passed = initial == {
            **rollback_recreate,
            "durationSeconds": initial["durationSeconds"],
        }
        return {
            "mode": "fresh-install-no-legacy-data",
            "databaseNamePrefix": SCRATCH_PREFIX,
            "initialInstall": initial,
            "rollbackRecreate": rollback_recreate,
            "passed": passed,
            "secretsPrinted": False,
        }
    finally:
        _drop_database_and_roles(admin_url, database_name, roles)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--admin-url",
        default=os.environ.get("BIDDING_TEST_POSTGRESQL_URL", ""),
    )
    parser.add_argument("--allow-insecure-local", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not args.admin_url:
        parser.error("BIDDING_TEST_POSTGRESQL_URL or --admin-url is required")
    hostname = urlsplit(args.admin_url).hostname
    insecure_local = args.allow_insecure_local and hostname in {
        "127.0.0.1",
        "::1",
        "localhost",
    }
    if args.allow_insecure_local and not insecure_local:
        parser.error("--allow-insecure-local is restricted to loopback hosts")
    result = run_rehearsal(
        args.admin_url,
        require_verified_tls=not insecure_local,
    )
    rendered = json.dumps(result, ensure_ascii=False, indent=2)
    print(rendered)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    raise SystemExit(0 if result["passed"] else 1)


if __name__ == "__main__":
    main()
