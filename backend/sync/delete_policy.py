"""Server-side reference policy for synchronized entity deletion."""

from dataclasses import dataclass


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
    ),
    "chuyen_gia": (
        DeleteReferenceRule("goi_thau_chuyen_gia", "chuyen_gia_id", "phân công chuyên gia gói thầu"),
    ),
    "ke_hoach_lcnt": (
        DeleteReferenceRule("goi_thau", "ke_hoach_id", "gói thầu"),
        DeleteReferenceRule("hop_dong", "ke_hoach_id", "hợp đồng"),
    ),
    "goi_thau": (
        DeleteReferenceRule("hop_dong_goi_thau", "goi_thau_id", "hợp đồng"),
    ),
}


ASSIGNMENT_TARGET_TYPES = {
    "ke_hoach_lcnt": "kehoach",
    "goi_thau": "goithau",
    "hop_dong": "hopdong",
}


def find_blocking_delete_references(cursor, owner_id, table_name, record_id, rules=None):
    selected_rules = PROTECTED_DELETE_REFERENCES.get(table_name, ()) if rules is None else rules
    references = []
    for rule in selected_rules:
        row = cursor.execute(
            f"SELECT COUNT(*) FROM {rule.table} WHERE owner_id = ? AND {rule.column} = ?",
            (owner_id, record_id),
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


def delete_assignment_dependents(cursor, owner_id, table_name, record_id):
    target_type = ASSIGNMENT_TARGET_TYPES.get(table_name)
    if not target_type:
        return 0
    result = cursor.execute(
        """
        DELETE FROM phan_cong_nhan_su
        WHERE owner_id = ? AND id_muc_tieu = ? AND loai_doi_tuong = ?
        """,
        (owner_id, record_id, target_type),
    )
    return int(result.rowcount or 0)
