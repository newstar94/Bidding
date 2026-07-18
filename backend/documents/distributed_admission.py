"""Cluster-wide document worker admission for multi-instance PostgreSQL."""

from __future__ import annotations

from dataclasses import dataclass
import time
import uuid


_ADVISORY_LOCK_KEY = 4_273_312_028


@dataclass
class DistributedDocumentLease:
    database: object
    lease_id: str | None = None

    def release(self):
        if not self.lease_id:
            return
        connection = self.database.get_connection()
        try:
            connection.execute(
                "DELETE FROM document_worker_leases WHERE lease_id = ?",
                (self.lease_id,),
            )
            connection.commit()
        finally:
            connection.close()


def try_acquire_document_lease(database, *, max_concurrency, ttl_seconds):
    """Return a lease, or ``None`` when all cluster slots are occupied."""

    if getattr(database, "backend_name", "sqlite") != "postgresql":
        return DistributedDocumentLease(database)
    maximum = max(1, min(int(max_concurrency), 64))
    ttl = max(30, min(int(ttl_seconds), 3_600))
    now = int(time.time())
    lease_id = f"document-{uuid.uuid4().hex}"
    connection = database.get_connection()
    try:
        connection.execute("BEGIN")
        connection.execute("SELECT pg_advisory_xact_lock(?)", (_ADVISORY_LOCK_KEY,))
        connection.execute(
            "DELETE FROM document_worker_leases WHERE expires_at <= ?", (now,)
        )
        active = connection.execute(
            "SELECT count(*) FROM document_worker_leases"
        ).fetchone()[0]
        if int(active) >= maximum:
            connection.rollback()
            return None
        connection.execute(
            """
            INSERT INTO document_worker_leases (lease_id, expires_at)
            VALUES (?, ?)
            """,
            (lease_id, now + ttl),
        )
        connection.commit()
        return DistributedDocumentLease(database, lease_id)
    except BaseException:
        connection.rollback()
        raise
    finally:
        connection.close()
