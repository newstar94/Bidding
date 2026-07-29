"""HTTP routes for the package detail document tab."""

from __future__ import annotations

import json
import re
import time

from starlette.responses import FileResponse, JSONResponse

from backend.documents.document_worker import (
    DocumentWorkerError,
    DocumentWorkerInputError,
    run_document_job_async,
)
from backend.documents.package_document_policy import (
    allowed_upload_types,
    compose_document_sections,
    document_type_definition,
    is_evaluation_document_type,
    package_status_code,
)
from backend.documents.package_document_service import (
    MAX_PACKAGE_DOCUMENT_BYTES,
    PackageDocumentError,
    PackageDocumentNotFoundError,
    clean_original_filename,
    create_storage_key,
    delete_package_document,
    get_evaluation_batch,
    get_package_document,
    list_package_evaluation_batches,
    list_package_documents,
    load_package,
    media_for_filename,
    persist_upload_path,
    remove_storage_key,
    resolve_storage_key,
    upsert_package_document,
    validate_pdf_path,
)
from backend.documents.upload_spooling import spooled_upload
from backend.shared.access_policy import authorize_record_write, can_read_record
from backend.shared.async_io import run_blocking_io
from backend.shared.domain_enums import enum_label
from backend.shared.helpers import (
    OrgPermissionError,
    database,
    get_active_org,
    log_audit,
    log_error,
    verify_session,
)
from backend.shared.logging_utils import log_and_error
from backend.shared.logging_utils import get_request_id
from backend.shared.date_utils import vietnam_now_sql
from backend.shared.idempotency import acquire_idempotency_lock
from backend.activity.service import (
    document_activity_event,
    insert_activity_events,
)
from backend.sync.api import broadcast_websocket_event


_IDEMPOTENCY_KEY_RE = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")


def _document_error(message, code, status_code):
    return JSONResponse({"error": message, "code": code}, status_code=status_code)


def _document_idempotency_key(request):
    key = str(request.headers.get("Idempotency-Key") or "").strip()
    if key and not _IDEMPOTENCY_KEY_RE.fullmatch(key):
        return None, _document_error(
            "Idempotency-Key không hợp lệ.",
            "INVALID_IDEMPOTENCY_KEY",
            400,
        )
    return key or None, None


def _document_operation(
    organization_id,
    package_id,
    document_type,
    evaluation_batch_id,
    action,
):
    return ":".join((
        "package_document",
        str(organization_id),
        str(package_id),
        str(document_type),
        str(evaluation_batch_id or "general"),
        str(action),
    ))


def _document_idempotency_replay(
    cursor,
    *,
    actor_user_id,
    operation,
    idempotency_key,
):
    if not idempotency_key:
        return None
    acquire_idempotency_lock(
        cursor,
        "package_document",
        actor_user_id,
        operation,
        idempotency_key,
    )
    row = cursor.execute(
        """SELECT response_json FROM api_idempotency
           WHERE actor_user_id = ? AND operation = ? AND idempotency_key = ?""",
        (actor_user_id, operation, idempotency_key),
    ).fetchone()
    if not row:
        return None
    payload = json.loads(row[0] or "{}")
    status_code = int(payload.pop("_statusCode", 200))
    return payload, status_code


def _store_document_idempotency(
    cursor,
    *,
    actor_user_id,
    operation,
    idempotency_key,
    payload,
    status_code,
):
    if not idempotency_key:
        return
    stored_payload = {**payload, "_statusCode": int(status_code)}
    cursor.execute(
        """INSERT INTO api_idempotency (
               actor_user_id, operation, idempotency_key, response_json, created_at
           ) VALUES (?, ?, ?, ?, ?)""",
        (
            actor_user_id,
            operation,
            idempotency_key,
            json.dumps(stored_payload, ensure_ascii=False),
            int(time.time()),
        ),
    )


def _package_read_allowed(cursor, session, organization_id, package_id):
    return can_read_record(
        cursor,
        session,
        session.user_id,
        organization_id,
        "goithau",
        "goi_thau",
        package_id,
    )


def _package_write_decision(cursor, session, organization_id, package_id):
    return authorize_record_write(
        cursor,
        session,
        session.user_id,
        organization_id,
        "goithau",
        "goi_thau",
        {"id": package_id},
    )


def _request_evaluation_batch_id(request):
    return str(
        request.query_params.get("evaluationBatchId") or ""
    ).strip() or None


def _validate_mutation_scope(
    cursor,
    organization_id,
    package,
    document_type,
    evaluation_batch_id,
):
    is_evaluation = is_evaluation_document_type(document_type)
    has_lots = str(package.get("phan_lo") or "").strip() == "Có"
    if not is_evaluation:
        if evaluation_batch_id:
            raise PackageDocumentError(
                "Tài liệu chung của gói thầu không được gắn với đợt đánh giá."
            )
        return None
    if not has_lots:
        if evaluation_batch_id:
            raise PackageDocumentError(
                "Gói thầu không phân lô không có phạm vi đợt đánh giá phần lô."
            )
        return None
    if not evaluation_batch_id:
        raise PackageDocumentError(
            "Phải chọn đúng đợt đánh giá khi tải BCĐG hoặc BCTĐ."
        )
    batch = get_evaluation_batch(
        cursor,
        organization_id,
        package["id"],
        evaluation_batch_id,
    )
    if not batch:
        raise PackageDocumentError(
            "Không tìm thấy đợt đánh giá thuộc gói thầu này."
        )
    if str(batch.get("status") or "").upper() != "ACTIVE":
        raise PackageDocumentError(
            "Đợt đánh giá đã kết thúc; tài liệu của đợt được chuyển sang chỉ đọc."
        )
    return batch


async def list_package_documents_api(request):
    try:
        valid, session = verify_session(request)
        if not valid:
            return _document_error(str(session), "SESSION_REQUIRED", 403)
        package_id = str(request.path_params.get("package_id") or "").strip()
        organization_id = get_active_org(request, session.user_id)
        with database.get_connection() as connection:
            cursor = connection.cursor()
            package = load_package(cursor, organization_id, package_id)
            if not _package_read_allowed(
                cursor,
                session,
                organization_id,
                package_id,
            ):
                return _document_error(
                    "Không có quyền xem tài liệu của gói thầu.",
                    "PACKAGE_DOCUMENT_ACCESS_DENIED",
                    403,
                )
            documents = list_package_documents(
                cursor,
                organization_id,
                package_id,
            )
            batches = list_package_evaluation_batches(
                cursor,
                organization_id,
                package_id,
            )
            write_decision = _package_write_decision(
                cursor,
                session,
                organization_id,
                package_id,
            )
            sections = compose_document_sections(
                package,
                documents,
                batches,
                write_allowed=write_decision.allowed,
            )
            return JSONResponse(
                {
                    "packageId": package_id,
                    "packageStatus": enum_label(
                        "goi_thau",
                        "trang_thai",
                        package_status_code(package),
                    ),
                    "sections": sections,
                    "slots": [
                        slot
                        for section in sections
                        for slot in section["slots"]
                    ],
                },
                headers={"Cache-Control": "private, no-store"},
            )
    except PackageDocumentNotFoundError as exc:
        return _document_error(str(exc), exc.code, 404)
    except OrgPermissionError:
        return _document_error(
            "Không có quyền truy cập tổ chức.",
            "ORG_ACCESS_DENIED",
            403,
        )
    except Exception as exc:
        return log_and_error(
            request,
            exc,
            "list_package_documents_api",
            "PACKAGE_DOCUMENT_LIST_FAILED",
            "Không thể tải danh sách tài liệu.",
        )


async def upload_package_document_api(request):
    new_storage_key = None
    old_storage_key = None
    connection = None
    try:
        valid, session = verify_session(request)
        if not valid:
            return _document_error(str(session), "SESSION_REQUIRED", 403)
        package_id = str(request.path_params.get("package_id") or "").strip()
        document_type = str(
            request.path_params.get("document_type") or ""
        ).strip()
        evaluation_batch_id = _request_evaluation_batch_id(request)
        idempotency_key, idempotency_error = _document_idempotency_key(request)
        if idempotency_error:
            return idempotency_error
        if document_type_definition(document_type) is None:
            return _document_error(
                "Loại tài liệu không hợp lệ.",
                "PACKAGE_DOCUMENT_TYPE_INVALID",
                400,
            )
        organization_id = get_active_org(request, session.user_id)
        operation = _document_operation(
            organization_id,
            package_id,
            document_type,
            evaluation_batch_id,
            "upload",
        )

        with database.get_connection() as read_connection:
            cursor = read_connection.cursor()
            package = load_package(cursor, organization_id, package_id)
            decision = _package_write_decision(
                cursor,
                session,
                organization_id,
                package_id,
            )
            if not decision.allowed:
                return _document_error(
                    decision.message or "Không có quyền sửa gói thầu.",
                    "PACKAGE_DOCUMENT_ACCESS_DENIED",
                    403,
                )
            if document_type not in allowed_upload_types(package):
                return _document_error(
                    "Loại tài liệu này không được tải lên ở bước hiện tại.",
                    "PACKAGE_DOCUMENT_STEP_LOCKED",
                    409,
                )
            _validate_mutation_scope(
                cursor,
                organization_id,
                package,
                document_type,
                evaluation_batch_id,
            )

        form = await request.form()
        upload = form.get("file")
        if upload is None or not getattr(upload, "filename", None):
            return _document_error(
                "Vui lòng chọn tệp cần tải lên.",
                "PACKAGE_DOCUMENT_FILE_REQUIRED",
                400,
            )
        original_filename = clean_original_filename(upload.filename)
        extension, archive_kind, content_type = media_for_filename(
            original_filename
        )
        async with spooled_upload(
            upload,
            max_bytes=MAX_PACKAGE_DOCUMENT_BYTES,
            suffix=extension,
        ) as (upload_path, upload_size, head):
            if upload_size <= 0:
                raise PackageDocumentError("Tệp tải lên đang trống.")
            if archive_kind == "pdf":
                if not head.startswith(b"%PDF-"):
                    raise PackageDocumentError("Cấu trúc tệp PDF không hợp lệ.")
                await run_blocking_io(
                    validate_pdf_path,
                    upload_path,
                    timeout_seconds=10,
                )
            else:
                if not head.startswith(b"PK"):
                    raise PackageDocumentError(
                        "Cấu trúc tệp Office không hợp lệ."
                    )
                await run_document_job_async(
                    "validate_ooxml",
                    {
                        "content_path": str(upload_path),
                        "kind": archive_kind,
                    },
                    timeout_seconds=20,
                )

            new_storage_key = create_storage_key(
                organization_id,
                package_id,
                extension,
            )
            stored_size, checksum = await run_blocking_io(
                persist_upload_path,
                upload_path,
                new_storage_key,
                timeout_seconds=15,
            )

        connection = database.get_connection()
        connection.execute("BEGIN")
        cursor = connection.cursor()
        package = load_package(cursor, organization_id, package_id)
        decision = _package_write_decision(
            cursor,
            session,
            organization_id,
            package_id,
        )
        if not decision.allowed:
            raise PackageDocumentError(
                decision.message or "Không còn quyền sửa gói thầu."
            )
        replay = _document_idempotency_replay(
            cursor,
            actor_user_id=session.user_id,
            operation=operation,
            idempotency_key=idempotency_key,
        )
        if replay:
            connection.commit()
            connection.close()
            connection = None
            if new_storage_key:
                try:
                    await run_blocking_io(
                        remove_storage_key,
                        new_storage_key,
                        timeout_seconds=5,
                    )
                finally:
                    new_storage_key = None
            replay_payload, replay_status = replay
            return JSONResponse(replay_payload, status_code=replay_status)
        if document_type not in allowed_upload_types(package):
            raise PackageDocumentError(
                "Gói thầu đã chuyển bước; không thể tải loại tài liệu này."
            )
        _validate_mutation_scope(
            cursor,
            organization_id,
            package,
            document_type,
            evaluation_batch_id,
        )
        document, previous = upsert_package_document(
            cursor,
            organization_id=organization_id,
            package=package,
            document_type=document_type,
            original_filename=original_filename,
            storage_key=new_storage_key,
            content_type=content_type,
            size_bytes=stored_size,
            sha256=checksum,
            uploaded_by_id=session.user_id,
            evaluation_batch_id=evaluation_batch_id,
        )
        old_storage_key = previous.get("storage_key") if previous else None
        insert_activity_events(
            cursor,
            organization_id=organization_id,
            owner_type=package["owner_type"],
            actor_user_id=session.user_id,
            occurred_at=vietnam_now_sql(),
            events=[document_activity_event(
                action=(
                    "package_document.replaced"
                    if previous else "package_document.uploaded"
                ),
                package=package,
                document_id=document["id"],
                filename=document["originalFilename"],
                document_type=document_type,
                size_bytes=stored_size,
                client_mutation_id=idempotency_key,
                request_id=get_request_id(request),
            )],
        )
        log_audit(
            "package_document.replaced" if previous else "package_document.uploaded",
            actor_user_id=session.user_id,
            organization_id=organization_id,
            target_type="package_document",
            target_id=document["id"],
            request=request,
            metadata={
                "packageId": package_id,
                "documentType": document_type,
                "evaluationBatchId": evaluation_batch_id,
                "sizeBytes": stored_size,
            },
            cursor=cursor,
            required=True,
        )
        response_payload = {"success": True, "document": document}
        response_status = 200 if previous else 201
        _store_document_idempotency(
            cursor,
            actor_user_id=session.user_id,
            operation=operation,
            idempotency_key=idempotency_key,
            payload=response_payload,
            status_code=response_status,
        )
        connection.commit()
        connection.close()
        connection = None
        new_storage_key = None
        if old_storage_key and old_storage_key != new_storage_key:
            try:
                await run_blocking_io(
                    remove_storage_key,
                    old_storage_key,
                    timeout_seconds=5,
                )
            except Exception as cleanup_error:
                log_error(cleanup_error, "package_document_old_file_cleanup")
        broadcast_websocket_event(organization_id, {"event": "db_changed"})
        return JSONResponse(response_payload, status_code=response_status)
    except (PackageDocumentError, DocumentWorkerInputError) as exc:
        if connection:
            connection.rollback()
        if new_storage_key:
            try:
                await run_blocking_io(
                    remove_storage_key,
                    new_storage_key,
                    timeout_seconds=5,
                )
            except Exception:
                pass
        return _document_error(
            str(exc),
            getattr(exc, "code", "PACKAGE_DOCUMENT_FILE_INVALID"),
            400,
        )
    except DocumentWorkerError as exc:
        if connection:
            connection.rollback()
        return log_and_error(
            request,
            exc,
            "upload_package_document_api",
            "PACKAGE_DOCUMENT_VALIDATION_UNAVAILABLE",
            "Dịch vụ kiểm tra tài liệu tạm thời không khả dụng.",
            status_code=503,
        )
    except OrgPermissionError:
        if connection:
            connection.rollback()
        return _document_error(
            "Không có quyền truy cập tổ chức.",
            "ORG_ACCESS_DENIED",
            403,
        )
    except Exception as exc:
        if connection:
            connection.rollback()
        if new_storage_key:
            try:
                await run_blocking_io(
                    remove_storage_key,
                    new_storage_key,
                    timeout_seconds=5,
                )
            except Exception:
                pass
        return log_and_error(
            request,
            exc,
            "upload_package_document_api",
            "PACKAGE_DOCUMENT_UPLOAD_FAILED",
            "Không thể tải tài liệu lên.",
        )
    finally:
        if connection:
            connection.close()


async def download_package_document_api(request):
    connection = None
    try:
        valid, session = verify_session(request)
        if not valid:
            return _document_error(str(session), "SESSION_REQUIRED", 403)
        package_id = str(request.path_params.get("package_id") or "").strip()
        document_type = str(
            request.path_params.get("document_type") or ""
        ).strip()
        evaluation_batch_id = _request_evaluation_batch_id(request)
        organization_id = get_active_org(request, session.user_id)
        connection = database.get_connection()
        connection.execute("BEGIN")
        cursor = connection.cursor()
        load_package(cursor, organization_id, package_id)
        if not _package_read_allowed(
            cursor,
            session,
            organization_id,
            package_id,
        ):
            connection.rollback()
            return _document_error(
                "Không có quyền tải tài liệu của gói thầu.",
                "PACKAGE_DOCUMENT_ACCESS_DENIED",
                403,
            )
        document = get_package_document(
            cursor,
            organization_id,
            package_id,
            document_type,
            evaluation_batch_id,
        )
        if not document:
            raise PackageDocumentNotFoundError("Không tìm thấy tài liệu.")
        path = resolve_storage_key(document["storage_key"])
        if not path.is_file():
            raise PackageDocumentNotFoundError("Tệp tài liệu không còn tồn tại.")
        log_audit(
            "package_document.downloaded",
            actor_user_id=session.user_id,
            organization_id=organization_id,
            target_type="package_document",
            target_id=document["id"],
            request=request,
            metadata={
                "packageId": package_id,
                "documentType": document_type,
                "evaluationBatchId": evaluation_batch_id,
                "sizeBytes": document["size_bytes"],
            },
            cursor=cursor,
            required=True,
        )
        connection.commit()
        connection.close()
        connection = None
        return FileResponse(
            path,
            filename=document["original_filename"],
            media_type=document["content_type"],
            headers={
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
            },
        )
    except PackageDocumentNotFoundError as exc:
        if connection:
            connection.rollback()
        return _document_error(str(exc), exc.code, 404)
    except PackageDocumentError as exc:
        if connection:
            connection.rollback()
        return _document_error(str(exc), exc.code, 409)
    except OrgPermissionError:
        if connection:
            connection.rollback()
        return _document_error(
            "Không có quyền truy cập tổ chức.",
            "ORG_ACCESS_DENIED",
            403,
        )
    except Exception as exc:
        if connection:
            connection.rollback()
        return log_and_error(
            request,
            exc,
            "download_package_document_api",
            "PACKAGE_DOCUMENT_DOWNLOAD_FAILED",
            "Không thể tải tài liệu.",
        )
    finally:
        if connection:
            connection.close()


async def delete_package_document_api(request):
    connection = None
    deleted = None
    try:
        valid, session = verify_session(request)
        if not valid:
            return _document_error(str(session), "SESSION_REQUIRED", 403)
        package_id = str(request.path_params.get("package_id") or "").strip()
        document_type = str(
            request.path_params.get("document_type") or ""
        ).strip()
        evaluation_batch_id = _request_evaluation_batch_id(request)
        idempotency_key, idempotency_error = _document_idempotency_key(request)
        if idempotency_error:
            return idempotency_error
        organization_id = get_active_org(request, session.user_id)
        operation = _document_operation(
            organization_id,
            package_id,
            document_type,
            evaluation_batch_id,
            "delete",
        )
        connection = database.get_connection()
        connection.execute("BEGIN")
        cursor = connection.cursor()
        package = load_package(cursor, organization_id, package_id)
        decision = _package_write_decision(
            cursor,
            session,
            organization_id,
            package_id,
        )
        if not decision.allowed:
            connection.rollback()
            return _document_error(
                decision.message or "Không có quyền sửa gói thầu.",
                "PACKAGE_DOCUMENT_ACCESS_DENIED",
                403,
            )
        replay = _document_idempotency_replay(
            cursor,
            actor_user_id=session.user_id,
            operation=operation,
            idempotency_key=idempotency_key,
        )
        if replay:
            connection.commit()
            connection.close()
            connection = None
            replay_payload, replay_status = replay
            return JSONResponse(replay_payload, status_code=replay_status)
        if document_type not in allowed_upload_types(package):
            connection.rollback()
            return _document_error(
                "Không thể xóa tài liệu của bước đã hoàn thành.",
                "PACKAGE_DOCUMENT_STEP_LOCKED",
                409,
            )
        _validate_mutation_scope(
            cursor,
            organization_id,
            package,
            document_type,
            evaluation_batch_id,
        )
        deleted = delete_package_document(
            cursor,
            organization_id,
            package_id,
            document_type,
            evaluation_batch_id,
        )
        insert_activity_events(
            cursor,
            organization_id=organization_id,
            owner_type=package["owner_type"],
            actor_user_id=session.user_id,
            occurred_at=vietnam_now_sql(),
            events=[document_activity_event(
                action="package_document.deleted",
                package=package,
                document_id=deleted["id"],
                filename=deleted["original_filename"],
                document_type=document_type,
                size_bytes=None,
                client_mutation_id=idempotency_key,
                request_id=get_request_id(request),
            )],
        )
        log_audit(
            "package_document.deleted",
            actor_user_id=session.user_id,
            organization_id=organization_id,
            target_type="package_document",
            target_id=deleted["id"],
            request=request,
            metadata={
                "packageId": package_id,
                "documentType": document_type,
                "evaluationBatchId": evaluation_batch_id,
            },
            cursor=cursor,
            required=True,
        )
        response_payload = {"success": True}
        _store_document_idempotency(
            cursor,
            actor_user_id=session.user_id,
            operation=operation,
            idempotency_key=idempotency_key,
            payload=response_payload,
            status_code=200,
        )
        connection.commit()
        connection.close()
        connection = None
        try:
            await run_blocking_io(
                remove_storage_key,
                deleted["storage_key"],
                timeout_seconds=5,
            )
        except Exception as cleanup_error:
            log_error(cleanup_error, "package_document_deleted_file_cleanup")
        broadcast_websocket_event(organization_id, {"event": "db_changed"})
        return JSONResponse(response_payload)
    except PackageDocumentNotFoundError as exc:
        if connection:
            connection.rollback()
        return _document_error(str(exc), exc.code, 404)
    except PackageDocumentError as exc:
        if connection:
            connection.rollback()
        return _document_error(str(exc), exc.code, 409)
    except OrgPermissionError:
        if connection:
            connection.rollback()
        return _document_error(
            "Không có quyền truy cập tổ chức.",
            "ORG_ACCESS_DENIED",
            403,
        )
    except Exception as exc:
        if connection:
            connection.rollback()
        return log_and_error(
            request,
            exc,
            "delete_package_document_api",
            "PACKAGE_DOCUMENT_DELETE_FAILED",
            "Không thể xóa tài liệu.",
        )
    finally:
        if connection:
            connection.close()
