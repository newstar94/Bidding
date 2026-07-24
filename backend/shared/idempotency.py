"""Transaction-scoped serialization for idempotent commands."""


def acquire_idempotency_lock(cursor, namespace, *identity_parts):
    """Serialize one logical command until the surrounding transaction ends."""

    parts = [str(namespace or "").strip()]
    parts.extend(str(part or "").strip() for part in identity_parts)
    lock_identity = "|".join(f"{len(part)}:{part}" for part in parts)
    cursor.execute(
        "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))",
        (lock_identity,),
    )
