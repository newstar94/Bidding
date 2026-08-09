"""Transaction lock for platform-wide role invariants."""


def lock_platform_role_invariants(cursor):
    """Serialize all mutations that can reduce the super-admin population."""

    row = cursor.execute(
        """SELECT pg_advisory_xact_lock(
                   hashtext('biddingflow-platform-role-invariants')
               )"""
    ).fetchone()
    return row is not None
