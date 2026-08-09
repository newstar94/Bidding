"""Read-only ownership contract for a future organization decommission flow."""

from dataclasses import dataclass

from backend.db.schema import SCHEMA_DINH_NGHIA
from backend.shared.workspace_scope import personal_scope_owner_id


@dataclass(frozen=True, slots=True)
class OrganizationOwnershipTable:
    table_name: str
    polymorphic_owner: bool


class OrganizationDecommissionPostconditionError(RuntimeError):
    """The organization root or unapproved owner rows still exist."""

    def __init__(self, *, organization_exists, blockers):
        self.organization_exists = bool(organization_exists)
        self.blockers = dict(blockers)
        super().__init__(
            "Organization decommission postcondition failed: "
            f"root={int(self.organization_exists)}, tables={len(self.blockers)}"
        )


def organization_ownership_registry(schema=None):
    """Derive every organization-scoped table from the canonical schema."""

    schema = SCHEMA_DINH_NGHIA if schema is None else schema
    return tuple(
        OrganizationOwnershipTable(
            table_name=table_name,
            polymorphic_owner="owner_type" in table_spec.get("columns", {}),
        )
        for table_name, table_spec in schema.items()
        if "organization_id" in table_spec.get("columns", {})
    )


def _normalize_organization_id(organization_id):
    normalized = str(organization_id or "").strip()
    if (
        not normalized
        or len(normalized) > 128
        or personal_scope_owner_id(normalized) is not None
    ):
        raise ValueError("organization_id must identify a business organization")
    return normalized


def inspect_organization_ownership(cursor, organization_id):
    """Return count-only owner inventory without exposing tenant row content."""

    organization_id = _normalize_organization_id(organization_id)
    organization_exists = cursor.execute(
        "SELECT 1 FROM to_chuc WHERE id = ? LIMIT 1",
        (organization_id,),
    ).fetchone() is not None
    table_counts = {}
    for entry in organization_ownership_registry():
        row = cursor.execute(
            f"SELECT COUNT(*) FROM {entry.table_name} WHERE organization_id = ?",  # noqa: S608 - canonical schema identifier
            (organization_id,),
        ).fetchone()
        table_counts[entry.table_name] = int(row[0] if row else 0)
    return {
        "organizationExists": organization_exists,
        "tables": table_counts,
        "totalRows": sum(table_counts.values()),
    }


def assert_organization_decommission_postcondition(
    cursor,
    organization_id,
    *,
    approved_retained_tables=(),
):
    """Fail closed unless the root and every unapproved scoped row are gone."""

    registry_names = {
        entry.table_name for entry in organization_ownership_registry()
    }
    approved = {str(name).strip() for name in approved_retained_tables}
    unknown = approved - registry_names
    if unknown:
        raise ValueError(
            "approved retained tables are outside the ownership registry: "
            + ", ".join(sorted(unknown))
        )
    inventory = inspect_organization_ownership(cursor, organization_id)
    blockers = {
        table_name: count
        for table_name, count in inventory["tables"].items()
        if count and table_name not in approved
    }
    if inventory["organizationExists"] or blockers:
        raise OrganizationDecommissionPostconditionError(
            organization_exists=inventory["organizationExists"],
            blockers=blockers,
        )
    return inventory
