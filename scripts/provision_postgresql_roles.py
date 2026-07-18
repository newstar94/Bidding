"""Provision least-privilege PostgreSQL roles for BiddingFlow.

Passwords are read from environment variables and are never printed. The admin
URL is an operator-only input and must not be configured in the application
runtime environment.
"""

from __future__ import annotations

import argparse
import os
import re
from urllib.parse import parse_qs, unquote, urlsplit


ROLE_NAME_PATTERN = re.compile(r"^[a-z][a-z0-9_]{2,62}$")
PASSWORD_ENVIRONMENTS = {
    "migration": "BIDDING_POSTGRES_MIGRATION_PASSWORD",
    "application": "BIDDING_POSTGRES_APP_PASSWORD",
    "monitor": "BIDDING_POSTGRES_MONITOR_PASSWORD",
}
DEFAULT_ROLES = {
    "migration": "bidding_migrator",
    "application": "bidding_app",
    "monitor": "bidding_backup_monitor",
}


def _validate_admin_url(admin_url, *, require_verified_tls=True):
    parsed = urlsplit(str(admin_url or "").strip())
    if parsed.scheme.casefold() not in {"postgres", "postgresql"}:
        raise ValueError("PostgreSQL admin URL is required.")
    database_name = unquote(parsed.path.lstrip("/")).strip()
    if not parsed.hostname or not database_name:
        raise ValueError("Admin URL must include host and target database.")
    sslmode = parse_qs(parsed.query).get("sslmode", [""])[-1].casefold()
    if require_verified_tls and sslmode != "verify-full":
        raise ValueError("Operator PostgreSQL connections require sslmode=verify-full.")
    return parsed, database_name


def _validate_roles(roles):
    normalized = {}
    for purpose in DEFAULT_ROLES:
        value = str(roles.get(purpose, "")).strip()
        if not ROLE_NAME_PATTERN.fullmatch(value):
            raise ValueError(f"Invalid PostgreSQL {purpose} role name.")
        normalized[purpose] = value
    if len(set(normalized.values())) != len(normalized):
        raise ValueError("Migration, application and monitoring roles must be distinct.")
    return normalized


def _ensure_login_role(connection, role_name, password, connection_limit):
    from psycopg import sql

    exists = connection.execute(
        "SELECT 1 FROM pg_roles WHERE rolname = %s", (role_name,)
    ).fetchone()
    identifier = sql.Identifier(role_name)
    password_literal = sql.Literal(password)
    if not exists:
        connection.execute(
            sql.SQL(
                "CREATE ROLE {} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE "
                "INHERIT NOBYPASSRLS CONNECTION LIMIT {} PASSWORD {}"
            ).format(identifier, sql.Literal(connection_limit), password_literal)
        )
    else:
        connection.execute(
            sql.SQL(
                "ALTER ROLE {} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE "
                "INHERIT NOBYPASSRLS CONNECTION LIMIT {} PASSWORD {}"
            ).format(identifier, sql.Literal(connection_limit), password_literal)
        )


def provision_roles(
    admin_url,
    roles,
    passwords,
    *,
    require_verified_tls=True,
    connection_limits=None,
):
    """Create or rotate BiddingFlow roles and grants in one transaction."""

    import psycopg
    from psycopg import sql

    _parsed, database_name = _validate_admin_url(
        admin_url, require_verified_tls=require_verified_tls
    )
    role_names = _validate_roles(roles)
    limits = {"migration": 2, "application": 50, "monitor": 5}
    limits.update(connection_limits or {})
    for purpose, limit in limits.items():
        if not isinstance(limit, int) or not 1 <= limit <= 500:
            raise ValueError(f"Invalid connection limit for {purpose} role.")
    for purpose in role_names:
        if not str(passwords.get(purpose, "")):
            raise ValueError(f"Password is required for the {purpose} role.")

    with psycopg.connect(admin_url) as connection:
        connection.execute("SELECT pg_advisory_xact_lock(4273312027)")
        for purpose, role_name in role_names.items():
            _ensure_login_role(
                connection,
                role_name,
                passwords[purpose],
                limits[purpose],
            )

        migration = sql.Identifier(role_names["migration"])
        application = sql.Identifier(role_names["application"])
        monitor = sql.Identifier(role_names["monitor"])
        database = sql.Identifier(database_name)

        connection.execute(sql.SQL("REVOKE CREATE ON SCHEMA public FROM PUBLIC"))
        connection.execute(sql.SQL("GRANT CONNECT, CREATE ON DATABASE {} TO {}").format(database, migration))
        connection.execute(sql.SQL("GRANT USAGE, CREATE ON SCHEMA public TO {}").format(migration))
        connection.execute(sql.SQL("GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO {}").format(migration))
        connection.execute(sql.SQL("GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO {}").format(migration))

        connection.execute(sql.SQL("GRANT CONNECT ON DATABASE {} TO {}, {}").format(database, application, monitor))
        connection.execute(sql.SQL("GRANT USAGE ON SCHEMA public TO {}, {}").format(application, monitor))
        connection.execute(sql.SQL("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {}").format(application))
        connection.execute(sql.SQL("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {}").format(application))
        connection.execute(sql.SQL("GRANT pg_read_all_data, pg_monitor TO {}").format(monitor))

        connection.execute(
            sql.SQL(
                "ALTER DEFAULT PRIVILEGES FOR ROLE {} IN SCHEMA public "
                "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {}"
            ).format(migration, application)
        )
        connection.execute(
            sql.SQL(
                "ALTER DEFAULT PRIVILEGES FOR ROLE {} IN SCHEMA public "
                "GRANT USAGE, SELECT ON SEQUENCES TO {}"
            ).format(migration, application)
        )
        connection.execute(
            sql.SQL(
                "ALTER DEFAULT PRIVILEGES FOR ROLE {} IN SCHEMA public "
                "GRANT SELECT ON TABLES TO {}"
            ).format(migration, monitor)
        )

    return {
        "database": database_name,
        "roles": role_names,
        "connectionLimits": limits,
        "passwordsPrinted": False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--admin-url",
        default=os.environ.get("BIDDING_POSTGRES_ADMIN_URL", ""),
    )
    parser.add_argument(
        "--allow-insecure-local",
        action="store_true",
        help="Allow sslmode other than verify-full only for loopback test servers.",
    )
    args = parser.parse_args()
    if not args.admin_url:
        parser.error("BIDDING_POSTGRES_ADMIN_URL or --admin-url is required")
    parsed = urlsplit(args.admin_url)
    insecure_local = args.allow_insecure_local and parsed.hostname in {
        "127.0.0.1",
        "::1",
        "localhost",
    }
    if args.allow_insecure_local and not insecure_local:
        parser.error("--allow-insecure-local is restricted to loopback hosts")

    roles = {
        purpose: os.environ.get(
            f"BIDDING_POSTGRES_{purpose.upper()}_ROLE", default
        )
        for purpose, default in DEFAULT_ROLES.items()
    }
    passwords = {
        purpose: os.environ.get(environment_name, "")
        for purpose, environment_name in PASSWORD_ENVIRONMENTS.items()
    }
    result = provision_roles(
        args.admin_url,
        roles,
        passwords,
        require_verified_tls=not insecure_local,
    )
    print(
        "PostgreSQL roles provisioned for database "
        f"{result['database']}: {', '.join(result['roles'].values())}. "
        "No passwords were printed."
    )


if __name__ == "__main__":
    main()
