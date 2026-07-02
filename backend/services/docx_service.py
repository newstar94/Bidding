import os
from helpers import (
    database,
    clean_id,
    _org_cache_invalidate_by_user_id
)
import custom_exporter

def build_plan_context(plan_id, user_id, org_name):
    """Truy vấn CSDL để xây dựng ngữ cảnh đầy đủ phục vụ xuất file Word Kế hoạch LCNT."""
    conn = database.get_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM ke_hoach_lcnt WHERE id = ? AND owner_id = ?", (plan_id, org_name))
    row_plan = cursor.fetchone()
    if not row_plan:
        conn.close()
        raise ValueError(f"Plan with id {plan_id} not found")
    plan = dict(row_plan)
    
    investor_name = '--'
    investor_address = ''
    if plan.get('chu_dau_tu_id'):
        cursor.execute("SELECT * FROM chu_dau_tu WHERE id = ?", (plan['chu_dau_tu_id'],))
        row_inv = cursor.fetchone()
        if row_inv:
            inv_data = dict(row_inv)
            investor_name = inv_data.get('ten_chu_dau_tu', '--')
            investor_address = inv_data.get('dia_chi', '')

    cursor.execute("SELECT * FROM tai_khoan WHERE id = ?", (user_id,))
    row_user = cursor.fetchone()
    user_data = dict(row_user) if row_user else {}
    
    cursor.execute("SELECT * FROM to_chuc WHERE ten_to_chuc = ?", (org_name,))
    row_org = cursor.fetchone()
    org_data = dict(row_org) if row_org else {}
    
    gdv_data = {}
    if user_data.get('goi_dich_vu_id'):
        cursor.execute("SELECT * FROM goi_dich_vu WHERE id = ?", (user_data['goi_dich_vu_id'],))
        row_gdv = cursor.fetchone()
        if row_gdv:
            gdv_data = dict(row_gdv)

    cursor.execute("SELECT * FROM goi_thau WHERE ke_hoach_id = ? AND owner_id = ?", (plan_id, org_name))
    goi_thau_list = [dict(r) for r in cursor.fetchall()]
    conn.close()

    unified_context = {
        'ke_hoach': plan,
        'user': user_data,
        'to_chuc': org_data,
        'goi_dich_vu': gdv_data,
        'goi_thau': goi_thau_list,
        'investor_name': investor_name,
        'investor_address': investor_address,
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
    pkg = dict(row_pkg)

    plan = {}
    investor_name = '--'
    investor_address = ''
    if pkg.get('ke_hoach_id'):
        cursor.execute("SELECT * FROM ke_hoach_lcnt WHERE id = ?", (pkg['ke_hoach_id'],))
        row_plan = cursor.fetchone()
        if row_plan:
            plan = dict(row_plan)
            if plan.get('chu_dau_tu_id'):
                cursor.execute("SELECT * FROM chu_dau_tu WHERE id = ?", (plan['chu_dau_tu_id'],))
                row_inv = cursor.fetchone()
                if row_inv:
                    inv_data = dict(row_inv)
                    investor_name = inv_data.get('ten_chu_dau_tu', '--')
                    investor_address = inv_data.get('dia_chi', '')

    cursor.execute("SELECT * FROM tai_khoan WHERE id = ?", (user_id,))
    row_user = cursor.fetchone()
    user_data = dict(row_user) if row_user else {}

    cursor.execute("SELECT * FROM to_chuc WHERE ten_to_chuc = ?", (org_name,))
    row_org = cursor.fetchone()
    org_data = dict(row_org) if row_org else {}

    gdv_data = {}
    if user_data.get('goi_dich_vu_id'):
        cursor.execute("SELECT * FROM goi_dich_vu WHERE id = ?", (user_data['goi_dich_vu_id'],))
        row_gdv = cursor.fetchone()
        if row_gdv:
            gdv_data = dict(row_gdv)

    cursor.execute("SELECT * FROM thong_tin_mo_thau WHERE goi_thau_id = ? AND owner_id = ?", (package_id, org_name))
    bids = [dict(r) for r in cursor.fetchall()]

    contract_data = {}
    if type_param == 'contract':
        cursor.execute("SELECT * FROM hop_dong_lcnt WHERE owner_id = ?", (org_name,))
        all_contracts = [dict(r) for r in cursor.fetchall()]
        for hd in all_contracts:
            goi_thau_ids_str = hd.get('goi_thau_ids', '')
            if goi_thau_ids_str:
                try:
                    linked_ids = json.loads(goi_thau_ids_str)
                    if isinstance(linked_ids, list) and package_id in linked_ids:
                        contract_data = hd
                        break
                except Exception:
                    pass

    conn.close()

    unified_context = {
        'goi_thau': pkg,
        'ke_hoach': plan,
        'user': user_data,
        'to_chuc': org_data,
        'goi_dich_vu': gdv_data,
        'nha_thau': bids,
        'hop_dong': contract_data,
        'investor_name': investor_name,
        'investor_address': investor_address,
        'current_time': os.environ.get("CURRENT_TIME", ""),
        'today': os.environ.get("CURRENT_TIME", "")[:10] if os.environ.get("CURRENT_TIME") else ""
    }
    return unified_context
