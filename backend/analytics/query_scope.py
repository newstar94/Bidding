"""SQL fragments for record visibility. Every fragment is code-owned."""

# ruff: noqa: S608

from __future__ import annotations

from backend.ai.errors import ai_error
from backend.ai.types import AiRequestContext
from backend.shared.access_policy import is_assignment_scoped_active_role
from backend.sync.visibility_scope import VisibilityScope


TABLES = {
    "packages": ("goi_thau", "goithau", "goithau"),
    "plans": ("ke_hoach_lcnt", "kehoach", "kehoach"),
    "contracts": ("hop_dong", "hopdong", "hopdong"),
}


def table_for_entity(entity: str) -> tuple[str, str, str]:
    try:
        return TABLES[str(entity)]
    except KeyError as exc:
        raise ai_error("AI_TOOL_INVALID_ARGUMENTS", "Miền dữ liệu không được hỗ trợ.") from exc


def validate_module_permission(context: AiRequestContext, entity: str) -> None:
    table_name, module_name, _ = table_for_entity(entity)
    if not context.permissions.get(module_name):
        raise ai_error("AI_PERMISSION_DENIED", "Bạn không có quyền xem dữ liệu này trong workspace hiện tại.")
    del table_name


def visibility_clause(context: AiRequestContext, entity: str, alias: str) -> tuple[str, tuple[str, ...]]:
    table_name, module_name, _assignment_type = table_for_entity(entity)
    validate_module_permission(context, entity)
    predicate = VisibilityScope(
        organization_id=context.organization_id,
        user_id=context.user_id,
        unrestricted=not is_assignment_scoped_active_role(
            context.active_role,
            context.scope_type,
        ),
        permissions={module_name: context.permissions[module_name]},
    ).live_predicate(table_name, alias)
    return (
        predicate.sql,
        predicate.parameters,
    )
