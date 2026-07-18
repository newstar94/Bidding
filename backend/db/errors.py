"""Cross-dialect exception groups for route and service boundaries."""

import sqlite3

from psycopg import Error as PostgreSQLError
from psycopg import IntegrityError as PostgreSQLIntegrityError
from psycopg import OperationalError as PostgreSQLOperationalError


DATABASE_ERRORS = (sqlite3.Error, PostgreSQLError)
INTEGRITY_ERRORS = (sqlite3.IntegrityError, PostgreSQLIntegrityError)
OPERATIONAL_ERRORS = (sqlite3.OperationalError, PostgreSQLOperationalError)


class DatabaseContractError(RuntimeError):
    """Service invariant failed independently of the selected database."""


class DatabasePoolTimeout(TimeoutError):
    """A bounded PostgreSQL pool couldn't provide a connection in time."""

    code = "DATABASE_POOL_TIMEOUT"
