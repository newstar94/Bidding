"""Execute synchronized deletions/archives as one authorization-aware use case."""

from backend.db.db_helper import IntegrityError


from backend.shared.access_policy import authorize_record_write, is_organization_manager
from backend.shared.media_helper import normalize_managed_image_path
from backend.sync.delete_policy import (
    ALWAYS_ARCHIVE_TABLES,
    ARCHIVABLE_TABLES,
    HIGH_IMPACT_DELETE_TABLES,
    archive_versioned_record,
    build_delete_impact,
    delete_assignment_dependents,
    find_blocking_delete_references,
    insert_delete_audit,
)
from backend.sync.mapper import map_db_to_json
from backend.sync.queries import TABLE_KEYS
from backend.sync.repository import DELETED_RECORD_UPSERT_SQL, VERSIONED_TABLES


def _is_actor_personal_scope(organization_id, actor_user_id):
    """Return True only for the actor's own implicit personal workspace."""

    return str(organization_id or "").strip() == f"personal:{str(actor_user_id or '').strip()}"


def apply_sync_deletions(
    cursor,
    deletions,
    *,
    organization_id,
    actor_role,
    actor_user_id,
    session_id,
    current_time,
    sync_version,
    clean_record_id,
    privileged_reauth_ttl_seconds,
    privileged_reauth_error_message,
    ip_address,
):
    result = {
        "errors": [],
        "impacts": [],
        "updatedVersionedTables": set(),
        "affectedVersionFamilies": {},
        "affectedPlanIds": set(),
        "imageCleanupCandidates": set(),
        "privilegedError": None,
    }
    if not isinstance(deletions, list):
        return result

    for deletion in deletions:
        if not isinstance(deletion, dict):
            continue
        table_key = deletion.get("table")
        if table_key not in TABLE_KEYS:
            continue
        table_name = TABLE_KEYS[table_key]
        record_id = clean_record_id(table_name, deletion.get("id"))
        if not record_id:
            continue
        row = cursor.execute(
            f"SELECT * FROM {table_name} WHERE organization_id = ? AND id = ? LIMIT 1",
            (organization_id, record_id),
        ).fetchone()
        if not row:
            continue
        record = dict(row)
        expected_version = deletion.get("expectedVersion")
        current_version = int(record.get("row_version") or 1)
        if expected_version != current_version:
            result["errors"].append({
                "table": table_name,
                "id": record_id,
                "field": "expectedVersion",
                "code": "ROW_VERSION_CONFLICT",
                "message": "Bản ghi cần xóa đã được thay đổi bởi một phiên làm việc khác.",
                "expectedVersion": expected_version,
                "currentVersion": current_version,
                "serverRecord": map_db_to_json(table_name, record),
            })
            continue
        if table_name in ARCHIVABLE_TABLES and record.get("archived_at"):
            continue
        for column in {
            "nha_thau": ("anh_dau",),
            "chuyen_gia": ("anh_chung_chi", "anh_chu_ky"),
        }.get(table_name, ()):
            path = normalize_managed_image_path(record.get(column))
            if path:
                result["imageCleanupCandidates"].add(path)

        access = authorize_record_write(
            cursor, actor_role, actor_user_id, organization_id,
            table_key, table_name, {"id": record_id},
        )
        if not access.allowed:
            result["errors"].append({
                "table": table_name, "id": record_id, "message": access.message,
            })
            continue
        # Organization employees may edit records they are allowed to see,
        # but deletion remains a manager-only operation. Keep personal
        # workspaces owner-managed, and preserve the existing elevated-impact
        # handling for plans/packages/contracts.
        if (
            table_name not in HIGH_IMPACT_DELETE_TABLES
            and not _is_actor_personal_scope(organization_id, actor_user_id)
            and not is_organization_manager(cursor, actor_role, actor_user_id, organization_id)
        ):
            result["errors"].append({
                "table": table_name,
                "id": record_id,
                "code": "DELETE_ROLE_PROTECTED",
                "message": "Chuyên viên chỉ được chỉnh sửa, không được xóa dữ liệu.",
            })
            continue
        impact = build_delete_impact(cursor, organization_id, table_name, record_id)
        if (
            table_name in HIGH_IMPACT_DELETE_TABLES
            and not _is_actor_personal_scope(organization_id, actor_user_id)
        ):
            if not is_organization_manager(
                cursor, actor_role, actor_user_id, organization_id
            ):
                result["errors"].append({
                    "table": table_name,
                    "id": record_id,
                    "code": "DELETE_ELEVATED_PERMISSION_REQUIRED",
                    "message": "Chỉ owner/manager của tổ chức được xóa aggregate nghiệp vụ.",
                    "impact": impact,
                })
                continue
        references = find_blocking_delete_references(
            cursor, organization_id, table_name, record_id
        )
        action = "deleted"
        if (references or table_name in ALWAYS_ARCHIVE_TABLES) and table_name in ARCHIVABLE_TABLES:
            delete_assignment_dependents(cursor, organization_id, table_name, record_id)
            archive_versioned_record(
                cursor, organization_id, table_name, record_id, current_time, sync_version
            )
            action = "archived"
        elif references:
            summary = ", ".join(f"{item['label']} ({item['count']})" for item in references)
            result["errors"].append({
                "table": table_name,
                "id": record_id,
                "code": "DELETE_REFERENCED",
                "message": f"Không thể xóa vì bản ghi đang được tham chiếu bởi: {summary}.",
                "references": references,
            })
            continue
        else:
            delete_assignment_dependents(cursor, organization_id, table_name, record_id)
            try:
                cursor.execute(
                    f"DELETE FROM {table_name} WHERE organization_id = ? AND id = ?",
                    (organization_id, record_id),
                )
            except IntegrityError:
                result["errors"].append({
                    "table": table_name,
                    "id": record_id,
                    "code": "DELETE_REFERENCED",
                    "message": "Không thể xóa vì bản ghi đang được tham chiếu.",
                })
                continue
        cursor.execute(
            DELETED_RECORD_UPSERT_SQL,
            (table_name, record_id, organization_id, current_time, sync_version),
        )
        impact_result = {"table": table_key, "id": record_id, "action": action, **impact}
        result["impacts"].append(impact_result)
        insert_delete_audit(
            cursor,
            actor_user_id=actor_user_id,
            organization_id=organization_id,
            table_name=table_name,
            record_id=record_id,
            action=f"sync.record_{action}",
            impact=impact_result,
            ip_address=ip_address,
        )
        if table_name in VERSIONED_TABLES:
            result["updatedVersionedTables"].add(table_name)
            root_id = str(record.get("id_goc") or record.get("id") or "").strip()
            if root_id:
                family_key = root_id
                if table_name == "goi_thau":
                    family_key = (
                        root_id,
                        str(record.get("ke_hoach_id") or "").strip(),
                    )
                result["affectedVersionFamilies"].setdefault(table_name, set()).add(
                    family_key
                )
        if table_name == "ke_hoach_lcnt":
            result["affectedPlanIds"].add(record_id)
        elif table_name == "goi_thau" and record.get("ke_hoach_id"):
            result["affectedPlanIds"].add(str(record["ke_hoach_id"]).strip())
    return result
