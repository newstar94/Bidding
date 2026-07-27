"""Execute synchronized deletions/archives as one authorization-aware use case."""

from backend.db.db_helper import IntegrityError


from backend.shared.helpers import clean_id
from backend.shared.access_policy import (
    authorize_record_write_from_context,
    build_batch_write_authorization_context,
)
from backend.shared.media_helper import normalize_managed_image_path
from backend.sync.delete_policy import (
    ALWAYS_ARCHIVE_TABLES,
    ASSIGNMENT_TARGET_TYPES,
    ARCHIVABLE_TABLES,
    CASCADE_IMPACT_RULES,
    HIGH_IMPACT_DELETE_TABLES,
    PROTECTED_DELETE_REFERENCES,
    archive_versioned_record,
    build_delete_impacts_by_record_ids,
    delete_assignment_dependents,
    find_blocking_delete_references_by_record_ids,
    insert_delete_audit,
)
from backend.sync.mapper import map_db_to_json
from backend.sync.queries import TABLE_KEYS
from backend.sync.repository import DELETED_RECORD_UPSERT_SQL, VERSIONED_TABLES


_QUERY_CHUNK_SIZE = 500


def _decrement_reference_summary(entries, rule):
    for index, entry in enumerate(entries):
        if entry["table"] != rule.table or entry["column"] != rule.column:
            continue
        remaining = int(entry["count"]) - 1
        if remaining > 0:
            entry["count"] = remaining
        else:
            entries.pop(index)
        return True
    return False


def _refresh_impact_totals(impact):
    dependent_count = sum(
        int(item["count"])
        for item in impact["dependents"]
    ) + int(impact["assignmentCount"])
    impact["dependentCount"] = dependent_count
    impact["totalCount"] = int(impact["rootCount"]) + dependent_count


def _apply_hard_delete_to_prefetched_state(
    table_name,
    record,
    references_by_table,
    impacts_by_table,
):
    """Advance prefetched reference state after an ordered hard delete."""

    for target_table, references_by_record_id in references_by_table.items():
        for rule in PROTECTED_DELETE_REFERENCES.get(target_table, ()):
            if rule.table != table_name:
                continue
            target_id = clean_id(record.get(rule.column))
            if not target_id:
                continue
            entries = references_by_record_id.get(str(target_id))
            if entries is not None:
                _decrement_reference_summary(entries, rule)

    for target_table, impacts_by_record_id in impacts_by_table.items():
        for rule in CASCADE_IMPACT_RULES.get(target_table, ()):
            if rule.table != table_name:
                continue
            target_id = clean_id(record.get(rule.column))
            if not target_id:
                continue
            impact = impacts_by_record_id.get(str(target_id))
            if impact is not None and _decrement_reference_summary(
                impact["dependents"],
                rule,
            ):
                _refresh_impact_totals(impact)

    if table_name == "phan_cong_nhan_su":
        target_type = str(record.get("loai_doi_tuong") or "").strip()
        target_id = clean_id(record.get("id_muc_tieu"))
        target_table = {
            value: key for key, value in ASSIGNMENT_TARGET_TYPES.items()
        }.get(target_type)
        impact = (
            impacts_by_table.get(target_table, {}).get(str(target_id))
            if target_table and target_id
            else None
        )
        if impact is not None and int(impact["assignmentCount"]) > 0:
            impact["assignmentCount"] = int(impact["assignmentCount"]) - 1
            _refresh_impact_totals(impact)


def _remove_cached_assignment_dependents(
    records_by_table,
    table_name,
    record_id,
):
    target_type = ASSIGNMENT_TARGET_TYPES.get(table_name)
    if not target_type:
        return
    assignments = records_by_table.get("phan_cong_nhan_su", {})
    for assignment_id, assignment in list(assignments.items()):
        if (
            clean_id(assignment.get("id_muc_tieu")) == clean_id(record_id)
            and str(assignment.get("loai_doi_tuong") or "").strip() == target_type
        ):
            assignments.pop(assignment_id, None)


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
    current_time,
    sync_version,
    clean_record_id,
    ip_address,
):
    result = {
        "errors": [],
        "impacts": [],
        "updatedVersionedTables": set(),
        "affectedVersionFamilies": {},
        "affectedPlanIds": set(),
        "imageCleanupCandidates": set(),
    }
    if not isinstance(deletions, list):
        return result

    record_ids_by_table = {}
    for deletion in deletions:
        if not isinstance(deletion, dict):
            continue
        table_key = deletion.get("table")
        if table_key not in TABLE_KEYS:
            continue
        table_name = TABLE_KEYS[table_key]
        record_id = clean_record_id(table_name, deletion.get("id"))
        if record_id:
            record_ids_by_table.setdefault(table_name, []).append(record_id)
    if not record_ids_by_table:
        return result

    records_by_table = {}
    impacts_by_table = {}
    references_by_table = {}
    for table_name, raw_record_ids in record_ids_by_table.items():
        record_ids = list(dict.fromkeys(raw_record_ids))
        table_records = records_by_table.setdefault(table_name, {})
        for offset in range(0, len(record_ids), _QUERY_CHUNK_SIZE):
            chunk = record_ids[offset:offset + _QUERY_CHUNK_SIZE]
            placeholders = ", ".join("?" for _ in chunk)
            rows = cursor.execute(
                f"""SELECT * FROM {table_name}
                    WHERE organization_id = ? AND id IN ({placeholders})""",
                (organization_id, *chunk),
            ).fetchall()
            for row in rows:
                record = dict(row)
                table_records[str(record["id"])] = record
        impacts_by_table[table_name] = build_delete_impacts_by_record_ids(
            cursor,
            organization_id,
            table_name,
            record_ids,
        )
        references_by_table[table_name] = find_blocking_delete_references_by_record_ids(
            cursor,
            organization_id,
            table_name,
            record_ids,
        )
    if not any(records_by_table.values()):
        return result
    authorization_context = build_batch_write_authorization_context(
        cursor,
        actor_role,
        actor_user_id,
        organization_id,
        {
            table_name: [{"id": record_id} for record_id in table_records]
            for table_name, table_records in records_by_table.items()
        },
    )

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
        record = records_by_table.get(table_name, {}).get(str(record_id))
        if not record:
            continue
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

        access = authorize_record_write_from_context(
            authorization_context,
            table_key,
            table_name,
            {"id": record_id},
        )
        organization_manager = authorization_context.organization_manager
        if not access.allowed:
            result["errors"].append({
                "table": table_name, "id": record_id, "message": access.message,
            })
            continue
        # Employees may create data and edit assigned work, but deletion in an
        # organization is always reserved for an organization manager. This is
        # enforced here so direct API calls cannot bypass the UI.
        if (
            table_name not in HIGH_IMPACT_DELETE_TABLES
            and not _is_actor_personal_scope(organization_id, actor_user_id)
            and not organization_manager
        ):
            result["errors"].append({
                "table": table_name,
                "id": record_id,
                "code": "DELETE_ROLE_PROTECTED",
                "message": "Chỉ Quản lý tổ chức được phép xóa dữ liệu; Chuyên viên không được phép xóa.",
            })
            continue
        impact = impacts_by_table[table_name][str(record_id)]
        if (
            table_name in HIGH_IMPACT_DELETE_TABLES
            and not _is_actor_personal_scope(organization_id, actor_user_id)
        ):
            if not organization_manager:
                result["errors"].append({
                    "table": table_name,
                    "id": record_id,
                    "code": "DELETE_ELEVATED_PERMISSION_REQUIRED",
                    "message": "Chỉ owner/manager của tổ chức được xóa aggregate nghiệp vụ.",
                    "impact": impact,
                })
                continue
        references = references_by_table[table_name][str(record_id)]
        action = "deleted"
        if (references or table_name in ALWAYS_ARCHIVE_TABLES) and table_name in ARCHIVABLE_TABLES:
            delete_assignment_dependents(cursor, organization_id, table_name, record_id)
            archive_versioned_record(
                cursor, organization_id, table_name, record_id, current_time, sync_version
            )
            _remove_cached_assignment_dependents(
                records_by_table,
                table_name,
                record_id,
            )
            action = "archived"
            record["archived_at"] = current_time
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
            cursor.execute("SAVEPOINT sync_delete_item")
            try:
                delete_assignment_dependents(
                    cursor, organization_id, table_name, record_id
                )
                cursor.execute(
                    f"DELETE FROM {table_name} WHERE organization_id = ? AND id = ?",
                    (organization_id, record_id),
                )
            except IntegrityError:
                cursor.execute("ROLLBACK TO SAVEPOINT sync_delete_item")
                cursor.execute("RELEASE SAVEPOINT sync_delete_item")
                result["errors"].append({
                    "table": table_name,
                    "id": record_id,
                    "code": "DELETE_REFERENCED",
                    "message": "Không thể xóa vì bản ghi đang được tham chiếu.",
                })
                continue
            except Exception:
                cursor.execute("ROLLBACK TO SAVEPOINT sync_delete_item")
                cursor.execute("RELEASE SAVEPOINT sync_delete_item")
                raise
            cursor.execute("RELEASE SAVEPOINT sync_delete_item")
            _remove_cached_assignment_dependents(
                records_by_table,
                table_name,
                record_id,
            )
            records_by_table[table_name].pop(str(record_id), None)
            _apply_hard_delete_to_prefetched_state(
                table_name,
                record,
                references_by_table,
                impacts_by_table,
            )
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
