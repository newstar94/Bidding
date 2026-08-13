"""Central response policy for sensitive contractor and expert data."""

from dataclasses import dataclass

SENSITIVE_READ_TABLES = frozenset({"chuyen_gia", "nha_thau"})


@dataclass(frozen=True)
class SensitiveReadPolicy:
    """Workspace-scoped access to complete business records."""

    can_view_expert_details: bool
    can_view_contractor_financials: bool
    can_view_signature_images: bool = False

    def can_view(self, table_name):
        if table_name == "chuyen_gia":
            return self.can_view_expert_details
        if table_name == "nha_thau":
            return self.can_view_contractor_financials
        return True


def resolve_sensitive_read_policy(
    cursor,
    role_str,
    user_id,
    organization_id,
    table_names=None,
):
    """Project complete fields after canonical record authorization has passed.

    Tenant, module, assignment and record-level checks happen before this
    serializer is called. Field-level grants are deliberately not part of the
    BiddingFlow business contract; Word export remains a separate action policy.
    """
    del cursor, role_str, user_id, organization_id
    requested_tables = (
        set(SENSITIVE_READ_TABLES)
        if table_names is None
        else set(table_names) & set(SENSITIVE_READ_TABLES)
    )
    return SensitiveReadPolicy(
        can_view_expert_details="chuyen_gia" in requested_tables,
        can_view_contractor_financials="nha_thau" in requested_tables,
        can_view_signature_images=bool(requested_tables),
    )


def serialize_sensitive_read_item(table_name, item, policy):
    """Return the complete record after its canonical read check has passed."""
    del table_name, policy
    return dict(item or {})


def serialize_sensitive_read_items(table_name, items, policy):
    return [serialize_sensitive_read_item(table_name, item, policy) for item in items]
