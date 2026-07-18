"""maintenance.py — Database maintenance helpers.

The SQLite-specific backup, integrity check and restore helpers have been
removed as part of the migration to PostgreSQL.

For PostgreSQL, use:
- ``pg_dump``   to create backups
- ``pg_restore`` to restore backups
- ``VACUUM ANALYZE`` for routine maintenance

This module is kept as a tombstone so existing imports fail clearly.
"""

raise ImportError(
    "backend.db.maintenance SQLite helpers have been removed. "
    "Use pg_dump/pg_restore for PostgreSQL database maintenance."
)
