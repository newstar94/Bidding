"""Owner-scoped API for validating and filling muasamcong award-result XLSX files."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from starlette.responses import JSONResponse, Response

from backend.documents.award_result_excel_service import (
    AwardResultExcelError,
    XLSX_CONTENT_TYPE,
    consume_validation_artifact,
    create_validation_artifact,
    export_updates_from_match,
    find_foreign_lot_codes,
    load_award_result_dataset,
    load_winning_goods_export_model,
    load_validation_artifact,
    match_award_result_rows,
    output_filename,
    public_validation_result,
    release_validation_artifact,
)
from backend.documents.document_worker import (
    DocumentWorkerError,
    DocumentWorkerInputError,
    run_document_job_async,
)
from backend.documents.export_policy_registry import governed_export
from backend.documents.award_result_excel import reconciliation_filename
from backend.documents.routes_docx import _content_disposition
from backend.documents.upload_spooling import spooled_upload
from backend.shared.access_policy import can_read_record
from backend.shared.async_io import run_blocking_io
from backend.shared.database_io import run_database_read
from backend.shared.helpers import (
    OrgPermissionError,
    clean_id,
    database,
    get_active_org,
    log_audit,
    verify_session,
)
from backend.shared.logging_utils import error_response, log_and_error
from backend.shared.request_validation import read_json_object, validate_or_response
from backend.shared.subscription_policy import can_use_award_result_excel_export
from backend.shared.subscription_policy import can_use_document_export


MAX_AWARD_RESULT_EXCEL_BYTES = 10 * 1024 * 1024
ALLOWED_XLSX_MIME_TYPES = {
    XLSX_CONTENT_TYPE,
    "application/octet-stream",
}


def _safe_error(request, exception, context):
    if isinstance(exception, AwardResultExcelError):
        return error_response(
            request,
            exception.code,
            str(exception),
            status_code=exception.status_code,
        )
    if isinstance(exception, OrgPermissionError):
        return error_response(
            request,
            "ORG_ACCESS_DENIED",
            "Không có quyền truy cập tổ chức này.",
            status_code=403,
        )
    if isinstance(exception, DocumentWorkerInputError):
        return error_response(
            request,
            "AWARD_RESULT_EXCEL_INVALID",
            str(exception) or "Tệp Excel không hợp lệ.",
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
    if isinstance(exception, ValueError):
        return error_response(
            request,
            "AWARD_RESULT_EXCEL_INPUT_INVALID",
            str(exception) or "Yêu cầu Excel không hợp lệ.",
            status_code=400,
        )
    return log_and_error(
        request,
        exception,
        context,
        "AWARD_RESULT_EXCEL_FAILED",
        "Không thể xử lý file kết quả lựa chọn nhà thầu.",
    )


def _authorize(request, package_id):
    valid, role = verify_session(request)
    if not valid:
        raise AwardResultExcelError(
            "AUTH_REQUIRED", str(role), status_code=401
        )
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        organization_id = get_active_org(request, role.user_id, cursor=cursor)
        if not can_read_record(
            cursor,
            role,
            role.user_id,
            organization_id,
            "goithau",
            "goi_thau",
            package_id,
        ):
            raise AwardResultExcelError(
                "PACKAGE_EXPORT_DENIED",
                "Bạn không có quyền xuất kết quả của gói thầu này.",
                status_code=403,
            )
        if not can_use_award_result_excel_export(
            cursor, role, role.user_id, organization_id
        ):
            raise AwardResultExcelError(
                "EXCEL_EXPORT_SUBSCRIPTION_REQUIRED",
                "Phạm vi đang làm việc chưa có gói trả phí hoạt động để xuất Excel.",
                status_code=403,
            )
        return role, organization_id
    finally:
        connection.close()


def _authorize_winning_goods(request, package_id):
    valid, role = verify_session(request)
    if not valid:
        raise AwardResultExcelError("AUTH_REQUIRED", str(role), status_code=401)
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        organization_id = get_active_org(request, role.user_id, cursor=cursor)
        if not can_read_record(
            cursor, role, role.user_id, organization_id,
            "goithau", "goi_thau", package_id,
        ):
            raise AwardResultExcelError(
                "PACKAGE_EXPORT_DENIED",
                "Bạn không có quyền xuất hàng hóa của gói thầu này.",
                status_code=403,
            )
        if not can_use_document_export(
            cursor, role, role.user_id, organization_id, format="xlsx"
        ):
            raise AwardResultExcelError(
                "EXCEL_EXPORT_SUBSCRIPTION_REQUIRED",
                "Phạm vi đang làm việc chưa có quyền xuất Excel.",
                status_code=403,
            )
        return role, organization_id
    finally:
        connection.close()


@governed_export("excel.winning_goods")
async def export_winning_goods_excel_api(request):
    package_id = clean_id(request.path_params.get("package_id"))
    if not package_id:
        return error_response(
            request, "PACKAGE_ID_INVALID", "Mã gói thầu không hợp lệ.",
            status_code=400,
        )
    try:
        role, organization_id = await run_database_read(
            _authorize_winning_goods, request, package_id, timeout_seconds=10
        )
        try:
            expected_revision = int(request.query_params.get("expectedRevision") or 0)
        except (TypeError, ValueError):
            expected_revision = 0
        if expected_revision < 1:
            raise AwardResultExcelError(
                "PACKAGE_REVISION_REQUIRED",
                "Thiếu phiên bản gói thầu dùng để xuất.",
            )
        export_model = await run_database_read(
            load_winning_goods_export_model,
            package_id,
            organization_id,
            expected_revision,
            timeout_seconds=20,
        )
        output = await run_document_job_async(
            "export_excel",
            {"function": "create_winning_goods_excel", "args": [export_model]},
            timeout_seconds=45,
        )
        if not isinstance(output, (bytes, bytearray)):
            raise DocumentWorkerError("Kết quả xuất workbook không hợp lệ.")
        package_code = str(export_model.get("packageCode") or "goi_thau")
        safe_code = "".join(
            char if char.isalnum() or char in {"-", "_"} else "_"
            for char in package_code
        )[:120] or "goi_thau"
        log_audit(
            "winning_goods.excel_exported",
            actor_user_id=role.user_id,
            organization_id=organization_id,
            target_type="goi_thau",
            target_id=package_id,
            request=request,
            metadata={
                "revision": expected_revision,
                "output_size": len(output),
                "group_count": len(export_model.get("groups") or []),
            },
            required=True,
        )
        return Response(
            bytes(output),
            media_type=XLSX_CONTENT_TYPE,
            headers={
                "Content-Disposition": _content_disposition(
                    f"Danh_sach_hang_hoa_trung_thau_{safe_code}.xlsx"
                ),
                "Cache-Control": "private, no-store",
                "Pragma": "no-cache",
            },
        )
    except Exception as exception:  # noqa: BLE001 - route maps safe failures
        return _safe_error(request, exception, "export_winning_goods_excel_api")


def _validate_upload_metadata(upload, head: bytes, size: int) -> None:
    filename = Path(str(getattr(upload, "filename", "") or "")).name
    if Path(filename).suffix.casefold() != ".xlsx":
        raise AwardResultExcelError(
            "XLSX_REQUIRED", "Chỉ chấp nhận file Excel .xlsx."
        )
    if size <= 0:
        raise AwardResultExcelError("XLSX_EMPTY", "File Excel tải lên đang trống.")
    if size > MAX_AWARD_RESULT_EXCEL_BYTES:
        raise AwardResultExcelError(
            "XLSX_TOO_LARGE",
            "File Excel vượt quá giới hạn 10 MB.",
            status_code=413,
        )
    content_type = str(getattr(upload, "content_type", "") or "").casefold()
    if content_type and content_type not in ALLOWED_XLSX_MIME_TYPES:
        raise AwardResultExcelError(
            "XLSX_MIME_INVALID", "MIME type của file Excel không hợp lệ."
        )
    if not head.startswith(b"PK\x03\x04"):
        raise AwardResultExcelError(
            "XLSX_SIGNATURE_INVALID", "Nội dung file .xlsx không hợp lệ."
        )


async def _load_match_context(package_id, organization_id, inspection):
    dataset = await run_database_read(
        load_award_result_dataset,
        package_id,
        organization_id,
        timeout_seconds=20,
    )
    workbook_lot_codes = [row.get("lotCode") for row in inspection.get("rows") or []]
    foreign_lot_codes = await run_database_read(
        find_foreign_lot_codes,
        workbook_lot_codes,
        package_id,
        organization_id,
        timeout_seconds=20,
    )
    effective_inspection = {
        **inspection,
        "blockingErrors": list(inspection.get("blockingErrors") or []),
        "warnings": list(inspection.get("warnings") or []),
    }
    expected_template = (
        "medicine" if bool(int(dataset["package"].get("is_thuoc") or 0)) else "standard"
    )
    if inspection.get("templateType") and inspection.get("templateType") != expected_template:
        effective_inspection["blockingErrors"].append(
            {
                "code": "TEMPLATE_PACKAGE_TYPE_MISMATCH",
                "message": (
                    "Biểu mẫu Excel không phù hợp loại gói thầu thuốc."
                    if expected_template == "medicine"
                    else "Biểu mẫu Excel thuốc không phù hợp loại gói thầu hiện tại."
                ),
            }
        )
    effective_inspection["blockingErrors"].extend(
        dataset.get("blockingErrors") or []
    )
    match_result = match_award_result_rows(
        effective_inspection,
        dataset["records"],
        known_lot_codes=dataset["lotCodes"],
        foreign_lot_codes=foreign_lot_codes,
    )
    return dataset, match_result


async def validate_award_result_excel_api(request):
    package_id = clean_id(request.path_params.get("package_id"))
    if not package_id:
        return error_response(
            request,
            "PACKAGE_ID_INVALID",
            "Mã gói thầu không hợp lệ.",
            status_code=400,
        )
    token = None
    try:
        role, organization_id = await run_database_read(
            _authorize, request, package_id, timeout_seconds=10
        )
        form = await request.form()
        upload = form.get("file")
        if upload is None:
            raise AwardResultExcelError(
                "XLSX_FILE_REQUIRED", "Vui lòng chọn file Excel .xlsx."
            )
        suffix = Path(str(getattr(upload, "filename", "") or "")).suffix
        try:
            async with spooled_upload(
                upload,
                max_bytes=MAX_AWARD_RESULT_EXCEL_BYTES,
                suffix=suffix,
            ) as (upload_path, upload_size, head):
                _validate_upload_metadata(upload, head, upload_size)
                content = await run_blocking_io(
                    upload_path.read_bytes, timeout_seconds=15
                )
        except ValueError as exception:
            raise AwardResultExcelError(
                "XLSX_TOO_LARGE",
                "File Excel vượt quá giới hạn 10 MB.",
                status_code=413,
            ) from exception
        inspection = await run_document_job_async(
            "inspect_award_result_excel",
            {"content": content},
            timeout_seconds=30,
        )
        if not isinstance(inspection, dict):
            raise DocumentWorkerError("Kết quả kiểm tra workbook không hợp lệ.")
        dataset, match_result = await _load_match_context(
            package_id, organization_id, inspection
        )
        public_result = public_validation_result(match_result)
        metadata = {
            "originalFilename": Path(
                str(getattr(upload, "filename", "workbook.xlsx"))
            ).name,
            "sizeBytes": len(content),
            "sha256": hashlib.sha256(content).hexdigest(),
        }
        if public_result.get("canExport"):
            token, stored_metadata = await run_blocking_io(
                create_validation_artifact,
                content,
                inspection,
                user_id=role.user_id,
                organization_id=organization_id,
                package_id=package_id,
                original_filename=getattr(upload, "filename", "workbook.xlsx"),
                timeout_seconds=15,
            )
            metadata.update(stored_metadata)
        public_result.update(
            {
                "fileName": metadata["originalFilename"],
                "fileSize": metadata["sizeBytes"],
                "packageCode": dataset["package"].get("ma_goi_thau"),
            }
        )
        if token:
            public_result.update(
                {"validationToken": token, "expiresAt": metadata["expiresAt"]}
            )
        log_audit(
            "award_result.excel_validated",
            actor_user_id=role.user_id,
            organization_id=organization_id,
            target_type="goi_thau",
            target_id=package_id,
            request=request,
            metadata={
                "file_sha256": metadata["sha256"],
                "file_size": metadata["sizeBytes"],
                "total_rows": public_result["totalRows"],
                "exact_matches": public_result["exactMatches"],
                "fallback_matches": public_result["fallbackMatches"],
                "blocking_error_count": len(public_result["blockingErrors"]),
                "warning_count": len(public_result["warnings"]),
            },
            required=True,
        )
        return JSONResponse(public_result)
    except Exception as exception:  # noqa: BLE001 - route boundary maps safe failures
        if token:
            await run_blocking_io(
                consume_validation_artifact, token, timeout_seconds=5
            )
        return _safe_error(request, exception, "validate_award_result_excel_api")


@governed_export("excel.award_result")
async def export_award_result_excel_api(request):
    package_id = clean_id(request.path_params.get("package_id"))
    if not package_id:
        return error_response(
            request,
            "PACKAGE_ID_INVALID",
            "Mã gói thầu không hợp lệ.",
            status_code=400,
        )
    token = None
    try:
        role, organization_id = await run_database_read(
            _authorize, request, package_id, timeout_seconds=10
        )
        payload, payload_error = await read_json_object(request)
        if payload_error:
            return payload_error
        invalid = validate_or_response(
            request,
            payload,
            {"validationToken": {"type": "string", "required": True, "max_length": 256}},
        )
        if invalid:
            return invalid
        token = str(payload["validationToken"])
        metadata, content = await run_blocking_io(
            load_validation_artifact,
            token,
            user_id=role.user_id,
            organization_id=organization_id,
            package_id=package_id,
            claim=True,
            timeout_seconds=15,
        )
        inspection = metadata.get("inspection")
        if not isinstance(inspection, dict):
            raise AwardResultExcelError(
                "VALIDATION_ARTIFACT_INVALID",
                "Dữ liệu kiểm tra file không còn hợp lệ.",
                status_code=410,
            )
        dataset, match_result = await _load_match_context(
            package_id, organization_id, inspection
        )
        if match_result["blockingErrors"]:
            public_result = public_validation_result(match_result)
            public_result.update(
                {
                    "error": "Dữ liệu hiện tại có lỗi chặn xuất file.",
                    "code": "AWARD_RESULT_EXPORT_BLOCKED",
                }
            )
            await run_blocking_io(
                release_validation_artifact, token, timeout_seconds=5
            )
            return JSONResponse(public_result, status_code=409)
        updates = export_updates_from_match(match_result)
        if not updates:
            raise AwardResultExcelError(
                "NO_APPROVED_RESULT_TO_EXPORT",
                "Không có dòng kết quả đã phê duyệt có thể ghi vào workbook.",
                status_code=409,
            )
        output = await run_document_job_async(
            "export_award_result_excel",
            {"content": content, "updates": updates},
            timeout_seconds=45,
        )
        if not isinstance(output, (bytes, bytearray)):
            raise DocumentWorkerError("Kết quả xuất workbook không hợp lệ.")
        filename = output_filename(metadata.get("originalFilename"))
        log_audit(
            "award_result.excel_exported",
            actor_user_id=role.user_id,
            organization_id=organization_id,
            target_type="goi_thau",
            target_id=package_id,
            request=request,
            metadata={
                "file_sha256": metadata["sha256"],
                "source_size": metadata["sizeBytes"],
                "output_size": len(output),
                "updated_rows": len(updates),
                "package_code": dataset["package"].get("ma_goi_thau"),
            },
            required=True,
        )
        await run_blocking_io(
            consume_validation_artifact, token, timeout_seconds=5
        )
        return Response(
            bytes(output),
            media_type=XLSX_CONTENT_TYPE,
            headers={
                "Content-Disposition": _content_disposition(filename),
                "Cache-Control": "private, no-store",
                "Pragma": "no-cache",
            },
        )
    except Exception as exception:  # noqa: BLE001 - route boundary maps safe failures
        if token:
            await run_blocking_io(
                release_validation_artifact, token, timeout_seconds=5
            )
        return _safe_error(request, exception, "export_award_result_excel_api")


async def award_result_excel_preview_api(request):
    package_id = clean_id(request.path_params.get("package_id"))
    if not package_id:
        return error_response(
            request,
            "PACKAGE_ID_INVALID",
            "Mã gói thầu không hợp lệ.",
            status_code=400,
        )
    try:
        role, organization_id = await run_database_read(
            _authorize, request, package_id, timeout_seconds=10
        )
        query = request.query_params
        token = str(query.get("validationToken") or "")
        if not token:
            raise AwardResultExcelError(
                "VALIDATION_TOKEN_REQUIRED",
                "Thiếu validation token.",
            )
        try:
            page = max(1, int(query.get("page") or 1))
            page_size = max(1, min(200, int(query.get("pageSize") or 100)))
        except (TypeError, ValueError) as exc:
            raise AwardResultExcelError(
                "PREVIEW_PAGINATION_INVALID", "Tham số phân trang không hợp lệ."
            ) from exc
        metadata, _content = await run_blocking_io(
            load_validation_artifact,
            token,
            user_id=role.user_id,
            organization_id=organization_id,
            package_id=package_id,
            timeout_seconds=15,
        )
        inspection = metadata.get("inspection")
        if not isinstance(inspection, dict):
            raise AwardResultExcelError(
                "VALIDATION_ARTIFACT_INVALID",
                "Dữ liệu kiểm tra file không còn hợp lệ.",
                status_code=410,
            )
        _dataset, match_result = await _load_match_context(
            package_id, organization_id, inspection
        )
        writable_filter = query.get("writable")
        writable = (
            None
            if writable_filter is None
            else str(writable_filter).casefold() in {"1", "true", "yes"}
        )
        return JSONResponse(
            public_validation_result(
                match_result,
                page=page,
                page_size=page_size,
                status=query.get("status"),
                warning=query.get("warning"),
                match_method=query.get("matchMethod"),
                writable=writable,
            )
        )
    except Exception as exception:  # noqa: BLE001 - route boundary maps safe failures
        return _safe_error(request, exception, "award_result_excel_preview_api")


@governed_export("excel.award_result_reconciliation")
async def award_result_excel_reconciliation_api(request):
    package_id = clean_id(request.path_params.get("package_id"))
    if not package_id:
        return error_response(
            request,
            "PACKAGE_ID_INVALID",
            "Mã gói thầu không hợp lệ.",
            status_code=400,
        )
    try:
        role, organization_id = await run_database_read(
            _authorize, request, package_id, timeout_seconds=10
        )
        payload, payload_error = await read_json_object(request)
        if payload_error:
            return payload_error
        invalid = validate_or_response(
            request,
            payload,
            {
                "validationToken": {
                    "type": "string",
                    "required": True,
                    "max_length": 256,
                }
            },
        )
        if invalid:
            return invalid
        token = str(payload["validationToken"])
        metadata, _content = await run_blocking_io(
            load_validation_artifact,
            token,
            user_id=role.user_id,
            organization_id=organization_id,
            package_id=package_id,
            timeout_seconds=15,
        )
        inspection = metadata.get("inspection")
        if not isinstance(inspection, dict):
            raise AwardResultExcelError(
                "VALIDATION_ARTIFACT_INVALID",
                "Dữ liệu kiểm tra file không còn hợp lệ.",
                status_code=410,
            )
        dataset, match_result = await _load_match_context(
            package_id, organization_id, inspection
        )
        report_payload = {
            "metadata": {
                "sourceSha256": metadata.get("sha256"),
                "packageCode": dataset["package"].get("ma_goi_thau"),
                "userId": role.user_id,
                "generatedAt": datetime.now(timezone.utc).isoformat(),
            },
            "summary": {
                key: match_result.get(key, 0)
                for key in (
                    "totalRows",
                    "exactMatches",
                    "fallbackMatches",
                    "unmatchedRows",
                    "updatedRows",
                )
            },
            "rows": list(match_result.get("rows") or []),
        }
        report = await run_document_job_async(
            "build_award_result_reconciliation",
            {
                "reportJson": json.dumps(
                report_payload,
                ensure_ascii=False,
                separators=(",", ":"),
                ).encode("utf-8"),
            },
            timeout_seconds=45,
        )
        if not isinstance(report, (bytes, bytearray)):
            raise DocumentWorkerError("Báo cáo đối chiếu không hợp lệ.")
        filename = reconciliation_filename(metadata.get("originalFilename"))
        log_audit(
            "award_result.excel_reconciliation_exported",
            actor_user_id=role.user_id,
            organization_id=organization_id,
            target_type="goi_thau",
            target_id=package_id,
            request=request,
            metadata={
                "file_sha256": metadata.get("sha256"),
                "report_size": len(report),
                "total_rows": match_result.get("totalRows", 0),
                "updated_rows": match_result.get("updatedRows", 0),
            },
            required=True,
        )
        return Response(
            bytes(report),
            media_type=XLSX_CONTENT_TYPE,
            headers={
                "Content-Disposition": _content_disposition(filename),
                "Cache-Control": "private, no-store",
                "Pragma": "no-cache",
            },
        )
    except Exception as exception:  # noqa: BLE001 - route boundary maps safe failures
        return _safe_error(
            request, exception, "award_result_excel_reconciliation_api"
        )


async def cancel_award_result_excel_validation_api(request):
    package_id = clean_id(request.path_params.get("package_id"))
    if not package_id:
        return error_response(
            request,
            "PACKAGE_ID_INVALID",
            "Mã gói thầu không hợp lệ.",
            status_code=400,
        )
    try:
        role, organization_id = await run_database_read(
            _authorize, request, package_id, timeout_seconds=10
        )
        payload, payload_error = await read_json_object(request)
        if payload_error:
            return payload_error
        token = str(payload.get("validationToken") or "")
        if not token:
            raise AwardResultExcelError(
                "VALIDATION_TOKEN_REQUIRED", "Thiếu validation token."
            )
        await run_blocking_io(
            load_validation_artifact,
            token,
            user_id=role.user_id,
            organization_id=organization_id,
            package_id=package_id,
            timeout_seconds=15,
        )
        await run_blocking_io(
            consume_validation_artifact, token, timeout_seconds=5
        )
        return Response(status_code=204)
    except Exception as exception:  # noqa: BLE001 - route boundary maps safe failures
        return _safe_error(
            request, exception, "cancel_award_result_excel_validation_api"
        )


def award_result_excel_routes(Route):
    return [
        Route(
            "/api/packages/{package_id}/winning-goods.xlsx",
            export_winning_goods_excel_api,
            methods=["GET"],
        ),
        Route(
            "/api/packages/{package_id}/award-result-excel/validate",
            validate_award_result_excel_api,
            methods=["POST"],
        ),
        Route(
            "/api/packages/{package_id}/award-result-excel/export",
            export_award_result_excel_api,
            methods=["POST"],
        ),
        Route(
            "/api/packages/{package_id}/award-result-excel/preview",
            award_result_excel_preview_api,
            methods=["GET"],
        ),
        Route(
            "/api/packages/{package_id}/award-result-excel/reconciliation",
            award_result_excel_reconciliation_api,
            methods=["POST"],
        ),
        Route(
            "/api/packages/{package_id}/award-result-excel/validation",
            cancel_award_result_excel_validation_api,
            methods=["DELETE"],
        ),
    ]
