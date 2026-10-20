"""Commercial gate for ADR 0091 scheduled clarification writes."""

from __future__ import annotations

from backend.commercial_policy.config import commercial_runtime_config
from backend.usage_credits.types import FEATURE_PROCUREMENT_SOURCE_FETCH, UsageOwner


def usage_owner(package) -> UsageOwner:
    if package["owner_type"] == "personal":
        return UsageOwner("account", str(package["organization_id"]).removeprefix("personal:"))
    return UsageOwner("organization", str(package["organization_id"]))


def auto_write_entitled(cursor, package, *, now, environment=None) -> bool:
    """Owner-confirmed rule: credits off/trial, or an unexpired Nâng cao plan grant.

    Only activation of an included procurement quota issues ``source = 'plan'``
    grants, and Cơ bản offers carry no included quota. Purchased or admin grants
    keep manual lookups working but never enable scheduled writes. Remaining
    credits are irrelevant because a scheduled write never debits usage.
    """
    config = commercial_runtime_config(environment)
    if config.trial_full_access_enabled or not config.procurement_credit_enforcement_enabled:
        return True
    owner = usage_owner(package)
    owner_clause = (
        "account_user_id = ? AND organization_id IS NULL"
        if owner.kind == "account"
        else "organization_id = ? AND account_user_id IS NULL"
    )
    row = cursor.execute(
        f"""SELECT 1 FROM usage_credit_grants
             WHERE {owner_clause} AND owner_kind = ? AND feature = ?
               AND source = 'plan' AND expires_at > ?
             LIMIT 1""",  # noqa: S608 - owner_clause is one of two fixed literals.
        (owner.identifier, owner.kind, FEATURE_PROCUREMENT_SOURCE_FETCH, int(now)),
    ).fetchone()
    return row is not None
