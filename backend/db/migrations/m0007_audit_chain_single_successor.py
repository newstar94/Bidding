"""Prevent two audit events from extending the same chain tip."""

from backend.shared.audit_chain import inspect_audit_chain


VERSION = 7
NAME = "0007_audit_chain_single_successor"


def apply(cursor, context):
    duplicate = cursor.execute(
        """SELECT previous_hash, count(*)
           FROM audit_log
           GROUP BY previous_hash
           HAVING count(*) > 1
           LIMIT 1"""
    ).fetchone()
    if duplicate:
        raise RuntimeError(
            "Cannot enforce audit-chain uniqueness because the existing chain is forked."
        )
    verification = inspect_audit_chain(cursor)
    if not verification.valid:
        raise RuntimeError(
            "Cannot enforce audit-chain uniqueness because the existing chain "
            f"is invalid ({verification.failure})."
        )
    cursor.execute(
        """CREATE UNIQUE INDEX idx_audit_log_single_successor
           ON audit_log (previous_hash)"""
    )
    context.assert_foreign_key_integrity(cursor)
