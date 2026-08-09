"""Resolve server-owned identity, workspace and module permissions."""

from __future__ import annotations

from backend.ai.errors import ai_error
from backend.ai.types import AiRequestContext
from backend.auth.session_utils import get_active_org
from backend.auth.auth_helper import verify_session
from backend.auth.roles import resolve_workspace_active_role
from backend.shared.access_policy import has_module_permission
from backend.shared.workspace_scope import is_personal_scope_for_user
from backend.shared.helpers import database


MODULES = {
    "plans": "kehoach",
    "packages": "goithau",
    "contracts": "hopdong",
    "assignments": "assignments",
    "bidders": "nhathau",
    "investors": "chudautu",
    "experts": "chuyengia",
}


def effective_workspace_role(
    session,
    organization_id: str,
    membership_role: str,
    scope_type: str,
) -> str:
    """Resolve a selected role only inside the workspace that granted it."""

    return resolve_workspace_active_role(
        platform_role=getattr(session, "platform_role", str(session)),
        membership_role=membership_role,
        scope_type=scope_type,
        organization_id=organization_id,
        selected_role=getattr(session, "active_role", None),
        selected_organization_id=getattr(
            session,
            "active_role_organization_id",
            None,
        ),
    )


def build_request_context(request) -> AiRequestContext:
    valid, session_or_error = verify_session(request)
    if not valid:
        raise ai_error("AI_AUTH_REQUIRED", "Phiên đăng nhập không hợp lệ.")

    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        organization_id = get_active_org(request, session_or_error.user_id, cursor=cursor)
        organization_context = getattr(request.state, "organization_context", None)
        membership_role = str(getattr(organization_context, "membership_role", "") or "").strip().lower()
        scope_type = str(getattr(organization_context, "scope_type", "organization") or "organization")
        organization_name = "Cá nhân" if scope_type == "personal" else organization_id
        if scope_type != "personal":
            row = cursor.execute(
                "SELECT ten_to_chuc FROM to_chuc WHERE id = ? LIMIT 1",
                (organization_id,),
            ).fetchone()
            organization_name = str(row[0] if row else organization_id)
        platform_role = str(getattr(session_or_error, "platform_role", str(session_or_error)) or "")
        active_role = effective_workspace_role(
            session_or_error,
            str(organization_id),
            membership_role,
            scope_type,
        )
        manager_context = active_role in {"manager", "super_admin"}
        permissions = {}
        for module in MODULES.values():
            if module == "assignments":
                permissions[module] = "view" if membership_role in {"manager", "employee"} or scope_type == "personal" else ""
                continue
            if manager_context:
                permissions[module] = "edit"
                continue
            permissions[module] = (
                "edit" if has_module_permission(
                    cursor, session_or_error, session_or_error.user_id, organization_id, module, "edit"
                ) else "view" if has_module_permission(
                    cursor, session_or_error, session_or_error.user_id, organization_id, module, "view"
                ) else ""
            )
        permissions["ai.chat"] = "view"
        if is_personal_scope_for_user(organization_id, session_or_error.user_id):
            membership_role = "employee"
        return AiRequestContext(
            user_id=str(session_or_error.user_id),
            organization_id=str(organization_id),
            organization_name=organization_name,
            platform_role=platform_role,
            membership_role=membership_role,
            scope_type=scope_type,
            active_role=active_role,
            permissions=permissions,
        )
    finally:
        connection.close()
