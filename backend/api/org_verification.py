"""Tax-code verification for organizations (ADR 0094).

A manager uploads one proof document for the active organization; a platform
admin approves or rejects it. Verification only grants the "verified" badge
and exclusive use of the tax code; it never changes access or entitlements.
"""

from __future__ import annotations

import hashlib
import os
import re
import time
import uuid
from pathlib import Path, PurePosixPath

from starlette.responses import FileResponse, JSONResponse

from backend.api.org_tax_code import verified_tax_code_holder
from backend.auth.auth_helper import verify_session_in_transaction
from backend.auth.auth_service import get_rate_limit_decision_in_transaction, rate_limit_response
from backend.documents.upload_spooling import spooled_upload
from backend.shared.access_policy import is_business_organization, is_organization_manager
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError, run_blocking_io
from backend.shared.database_http import database_unavailable_response
from backend.shared.database_io import run_database_read, run_database_write
from backend.shared.helpers import OrgPermissionError, database, get_active_org, log_audit, log_error, verify_session
from backend.shared.logging_utils import error_response, log_and_error
from backend.shared.paths import IMAGE_DIR
from backend.shared.request_validation import read_json_object


MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
REQUESTS_PER_ORG_PER_DAY = 5
VERIFICATION_ROOT = Path(IMAGE_DIR) / "organization-verification"
_MEDIA = {
    ".pdf": ("application/pdf", (b"%PDF-",)),
    ".jpg": ("image/jpeg", (b"\xff\xd8\xff",)),
    ".jpeg": ("image/jpeg", (b"\xff\xd8\xff",)),
    ".png": ("image/png", (b"\x89PNG\r\n\x1a\n",)),
}
_ID_RE = re.compile(r"^[A-Za-z0-9-]{8,64}$")
_NO_STORE = {"Cache-Control": "private, no-store"}


class VerificationInputError(ValueError):
    """A rejected upload with a user-facing message."""


def _json(payload, status=200):
    return JSONResponse(payload, status_code=status, headers=_NO_STORE)


# ------------------------------------------------------------------ storage

def _storage_key(organization_id, extension):
    scope = hashlib.sha256(str(organization_id).encode("utf-8")).hexdigest()[:24]
    return PurePosixPath(scope, f"{uuid.uuid4().hex}{extension}").as_posix()


def _resolve_storage_key(storage_key):
    candidate = PurePosixPath(str(storage_key or ""))
    if not candidate.parts or candidate.is_absolute() or any(part in {"", ".", ".."} for part in candidate.parts):
        raise VerificationInputError("Khóa lưu trữ không hợp lệ.")
    root = VERIFICATION_ROOT.resolve()
    path = root.joinpath(*candidate.parts).resolve()
    if os.path.commonpath((str(root), str(path))) != str(root):
        raise VerificationInputError("Khóa lưu trữ không hợp lệ.")
    return path


def _persist_document(source_path, storage_key):
    destination = _resolve_storage_key(storage_key)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.tmp")
    digest = hashlib.sha256()
    size = 0
    try:
        with Path(source_path).open("rb") as source, temporary.open("xb") as target:
            while chunk := source.read(1024 * 1024):
                size += len(chunk)
                digest.update(chunk)
                target.write(chunk)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, destination)
        try:
            destination.chmod(0o600)
        except OSError:
            pass
        return size, digest.hexdigest()
    finally:
        temporary.unlink(missing_ok=True)


def _remove_document(storage_key):
    try:
        _resolve_storage_key(storage_key).unlink(missing_ok=True)
    except (OSError, VerificationInputError) as error:
        log_error(error, "organization_verification_remove", level="WARN")


def _document_path(storage_key):
    path = _resolve_storage_key(storage_key)
    return path if path.is_file() else None


def _media_for(filename):
    name = str(filename or "").replace("\\", "/").rsplit("/", 1)[-1].strip()
    if not name or len(name) > 255 or any(ord(character) < 32 for character in name):
        raise VerificationInputError("Tên tệp không hợp lệ.")
    extension = Path(name).suffix.casefold()
    if extension not in _MEDIA:
        raise VerificationInputError("Chỉ nhận tệp PDF, JPG hoặc PNG.")
    content_type, signatures = _MEDIA[extension]
    return name, extension, content_type, signatures


# ------------------------------------------------------------- manager side

def _manager_organization(cursor, request, role):
    organization_id = get_active_org(request, role.user_id, cursor=cursor)
    if not is_business_organization(cursor, organization_id):
        return None, error_response(
            request, "PERSONAL_WORKSPACE_VERIFICATION_FORBIDDEN",
            "Không gian cá nhân không cần xác minh mã số thuế.", status_code=409,
        )
    if not is_organization_manager(cursor, role, role.user_id, organization_id):
        return None, error_response(
            request, "ORGANIZATION_VERIFICATION_FORBIDDEN",
            "Chỉ quản lý tổ chức mới gửi được hồ sơ xác minh.", status_code=403,
        )
    return organization_id, None


def _request_payload(row):
    if not row:
        return None
    return {
        "id": row["id"],
        "status": row["status"],
        "originalFilename": row["original_filename"],
        "note": row["note"] or "",
        "createdAt": int(row["created_at"]),
        "reviewedAt": int(row["reviewed_at"]) if row["reviewed_at"] else None,
        "reviewNote": row["review_note"] or "",
    }


def _verification_status_sync(request, role):
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        organization_id, rejection = _manager_organization(cursor, request, role)
        if rejection:
            return rejection
        organization = cursor.execute(
            """SELECT ten_to_chuc, ma_so_thue, tax_code_status, tax_code_verified_at, tax_code_verification_method
                 FROM to_chuc WHERE id = ?""",
            (organization_id,),
        ).fetchone()
        latest = cursor.execute(
            """SELECT id, status, original_filename, note, created_at, reviewed_at, review_note
                 FROM organization_verification_requests
                WHERE organization_id = ?
                ORDER BY created_at DESC LIMIT 1""",
            (organization_id,),
        ).fetchone()
        tax_code = str(organization["ma_so_thue"] or "")
        verified = str(organization["tax_code_status"] or "") == "verified"
        claimed = bool(tax_code) and not verified and verified_tax_code_holder(
            cursor, tax_code, exclude_organization_id=organization_id,
        ) is not None
        return _json({
            "organizationId": organization_id,
            "organizationName": str(organization["ten_to_chuc"] or ""),
            "taxCode": tax_code,
            "status": "verified" if verified else "unverified",
            "verifiedAt": int(organization["tax_code_verified_at"]) if verified and organization["tax_code_verified_at"] else None,
            "method": organization["tax_code_verification_method"] if verified else None,
            "claimedByVerifiedOrganization": claimed,
            "request": _request_payload(latest),
        })
    except OrgPermissionError as error:
        return error_response(request, error.code, str(error), status_code=error.status_code)
    except Exception as error:  # noqa: BLE001 - bounded public error; logged
        return log_and_error(request, error, "organization_verification_status", "ORGANIZATION_VERIFICATION_FAILED", "Không thể tải trạng thái xác minh.")
    finally:
        connection.close()


async def verification_status_api(request):
    try:
        valid, role = await run_database_read(verify_session, request)
        if not valid:
            return _json({"error": role, "code": "AUTH_REQUIRED"}, 403)
        return await run_database_read(_verification_status_sync, request, role)
    except (BlockingIOBusyError, BlockingIOTimeoutError) as error:
        return database_unavailable_response(request, error)


def _submission_rejection(cursor, request, organization_id, *, lock=False):
    # The early check runs on the read lane; only the commit locks the row.
    organization = cursor.execute(
        "SELECT ma_so_thue, tax_code_status FROM to_chuc WHERE id = ? FOR UPDATE" if lock
        else "SELECT ma_so_thue, tax_code_status FROM to_chuc WHERE id = ?",
        (organization_id,),
    ).fetchone()
    if not organization or not str(organization["ma_so_thue"] or "").strip():
        return error_response(request, "ORGANIZATION_TAX_CODE_MISSING", "Tổ chức chưa có mã số thuế.", status_code=409)
    if str(organization["tax_code_status"] or "") == "verified":
        return error_response(request, "ORGANIZATION_ALREADY_VERIFIED", "Tổ chức đã được xác minh.", status_code=409)
    pending = cursor.execute(
        "SELECT 1 FROM organization_verification_requests WHERE organization_id = ? AND status = 'pending'",
        (organization_id,),
    ).fetchone()
    if pending:
        return error_response(request, "ORGANIZATION_VERIFICATION_PENDING", "Hồ sơ xác minh đang chờ duyệt.", status_code=409)
    return None


def _prepare_submission_sync(request, role):
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        organization_id, rejection = _manager_organization(cursor, request, role)
        if rejection is None:
            rejection = _submission_rejection(cursor, request, organization_id)
        return rejection or organization_id
    except OrgPermissionError as error:
        return error_response(request, error.code, str(error), status_code=error.status_code)
    finally:
        connection.close()


def _commit_submission_sync(request, role, upload):
    connection = database.get_connection()
    try:
        connection.execute("BEGIN")
        cursor = connection.cursor()
        valid, actor = verify_session_in_transaction(cursor, request)
        if not valid or str(actor.user_id) != str(role.user_id):
            connection.rollback()
            return _json({"error": actor if not valid else "Phiên làm việc đã thay đổi."}, 403)
        organization_id, rejection = _manager_organization(cursor, request, actor)
        if rejection is None and organization_id != upload["organization_id"]:
            rejection = error_response(request, "WORKSPACE_CHANGED", "Không gian làm việc đã thay đổi. Vui lòng gửi lại.", status_code=409)
        if rejection is None:
            rejection = _submission_rejection(cursor, request, organization_id, lock=True)
        if rejection is not None:
            connection.rollback()
            return rejection
        limit = get_rate_limit_decision_in_transaction(
            cursor, f"organization_verification:{organization_id}",
            max_attempts=REQUESTS_PER_ORG_PER_DAY, window_seconds=86_400,
        )
        if not limit.allowed:
            connection.rollback()
            return rate_limit_response("Tổ chức đã gửi nhiều hồ sơ xác minh hôm nay. Vui lòng thử lại sau.", limit)
        tax_code = cursor.execute("SELECT ma_so_thue FROM to_chuc WHERE id = ?", (organization_id,)).fetchone()[0]
        request_id = str(uuid.uuid4())
        cursor.execute(
            """INSERT INTO organization_verification_requests
                   (id, organization_id, requested_by, tax_code, status, storage_key,
                    original_filename, content_type, size_bytes, sha256, note, created_at)
               VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)""",
            (request_id, organization_id, actor.user_id, tax_code, upload["storage_key"],
             upload["filename"], upload["content_type"], upload["size"], upload["sha256"],
             upload["note"] or None, int(time.time())),
        )
        log_audit(
            "organization.tax_code_verification_requested", actor_user_id=actor.user_id,
            organization_id=organization_id, target_type="organization_verification_request",
            target_id=request_id, request=request, cursor=cursor, required=True,
            metadata={"contentType": upload["content_type"], "sizeBytes": upload["size"]},
        )
        connection.commit()
        return _json({"success": True, "requestId": request_id, "message": "Đã gửi hồ sơ xác minh. Quản trị viên sẽ xem xét sớm."})
    except OrgPermissionError as error:
        connection.rollback()
        return error_response(request, error.code, str(error), status_code=error.status_code)
    except Exception as error:  # noqa: BLE001 - bounded public error; rolled back and logged
        connection.rollback()
        return log_and_error(request, error, "organization_verification_submit", "ORGANIZATION_VERIFICATION_FAILED", "Không thể gửi hồ sơ xác minh.")
    finally:
        connection.close()


async def _stage_upload(form, organization_id):
    upload = form.get("file")
    if upload is None or not getattr(upload, "filename", None):
        raise VerificationInputError("Vui lòng chọn tệp giấy tờ.")
    filename, extension, content_type, signatures = _media_for(upload.filename)
    note = re.sub(r"\s+", " ", str(form.get("note") or "")).strip()
    if len(note) > 1000:
        raise VerificationInputError("Ghi chú tối đa 1000 ký tự.")
    try:
        async with spooled_upload(upload, max_bytes=MAX_DOCUMENT_BYTES, suffix=extension) as (path, size, head):
            if size <= 0:
                raise VerificationInputError("Tệp tải lên đang trống.")
            if not head.startswith(signatures):
                raise VerificationInputError("Nội dung tệp không khớp định dạng PDF, JPG hoặc PNG.")
            storage_key = _storage_key(organization_id, extension)
            stored_size, digest = await run_blocking_io(_persist_document, path, storage_key, timeout_seconds=15)
    except VerificationInputError:
        raise
    except ValueError as error:
        raise VerificationInputError("Tệp vượt quá giới hạn 10 MB.") from error
    return {
        "organization_id": organization_id, "storage_key": storage_key, "filename": filename,
        "content_type": content_type, "size": stored_size, "sha256": digest, "note": note,
    }


async def submit_verification_api(request):
    try:
        valid, role = await run_database_read(verify_session, request)
        if not valid:
            return _json({"error": role, "code": "AUTH_REQUIRED"}, 403)
        prepared = await run_database_read(_prepare_submission_sync, request, role)
    except (BlockingIOBusyError, BlockingIOTimeoutError) as error:
        return database_unavailable_response(request, error)
    if isinstance(prepared, JSONResponse):
        return prepared
    upload = None
    committed = False
    try:
        upload = await _stage_upload(await request.form(), prepared)
        response = await run_database_write(_commit_submission_sync, request, role, upload)
        committed = response.status_code == 200
        return response
    except VerificationInputError as error:
        return error_response(request, "ORGANIZATION_VERIFICATION_FILE_INVALID", str(error), status_code=400)
    except (BlockingIOBusyError, BlockingIOTimeoutError) as error:
        return database_unavailable_response(request, error)
    finally:
        if upload and not committed:
            await run_blocking_io(_remove_document, upload["storage_key"], timeout_seconds=5)


def _cancel_verification_sync(request, role):
    connection = database.get_connection()
    try:
        connection.execute("BEGIN")
        cursor = connection.cursor()
        valid, actor = verify_session_in_transaction(cursor, request)
        if not valid or str(actor.user_id) != str(role.user_id):
            connection.rollback()
            return _json({"error": actor if not valid else "Phiên làm việc đã thay đổi."}, 403), None
        organization_id, rejection = _manager_organization(cursor, request, actor)
        if rejection:
            connection.rollback()
            return rejection, None
        row = cursor.execute(
            """SELECT id, storage_key FROM organization_verification_requests
                WHERE organization_id = ? AND status = 'pending' FOR UPDATE""",
            (organization_id,),
        ).fetchone()
        if not row:
            connection.rollback()
            return error_response(request, "ORGANIZATION_VERIFICATION_NOT_FOUND", "Không có hồ sơ đang chờ duyệt.", status_code=404), None
        cursor.execute(
            "UPDATE organization_verification_requests SET status = 'cancelled', reviewed_at = ? WHERE id = ?",
            (int(time.time()), row["id"]),
        )
        log_audit(
            "organization.tax_code_verification_cancelled", actor_user_id=actor.user_id,
            organization_id=organization_id, target_type="organization_verification_request",
            target_id=row["id"], request=request, cursor=cursor, required=True,
        )
        connection.commit()
        return _json({"success": True, "message": "Đã hủy hồ sơ xác minh."}), row["storage_key"]
    except OrgPermissionError as error:
        connection.rollback()
        return error_response(request, error.code, str(error), status_code=error.status_code), None
    except Exception as error:  # noqa: BLE001 - bounded public error; rolled back and logged
        connection.rollback()
        return log_and_error(request, error, "organization_verification_cancel", "ORGANIZATION_VERIFICATION_FAILED", "Không thể hủy hồ sơ xác minh."), None
    finally:
        connection.close()


async def cancel_verification_api(request):
    try:
        valid, role = await run_database_read(verify_session, request)
        if not valid:
            return _json({"error": role, "code": "AUTH_REQUIRED"}, 403)
        response, storage_key = await run_database_write(_cancel_verification_sync, request, role)
    except (BlockingIOBusyError, BlockingIOTimeoutError) as error:
        return database_unavailable_response(request, error)
    if storage_key:
        await run_blocking_io(_remove_document, storage_key, timeout_seconds=5)
    return response


# --------------------------------------------------------------- admin side

async def _authorize_admin(request):
    """Super admin only; unsafe methods also need a recent re-authentication."""

    try:
        valid, session = await run_database_read(verify_session, request, "super_admin", timeout_seconds=5)
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return None, _json({"error": "Không thể xác thực quyền quản trị lúc này.", "code": "ADMIN_AUTH_UNAVAILABLE"}, 503)
    if not valid:
        return None, _json({"error": str(session), "code": "SUPER_ADMIN_REQUIRED"}, 403)
    return session, None


def _admin_list_sync(status):
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        rows = cursor.execute(
            """SELECT req.id, req.organization_id, req.tax_code, req.status, req.original_filename,
                      req.content_type, req.size_bytes, req.note, req.created_at, req.reviewed_at,
                      req.review_note, org.ten_to_chuc, org.tax_code_status,
                      requester.email_norm AS requester_email,
                      COALESCE(NULLIF(trim(member.ten_nhan_su), ''), requester.ho_ten, requester.ten_dang_nhap) AS requester_name,
                      holder.id AS holder_id, holder.ten_to_chuc AS holder_name
                 FROM organization_verification_requests AS req
                 JOIN to_chuc AS org ON org.id = req.organization_id
                 JOIN tai_khoan AS requester ON requester.id = req.requested_by
                 LEFT JOIN thanh_vien_to_chuc AS member
                   ON member.user_id = req.requested_by AND member.organization_id = req.organization_id
                 LEFT JOIN to_chuc AS holder
                   ON holder.ma_so_thue = req.tax_code AND holder.tax_code_status = 'verified'
                  AND holder.id <> req.organization_id
                WHERE (req.status = 'pending') = (? = 'pending')
                ORDER BY CASE WHEN ? = 'pending' THEN req.created_at END ASC, req.created_at DESC
                LIMIT 200""",
            (status, status),
        ).fetchall()
        return [{
            "id": row["id"],
            "organizationId": row["organization_id"],
            "organizationName": row["ten_to_chuc"],
            "organizationVerified": str(row["tax_code_status"] or "") == "verified",
            "taxCode": row["tax_code"],
            "status": row["status"],
            "originalFilename": row["original_filename"],
            "contentType": row["content_type"],
            "sizeBytes": int(row["size_bytes"]),
            "note": row["note"] or "",
            "createdAt": int(row["created_at"]),
            "reviewedAt": int(row["reviewed_at"]) if row["reviewed_at"] else None,
            "reviewNote": row["review_note"] or "",
            "requesterName": row["requester_name"] or "",
            "requesterEmail": row["requester_email"] or "",
            "verifiedHolder": {"id": row["holder_id"], "name": row["holder_name"]} if row["holder_id"] else None,
        } for row in rows]
    finally:
        connection.close()


async def admin_list_verifications_api(request):
    _session, rejection = await _authorize_admin(request)
    if rejection:
        return rejection
    status = "pending" if request.query_params.get("status", "pending") == "pending" else "reviewed"
    try:
        items = await run_database_read(_admin_list_sync, status)
    except (BlockingIOBusyError, BlockingIOTimeoutError) as error:
        return database_unavailable_response(request, error)
    return _json({"status": status, "requests": items})


def _admin_document_sync(request, session, request_id):
    connection = database.get_connection()
    try:
        connection.execute("BEGIN")
        cursor = connection.cursor()
        row = cursor.execute(
            """SELECT organization_id, storage_key, original_filename, content_type
                 FROM organization_verification_requests WHERE id = ?""",
            (request_id,),
        ).fetchone()
        path = _document_path(row["storage_key"]) if row else None
        if path is None:
            connection.rollback()
            return None
        log_audit(
            "organization.tax_code_verification_document_viewed", actor_user_id=session.user_id,
            organization_id=row["organization_id"], target_type="organization_verification_request",
            target_id=request_id, request=request, cursor=cursor, required=True,
        )
        connection.commit()
        return str(path), row["original_filename"], row["content_type"]
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


async def admin_verification_document_api(request):
    session, rejection = await _authorize_admin(request)
    if rejection:
        return rejection
    request_id = str(request.path_params.get("request_id") or "")
    if not _ID_RE.fullmatch(request_id):
        return _json({"error": "Không tìm thấy hồ sơ.", "code": "ORGANIZATION_VERIFICATION_NOT_FOUND"}, 404)
    try:
        found = await run_database_write(_admin_document_sync, request, session, request_id)
    except (BlockingIOBusyError, BlockingIOTimeoutError) as error:
        return database_unavailable_response(request, error)
    if found is None:
        return _json({"error": "Không tìm thấy tệp hồ sơ.", "code": "ORGANIZATION_VERIFICATION_NOT_FOUND"}, 404)
    path, filename, content_type = found
    return FileResponse(
        path, media_type=content_type, filename=filename, content_disposition_type="inline",
        headers={**_NO_STORE, "Content-Security-Policy": "sandbox", "X-Content-Type-Options": "nosniff"},
    )


def _approve(cursor, request, session, row, replace_existing, note):
    organization_id = row["organization_id"]
    organization = cursor.execute(
        "SELECT ma_so_thue FROM to_chuc WHERE id = ? FOR UPDATE", (organization_id,),
    ).fetchone()
    if not organization or str(organization["ma_so_thue"] or "") != str(row["tax_code"]):
        return error_response(request, "ORGANIZATION_TAX_CODE_CHANGED", "Mã số thuế của tổ chức đã thay đổi so với hồ sơ.", status_code=409)
    holder = verified_tax_code_holder(cursor, row["tax_code"], exclude_organization_id=organization_id)
    if holder and not replace_existing:
        return _json({
            "error": f"Mã số thuế đang thuộc tổ chức đã xác minh “{holder[1]}”. Xác nhận chuyển quyền để tiếp tục.",
            "code": "TAX_CODE_VERIFIED_ELSEWHERE",
            "holder": {"id": holder[0], "name": holder[1]},
            "details": {"holder": {"id": holder[0], "name": holder[1]}},
        }, 409)
    now = int(time.time())
    if holder:
        cursor.execute(
            """UPDATE to_chuc SET tax_code_status = 'unverified', tax_code_verified_at = NULL,
                      tax_code_verified_by = NULL, tax_code_verification_method = NULL
                WHERE id = ?""",
            (holder[0],),
        )
        log_audit(
            "organization.tax_code_verification_revoked", actor_user_id=session.user_id,
            organization_id=holder[0], target_type="to_chuc", target_id=holder[0], request=request,
            cursor=cursor, required=True, metadata={"replacedBy": organization_id, "requestId": row["id"]},
        )
    cursor.execute(
        """UPDATE to_chuc SET tax_code_status = 'verified', tax_code_verified_at = ?,
                  tax_code_verified_by = ?, tax_code_verification_method = 'document'
            WHERE id = ?""",
        (now, session.user_id, organization_id),
    )
    cursor.execute(
        """UPDATE organization_verification_requests
              SET status = 'approved', reviewed_at = ?, reviewed_by = ?, review_note = ?
            WHERE id = ?""",
        (now, session.user_id, note or None, row["id"]),
    )
    log_audit(
        "organization.tax_code_verified", actor_user_id=session.user_id,
        organization_id=organization_id, target_type="organization_verification_request",
        target_id=row["id"], request=request, cursor=cursor, required=True,
        metadata={"replacedOrganizationId": holder[0] if holder else None},
    )
    return _json({"success": True, "status": "approved", "replacedOrganizationId": holder[0] if holder else None})


def _reject(cursor, request, session, row, note):
    if not note:
        return error_response(request, "REVIEW_NOTE_REQUIRED", "Vui lòng nhập lý do từ chối.", status_code=400)
    cursor.execute(
        """UPDATE organization_verification_requests
              SET status = 'rejected', reviewed_at = ?, reviewed_by = ?, review_note = ?
            WHERE id = ?""",
        (int(time.time()), session.user_id, note, row["id"]),
    )
    log_audit(
        "organization.tax_code_verification_rejected", actor_user_id=session.user_id,
        organization_id=row["organization_id"], target_type="organization_verification_request",
        target_id=row["id"], request=request, cursor=cursor, required=True,
    )
    return _json({"success": True, "status": "rejected"})


def _review_sync(request, request_id, decision, body):
    note = re.sub(r"\s+", " ", str(body.get("note") or "")).strip()
    if len(note) > 1000:
        return error_response(request, "REVIEW_NOTE_TOO_LONG", "Ghi chú tối đa 1000 ký tự.", status_code=400)
    connection = database.get_connection()
    try:
        connection.execute("BEGIN")
        cursor = connection.cursor()
        valid, session = verify_session_in_transaction(cursor, request, "super_admin")
        if not valid:
            connection.rollback()
            return _json({"error": str(session), "code": "SUPER_ADMIN_REQUIRED"}, 403)
        row = cursor.execute(
            """SELECT id, organization_id, tax_code FROM organization_verification_requests
                WHERE id = ? AND status = 'pending' FOR UPDATE""",
            (request_id,),
        ).fetchone()
        if not row:
            connection.rollback()
            return error_response(request, "ORGANIZATION_VERIFICATION_NOT_FOUND", "Hồ sơ không còn chờ duyệt.", status_code=404)
        if decision == "approve":
            response = _approve(cursor, request, session, row, body.get("replaceExisting") is True, note)
        else:
            response = _reject(cursor, request, session, row, note)
        if response.status_code == 200:
            connection.commit()
        else:
            connection.rollback()
        return response
    except Exception as error:  # noqa: BLE001 - bounded public error; rolled back and logged
        connection.rollback()
        return log_and_error(request, error, "organization_verification_review", "ORGANIZATION_VERIFICATION_FAILED", "Không thể xử lý hồ sơ xác minh.")
    finally:
        connection.close()


def _review_api(decision):
    async def handler(request):
        _session, rejection = await _authorize_admin(request)
        if rejection:
            return rejection
        request_id = str(request.path_params.get("request_id") or "")
        if not _ID_RE.fullmatch(request_id):
            return _json({"error": "Không tìm thấy hồ sơ.", "code": "ORGANIZATION_VERIFICATION_NOT_FOUND"}, 404)
        body, json_error = await read_json_object(request)
        if json_error:
            return json_error
        try:
            return await run_database_write(_review_sync, request, request_id, decision, body)
        except (BlockingIOBusyError, BlockingIOTimeoutError) as error:
            return database_unavailable_response(request, error)
    return handler


admin_approve_verification_api = _review_api("approve")
admin_reject_verification_api = _review_api("reject")


def organization_verification_routes(Route):
    return [
        Route("/api/organizations/verification", verification_status_api, methods=["GET"]),
        Route("/api/organizations/verification", submit_verification_api, methods=["POST"]),
        Route("/api/organizations/verification", cancel_verification_api, methods=["DELETE"]),
        Route("/api/admin/organization-verifications", admin_list_verifications_api, methods=["GET"]),
        Route("/api/admin/organization-verifications/{request_id}/document", admin_verification_document_api, methods=["GET"]),
        Route("/api/admin/organization-verifications/{request_id}/approve", admin_approve_verification_api, methods=["POST"]),
        Route("/api/admin/organization-verifications/{request_id}/reject", admin_reject_verification_api, methods=["POST"]),
    ]
