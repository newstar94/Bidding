"""Psycopg 3 connection-pool adapter for the PostgreSQL migration path."""

import contextlib
import datetime
from decimal import Decimal
import os
import threading
import time
from collections.abc import Mapping, Sequence

from backend.db.sql_adapter import PostgreSQLConnectionAdapter
from backend.db.errors import DatabasePoolTimeout


class HybridRow(Sequence, Mapping):
    """Row supporting both numeric and column-name lookup like sqlite3.Row."""

    __slots__ = ("_columns", "_index", "_values")

    def __init__(self, columns, values):
        self._columns = tuple(columns)
        self._values = tuple(self._compatibility_value(value) for value in values)
        self._index = {name: index for index, name in enumerate(self._columns)}

    @staticmethod
    def _compatibility_value(value):
        if isinstance(value, bool):
            return int(value)
        if isinstance(value, datetime.datetime):
            if value.tzinfo is not None:
                value = value.astimezone(datetime.timezone.utc).replace(tzinfo=None)
            return value.isoformat(sep=" ", timespec="seconds")
        if isinstance(value, datetime.date):
            return value.isoformat()
        if isinstance(value, Decimal):
            return float(value)
        return value

    def __getitem__(self, key):
        if isinstance(key, str):
            return self._values[self._index[key]]
        return self._values[key]

    def __iter__(self):
        return iter(self._values)

    def __len__(self):
        return len(self._values)

    def keys(self):
        return self._columns

    def values(self):
        return self._values

    def items(self):
        return zip(self._columns, self._values)

    def get(self, key, default=None):
        try:
            return self[key]
        except (KeyError, IndexError):
            return default


def hybrid_row_factory(cursor):
    columns = tuple(column.name for column in (cursor.description or ()))

    def make_row(values):
        return HybridRow(columns, values)

    return make_row


class ConcurrentWriterLease:
    """No-op lease matching lifecycle semantics for a multi-writer database."""

    @staticmethod
    def release():
        return None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        del exc_type, exc_value, traceback
        self.release()


class PostgreSQLDatabase:
    backend_name = "postgresql"
    supports_multiple_writers = True
    schema_version = 1

    def __init__(self, dsn, *, environ=None, pool_factory=None):
        environment = os.environ if environ is None else environ
        self.dsn = str(dsn)
        self.min_pool_size = max(
            0, int(environment.get("POSTGRES_POOL_MIN_SIZE", "1"))
        )
        self.max_pool_size = max(
            self.min_pool_size,
            int(environment.get("POSTGRES_POOL_MAX_SIZE", "10")),
        )
        self.pool_timeout = max(
            0.1, float(environment.get("POSTGRES_POOL_TIMEOUT_SECONDS", "5"))
        )
        self.max_waiting = max(
            0, int(environment.get("POSTGRES_POOL_MAX_WAITING", "64"))
        )
        self.statement_timeout_ms = max(
            100, int(environment.get("POSTGRES_STATEMENT_TIMEOUT_MS", "15000"))
        )
        if pool_factory is None:
            from psycopg_pool import ConnectionPool

            pool_factory = ConnectionPool
        self._pool_factory = pool_factory
        self._pool_configuration = dict(
            conninfo=self.dsn,
            min_size=self.min_pool_size,
            max_size=self.max_pool_size,
            timeout=self.pool_timeout,
            max_waiting=self.max_waiting,
            max_lifetime=max(
                1.0,
                float(environment.get("POSTGRES_POOL_MAX_LIFETIME_SECONDS", "1800")),
            ),
            max_idle=max(
                1.0,
                float(environment.get("POSTGRES_POOL_MAX_IDLE_SECONDS", "300")),
            ),
            close_returns=True,
            open=False,
            kwargs={"autocommit": False, "row_factory": hybrid_row_factory},
            configure=self._configure_connection,
        )
        self._pool = self._create_pool()
        self._open_lock = threading.Lock()
        self._stats_lock = threading.Lock()
        self._opened = False
        self._acquire_count = 0
        self._acquire_timeout_count = 0
        self._acquire_wait_seconds = 0.0
        self._transaction_count = 0
        self._transaction_seconds = 0.0

    def _create_pool(self):
        return self._pool_factory(**self._pool_configuration)

    def _configure_connection(self, connection):
        connection.execute("SET TIME ZONE 'UTC'")
        connection.execute(
            "SELECT set_config('statement_timeout', %s, false)",
            (str(self.statement_timeout_ms),),
        )
        connection.commit()

    def _ensure_open(self):
        if self._opened:
            return
        with self._open_lock:
            if not self._opened:
                if getattr(self._pool, "closed", False):
                    self._pool = self._create_pool()
                self._pool.open(wait=True, timeout=self.pool_timeout)
                self._opened = True

    def get_connection(self):
        self._ensure_open()
        started = time.perf_counter()
        try:
            return PostgreSQLConnectionAdapter(
                self._pool.getconn(timeout=self.pool_timeout)
            )
        except BaseException as error:
            from psycopg_pool import PoolTimeout

            if isinstance(error, PoolTimeout):
                with self._stats_lock:
                    self._acquire_timeout_count += 1
                raise DatabasePoolTimeout(
                    "PostgreSQL connection pool acquire timed out."
                ) from error
            raise
        finally:
            with self._stats_lock:
                self._acquire_count += 1
                self._acquire_wait_seconds += max(0.0, time.perf_counter() - started)

    def acquire_writer_lease(self):
        return ConcurrentWriterLease()

    @contextlib.contextmanager
    def transaction(self, connection):
        started = time.perf_counter()
        try:
            raw_connection = getattr(connection, "_connection", connection)
            with raw_connection.transaction():
                yield connection
        finally:
            with self._stats_lock:
                self._transaction_count += 1
                self._transaction_seconds += max(0.0, time.perf_counter() - started)

    @staticmethod
    def savepoint(connection, name):
        raw_connection = getattr(connection, "_connection", connection)
        return raw_connection.transaction(savepoint_name=name)

    def healthcheck(self):
        connection = self.get_connection()
        try:
            return connection.execute("SELECT 1").fetchone()[0] == 1
        finally:
            connection.close()

    @staticmethod
    def is_unique_violation(error):
        from psycopg.errors import UniqueViolation

        return isinstance(error, UniqueViolation)

    @staticmethod
    def is_foreign_key_violation(error):
        from psycopg.errors import ForeignKeyViolation

        return isinstance(error, ForeignKeyViolation)

    @staticmethod
    def is_retryable_error(error):
        from psycopg import OperationalError
        from psycopg.errors import DeadlockDetected, SerializationFailure

        return isinstance(error, DatabasePoolTimeout) or isinstance(
            error,
            (DeadlockDetected, OperationalError, SerializationFailure),
        )

    def close(self):
        self._pool.close()
        self._opened = False

    def pool_stats(self):
        raw = self._pool.get_stats()
        size = int(raw.get("pool_size", 0))
        available = int(raw.get("pool_available", 0))
        with self._stats_lock:
            application = {
                "acquire_count": self._acquire_count,
                "acquire_timeouts": self._acquire_timeout_count,
                "acquire_wait_seconds": self._acquire_wait_seconds,
                "transaction_count": self._transaction_count,
                "transaction_seconds": self._transaction_seconds,
            }
        return {
            "size": size,
            "available": available,
            "in_use": max(0, size - available),
            "waiting": int(raw.get("requests_waiting", 0)),
            **application,
        }
