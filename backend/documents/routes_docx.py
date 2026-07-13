import os
import re
import zipfile
from urllib.parse import quote
from starlette.responses import StreamingResponse, JSONResponse

from backend.shared.helpers import (
    database,
    verify_session,
    clean_id,
    get_active_org,
    OrgPermissionError
)
from backend.db.id_utils import generate_record_id
from backend.shared.access_policy import can_read_record, is_manager_role
from backend.documents import custom_exporter
import backend.documents.docx_service as docx_service
from backend.documents.docx_bid_context_service import (
    enrich_context_with_filtered_bidders,
    enrich_context_with_lot_summaries,
)
from backend.documents.docx_formula_service import _format_formula_date, apply_computed_mappings
from backend.documents.docx_mapping_service import apply_custom_mappings
from backend.documents.word_defaults import ensure_default_word_mappings
import uuid

SYSTEM_TEMPLATES = {'mau_bao_cao_dau_thau.docx', 'mau_hop_dong_lcnt.docx'}
MAX_TEMPLATE_UPLOAD_BYTES = 10 * 1024 * 1024
COMPUTED_SOURCE_TABLE = '__computed__'


def _can_export_record(role_or_err, org_name, payload_key, table_name, record_id):
    conn = database.get_connection()
    try:
        cursor = conn.cursor()
        return can_read_record(
            cursor,
            str(role_or_err),
            role_or_err.user_id,
            org_name,
            payload_key,
            table_name,
            record_id,
        )
    finally:
        conn.close()

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


async def export_plan_api(request):
    plan_id = clean_id(request.path_params.get('plan_id'))
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        org_name = get_active_org(request, user_id)
        if not _can_export_record(role_or_err, org_name, "kehoach", "ke_hoach_lcnt", plan_id):
            return JSONResponse({"error": "Ban khong co quyen xuat ke hoach nay."}, status_code=403)


        unified_context = docx_service.build_plan_context(plan_id, user_id, org_name)
        enrich_context_with_lot_summaries(unified_context)
        enrich_context_with_filtered_bidders(unified_context)


        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT ten_bien, source_table, source_column FROM cau_hinh_bien_word WHERE owner_id = ?", (org_name,))
        mappings_rows = cursor.fetchall()
        conn.close()

        apply_custom_mappings(unified_context, mappings_rows)
        apply_computed_mappings(unified_context, mappings_rows)
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
        if not _can_export_record(role_or_err, org_name, "goithau", "goi_thau", package_id):
            return JSONResponse({"error": "Ban khong co quyen xuat goi thau nay."}, status_code=403)


        unified_context = docx_service.build_report_context(package_id, user_id, org_name, type_param)
        enrich_context_with_lot_summaries(unified_context)
        enrich_context_with_filtered_bidders(unified_context)


        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT ten_bien, source_table, source_column FROM cau_hinh_bien_word WHERE owner_id = ?", (org_name,))
        mappings_rows = cursor.fetchall()
        conn.close()

        apply_custom_mappings(unified_context, mappings_rows)
        apply_computed_mappings(unified_context, mappings_rows)
        custom_vars_list = [row[0].lower() for row in mappings_rows]

        active_tpl = custom_exporter.get_active_template(user_id)
        if type_param in ('contract', 'liquidation'):
            if active_tpl != 'mau_hop_dong_lcnt.docx':
                active_tpl = 'mau_hop_dong_lcnt.docx'

        tpl_path, active_tpl = _resolve_template_path(user_id, active_tpl)

        docx_stream = custom_exporter.generate_report_from_custom_template(tpl_path, unified_context, custom_vars_list)

        if type_param in ('contract', 'liquidation'):
            prefix = "Thanh_ly_hop_dong" if type_param == 'liquidation' else "Hop_dong"
            filename = f"{prefix}_{unified_context['hop_dong'].get('so_hop_dong', 'LCNT')}.docx"
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
        if not is_manager_role(str(role_or_err)):
            return JSONResponse({"error": "Ban khong co quyen quan ly cau hinh Word."}, status_code=403)
        user_id = role_or_err.user_id
        org_name = get_active_org(request, user_id)
        conn = database.get_connection()
        cursor = conn.cursor()

        ensure_default_word_mappings(cursor, org_name)
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
            r['mappingType'] = 'computed' if r.get('source_table') == COMPUTED_SOURCE_TABLE else 'mapping'
            r['formula'] = r.get('source_column') if r.get('source_table') == COMPUTED_SOURCE_TABLE else ''
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
        if not is_manager_role(str(role_or_err)):
            return JSONResponse({"error": "Ban khong co quyen quan ly cau hinh Word."}, status_code=403)
        user_id = role_or_err.user_id
        org_name = get_active_org(request, user_id)

        data = await request.json()
        ten_bien = (data.get('ten_bien') or data.get('tenBien') or '').strip().lower()
        source_table = (data.get('source_table') or data.get('sourceTable') or '').strip()
        source_column = (data.get('source_column') or data.get('sourceColumn') or '').strip()
        mapping_type = (data.get('mapping_type') or data.get('mappingType') or '').strip()
        formula = (data.get('formula') or '').strip()
        mo_ta = (data.get('mo_ta') or data.get('moTa') or '').strip()
        if mapping_type == 'computed':
            source_table = COMPUTED_SOURCE_TABLE
            source_column = formula

        if not source_column:
            source_column = ""

        if not ten_bien or not source_table:
            return JSONResponse({"error": "Vui lòng nhập đầy đủ thông tin!"}, status_code=400)

        if source_table == COMPUTED_SOURCE_TABLE and not source_column:
            return JSONResponse({"error": "Vui lòng nhập công thức cho biến kết quả!"}, status_code=400)

        id_param = data.get('id')

        conn = database.get_connection()
        cursor = conn.cursor()



        row_by_data = None
        if source_table != COMPUTED_SOURCE_TABLE:
            cursor.execute("SELECT id FROM cau_hinh_bien_word WHERE source_table = ? AND source_column = ? AND owner_id = ?", (source_table, source_column, org_name))
            row_by_data = cursor.fetchone()


        cursor.execute("SELECT id FROM cau_hinh_bien_word WHERE ten_bien = ? AND owner_id = ?", (ten_bien, org_name))
        row_by_name = cursor.fetchone()
        if id_param:


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

            if row_by_data:

                mapping_id = row_by_data[0]
                cursor.execute("""
                    UPDATE cau_hinh_bien_word
                    SET ten_bien = ?, mo_ta = ?
                    WHERE id = ?
                """, (ten_bien, mo_ta, mapping_id))
            elif row_by_name:

                mapping_id = row_by_name[0]
                cursor.execute("""
                    UPDATE cau_hinh_bien_word
                    SET source_table = ?, source_column = ?, mo_ta = ?
                    WHERE id = ?
                """, (source_table, source_column, mo_ta, mapping_id))
            else:

                mapping_id = generate_record_id("cau_hinh_bien_word")
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
        if not is_manager_role(str(role_or_err)):
            return JSONResponse({"error": "Ban khong co quyen quan ly cau hinh Word."}, status_code=403)
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
