"""Full-state backup has been removed.

BiddingFlow now targets PostgreSQL as its primary database.
Database backup is handled via ``pg_dump``/``pg_restore`` (see scripts/backup.py).
File assets (uploads, Word templates) are backed up separately as before.

This module is kept as a tombstone so existing imports fail with a clear message
rather than a cryptic ModuleNotFoundError.
"""

raise ImportError(
    "backend.db.full_state_backup has been removed. "
    "Use scripts/backup.py or pg_dump for PostgreSQL backups."
)
