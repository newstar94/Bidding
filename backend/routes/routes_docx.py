import os
import json
import re
import zipfile
from datetime import datetime
from urllib.parse import quote
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

SYSTEM_TEMPLATES = {'mau_bao_cao_dau_thau.docx', 'mau_hop_dong_lcnt.docx'}
MAX_TEMPLATE_UPLOAD_BYTES = 10 * 1024 * 1024


def _safe_filename(value, fallback='download.docx'):
    name = os.path.basename(str(value or fallback)).strip()
    name = re.sub(r'[^A-Za-z0-9_.-]+', '_', name)
    name = name.strip('._')
    return name or fallback


def _content_disposition(filename):
    safe_name = _safe_filename(filename)
    return f"attachment; filename={safe_name}; filename*=UTF-8''{quote(safe_name)}"


def _resolve_template_path(user_id, filename):
    safe_name = _safe_filename(filename)
    if safe_name in SYSTEM_TEMPLATES:
        base_dir = os.path.realpath(custom_exporter.TEMPLATE_DIR)
    else:
        base_dir = os.path.realpath(custom_exporter.get_user_template_dir(user_id))
    path = os.path.realpath(os.path.join(base_dir, safe_name))
    if not path.startswith(base_dir + os.sep):
        raise ValueError('Tên mẫu không hợp lệ')
    if not os.path.exists(path):
        raise FileNotFoundError('Không tìm thấy mẫu Word')
    return path, safe_name


def _validate_docx_upload(filename, content):
    safe_name = _safe_filename(filename, f"template_{uuid.uuid4().hex[:8]}.docx")
    root, ext = os.path.splitext(safe_name)
    if ext.lower() != '.docx':
        raise ValueError('Chỉ cho phép tải lên tệp .docx')
    if not content:
        raise ValueError('Tệp tải lên đang trống')
    if len(content) > MAX_TEMPLATE_UPLOAD_BYTES:
        raise ValueError('Tệp mẫu vượt quá giới hạn 10MB')
    import io
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            names = set(zf.namelist())
            if '[Content_Types].xml' not in names or 'word/document.xml' not in names:
                raise ValueError('Tệp .docx không hợp lệ')
    except zipfile.BadZipFile:
        raise ValueError('Tệp .docx không hợp lệ')
    return _safe_filename(f"{root[:80]}_{uuid.uuid4().hex[:8]}.docx")

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
        tpl_path, active_tpl = _resolve_template_path(user_id, active_tpl)
            
        docx_stream = custom_exporter.generate_report_from_custom_template(tpl_path, unified_context, custom_vars_list)
        
        filename = f"Ke_hoach_LCNT_{unified_context['ke_hoach']['ma_ke_hoach']}.docx"
        return StreamingResponse(
            docx_stream,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": _content_disposition(filename)}
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
                
        tpl_path, active_tpl = _resolve_template_path(user_id, active_tpl)
            
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
            headers={"Content-Disposition": _content_disposition(filename)}
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
        template_name = data.get('template_name') or data.get('filename')
        if not template_name:
            return JSONResponse({"error": "Missing template_name parameter"}, status_code=400)
            
        _, safe_name = _resolve_template_path(user_id, template_name)
        custom_exporter.set_active_template(safe_name, user_id)
        return JSONResponse({"success": True})
    except FileNotFoundError as e:
        return JSONResponse({"error": str(e)}, status_code=404)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
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
            
        content = await file_obj.read()
        try:
            filename = _validate_docx_upload(file_obj.filename, content)
        except ValueError as e:
            return JSONResponse({"success": False, "error": str(e)}, status_code=400)

        user_dir = os.path.realpath(custom_exporter.get_user_template_dir(user_id))
        dest_path = os.path.realpath(os.path.join(user_dir, filename))
        if not dest_path.startswith(user_dir + os.sep):
            return JSONResponse({"success": False, "error": "Tên tệp không hợp lệ"}, status_code=400)

        with open(dest_path, "wb") as f:
            f.write(content)
            
        custom_exporter.set_active_template(filename, user_id)
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
        
        # Clean up any existing mapping for is_tong_muc_tu_dong to keep only 1 mapping for total investment
        cursor.execute("DELETE FROM cau_hinh_bien_word WHERE source_table = 'ke_hoach_lcnt' AND source_column = 'is_tong_muc_tu_dong' AND owner_id = ?", (org_name,))
        
        # Tự động cấu hình mẫu tất cả biến và danh sách ở lần chạy đầu tiên (nếu trống)
        # Tự động gieo tất cả biến và danh sách mặc định nếu chưa có (diff-based auto seeding)
        cursor.execute("SELECT ten_bien, source_table, source_column FROM cau_hinh_bien_word WHERE owner_id = ?", (org_name,))
        existing = cursor.fetchall()
        existing_keys = {(row[1], row[2]) for row in existing}
        existing_vars = {row[0].lower() for row in existing}

        import uuid
        
        # Khởi tạo đầy đủ 100% tất cả các trường từ điển dữ liệu hệ thống
        default_seeds_data = {
            'chu_dau_tu': [
                ('ma_chu_dau_tu', 'ma_chu_dau_tu', 'Mã chủ đầu tư'),
                ('ten_chu_dau_tu', 'ten_chu_dau_tu', 'Tên chủ đầu tư'),
                ('ma_so_thue', 'ma_so_thue_cdt', 'Mã số thuế chủ đầu tư'),
                ('chuc_vu_nguoi_dung_dau', 'chuc_vu_nguoi_dung_dau', 'Chức vụ người đứng đầu (ví dụ: Giám đốc)'),
                ('dai_dien_cdt', 'dai_dien_cdt', 'Họ tên người đại diện chủ đầu tư'),
                ('chuc_vu_dai_dien', 'chuc_vu_dai_dien', 'Chức vụ người đại diện chủ đầu tư'),
                ('danh_xung', 'danh_xung_cdt', 'Danh xưng người đại diện chủ đầu tư (Ông/Bà)'),
                ('dia_chi', 'dia_chi_cdt', 'Địa chỉ chủ đầu tư'),
                ('so_dien_thoai', 'so_dien_thoai_cdt', 'Số điện thoại chủ đầu tư'),
                ('so_tai_khoan', 'so_tai_khoan_cdt', 'Số tài khoản chủ đầu tư'),
                ('noi_mo_tai_khoan', 'noi_mo_tai_khoan_cdt', 'Nơi mở tài khoản chủ đầu tư'),
                ('email', 'email_cdt', 'Email chủ đầu tư'),
                ('ma_qhns', 'ma_qhns_cdt', 'Mã QHNS (Quan hệ ngân sách) chủ đầu tư'),
                ('co_quan_chu_quan', 'co_quan_chu_quan_cdt', 'Cơ quan chủ quan của chủ đầu tư'),
                ('phien_ban', 'phien_ban_cdt', 'Phiên bản dữ liệu')
            ],
            'ke_hoach_lcnt': [
                ('ma_ke_hoach', 'ma_ke_hoach', 'Mã kế hoạch lựa chọn nhà thầu (LCNT)'),
                ('ma_du_an', 'ma_du_an', 'Mã dự án đầu tư'),
                ('ten_ke_hoach', 'ten_ke_hoach', 'Tên kế hoạch lựa chọn nhà thầu (LCNT)'),
                ('ten_du_an_du_toan', 'ten_du_an_du_toan', 'Tên dự án / Dự toán mua sắm'),
                ('loai_hinh_mua_sam', 'loai_hinh_mua_sam', 'Loại hình mua sắm (ví dụ: Xây lắp, Hàng hóa, Phi tư vấn...)'),
                ('tong_muc_dau_tu', 'tong_muc_dau_tu', 'Tổng mức đầu tư dự án / Tổng dự toán'),
                ('ngay_phe_duyet', 'ngay_phe_duyet_kh', 'Ngày phê duyệt quyết định kế hoạch LCNT'),
                ('quyet_dinh_phe_duyet', 'quyet_dinh_phe_duyet_kh', 'Số quyết định phê duyệt kế hoạch LCNT'),
                ('thoi_gian_dang_tai', 'thoi_gian_dang_tai_kh', 'Thời gian dự kiến đăng tải kế hoạch LCNT'),
                ('nguon_von', 'nguon_von', 'Nguồn vốn'),
                ('thoi_gian_du_an', 'thoi_gian_du_an', 'Thời gian thực hiện dự án'),
                ('dia_diem_quy_mo', 'dia_diem_quy_mo', 'Địa điểm và quy mô xây dựng/mua sắm'),
                ('thong_tin_khac', 'thong_tin_khac_kh', 'Thông tin bổ sung khác'),
                ('so_qd_phe_duyet_du_an', 'so_qd_phe_duyet_du_an', 'Số quyết định phê duyệt dự án đầu tư'),
                ('ngay_qd_phe_duyet_du_an', 'ngay_qd_phe_duyet_du_an', 'Ngày quyết định phê duyệt dự án đầu tư'),
                ('co_quan_phe_duyet_du_an', 'co_quan_phe_duyet_du_an', 'Cơ quan ban hành quyết định phê duyệt dự án'),
                ('phe_duyet', 'phe_duyet_kh', 'Họ tên người phê duyệt kế hoạch LCNT'),
                ('ngay_trinh_du_toan', 'ngay_trinh_du_toan', 'Ngày trình duyệt dự toán'),
                ('ngay_phe_duyet_du_toan', 'ngay_phe_duyet_du_toan', 'Ngày phê duyệt dự toán'),
                ('so_qd_phe_duyet_du_toan', 'so_qd_phe_duyet_du_toan', 'Số quyết định phê duyệt dự toán'),
                ('ngay_trinh_ke_hoach', 'ngay_trinh_ke_hoach', 'Ngày trình phê duyệt kế hoạch LCNT'),
                ('phien_ban', 'phien_ban_kh', 'Phiên bản dữ liệu')
            ],
            'goi_thau': [
                ('ma_goi_thau', 'ma_goi_thau', 'Mã gói thầu (Mã TBMT)'),
                ('ten_goi_thau', 'ten_goi_thau', 'Tên gói thầu'),
                ('gia_goi_thau', 'gia_goi_thau', 'Giá dự toán gói thầu'),
                ('hinh_thuc_lua_chon', 'hinh_thuc_lcnt', 'Hình thức lựa chọn nhà thầu'),
                ('phuong_thuc_lua_chon', 'phuong_thuc_lcnt', 'Phương thức lựa chọn nhà thầu'),
                ('loai_hop_dong', 'loai_hop_dong_gt', 'Loại hợp đồng gói thầu'),
                ('thoi_gian_thuc_hien', 'thoi_gian_thuc_hien_gt_kh', 'Thời gian thực hiện gói thầu theo kế hoạch LCNT'),
                ('nguon_von', 'nguon_von_gt', 'Nguồn vốn gói thầu'),
                ('gia_trung_thau', 'gia_trung_thau', 'Giá trúng thầu'),
                ('linh_vuc', 'linh_vuc_gt', 'Lĩnh vực gói thầu'),
                ('tuy_chon_mua_them', 'tuy_chon_mua_them_gt', 'Tùy chọn mua thêm (Có/Không)'),
                ('thoi_gian_to_chuc', 'thoi_gian_to_chuc', 'Thời gian tổ chức LCNT'),
                ('thoi_gian_bat_dau_to_chuc', 'thoi_gian_bat_dau_to_chuc', 'Thời gian bắt đầu tổ chức LCNT'),
                ('phan_lo', 'phan_lo_gt', 'Phân lô gói thầu (Có/Không)'),
                ('thoi_gian_dang_tai', 'thoi_gian_dang_tai_gt', 'Thời gian đăng tải thông báo mời thầu'),
                ('thoi_gian_dong_thau', 'thoi_gian_dong_thau', 'Thời gian đóng thầu'),
                ('thoi_gian_mo_thau', 'thoi_gian_mo_thau', 'Thời gian mở thầu'),
                ('thoi_gian_mo_ehsdxtc', 'thoi_gian_mo_ehsdxtc', 'Thời gian mở E-HSDXTC (Hồ sơ đề xuất kỹ thuật)'),
                ('so_quyet_dinh', 'so_quyet_dinh_du_toan', 'Số quyết định phê duyệt HSMT / Hồ sơ yêu cầu'),
                ('ngay_quyet_dinh', 'ngay_quyet_dinh_du_toan', 'Ngày quyết định phê duyệt HSMT / Hồ sơ yêu cầu'),
                ('so_quyet_dinh_ket_qua', 'so_quyet_dinh_ket_qua', 'Số quyết định phê duyệt kết quả LCNT'),
                ('ngay_quyet_dinh_ket_qua', 'ngay_quyet_dinh_ket_qua', 'Ngày quyết định phê duyệt kết quả LCNT'),
                ('thoi_gian_goi_thau', 'thoi_gian_goi_thau_winner', 'Thời gian thực hiện gói thầu của nhà thầu trúng thầu'),
                ('thoi_gian_hop_dong', 'thoi_gian_hop_dong_winner', 'Thời gian thực hiện hợp đồng của nhà thầu trúng thầu'),
                ('gia_tri_dam_bao_du_thau', 'gia_tri_dam_bao_du_thau', 'Giá trị bảo đảm dự thầu'),
                ('hieu_luc_hsdt', 'hieu_luc_hsdt', 'Hiệu lực của HSDT (ngày)'),
                ('hieu_luc_dam_bao_du_thau', 'hieu_luc_dam_bao_du_thau', 'Hiệu lực bảo đảm dự thầu (ngày)'),
                ('phuong_phap_danh_gia', 'phuong_phap_danh_gia', 'Phương pháp đánh giá hồ sơ dự thầu (HSDT)'),
                ('trong_so_ky_thuat', 'trong_so_ky_thuat', 'Trọng số điểm kỹ thuật (%)'),
                ('ngay_moi_doi_chieu', 'ngay_moi_doi_chieu', 'Ngày mời đối chiếu tài liệu/Thương thảo'),
                ('ngay_doi_chieu', 'ngay_doi_chieu', 'Ngày đối chiếu tài liệu/Thương thảo'),
                ('ty_le_bao_dam_hop_dong', 'ty_le_bao_dam_hop_dong', 'Tỷ lệ bảo đảm thực hiện hợp đồng (%)'),
                ('is_thuoc', 'is_thuoc_mua_sam_tap_trung', 'Thuộc danh mục mua sắm tập trung (0/1)'),
                ('yeu_cau_tham_dinh_hsmt', 'yeu_cau_tham_dinh_hsmt', 'Yêu cầu thẩm định HSMT (Có/Không)'),
                ('so_bao_cao_tham_dinh_hsmt', 'so_bao_cao_tham_dinh_hsmt', 'Số báo cáo thẩm định HSMT'),
                ('ngay_bao_cao_tham_dinh_hsmt', 'ngay_bao_cao_tham_dinh_hsmt', 'Ngày báo cáo thẩm định HSMT'),
                ('so_to_trinh_hsmt', 'so_to_trinh_hsmt', 'Số tờ trình phê duyệt HSMT'),
                ('ngay_trinh_hsmt', 'ngay_trinh_hsmt', 'Ngày trình phê duyệt HSMT'),
                ('trang_thai', 'trang_thai_gt', 'Trạng thái gói thầu'),
                ('phien_ban', 'phien_ban_gt', 'Phiên bản dữ liệu')
            ],
            'nha_thau': [
                ('ma_nha_thau', 'ma_nha_thau', 'Mã nhà thầu'),
                ('ten_nha_thau', 'ten_nha_thau', 'Tên nhà thầu'),
                ('loai_nha_thau', 'loai_nha_thau', 'Loại nhà thầu (Độc lập/Liên danh)'),
                ('ma_so_thue', 'ma_so_thue_nt', 'Mã số thuế nhà thầu'),
                ('nguoi_dai_dien', 'nguoi_dai_dien_nt', 'Người đại diện nhà thầu'),
                ('danh_xung', 'danh_xung_nt', 'Danh xưng người đại diện nhà thầu'),
                ('so_dien_thoai', 'so_dien_thoai_nt', 'Số điện thoại nhà thầu'),
                ('email', 'email_nt', 'Email nhà thầu'),
                ('dia_chi', 'dia_chi_nt', 'Địa chỉ nhà thầu'),
                ('so_tai_khoan', 'so_tai_khoan_nt', 'Số tài khoản nhà thầu'),
                ('noi_mo_tai_khoan', 'noi_mo_tai_khoan_nt', 'Nơi mở tài khoản nhà thầu'),
                ('ma_ngan_hang', 'ma_ngan_hang_nt', 'Mã ngân hàng nhà thầu'),
                ('phien_ban', 'phien_ban_nt', 'Phiên bản dữ liệu')
            ],
            'hop_dong': [
                ('ten_hop_dong', 'ten_hop_dong', 'Tên hợp đồng'),
                ('so_hop_dong', 'so_hop_dong', 'Số hợp đồng'),
                ('ngay_ky', 'ngay_ky_hd', 'Ngày ký hợp đồng'),
                ('gia_tri', 'gia_tri_hd', 'Giá trị hợp đồng'),
                ('loai_hop_dong', 'loai_hop_dong_hd', 'Loại hợp đồng'),
                ('thoi_gian_thuc_hien', 'thoi_gian_thuc_hien_hd', 'Thời gian thực hiện hợp đồng (ngày)'),
                ('trang_thai_ho_so', 'trang_thai_ho_so_hd', 'Trạng thái hồ sơ hợp đồng'),
                ('phan_loai', 'phan_loai_hd', 'Phân loại hợp đồng (Tư vấn/Thẩm định/Khác)'),
                ('co_qd_chi_dinh', 'co_qd_chi_dinh_hd', 'Có quyết định chỉ định thầu (0/1)'),
                ('so_qd_chi_dinh', 'so_qd_chi_dinh_hd', 'Số quyết định chỉ định thầu'),
                ('ngay_qd_chi_dinh', 'ngay_qd_chi_dinh_hd', 'Ngày quyết định chỉ định thầu')
            ],
            'chuyen_gia': [
                ('ho_ten', 'ho_ten', 'Họ tên chuyên gia'),
                ('so_cccd', 'so_cccd', 'Số CCCD chuyên gia'),
                ('ngay_cap_cccd', 'ngay_cap_cccd', 'Ngày cấp CCCD chuyên gia'),
                ('noi_cap_cccd', 'noi_cap_cccd', 'Nơi cấp CCCD chuyên gia'),
                ('so_chung_chi', 'so_chung_chi', 'Số chứng chỉ chuyên gia'),
                ('ngay_cap_chung_chi', 'ngay_cap_chung_chi', 'Ngày cấp chứng chỉ chuyên gia'),
                ('don_vi_cap_chung_chi', 'don_vi_cap_chung_chi', 'Đơn vị cấp chứng chỉ chuyên gia'),
                ('chuc_vu', 'chuc_vu', 'Chức vụ chuyên gia trong tổ chuyên gia/thẩm định'),
                ('cong_viec', 'cong_viec', 'Nhiệm vụ chuyên gia được phân công')
            ],
            'thong_tin_mo_thau': [
                ('ma_phan_lo', 'ma_phan_lo_mt', 'Mã phân lô mở thầu'),
                ('ten_phan_lo', 'ten_phan_lo_mt', 'Tên phân lô mở thầu'),
                ('ma_dinh_danh', 'ma_dinh_danh_mt', 'Mã định danh mở thầu'),
                ('gia_du_thau', 'gia_du_thau', 'Giá dự thầu mở thầu'),
                ('dam_bao_du_thau', 'dam_bao_du_thau_mt', 'Bảo đảm dự thầu mở thầu'),
                ('hieu_luc_dam_bao', 'hieu_luc_dam_bao_mt', 'Hiệu lực bảo đảm mở thầu'),
                ('hieu_luc_hsdxt', 'hieu_luc_hsdxt_mt', 'Hiệu lực HSDXT mở thầu'),
                ('ty_le_giam_gia', 'ty_le_giam_gia_mt', 'Tỷ lệ giảm giá mở thầu'),
                ('gia_sau_giam_gia', 'gia_sau_giam_gia', 'Giá sau giảm giá mở thầu'),
                ('hieu_luc_hsdt', 'hieu_luc_hsdt_mt', 'Hiệu lực HSDT mở thầu (ngày)'),
                ('gia_tri_dam_bao', 'gia_tri_dam_bao_mt', 'Giá trị bảo đảm mở thầu'),
                ('hieu_luc_bao_dam_ngay', 'hieu_luc_bao_dam_ngay_mt', 'Hiệu lực bảo đảm mở thầu (ngày)'),
                ('thoi_gian_thuc_hien', 'thoi_gian_thuc_hien_mt', 'Thời gian thực hiện mở thầu'),
                ('ten_nha_thau', 'ten_nha_thau_mt', 'Tên nhà thầu mở thầu'),
                ('loai_nha_thau', 'loai_nha_thau_mt', 'Loại nhà thầu mở thầu'),
                ('danh_gia_hop_le', 'danh_gia_hop_le_mt', 'Đánh giá hợp lệ mở thầu'),
                ('danh_gia_nang_luc', 'danh_gia_nang_luc_mt', 'Đánh giá năng lực mở thầu'),
                ('danh_gia_ky_thuat', 'danh_gia_ky_thuat_mt', 'Đánh giá kỹ thuật mở thầu'),
                ('danh_gia_tai_chinh', 'danh_gia_tai_chinh_mt', 'Đánh giá tài chính mở thầu'),
                ('danh_gia_ket_luan', 'danh_gia_ket_luan', 'Đánh giá kết luận mở thầu'),
                ('ly_do_truot', 'ly_do_truot', 'Lý do trượt mở thầu'),
                ('lam_ro_hop_le', 'lam_ro_hop_le_mt', 'Làm rõ hợp lệ mở thầu'),
                ('lam_ro_nang_luc', 'lam_ro_nang_luc_mt', 'Làm rõ năng lực mở thầu'),
                ('lam_ro_ky_thuat', 'lam_ro_ky_thuat_mt', 'Làm rõ kỹ thuật mở thầu'),
                ('lam_ro_tai_chinh', 'lam_ro_tai_chinh_mt', 'Làm rõ tài chính mở thầu'),
                ('nguyen_nhan_khong_dat_hop_le', 'nguyen_nhan_khong_dat_hop_le_mt', 'Nguyên nhân không đạt đánh giá hợp lệ'),
                ('nguyen_nhan_khong_dat_nang_luc', 'nguyen_nhan_khong_dat_nang_luc_mt', 'Nguyên nhân không đạt đánh giá năng lực/kinh nghiệm'),
                ('nguyen_nhan_khong_dat_ky_thuat', 'nguyen_nhan_khong_dat_ky_thuat_mt', 'Nguyên nhân không đạt đánh giá kỹ thuật')
            ],
            'tai_khoan': [
                ('ten_dang_nhap', 'ten_dang_nhap', 'Tên đăng nhập hệ thống'),
                ('ho_ten', 'ho_ten_user', 'Họ tên tài khoản'),
                ('vai_tro', 'vai_tro_user', 'Vai trò tài khoản'),
                ('email', 'email_user', 'Email tài khoản'),
                ('ngay_bat_dau_goi', 'ngay_bat_dau_goi_user', 'Ngày bắt đầu gói dịch vụ'),
                ('ngay_het_han_goi', 'ngay_het_han_goi_user', 'Ngày hết hạn gói dịch vụ'),
                ('da_xac_minh', 'da_xac_minh_user', 'Đã xác minh tài khoản (0/1)')
            ],
            'to_chuc': [
                ('ten_to_chuc', 'ten_to_chuc', 'Tên tổ chức / Doanh nghiệp')
            ],
            'goi_dich_vu': [
                ('ten_goi', 'ten_goi_dv', 'Tên gói dịch vụ'),
                ('gia_ca', 'gia_ca_dv', 'Giá gói dịch vụ'),
                ('han_muc_nhan_su', 'han_muc_nhan_su_dv', 'Hạn mức nhân sự tối đa'),
                ('mo_ta', 'mo_ta_dv', 'Mô tả chi tiết gói')
            ],
            'yeu_cau_lam_ro': [
                ('thoi_gian_yeu_cau', 'thoi_gian_yeu_cau', 'Thời gian yêu cầu làm rõ'),
                ('noi_dung_yeu_cau', 'noi_dung_yeu_cau', 'Nội dung yêu cầu làm rõ')
            ],
            'tra_loi_lam_ro': [
                ('thoi_gian_tra_loi', 'thoi_gian_tra_loi', 'Thời gian trả lời làm rõ'),
                ('noi_dung_tra_loi', 'noi_dung_tra_loi', 'Nội dung trả lời làm rõ')
            ],
            'phan_lo': [
                ('ma_phan_lo', 'ma_phan_lo', 'Mã phân lô'),
                ('ten_phan_lo', 'ten_phan_lo', 'Tên phân lô'),
                ('gia_tri_phan_lo', 'gia_tri_phan_lo', 'Giá trị phân lô'),
                ('nha_thau_trung', 'nha_thau_trung', 'Nhà thầu trúng thầu phân lô'),
                ('thoi_gian_thuc_hien', 'thoi_gian_thuc_hien', 'Thời gian thực hiện phân lô')
            ],
            'tuy_chon_mua_them': [
                ('hang_muc', 'hang_muc', 'Hạng mục mua thêm'),
                ('don_vi', 'don_vi', 'Đơn vị tính mua thêm'),
                ('so_luong', 'so_luong', 'Số lượng mua thêm'),
                ('ty_le', 'ty_le', 'Tỷ lệ mua thêm'),
                ('gia_tri_uoc_tinh', 'gia_tri_uoc_tinh', 'Giá trị ước tính mua thêm')
            ],
            'gia_han': [
                ('thoi_gian_truoc', 'thoi_gian_truoc', 'Thời gian trước gia hạn'),
                ('thoi_gian_sau', 'thoi_gian_sau', 'Thời gian sau gia hạn'),
                ('ngay_gia_han', 'ngay_gia_han', 'Ngày quyết định gia hạn'),
                ('ly_do', 'ly_do', 'Lý do gia hạn')
            ],
            'thanh_vien_lien_danh': [
                ('ten_tv', 'ten_tv', 'Tên thành viên liên danh'),
                ('mst_tv', 'mst_tv', 'Mã số thuế thành viên liên danh'),
                ('vai_tro_tv', 'vai_tro_tv', 'Vai trò thành viên liên danh'),
                ('nguoi_dai_dien_tv', 'nguoi_dai_dien_tv', 'Người đại diện thành viên liên danh'),
                ('dia_chi_tv', 'dia_chi_tv', 'Địa chỉ thành viên liên danh'),
                ('so_tai_khoan_tv', 'so_tai_khoan_tv', 'Số tài khoản thành viên liên danh'),
                ('noi_mo_tai_khoan_tv', 'noi_mo_tai_khoan_tv', 'Nơi mở tài khoản thành viên liên danh')
            ],
            'cv_da_thuc_hien': [
                ('ten_cong_viec', 'ten_cong_viec_dth', 'Tên công việc đã thực hiện'),
                ('gia_tri', 'gia_tri_dth', 'Giá trị công việc đã thực hiện'),
                ('don_vi_thuc_hien', 'don_vi_thuc_hien_dth', 'Đơn vị thực hiện công việc'),
                ('van_ban_phe_duyet', 'van_ban_phe_duyet_dth', 'Văn bản phê duyệt công việc')
            ],
            'cv_khong_ap_dung': [
                ('ten_cong_viec', 'ten_cong_viec_kad', 'Tên công việc không áp dụng LCNT'),
                ('gia_tri', 'gia_tri_kad', 'Giá trị công việc không áp dụng LCNT'),
                ('don_vi_thuc_hien', 'don_vi_thuc_hien_kad', 'Đơn vị thực hiện công việc không áp dụng LCNT')
            ],
            'cv_chua_du_dieu_kien': [
                ('ten_cong_viec', 'ten_cong_viec_cdk', 'Tên công việc chưa đủ điều kiện LCNT'),
                ('gia_tri', 'gia_tri_cdk', 'Giá trị công việc chưa đủ điều kiện LCNT')
            ]
        }

        default_loops = [
            ("ds_goi_thau", "goi_thau", "Danh sách gói thầu / Phiên bản gói thầu"),
            ("ds_phan_lo", "phan_lo_list", "Danh sách phân lô gói thầu"),
            ("ds_mua_them", "tuy_chon_mua_them_list", "Danh sách tùy chọn mua thêm"),
            ("ds_nha_thau", "nha_thau", "Danh sách nhà thầu tham dự"),
            ("ds_nha_thau_trung", "nha_thau_trung_thau", "Danh sách nhà thầu trúng thầu"),
            ("ds_nha_thau_truot", "nha_thau_truot_thau", "Danh sách nhà thầu trượt thầu"),
            ("ds_chuyen_gia", "chuyen_gia", "Danh sách chuyên gia (toàn hệ thống)"),
            ("ds_to_chuyen_gia", "to_chuyen_gia", "Danh sách tổ chuyên gia"),
            ("ds_to_tham_dinh", "to_tham_dinh", "Danh sách tổ thẩm định"),
            ("ds_yeu_cau_lam_ro", "yeu_cau_lam_ro_list", "Danh sách yêu cầu làm rõ"),
            ("ds_tra_loi_lam_ro", "tra_loi_lam_ro_list", "Danh sách trả lời làm rõ"),
            ("ds_thanh_vien_lien_danh", "thanh_vien_lien_danh", "Danh sách thành viên liên danh"),
            ("ds_cv_da_thuc_hien", "cv_da_thuc_hien", "Danh sách công việc đã thực hiện"),
            ("ds_cv_khong_ap_dung", "cv_khong_ap_dung", "Danh sách công việc không áp dụng LCNT"),
            ("ds_cv_chua_du_dieu_kien", "cv_chua_du_dieu_kien", "Danh sách công việc chưa đủ điều kiện LCNT"),
            ("ds_ke_hoach", "ke_hoach_lcnt", "Danh sách kế hoạch LCNT"),
            ("ds_hop_dong", "hop_dong", "Danh sách hợp đồng"),
            ("ds_chu_dau_tu", "chu_dau_tu", "Danh sách chủ đầu tư / Bên mời thầu"),
            ("ds_tai_khoan", "tai_khoan", "Danh sách tài khoản / Nhân sự"),
            ("ds_to_chuc", "to_chuc", "Danh sách tổ chức / Doanh nghiệp"),
            ("ds_goi_dich_vu", "goi_dich_vu", "Danh sách gói dịch vụ"),
            ("ds_gia_han", "gia_han_list", "Danh sách gia hạn"),
            ("ds_phan_lo_trung_thau", "awarded_phan_lo_list", "Danh sách trúng thầu theo phân lô"),
            ("ds_thong_tin_mo_thau", "thong_tin_mo_thau", "Danh sách thông tin mở thầu"),
            ("ds_goi_thau_lk", "goi_thau_ids", "Danh sách ID gói thầu liên kết")
        ]

        default_seeds = []
        
        # Gieo biến đơn lẻ
        for table, cols in default_seeds_data.items():
            for col_name, var_name, desc in cols:
                default_seeds.append((var_name, table, col_name, desc))
        
        # Gieo vòng lặp
        for var_name, table, desc in default_loops:
            default_seeds.append((var_name, table, "", desc))
        
        seeded_any = False
        for ten_bien, src_table, src_column, mo_ta in default_seeds:
            key = (src_table, src_column)
            if key not in existing_keys and ten_bien.lower() not in existing_vars:
                mapping_id = "wmp-" + str(uuid.uuid4())[:8]
                cursor.execute("""
                    INSERT INTO cau_hinh_bien_word (id, ten_bien, source_table, source_column, mo_ta, owner_id)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (mapping_id, ten_bien, src_table, src_column, mo_ta, org_name))
                seeded_any = True
                
        if seeded_any:
            conn.commit()

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
            
        id_param = data.get('id')

        conn = database.get_connection()
        cursor = conn.cursor()
        
        # Check if record for this (source_table, source_column) already exists
        cursor.execute("SELECT id FROM cau_hinh_bien_word WHERE source_table = ? AND source_column = ? AND owner_id = ?", (source_table, source_column, org_name))
        row_by_data = cursor.fetchone()
        
        # Check if record for this ten_bien already exists
        cursor.execute("SELECT id FROM cau_hinh_bien_word WHERE ten_bien = ? AND owner_id = ?", (ten_bien, org_name))
        row_by_name = cursor.fetchone()
        if id_param:
            # We are updating a specific record
            # To avoid duplicates, delete any OTHER record that matches the target (source_table, source_column) or ten_bien
            if row_by_data and row_by_data[0] != id_param:
                cursor.execute("DELETE FROM cau_hinh_bien_word WHERE id = ?", (row_by_data[0],))
            if row_by_name and row_by_name[0] != id_param:
                cursor.execute("DELETE FROM cau_hinh_bien_word WHERE id = ?", (row_by_name[0],))
                
            cursor.execute("""
                UPDATE cau_hinh_bien_word 
                SET ten_bien = ?, source_table = ?, source_column = ?, mo_ta = ?
                WHERE id = ? AND owner_id = ?
            """, (ten_bien, source_table, source_column, mo_ta, id_param, org_name))
            mapping_id = id_param
        else:
            # We are creating a new record
            if row_by_data:
                # Overwrite by updating its ten_bien and mo_ta
                mapping_id = row_by_data[0]
                cursor.execute("""
                    UPDATE cau_hinh_bien_word 
                    SET ten_bien = ?, mo_ta = ?
                    WHERE id = ?
                """, (ten_bien, mo_ta, mapping_id))
            elif row_by_name:
                # Overwrite by updating its source_table and source_column
                mapping_id = row_by_name[0]
                cursor.execute("""
                    UPDATE cau_hinh_bien_word 
                    SET source_table = ?, source_column = ?, mo_ta = ?
                    WHERE id = ?
                """, (source_table, source_column, mo_ta, mapping_id))
            else:
                # Insert new
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
