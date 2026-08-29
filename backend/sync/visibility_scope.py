"""SQL-pushed record visibility shared by sync reads and manifests."""

from __future__ import annotations

from dataclasses import dataclass

from backend.shared.access_policy import (
    ORGANIZATION_MANAGER_ROLES,
    WRITE_PROTECTED_KEYS,
    is_organization_manager,
    is_personal_workspace_owner,
)
from backend.shared.module_registry import TABLE_TO_MODULE
from backend.sync.queries import TABLE_KEYS


@dataclass(frozen=True)
class SqlPredicate:
    sql: str
    parameters: tuple = ()


_ASSIGNMENT_TYPES = {
    "ke_hoach_lcnt": "kehoach",
    "goi_thau": "goithau",
    "hop_dong": "hopdong",
}
_PACKAGE_CHILDREN = frozenset(
    {
        "thong_tin_mo_thau",
        "goi_thau_hang_hoa",
        "hang_hoa_du_thau_nha_thau",
    }
)
_PAYLOAD_BY_TABLE = {table: key for key, table in TABLE_KEYS.items()}


def scoped_deletion_branches(visibility_scope, alias="deleted_row", payload_keys=None):
    """Return every tombstone payload branch with its canonical visibility predicate."""

    allowed = set(payload_keys) if payload_keys else None
    return tuple(
        (
            payload_key,
            table_name,
            visibility_scope.deletion_predicate(table_name, alias),
        )
        for payload_key, table_name in TABLE_KEYS.items()
        if allowed is None or payload_key in allowed
    )


@dataclass(frozen=True)
class VisibilityScope:
    organization_id: str
    user_id: str
    unrestricted: bool
    permissions: dict[str, str]

    @classmethod
    def resolve(cls, cursor, role_str, user_id, organization_id):
        unrestricted = bool(
            is_organization_manager(
                cursor, role_str, user_id, organization_id
            )
            or is_personal_workspace_owner(cursor, user_id, organization_id)
        )
        permissions = {}
        if not unrestricted:
            columns = sorted(set(TABLE_TO_MODULE.values()))
            row = cursor.execute(
                "SELECT lower(trim(member.vai_tro_trong_to_chuc)), "  # noqa: S608 - columns come from canonical module registry
                + ", ".join(f"permission.{column}" for column in columns)
                + " FROM thanh_vien_to_chuc AS member "
                "LEFT JOIN ma_tran_phan_quyen AS permission "
                "ON permission.organization_id = member.organization_id "
                "AND permission.emp_id = member.user_id "
                "WHERE member.organization_id = ? AND member.user_id = ? "
                "AND COALESCE(member.trang_thai_thanh_vien, 'active') = 'active' "
                "LIMIT 1",  # noqa: S608 - columns come from canonical module registry
                (organization_id, user_id),
            ).fetchone()
            if row:
                membership_role = str(row[0] or "").strip().lower()
                inherited_view = (
                    getattr(role_str, "active_role", None) == "employee"
                    and membership_role in ORGANIZATION_MANAGER_ROLES
                )
                for index, module in enumerate(columns, start=1):
                    stored_permission = str(row[index] or "").strip().lower()
                    if stored_permission == "edit":
                        permissions[module] = "edit"
                    elif stored_permission == "view" or inherited_view:
                        permissions[module] = "view"
        return cls(
            organization_id=str(organization_id),
            user_id=str(user_id),
            unrestricted=unrestricted,
            permissions=permissions,
        )

    def _has_module(self, table_name):
        module = TABLE_TO_MODULE.get(table_name)
        return self.permissions.get(module) in {"view", "edit"}

    def live_predicate(self, table_name, alias="source_row"):
        """Return a fixed SQL predicate applied before ordering and limiting."""

        if table_name not in _PAYLOAD_BY_TABLE:
            return SqlPredicate("FALSE")
        payload_key = _PAYLOAD_BY_TABLE[table_name]
        if self.unrestricted:
            if payload_key in WRITE_PROTECTED_KEYS and self.organization_id.startswith(
                "personal:"
            ):
                return SqlPredicate("FALSE")
            return SqlPredicate(
                f"{alias}.organization_id = ?", (self.organization_id,)
            )
        if payload_key in {"assignments", "permissionmatrix"}:
            owner_column = "id_nhan_vien" if payload_key == "assignments" else "emp_id"
            return SqlPredicate(
                f"{alias}.organization_id = ? AND {alias}.{owner_column} = ?",
                (self.organization_id, self.user_id),
            )
        if not self._has_module(table_name):
            return SqlPredicate("FALSE")
        if table_name == "ke_hoach_lcnt":
            return SqlPredicate(
                f"{alias}.organization_id = ? AND (EXISTS ("  # noqa: S608 - alias is internal constant
                "SELECT 1 FROM phan_cong_nhan_su AS pc "
                f"WHERE pc.organization_id = {alias}.organization_id "
                f"AND pc.id_muc_tieu = {alias}.id "
                "AND pc.id_nhan_vien = ? AND pc.loai_doi_tuong = 'kehoach'"
                ") OR EXISTS (SELECT 1 FROM goi_thau AS package "
                "JOIN phan_cong_nhan_su AS pc "
                "ON pc.organization_id = package.organization_id "
                "AND pc.id_muc_tieu = package.id "
                f"WHERE package.organization_id = {alias}.organization_id "
                f"AND package.ke_hoach_id = {alias}.id "
                "AND pc.id_nhan_vien = ? AND pc.loai_doi_tuong = 'goithau'))",
                (self.organization_id, self.user_id, self.user_id),  # noqa: S608 - alias is internal constant
            )
        if table_name in _PACKAGE_CHILDREN:
            return SqlPredicate(
                f"{alias}.organization_id = ? AND EXISTS ("  # noqa: S608 - alias is internal constant
                "SELECT 1 FROM phan_cong_nhan_su AS pc "
                f"WHERE pc.organization_id = {alias}.organization_id "
                f"AND pc.id_muc_tieu = {alias}.goi_thau_id "
                "AND pc.id_nhan_vien = ? AND pc.loai_doi_tuong = 'goithau')",
                (self.organization_id, self.user_id),  # noqa: S608 - alias is internal constant
            )
        assignment_type = _ASSIGNMENT_TYPES.get(table_name)
        if assignment_type:
            return SqlPredicate(
                f"{alias}.organization_id = ? AND EXISTS ("  # noqa: S608 - assignment type is allowlisted
                "SELECT 1 FROM phan_cong_nhan_su AS pc "
                f"WHERE pc.organization_id = {alias}.organization_id "
                f"AND pc.id_muc_tieu = {alias}.id "
                "AND pc.id_nhan_vien = ? "
                f"AND pc.loai_doi_tuong = '{assignment_type}')",
                (self.organization_id, self.user_id),  # noqa: S608 - assignment type is allowlisted
            )
        return SqlPredicate(
            f"{alias}.organization_id = ?", (self.organization_id,)
        )

    def deletion_predicate(self, table_name, alias="deleted_row"):
        """Restrict tombstones using server-captured pre-delete identity."""

        if table_name not in _PAYLOAD_BY_TABLE:
            return SqlPredicate("FALSE")
        payload_key = _PAYLOAD_BY_TABLE[table_name]
        tenant = f"{alias}.organization_id = ? AND {alias}.table_name = ?"
        base_parameters = (self.organization_id, table_name)
        if self.unrestricted:
            if payload_key in WRITE_PROTECTED_KEYS and self.organization_id.startswith(
                "personal:"
            ):
                return SqlPredicate("FALSE")
            return SqlPredicate(tenant, base_parameters)
        if not self._has_module(table_name) and payload_key not in {
            "assignments",
            "permissionmatrix",
        }:
            return SqlPredicate("FALSE")
        snapshot = (
            f"COALESCE(NULLIF({alias}.record_snapshot_json, ''), '{{}}')::jsonb"
        )

        def assignment_evidence(target_expression, assignment_type):
            return (  # noqa: S608 - alias/expression/type come from fixed registries
                "(EXISTS (SELECT 1 FROM phan_cong_nhan_su AS pc "  # noqa: S608 - fixed registry SQL
                f"WHERE pc.organization_id = {alias}.organization_id "
                f"AND pc.id_muc_tieu = {target_expression} "
                "AND pc.id_nhan_vien = ? "
                f"AND pc.loai_doi_tuong = '{assignment_type}') "
                "OR EXISTS (SELECT 1 FROM deleted_records AS deleted_assignment "
                f"WHERE deleted_assignment.organization_id = {alias}.organization_id "
                "AND deleted_assignment.table_name = 'phan_cong_nhan_su' "
                "AND COALESCE(NULLIF(deleted_assignment.record_snapshot_json, ''), '{}')::jsonb "
                f"->> 'id_muc_tieu' = {target_expression} "
                "AND COALESCE(NULLIF(deleted_assignment.record_snapshot_json, ''), '{}')::jsonb "
                "->> 'id_nhan_vien' = ? "
                "AND COALESCE(NULLIF(deleted_assignment.record_snapshot_json, ''), '{}')::jsonb "
                f"->> 'loai_doi_tuong' = '{assignment_type}'))"
            )  # noqa: S608 - alias/expression/type come from fixed registries
        if payload_key == "assignments":
            return SqlPredicate(
                tenant + f" AND {snapshot} ->> 'id_nhan_vien' = ?",
                (*base_parameters, self.user_id),
            )
        if payload_key == "permissionmatrix":
            return SqlPredicate(
                tenant + f" AND {snapshot} ->> 'emp_id' = ?",
                (*base_parameters, self.user_id),
            )
        if table_name == "ke_hoach_lcnt":
            return SqlPredicate(
                tenant + " AND ("  # noqa: S608 - alias is internal constant
                + assignment_evidence(f"{alias}.record_id", "kehoach")
                + " OR EXISTS (SELECT 1 FROM goi_thau AS package "  # noqa: S608 - fixed registry predicate
                f"WHERE package.organization_id = {alias}.organization_id "
                f"AND package.ke_hoach_id = {alias}.record_id AND "
                + assignment_evidence("package.id", "goithau")
                + ") OR EXISTS (SELECT 1 FROM deleted_records AS deleted_package "  # noqa: S608 - fixed registry predicate
                f"WHERE deleted_package.organization_id = {alias}.organization_id "
                "AND deleted_package.table_name = 'goi_thau' "
                "AND COALESCE(NULLIF(deleted_package.record_snapshot_json, ''), '{}')::jsonb "
                f"->> 'ke_hoach_id' = {alias}.record_id AND "
                + assignment_evidence("deleted_package.record_id", "goithau")
                + "))",
                (
                    *base_parameters,
                    self.user_id,
                    self.user_id,
                    self.user_id,
                    self.user_id,
                    self.user_id,
                    self.user_id,
                ),
            )
        if table_name in _PACKAGE_CHILDREN:
            return SqlPredicate(
                tenant + " AND "  # noqa: S608 - alias is internal constant
                + assignment_evidence(
                    f"{snapshot} ->> 'goi_thau_id'", "goithau"
                ),
                (*base_parameters, self.user_id, self.user_id),
            )
        assignment_type = _ASSIGNMENT_TYPES.get(table_name)
        if assignment_type:
            return SqlPredicate(
                tenant + " AND "  # noqa: S608 - assignment type is allowlisted
                + assignment_evidence(f"{alias}.record_id", assignment_type),
                (*base_parameters, self.user_id, self.user_id),
            )
        return SqlPredicate(tenant, base_parameters)
