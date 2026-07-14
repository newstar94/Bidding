from dataclasses import dataclass

from backend.auth.auth_helper import get_effective_roles
from backend.shared.text_utils import clean_id


PLATFORM_ADMIN_ROLES = {"super_admin"}
ORGANIZATION_MANAGER_ROLES = {"owner", "manager"}
WRITE_PROTECTED_KEYS = {
    "assignments",
    "permissionmatrix",
    "organizations",
    "employees",
    "systempackages",
}

TABLE_TO_MODULE = {
    "chu_dau_tu": "chudautu",
    "ke_hoach_lcnt": "kehoach",
    "goi_thau": "goithau",
    "chuyen_gia": "chuyengia",
    "nha_thau": "nhathau",
    "hop_dong": "hopdong",
    "thong_tin_mo_thau": "thongtinmothau",
    "trang_thai_ho_so_giay": "hopdong",
}

ASSIGNED_TABLE_TYPES = {
    "ke_hoach_lcnt": "kehoach",
    "goi_thau": "goithau",
    "hop_dong": "hopdong",
}


@dataclass(frozen=True)
class AccessDecision:
    allowed: bool
    message: str = ""


def _roles(role_str):
    return get_effective_roles(str(role_str or ""))


def is_manager_role(role_str):
    """Return whether an account has the platform-wide administration role.

    Organization manager roles deliberately do not belong here: they must always
    be resolved against a concrete membership and organization.
    """

    return bool(_roles(role_str) & PLATFORM_ADMIN_ROLES)


def organization_membership_role(cursor, user_id, owner_id):
    if not user_id or not owner_id:
        return None
    cursor.execute(
        """
        SELECT lower(trim(vai_tro_trong_to_chuc))
        FROM thanh_vien_to_chuc
        WHERE user_id = ? AND to_chuc_id = ?
        LIMIT 1
        """,
        (user_id, owner_id),
    )
    row = cursor.fetchone()
    return str(row[0] or "").strip().lower() if row else None


def is_organization_manager(cursor, role_str, user_id, owner_id):
    if is_manager_role(role_str):
        return True
    return organization_membership_role(cursor, user_id, owner_id) in ORGANIZATION_MANAGER_ROLES


def has_active_organization_membership(cursor, role_str, user_id, owner_id):
    if is_manager_role(role_str):
        return True
    return organization_membership_role(cursor, user_id, owner_id) is not None


def _permission_for(cursor, owner_id, user_id, module_name):
    if not module_name:
        return ""
    cursor.execute(
        f"SELECT {module_name} FROM ma_tran_phan_quyen WHERE owner_id = ? AND emp_id = ?",
        (owner_id, user_id),
    )
    row = cursor.fetchone()
    if not row:
        return ""
    try:
        return str(row[0] or "").strip().lower()
    except Exception:
        return ""


def has_module_permission(cursor, role_str, user_id, owner_id, module_name, action="view"):
    if is_organization_manager(cursor, role_str, user_id, owner_id):
        return True
    if not has_active_organization_membership(cursor, role_str, user_id, owner_id):
        return False
    permission = _permission_for(cursor, owner_id, user_id, module_name)
    if action == "edit":
        return permission == "edit"
    return permission in {"view", "edit"}


def _assigned(cursor, owner_id, user_id, target_id, target_type):
    target_id = clean_id(target_id)
    if not target_id or not target_type:
        return False
    cursor.execute(
        """
        SELECT 1 FROM phan_cong_nhan_su
        WHERE owner_id = ? AND id_nhan_vien = ? AND id_muc_tieu = ? AND loai_doi_tuong = ?
        LIMIT 1
        """,
        (owner_id, user_id, target_id, target_type),
    )
    return cursor.fetchone() is not None


def _table_record_exists(cursor, owner_id, table_name, record_id):
    record_id = clean_id(record_id)
    if not record_id:
        return False
    cursor.execute(
        f"SELECT 1 FROM {table_name} WHERE owner_id = ? AND id = ? LIMIT 1",
        (owner_id, record_id),
    )
    return cursor.fetchone() is not None


def _opening_parent_id(cursor, owner_id, item_or_id):
    if isinstance(item_or_id, dict):
        parent_id = item_or_id.get("goiThauId") or item_or_id.get("goi_thau_id")
        if parent_id:
            return clean_id(parent_id)
        record_id = clean_id(item_or_id.get("id"))
    else:
        record_id = clean_id(item_or_id)

    if not record_id:
        return None
    cursor.execute(
        "SELECT goi_thau_id FROM thong_tin_mo_thau WHERE owner_id = ? AND id = ?",
        (owner_id, record_id),
    )
    row = cursor.fetchone()
    return clean_id(row[0]) if row else None


def _assigned_for_table(cursor, owner_id, user_id, table_name, item_or_id):
    if table_name == "thong_tin_mo_thau":
        parent_id = _opening_parent_id(cursor, owner_id, item_or_id)
        return _assigned(cursor, owner_id, user_id, parent_id, "goithau")

    target_type = ASSIGNED_TABLE_TYPES.get(table_name)
    if not target_type:
        return True
    if isinstance(item_or_id, dict):
        record_id = item_or_id.get("id")
    else:
        record_id = item_or_id
    if table_name == "ke_hoach_lcnt":
        plan_id = clean_id(record_id)
        if _assigned(cursor, owner_id, user_id, plan_id, "kehoach"):
            return True
        cursor.execute(
            """
            SELECT 1 FROM goi_thau gt
            JOIN phan_cong_nhan_su pc
              ON pc.owner_id = gt.owner_id
             AND pc.id_muc_tieu = gt.id
             AND pc.loai_doi_tuong = 'goithau'
            WHERE gt.owner_id = ? AND gt.ke_hoach_id = ? AND pc.id_nhan_vien = ?
            LIMIT 1
            """,
            (owner_id, plan_id, user_id),
        )
        return cursor.fetchone() is not None
    return _assigned(cursor, owner_id, user_id, record_id, target_type)


def authorize_payload_key_write(role_str, payload_key, *, organization_manager=False):
    if is_manager_role(role_str) or organization_manager:
        return AccessDecision(True)
    if payload_key in WRITE_PROTECTED_KEYS:
        return AccessDecision(False, f"Không có quyền đồng bộ {payload_key}.")
    return AccessDecision(True)


def authorize_record_write(cursor, role_str, user_id, owner_id, payload_key, table_name, item):
    organization_manager = is_organization_manager(cursor, role_str, user_id, owner_id)
    key_decision = authorize_payload_key_write(
        role_str,
        payload_key,
        organization_manager=organization_manager,
    )
    if not key_decision.allowed:
        return key_decision
    if organization_manager:
        return AccessDecision(True)

    module_name = TABLE_TO_MODULE.get(table_name)
    if not has_module_permission(cursor, role_str, user_id, owner_id, module_name, "edit"):
        return AccessDecision(False, f"Không có quyền sửa phân hệ {module_name or table_name}.")

    record_id = clean_id(item.get("id")) if isinstance(item, dict) else clean_id(item)
    if table_name == "thong_tin_mo_thau":
        if not _assigned_for_table(cursor, owner_id, user_id, table_name, item):
            return AccessDecision(False, "Không có quyền sửa bản ghi chưa được phân công.")
    elif table_name in ASSIGNED_TABLE_TYPES:
        is_existing = bool(record_id) and _table_record_exists(cursor, owner_id, table_name, record_id)
        if is_existing and not _assigned_for_table(cursor, owner_id, user_id, table_name, item):
            return AccessDecision(False, "Không có quyền sửa bản ghi chưa được phân công.")

    return AccessDecision(True)


def can_read_table(cursor, role_str, user_id, owner_id, payload_key, table_name):
    if is_organization_manager(cursor, role_str, user_id, owner_id):
        return True
    if not has_active_organization_membership(cursor, role_str, user_id, owner_id):
        return False
    if payload_key in {"assignments", "permissionmatrix"}:
        return True
    module_name = TABLE_TO_MODULE.get(table_name)
    return has_module_permission(cursor, role_str, user_id, owner_id, module_name, "view")


def can_read_record(cursor, role_str, user_id, owner_id, payload_key, table_name, item_or_id):
    if is_organization_manager(cursor, role_str, user_id, owner_id):
        return True
    if not can_read_table(cursor, role_str, user_id, owner_id, payload_key, table_name):
        return False
    if table_name not in ASSIGNED_TABLE_TYPES and table_name != "thong_tin_mo_thau":
        return True
    return _assigned_for_table(cursor, owner_id, user_id, table_name, item_or_id)


def filter_items_for_read(cursor, role_str, user_id, owner_id, payload_key, table_name, items):
    if is_organization_manager(cursor, role_str, user_id, owner_id):
        return list(items or [])

    source_items = list(items or [])
    if payload_key == "assignments":
        return [item for item in source_items if str(item.get("empId") or "") == str(user_id)]
    if payload_key == "permissionmatrix":
        return [item for item in source_items if str(item.get("empId") or "") == str(user_id)]
    if not can_read_table(cursor, role_str, user_id, owner_id, payload_key, table_name):
        return []
    if table_name not in ASSIGNED_TABLE_TYPES and table_name != "thong_tin_mo_thau":
        return source_items
    return [
        item for item in source_items
        if _assigned_for_table(cursor, owner_id, user_id, table_name, item)
    ]
