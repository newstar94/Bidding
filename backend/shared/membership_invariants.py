"""Transaction locks for organization membership invariants."""

from backend.shared.text_utils import clean_id


def lock_organization_membership_invariants(cursor, organization_id):
    """Serialize manager-role mutations for one organization transaction."""

    normalized_id = clean_id(organization_id)
    if not normalized_id:
        return False
    row = cursor.execute(
        "SELECT id FROM to_chuc WHERE id = ? FOR UPDATE",
        (normalized_id,),
    ).fetchone()
    return row is not None


def lock_organization_membership_invariants_many(cursor, organization_ids):
    """Lock multiple organizations in deterministic order."""

    locked = set()
    for organization_id in sorted({
        clean_id(value) for value in organization_ids if clean_id(value)
    }):
        if lock_organization_membership_invariants(cursor, organization_id):
            locked.add(organization_id)
    return locked
