import os
import json
from helpers import (
    database,
    clean_id,
    _org_cache_invalidate_by_user_id
)
import custom_exporter
from helpers_py.sync_mapper import attach_child_rows, attach_child_rows_to_items

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

def enrich_bids_with_contractor_fields(cursor, bids):
    contractor_ids = sorted({
        str(bid.get('nha_thau_id')).strip()
        for bid in bids
        if isinstance(bid, dict) and bid.get('nha_thau_id')
    })
    if not contractor_ids:
        return bids

    placeholders = ','.join(['?'] * len(contractor_ids))
    cursor.execute(
        f"SELECT id, ten_viet_tat FROM nha_thau WHERE id IN ({placeholders})",
        contractor_ids,
    )
    contractors = {row['id']: dict(row) for row in cursor.fetchall()}
    for bid in bids:
        if not isinstance(bid, dict):
            continue
        contractor = contractors.get(str(bid.get('nha_thau_id') or '').strip())
        if contractor and not bid.get('ten_viet_tat'):
            bid['ten_viet_tat'] = contractor.get('ten_viet_tat') or ''
    return bids

def extract_evaluation_dates(pkg):
    if not pkg:
        return pkg
    metadata_str = pkg.get('danh_gia_hsdt_metadata')
    if metadata_str and isinstance(metadata_str, str):
        try:
            meta = json.loads(metadata_str)
            if meta:
                # If 1G2T, we get it from the financial sub-object
                if meta.get('is1G2T') or 'financial' in meta:
                    fin = meta.get('financial', {}) or {}
                    ngay_moi_doichieu = fin.get('ngayMoiDoiChieu')
                    ngay_doichieu = fin.get('ngayDoiChieu')
                else:
                    ngay_moi_doichieu = meta.get('ngayMoiDoiChieu')
                    ngay_doichieu = meta.get('ngayDoiChieu')
                
                # Format to DD/MM/YYYY if YYYY-MM-DD
                def format_date(d_str):
                    if d_str and '-' in d_str:
                        parts = d_str.split('-')
                        if len(parts) == 3:
                            return f"{parts[2]}/{parts[1]}/{parts[0]}"
                    return d_str or ''
                
                pkg['ngay_moi_doi_chieu'] = format_date(ngay_moi_doichieu)
                pkg['ngay_doi_chieu'] = format_date(ngay_doichieu)
        except Exception:
            pass
    return pkg

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
    attach_child_rows(cursor, "ke_hoach_lcnt", plan, owner_id=org_name, naming="snake")
    
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
    attach_child_rows_to_items(cursor, "goi_thau", goi_thau_list, owner_id=org_name, naming="snake")
    for gt in goi_thau_list:
        extract_evaluation_dates(gt)
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
    attach_child_rows(cursor, "goi_thau", pkg, owner_id=org_name, naming="snake")
    extract_evaluation_dates(pkg)

    plan = {}
    investor_name = '--'
    investor_address = ''
    inv_data = {}
    if pkg.get('ke_hoach_id'):
        cursor.execute("SELECT * FROM ke_hoach_lcnt WHERE id = ?", (pkg['ke_hoach_id'],))
        row_plan = cursor.fetchone()
        if row_plan:
            plan = parse_json_fields(dict(row_plan))
            attach_child_rows(cursor, "ke_hoach_lcnt", plan, owner_id=org_name, naming="snake")
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
    attach_child_rows_to_items(cursor, "thong_tin_mo_thau", bids, owner_id=org_name, naming="snake")
    enrich_bids_with_contractor_fields(cursor, bids)

    # Fetch all versions of the package
    id_goc = pkg.get('id_goc')
    root_id = id_goc if (id_goc and id_goc.strip()) else package_id
    cursor.execute("SELECT * FROM goi_thau WHERE owner_id = ? AND (id_goc = ? OR id = ?) ORDER BY CAST(phien_ban AS INTEGER) ASC", (org_name, root_id, root_id))
    goi_thau_versions = [parse_json_fields(dict(r)) for r in cursor.fetchall()]
    attach_child_rows_to_items(cursor, "goi_thau", goi_thau_versions, owner_id=org_name, naming="snake")
    for v in goi_thau_versions:
        extract_evaluation_dates(v)

    contract_data = {}
    if type_param == 'contract':
        cursor.execute("""
            SELECT hd.*
            FROM hop_dong hd
            JOIN hop_dong_goi_thau hdgt ON hdgt.hop_dong_id = hd.id
            WHERE hd.owner_id = ? AND hdgt.goi_thau_id = ?
            ORDER BY CAST(hd.phien_ban AS INTEGER) DESC
            LIMIT 1
        """, (org_name, package_id))
        row_contract = cursor.fetchone()
        if row_contract:
            contract_data = parse_json_fields(dict(row_contract))
            cursor.execute(
                "SELECT goi_thau_id FROM hop_dong_goi_thau WHERE hop_dong_id = ?",
                (contract_data.get('id'),)
            )
            contract_data['goi_thau_ids'] = [r[0] for r in cursor.fetchall()]

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
