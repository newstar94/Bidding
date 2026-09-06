"""Principal, membership, and module-permission policy.

This module is an internal extraction from ``access_policy``.  The legacy
module continues to re-export this interface for caller compatibility.
"""

from backend.auth.auth_helper import get_effective_roles
from backend.shared.module_registry import CANONICAL_PERMISSION_MODULES, canonical_module
from backend.shared.workspace_scope import is_personal_scope_for_user


PLATFORM_ADMIN_ROLES = {"super_admin"}
ORGANIZATION_MANAGER_ROLES = {"manager"}
MODULE_PERMISSION_COLUMNS = CANONICAL_PERMISSION_MODULES


def _roles(role_str):
    return get_effective_roles(str(role_str or ""))


def is_manager_role(role_str):
    """Return whether an account has the platform-wide administration role.

    Organization manager roles deliberately do not belong here: they must always
    be resolved against a concrete membership and organization.
    """

    active_role = getattr(role_str, "active_role", None)
    if active_role is not None:
        return active_role == "super_admin"
    return bool(_roles(role_str) & PLATFORM_ADMIN_ROLES)


def is_assignment_scoped_active_role(active_role, scope_type="organization"):
    """Return whether the selected workspace persona is assignment-scoped."""

    return (
        str(scope_type or "organization").strip().lower() != "personal"
        and str(active_role or "").strip().lower()
        not in {"manager", "super_admin"}
    )


def organization_membership_role(cursor, user_id, organization_id):
    if not user_id or not organization_id:
        return None
    cursor.execute(
        """
        SELECT lower(trim(vai_tro_trong_to_chuc))
        FROM thanh_vien_to_chuc
        WHERE user_id = ? AND organization_id = ?
          AND COALESCE(trang_thai_thanh_vien, 'active') = 'active'
        LIMIT 1
        """,
        (user_id, organization_id),
    )
    row = cursor.fetchone()
    return str(row[0] or "").strip().lower() if row else None


def is_business_organization(cursor, organization_id):
    cursor.execute(
        "SELECT 1 FROM to_chuc WHERE id = ? LIMIT 1",
        (organization_id,),
    )
    return cursor.fetchone() is not None


def is_personal_workspace_owner(cursor, user_id, organization_id):
    if not is_personal_scope_for_user(organization_id, user_id):
        return False
    cursor.execute(
        """SELECT 1 FROM tai_khoan
           WHERE id = ? AND vai_tro != 'super_admin'
             AND trang_thai = 'active' LIMIT 1""",
        (user_id,),
    )
    return cursor.fetchone() is not None


def is_organization_manager(cursor, role_str, user_id, organization_id):
    if getattr(role_str, "active_role", None) == "employee":
        return False
    if is_manager_role(role_str):
        return True
    return organization_membership_role(cursor, user_id, organization_id) in ORGANIZATION_MANAGER_ROLES


def can_upload_workspace_assets(cursor, role_str, user_id, organization_id):
    """Allow personal owners or an active organization manager to upload assets."""

    if is_personal_scope_for_user(organization_id, user_id):
        return is_personal_workspace_owner(cursor, user_id, organization_id)
    return is_organization_manager(cursor, role_str, user_id, organization_id)


def has_active_organization_membership(cursor, role_str, user_id, organization_id):
    if is_manager_role(role_str):
        return True
    return organization_membership_role(cursor, user_id, organization_id) is not None


def has_inherited_specialist_access(cursor, role_str, user_id, organization_id):
    """Allow an organization manager in employee mode to inherit read access."""

    if getattr(role_str, "active_role", None) != "employee":
        return False
    return organization_membership_role(cursor, user_id, organization_id) in ORGANIZATION_MANAGER_ROLES


def _permission_for(cursor, organization_id, user_id, module_name):
    module_name = canonical_module(module_name)
    if module_name not in MODULE_PERMISSION_COLUMNS:
        return ""
    cursor.execute(
        f"SELECT {module_name} FROM ma_tran_phan_quyen WHERE organization_id = ? AND emp_id = ?",
        (organization_id, user_id),
    )
    row = cursor.fetchone()
    if not row:
        return ""
    try:
        return str(row[0] or "").strip().lower()
    except Exception:
        return ""


def has_module_permission(cursor, role_str, user_id, organization_id, module_name, action="view"):
    module_name = canonical_module(module_name)
    if module_name is None:
        return False
    if is_organization_manager(cursor, role_str, user_id, organization_id):
        return True
    if is_personal_workspace_owner(cursor, user_id, organization_id):
        return True
    if action != "edit" and has_inherited_specialist_access(
        cursor, role_str, user_id, organization_id
    ):
        return True
    if not has_active_organization_membership(cursor, role_str, user_id, organization_id):
        return False
    permission = _permission_for(cursor, organization_id, user_id, module_name)
    if action == "edit":
        return permission == "edit"
    return permission in {"view", "edit"}
