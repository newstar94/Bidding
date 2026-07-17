import os
import re
import shutil
import sqlite3
from io import BytesIO
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
from backend.shared.access_policy import can_manage_word_config, can_read_record
from backend.shared.logging_utils import error_response, log_and_error
from backend.shared.request_validation import validate_or_response
from backend.shared.async_io import run_blocking_io
from backend.documents import custom_exporter
from backend.documents.document_worker import (
    DocumentWorkerError,
    DocumentWorkerInputError,
    run_document_job,
    run_document_job_async,
)
from backend.documents.upload_spooling import spooled_upload
import backend.documents.docx_service as docx_service
from backend.documents.docx_bid_context_service import (
    enrich_context_with_filtered_bidders,
    enrich_context_with_lot_summaries,
)
from backend.documents.docx_formula_service import _format_formula_date, apply_computed_mappings
from backend.documents.docx_mapping_service import apply_custom_mappings, lowercase_partner_identity_codes
from backend.documents.word_defaults import ensure_default_word_mappings
from backend.documents.timeline_context_service import build_timeline_context
import uuid

SYSTEM_TEMPLATES = {
    'mau_bao_cao_dau_thau.docx',
    'mau_hop_dong_lcnt.docx',
    'mau_timeline_goi_thau.docx',
}
MAX_TEMPLATE_UPLOAD_BYTES = 10 * 1024 * 1024
COMPUTED_SOURCE_TABLE = '__computed__'


def _docx_error(request, exception, context):
    if isinstance(exception, OrgPermissionError):
        return error_response(
            request,
            "ORG_ACCESS_DENIED",
            "Không có quyền truy cập tổ chức này.",
            status_code=403,
        )
    if isinstance(exception, FileNotFoundError):
        return error_response(
            request,
            "DOCX_TEMPLATE_NOT_FOUND",
            "Không tìm thấy mẫu Word.",
            status_code=404,
        )
    if isinstance(exception, DocumentWorkerInputError):
        return error_response(
            request,
            "DOCX_INPUT_INVALID",
            "Tệp hoặc mẫu Word không hợp lệ.",
            status_code=422,
        )
    if isinstance(exception, ValueError):
        return error_response(
            request,
            "DOCX_INPUT_INVALID",
            "Tệp hoặc dữ liệu Word không hợp lệ.",
            status_code=400,
        )
    if isinstance(exception, DocumentWorkerError):
        return log_and_error(
            request,
            exception,
            context,
            "DOCUMENT_WORKER_UNAVAILABLE",
            "Dịch vụ xử lý tài liệu tạm thời không khả dụng.",
            status_code=503,
        )
    return log_and_error(
        request,
        exception,
        context,
        "DOCX_OPERATION_FAILED",
        "Không thể xử lý yêu cầu Word.",
    )


def _current_sync_version(organization_id):
    conn = database.get_connection()
    try:
        row = conn.execute(
            "SELECT current_version FROM sync_metadata WHERE organization_id = ?",
            (organization_id,),
        ).fetchone()
        if row is None:
            raise ValueError("Không tìm thấy phiên bản đồng bộ của tổ chức.")
        return int(row[0])
    finally:
        conn.close()


def _validate_export_snapshot(request, organization_id):
    raw_version = request.query_params.get('snapshotVersion')
    if raw_version is None or raw_version == '':
        return None, JSONResponse(
            {
                "error": "Thiếu phiên bản dữ liệu để xuất tệp.",
                "code": "EXPORT_SNAPSHOT_REQUIRED",
            },
            status_code=428,
        )
    try:
        expected_version = int(raw_version)
        if expected_version < 0 or str(expected_version) != str(raw_version).strip():
            raise ValueError
    except (TypeError, ValueError):
        return None, JSONResponse(
            {
                "error": "Phiên bản dữ liệu không hợp lệ.",
                "code": "EXPORT_SNAPSHOT_INVALID",
            },
            status_code=400,
        )

    current_version = _current_sync_version(organization_id)
    if current_version != expected_version:
        return None, JSONResponse(
            {
                "error": "Dữ liệu đã thay đổi. Vui lòng đồng bộ lại trước khi xuất tệp.",
                "code": "EXPORT_SNAPSHOT_STALE",
                "currentSyncVersion": current_version,
            },
            status_code=409,
        )
    return expected_version, None


def _ensure_export_snapshot_unchanged(organization_id, expected_version):
    current_version = _current_sync_version(organization_id)
    if current_version == expected_version:
        return None
    return JSONResponse(
        {
            "error": "Dữ liệu đã thay đổi trong khi tạo tệp. Vui lòng thử lại.",
            "code": "EXPORT_SNAPSHOT_CHANGED",
            "currentSyncVersion": current_version,
        },
        status_code=409,
    )


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


def _persist_user_template(user_id, filename, content):
    user_dir = os.path.realpath(custom_exporter.get_user_template_dir(user_id))
    dest_path = os.path.realpath(os.path.join(user_dir, filename))
    if not dest_path.startswith(user_dir + os.sep):
        raise ValueError("Tên tệp không hợp lệ")
    with open(dest_path, "wb") as template_file:
        template_file.write(content)
    custom_exporter.set_active_template(filename, user_id)


def _persist_user_template_from_path(user_id, filename, source_path):
    user_dir = os.path.realpath(custom_exporter.get_user_template_dir(user_id))
    dest_path = os.path.realpath(os.path.join(user_dir, filename))
    if not dest_path.startswith(user_dir + os.sep):
        raise ValueError("Tên tệp không hợp lệ")
    shutil.copyfile(source_path, dest_path)
    custom_exporter.set_active_template(filename, user_id)


def _validate_docx_upload(filename, content, *, deep_validation=True, total_size=None):
    safe_name = _safe_filename(filename, f"template_{uuid.uuid4().hex[:8]}.docx")
    root, ext = os.path.splitext(safe_name)
    if ext.lower() != '.docx':
        raise ValueError('Chỉ cho phép tải lên tệp .docx')
    if not content:
        raise ValueError('Tệp tải lên đang trống')
    if (total_size if total_size is not None else len(content)) > MAX_TEMPLATE_UPLOAD_BYTES:
        raise ValueError('Tệp mẫu vượt quá giới hạn 10MB')
    if deep_validation:
        run_document_job("validate_docx", {"content": content}, timeout_seconds=15)
    return _safe_filename(f"{root[:80]}_{uuid.uuid4().hex[:8]}.docx")


async def export_plan_api(request):
    plan_id = clean_id(request.path_params.get('plan_id'))
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        org_name = get_active_org(request, user_id)
        snapshot_version, snapshot_error = _validate_export_snapshot(request, org_name)
        if snapshot_error is not None:
            return snapshot_error
        if not _can_export_record(role_or_err, org_name, "kehoach", "ke_hoach_lcnt", plan_id):
            return JSONResponse({"error": "Ban khong co quyen xuat ke hoach nay."}, status_code=403)


        unified_context = docx_service.build_plan_context(plan_id, user_id, org_name)
        enrich_context_with_lot_summaries(unified_context)
        enrich_context_with_filtered_bidders(unified_context)


        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT ten_bien, source_table, source_column FROM cau_hinh_bien_word WHERE organization_id = ?", (org_name,))
        mappings_rows = cursor.fetchall()
        conn.close()

        apply_custom_mappings(unified_context, mappings_rows)
        apply_computed_mappings(unified_context, mappings_rows)
        lowercase_partner_identity_codes(unified_context, mappings_rows)
        custom_vars_list = [row[0].lower() for row in mappings_rows]

        active_tpl = custom_exporter.get_active_template(user_id)
        tpl_path, active_tpl = _resolve_template_path(user_id, active_tpl)

        docx_bytes = await run_document_job_async(
            "render_docx",
            {
                "template_path": tpl_path,
                "context": unified_context,
                "custom_vars": custom_vars_list,
            },
        )
        docx_stream = BytesIO(docx_bytes)

        snapshot_error = _ensure_export_snapshot_unchanged(org_name, snapshot_version)
        if snapshot_error is not None:
            return snapshot_error

        filename = f"Ke_hoach_LCNT_{unified_context['ke_hoach']['ma_ke_hoach']}.docx"
        return StreamingResponse(
            docx_stream,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": _content_disposition(filename)}
        )
    except OrgPermissionError as e:
        return _docx_error(request, e, "export_plan_api")
    except DocumentWorkerInputError as e:
        return _docx_error(request, e, "export_plan_api")
    except DocumentWorkerError as e:
        return _docx_error(request, e, "export_plan_api")
    except Exception as e:
        return _docx_error(request, e, "export_plan_api")

async def export_report_api(request):
    package_id = clean_id(request.path_params.get('package_id'))
    type_param = request.query_params.get('type', 'evaluation')
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        org_name = get_active_org(request, user_id)
        snapshot_version, snapshot_error = _validate_export_snapshot(request, org_name)
        if snapshot_error is not None:
            return snapshot_error
        if not _can_export_record(role_or_err, org_name, "goithau", "goi_thau", package_id):
            return JSONResponse({"error": "Ban khong co quyen xuat goi thau nay."}, status_code=403)


        unified_context = docx_service.build_report_context(package_id, user_id, org_name, type_param)
        enrich_context_with_lot_summaries(unified_context)
        enrich_context_with_filtered_bidders(unified_context)


        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT ten_bien, source_table, source_column FROM cau_hinh_bien_word WHERE organization_id = ?", (org_name,))
        mappings_rows = cursor.fetchall()
        conn.close()

        apply_custom_mappings(unified_context, mappings_rows)
        apply_computed_mappings(unified_context, mappings_rows)
        lowercase_partner_identity_codes(unified_context, mappings_rows)
        custom_vars_list = [row[0].lower() for row in mappings_rows]

        active_tpl = custom_exporter.get_active_template(user_id)
        if type_param in ('contract', 'liquidation'):
            if active_tpl != 'mau_hop_dong_lcnt.docx':
                active_tpl = 'mau_hop_dong_lcnt.docx'

        tpl_path, active_tpl = _resolve_template_path(user_id, active_tpl)

        docx_bytes = await run_document_job_async(
            "render_docx",
            {
                "template_path": tpl_path,
                "context": unified_context,
                "custom_vars": custom_vars_list,
            },
        )
        docx_stream = BytesIO(docx_bytes)

        snapshot_error = _ensure_export_snapshot_unchanged(org_name, snapshot_version)
        if snapshot_error is not None:
            return snapshot_error

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
        return _docx_error(request, e, "export_report_api")
    except DocumentWorkerInputError as e:
        return _docx_error(request, e, "export_report_api")
    except DocumentWorkerError as e:
        return _docx_error(request, e, "export_report_api")
    except Exception as e:
        return _docx_error(request, e, "export_report_api")


async def export_timeline_api(request):
    package_id = clean_id(request.path_params.get('package_id'))
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        org_name = get_active_org(request, user_id)
        snapshot_version, snapshot_error = _validate_export_snapshot(request, org_name)
        if snapshot_error is not None:
            return snapshot_error
        if not _can_export_record(role_or_err, org_name, "goithau", "goi_thau", package_id):
            return JSONResponse({"error": "Bạn không có quyền xuất timeline gói thầu này."}, status_code=403)

        context = await run_blocking_io(
            build_timeline_context,
            package_id,
            user_id,
            org_name,
            timeout_seconds=10,
        )
        template_path, _template_name = _resolve_template_path(
            user_id,
            'mau_timeline_goi_thau.docx',
        )
        docx_bytes = await run_document_job_async(
            "render_timeline_docx",
            {"template_path": template_path, "context": context},
        )
        snapshot_error = _ensure_export_snapshot_unchanged(org_name, snapshot_version)
        if snapshot_error is not None:
            return snapshot_error

        package_code = context.get("goi_thau", {}).get("ma_goi_thau") or "LCNT"
        filename = f"Timeline_goi_thau_{package_code}.docx"
        return StreamingResponse(
            BytesIO(docx_bytes),
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": _content_disposition(filename)},
        )
    except (OrgPermissionError, DocumentWorkerInputError, DocumentWorkerError, ValueError) as e:
        return _docx_error(request, e, "export_timeline_api")
    except Exception as e:
        return _docx_error(request, e, "export_timeline_api")

async def list_templates_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id

        templates = await run_blocking_io(
            custom_exporter.list_templates,
            user_id,
            timeout_seconds=5,
        )
        return JSONResponse(templates)
    except Exception as e:
        return _docx_error(request, e, "list_templates_api")

async def set_active_template_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id

        data = await request.json()
        invalid = validate_or_response(request, data, {
            "template_name": {"type": "string", "max_length": 255},
            "filename": {"type": "string", "max_length": 255},
        })
        if invalid:
            return invalid
        template_name = data.get('template_name') or data.get('filename')
        if not template_name:
            return JSONResponse({"error": "Missing template_name parameter"}, status_code=400)

        _, safe_name = await run_blocking_io(
            _resolve_template_path,
            user_id,
            template_name,
            timeout_seconds=5,
        )
        await run_blocking_io(
            custom_exporter.set_active_template,
            safe_name,
            user_id,
            timeout_seconds=5,
        )
        return JSONResponse({"success": True})
    except FileNotFoundError as e:
        return _docx_error(request, e, "set_active_template_api")
    except ValueError as e:
        return _docx_error(request, e, "set_active_template_api")
    except Exception as e:
        return _docx_error(request, e, "set_active_template_api")

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

        async with spooled_upload(file_obj, max_bytes=MAX_TEMPLATE_UPLOAD_BYTES, suffix=".docx") as (upload_path, upload_size, head):
            try:
                filename = _validate_docx_upload(
                    file_obj.filename, head, deep_validation=False, total_size=upload_size,
                )
                await run_document_job_async(
                    "validate_docx", {"content_path": str(upload_path)}, timeout_seconds=15,
                )
            except ValueError as e:
                return _docx_error(request, e, "upload_template_api")

            await run_blocking_io(
                _persist_user_template_from_path, user_id, filename, str(upload_path), timeout_seconds=10,
            )
        return JSONResponse({"success": True, "filename": filename})
    except DocumentWorkerError as e:
        return _docx_error(request, e, "upload_template_api")
    except Exception as e:
        return _docx_error(request, e, "upload_template_api")

async def list_word_mappings_api(request):
    conn = None
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        org_name = get_active_org(request, user_id)
        conn = database.get_connection()
        cursor = conn.cursor()
        if not can_manage_word_config(cursor, str(role_or_err), user_id, org_name):
            return JSONResponse({"error": "Ban khong co quyen quan ly cau hinh Word."}, status_code=403)

        ensure_default_word_mappings(cursor, org_name)
        conn.commit()

        cursor.execute("SELECT id, ten_bien, source_table, source_column, mo_ta FROM cau_hinh_bien_word WHERE organization_id = ?", (org_name,))
        rows = cursor.fetchall()
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
        return _docx_error(request, e, "list_word_mappings_api")
    except Exception as e:
        return _docx_error(request, e, "list_word_mappings_api")
    finally:
        if conn:
            try:
                if conn.in_transaction:
                    conn.rollback()
                conn.close()
            except sqlite3.Error:
                pass

async def save_word_mapping_api(request):
    conn = None
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        org_name = get_active_org(request, user_id)

        data = await request.json()
        invalid = validate_or_response(request, data, {
            "id": {"type": "string", "max_length": 128},
            "ten_bien": {"type": "string", "max_length": 128},
            "tenBien": {"type": "string", "max_length": 128},
            "source_table": {"type": "string", "max_length": 128},
            "sourceTable": {"type": "string", "max_length": 128},
            "source_column": {"type": "string", "max_length": 512},
            "sourceColumn": {"type": "string", "max_length": 512},
            "mapping_type": {"type": "string", "max_length": 32},
            "mappingType": {"type": "string", "max_length": 32},
            "formula": {"type": "string", "max_length": 5_000},
            "mo_ta": {"type": "string", "max_length": 2_000},
            "moTa": {"type": "string", "max_length": 2_000},
        })
        if invalid:
            return invalid
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
        if not can_manage_word_config(cursor, str(role_or_err), user_id, org_name):
            return JSONResponse({"error": "Ban khong co quyen quan ly cau hinh Word."}, status_code=403)



        row_by_data = None
        if source_table != COMPUTED_SOURCE_TABLE:
            cursor.execute("SELECT id FROM cau_hinh_bien_word WHERE source_table = ? AND source_column = ? AND organization_id = ?", (source_table, source_column, org_name))
            row_by_data = cursor.fetchone()


        cursor.execute("SELECT id FROM cau_hinh_bien_word WHERE ten_bien = ? AND organization_id = ?", (ten_bien, org_name))
        row_by_name = cursor.fetchone()
        if id_param:


            if row_by_data and row_by_data[0] != id_param:
                cursor.execute("DELETE FROM cau_hinh_bien_word WHERE id = ?", (row_by_data[0],))
            if row_by_name and row_by_name[0] != id_param:
                cursor.execute("DELETE FROM cau_hinh_bien_word WHERE id = ?", (row_by_name[0],))

            cursor.execute("""
                UPDATE cau_hinh_bien_word
                SET ten_bien = ?, source_table = ?, source_column = ?, mo_ta = ?
                WHERE id = ? AND organization_id = ?
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
                    INSERT INTO cau_hinh_bien_word (id, ten_bien, source_table, source_column, mo_ta, organization_id)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (mapping_id, ten_bien, source_table, source_column, mo_ta, org_name))

        conn.commit()
        return JSONResponse({"success": True, "id": mapping_id})
    except OrgPermissionError as e:
        return _docx_error(request, e, "save_word_mapping_api")
    except Exception as e:
        return _docx_error(request, e, "save_word_mapping_api")
    finally:
        if conn:
            try:
                if conn.in_transaction:
                    conn.rollback()
                conn.close()
            except sqlite3.Error:
                pass

async def delete_word_mapping_api(request):
    conn = None
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
        if not can_manage_word_config(cursor, str(role_or_err), user_id, org_name):
            return JSONResponse({"error": "Ban khong co quyen quan ly cau hinh Word."}, status_code=403)
        cursor.execute("DELETE FROM cau_hinh_bien_word WHERE id = ? AND organization_id = ?", (mapping_id, org_name))
        conn.commit()
        return JSONResponse({"success": True})
    except OrgPermissionError as e:
        return _docx_error(request, e, "delete_word_mapping_api")
    except Exception as e:
        return _docx_error(request, e, "delete_word_mapping_api")
    finally:
        if conn:
            try:
                if conn.in_transaction:
                    conn.rollback()
                conn.close()
            except sqlite3.Error:
                pass
