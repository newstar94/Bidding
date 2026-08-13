from io import BytesIO
import os
from starlette.responses import StreamingResponse, JSONResponse

from backend.shared.helpers import (
    database,
    verify_session,
    clean_id,
    get_active_org,
    OrgPermissionError,
    log_audit,
)
from backend.shared.access_policy import can_read_record
from backend.shared.subscription_policy import can_use_document_export
from backend.shared.logging_utils import error_response, log_and_error
from backend.shared.request_validation import read_json_object, validate_or_response
from backend.shared.database_io import run_database_read

from backend.documents import excel_service
from backend.documents.document_worker import (
    DocumentWorkerError,
    run_document_job,
    run_document_job_async,
)
from backend.documents.upload_spooling import spooled_upload
from backend.documents.routes_docx import (
    _content_disposition,
    _ensure_export_snapshot_unchanged,
    _validate_export_snapshot,
)
from backend.documents.timeline_context_service import build_timeline_context

MAX_EXCEL_UPLOAD_BYTES = 10 * 1024 * 1024


def _max_excel_import_rows():
    try:
        value = int(os.environ.get("EXCEL_MAX_IMPORT_ROWS", "10000"))
    except (TypeError, ValueError):
        value = 10000
    return min(100_000, max(100, value))


MAX_EXCEL_IMPORT_ROWS = _max_excel_import_rows()
ALLOWED_EXCEL_EXTENSIONS = {'.xlsx', '.xls'}
ALLOWED_EXCEL_MIME_TYPES = {
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/octet-stream',
}


def _excel_error(request, exception, context, *, value_status=400):
    if isinstance(exception, OrgPermissionError):
        return error_response(
            request,
            "ORG_ACCESS_DENIED",
            "Không có quyền truy cập tổ chức này.",
            status_code=403,
        )
    if isinstance(exception, ValueError):
        return error_response(
            request,
            "EXCEL_INPUT_INVALID" if value_status == 400 else "EXCEL_DATA_NOT_FOUND",
            "Tệp hoặc dữ liệu Excel không hợp lệ."
            if value_status == 400
            else "Không tìm thấy dữ liệu cần xuất.",
            status_code=value_status,
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
        "EXCEL_OPERATION_FAILED",
        "Không thể xử lý yêu cầu Excel.",
    )


def _can_export_package(role_or_err, org_name, package_id):
    conn = database.get_connection()
    try:
        cursor = conn.cursor()
        return can_read_record(
            cursor,
            role_or_err,
            role_or_err.user_id,
            org_name,
            "goithau",
            "goi_thau",
            package_id,
        )
    finally:
        conn.close()


def _timeline_export_entitlement_response(role_or_err, organization_id):
    conn = database.get_connection()
    try:
        enabled = can_use_document_export(
            conn.cursor(),
            role_or_err,
            role_or_err.user_id,
            organization_id,
            format="xlsx",
        )
    finally:
        conn.close()
    if enabled:
        return None
    return JSONResponse(
        {
            "error": "Phạm vi đang làm việc chưa có gói trả phí hoạt động để xuất Excel.",
            "code": "TIMELINE_EXPORT_SUBSCRIPTION_REQUIRED",
        },
        status_code=403,
    )


def _validate_excel_upload(file_obj, file_bytes, *, deep_validation=True, total_size=None):
    filename = os.path.basename(str(getattr(file_obj, 'filename', '') or ''))
    _, ext = os.path.splitext(filename)
    if ext.lower() not in ALLOWED_EXCEL_EXTENSIONS:
        raise ValueError('Chỉ cho phép tải lên tệp Excel .xlsx hoặc .xls')
    if not file_bytes:
        raise ValueError('Tệp Excel tải lên đang trống')
    if (total_size if total_size is not None else len(file_bytes)) > MAX_EXCEL_UPLOAD_BYTES:
        raise ValueError('Tệp Excel vượt quá giới hạn 10MB')

    content_type = (getattr(file_obj, 'content_type', '') or '').lower()
    if content_type and content_type not in ALLOWED_EXCEL_MIME_TYPES:
        raise ValueError('MIME type của tệp Excel không hợp lệ')

    is_xlsx = file_bytes.startswith(b'PK\x03\x04')
    is_xls = file_bytes.startswith(b'\xD0\xCF\x11\xE0')
    if ext.lower() == '.xlsx' and not is_xlsx:
        raise ValueError('Nội dung tệp .xlsx không hợp lệ')
    if ext.lower() == '.xls' and not is_xls:
        raise ValueError('Nội dung tệp .xls không hợp lệ')
    if ext.lower() == '.xlsx' and deep_validation:
        run_document_job(
            "validate_ooxml",
            {"content": file_bytes, "kind": "xlsx"},
            timeout_seconds=15,
        )


async def _export_excel(function_name, *args):
    result = await run_document_job_async(
        "export_excel",
        {"function": function_name, "args": list(args)},
    )
    return BytesIO(result)


async def export_timeline_api(request):
    package_id = clean_id(request.path_params.get("package_id"))
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        org_name = get_active_org(request, user_id)
        entitlement_error = _timeline_export_entitlement_response(
            role_or_err,
            org_name,
        )
        if entitlement_error is not None:
            return entitlement_error
        snapshot_version, snapshot_error = _validate_export_snapshot(
            request,
            org_name,
        )
        if snapshot_error is not None:
            return snapshot_error
        if not _can_export_package(role_or_err, org_name, package_id):
            return JSONResponse(
                {"error": "Bạn không có quyền xuất timeline gói thầu này."},
                status_code=403,
            )

        context = await run_database_read(
            build_timeline_context,
            package_id,
            user_id,
            org_name,
            timeout_seconds=10,
        )
        out_stream = await _export_excel("create_timeline_excel", context)
        snapshot_error = _ensure_export_snapshot_unchanged(
            org_name,
            snapshot_version,
        )
        if snapshot_error is not None:
            return snapshot_error

        log_audit(
            "document.excel_exported",
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
        filename = f"Timeline_goi_thau_{package_code}.xlsx"
        return StreamingResponse(
            out_stream,
            media_type=(
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            ),
            headers={"Content-Disposition": _content_disposition(filename)},
        )
    except OrgPermissionError as exception:
        return _excel_error(request, exception, "export_timeline_api")
    except ValueError as exception:
        return _excel_error(request, exception, "export_timeline_api")
    except DocumentWorkerError as exception:
        return _excel_error(request, exception, "export_timeline_api")

async def import_excel_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        form = await request.form()
        file_obj = form.get('file')
        import_type = form.get('type')

        if not file_obj or not import_type:
            return JSONResponse({"error": "Missing file or type parameter"}, status_code=400)

        _, extension = os.path.splitext(os.path.basename(file_obj.filename or ""))
        async with spooled_upload(file_obj, max_bytes=MAX_EXCEL_UPLOAD_BYTES, suffix=extension) as (upload_path, upload_size, head):
            _validate_excel_upload(file_obj, head, deep_validation=False, total_size=upload_size)
            rows = await run_document_job_async(
                "parse_excel",
                {
                    "content_path": str(upload_path),
                    "kind": extension.lower().lstrip("."),
                    "import_type": import_type,
                },
                timeout_seconds=30,
            )
        if not isinstance(rows, list):
            raise ValueError("Invalid Excel parser result")
        if len(rows) > MAX_EXCEL_IMPORT_ROWS:
            return error_response(
                request,
                "EXCEL_ROW_LIMIT_EXCEEDED",
                "Tệp Excel có quá nhiều dòng dữ liệu.",
                status_code=413,
                fields={
                    "maxRows": MAX_EXCEL_IMPORT_ROWS,
                    "receivedRows": len(rows),
                },
            )
        return JSONResponse({"success": True, "rows": rows})
    except ValueError as e:
        return _excel_error(request, e, "import_excel_api")
    except DocumentWorkerError as e:
        return _excel_error(request, e, "import_excel_api")
    except Exception as e:
        return _excel_error(request, e, "import_excel_api")

async def export_excel_template_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        import_type = request.path_params.get('import_type')
        out_stream = await _export_excel("create_excel_template", import_type)

        filename = f"mau_nhap_lieu_{import_type}.xlsx"
        return StreamingResponse(
            out_stream,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except ValueError as e:
        return _excel_error(request, e, "export_excel_template_api")
    except DocumentWorkerError as e:
        return _excel_error(request, e, "export_excel_template_api")
    except Exception as e:
        return _excel_error(request, e, "export_excel_template_api")

async def export_mothau_template_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        case_type = request.query_params.get('case_type', '1G1T_NO_LOT')
        package_name = request.query_params.get('package_name', 'GoiThau')
        lot_codes_str = request.query_params.get('lot_codes', '')
        lot_codes = [c.strip() for c in lot_codes_str.split(',') if c.strip()]

        out_stream = await _export_excel(
            "create_mothau_template", case_type, lot_codes
        )

        filename = f"Mau_nhap_HSDT_{package_name}.xlsx"
        return StreamingResponse(
            out_stream,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except DocumentWorkerError as e:
        return _excel_error(request, e, "export_mothau_template_api")
    except Exception as e:
        return _excel_error(request, e, "export_mothau_template_api")

async def export_opening_fin_template_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        org_name = get_active_org(request, role_or_err.user_id)

        package_id = request.query_params.get('package_id', '')
        package_name = request.query_params.get('package_name', 'GoiThau')

        if not package_id:
            return JSONResponse({"error": "Missing package_id parameter"}, status_code=400)

        pkg_id_clean = clean_id(package_id)
        if not pkg_id_clean:
            return JSONResponse({"error": "Invalid package_id format"}, status_code=400)
        if not _can_export_package(role_or_err, org_name, pkg_id_clean):
            return JSONResponse({"error": "Ban khong co quyen xuat du lieu goi thau nay."}, status_code=403)

        workbook_spec = await run_database_read(
            excel_service.prepare_opening_fin_template_spec,
            pkg_id_clean,
            org_name,
        )
        out_stream = await _export_excel("create_excel_from_spec", workbook_spec)

        filename = f"Mau_mo_hsdet_tai_chinh_{package_name}.xlsx"
        return StreamingResponse(
            out_stream,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except DocumentWorkerError as e:
        return _excel_error(request, e, "export_opening_fin_template_api")
    except Exception as e:
        return _excel_error(request, e, "export_opening_fin_template_api")

async def export_danhgiahsdt_template_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        org_name = get_active_org(request, role_or_err.user_id)

        package_id = request.query_params.get('package_id', '')
        package_name = request.query_params.get('package_name', 'GoiThau')
        eval_type = request.query_params.get('eval_type', 'technical')
        lot_codes = [
            value.strip()
            for value in request.query_params.get('lot_codes', '').split(',')
            if value.strip()
        ]

        if not package_id:
            return JSONResponse({"error": "Missing package_id parameter"}, status_code=400)

        pkg_id_clean = clean_id(package_id)
        if not pkg_id_clean:
            return JSONResponse({"error": "Invalid package_id format"}, status_code=400)
        if not _can_export_package(role_or_err, org_name, pkg_id_clean):
            return JSONResponse({"error": "Ban khong co quyen xuat du lieu goi thau nay."}, status_code=403)

        workbook_spec = await run_database_read(
            excel_service.prepare_danhgiahsdt_template_spec,
            pkg_id_clean,
            org_name,
            eval_type,
            lot_codes,
        )
        out_stream = await _export_excel("create_excel_from_spec", workbook_spec)

        filename = f"Mau_danh_gia_HSDT_{eval_type}_{package_name}.xlsx"
        return StreamingResponse(
            out_stream,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except ValueError as e:
        return _excel_error(request, e, "export_danhgiahsdt_template_api", value_status=404)
    except DocumentWorkerError as e:
        return _excel_error(request, e, "export_danhgiahsdt_template_api")
    except Exception as e:
        return _excel_error(request, e, "export_danhgiahsdt_template_api")

async def export_ketquaqd_template_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        org_name = get_active_org(request, role_or_err.user_id)

        package_id = request.query_params.get('package_id', '')
        package_name = request.query_params.get('package_name', 'GoiThau')

        if not package_id:
            return JSONResponse({"error": "Missing package_id parameter"}, status_code=400)

        pkg_id_clean = clean_id(package_id)
        if not pkg_id_clean:
            return JSONResponse({"error": "Invalid package_id format"}, status_code=400)
        if not _can_export_package(role_or_err, org_name, pkg_id_clean):
            return JSONResponse({"error": "Ban khong co quyen xuat du lieu goi thau nay."}, status_code=403)

        workbook_spec = await run_database_read(
            excel_service.prepare_ketquaqd_template_spec,
            pkg_id_clean,
            org_name,
        )
        out_stream = await _export_excel("create_excel_from_spec", workbook_spec)

        filename = f"Mau_ket_qua_LCNT_{package_name}.xlsx"
        return StreamingResponse(
            out_stream,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except ValueError as e:
        return _excel_error(request, e, "export_ketquaqd_template_api", value_status=404)
    except DocumentWorkerError as e:
        return _excel_error(request, e, "export_ketquaqd_template_api")
    except Exception as e:
        return _excel_error(request, e, "export_ketquaqd_template_api")

async def export_phanlo_excel_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        data, json_error = await read_json_object(request)
        if json_error:
            return json_error
        invalid = validate_or_response(request, data, {
            "phanLoList": {"type": "array", "required": True, "max_length": 10_000},
        })
        if invalid:
            return invalid
        phan_lo_list = data.get('phanLoList', [])

        out_stream = await _export_excel("create_phanlo_excel", phan_lo_list)

        filename = "Danh_sach_phan_lo.xlsx"
        return StreamingResponse(
            out_stream,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except DocumentWorkerError as e:
        return _excel_error(request, e, "export_phanlo_excel_api")
    except Exception as e:
        return _excel_error(request, e, "export_phanlo_excel_api")

async def export_tuychonmuathem_excel_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        data, json_error = await read_json_object(request)
        if json_error:
            return json_error
        invalid = validate_or_response(request, data, {
            "tuyChonList": {"type": "array", "required": True, "max_length": 10_000},
        })
        if invalid:
            return invalid
        tuy_chon_list = data.get('tuyChonList', [])

        out_stream = await _export_excel(
            "create_tuychonmuathem_excel", tuy_chon_list
        )

        filename = "Danh_sach_tuy_chon_mua_them.xlsx"
        return StreamingResponse(
            out_stream,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except DocumentWorkerError as e:
        return _excel_error(request, e, "export_tuychonmuathem_excel_api")
    except Exception as e:
        return _excel_error(request, e, "export_tuychonmuathem_excel_api")
