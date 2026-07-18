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
    OrgPermissionError,
    log_audit,
)
from backend.db.id_utils import generate_record_id
from backend.shared.access_policy import (
    can_manage_word_config,
    can_read_record,
    resolve_document_export_capabilities,
)
from backend.shared.subscription_policy import can_use_word_export
from backend.shared.logging_utils import error_response, log_and_error
from backend.shared.request_validation import read_json_object, validate_or_response
from backend.shared.async_io import (
    BlockingIOBusyError,
    BlockingIOTimeoutError,
    run_blocking_io,
)
from backend.shared.database_io import run_database_read
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
from backend.documents.docx_context_policy import (
    REPORT_DOCUMENT_TYPES,
    filter_mapping_rows,
    seal_docx_context,
    sensitive_capability_groups_present,
    validate_mapping_definition,
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
        return (
            can_use_word_export(
                cursor, str(role_or_err), role_or_err.user_id, org_name
            )
            and can_read_record(
                cursor,
                str(role_or_err),
                role_or_err.user_id,
                org_name,
                payload_key,
                table_name,
                record_id,
            )
        )
    finally:
        conn.close()


def _word_export_subscription_response(role_or_err, organization_id):
    conn = database.get_connection()
    try:
        enabled = can_use_word_export(
            conn.cursor(), str(role_or_err), role_or_err.user_id, organization_id
        )
    finally:
        conn.close()
    if enabled:
        return None
    return JSONResponse(
        {
            "error": "Phạm vi đang làm việc chưa có gói trả phí hoạt động để xuất Word.",
            "code": "WORD_EXPORT_SUBSCRIPTION_REQUIRED",
        },
        status_code=403,
    )


def _word_config_access_response(request, role_or_err):
    organization_id = get_active_org(request, role_or_err.user_id)
    conn = database.get_connection()
    try:
        allowed = can_manage_word_config(
            conn.cursor(), str(role_or_err), role_or_err.user_id, organization_id
        )
    finally:
        conn.close()
    if allowed:
        return None
    return JSONResponse(
        {
            "error": "Bạn chưa có quyền hoặc gói trả phí để quản lý biểu mẫu Word.",
            "code": "WORD_CONFIG_ACCESS_REQUIRED",
        },
        status_code=403,
    )

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


def _database_read_unavailable_response(request, *, timed_out=False):
    response = error_response(
        request,
        "DATABASE_READ_TIMEOUT" if timed_out else "DATABASE_READ_QUEUE_FULL",
        "Dữ liệu xuất Word tạm thời chưa sẵn sàng. Vui lòng thử lại sau.",
        status_code=503,
    )
    response.headers["Retry-After"] = "1"
    return response


def _load_word_export_policy(
    role_str,
    user_id,
    organization_id,
    document_type,
):
    conn = database.get_connection()
    try:
        capabilities = resolve_document_export_capabilities(
            conn.cursor(),
            role_str,
            user_id,
            organization_id,
        )
        rows = conn.execute(
            """SELECT ten_bien, source_table, source_column
               FROM cau_hinh_bien_word
               WHERE organization_id = ?""",
            (organization_id,),
        ).fetchall()
        return capabilities, filter_mapping_rows(
            rows, document_type, capabilities
        )
    finally:
        conn.close()


def _prepare_plan_render(plan_id, user_id, organization_id, role_str):
    capabilities, mappings = _load_word_export_policy(
        role_str, user_id, organization_id, "plan"
    )
    context = docx_service.build_plan_context(
        plan_id, user_id, organization_id, capabilities
    )
    enrich_context_with_lot_summaries(context)
    enrich_context_with_filtered_bidders(context)
    apply_custom_mappings(context, mappings)
    apply_computed_mappings(context, mappings)
    lowercase_partner_identity_codes(context, mappings)
    context, manifest = seal_docx_context(
        "plan", context, mappings, capabilities
    )
    sensitive_groups = sorted(sensitive_capability_groups_present(context))
    active_template = custom_exporter.get_active_template(user_id)
    template_path, _ = _resolve_template_path(
        user_id, active_template
    )
    return context, manifest, mappings, template_path, sensitive_groups


def _prepare_report_render(
    package_id,
    user_id,
    organization_id,
    role_str,
    document_type,
):
    capabilities, mappings = _load_word_export_policy(
        role_str, user_id, organization_id, document_type
    )
    context = docx_service.build_report_context(
        package_id,
        user_id,
        organization_id,
        document_type,
        capabilities,
    )
    enrich_context_with_lot_summaries(context)
    enrich_context_with_filtered_bidders(context)
    apply_custom_mappings(context, mappings)
    apply_computed_mappings(context, mappings)
    lowercase_partner_identity_codes(context, mappings)
    context, manifest = seal_docx_context(
        document_type, context, mappings, capabilities
    )
    sensitive_groups = sorted(sensitive_capability_groups_present(context))
    active_template = custom_exporter.get_active_template(user_id)
    if document_type in {"contract", "liquidation"}:
        active_template = "mau_hop_dong_lcnt.docx"
    template_path, _ = _resolve_template_path(
        user_id, active_template
    )
    return context, manifest, mappings, template_path, sensitive_groups


async def export_plan_api(request):
    plan_id = clean_id(request.path_params.get('plan_id'))
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        org_name = get_active_org(request, user_id)
        entitlement_error = _word_export_subscription_response(role_or_err, org_name)
        if entitlement_error is not None:
            return entitlement_error
        snapshot_version, snapshot_error = _validate_export_snapshot(request, org_name)
        if snapshot_error is not None:
            return snapshot_error
        if not _can_export_record(role_or_err, org_name, "kehoach", "ke_hoach_lcnt", plan_id):
            return JSONResponse({"error": "Ban khong co quyen xuat ke hoach nay."}, status_code=403)
        try:
            (
                unified_context,
                context_manifest,
                mappings_rows,
                tpl_path,
                sensitive_groups,
            ) = await run_database_read(
                _prepare_plan_render,
                plan_id,
                user_id,
                org_name,
                str(role_or_err),
                timeout_seconds=30,
            )
        except BlockingIOBusyError:
            return _database_read_unavailable_response(request)
        except BlockingIOTimeoutError:
            return _database_read_unavailable_response(request, timed_out=True)

        custom_vars_list = [row[0].lower() for row in mappings_rows]

        docx_bytes = await run_document_job_async(
            "render_docx",
            {
                "template_path": tpl_path,
                "context": unified_context,
                "custom_vars": custom_vars_list,
                "context_manifest": context_manifest,
            },
        )
        docx_stream = BytesIO(docx_bytes)

        snapshot_error = _ensure_export_snapshot_unchanged(org_name, snapshot_version)
        if snapshot_error is not None:
            return snapshot_error

        log_audit(
            "document.word_exported",
            actor_user_id=user_id,
            organization_id=org_name,
            target_type="ke_hoach_lcnt",
            target_id=plan_id,
            request=request,
            metadata={
                "organization_id": org_name,
                "document_type": "plan",
                "sensitive_capabilities_used": sensitive_groups,
            },
            required=True,
        )

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
        entitlement_error = _word_export_subscription_response(role_or_err, org_name)
        if entitlement_error is not None:
            return entitlement_error
        if type_param not in REPORT_DOCUMENT_TYPES:
            return JSONResponse(
                {
                    "error": "Loai bao cao Word khong duoc ho tro.",
                    "code": "DOCX_TYPE_INVALID",
                },
                status_code=400,
            )
        snapshot_version, snapshot_error = _validate_export_snapshot(request, org_name)
        if snapshot_error is not None:
            return snapshot_error
        if not _can_export_record(role_or_err, org_name, "goithau", "goi_thau", package_id):
            return JSONResponse({"error": "Ban khong co quyen xuat goi thau nay."}, status_code=403)
        try:
            (
                unified_context,
                context_manifest,
                mappings_rows,
                tpl_path,
                sensitive_groups,
            ) = await run_database_read(
                _prepare_report_render,
                package_id,
                user_id,
                org_name,
                str(role_or_err),
                type_param,
                timeout_seconds=30,
            )
        except BlockingIOBusyError:
            return _database_read_unavailable_response(request)
        except BlockingIOTimeoutError:
            return _database_read_unavailable_response(request, timed_out=True)

        custom_vars_list = [row[0].lower() for row in mappings_rows]

        docx_bytes = await run_document_job_async(
            "render_docx",
            {
                "template_path": tpl_path,
                "context": unified_context,
                "custom_vars": custom_vars_list,
                "context_manifest": context_manifest,
            },
        )
        docx_stream = BytesIO(docx_bytes)

        snapshot_error = _ensure_export_snapshot_unchanged(org_name, snapshot_version)
        if snapshot_error is not None:
            return snapshot_error

        log_audit(
            "document.word_exported",
            actor_user_id=user_id,
            organization_id=org_name,
            target_type="goi_thau",
            target_id=package_id,
            request=request,
            metadata={
                "organization_id": org_name,
                "document_type": type_param,
                "sensitive_capabilities_used": sensitive_groups,
            },
            required=True,
        )

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
        entitlement_error = _word_export_subscription_response(role_or_err, org_name)
        if entitlement_error is not None:
            return entitlement_error
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
        context, context_manifest = seal_docx_context("timeline", context)
        template_path, _template_name = _resolve_template_path(
            user_id,
            'mau_timeline_goi_thau.docx',
        )
        docx_bytes = await run_document_job_async(
            "render_timeline_docx",
            {
                "template_path": template_path,
                "context": context,
                "context_manifest": context_manifest,
            },
        )
        snapshot_error = _ensure_export_snapshot_unchanged(org_name, snapshot_version)
        if snapshot_error is not None:
            return snapshot_error

        log_audit(
            "document.word_exported",
            actor_user_id=user_id,
            organization_id=org_name,
            target_type="goi_thau",
            target_id=package_id,
            request=request,
            metadata={
                "organization_id": org_name,
                "document_type": "timeline",
                "sensitive_capabilities_used": [],
            },
            required=True,
        )

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
        access_error = _word_config_access_response(request, role_or_err)
        if access_error is not None:
            return access_error

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
        access_error = _word_config_access_response(request, role_or_err)
        if access_error is not None:
            return access_error

        data, json_error = await read_json_object(request)
        if json_error is not None:
            return json_error
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
        access_error = _word_config_access_response(request, role_or_err)
        if access_error is not None:
            return access_error

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

        data, json_error = await read_json_object(request)
        if json_error is not None:
            return json_error
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

        try:
            validate_mapping_definition(ten_bien, source_table, source_column)
        except ValueError:
            return JSONResponse(
                {
                    "error": "Ánh xạ Word sử dụng nguồn dữ liệu không được phép.",
                    "code": "DOCX_MAPPING_FORBIDDEN",
                },
                status_code=400,
            )

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
