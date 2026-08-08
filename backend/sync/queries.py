from backend.sync.dashboard_summary import build_dashboard_summary
from backend.sync.mapper import map_db_to_json


__all__ = ["build_dashboard_summary", "map_db_to_json"]


TABLE_KEYS = {
    "chudautu": "chu_dau_tu",
    "kehoach": "ke_hoach_lcnt",
    "goithau": "goi_thau",
    "chuyengia": "chuyen_gia",
    "nhathau": "nha_thau",
    "customcontractstatuses": "danh_muc_trang_thai_hop_dong",
    "hopdong": "hop_dong",
    "assignments": "phan_cong_nhan_su",
    "thongtinmothau": "thong_tin_mo_thau",
    "permissionmatrix": "ma_tran_phan_quyen",
    "goithauhanghoa": "goi_thau_hang_hoa",
    "hanghoaduthaunhathau": "hang_hoa_du_thau_nha_thau",
}

SYNCED_TABLES = set(TABLE_KEYS.values())
ALLOWED_ORPHAN_TABLES = {
    "goi_thau",
    "thong_tin_mo_thau",
}

def get_expert_relations_for_packages(cursor, gt_ids, organization_id=None):
    if not gt_ids:
        return {}
    placeholders = ", ".join(["?"] * len(gt_ids))
    owner_filter = " AND organization_id = ?" if organization_id is not None else ""
    params = list(gt_ids)
    if organization_id is not None:
        params.append(organization_id)
    cursor.execute(f"""
        SELECT goi_thau_id, chuyen_gia_id, loai, chuc_vu, cong_viec
        FROM goi_thau_chuyen_gia
        WHERE goi_thau_id IN ({placeholders}){owner_filter}
    """, tuple(params))
    relations_map = {}
    for rel_row in cursor.fetchall():
        gt_id = rel_row[0]
        entry = {
            "chuyenGiaId": rel_row[1],
            "id": rel_row[1],
            "chucVu": rel_row[3] or "Tổ viên",
            "congViec": rel_row[4] or ""
        }
        if gt_id not in relations_map:
            relations_map[gt_id] = {"to_cg": [], "to_td": [], "cg_ids": []}
        if rel_row[2] == "chuyen_gia":
            relations_map[gt_id]["to_cg"].append(entry)
            relations_map[gt_id]["cg_ids"].append(rel_row[1])
        else:
            relations_map[gt_id]["to_td"].append(entry)
    return relations_map


def get_contract_package_ids(cursor, hd_ids, organization_id=None):
    if not hd_ids:
        return {}
    placeholders = ", ".join(["?"] * len(hd_ids))
    owner_filter = " AND organization_id = ?" if organization_id is not None else ""
    params = list(hd_ids)
    if organization_id is not None:
        params.append(organization_id)
    cursor.execute(
        f"SELECT hop_dong_id, goi_thau_id FROM hop_dong_goi_thau WHERE hop_dong_id IN ({placeholders}){owner_filter}",
        tuple(params)
    )
    result = {}
    for row in cursor.fetchall():
        hd_id = row[0]
        gt_id = row[1]
        if gt_id:
            result.setdefault(hd_id, []).append(gt_id)
    return result
