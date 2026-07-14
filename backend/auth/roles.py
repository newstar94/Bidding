"""Canonical platform and organization role definitions."""

PLATFORM_ROLES = frozenset({"super_admin", "user"})
ORGANIZATION_ROLES = frozenset({"owner", "manager", "employee", "viewer"})
ORGANIZATION_ROLE_RANK = {
    "viewer": 0,
    "employee": 1,
    "manager": 2,
    "owner": 3,
}


def normalize_platform_role(value):
    role = str(value or "").strip().lower()
    return role if role in PLATFORM_ROLES else "user"


def normalize_organization_role(value):
    role = str(value or "").strip().lower()
    return role if role in ORGANIZATION_ROLES else None


def effective_access_roles(platform_role, membership_role=None):
    """Return UI capabilities without promoting membership to platform scope."""

    if normalize_platform_role(platform_role) == "super_admin":
        return ["super_admin", "owner", "manager", "employee", "viewer"]
    membership_role = normalize_organization_role(membership_role)
    hierarchy = {
        "owner": ["owner", "manager", "employee", "viewer"],
        "manager": ["manager", "employee", "viewer"],
        "employee": ["employee"],
        "viewer": ["viewer"],
    }
    return hierarchy.get(membership_role, [])

