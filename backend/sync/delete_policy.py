"""Server-side reference policy for synchronized entity deletion."""

import json
import time

from backend.shared.audit_chain import insert_audit_row
from dataclasses import dataclass

from backend.sync.repository import ARCHIVED_TABLES, VERSIONED_TABLES


@dataclass(frozen=True)
class DeleteReferenceRule:
    table: str
    column: str
    label: str


PROTECTED_DELETE_REFERENCES = {
    "chu_dau_tu": (
        DeleteReferenceRule("ke_hoach_lcnt", "chu_dau_tu_id", "kế hoạch lựa chọn nhà thầu"),
        DeleteReferenceRule("hop_dong", "chu_dau_tu_id", "hợp đồng"),
        DeleteReferenceRule("hop_dong", "chu_dau_tu_thanh_ly_id", "hợp đồng thanh lý"),
    ),
    "nha_thau": (
        DeleteReferenceRule("goi_thau", "nha_thau_trung_thau_id", "kết quả lựa chọn nhà thầu"),
        DeleteReferenceRule("goi_thau_phan_lo", "nha_thau_trung_thau_id", "kết quả phần lô"),
        DeleteReferenceRule("thong_tin_mo_thau", "nha_thau_id", "hồ sơ mở thầu"),
        DeleteReferenceRule("hop_dong", "nha_thau_id", "hợp đồng"),
        DeleteReferenceRule("hop_dong", "nha_thau_thanh_ly_id", "hợp đồng thanh lý"),
        DeleteReferenceRule("nha_thau_lien_danh_thanh_vien", "thanh_vien_nha_thau_id", "thành viên liên danh"),
        DeleteReferenceRule("thong_tin_mo_thau_lien_danh_thanh_vien", "thanh_vien_nha_thau_id", "thành viên liên danh mở thầu"),
        DeleteReferenceRule("nha_thau_lien_danh_thanh_vien", "nha_thau_id", "cấu trúc liên danh"),
    ),
    "chuyen_gia": (
        DeleteReferenceRule("goi_thau_chuyen_gia", "chuyen_gia_id", "phân công chuyên gia gói thầu"),
    ),
    "ke_hoach_lcnt": (
        DeleteReferenceRule("goi_thau", "ke_hoach_id", "gói thầu"),
        DeleteReferenceRule("hop_dong", "ke_hoach_id", "hợp đồng"),
        DeleteReferenceRule("ke_hoach_cong_viec", "ke_hoach_id", "nội dung kế hoạch"),
    ),
    "goi_thau": (
        DeleteReferenceRule("hop_dong_goi_thau", "goi_thau_id", "hợp đồng"),
        DeleteReferenceRule("goi_thau_phan_lo", "goi_thau_id", "phần lô"),
        DeleteReferenceRule("goi_thau_gia_han", "goi_thau_id", "lịch sử gia hạn"),
        DeleteReferenceRule("goi_thau_lam_ro", "goi_thau_id", "lịch sử làm rõ"),
        DeleteReferenceRule("thong_tin_mo_thau", "goi_thau_id", "hồ sơ mở thầu"),
    ),
    "hop_dong": (
        DeleteReferenceRule("hop_dong_goi_thau", "hop_dong_id", "gói thầu của hợp đồng"),
    ),
}


ARCHIVABLE_TABLES = ARCHIVED_TABLES
ALWAYS_ARCHIVE_TABLES = frozenset({"thong_tin_mo_thau"})

HIGH_IMPACT_DELETE_TABLES = frozenset({
    "ke_hoach_lcnt",
    "goi_thau",
    "hop_dong",
    "thong_tin_mo_thau",
})

CASCADE_IMPACT_RULES = {
    "ke_hoach_lcnt": (
        DeleteReferenceRule("ke_hoach_cong_viec", "ke_hoach_id", "nội dung kế hoạch"),
    ),
    "goi_thau": (
        DeleteReferenceRule("goi_thau_phan_lo", "goi_thau_id", "phần lô"),
        DeleteReferenceRule("goi_thau_tuy_chon_mua_them", "goi_thau_id", "tùy chọn mua thêm"),
        DeleteReferenceRule("goi_thau_gia_han", "goi_thau_id", "gia hạn"),
        DeleteReferenceRule("goi_thau_lam_ro", "goi_thau_id", "làm rõ"),
        DeleteReferenceRule("goi_thau_chuyen_gia", "goi_thau_id", "phân công chuyên gia"),
        DeleteReferenceRule("thong_tin_mo_thau", "goi_thau_id", "hồ sơ mở thầu"),
    ),
    "hop_dong": (
        DeleteReferenceRule("hop_dong_goi_thau", "hop_dong_id", "liên kết gói thầu"),
    ),
    "thong_tin_mo_thau": (
        DeleteReferenceRule(
            "thong_tin_mo_thau_lien_danh_thanh_vien",
            "thong_tin_mo_thau_id",
            "thành viên liên danh",
        ),
    ),
}


ASSIGNMENT_TARGET_TYPES = {
    "ke_hoach_lcnt": "kehoach",
    "goi_thau": "goithau",
    "hop_dong": "hopdong",
}

_QUERY_CHUNK_SIZE = 500


def find_blocking_delete_references(cursor, organization_id, table_name, record_id, rules=None):
    selected_rules = PROTECTED_DELETE_REFERENCES.get(table_name, ()) if rules is None else rules
    references = []
    for rule in selected_rules:
        row = cursor.execute(
            f"SELECT COUNT(*) FROM {rule.table} WHERE organization_id = ? AND {rule.column} = ?",
            (organization_id, record_id),
        ).fetchone()
        count = int(row[0] if row else 0)
        if count:
            references.append({
                "table": rule.table,
                "column": rule.column,
                "label": rule.label,
                "count": count,
            })
    return references


def find_blocking_delete_references_by_record_ids(
    cursor,
    organization_id,
    table_name,
    record_ids,
    rules=None,
):
    """Return reference summaries keyed by record ID using one query per rule/chunk."""

    selected_rules = PROTECTED_DELETE_REFERENCES.get(table_name, ()) if rules is None else rules
    unique_record_ids = list(dict.fromkeys(str(value) for value in record_ids if value))
    references_by_record_id = {record_id: [] for record_id in unique_record_ids}
    for rule in selected_rules:
        for offset in range(0, len(unique_record_ids), _QUERY_CHUNK_SIZE):
            chunk = unique_record_ids[offset:offset + _QUERY_CHUNK_SIZE]
            placeholders = ", ".join("?" for _ in chunk)
            rows = cursor.execute(
                f"""SELECT {rule.column}, COUNT(*)
                    FROM {rule.table}
                    WHERE organization_id = ? AND {rule.column} IN ({placeholders})
                    GROUP BY {rule.column}""",
                (organization_id, *chunk),
            ).fetchall()
            for row in rows:
                record_id = str(row[0])
                count = int(row[1] or 0)
                if record_id in references_by_record_id and count:
                    references_by_record_id[record_id].append({
                        "table": rule.table,
                        "column": rule.column,
                        "label": rule.label,
                        "count": count,
                    })
    return references_by_record_id


def delete_assignment_dependents(cursor, organization_id, table_name, record_id):
    target_type = ASSIGNMENT_TARGET_TYPES.get(table_name)
    if not target_type:
        return 0
    result = cursor.execute(
        """
        DELETE FROM phan_cong_nhan_su
        WHERE organization_id = ? AND id_muc_tieu = ? AND loai_doi_tuong = ?
        """,
        (organization_id, record_id, target_type),
    )
    return int(result.rowcount or 0)


def build_delete_impact(cursor, organization_id, table_name, record_id):
    """Return an owner-scoped preview of every row affected by a delete request."""

    cascade_rows = find_blocking_delete_references(
        cursor,
        organization_id,
        table_name,
        record_id,
        rules=CASCADE_IMPACT_RULES.get(table_name, ()),
    )
    assignment_count = 0
    target_type = ASSIGNMENT_TARGET_TYPES.get(table_name)
    if target_type:
        row = cursor.execute(
            """
            SELECT COUNT(*) FROM phan_cong_nhan_su
            WHERE organization_id = ? AND id_muc_tieu = ? AND loai_doi_tuong = ?
            """,
            (organization_id, record_id, target_type),
        ).fetchone()
        assignment_count = int(row[0] if row else 0)
    child_count = sum(item["count"] for item in cascade_rows) + assignment_count
    return {
        "rootCount": 1,
        "dependentCount": child_count,
        "totalCount": 1 + child_count,
        "dependents": cascade_rows,
        "assignmentCount": assignment_count,
    }


def build_delete_impacts_by_record_ids(
    cursor,
    organization_id,
    table_name,
    record_ids,
):
    """Return delete-impact previews keyed by record ID with bounded queries."""

    unique_record_ids = list(dict.fromkeys(str(value) for value in record_ids if value))
    cascade_rows_by_record_id = find_blocking_delete_references_by_record_ids(
        cursor,
        organization_id,
        table_name,
        unique_record_ids,
        rules=CASCADE_IMPACT_RULES.get(table_name, ()),
    )
    assignment_counts = {record_id: 0 for record_id in unique_record_ids}
    target_type = ASSIGNMENT_TARGET_TYPES.get(table_name)
    if target_type:
        for offset in range(0, len(unique_record_ids), _QUERY_CHUNK_SIZE):
            chunk = unique_record_ids[offset:offset + _QUERY_CHUNK_SIZE]
            placeholders = ", ".join("?" for _ in chunk)
            rows = cursor.execute(
                f"""SELECT id_muc_tieu, COUNT(*)
                    FROM phan_cong_nhan_su
                    WHERE organization_id = ?
                      AND id_muc_tieu IN ({placeholders})
                      AND loai_doi_tuong = ?
                    GROUP BY id_muc_tieu""",
                (organization_id, *chunk, target_type),
            ).fetchall()
            for row in rows:
                record_id = str(row[0])
                if record_id in assignment_counts:
                    assignment_counts[record_id] = int(row[1] or 0)
    impacts = {}
    for record_id in unique_record_ids:
        cascade_rows = cascade_rows_by_record_id[record_id]
        assignment_count = assignment_counts[record_id]
        child_count = sum(item["count"] for item in cascade_rows) + assignment_count
        impacts[record_id] = {
            "rootCount": 1,
            "dependentCount": child_count,
            "totalCount": 1 + child_count,
            "dependents": cascade_rows,
            "assignmentCount": assignment_count,
        }
    return impacts


def has_recent_password_reauthentication(cursor, user_id, ttl_seconds, session_id=None):
    row = cursor.execute(
        """
        SELECT privileged_reauth_at
        FROM auth_sessions
        WHERE user_id = ? AND id = ? AND revoked_at IS NULL
        """,
        (user_id, session_id),
    ).fetchone()
    try:
        reauthenticated_at = int(row[0] if row else 0)
    except (TypeError, ValueError):
        return False
    return reauthenticated_at > 0 and time.time() - reauthenticated_at <= ttl_seconds


def archive_versioned_record(
    cursor,
    organization_id,
    table_name,
    record_id,
    archived_at,
    sync_version,
):
    if table_name not in ARCHIVABLE_TABLES:
        raise ValueError(f"Bảng {table_name} không hỗ trợ lưu trữ mềm.")
    latest_assignment = ", is_latest = 0" if table_name in VERSIONED_TABLES else ""
    result = cursor.execute(
        f"""
        UPDATE {table_name}
        SET archived_at = ?{latest_assignment}, updated_at = ?, sync_version = ?
        WHERE organization_id = ? AND id = ? AND archived_at IS NULL
        """,
        (archived_at, archived_at, sync_version, organization_id, record_id),
    )
    return int(result.rowcount or 0)


def insert_delete_audit(
    cursor,
    *,
    actor_user_id,
    organization_id,
    table_name,
    record_id,
    action,
    impact,
    ip_address=None,
):
    insert_audit_row(
        cursor,
        actor_user_id=actor_user_id,
        organization_id=organization_id,
        action=action,
        target_type=table_name,
        target_id=record_id,
        ip_address=ip_address,
        metadata_json=json.dumps({"impact": impact}, ensure_ascii=False, default=str),
    )
