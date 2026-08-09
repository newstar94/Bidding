from dataclasses import dataclass, field

from backend.auth.auth_helper import get_effective_roles
from backend.shared.text_utils import clean_id
from backend.shared.workspace_scope import is_personal_scope_for_user
from backend.shared.subscription_policy import can_use_word_export


PLATFORM_ADMIN_ROLES = {"super_admin"}
ORGANIZATION_MANAGER_ROLES = {"manager"}
WRITE_PROTECTED_KEYS = {
    "assignments",
    "customcontractstatuses",
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
    # Opening records are children of a package and inherit its module grant.
    "thong_tin_mo_thau": "goithau",
    "goi_thau_hang_hoa": "goithau",
    "hang_hoa_du_thau_nha_thau": "goithau",
    "danh_muc_trang_thai_hop_dong": "hopdong",
}

ASSIGNED_TABLE_TYPES = {
    "ke_hoach_lcnt": "kehoach",
    "goi_thau": "goithau",
    "hop_dong": "hopdong",
}

OWNERSHIP_SCOPED_TABLES = set()

SHARED_REFERENCE_TABLES = frozenset({"chu_dau_tu", "nha_thau"})

BIDDER_GOODS_EDITABLE_PACKAGE_STATUSES = frozenset({
    "OPENED",
    "EVALUATING",
    "PARTIALLY_AWARDED",
    "Đã mở thầu",
    "Đang chấm thầu",
    "Đã có kết quả một phần",
})


@dataclass(frozen=True)
class AccessDecision:
    allowed: bool
    message: str = ""


@dataclass(slots=True)
class BatchWriteAuthorizationContext:
    role_str: object
    user_id: str
    organization_id: str
    organization_manager: bool
    personal_workspace_owner: bool
    active_membership: bool
    inherited_specialist_access: bool
    membership_role: str | None
    permissions: dict[str, str] = field(default_factory=dict)
    existing_assignment_targets: set[tuple[str, str]] = field(default_factory=set)
    assigned_targets: set[tuple[str, str]] = field(default_factory=set)
    lineage_root_by_item: dict[tuple[str, str], str] = field(default_factory=dict)
    assigned_lineages: set[tuple[str, str]] = field(default_factory=set)
    owned_lineages: set[tuple[str, str]] = field(default_factory=set)
    opening_parent_by_id: dict[str, str] = field(default_factory=dict)
    goods_parent_by_id: dict[str, str] = field(default_factory=dict)
    bidder_goods_parent_by_id: dict[str, str] = field(default_factory=dict)
    package_status_by_id: dict[str, str] = field(default_factory=dict)
    snapshot_package_ids: set[str] = field(default_factory=set)


_QUERY_CHUNK_SIZE = 500


@dataclass(frozen=True)
class DocumentExportCapabilities:
    """Effective permission to place sensitive field families in a document."""

    financial: bool = False
    identity: bool = False
    signature: bool = False

    @classmethod
    def allow_all(cls):
        return cls(financial=True, identity=True, signature=True)

    def as_dict(self):
        return {
            "financial": self.financial,
            "identity": self.identity,
            "signature": self.signature,
        }


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
        "SELECT 1 FROM tai_khoan WHERE id = ? AND vai_tro != 'super_admin' LIMIT 1",
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
    """Keep operational edit rights when an admin or manager acts as employee."""

    if getattr(role_str, "active_role", None) != "employee":
        return False
    platform_role = str(getattr(role_str, "platform_role", "") or "").strip().lower()
    if platform_role in PLATFORM_ADMIN_ROLES:
        return True
    return organization_membership_role(
        cursor, user_id, organization_id
    ) in ORGANIZATION_MANAGER_ROLES


def _stored_document_export_capabilities(cursor, user_id, organization_id):
    row = cursor.execute(
        """SELECT financial, identity, signature
           FROM document_export_capabilities
           WHERE organization_id = ? AND user_id = ?
           LIMIT 1""",
        (organization_id, user_id),
    ).fetchone()
    if not row:
        return DocumentExportCapabilities()
    return DocumentExportCapabilities(
        financial=bool(row[0]),
        identity=bool(row[1]),
        signature=bool(row[2]),
    )


def resolve_document_export_capabilities(cursor, role_str, user_id, organization_id):
    """Resolve field-family grants after workspace and subscription checks."""

    if not can_use_word_export(cursor, role_str, user_id, organization_id):
        return DocumentExportCapabilities()
    if is_personal_workspace_owner(cursor, user_id, organization_id):
        return DocumentExportCapabilities.allow_all()
    if is_organization_manager(cursor, role_str, user_id, organization_id):
        return DocumentExportCapabilities.allow_all()
    if has_active_organization_membership(cursor, role_str, user_id, organization_id):
        return _stored_document_export_capabilities(
            cursor, user_id, organization_id
        )
    return DocumentExportCapabilities()


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
    if has_inherited_specialist_access(
        cursor, role_str, user_id, organization_id
    ):
        return True
    if not has_active_organization_membership(cursor, role_str, user_id, organization_id):
        return False
    if module_name in {"chudautu", "nhathau"}:
        return True
    permission = _permission_for(cursor, organization_id, user_id, module_name)
    if action == "edit":
        return permission == "edit"
    return permission in {"view", "edit"}


def can_read_word_config(cursor, role_str, user_id, organization_id):
    """Allow members to use the Word configuration of the active workspace."""

    if not can_use_word_export(cursor, role_str, user_id, organization_id):
        return False
    if is_organization_manager(cursor, role_str, user_id, organization_id):
        return True
    if is_personal_workspace_owner(cursor, user_id, organization_id):
        return True
    return has_active_organization_membership(
        cursor, role_str, user_id, organization_id
    )


def can_manage_word_config(cursor, role_str, user_id, organization_id):
    """Allow only a personal owner or organization manager to change Word config."""

    if not can_read_word_config(cursor, role_str, user_id, organization_id):
        return False
    return bool(
        is_personal_workspace_owner(cursor, user_id, organization_id)
        or is_organization_manager(cursor, role_str, user_id, organization_id)
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
    target_type = ASSIGNED_TABLE_TYPES.get(table_name)
    if not target_type:
        return True
    if table_name == "ke_hoach_lcnt":
        row = cursor.execute(
            """SELECT EXISTS (
                   SELECT 1
                   FROM ke_hoach_lcnt AS record
                   WHERE record.organization_id = ?
                     AND COALESCE(NULLIF(record.id_goc, ''), record.id) = ?
                     AND (
                         EXISTS (
                             SELECT 1 FROM phan_cong_nhan_su AS assignment
                             WHERE assignment.organization_id = record.organization_id
                               AND assignment.id_nhan_vien = ?
                               AND assignment.id_muc_tieu = record.id
                               AND assignment.loai_doi_tuong = 'kehoach'
                         )
                         OR EXISTS (
                             SELECT 1
                             FROM goi_thau AS package
                             JOIN phan_cong_nhan_su AS assignment
                               ON assignment.organization_id = package.organization_id
                              AND assignment.id_muc_tieu = package.id
                              AND assignment.loai_doi_tuong = 'goithau'
                             WHERE package.organization_id = record.organization_id
                               AND package.ke_hoach_id = record.id
                               AND assignment.id_nhan_vien = ?
                         )
                     )
               )""",
            (organization_id, lineage_root, user_id, user_id),
        ).fetchone()
    else:
        row = cursor.execute(
            f"""SELECT EXISTS (
                   SELECT 1
                   FROM {table_name} AS record
                   JOIN phan_cong_nhan_su AS assignment
                     ON assignment.organization_id = record.organization_id
                    AND assignment.id_muc_tieu = record.id
                    AND assignment.loai_doi_tuong = ?
                   WHERE record.organization_id = ?
                     AND COALESCE(NULLIF(record.id_goc, ''), record.id) = ?
                     AND assignment.id_nhan_vien = ?
               )""",
            (target_type, organization_id, lineage_root, user_id),
        ).fetchone()
    return bool(row and row[0])


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


def _row_value(row, name, index):
    try:
        return row[name]
    except (KeyError, TypeError):
        return row[index]


def _chunked(values):
    for offset in range(0, len(values), _QUERY_CHUNK_SIZE):
        yield values[offset:offset + _QUERY_CHUNK_SIZE]


def _load_assigned_lineages(
    cursor,
    organization_id,
    user_id,
    table_name,
    lineage_roots,
):
    assigned = set()
    target_type = ASSIGNED_TABLE_TYPES[table_name]
    for chunk in _chunked(lineage_roots):
        placeholders = ", ".join("?" for _ in chunk)
        if table_name == "ke_hoach_lcnt":
            rows = cursor.execute(
                f"""SELECT DISTINCT COALESCE(NULLIF(record.id_goc, ''), record.id) AS lineage_root
                    FROM ke_hoach_lcnt AS record
                    WHERE record.organization_id = ?
                      AND COALESCE(NULLIF(record.id_goc, ''), record.id) IN ({placeholders})
                      AND (
                          EXISTS (
                              SELECT 1 FROM phan_cong_nhan_su AS assignment
                              WHERE assignment.organization_id = record.organization_id
                                AND assignment.id_nhan_vien = ?
                                AND assignment.id_muc_tieu = record.id
                                AND assignment.loai_doi_tuong = 'kehoach'
                          )
                          OR EXISTS (
                              SELECT 1
                              FROM goi_thau AS package
                              JOIN phan_cong_nhan_su AS assignment
                                ON assignment.organization_id = package.organization_id
                               AND assignment.id_muc_tieu = package.id
                               AND assignment.loai_doi_tuong = 'goithau'
                              WHERE package.organization_id = record.organization_id
                                AND package.ke_hoach_id = record.id
                                AND assignment.id_nhan_vien = ?
                          )
                      )""",
                (organization_id, *chunk, user_id, user_id),
            ).fetchall()
        else:
            rows = cursor.execute(
                f"""SELECT DISTINCT COALESCE(NULLIF(record.id_goc, ''), record.id) AS lineage_root
                    FROM {table_name} AS record
                    JOIN phan_cong_nhan_su AS assignment
                      ON assignment.organization_id = record.organization_id
                     AND assignment.id_muc_tieu = record.id
                     AND assignment.loai_doi_tuong = ?
                    WHERE record.organization_id = ?
                      AND assignment.id_nhan_vien = ?
                      AND COALESCE(NULLIF(record.id_goc, ''), record.id) IN ({placeholders})""",
                (target_type, organization_id, user_id, *chunk),
            ).fetchall()
        assigned.update(str(_row_value(row, "lineage_root", 0)) for row in rows)
    return assigned


def build_batch_write_authorization_context(
    cursor,
    role_str,
    user_id,
    organization_id,
    records_by_table,
):
    """Prefetch all stable authorization inputs needed for a sync batch."""

    platform_manager = is_manager_role(role_str)
    membership_role = (
        None
        if platform_manager
        else organization_membership_role(cursor, user_id, organization_id)
    )
    active_role = getattr(role_str, "active_role", None)
    organization_manager = bool(
        active_role != "employee"
        and (platform_manager or membership_role in ORGANIZATION_MANAGER_ROLES)
    )
    personal_owner = is_personal_workspace_owner(cursor, user_id, organization_id)
    active_membership = bool(platform_manager or membership_role is not None)
    inherited_access = bool(
        active_role == "employee"
        and (
            str(getattr(role_str, "platform_role", "") or "").strip().lower()
            in PLATFORM_ADMIN_ROLES
            or membership_role in ORGANIZATION_MANAGER_ROLES
        )
    )
    context = BatchWriteAuthorizationContext(
        role_str=role_str,
        user_id=str(user_id),
        organization_id=str(organization_id),
        organization_manager=organization_manager,
        personal_workspace_owner=personal_owner,
        active_membership=active_membership,
        inherited_specialist_access=inherited_access,
        membership_role=membership_role,
    )

    modules = sorted({
        module
        for table_name in records_by_table
        if (module := TABLE_TO_MODULE.get(table_name))
        and module not in {"chudautu", "nhathau"}
    })
    if (
        modules
        and active_membership
        and not organization_manager
        and not personal_owner
        and not inherited_access
    ):
        row = cursor.execute(
            f"SELECT {', '.join(modules)} FROM ma_tran_phan_quyen "
            "WHERE organization_id = ? AND emp_id = ?",
            (organization_id, user_id),
        ).fetchone()
        if row:
            context.permissions.update(
                (module, str(_row_value(row, module, index) or "").strip().lower())
                for index, module in enumerate(modules)
            )

    assignment_target_ids_by_table = {}
    assignment_targets = set()
    incoming_self_assignment_targets = set()
    for item in records_by_table.get("phan_cong_nhan_su", ()):
        target_id = clean_id(item.get("targetId") or item.get("id_muc_tieu"))
        target_type = str(item.get("type") or item.get("loai_doi_tuong") or "").strip()
        target_table = {
            "kehoach": "ke_hoach_lcnt",
            "goithau": "goi_thau",
            "hopdong": "hop_dong",
        }.get(target_type)
        if target_id and target_table:
            assignment_target_ids_by_table.setdefault(target_table, set()).add(target_id)
            assignment_targets.add((target_type, target_id))
            employee_id = clean_id(item.get("empId") or item.get("id_nhan_vien"))
            if employee_id == clean_id(user_id):
                incoming_self_assignment_targets.add((target_type, target_id))
    for table_name, target_ids in assignment_target_ids_by_table.items():
        for chunk in _chunked(sorted(target_ids)):
            placeholders = ", ".join("?" for _ in chunk)
            rows = cursor.execute(
                f"""SELECT id FROM {table_name}
                    WHERE organization_id = ? AND id IN ({placeholders})""",
                (organization_id, *chunk),
            ).fetchall()
            context.existing_assignment_targets.update(
                (ASSIGNED_TABLE_TYPES[table_name], str(_row_value(row, "id", 0)))
                for row in rows
            )
    context.assigned_targets.update(
        target
        for target in incoming_self_assignment_targets
        if target not in context.existing_assignment_targets
    )

    opening_parent_ids = set()
    opening_record_ids = []
    for item in records_by_table.get("thong_tin_mo_thau", ()):
        parent_id = clean_id(item.get("goiThauId") or item.get("goi_thau_id"))
        record_id = clean_id(item.get("id"))
        if parent_id:
            opening_parent_ids.add(parent_id)
        if record_id:
            opening_record_ids.append(record_id)
    for chunk in _chunked(list(dict.fromkeys(opening_record_ids))):
        placeholders = ", ".join("?" for _ in chunk)
        rows = cursor.execute(
            f"""SELECT id, goi_thau_id FROM thong_tin_mo_thau
                WHERE organization_id = ? AND id IN ({placeholders})""",
            (organization_id, *chunk),
        ).fetchall()
        for row in rows:
            record_id = str(_row_value(row, "id", 0))
            parent_id = clean_id(_row_value(row, "goi_thau_id", 1))
            if parent_id:
                context.opening_parent_by_id[record_id] = parent_id
                opening_parent_ids.add(parent_id)

    goods_parent_ids = set()
    goods_record_ids = []
    for item in records_by_table.get("goi_thau_hang_hoa", ()):
        parent_id = clean_id(item.get("goiThauId") or item.get("goi_thau_id"))
        record_id = clean_id(item.get("id"))
        if parent_id:
            goods_parent_ids.add(parent_id)
        if record_id:
            goods_record_ids.append(record_id)
    for chunk in _chunked(list(dict.fromkeys(goods_record_ids))):
        placeholders = ", ".join("?" for _ in chunk)
        rows = cursor.execute(
            f"""SELECT id, goi_thau_id FROM goi_thau_hang_hoa
                WHERE organization_id = ? AND id IN ({placeholders})""",
            (organization_id, *chunk),
        ).fetchall()
        for row in rows:
            record_id = str(_row_value(row, "id", 0))
            parent_id = clean_id(_row_value(row, "goi_thau_id", 1))
            if parent_id:
                context.goods_parent_by_id[record_id] = parent_id
                goods_parent_ids.add(parent_id)

    bidder_goods_parent_ids = set()
    bidder_goods_record_ids = []
    for item in records_by_table.get("hang_hoa_du_thau_nha_thau", ()):
        parent_id = clean_id(item.get("goiThauId") or item.get("goi_thau_id"))
        record_id = clean_id(item.get("id"))
        if parent_id:
            bidder_goods_parent_ids.add(parent_id)
        if record_id:
            bidder_goods_record_ids.append(record_id)
    for chunk in _chunked(list(dict.fromkeys(bidder_goods_record_ids))):
        placeholders = ", ".join("?" for _ in chunk)
        rows = cursor.execute(
            f"""SELECT id, goi_thau_id FROM hang_hoa_du_thau_nha_thau
                WHERE organization_id = ? AND id IN ({placeholders})""",
            (organization_id, *chunk),
        ).fetchall()
        for row in rows:
            record_id = str(_row_value(row, "id", 0))
            parent_id = clean_id(_row_value(row, "goi_thau_id", 1))
            if parent_id:
                context.bidder_goods_parent_by_id[record_id] = parent_id
                bidder_goods_parent_ids.add(parent_id)

    package_parent_ids = sorted(opening_parent_ids | goods_parent_ids | bidder_goods_parent_ids)
    for chunk in _chunked(package_parent_ids):
        placeholders = ", ".join("?" for _ in chunk)
        rows = cursor.execute(
            f"""SELECT id, trang_thai FROM goi_thau
                WHERE organization_id = ? AND id IN ({placeholders})""",
            (organization_id, *chunk),
        ).fetchall()
        context.package_status_by_id.update(
            (str(_row_value(row, "id", 0)), str(_row_value(row, "trang_thai", 1) or ""))
            for row in rows
        )
    for package in records_by_table.get("goi_thau", ()):
        package_id = clean_id(package.get("id"))
        if package_id:
            context.package_status_by_id[package_id] = str(
                package.get("trangThai") or package.get("trang_thai") or "Chuẩn bị"
            )

    all_assignment_targets = assignment_targets | {
        ("goithau", parent_id) for parent_id in opening_parent_ids
    } | {("goithau", parent_id) for parent_id in goods_parent_ids}
    all_assignment_targets |= {
        ("goithau", parent_id) for parent_id in bidder_goods_parent_ids
    }
    target_ids = sorted({target_id for _target_type, target_id in all_assignment_targets})
    for chunk in _chunked(target_ids):
        placeholders = ", ".join("?" for _ in chunk)
        rows = cursor.execute(
            f"""SELECT id_muc_tieu, loai_doi_tuong
                FROM phan_cong_nhan_su
                WHERE organization_id = ? AND id_nhan_vien = ?
                  AND id_muc_tieu IN ({placeholders})""",
            (organization_id, user_id, *chunk),
        ).fetchall()
        context.assigned_targets.update(
            (
                str(_row_value(row, "loai_doi_tuong", 1)),
                str(_row_value(row, "id_muc_tieu", 0)),
            )
            for row in rows
        )

    lineage_roots_by_table = {}
    for table_name in ASSIGNED_TABLE_TYPES:
        candidates = set()
        for item in records_by_table.get(table_name, ()):
            record_id = clean_id(item.get("id"))
            requested_root = clean_id(item.get("rootId") or item.get("id_goc"))
            if record_id:
                candidates.add(record_id)
            if requested_root:
                candidates.add(requested_root)
        for chunk in _chunked(sorted(candidates)):
            placeholders = ", ".join("?" for _ in chunk)
            rows = cursor.execute(
                f"""SELECT id, COALESCE(NULLIF(id_goc, ''), id) AS lineage_root
                    FROM {table_name}
                    WHERE organization_id = ?
                      AND (id IN ({placeholders}) OR id_goc IN ({placeholders}))""",
                (organization_id, *chunk, *chunk),
            ).fetchall()
            for row in rows:
                record_id = str(_row_value(row, "id", 0))
                lineage_root = str(_row_value(row, "lineage_root", 1))
                context.lineage_root_by_item[(table_name, record_id)] = lineage_root
                context.lineage_root_by_item[(table_name, lineage_root)] = lineage_root
                lineage_roots_by_table.setdefault(table_name, set()).add(lineage_root)

    for table_name, roots in lineage_roots_by_table.items():
        sorted_roots = sorted(roots)
        context.assigned_lineages.update(
            (table_name, root)
            for root in _load_assigned_lineages(
                cursor,
                organization_id,
                user_id,
                table_name,
                sorted_roots,
            )
        )
        if table_name in OWNERSHIP_SCOPED_TABLES:
            for chunk in _chunked(sorted_roots):
                placeholders = ", ".join("?" for _ in chunk)
                rows = cursor.execute(
                    f"""SELECT record_id FROM record_edit_ownership
                        WHERE organization_id = ? AND user_id = ?
                          AND table_name = ? AND record_id IN ({placeholders})""",
                    (organization_id, user_id, table_name, *chunk),
                ).fetchall()
                context.owned_lineages.update(
                    (table_name, str(_row_value(row, "record_id", 0)))
                    for row in rows
                )
    for package in records_by_table.get("goi_thau", ()):
        package_id = clean_id(package.get("id"))
        requested_root = clean_id(package.get("rootId") or package.get("id_goc"))
        if not package_id or not requested_root or package_id == requested_root:
            continue
        if context.lineage_root_by_item.get(("goi_thau", requested_root)):
            context.snapshot_package_ids.add(package_id)
    return context


def _context_has_module_permission(context, module_name, action="view"):
    if (
        context.organization_manager
        or context.personal_workspace_owner
        or context.inherited_specialist_access
    ):
        return True
    if not context.active_membership:
        return False
    if module_name in {"chudautu", "nhathau"}:
        return True
    permission = context.permissions.get(module_name, "")
    return permission == "edit" if action == "edit" else permission in {"view", "edit"}


def _resolve_child_parent(parent_by_record_id, item):
    record_id = clean_id(item.get("id"))
    requested_parent = clean_id(
        item.get("goiThauId") or item.get("goi_thau_id")
    )
    stored_parent = parent_by_record_id.get(record_id)
    parent_changed = bool(
        stored_parent and requested_parent and stored_parent != requested_parent
    )
    return stored_parent or requested_parent, parent_changed


def authorize_record_write_from_context(context, payload_key, table_name, item):
    """Authorize one record using only prefetched batch context."""

    if payload_key == "permissionmatrix":
        if is_manager_role(context.role_str):
            return AccessDecision(
                False,
                "Super Admin không được cấu hình quyền theo phân hệ của tổ chức.",
            )
        if context.membership_role not in ORGANIZATION_MANAGER_ROLES:
            return AccessDecision(
                False,
                "Chỉ Quản lý của tổ chức được cấu hình quyền theo phân hệ cho chuyên viên.",
            )
        return AccessDecision(True)
    if table_name == "phan_cong_nhan_su" and not context.organization_manager and not is_manager_role(context.role_str):
        employee_id = clean_id(item.get("empId") or item.get("id_nhan_vien"))
        target_id = clean_id(item.get("targetId") or item.get("id_muc_tieu"))
        target_type = str(item.get("type") or item.get("loai_doi_tuong") or "").strip()
        if employee_id != clean_id(context.user_id):
            return AccessDecision(False, "Chuyên viên chỉ được tự nhận bản ghi do mình tạo.")
        if not target_id or target_type not in {"kehoach", "goithau", "hopdong"}:
            return AccessDecision(False, "Mục tiêu phân công không hợp lệ.")
        target = (target_type, target_id)
        if target in context.existing_assignment_targets and target not in context.assigned_targets:
            return AccessDecision(False, "Không được tự nhận một bản ghi đã tồn tại và chưa được phân công.")
        return AccessDecision(True)
    key_decision = authorize_payload_key_write(
        context.role_str,
        payload_key,
        organization_manager=context.organization_manager,
    )
    if not key_decision.allowed:
        return key_decision
    child_parent_id = None
    child_parent_maps = {
        "thong_tin_mo_thau": context.opening_parent_by_id,
        "goi_thau_hang_hoa": context.goods_parent_by_id,
        "hang_hoa_du_thau_nha_thau": context.bidder_goods_parent_by_id,
    }
    if table_name in child_parent_maps:
        child_parent_id, parent_changed = _resolve_child_parent(
            child_parent_maps[table_name],
            item,
        )
        if parent_changed:
            return AccessDecision(
                False,
                "Kh\u00f4ng \u0111\u01b0\u1ee3c thay \u0111\u1ed5i g\u00f3i th\u1ea7u cha c\u1ee7a b\u1ea3n ghi \u0111\u00e3 t\u1ed3n t\u1ea1i.",
            )
    goods_parent_id = None
    if table_name == "goi_thau_hang_hoa":
        goods_parent_id = child_parent_id
        record_id = clean_id(item.get("id"))
        creates_snapshot_child = bool(
            record_id
            and goods_parent_id in context.snapshot_package_ids
            and record_id not in context.goods_parent_by_id
        )
        if (
            not creates_snapshot_child
            and context.package_status_by_id.get(goods_parent_id)
            not in {"PREPARING", "Chuẩn bị"}
        ):
            return AccessDecision(False, "Danh mục hàng hóa chỉ được sửa khi gói thầu ở trạng thái Chuẩn bị.")
    bidder_goods_parent_id = None
    if table_name == "hang_hoa_du_thau_nha_thau":
        bidder_goods_parent_id = child_parent_id
        record_id = clean_id(item.get("id"))
        creates_snapshot_child = bool(
            record_id
            and bidder_goods_parent_id in context.snapshot_package_ids
            and record_id not in context.bidder_goods_parent_by_id
        )
        if (
            not creates_snapshot_child
            and
            context.package_status_by_id.get(bidder_goods_parent_id)
            not in BIDDER_GOODS_EDITABLE_PACKAGE_STATUSES
        ):
            return AccessDecision(False, "Hàng hóa dự thầu chỉ được sửa trong giai đoạn đánh giá.")
    if context.organization_manager or context.personal_workspace_owner:
        return AccessDecision(True)
    module_name = TABLE_TO_MODULE.get(table_name)
    if table_name in SHARED_REFERENCE_TABLES and not context.active_membership:
        return AccessDecision(False, "Tài khoản không còn thuộc tổ chức này.")
    if table_name not in SHARED_REFERENCE_TABLES and not _context_has_module_permission(
        context, module_name, "edit"
    ):
        return AccessDecision(False, f"Không có quyền sửa phân hệ {module_name or table_name}.")
    if table_name == "thong_tin_mo_thau":
        parent_id = child_parent_id
        if ("goithau", parent_id) not in context.assigned_targets:
            return AccessDecision(False, "Không có quyền sửa bản ghi chưa được phân công.")
    elif table_name == "goi_thau_hang_hoa":
        if ("goithau", goods_parent_id) not in context.assigned_targets:
            return AccessDecision(False, "Không có quyền sửa gói thầu chưa được phân công.")
    elif table_name == "hang_hoa_du_thau_nha_thau":
        if ("goithau", bidder_goods_parent_id) not in context.assigned_targets:
            return AccessDecision(False, "Không có quyền sửa gói thầu chưa được phân công.")
    elif table_name in OWNERSHIP_SCOPED_TABLES:
        record_id = clean_id(item.get("id"))
        requested_root = clean_id(item.get("rootId") or item.get("id_goc"))
        lineage_root = context.lineage_root_by_item.get(
            (table_name, record_id),
            context.lineage_root_by_item.get((table_name, requested_root)),
        )
        if lineage_root and (table_name, lineage_root) not in context.owned_lineages:
            return AccessDecision(False, "Chuyên viên chỉ được sửa dữ liệu do mình tạo.")
    elif table_name in ASSIGNED_TABLE_TYPES:
        record_id = clean_id(item.get("id"))
        requested_root = clean_id(item.get("rootId") or item.get("id_goc"))
        lineage_root = context.lineage_root_by_item.get(
            (table_name, record_id),
            context.lineage_root_by_item.get((table_name, requested_root)),
        )
        if lineage_root and (table_name, lineage_root) not in context.assigned_lineages:
            return AccessDecision(False, "Không có quyền sửa bản ghi chưa được phân công.")
        return AccessDecision(True)
    return AccessDecision(True)


def authorize_payload_key_write(role_str, payload_key, *, organization_manager=False):
    if is_manager_role(role_str) or organization_manager:
        return AccessDecision(True)
    if payload_key in WRITE_PROTECTED_KEYS:
        return AccessDecision(False, f"Không có quyền đồng bộ {payload_key}.")
    return AccessDecision(True)


def authorize_record_write(cursor, role_str, user_id, organization_id, payload_key, table_name, item):
    if payload_key == "permissionmatrix":
        if is_manager_role(role_str):
            return AccessDecision(
                False,
                "Super Admin không được cấu hình quyền theo phân hệ của tổ chức.",
            )
        membership_role = organization_membership_role(cursor, user_id, organization_id)
        if membership_role not in ORGANIZATION_MANAGER_ROLES:
            return AccessDecision(
                False,
                "Chỉ Quản lý của tổ chức được cấu hình quyền theo phân hệ cho chuyên viên.",
            )
        return AccessDecision(True)
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
    goods_parent_id = None
    if table_name == "goi_thau_hang_hoa":
        goods_parent_id = clean_id(item.get("goiThauId") or item.get("goi_thau_id"))
        if not goods_parent_id:
            record_id = clean_id(item.get("id"))
            row = cursor.execute(
                "SELECT goods.goi_thau_id, package.trang_thai FROM goi_thau_hang_hoa AS goods JOIN goi_thau AS package ON package.organization_id = goods.organization_id AND package.id = goods.goi_thau_id WHERE goods.organization_id = ? AND goods.id = ?",
                (organization_id, record_id),
            ).fetchone()
            goods_parent_id = clean_id(row[0]) if row else None
            goods_status = str(row[1] or "") if row else ""
        else:
            row = cursor.execute(
                "SELECT trang_thai FROM goi_thau WHERE organization_id = ? AND id = ?",
                (organization_id, goods_parent_id),
            ).fetchone()
            goods_status = str(row[0] or "") if row else ""
        if goods_status not in {"PREPARING", "Chuẩn bị"}:
            return AccessDecision(False, "Danh mục hàng hóa chỉ được sửa khi gói thầu ở trạng thái Chuẩn bị.")
    bidder_goods_parent_id = None
    if table_name == "hang_hoa_du_thau_nha_thau":
        bidder_goods_parent_id = clean_id(item.get("goiThauId") or item.get("goi_thau_id"))
        if not bidder_goods_parent_id:
            record_id = clean_id(item.get("id"))
            row = cursor.execute(
                "SELECT goods.goi_thau_id, package.trang_thai FROM hang_hoa_du_thau_nha_thau AS goods JOIN goi_thau AS package ON package.organization_id = goods.organization_id AND package.id = goods.goi_thau_id WHERE goods.organization_id = ? AND goods.id = ?",
                (organization_id, record_id),
            ).fetchone()
            bidder_goods_parent_id = clean_id(row[0]) if row else None
            bidder_goods_status = str(row[1] or "") if row else ""
        else:
            row = cursor.execute(
                "SELECT trang_thai FROM goi_thau WHERE organization_id = ? AND id = ?",
                (organization_id, bidder_goods_parent_id),
            ).fetchone()
            bidder_goods_status = str(row[0] or "") if row else ""
        if bidder_goods_status not in BIDDER_GOODS_EDITABLE_PACKAGE_STATUSES:
            return AccessDecision(False, "Hàng hóa dự thầu chỉ được sửa trong giai đoạn đánh giá.")
    if organization_manager:
        return AccessDecision(True)
    if is_personal_workspace_owner(cursor, user_id, organization_id):
        return AccessDecision(True)

    module_name = TABLE_TO_MODULE.get(table_name)
    if (
        table_name in SHARED_REFERENCE_TABLES
        and not has_active_organization_membership(
            cursor, role_str, user_id, organization_id
        )
    ):
        return AccessDecision(False, "Tài khoản không còn thuộc tổ chức này.")
    if (
        table_name not in SHARED_REFERENCE_TABLES
        and not has_module_permission(
            cursor, role_str, user_id, organization_id, module_name, "edit"
        )
    ):
        return AccessDecision(False, f"Không có quyền sửa phân hệ {module_name or table_name}.")

    if table_name == "goi_thau_hang_hoa":
        if not _assigned(cursor, organization_id, user_id, goods_parent_id, "goithau"):
            return AccessDecision(False, "Không có quyền sửa gói thầu chưa được phân công.")
    elif table_name == "hang_hoa_du_thau_nha_thau":
        if not _assigned(cursor, organization_id, user_id, bidder_goods_parent_id, "goithau"):
            return AccessDecision(False, "Không có quyền sửa gói thầu chưa được phân công.")
    elif table_name == "thong_tin_mo_thau":
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
    if table_name in SHARED_REFERENCE_TABLES:
        return True
    if payload_key in {"assignments", "permissionmatrix"}:
        return True
    module_name = TABLE_TO_MODULE.get(table_name)
    return has_module_permission(cursor, role_str, user_id, organization_id, module_name, "view")


def can_read_record(cursor, role_str, user_id, organization_id, payload_key, table_name, item_or_id):
    if is_organization_manager(cursor, role_str, user_id, organization_id):
        return True
    if is_personal_workspace_owner(cursor, user_id, organization_id):
        return payload_key not in WRITE_PROTECTED_KEYS
    if not can_read_table(cursor, role_str, user_id, organization_id, payload_key, table_name):
        return False
    if table_name not in ASSIGNED_TABLE_TYPES and table_name not in {"thong_tin_mo_thau", "goi_thau_hang_hoa", "hang_hoa_du_thau_nha_thau"}:
        return True
    if table_name == "goi_thau_hang_hoa":
        record_id = clean_id(item_or_id.get("id") if isinstance(item_or_id, dict) else item_or_id)
        parent_id = clean_id(item_or_id.get("goiThauId") or item_or_id.get("goi_thau_id")) if isinstance(item_or_id, dict) else None
        if not parent_id and record_id:
            row = cursor.execute(
                "SELECT goi_thau_id FROM goi_thau_hang_hoa WHERE organization_id = ? AND id = ?",
                (organization_id, record_id),
            ).fetchone()
            parent_id = clean_id(row[0]) if row else None
        return _assigned(cursor, organization_id, user_id, parent_id, "goithau")
    if table_name == "hang_hoa_du_thau_nha_thau":
        record_id = clean_id(item_or_id.get("id") if isinstance(item_or_id, dict) else item_or_id)
        parent_id = clean_id(item_or_id.get("goiThauId") or item_or_id.get("goi_thau_id")) if isinstance(item_or_id, dict) else None
        if not parent_id and record_id:
            row = cursor.execute(
                "SELECT goi_thau_id FROM hang_hoa_du_thau_nha_thau WHERE organization_id = ? AND id = ?",
                (organization_id, record_id),
            ).fetchone()
            parent_id = clean_id(row[0]) if row else None
        return _assigned(cursor, organization_id, user_id, parent_id, "goithau")
    return _assigned_for_table(cursor, organization_id, user_id, table_name, item_or_id)


def filter_items_for_read(cursor, role_str, user_id, organization_id, payload_key, table_name, items):
    if is_organization_manager(cursor, role_str, user_id, organization_id):
        return list(items or [])
    if is_personal_workspace_owner(cursor, user_id, organization_id):
        return list(items or []) if payload_key not in WRITE_PROTECTED_KEYS else []

    source_items = list(items or [])
    if payload_key == "assignments":
        return [item for item in source_items if str(item.get("empId") or "") == str(user_id)]
    if payload_key == "permissionmatrix":
        return [item for item in source_items if str(item.get("empId") or "") == str(user_id)]
    if not can_read_table(cursor, role_str, user_id, organization_id, payload_key, table_name):
        return []
    if table_name not in ASSIGNED_TABLE_TYPES and table_name not in {"thong_tin_mo_thau", "goi_thau_hang_hoa", "hang_hoa_du_thau_nha_thau"}:
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
    elif table_name == "goi_thau_hang_hoa":
        rows = cursor.execute(
            f"""SELECT goods.id
                FROM goi_thau_hang_hoa AS goods
                JOIN phan_cong_nhan_su AS pc
                  ON pc.organization_id = goods.organization_id
                 AND pc.id_muc_tieu = goods.goi_thau_id
                 AND pc.loai_doi_tuong = 'goithau'
                WHERE goods.organization_id = ? AND pc.id_nhan_vien = ?
                  AND goods.id IN ({placeholders})""",
            (organization_id, user_id, *record_ids),
        ).fetchall()
    elif table_name == "hang_hoa_du_thau_nha_thau":
        rows = cursor.execute(
            f"""SELECT goods.id
                FROM hang_hoa_du_thau_nha_thau AS goods
                JOIN phan_cong_nhan_su AS pc
                  ON pc.organization_id = goods.organization_id
                 AND pc.id_muc_tieu = goods.goi_thau_id
                 AND pc.loai_doi_tuong = 'goithau'
                WHERE goods.organization_id = ? AND pc.id_nhan_vien = ?
                  AND goods.id IN ({placeholders})""",
            (organization_id, user_id, *record_ids),
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
