from dataclasses import dataclass

from backend.auth.auth_helper import get_effective_roles
from backend.shared.text_utils import clean_id


PLATFORM_ADMIN_ROLES = {"super_admin"}
ORGANIZATION_MANAGER_ROLES = {"manager"}
WRITE_PROTECTED_KEYS = {
    "assignments",
    "custompaperstatuses",
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

OWNERSHIP_SCOPED_TABLES = {
    "chu_dau_tu",
    "nha_thau",
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


def organization_membership_role(cursor, user_id, organization_id):
    if not user_id or not organization_id:
        return None
    cursor.execute(
        """
        SELECT lower(trim(vai_tro_trong_to_chuc))
        FROM thanh_vien_to_chuc
        WHERE user_id = ? AND organization_id = ?
        LIMIT 1
        """,
        (user_id, organization_id),
    )
    row = cursor.fetchone()
    return str(row[0] or "").strip().lower() if row else None


def is_business_organization(cursor, organization_id):
    cursor.execute(
        "SELECT scope_type FROM to_chuc WHERE id = ? LIMIT 1",
        (organization_id,),
    )
    row = cursor.fetchone()
    return bool(row and str(row[0] or "").strip().lower() == "organization")


def is_personal_workspace_owner(cursor, user_id, organization_id):
    if not user_id or not organization_id:
        return False
    cursor.execute(
        """
        SELECT 1 FROM to_chuc
        WHERE id = ? AND scope_type = 'personal' AND personal_owner_user_id = ?
        LIMIT 1
        """,
        (organization_id, user_id),
    )
    return cursor.fetchone() is not None


def is_organization_manager(cursor, role_str, user_id, organization_id):
    if is_manager_role(role_str):
        return True
    return organization_membership_role(cursor, user_id, organization_id) in ORGANIZATION_MANAGER_ROLES


def has_active_organization_membership(cursor, role_str, user_id, organization_id):
    if is_manager_role(role_str):
        return True
    return organization_membership_role(cursor, user_id, organization_id) is not None


def _permission_for(cursor, organization_id, user_id, module_name):
    if not module_name:
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
    if is_organization_manager(cursor, role_str, user_id, organization_id):
        return True
    if is_personal_workspace_owner(cursor, user_id, organization_id):
        return True
    if not has_active_organization_membership(cursor, role_str, user_id, organization_id):
        return False
    permission = _permission_for(cursor, organization_id, user_id, module_name)
    if action == "edit":
        return permission == "edit"
    return permission in {"view", "edit"}


def can_manage_word_config(cursor, role_str, user_id, organization_id):
    """Allow personal owners, managers, or employees with related edit rights."""

    if is_organization_manager(cursor, role_str, user_id, organization_id):
        return True
    if is_personal_workspace_owner(cursor, user_id, organization_id):
        return True
    return any(
        has_module_permission(cursor, role_str, user_id, organization_id, module_name, "edit")
        for module_name in ("kehoach", "goithau", "chudautu", "nhathau", "hopdong")
    )


def _assigned(cursor, organization_id, user_id, target_id, target_type):
    target_id = clean_id(target_id)
    if not target_id or not target_type:
        return False
    cursor.execute(
        """
        SELECT 1 FROM phan_cong_nhan_su
        WHERE organization_id = ? AND id_nhan_vien = ? AND id_muc_tieu = ? AND loai_doi_tuong = ?
        LIMIT 1
        """,
        (organization_id, user_id, target_id, target_type),
    )
    return cursor.fetchone() is not None


def _table_record_exists(cursor, organization_id, table_name, record_id):
    record_id = clean_id(record_id)
    if not record_id:
        return False
    cursor.execute(
        f"SELECT 1 FROM {table_name} WHERE organization_id = ? AND id = ? LIMIT 1",
        (organization_id, record_id),
    )
    return cursor.fetchone() is not None


def _existing_lineage_root(cursor, organization_id, table_name, item_or_id):
    """Return the stored logical root touched by a write, or None for create."""

    if isinstance(item_or_id, dict):
        record_id = clean_id(item_or_id.get("id"))
        requested_root = clean_id(item_or_id.get("rootId") or item_or_id.get("id_goc"))
    else:
        record_id = clean_id(item_or_id)
        requested_root = None
    for candidate in (record_id, requested_root):
        if not candidate:
            continue
        row = cursor.execute(
            f"""SELECT COALESCE(NULLIF(id_goc, ''), id)
                FROM {table_name}
                WHERE organization_id = ? AND (id = ? OR id_goc = ?)
                LIMIT 1""",
            (organization_id, candidate, candidate),
        ).fetchone()
        if row:
            return clean_id(row[0])
    return None


def _record_owned_by(cursor, organization_id, user_id, table_name, lineage_root):
    if not lineage_root:
        return False
    row = cursor.execute(
        """SELECT 1 FROM record_edit_ownership
           WHERE organization_id = ? AND table_name = ?
             AND record_id = ? AND user_id = ?
           LIMIT 1""",
        (organization_id, table_name, lineage_root, user_id),
    ).fetchone()
    return row is not None


def _assigned_for_lineage(cursor, organization_id, user_id, table_name, lineage_root):
    if not lineage_root:
        return False
    rows = cursor.execute(
        f"""SELECT id FROM {table_name}
            WHERE organization_id = ?
              AND COALESCE(NULLIF(id_goc, ''), id) = ?""",
        (organization_id, lineage_root),
    ).fetchall()
    return any(
        _assigned_for_table(cursor, organization_id, user_id, table_name, row[0])
        for row in rows
    )


def _opening_parent_id(cursor, organization_id, item_or_id):
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
        "SELECT goi_thau_id FROM thong_tin_mo_thau WHERE organization_id = ? AND id = ?",
        (organization_id, record_id),
    )
    row = cursor.fetchone()
    return clean_id(row[0]) if row else None


def _assigned_for_table(cursor, organization_id, user_id, table_name, item_or_id):
    if table_name == "thong_tin_mo_thau":
        parent_id = _opening_parent_id(cursor, organization_id, item_or_id)
        return _assigned(cursor, organization_id, user_id, parent_id, "goithau")

    target_type = ASSIGNED_TABLE_TYPES.get(table_name)
    if not target_type:
        return True
    if isinstance(item_or_id, dict):
        record_id = item_or_id.get("id")
    else:
        record_id = item_or_id
    if table_name == "ke_hoach_lcnt":
        plan_id = clean_id(record_id)
        if _assigned(cursor, organization_id, user_id, plan_id, "kehoach"):
            return True
        cursor.execute(
            """
            SELECT 1 FROM goi_thau gt
            JOIN phan_cong_nhan_su pc
              ON pc.organization_id = gt.organization_id
             AND pc.id_muc_tieu = gt.id
             AND pc.loai_doi_tuong = 'goithau'
            WHERE gt.organization_id = ? AND gt.ke_hoach_id = ? AND pc.id_nhan_vien = ?
            LIMIT 1
            """,
            (organization_id, plan_id, user_id),
        )
        return cursor.fetchone() is not None
    return _assigned(cursor, organization_id, user_id, record_id, target_type)


def authorize_payload_key_write(role_str, payload_key, *, organization_manager=False):
    if is_manager_role(role_str) or organization_manager:
        return AccessDecision(True)
    if payload_key in WRITE_PROTECTED_KEYS:
        return AccessDecision(False, f"Không có quyền đồng bộ {payload_key}.")
    return AccessDecision(True)


def authorize_record_write(cursor, role_str, user_id, organization_id, payload_key, table_name, item):
    organization_manager = is_organization_manager(cursor, role_str, user_id, organization_id)
    if table_name == "phan_cong_nhan_su" and not organization_manager and not is_manager_role(role_str):
        employee_id = clean_id(item.get("empId") or item.get("id_nhan_vien"))
        target_id = clean_id(item.get("targetId") or item.get("id_muc_tieu"))
        target_type = str(item.get("type") or item.get("loai_doi_tuong") or "").strip()
        if employee_id != clean_id(user_id):
            return AccessDecision(False, "Chuyên viên chỉ được tự nhận bản ghi do mình tạo.")
        target_table = {
            "kehoach": "ke_hoach_lcnt",
            "goithau": "goi_thau",
            "hopdong": "hop_dong",
        }.get(target_type)
        if not target_id or not target_table:
            return AccessDecision(False, "Mục tiêu phân công không hợp lệ.")
        if _table_record_exists(cursor, organization_id, target_table, target_id) and not _assigned(
            cursor, organization_id, user_id, target_id, target_type
        ):
            return AccessDecision(False, "Không được tự nhận một bản ghi đã tồn tại và chưa được phân công.")
        return AccessDecision(True)
    key_decision = authorize_payload_key_write(
        role_str,
        payload_key,
        organization_manager=organization_manager,
    )
    if not key_decision.allowed:
        return key_decision
    if organization_manager:
        return AccessDecision(True)
    if is_personal_workspace_owner(cursor, user_id, organization_id):
        return AccessDecision(True)

    module_name = TABLE_TO_MODULE.get(table_name)
    if not has_module_permission(cursor, role_str, user_id, organization_id, module_name, "edit"):
        return AccessDecision(False, f"Không có quyền sửa phân hệ {module_name or table_name}.")

    if table_name == "thong_tin_mo_thau":
        if not _assigned_for_table(cursor, organization_id, user_id, table_name, item):
            return AccessDecision(False, "Không có quyền sửa bản ghi chưa được phân công.")
    elif table_name in OWNERSHIP_SCOPED_TABLES:
        lineage_root = _existing_lineage_root(cursor, organization_id, table_name, item)
        if lineage_root and not _record_owned_by(
            cursor, organization_id, user_id, table_name, lineage_root
        ):
            return AccessDecision(False, "Chuyên viên chỉ được sửa dữ liệu do mình tạo.")
    elif table_name in ASSIGNED_TABLE_TYPES:
        lineage_root = _existing_lineage_root(cursor, organization_id, table_name, item)
        if lineage_root and not _assigned_for_lineage(
            cursor, organization_id, user_id, table_name, lineage_root
        ):
            return AccessDecision(False, "Không có quyền sửa bản ghi chưa được phân công.")
        return AccessDecision(True)
    return AccessDecision(True)


def can_read_table(cursor, role_str, user_id, organization_id, payload_key, table_name):
    if is_organization_manager(cursor, role_str, user_id, organization_id):
        return True
    if is_personal_workspace_owner(cursor, user_id, organization_id):
        return payload_key not in WRITE_PROTECTED_KEYS
    if not has_active_organization_membership(cursor, role_str, user_id, organization_id):
        return False
    if payload_key in {"assignments", "permissionmatrix"}:
        return True
    module_name = TABLE_TO_MODULE.get(table_name)
    return has_module_permission(cursor, role_str, user_id, organization_id, module_name, "view")


def can_read_record(cursor, role_str, user_id, organization_id, payload_key, table_name, item_or_id):
    if is_organization_manager(cursor, role_str, user_id, organization_id):
        return True
    if not can_read_table(cursor, role_str, user_id, organization_id, payload_key, table_name):
        return False
    if table_name not in ASSIGNED_TABLE_TYPES and table_name != "thong_tin_mo_thau":
        return True
    return _assigned_for_table(cursor, organization_id, user_id, table_name, item_or_id)


def filter_items_for_read(cursor, role_str, user_id, organization_id, payload_key, table_name, items):
    if is_organization_manager(cursor, role_str, user_id, organization_id):
        return list(items or [])

    source_items = list(items or [])
    if payload_key == "assignments":
        return [item for item in source_items if str(item.get("empId") or "") == str(user_id)]
    if payload_key == "permissionmatrix":
        return [item for item in source_items if str(item.get("empId") or "") == str(user_id)]
    if not can_read_table(cursor, role_str, user_id, organization_id, payload_key, table_name):
        return []
    if table_name not in ASSIGNED_TABLE_TYPES and table_name != "thong_tin_mo_thau":
        return source_items
    record_ids = [
        clean_id(item.get("id") if isinstance(item, dict) else item)
        for item in source_items
    ]
    record_ids = [record_id for record_id in record_ids if record_id]
    if not record_ids:
        return []
    placeholders = ", ".join("?" for _ in record_ids)
    if table_name == "ke_hoach_lcnt":
        rows = cursor.execute(
            f"""SELECT pc.id_muc_tieu
                FROM phan_cong_nhan_su pc
                WHERE pc.organization_id = ? AND pc.id_nhan_vien = ?
                  AND pc.loai_doi_tuong = 'kehoach'
                  AND pc.id_muc_tieu IN ({placeholders})
                UNION
                SELECT gt.ke_hoach_id
                FROM goi_thau gt
                JOIN phan_cong_nhan_su pc
                  ON pc.organization_id = gt.organization_id
                 AND pc.id_muc_tieu = gt.id
                 AND pc.loai_doi_tuong = 'goithau'
                WHERE gt.organization_id = ? AND pc.id_nhan_vien = ?
                  AND gt.ke_hoach_id IN ({placeholders})""",
            (organization_id, user_id, *record_ids, organization_id, user_id, *record_ids),
        ).fetchall()
    elif table_name == "thong_tin_mo_thau":
        rows = cursor.execute(
            f"""SELECT mt.id
                FROM thong_tin_mo_thau mt
                JOIN phan_cong_nhan_su pc
                  ON pc.organization_id = mt.organization_id
                 AND pc.id_muc_tieu = mt.goi_thau_id
                 AND pc.loai_doi_tuong = 'goithau'
                WHERE mt.organization_id = ? AND pc.id_nhan_vien = ?
                  AND mt.id IN ({placeholders})""",
            (organization_id, user_id, *record_ids),
        ).fetchall()
    else:
        target_type = ASSIGNED_TABLE_TYPES[table_name]
        rows = cursor.execute(
            f"""SELECT id_muc_tieu FROM phan_cong_nhan_su
                WHERE organization_id = ? AND id_nhan_vien = ?
                  AND loai_doi_tuong = ? AND id_muc_tieu IN ({placeholders})""",
            (organization_id, user_id, target_type, *record_ids),
        ).fetchall()
    allowed_ids = {clean_id(row[0]) for row in rows}
    return [
        item for item in source_items
        if clean_id(item.get("id") if isinstance(item, dict) else item) in allowed_ids
    ]
