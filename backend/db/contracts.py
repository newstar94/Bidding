"""Database backend contracts shared by SQLite and PostgreSQL adapters."""

from typing import Protocol, runtime_checkable


@runtime_checkable
class DatabaseBackend(Protocol):
    backend_name: str
    supports_multiple_writers: bool

    def get_connection(self):
        """Return a DB-API style connection owned by the caller."""

    def acquire_writer_lease(self):
        """Return a releasable process/database writer lease."""

    def transaction(self, connection):
        """Return a context manager for one atomic transaction."""

    def savepoint(self, connection, name: str):
        """Return a context manager for a nested recoverable transaction."""

    def healthcheck(self) -> bool:
        """Return true only when a round trip to the database succeeds."""

    def is_unique_violation(self, error: BaseException) -> bool:
        """Classify a backend-specific unique constraint violation."""

    def is_foreign_key_violation(self, error: BaseException) -> bool:
        """Classify a backend-specific foreign key violation."""

    def is_retryable_error(self, error: BaseException) -> bool:
        """Classify transient lock, serialization, or connection failures."""

    def close(self) -> None:
        """Release backend-owned connection pool resources."""
