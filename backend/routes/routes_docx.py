import os
import json
from datetime import datetime
from starlette.responses import StreamingResponse, JSONResponse

from helpers import (
    database,
    verify_session,
    clean_id,
    get_active_org,
    VietnameseFloat,
    OrgPermissionError
)
import custom_exporter
import services.docx_service as docx_service
import uuid

def enrich_context_with_filtered_bidders(context):
    bids = context.get('nha_thau', [])
    if not isinstance(bids, list):
        bids = []
        
    pkg = context.get('goi_thau', {})
    nha_thau_trung_thau_id = pkg.get('nha_thau_trung_thau_id') if isinstance(pkg, dict) else None
    
    winning_bids = []
    failed_bids = []
    for b in bids:
        if not isinstance(b, dict):
            continue
        is_winner = False
        if nha_thau_trung_thau_id and b.get('nha_thau_id') == nha_thau_trung_thau_id:
            is_winner = True
        elif b.get('danh_gia_ket_luan') in ('Trúng thầu', 'Đề nghị trúng thầu', 'Đạt'):
            is_winner = True
            
        if is_winner:
            winning_bids.append(b)
        else:
            failed_bids.append(b)
            
    context['nha_thau_trung_thau'] = winning_bids
    context['nha_thau_truot_thau'] = failed_bids

def apply_custom_mappings(context, mappings_rows):
    from helpers import VietnameseFloat
    # Mapping table name to context keys
    table_to_context = {
        'ke_hoach_lcnt': ['ke_hoach'],
        'goi_thau': ['goi_thau', 'goi_thau_versions', 'goi_thau'],
        'nha_thau': ['nha_thau'],
        'nha_thau_trung_thau': ['nha_thau_trung_thau'],
        'nha_thau_truot_thau': ['nha_thau_truot_thau'],
        'chu_dau_tu': ['chu_dau_tu'],
        'hop_dong': ['hop_dong'],
        'tai_khoan': ['user'],
        'to_chuc': ['to_chuc'],
        'goi_dich_vu': ['goi_dich_vu']
    }
    
    # helper to format values
    def format_mapped_value(val, col_name):
        if val is None:
            return '--'
        if isinstance(val, (int, float)) and ('gia' in col_name or 'tong_muc' in col_name or 'gia_tri' in col_name or 'tong_tien' in col_name):
            try:
                return f'{VietnameseFloat(val)}'
            except Exception:
                pass
        return val

    # 1. First pass: Handle custom list mappings (where source_column is empty/null or '*')
    for ten_bien, src_table, src_column in mappings_rows:
        ten_bien = ten_bien.lower()
        if not src_column or src_column == '*' or src_column == '':
            ctx_keys = table_to_context.get(src_table, [])
            if ctx_keys:
                for key in ctx_keys:
                    if key in context and isinstance(context[key], list):
                        context[ten_bien] = [dict(item) for item in context[key]]
                        break
                    elif key in context and isinstance(context[key], dict):
                        context[ten_bien] = [dict(context[key])]
                        break
            else:
                # Handle sub-lists or nested attributes (e.g. phan_lo_list, thanh_vien_lien_danh)
                found = False
                if src_table in context and isinstance(context[src_table], list):
                    context[ten_bien] = list(context[src_table])
                    found = True
                if not found:
                    for ctx_val in context.values():
                        if isinstance(ctx_val, dict) and src_table in ctx_val:
                            val = ctx_val[src_table]
                            if isinstance(val, list):
                                context[ten_bien] = list(val)
                                found = True
                                break
                        elif isinstance(ctx_val, list):
                            for item in ctx_val:
                                if isinstance(item, dict) and src_table in item:
                                    val = item[src_table]
                                    if isinstance(val, list):
                                        context[ten_bien] = list(val)
                                        found = True
                                        break
                            if found:
                                break

    # 2. Second pass: Handle custom field mappings (where source_column is specified)
    for ten_bien, src_table, src_column in mappings_rows:
        ten_bien = ten_bien.lower()
        if src_column and src_column != '*' and src_column != '':
            # Group related contractor/bid tables to self-identify contractor type
            entity_keys = {
                'ke_hoach_lcnt': ['ke_hoach'],
                'goi_thau': ['goi_thau', 'goi_thau_versions'],
                'nha_thau': ['nha_thau', 'thong_tin_mo_thau', 'bids', 'nha_thau_trung_thau', 'nha_thau_truot_thau'],
                'thong_tin_mo_thau': ['nha_thau', 'thong_tin_mo_thau', 'bids', 'nha_thau_trung_thau', 'nha_thau_truot_thau'],
                'nha_thau_trung_thau': ['nha_thau', 'thong_tin_mo_thau', 'bids', 'nha_thau_trung_thau', 'nha_thau_truot_thau'],
                'nha_thau_truot_thau': ['nha_thau', 'thong_tin_mo_thau', 'bids', 'nha_thau_trung_thau', 'nha_thau_truot_thau'],
                'chuyen_gia': ['chuyen_gia', 'to_chuyen_gia', 'to_tham_dinh'],
                'to_chuyen_gia': ['chuyen_gia', 'to_chuyen_gia', 'to_tham_dinh'],
                'to_tham_dinh': ['chuyen_gia', 'to_chuyen_gia', 'to_tham_dinh'],
                'yeu_cau_lam_ro': ['yeu_cau_lam_ro_list'],
                'yeu_cau_lam_ro_list': ['yeu_cau_lam_ro_list'],
                'tra_loi_lam_ro': ['tra_loi_lam_ro_list'],
                'tra_loi_lam_ro_list': ['tra_loi_lam_ro_list'],
                'phan_lo': ['phan_lo_list', 'awarded_phan_lo_list'],
                'phan_lo_list': ['phan_lo_list', 'awarded_phan_lo_list'],
                'awarded_phan_lo_list': ['phan_lo_list', 'awarded_phan_lo_list'],
                'tuy_chon_mua_them': ['tuy_chon_mua_them_list'],
                'tuy_chon_mua_them_list': ['tuy_chon_mua_them_list'],
                'gia_han': ['gia_han_list'],
                'gia_han_list': ['gia_han_list'],
                'thanh_vien_lien_danh': ['thanh_vien_lien_danh'],
                'cv_da_thuc_hien': ['cv_da_thuc_hien'],
                'cv_da_thuc_hien_list': ['cv_da_thuc_hien'],
                'cv_khong_ap_dung': ['cv_khong_ap_dung'],
                'cv_khong_ap_dung_list': ['cv_khong_ap_dung'],
                'cv_chua_du_dieu_kien': ['cv_chua_du_dieu_kien'],
                'cv_chua_du_dieu_kien_list': ['cv_chua_du_dieu_kien'],
                'chu_dau_tu': ['chu_dau_tu'],
                'hop_dong': ['hop_dong'],
                'tai_khoan': ['user'],
                'to_chuc': ['to_chuc'],
                'goi_dich_vu': ['goi_dich_vu']
            }
            
            primary_keys = entity_keys.get(src_table, [])
            if src_table in ('nha_thau', 'thong_tin_mo_thau', 'nha_thau_trung_thau', 'nha_thau_truot_thau'):
                primary_keys = list(set(entity_keys['nha_thau'] + entity_keys['thong_tin_mo_thau']))
            elif src_table in ('chuyen_gia', 'to_chuyen_gia', 'to_tham_dinh'):
                primary_keys = list(set(entity_keys['chuyen_gia']))
            elif src_table in ('yeu_cau_lam_ro', 'yeu_cau_lam_ro_list'):
                primary_keys = ['yeu_cau_lam_ro_list']
            elif src_table in ('tra_loi_lam_ro', 'tra_loi_lam_ro_list'):
                primary_keys = ['tra_loi_lam_ro_list']
            elif src_table in ('phan_lo', 'phan_lo_list', 'awarded_phan_lo_list'):
                primary_keys = list(set(entity_keys['phan_lo']))
            elif src_table in ('tuy_chon_mua_them', 'tuy_chon_mua_them_list'):
                primary_keys = ['tuy_chon_mua_them_list']
            elif src_table in ('gia_han', 'gia_han_list'):
                primary_keys = ['gia_han_list']
            elif src_table == 'thanh_vien_lien_danh':
                primary_keys = ['thanh_vien_lien_danh']
            elif src_table in ('cv_da_thuc_hien', 'cv_da_thuc_hien_list'):
                primary_keys = ['cv_da_thuc_hien']
            elif src_table in ('cv_khong_ap_dung', 'cv_khong_ap_dung_list'):
                primary_keys = ['cv_khong_ap_dung']
            elif src_table in ('cv_chua_du_dieu_kien', 'cv_chua_du_dieu_kien_list'):
                primary_keys = ['cv_chua_du_dieu_kien']
            
            custom_lists = []
            for l_bien, l_table, l_col in mappings_rows:
                if not l_col or l_col == '*' or l_col == '':
                    is_match = (
                        (l_table == src_table)
                        or (src_table in ('nha_thau', 'thong_tin_mo_thau', 'nha_thau_trung_thau', 'nha_thau_truot_thau') and l_table in ('nha_thau', 'thong_tin_mo_thau', 'nha_thau_trung_thau', 'nha_thau_truot_thau'))
                        or (src_table in ('chuyen_gia', 'to_chuyen_gia', 'to_tham_dinh') and l_table in ('chuyen_gia', 'to_chuyen_gia', 'to_tham_dinh'))
                        or (src_table in ('yeu_cau_lam_ro', 'yeu_cau_lam_ro_list') and l_table in ('yeu_cau_lam_ro', 'yeu_cau_lam_ro_list'))
                        or (src_table in ('tra_loi_lam_ro', 'tra_loi_lam_ro_list') and l_table in ('tra_loi_lam_ro', 'tra_loi_lam_ro_list'))
                        or (src_table in ('phan_lo', 'phan_lo_list', 'awarded_phan_lo_list') and l_table in ('phan_lo', 'phan_lo_list', 'awarded_phan_lo_list'))
                        or (src_table in ('tuy_chon_mua_them', 'tuy_chon_mua_them_list') and l_table in ('tuy_chon_mua_them', 'tuy_chon_mua_them_list'))
                        or (src_table in ('gia_han', 'gia_han_list') and l_table in ('gia_han', 'gia_han_list'))
                        or (src_table == 'thanh_vien_lien_danh' and l_table == 'thanh_vien_lien_danh')
                        or (src_table in ('cv_da_thuc_hien', 'cv_da_thuc_hien_list') and l_table in ('cv_da_thuc_hien', 'cv_da_thuc_hien_list'))
                        or (src_table in ('cv_khong_ap_dung', 'cv_khong_ap_dung_list') and l_table in ('cv_khong_ap_dung', 'cv_khong_ap_dung_list'))
                        or (src_table in ('cv_chua_du_dieu_kien', 'cv_chua_du_dieu_kien_list') and l_table in ('cv_chua_du_dieu_kien', 'cv_chua_du_dieu_kien_list'))
                    )
                    if is_match:
                        custom_lists.append(l_bien.lower())
            
            all_keys = list(set(primary_keys + custom_lists))
            
            val_found = False
            resolved_val = None
            
            for key in all_keys:
                if key in context:
                    target = context[key]
                    if isinstance(target, list):
                        for item in target:
                            if isinstance(item, dict):
                                val = item.get(src_column)
                                if val is not None:
                                    formatted = format_mapped_value(val, src_column)
                                    item[ten_bien] = formatted
                                    resolved_val = formatted
                                    val_found = True
                    elif isinstance(target, dict):
                        val = target.get(src_column)
                        if val is not None:
                            formatted = format_mapped_value(val, src_column)
                            target[ten_bien] = formatted
                            resolved_val = formatted
                            val_found = True
                            
            if val_found:
                context[ten_bien] = resolved_val
            else:
                # Fallback for investor
                if src_table == 'chu_dau_tu':
                    if src_column == 'ten_chu_dau_tu':
                        context[ten_bien] = context.get('investor_name', '--')
                    elif src_column == 'dia_chi':
                        context[ten_bien] = context.get('investor_address', '--')

async def export_plan_api(request):
    plan_id = clean_id(request.path_params.get('plan_id'))
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        org_name = get_active_org(request, user_id)

        # Build context from service
        unified_context = docx_service.build_plan_context(plan_id, user_id, org_name)
        enrich_context_with_filtered_bidders(unified_context)
        
        # Load mappings
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT ten_bien, source_table, source_column FROM cau_hinh_bien_word WHERE owner_id = ?", (org_name,))
        mappings_rows = cursor.fetchall()
        conn.close()
        
        apply_custom_mappings(unified_context, mappings_rows)
        custom_vars_list = [row[0].lower() for row in mappings_rows]

        active_tpl = custom_exporter.get_active_template(user_id)
        if active_tpl in ['mau_bao_cao_dau_thau.docx', 'mau_hop_dong_lcnt.docx']:
            tpl_path = os.path.join(custom_exporter.TEMPLATE_DIR, active_tpl)
        else:
            user_dir = custom_exporter.get_user_template_dir(user_id)
            tpl_path = os.path.join(user_dir, active_tpl)
            
        docx_stream = custom_exporter.generate_report_from_custom_template(tpl_path, unified_context, custom_vars_list)
        
        filename = f"Ke_hoach_LCNT_{unified_context['ke_hoach']['ma_ke_hoach']}.docx"
        return StreamingResponse(
            docx_stream,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except OrgPermissionError as e:
        return JSONResponse({"error": str(e)}, status_code=403)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

async def export_report_api(request):
    package_id = clean_id(request.path_params.get('package_id'))
    type_param = request.query_params.get('type', 'evaluation')
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        org_name = get_active_org(request, user_id)

        # Build context from service
        unified_context = docx_service.build_report_context(package_id, user_id, org_name, type_param)
        enrich_context_with_filtered_bidders(unified_context)
        
        # Load mappings
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT ten_bien, source_table, source_column FROM cau_hinh_bien_word WHERE owner_id = ?", (org_name,))
        mappings_rows = cursor.fetchall()
        conn.close()
        
        apply_custom_mappings(unified_context, mappings_rows)
        custom_vars_list = [row[0].lower() for row in mappings_rows]

        active_tpl = custom_exporter.get_active_template(user_id)
        if type_param == 'contract':
            if active_tpl != 'mau_hop_dong_lcnt.docx':
                active_tpl = 'mau_hop_dong_lcnt.docx'
                
        if active_tpl in ['mau_bao_cao_dau_thau.docx', 'mau_hop_dong_lcnt.docx']:
            tpl_path = os.path.join(custom_exporter.TEMPLATE_DIR, active_tpl)
        else:
            user_dir = custom_exporter.get_user_template_dir(user_id)
            tpl_path = os.path.join(user_dir, active_tpl)
            
        docx_stream = custom_exporter.generate_report_from_custom_template(tpl_path, unified_context, custom_vars_list)
        
        if type_param == 'contract':
            filename = f"Hop_dong_{unified_context['hop_dong'].get('so_hop_dong', 'LCNT')}.docx"
        elif type_param in ['hsmt', 'opening']:
            filename = f"{type_param.upper()}_{unified_context['goi_thau']['ma_goi_thau']}.docx"
        else:
            filename = f"Bao_cao_danh_gia_goi_thau_{unified_context['goi_thau']['ma_goi_thau']}.docx"

        return StreamingResponse(
            docx_stream,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except OrgPermissionError as e:
        return JSONResponse({"error": str(e)}, status_code=403)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

async def list_templates_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        
        templates = custom_exporter.list_templates(user_id)
        return JSONResponse(templates)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

async def set_active_template_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        
        data = await request.json()
        template_name = data.get('template_name')
        if not template_name:
            return JSONResponse({"error": "Missing template_name parameter"}, status_code=400)
            
        success = custom_exporter.set_active_template(user_id, template_name)
        if success:
            return JSONResponse({"success": True})
        return JSONResponse({"error": "Failed to set active template"}, status_code=400)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

async def upload_template_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        
        form = await request.form()
        file_obj = form.get('file')
        if not file_obj:
            return JSONResponse({"success": False, "error": "Không tìm thấy tệp tin tải lên!"}, status_code=400)
            
        filename = file_obj.filename
        _, ext = os.path.splitext(filename)
        if ext.lower() not in ['.docx', '.doc']:
            return JSONResponse({"success": False, "error": "Chỉ cho phép tải lên tệp tin định dạng .docx hoặc .doc!"}, status_code=400)
            
        user_dir = custom_exporter.get_user_template_dir(user_id)
        dest_path = os.path.join(user_dir, filename)
        
        content = await file_obj.read()
        with open(dest_path, "wb") as f:
            f.write(content)
            
        custom_exporter.set_active_template(user_id, filename)
        return JSONResponse({"success": True, "filename": filename})
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)

async def list_word_mappings_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        org_name = get_active_org(request, user_id)
        
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id, ten_bien, source_table, source_column, mo_ta FROM cau_hinh_bien_word WHERE owner_id = ?", (org_name,))
        rows = cursor.fetchall()
        conn.close()
        
        mappings = []
        for row in rows:
            r = dict(row)
            r['tenBien'] = r.get('ten_bien')
            r['sourceTable'] = r.get('source_table')
            r['sourceColumn'] = r.get('source_column')
            r['moTa'] = r.get('mo_ta')
            mappings.append(r)
        return JSONResponse(mappings)
    except OrgPermissionError as e:
        return JSONResponse({"error": str(e)}, status_code=403)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

async def save_word_mapping_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        org_name = get_active_org(request, user_id)
        
        data = await request.json()
        ten_bien = (data.get('ten_bien') or data.get('tenBien') or '').strip().lower()
        source_table = (data.get('source_table') or data.get('sourceTable') or '').strip()
        source_column = (data.get('source_column') or data.get('sourceColumn') or '').strip()
        mo_ta = (data.get('mo_ta') or data.get('moTa') or '').strip()
        
        if not source_column:
            source_column = ""
            
        if not ten_bien or not source_table:
            return JSONResponse({"error": "Vui lòng nhập đầy đủ thông tin!"}, status_code=400)
            
        conn = database.get_connection()
        cursor = conn.cursor()
        
        # Check if variable name exists
        cursor.execute("SELECT id FROM cau_hinh_bien_word WHERE ten_bien = ? AND owner_id = ?", (ten_bien, org_name))
        row = cursor.fetchone()
        
        if row:
            cursor.execute("""
                UPDATE cau_hinh_bien_word 
                SET source_table = ?, source_column = ?, mo_ta = ?
                WHERE ten_bien = ? AND owner_id = ?
            """, (source_table, source_column, mo_ta, ten_bien, org_name))
            mapping_id = row[0]
        else:
            mapping_id = "wmp-" + str(uuid.uuid4())[:8]
            cursor.execute("""
                INSERT INTO cau_hinh_bien_word (id, ten_bien, source_table, source_column, mo_ta, owner_id)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (mapping_id, ten_bien, source_table, source_column, mo_ta, org_name))
            
        conn.commit()
        conn.close()
        return JSONResponse({"success": True, "id": mapping_id})
    except OrgPermissionError as e:
        return JSONResponse({"error": str(e)}, status_code=403)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

async def delete_word_mapping_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        org_name = get_active_org(request, user_id)
        
        mapping_id = request.path_params.get('mapping_id')
        if not mapping_id:
            return JSONResponse({"error": "Missing mapping_id parameter"}, status_code=400)
            
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM cau_hinh_bien_word WHERE id = ? AND owner_id = ?", (mapping_id, org_name))
        conn.commit()
        conn.close()
        return JSONResponse({"success": True})
    except OrgPermissionError as e:
        return JSONResponse({"error": str(e)}, status_code=403)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
