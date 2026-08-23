"""SQL fragments for record visibility. Every fragment is code-owned."""

# ruff: noqa: S608

from __future__ import annotations

from backend.ai.errors import ai_error
from backend.ai.types import AiRequestContext
from backend.shared.access_policy import is_assignment_scoped_active_role


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
    table_name, module_name, assignment_type = table_for_entity(entity)
    del table_name
    validate_module_permission(context, entity)
    if not is_assignment_scoped_active_role(
        context.active_role,
        context.scope_type,
    ):
        return f"{alias}.organization_id = ?", (context.organization_id,)
    if entity == "packages":
        return (  # noqa: S608 - all SQL fragments are fixed by the entity branch
            f"{alias}.organization_id = ? AND EXISTS ("
            "SELECT 1 FROM phan_cong_nhan_su pc "
            "WHERE pc.organization_id = " + alias + ".organization_id "
            "AND pc.id_muc_tieu = " + alias + ".id "
            "AND pc.id_nhan_vien = ? AND pc.loai_doi_tuong = 'goithau'"
            ")",
            (context.organization_id, context.user_id),
        )
    if entity == "plans":
        return (  # noqa: S608 - all SQL fragments are fixed by the entity branch
            f"{alias}.organization_id = ? AND (EXISTS ("
            "SELECT 1 FROM phan_cong_nhan_su pc "
            "WHERE pc.organization_id = " + alias + ".organization_id "
            "AND pc.id_muc_tieu = " + alias + ".id AND pc.id_nhan_vien = ? "
            "AND pc.loai_doi_tuong = 'kehoach') OR EXISTS ("
            "SELECT 1 FROM goi_thau p JOIN phan_cong_nhan_su pc "
            "ON pc.organization_id = p.organization_id AND pc.id_muc_tieu = p.id "
            "WHERE p.organization_id = " + alias + ".organization_id AND p.ke_hoach_id = " + alias + ".id "
            "AND pc.id_nhan_vien = ? AND pc.loai_doi_tuong = 'goithau'))",
            (context.organization_id, context.user_id, context.user_id),
        )
    return (  # noqa: S608 - all SQL fragments are fixed by the entity branch
        f"{alias}.organization_id = ? AND EXISTS ("
        "SELECT 1 FROM phan_cong_nhan_su pc "
        "WHERE pc.organization_id = " + alias + ".organization_id "
        "AND pc.id_muc_tieu = " + alias + ".id "
        "AND pc.id_nhan_vien = ? AND pc.loai_doi_tuong = '" + assignment_type + "'"
        ")",
        (context.organization_id, context.user_id),
    )
