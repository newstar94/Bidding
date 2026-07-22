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
