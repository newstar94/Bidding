from helpers import clean_id
from helpers_py.sync_mapper import get_payload_value


OWNER_SCOPED_REFERENCES = {
    "ke_hoach_lcnt": [("chu_dau_tu_id", "chu_dau_tu")],
    "goi_thau": [("ke_hoach_id", "ke_hoach_lcnt"), ("nha_thau_trung_thau_id", "nha_thau")],
    "hop_dong": [("chu_dau_tu_id", "chu_dau_tu"), ("nha_thau_id", "nha_thau"), ("ke_hoach_id", "ke_hoach_lcnt")],
    "thong_tin_mo_thau": [("goi_thau_id", "goi_thau"), ("nha_thau_id", "nha_thau")],
}


def get_owner_type(cursor, owner_id):
    cursor.execute("SELECT 1 FROM to_chuc WHERE id = ?", (owner_id,))
    if cursor.fetchone():
        return "organization"
    return "user"


def validate_owner_scoped_references(cursor, owner_id, table_name, item):
    errors = []
    if table_name in {"phan_cong_nhan_su", "ma_tran_phan_quyen"}:
        emp_id = clean_id(get_payload_value(table_name, item, "id_nhan_vien" if table_name == "phan_cong_nhan_su" else "emp_id"))
        if emp_id and str(emp_id) != str(owner_id):
            cursor.execute(
                "SELECT 1 FROM thanh_vien_to_chuc WHERE to_chuc_id = ? AND user_id = ? LIMIT 1",
                (owner_id, emp_id),
            )
            if not cursor.fetchone():
                errors.append(f"Nhan su {emp_id} khong thuoc owner hien tai.")

    if table_name == "phan_cong_nhan_su":
        target_id = clean_id(get_payload_value(table_name, item, "id_muc_tieu"))
        target_type = str(get_payload_value(table_name, item, "loai_doi_tuong") or "").strip()
        target_table = {"kehoach": "ke_hoach_lcnt", "goithau": "goi_thau", "hopdong": "hop_dong"}.get(target_type)
        if target_id and target_table:
            cursor.execute(
                f"SELECT 1 FROM {target_table} WHERE owner_id = ? AND id = ? LIMIT 1",
                (owner_id, target_id),
            )
            if not cursor.fetchone():
                errors.append(f"Phan cong {target_type}={target_id} khong thuoc owner hien tai.")

    for col_name, ref_table in OWNER_SCOPED_REFERENCES.get(table_name, []):
        ref_id = clean_id(get_payload_value(table_name, item, col_name))
        if not ref_id:
            continue
        cursor.execute(
            f"SELECT 1 FROM {ref_table} WHERE owner_id = ? AND id = ? LIMIT 1",
            (owner_id, ref_id),
        )
        if not cursor.fetchone():
            errors.append(f"Tham chieu {col_name}={ref_id} khong thuoc owner hien tai.")
    return errors
