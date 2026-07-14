from io import BytesIO
import os
from starlette.responses import StreamingResponse, JSONResponse

from backend.shared.helpers import (
    database,
    verify_session,
    clean_id,
    get_active_org,
    OrgPermissionError
)
from backend.shared.access_policy import can_read_record

from backend.documents.excel_handler import parse_excel
from backend.documents.archive_validation import validate_ooxml_archive
import backend.documents.excel_service as excel_service

MAX_EXCEL_UPLOAD_BYTES = 10 * 1024 * 1024
ALLOWED_EXCEL_EXTENSIONS = {'.xlsx', '.xls'}
ALLOWED_EXCEL_MIME_TYPES = {
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/octet-stream',
}


def _can_export_package(role_or_err, org_name, package_id):
    conn = database.get_connection()
    try:
        cursor = conn.cursor()
        return can_read_record(
            cursor,
            str(role_or_err),
            role_or_err.user_id,
            org_name,
            "goithau",
            "goi_thau",
            package_id,
        )
    finally:
        conn.close()


def _validate_excel_upload(file_obj, file_bytes):
    filename = os.path.basename(str(getattr(file_obj, 'filename', '') or ''))
    _, ext = os.path.splitext(filename)
    if ext.lower() not in ALLOWED_EXCEL_EXTENSIONS:
        raise ValueError('Chỉ cho phép tải lên tệp Excel .xlsx hoặc .xls')
    if not file_bytes:
        raise ValueError('Tệp Excel tải lên đang trống')
    if len(file_bytes) > MAX_EXCEL_UPLOAD_BYTES:
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
    if ext.lower() == '.xlsx':
        validate_ooxml_archive(file_bytes, "xlsx")

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

        file_bytes = await file_obj.read()
        _validate_excel_upload(file_obj, file_bytes)
        rows = parse_excel(file_bytes, import_type)
        return JSONResponse({"success": True, "rows": rows})
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    except Exception as e:
        return JSONResponse({"error": f"Lỗi phân tích tệp Excel: {str(e)}"}, status_code=500)

async def export_excel_template_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        import_type = request.path_params.get('import_type')
        wb = excel_service.create_excel_template(import_type)

        out_stream = BytesIO()
        wb.save(out_stream)
        out_stream.seek(0)

        filename = f"mau_nhap_lieu_{import_type}.xlsx"
        return StreamingResponse(
            out_stream,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

async def export_mothau_template_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        case_type = request.query_params.get('case_type', '1G1T_NO_LOT')
        package_name = request.query_params.get('package_name', 'GoiThau')
        lot_codes_str = request.query_params.get('lot_codes', '')
        lot_codes = [c.strip() for c in lot_codes_str.split(',') if c.strip()]

        wb = excel_service.create_mothau_template(case_type, lot_codes)

        out_stream = BytesIO()
        wb.save(out_stream)
        out_stream.seek(0)

        filename = f"Mau_nhap_HSDT_{package_name}.xlsx"
        return StreamingResponse(
            out_stream,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

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

        wb = excel_service.create_opening_fin_template(pkg_id_clean, org_name)

        out_stream = BytesIO()
        wb.save(out_stream)
        out_stream.seek(0)

        filename = f"Mau_mo_hsdet_tai_chinh_{package_name}.xlsx"
        return StreamingResponse(
            out_stream,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

async def export_danhgiahsdt_template_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        org_name = get_active_org(request, role_or_err.user_id)

        package_id = request.query_params.get('package_id', '')
        package_name = request.query_params.get('package_name', 'GoiThau')
        eval_type = request.query_params.get('eval_type', 'technical')

        if not package_id:
            return JSONResponse({"error": "Missing package_id parameter"}, status_code=400)

        pkg_id_clean = clean_id(package_id)
        if not pkg_id_clean:
            return JSONResponse({"error": "Invalid package_id format"}, status_code=400)
        if not _can_export_package(role_or_err, org_name, pkg_id_clean):
            return JSONResponse({"error": "Ban khong co quyen xuat du lieu goi thau nay."}, status_code=403)

        wb = excel_service.create_danhgiahsdt_template(pkg_id_clean, org_name, eval_type)

        out_stream = BytesIO()
        wb.save(out_stream)
        out_stream.seek(0)

        filename = f"Mau_danh_gia_HSDT_{eval_type}_{package_name}.xlsx"
        return StreamingResponse(
            out_stream,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=404)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

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

        wb = excel_service.create_ketquaqd_template(pkg_id_clean, org_name)

        out_stream = BytesIO()
        wb.save(out_stream)
        out_stream.seek(0)

        filename = f"Mau_ket_qua_LCNT_{package_name}.xlsx"
        return StreamingResponse(
            out_stream,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=404)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

async def export_phanlo_excel_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        data = await request.json()
        phan_lo_list = data.get('phanLoList', [])

        wb = excel_service.create_phanlo_excel(phan_lo_list)

        out_stream = BytesIO()
        wb.save(out_stream)
        out_stream.seek(0)

        filename = "Danh_sach_phan_lo.xlsx"
        return StreamingResponse(
            out_stream,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

async def export_tuychonmuathem_excel_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        data = await request.json()
        tuy_chon_list = data.get('tuyChonList', [])

        wb = excel_service.create_tuychonmuathem_excel(tuy_chon_list)

        out_stream = BytesIO()
        wb.save(out_stream)
        out_stream.seek(0)

        filename = "Danh_sach_tuy_chon_mua_them.xlsx"
        return StreamingResponse(
            out_stream,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
