"""Additional scalar mappings; never remove the selected work from plan lists."""

APPRAISAL_FIELDS = {
    "tdg_ten_cong_viec": "ten_cong_viec",
    "tdg_gia_tri": "gia_tri",
    "tdg_don_vi_thuc_hien": "don_vi_thuc_hien",
    "tdg_hop_dong": "van_ban_phe_duyet",
    "tdg_so_chung_thu": "so_chung_thu_tham_dinh_gia",
}


def build_plan_appraisal_context(plan):
    selected = next((row for row in (plan or {}).get("cv_da_thuc_hien", [])
                     if row.get("tham_dinh_gia") in (True, 1)), {})
    return {key: selected.get(column, "") for key, column in APPRAISAL_FIELDS.items()}
