"""Canonical platform and organization role definitions."""

PLATFORM_ROLES = frozenset({"super_admin", "user"})
ORGANIZATION_ROLES = frozenset({"manager", "employee"})


def normalize_platform_role(value):
    role = str(value or "").strip().lower()
    return role if role in PLATFORM_ROLES else "user"


def normalize_organization_role(value):
    role = str(value or "").strip().lower()
    return role if role in ORGANIZATION_ROLES else None


def effective_access_roles(platform_role, membership_role=None):
    """Return UI capabilities without promoting membership to platform scope."""

    if normalize_platform_role(platform_role) == "super_admin":
        return ["super_admin", "manager", "employee"]
    membership_role = normalize_organization_role(membership_role)
    hierarchy = {
        "manager": ["manager", "employee"],
        "employee": ["employee"],
    }
    # A normal platform account is always an employee. Organization
    # membership can elevate that account only inside the selected workspace.
    return hierarchy.get(membership_role, ["employee"])


def resolve_workspace_active_role(
    *,
    platform_role,
    membership_role,
    scope_type,
    organization_id,
    selected_role=None,
    selected_organization_id=None,
):
    """Apply a selected role only to the workspace that authorized it."""

    platform = normalize_platform_role(platform_role)
    membership = normalize_organization_role(membership_role)
    selected = str(selected_role or "").strip().lower()
    selected_organization = str(selected_organization_id or "").strip()
    current_organization = str(organization_id or "").strip()
    normalized_scope = str(scope_type or "organization").strip().lower()

    if platform == "super_admin":
        default_role = "super_admin"
        allowed_roles = {"super_admin", "manager", "employee"}
    elif normalized_scope == "personal":
        default_role = "employee"
        allowed_roles = {"employee"}
    elif membership == "manager":
        default_role = "manager"
        allowed_roles = {"manager", "employee"}
    else:
        default_role = "employee"
        allowed_roles = {"employee"}

    if (
        selected_organization
        and selected_organization == current_organization
        and selected in allowed_roles
    ):
        return selected
    return default_role
