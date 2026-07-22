"""PostgreSQL connection pooling and compatibility primitives.

The application historically consumed ``sqlite3.Row`` objects and qmark SQL
parameters.  The small wrappers in this module preserve the row contract while
the repositories are moved to PostgreSQL.  SQLite is intentionally not a
runtime fallback: a valid ``DATABASE_URL`` is required before opening a
connection.
"""

from __future__ import annotations

import os
import threading
import time
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Iterable, Iterator, Mapping, Sequence

import psycopg
from psycopg import sql
from psycopg.pq import TransactionStatus
from psycopg_pool import ConnectionPool, PoolTimeout

from backend.shared.date_utils import VIETNAM_TIMEZONE, VIETNAM_TIMEZONE_NAME


DatabaseError = psycopg.Error
IntegrityError = psycopg.IntegrityError
OperationalError = psycopg.OperationalError


def _record_postgres_timing(
    phase: str,
    duration_seconds: float,
    *,
    outcome: str = "ok",
) -> None:
    """Lazy import avoids coupling the database primitive to metrics startup."""

    try:
        from backend.observability.metrics import record_database_phase

        record_database_phase(
            "postgres",
            phase,
            duration_seconds,
            outcome=outcome,
        )
    except Exception:
        # Metrics must remain fail-open and never affect a transaction.
        pass


def _bounded_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(str(os.environ.get(name, default)).strip())
    except (TypeError, ValueError):
        value = default
    return min(maximum, max(minimum, value))


def _canonical_value(value: Any) -> Any:
    """Return the same scalar shapes previously exposed by SQLite rows."""

    if isinstance(value, datetime):
        if value.tzinfo is not None:
            value = value.astimezone(VIETNAM_TIMEZONE).replace(tzinfo=None)
        return value.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, memoryview):
        return bytes(value)
    return value


class CompatRow(dict):
    """Mapping row that also supports positional access like ``sqlite3.Row``."""

    __slots__ = ("_values",)

    def __init__(self, columns: Sequence[str], values: Sequence[Any]):
        normalized = tuple(_canonical_value(value) for value in values)
        super().__init__(zip(columns, normalized))
        self._values = normalized

    def __getitem__(self, key: Any) -> Any:
        if isinstance(key, int):
            return self._values[key]
        return super().__getitem__(key)

    def __iter__(self):
        # sqlite3.Row iterates values while still exposing ``keys()`` for
        # ``dict(row)``. Several repositories unpack rows positionally.
        return iter(self._values)


def compat_row_factory(cursor: psycopg.Cursor[Any]):
    columns = tuple(column.name for column in (cursor.description or ()))

    def make_row(values: Sequence[Any]) -> CompatRow:
        return CompatRow(columns, values)

    return make_row


def _convert_qmark_parameters(statement: str) -> str:
    """Convert qmark placeholders outside SQL strings/comments to ``%s``.

    This is deliberately a scanner rather than ``str.replace`` so question
    marks in literals, quoted identifiers and comments remain untouched.
    PostgreSQL-specific queries can use ``%s`` directly.
    """

    if "?" not in statement:
        return statement
    output: list[str] = []
    index = 0
    state = "normal"
    length = len(statement)
    while index < length:
        char = statement[index]
        following = statement[index + 1] if index + 1 < length else ""
        if state == "normal":
            if char == "'":
                state = "single"
            elif char == '"':
                state = "double"
            elif char == "-" and following == "-":
                state = "line_comment"
            elif char == "/" and following == "*":
                state = "block_comment"
            elif char == "?":
                output.append("%s")
                index += 1
                continue
        elif state == "single":
            if char == "'" and following == "'":
                output.extend((char, following))
                index += 2
                continue
            if char == "'":
                state = "normal"
        elif state == "double":
            if char == '"' and following == '"':
                output.extend((char, following))
                index += 2
                continue
            if char == '"':
                state = "normal"
        elif state == "line_comment":
            if char in "\r\n":
                state = "normal"
        elif state == "block_comment":
            if char == "*" and following == "/":
                output.extend((char, following))
                index += 2
                state = "normal"
                continue
        output.append(char)
        index += 1
    return "".join(output)


class PostgresCursor:
    """Thin DB-API cursor proxy with safe qmark compatibility."""

    def __init__(self, cursor: psycopg.Cursor[Any]):
        self._cursor = cursor

    def execute(self, statement: Any, parameters: Sequence[Any] | Mapping[str, Any] | None = None):
        started_at = time.perf_counter()
        outcome = "ok"
        if isinstance(statement, str):
            statement = _convert_qmark_parameters(statement)
        try:
            if parameters is None:
                self._cursor.execute(statement)
            else:
                self._cursor.execute(statement, parameters)
        except Exception:
            outcome = "error"
            raise
        finally:
            _record_postgres_timing(
                "query",
                time.perf_counter() - started_at,
                outcome=outcome,
            )
        return self

    def executemany(self, statement: Any, parameters_seq: Iterable[Sequence[Any]]):
        started_at = time.perf_counter()
        outcome = "ok"
        if isinstance(statement, str):
            statement = _convert_qmark_parameters(statement)
        try:
            self._cursor.executemany(statement, parameters_seq)
        except Exception:
            outcome = "error"
            raise
        finally:
            _record_postgres_timing(
                "executemany",
                time.perf_counter() - started_at,
                outcome=outcome,
            )
        return self

    def fetchone(self):
        return self._cursor.fetchone()

    def fetchmany(self, size: int = 0):
        return self._cursor.fetchmany(size) if size else self._cursor.fetchmany()

    def fetchall(self):
        return self._cursor.fetchall()

    @property
    def rowcount(self) -> int:
        return self._cursor.rowcount

    @property
    def description(self):
        return self._cursor.description

    def close(self) -> None:
        self._cursor.close()

    def __iter__(self) -> Iterator[CompatRow]:
        return iter(self._cursor)

    def __enter__(self):
        self._cursor.__enter__()
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return self._cursor.__exit__(exc_type, exc_value, traceback)


class PostgresConnection:
    """Pooled connection proxy whose ``close`` returns the connection."""

    def __init__(self, pool: ConnectionPool, connection: psycopg.Connection[Any]):
        self._pool = pool
        self._connection = connection
        self._closed = False

    def cursor(self) -> PostgresCursor:
        return PostgresCursor(self._connection.cursor())

    def execute(self, statement: Any, parameters: Sequence[Any] | Mapping[str, Any] | None = None):
        cursor = self.cursor()
        return cursor.execute(statement, parameters)

    def commit(self) -> None:
        self._connection.commit()

    def rollback(self) -> None:
        self._connection.rollback()

    @property
    def in_transaction(self) -> bool:
        return self._connection.info.transaction_status != TransactionStatus.IDLE

    @property
    def closed(self) -> bool:
        return self._closed

    @property
    def raw_connection(self) -> psycopg.Connection[Any]:
        return self._connection

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            if self.in_transaction:
                self._connection.rollback()
        finally:
            self._pool.putconn(self._connection)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        if exc_type is None:
            self.commit()
        else:
            self.rollback()
        self.close()
        return False


class PostgresDatabase:
    engine = "postgresql"

    def __init__(self, database_url: str | None = None):
        self._database_url = str(database_url or os.environ.get("DATABASE_URL", "")).strip()
        self._pool: ConnectionPool | None = None
        self._pool_lock = threading.Lock()

    @property
    def database_url(self) -> str:
        value = self._database_url or str(os.environ.get("DATABASE_URL", "")).strip()
        if not value:
            raise RuntimeError(
                "DATABASE_URL is required. BiddingFlow supports PostgreSQL only."
            )
        if not value.startswith(("postgresql://", "postgres://")):
            raise RuntimeError("DATABASE_URL must use the postgresql:// scheme.")
        return value

    def configure(self, database_url: str) -> None:
        """Configure an unopened database instance, primarily for isolated tests."""

        with self._pool_lock:
            if self._pool is not None:
                raise RuntimeError("Cannot reconfigure an open PostgreSQL pool.")
            self._database_url = str(database_url or "").strip()

    @staticmethod
    def _configure_connection(connection: psycopg.Connection[Any]) -> None:
        statement_timeout_ms = _bounded_int(
            "DATABASE_STATEMENT_TIMEOUT_MS", 15_000, 1_000, 300_000
        )
        lock_timeout_ms = _bounded_int(
            "DATABASE_LOCK_TIMEOUT_MS", 2_000, 100, 60_000
        )
        idle_timeout_ms = _bounded_int(
            "DATABASE_IDLE_TRANSACTION_TIMEOUT_MS", 30_000, 1_000, 300_000
        )
        with connection.cursor() as cursor:
            cursor.execute(sql.SQL("SET TIME ZONE {}").format(sql.Literal(VIETNAM_TIMEZONE_NAME)))
            cursor.execute(
                sql.SQL("SET statement_timeout = {}").format(
                    sql.Literal(f"{statement_timeout_ms}ms")
                )
            )
            cursor.execute(
                sql.SQL("SET lock_timeout = {}").format(
                    sql.Literal(f"{lock_timeout_ms}ms")
                )
            )
            cursor.execute(
                sql.SQL("SET idle_in_transaction_session_timeout = {}").format(
                    sql.Literal(f"{idle_timeout_ms}ms")
                )
            )
        connection.commit()

    def open(self, *, wait: bool = True) -> None:
        if self._pool is not None:
            return
        with self._pool_lock:
            if self._pool is not None:
                return
            min_size = _bounded_int("DATABASE_POOL_MIN_SIZE", 2, 0, 32)
            max_size = _bounded_int("DATABASE_POOL_MAX_SIZE", 8, 1, 64)
            if min_size > max_size:
                min_size = max_size
            pool = ConnectionPool(
                conninfo=self.database_url,
                min_size=min_size,
                max_size=max_size,
                timeout=float(_bounded_int("DATABASE_POOL_TIMEOUT_SECONDS", 2, 1, 30)),
                max_idle=float(_bounded_int("DATABASE_POOL_MAX_IDLE_SECONDS", 300, 30, 3600)),
                max_lifetime=float(
                    _bounded_int("DATABASE_POOL_MAX_LIFETIME_SECONDS", 1800, 60, 7200)
                ),
                kwargs={
                    "autocommit": False,
                    "row_factory": compat_row_factory,
                    "connect_timeout": _bounded_int(
                        "DATABASE_CONNECT_TIMEOUT_SECONDS", 5, 1, 30
                    ),
                    "application_name": str(
                        os.environ.get("DATABASE_APPLICATION_NAME", "biddingflow")
                    )[:63],
                },
                configure=self._configure_connection,
                open=False,
                name="biddingflow-postgresql",
            )
            pool.open(wait=wait, timeout=30.0 if wait else None)
            self._pool = pool

    def get_connection(self) -> PostgresConnection:
        self.open(wait=True)
        assert self._pool is not None
        started_at = time.perf_counter()
        outcome = "ok"
        try:
            connection = self._pool.getconn()
        except PoolTimeout as exc:
            outcome = "timeout"
            raise OperationalError("PostgreSQL connection pool is exhausted.") from exc
        finally:
            _record_postgres_timing(
                "connection_acquire",
                time.perf_counter() - started_at,
                outcome=outcome,
            )
        return PostgresConnection(self._pool, connection)

    def listen_connection(self) -> psycopg.Connection[Any]:
        """Open a dedicated autocommit connection for LISTEN/NOTIFY."""

        connection = psycopg.connect(
            self.database_url,
            autocommit=True,
            row_factory=compat_row_factory,
            connect_timeout=_bounded_int(
                "DATABASE_CONNECT_TIMEOUT_SECONDS", 5, 1, 30
            ),
            application_name=(
                str(os.environ.get("DATABASE_APPLICATION_NAME", "biddingflow"))
                + "-listener"
            )[:63],
        )
        with connection.cursor() as cursor:
            cursor.execute(sql.SQL("SET TIME ZONE {}").format(sql.Literal(VIETNAM_TIMEZONE_NAME)))
        return connection

    def pool_stats(self) -> dict[str, Any]:
        if self._pool is None:
            return {}
        return dict(self._pool.get_stats())

    def close(self) -> None:
        with self._pool_lock:
            pool = self._pool
            self._pool = None
        if pool is not None:
            pool.close(timeout=10.0)


models = None
database = PostgresDatabase()
