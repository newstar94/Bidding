"""Fail-closed database backend selection from environment configuration."""

import os
from urllib.parse import urlparse


POSTGRESQL_SCHEMES = frozenset({"postgres", "postgresql"})


def configured_database_backend(environ=None):
    environment = os.environ if environ is None else environ
    database_url = str(
        environment.get("BIDDING_DATABASE_URL")
        or environment.get("DATABASE_URL")
        or ""
    ).strip()
    if not database_url:
        return "sqlite", None
    parsed = urlparse(database_url)
    scheme = parsed.scheme.casefold()
    if scheme in POSTGRESQL_SCHEMES:
        if not parsed.hostname or not parsed.path.strip("/"):
            raise ValueError(
                "PostgreSQL database URL must include a host and database name."
            )
        return "postgresql", database_url
    if scheme == "sqlite":
        raise ValueError(
            "Configure SQLite with BIDDING_DB_PATH; URL-form SQLite paths are not supported."
        )
    raise ValueError(f"Unsupported database URL scheme: {scheme or '<missing>'}.")


def create_database(environ=None, *, postgresql_pool_factory=None):
    environment = os.environ if environ is None else environ
    backend_name, database_url = configured_database_backend(environment)
    if backend_name == "postgresql":
        from backend.db.postgresql import PostgreSQLDatabase

        return PostgreSQLDatabase(
            database_url,
            environ=environment,
            pool_factory=postgresql_pool_factory,
        )

    from backend.db.db_helper import SQLiteDatabase

    return SQLiteDatabase(environment.get("BIDDING_DB_PATH"))
