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
        
        # Load mappings
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT ten_bien, source_table, source_column FROM cau_hinh_bien_word WHERE owner_id = ?", (org_name,))
        mappings_rows = cursor.fetchall()
        
        row_by_table = {
            'chu_dau_tu': {'ten_chu_dau_tu': unified_context['investor_name'], 'dia_chi': unified_context['investor_address']},
            'ke_hoach_lcnt': unified_context['ke_hoach'],
            'goi_thau': {},
            'nha_thau': {},
            'hop_dong': {},
            'chuyen_gia': {},
            'thong_tin_mo_thau': {},
            'mo_thau': {},
            'tai_khoan': unified_context['user'],
            'to_chuc': unified_context['to_chuc'],
            'goi_dich_vu': unified_context['goi_dich_vu']
        }
        
        custom_vars_list = []
        custom_evaluated_values = {}
        for m_row in mappings_rows:
            ten_bien = m_row[0].lower()
            src_table = m_row[1]
            src_column = m_row[2]
            custom_vars_list.append(ten_bien)
            tbl_data = row_by_table.get(src_table, {})
            val = tbl_data.get(src_column)
            if val is None:
                val = '--'
            elif isinstance(val, (int, float)) and ('gia' in src_column or 'tong_muc' in src_column or 'gia_tri' in src_column):
                val = f'{VietnameseFloat(val)}'
            elif isinstance(val, (int, float)):
                val = str(val)
            else:
                val = str(val)
            custom_evaluated_values[ten_bien] = val
        conn.close()

        for k, v in custom_evaluated_values.items():
            unified_context[k] = v

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
        
        # Load mappings
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT ten_bien, source_table, source_column FROM cau_hinh_bien_word WHERE owner_id = ?", (org_name,))
        mappings_rows = cursor.fetchall()
        
        row_by_table = {
            'chu_dau_tu': {'ten_chu_dau_tu': unified_context['investor_name'], 'dia_chi': unified_context['investor_address']},
            'ke_hoach_lcnt': unified_context['ke_hoach'],
            'goi_thau': unified_context['goi_thau'],
            'nha_thau': unified_context['nha_thau'][0] if unified_context['nha_thau'] else {},
            'hop_dong': unified_context['hop_dong'],
            'chuyen_gia': {},
            'thong_tin_mo_thau': {},
            'mo_thau': {},
            'tai_khoan': unified_context['user'],
            'to_chuc': unified_context['to_chuc'],
            'goi_dich_vu': unified_context['goi_dich_vu']
        }
        
        custom_vars_list = []
        custom_evaluated_values = {}
        for m_row in mappings_rows:
            ten_bien = m_row[0].lower()
            src_table = m_row[1]
            src_column = m_row[2]
            custom_vars_list.append(ten_bien)
            tbl_data = row_by_table.get(src_table, {})
            val = tbl_data.get(src_column)
            if val is None:
                val = '--'
            elif isinstance(val, (int, float)) and ('gia' in src_column or 'tong_muc' in src_column or 'gia_tri' in src_column):
                val = f'{VietnameseFloat(val)}'
            elif isinstance(val, (int, float)):
                val = str(val)
            else:
                val = str(val)
            custom_evaluated_values[ten_bien] = val
        conn.close()

        for k, v in custom_evaluated_values.items():
            unified_context[k] = v

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
        
        mappings = [dict(row) for row in rows]
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
        ten_bien = data.get('ten_bien', '').strip().lower()
        source_table = data.get('source_table', '').strip()
        source_column = data.get('source_column', '').strip()
        mo_ta = data.get('mo_ta', '').strip()
        
        if not ten_bien or not source_table or not source_column:
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
