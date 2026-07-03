import os
import json
from helpers import (
    database,
    clean_id,
    _org_cache_invalidate_by_user_id
)
import custom_exporter

def to_snake_case(s):
    import re
    return re.sub(r'(?<!^)(?=[A-Z])', '_', s).lower()

def normalize_dict_keys(data):
    if isinstance(data, dict):
        return {to_snake_case(k): normalize_dict_keys(v) for k, v in data.items()}
    elif isinstance(data, list):
        return [normalize_dict_keys(x) for x in data]
    return data

def parse_json_fields(row_dict):
    if not row_dict:
        return row_dict
    for col, val in list(row_dict.items()):
        if val and isinstance(val, str):
            is_json = (
                col.endswith("_list")
                or col.startswith("cv_")
                or col in ("thanh_vien_lien_danh", "goi_thau_ids", "thong_tin_thiet_bi_cuoi")
            )
            if is_json:
                try:
                    parsed = json.loads(val)
                    row_dict[col] = normalize_dict_keys(parsed)
                except Exception:
                    row_dict[col] = [] if col != "thong_tin_thiet_bi_cuoi" else {}
        elif val is None and (
            col.endswith("_list")
            or col.startswith("cv_")
            or col in ("thanh_vien_lien_danh", "goi_thau_ids", "thong_tin_thiet_bi_cuoi")
        ):
            row_dict[col] = [] if col != "thong_tin_thiet_bi_cuoi" else {}
    return row_dict

def build_plan_context(plan_id, user_id, org_name):
    """Truy vấn CSDL để xây dựng ngữ cảnh đầy đủ phục vụ xuất file Word Kế hoạch LCNT."""
    conn = database.get_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM ke_hoach_lcnt WHERE id = ? AND owner_id = ?", (plan_id, org_name))
    row_plan = cursor.fetchone()
    if not row_plan:
        conn.close()
        raise ValueError(f"Plan with id {plan_id} not found")
    plan = parse_json_fields(dict(row_plan))
    
    investor_name = '--'
    investor_address = ''
    inv_data = {}
    if plan.get('chu_dau_tu_id'):
        cursor.execute("SELECT * FROM chu_dau_tu WHERE id = ?", (plan['chu_dau_tu_id'],))
        row_inv = cursor.fetchone()
        if row_inv:
            inv_data = parse_json_fields(dict(row_inv))
            investor_name = inv_data.get('ten_chu_dau_tu', '--')
            investor_address = inv_data.get('dia_chi', '')

    cursor.execute("SELECT * FROM tai_khoan WHERE id = ?", (user_id,))
    row_user = cursor.fetchone()
    user_data = parse_json_fields(dict(row_user)) if row_user else {}
    
    cursor.execute("SELECT * FROM to_chuc WHERE ten_to_chuc = ?", (org_name,))
    row_org = cursor.fetchone()
    org_data = parse_json_fields(dict(row_org)) if row_org else {}
    
    gdv_data = {}
    if user_data.get('goi_dich_vu_id'):
        cursor.execute("SELECT * FROM goi_dich_vu WHERE id = ?", (user_data['goi_dich_vu_id'],))
        row_gdv = cursor.fetchone()
        if row_gdv:
            gdv_data = parse_json_fields(dict(row_gdv))

    cursor.execute("SELECT * FROM goi_thau WHERE ke_hoach_id = ? AND owner_id = ?", (plan_id, org_name))
    goi_thau_list = [parse_json_fields(dict(r)) for r in cursor.fetchall()]
    conn.close()

    unified_context = {
        'ke_hoach': plan,
        'user': user_data,
        'to_chuc': org_data,
        'goi_dich_vu': gdv_data,
        'goi_thau': goi_thau_list,
        'investor_name': investor_name,
        'investor_address': investor_address,
        'chu_dau_tu': inv_data,
        'current_time': os.environ.get("CURRENT_TIME", ""),
        'today': os.environ.get("CURRENT_TIME", "")[:10] if os.environ.get("CURRENT_TIME") else ""
    }
    return unified_context

def build_report_context(package_id, user_id, org_name, type_param):
    """Truy vấn CSDL để xây dựng ngữ cảnh phục vụ xuất file Word HSMT/Mở thầu/Đánh giá/Hợp đồng."""
    conn = database.get_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM goi_thau WHERE id = ? AND owner_id = ?", (package_id, org_name))
    row_pkg = cursor.fetchone()
    if not row_pkg:
        conn.close()
        raise ValueError(f"Package with id {package_id} not found")
    pkg = parse_json_fields(dict(row_pkg))

    plan = {}
    investor_name = '--'
    investor_address = ''
    inv_data = {}
    if pkg.get('ke_hoach_id'):
        cursor.execute("SELECT * FROM ke_hoach_lcnt WHERE id = ?", (pkg['ke_hoach_id'],))
        row_plan = cursor.fetchone()
        if row_plan:
            plan = parse_json_fields(dict(row_plan))
            if plan.get('chu_dau_tu_id'):
                cursor.execute("SELECT * FROM chu_dau_tu WHERE id = ?", (plan['chu_dau_tu_id'],))
                row_inv = cursor.fetchone()
                if row_inv:
                    inv_data = parse_json_fields(dict(row_inv))
                    investor_name = inv_data.get('ten_chu_dau_tu', '--')
                    investor_address = inv_data.get('dia_chi', '')

    cursor.execute("SELECT * FROM tai_khoan WHERE id = ?", (user_id,))
    row_user = cursor.fetchone()
    user_data = parse_json_fields(dict(row_user)) if row_user else {}

    cursor.execute("SELECT * FROM to_chuc WHERE ten_to_chuc = ?", (org_name,))
    row_org = cursor.fetchone()
    org_data = parse_json_fields(dict(row_org)) if row_org else {}

    gdv_data = {}
    if user_data.get('goi_dich_vu_id'):
        cursor.execute("SELECT * FROM goi_dich_vu WHERE id = ?", (user_data['goi_dich_vu_id'],))
        row_gdv = cursor.fetchone()
        if row_gdv:
            gdv_data = parse_json_fields(dict(row_gdv))

    cursor.execute("SELECT * FROM thong_tin_mo_thau WHERE goi_thau_id = ? AND owner_id = ?", (package_id, org_name))
    bids = [parse_json_fields(dict(r)) for r in cursor.fetchall()]

    # Fetch all versions of the package
    id_goc = pkg.get('id_goc')
    root_id = id_goc if (id_goc and id_goc.strip()) else package_id
    cursor.execute("SELECT * FROM goi_thau WHERE owner_id = ? AND (id_goc = ? OR id = ?) ORDER BY CAST(phien_ban AS INTEGER) ASC", (org_name, root_id, root_id))
    goi_thau_versions = [parse_json_fields(dict(r)) for r in cursor.fetchall()]

    contract_data = {}
    if type_param == 'contract':
        cursor.execute("SELECT * FROM hop_dong_lcnt WHERE owner_id = ?", (org_name,))
        all_contracts = [parse_json_fields(dict(r)) for r in cursor.fetchall()]
        for hd in all_contracts:
            goi_thau_ids_str = hd.get('goi_thau_ids', '')
            if goi_thau_ids_str:
                try:
                    linked_ids = json.loads(goi_thau_ids_str) if isinstance(goi_thau_ids_str, str) else goi_thau_ids_str
                    if isinstance(linked_ids, list) and package_id in linked_ids:
                        contract_data = hd
                        break
                except Exception:
                    pass

    # Fetch assigned experts (Tổ chuyên gia)
    cursor.execute("""
        SELECT cg.*, gtcg.chuc_vu, gtcg.cong_viec 
        FROM goi_thau_chuyen_gia gtcg
        JOIN chuyen_gia cg ON gtcg.chuyen_gia_id = cg.id
        WHERE gtcg.goi_thau_id = ? AND gtcg.loai = 'chuyen_gia'
    """, (package_id,))
    to_chuyen_gia = [parse_json_fields(dict(r)) for r in cursor.fetchall()]

    # Fetch assigned appraisal members (Tổ thẩm định)
    cursor.execute("""
        SELECT cg.*, gtcg.chuc_vu, gtcg.cong_viec 
        FROM goi_thau_chuyen_gia gtcg
        JOIN chuyen_gia cg ON gtcg.chuyen_gia_id = cg.id
        WHERE gtcg.goi_thau_id = ? AND gtcg.loai = 'tham_dinh'
    """, (package_id,))
    to_tham_dinh = [parse_json_fields(dict(r)) for r in cursor.fetchall()]

    conn.close()

    unified_context = {
        'goi_thau': pkg,
        'goi_thau_versions': goi_thau_versions,
        'ke_hoach': plan,
        'user': user_data,
        'to_chuc': org_data,
        'goi_dich_vu': gdv_data,
        'nha_thau': bids,
        'to_chuyen_gia': to_chuyen_gia,
        'to_tham_dinh': to_tham_dinh,
        'hop_dong': contract_data,
        'investor_name': investor_name,
        'investor_address': investor_address,
        'chu_dau_tu': inv_data,
        'current_time': os.environ.get("CURRENT_TIME", ""),
        'today': os.environ.get("CURRENT_TIME", "")[:10] if os.environ.get("CURRENT_TIME") else ""
    }
    return unified_context
