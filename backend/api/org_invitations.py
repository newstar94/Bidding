"""Consent-based organization membership (ADR 0093).

A manager invites an email address; only the owner of that verified email can
accept, after which the regular membership activation runs. No endpoint tells
the manager whether an email has an account or whose it is: the invitation
response is identical either way, and the manager only ever sees the display
name they typed themselves.
"""

from __future__ import annotations

import os
import re
import time
import uuid

from starlette.responses import JSONResponse

from backend.api.org_routes import activate_organization_membership
from backend.auth.auth_helper import verify_session_in_transaction
from backend.auth.auth_service import get_rate_limit_decision_in_transaction, rate_limit_response
from backend.auth.email_delivery_service import create_email_delivery, deliver_email_once
from backend.auth.identity import normalize_email
from backend.db.db_helper import IntegrityError
from backend.db.id_utils import generate_record_id
from backend.sync.repository import next_sync_version
from backend.shared.access_policy import is_business_organization, is_organization_manager
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError
from backend.shared.database_http import database_unavailable_response
from backend.shared.database_io import run_database_read, run_database_write
from backend.shared.email_templates import render_branded_email
from backend.shared.helpers import (
    OrgPermissionError,
    database,
    get_active_org,
    log_audit,
    verify_session,
)
from backend.shared.logging_utils import error_response, log_and_error
from backend.shared.membership_invariants import lock_organization_membership_invariants
from backend.shared.request_validation import read_json_object, validate_or_response
from starlette.background import BackgroundTasks


INVITATION_TTL_SECONDS = max(
    3600, int(os.environ.get("ORGANIZATION_INVITATION_TTL_HOURS", "168")) * 3600
)
INVITATIONS_PER_ORG_PER_DAY = max(
    1, int(os.environ.get("ORGANIZATION_INVITATIONS_PER_DAY", "50"))
)
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_ID_RE = re.compile(r"^[A-Za-z0-9-]{8,64}$")
_GENERIC_SENT = "Đã gửi lời mời. Người được mời cần đăng nhập bằng đúng email này và chấp nhận để vào tổ chức."


def _json(payload, status=200):
    return JSONResponse(payload, status_code=status, headers={"Cache-Control": "private, no-store"})


def _invitation_email(*, organization_name, inviter_name, employee_name):
    public_url = os.environ.get("APP_PUBLIC_URL", "http://127.0.0.1:8000").rstrip("/")
    subject = f"[BiddingFlow] Lời mời tham gia {organization_name}"
    body = render_branded_email(
        title="Bạn được mời tham gia tổ chức",
        preheader=f"{inviter_name} mời bạn tham gia {organization_name} trên BiddingFlow.",
        eyebrow="LỜI MỜI THAM GIA",
        recipient_name=employee_name or "bạn",
        lead=f"{inviter_name} mời bạn tham gia tổ chức {organization_name} trên BiddingFlow.",
        details=(("Tổ chức", organization_name), ("Người mời", inviter_name)),
        paragraphs=(
            "Đăng nhập (hoặc đăng ký) bằng chính địa chỉ email này, sau đó chấp nhận lời mời trong ứng dụng.",
        ),
        action_label="Mở BiddingFlow",
        action_url=f"{public_url}/tong-quan?loi-moi=1",
        notice="Nếu bạn không biết tổ chức này, hãy bỏ qua email; bạn sẽ không được thêm vào tổ chức khi chưa chấp nhận.",
        notice_tone="warning",
    )
    return subject, body


# ------------------------------------------------------------- manager side

def _manager_context(cursor, request, role):
    organization_id = get_active_org(request, role.user_id, cursor=cursor)
    if not is_business_organization(cursor, organization_id):
        return None, error_response(
            request, "PERSONAL_WORKSPACE_MEMBERSHIP_FORBIDDEN",
            "Không thể mời thành viên vào không gian cá nhân.", status_code=409,
        )
    if not is_organization_manager(cursor, role, role.user_id, organization_id):
        return None, error_response(
            request, "ORGANIZATION_INVITATION_FORBIDDEN",
            "Bạn không có quyền mời nhân sự vào tổ chức.", status_code=403,
        )
    return organization_id, None


def _create_invitation_sync(request, role, data):
    invalid = validate_or_response(request, data, {
        "email": {"type": "string", "required": True, "min_length": 3, "max_length": 320},
        "employee_name": {"type": "string", "required": True, "min_length": 1, "max_length": 200},
        "phone": {"type": "string", "max_length": 32},
    })
    if invalid:
        return invalid, None
    email = normalize_email(data.get("email"))
    employee_name = re.sub(r"\s+", " ", str(data.get("employee_name") or "").strip())
    phone = str(data.get("phone") or "").strip() or None
    if not email or len(email) > 254 or not _EMAIL_RE.fullmatch(email):
        return error_response(request, "INVITATION_EMAIL_INVALID", "Địa chỉ email không hợp lệ.", status_code=400), None
    if not employee_name:
        return error_response(request, "INVITATION_NAME_REQUIRED", "Vui lòng nhập tên hiển thị của nhân sự.", status_code=400), None

    connection = database.get_connection()
    try:
        connection.execute("BEGIN")
        cursor = connection.cursor()
        valid, actor = verify_session_in_transaction(cursor, request)
        if not valid or str(actor.user_id) != str(role.user_id):
            connection.rollback()
            return _json({"error": actor if not valid else "Phiên làm việc đã thay đổi."}, 403), None
        organization_id, rejection = _manager_context(cursor, request, actor)
        if rejection:
            connection.rollback()
            return rejection, None
        limit = get_rate_limit_decision_in_transaction(
            cursor, f"org_invitation:{organization_id}",
            max_attempts=INVITATIONS_PER_ORG_PER_DAY, window_seconds=86_400,
        )
        if not limit.allowed:
            connection.rollback()
            return rate_limit_response("Tổ chức đã gửi quá nhiều lời mời hôm nay. Vui lòng thử lại sau.", limit), None
        # Expired invitations stay 'pending' and are reported as expired from
        # expires_at; re-inviting the same email renews that row below.
        now = int(time.time())
        organization = cursor.execute(
            "SELECT ten_to_chuc FROM to_chuc WHERE id = ?", (organization_id,)
        ).fetchone()
        inviter = cursor.execute(
            """SELECT COALESCE(NULLIF(trim(tv.ten_nhan_su), ''), tk.ho_ten, tk.ten_dang_nhap) AS name
                 FROM tai_khoan AS tk
                 LEFT JOIN thanh_vien_to_chuc AS tv
                   ON tv.user_id = tk.id AND tv.organization_id = ?
                WHERE tk.id = ?""",
            (organization_id, actor.user_id),
        ).fetchone()
        existing = cursor.execute(
            """SELECT id FROM organization_invitations
                WHERE organization_id = ? AND email_norm = ? AND status = 'pending'
                FOR UPDATE""",
            (organization_id, email),
        ).fetchone()
        if existing:
            invitation_id = existing["id"]
            cursor.execute(
                """UPDATE organization_invitations
                      SET employee_name = ?, phone = ?, invited_by = ?, created_at = ?, expires_at = ?
                    WHERE id = ?""",
                (employee_name, phone, actor.user_id, now, now + INVITATION_TTL_SECONDS, invitation_id),
            )
        else:
            invitation_id = str(uuid.uuid4())
            cursor.execute(
                """INSERT INTO organization_invitations
                       (id, organization_id, email_norm, employee_name, phone, invited_by,
                        status, created_at, expires_at)
                   VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)""",
                (invitation_id, organization_id, email, employee_name, phone, actor.user_id,
                 now, now + INVITATION_TTL_SECONDS),
            )
        subject, body = _invitation_email(
            organization_name=str(organization[0] if organization else ""),
            inviter_name=str(inviter[0] if inviter else "Quản lý tổ chức"),
            employee_name=employee_name,
        )
        delivery_id = None
        if str(os.environ.get("EMAIL_OUTBOX_ENCRYPTION_KEY", "")).strip():
            delivery_id = create_email_delivery(
                cursor,
                user_id=actor.user_id,
                purpose="user_notification",
                recipient=email,
                subject=subject,
                html_body=body,
                sensitive_content=False,
            )
        log_audit(
            "organization.invitation_sent",
            actor_user_id=actor.user_id,
            organization_id=organization_id,
            target_type="organization_invitation",
            target_id=invitation_id,
            request=request,
            metadata={"resent": bool(existing)},
            cursor=cursor,
            required=True,
        )
        connection.commit()
        return _json({"success": True, "message": _GENERIC_SENT, "invitationId": invitation_id}), delivery_id
    except OrgPermissionError as error:
        connection.rollback()
        return error_response(request, error.code, str(error), status_code=error.status_code), None
    except IntegrityError:
        connection.rollback()
        return error_response(request, "INVITATION_CONFLICT", "Lời mời vừa được cập nhật. Vui lòng thử lại.", status_code=409), None
    except Exception as error:  # noqa: BLE001 - bounded public error; rolled back and logged
        connection.rollback()
        return log_and_error(request, error, "create_invitation", "INVITATION_CREATE_FAILED", "Không thể gửi lời mời."), None
    finally:
        connection.close()


async def create_invitation_api(request):
    try:
        valid, role = await run_database_read(verify_session, request)
    except (BlockingIOBusyError, BlockingIOTimeoutError) as error:
        return database_unavailable_response(request, error)
    if not valid:
        return _json({"error": role, "code": "AUTH_REQUIRED"}, 403)
    data, json_error = await read_json_object(request)
    if json_error:
        return json_error
    try:
        response, delivery_id = await run_database_write(_create_invitation_sync, request, role, data)
    except (BlockingIOBusyError, BlockingIOTimeoutError) as error:
        return database_unavailable_response(request, error)
    if delivery_id:
        tasks = BackgroundTasks()
        tasks.add_task(deliver_email_once, database, delivery_id)
        response.background = tasks
    return response


def _list_organization_invitations_sync(request, role):
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        organization_id, rejection = _manager_context(cursor, request, role)
        if rejection:
            return rejection
        now = int(time.time())
        rows = cursor.execute(
            """SELECT id, email_norm, employee_name, phone, status, created_at, expires_at, responded_at
                 FROM organization_invitations
                WHERE organization_id = ?
                ORDER BY created_at DESC
                LIMIT 200""",
            (organization_id,),
        ).fetchall()
        return _json({"invitations": [{
            "id": row["id"],
            "email": row["email_norm"],
            "employeeName": row["employee_name"],
            "phone": row["phone"] or "",
            "status": "expired" if row["status"] == "pending" and int(row["expires_at"]) <= now else row["status"],
            "createdAt": int(row["created_at"]),
            "expiresAt": int(row["expires_at"]),
            "respondedAt": int(row["responded_at"]) if row["responded_at"] else None,
        } for row in rows]})
    except OrgPermissionError as error:
        return error_response(request, error.code, str(error), status_code=error.status_code)
    except Exception as error:  # noqa: BLE001 - bounded public error; rolled back and logged
        return log_and_error(request, error, "list_invitations", "INVITATION_LIST_FAILED", "Không thể tải danh sách lời mời.")
    finally:
        connection.close()


async def list_organization_invitations_api(request):
    try:
        valid, role = await run_database_read(verify_session, request)
        if not valid:
            return _json({"error": role, "code": "AUTH_REQUIRED"}, 403)
        return await run_database_read(_list_organization_invitations_sync, request, role)
    except (BlockingIOBusyError, BlockingIOTimeoutError) as error:
        return database_unavailable_response(request, error)


def _revoke_invitation_sync(request, role, invitation_id):
    connection = database.get_connection()
    try:
        connection.execute("BEGIN")
        cursor = connection.cursor()
        valid, actor = verify_session_in_transaction(cursor, request)
        if not valid or str(actor.user_id) != str(role.user_id):
            connection.rollback()
            return _json({"error": actor if not valid else "Phiên làm việc đã thay đổi."}, 403)
        organization_id, rejection = _manager_context(cursor, request, actor)
        if rejection:
            connection.rollback()
            return rejection
        updated = cursor.execute(
            """UPDATE organization_invitations SET status = 'revoked', responded_at = ?
                WHERE id = ? AND organization_id = ? AND status = 'pending'""",
            (int(time.time()), invitation_id, organization_id),
        )
        if updated.rowcount != 1:
            connection.rollback()
            return error_response(request, "INVITATION_NOT_FOUND", "Không tìm thấy lời mời đang chờ.", status_code=404)
        log_audit(
            "organization.invitation_revoked",
            actor_user_id=actor.user_id,
            organization_id=organization_id,
            target_type="organization_invitation",
            target_id=invitation_id,
            request=request,
            cursor=cursor,
            required=True,
        )
        connection.commit()
        return _json({"success": True})
    except OrgPermissionError as error:
        connection.rollback()
        return error_response(request, error.code, str(error), status_code=error.status_code)
    except Exception as error:  # noqa: BLE001 - bounded public error; rolled back and logged
        connection.rollback()
        return log_and_error(request, error, "revoke_invitation", "INVITATION_REVOKE_FAILED", "Không thể thu hồi lời mời.")
    finally:
        connection.close()


async def revoke_invitation_api(request):
    invitation_id = str(request.path_params.get("invitation_id") or "")
    if not _ID_RE.fullmatch(invitation_id):
        return error_response(request, "INVITATION_NOT_FOUND", "Không tìm thấy lời mời.", status_code=404)
    try:
        valid, role = await run_database_read(verify_session, request)
        if not valid:
            return _json({"error": role, "code": "AUTH_REQUIRED"}, 403)
        return await run_database_write(_revoke_invitation_sync, request, role, invitation_id)
    except (BlockingIOBusyError, BlockingIOTimeoutError) as error:
        return database_unavailable_response(request, error)


# Same defaults the manager's browser writes after a direct add today
# (AdminUserController): view on six modules, opening module unset.
DEFAULT_MEMBER_PERMISSIONS = {
    "kehoach": "view",
    "goithau": "view",
    "hopdong": "view",
    "chudautu": "view",
    "nhathau": "view",
    "chuyengia": "view",
}


def ensure_default_member_permissions(cursor, organization_id, user_id):
    existing = cursor.execute(
        "SELECT 1 FROM ma_tran_phan_quyen WHERE organization_id = ? AND emp_id = ?",
        (organization_id, user_id),
    ).fetchone()
    if existing:
        return False
    columns = ", ".join(DEFAULT_MEMBER_PERMISSIONS)
    placeholders = ", ".join("?" for _ in DEFAULT_MEMBER_PERMISSIONS)
    cursor.execute(
        f"""INSERT INTO ma_tran_phan_quyen
               (id, organization_id, owner_type, emp_id, {columns}, sync_version)
            VALUES (?, ?, 'organization', ?, {placeholders}, ?)""",  # noqa: S608 - fixed column registry
        (
            generate_record_id("permissionmatrix"),
            organization_id,
            user_id,
            *DEFAULT_MEMBER_PERMISSIONS.values(),
            next_sync_version(cursor, organization_id),
        ),
    )
    return True


# ------------------------------------------------------------- invitee side

def _verified_email(cursor, user_id):
    row = cursor.execute(
        "SELECT email_norm, da_xac_minh, trang_thai, vai_tro FROM tai_khoan WHERE id = ?",
        (user_id,),
    ).fetchone()
    if not row or not row["da_xac_minh"] or str(row["trang_thai"] or "") != "active":
        return None, None
    return str(row["email_norm"] or ""), str(row["vai_tro"] or "")


def _my_invitations_sync(request, role):
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        email, _platform_role = _verified_email(cursor, role.user_id)
        if not email:
            return _json({"invitations": []})
        rows = cursor.execute(
            """SELECT inv.id, inv.organization_id, inv.employee_name, inv.created_at, inv.expires_at,
                      org.ten_to_chuc AS organization_name, org.tax_code_status,
                      COALESCE(NULLIF(trim(tv.ten_nhan_su), ''), tk.ho_ten, tk.ten_dang_nhap) AS inviter_name
                 FROM organization_invitations AS inv
                 JOIN to_chuc AS org ON org.id = inv.organization_id AND org.trang_thai = 'active'
                 JOIN tai_khoan AS tk ON tk.id = inv.invited_by
                 LEFT JOIN thanh_vien_to_chuc AS tv
                   ON tv.user_id = inv.invited_by AND tv.organization_id = inv.organization_id
                WHERE inv.email_norm = ? AND inv.status = 'pending' AND inv.expires_at > ?
                  AND NOT EXISTS (
                      SELECT 1 FROM thanh_vien_to_chuc AS member
                       WHERE member.user_id = ? AND member.organization_id = inv.organization_id
                         AND COALESCE(member.trang_thai_thanh_vien, 'active') = 'active')
                ORDER BY inv.created_at DESC""",
            (email, int(time.time()), role.user_id),
        ).fetchall()
        return _json({"invitations": [{
            "id": row["id"],
            "organizationId": row["organization_id"],
            "organizationName": row["organization_name"],
            "organizationVerified": str(row["tax_code_status"] or "") == "verified",
            "inviterName": row["inviter_name"] or "",
            "employeeName": row["employee_name"],
            "createdAt": int(row["created_at"]),
            "expiresAt": int(row["expires_at"]),
        } for row in rows]})
    except Exception as error:  # noqa: BLE001 - bounded public error; rolled back and logged
        return log_and_error(request, error, "my_invitations", "INVITATION_LIST_FAILED", "Không thể tải lời mời.")
    finally:
        connection.close()


async def my_invitations_api(request):
    try:
        valid, role = await run_database_read(verify_session, request)
        if not valid:
            return _json({"error": role, "code": "AUTH_REQUIRED"}, 403)
        return await run_database_read(_my_invitations_sync, request, role)
    except (BlockingIOBusyError, BlockingIOTimeoutError) as error:
        return database_unavailable_response(request, error)


def _respond_invitation_sync(request, role, invitation_id, accept):
    connection = database.get_connection()
    try:
        connection.execute("BEGIN")
        cursor = connection.cursor()
        valid, actor = verify_session_in_transaction(cursor, request)
        if not valid or str(actor.user_id) != str(role.user_id):
            connection.rollback()
            return _json({"error": actor if not valid else "Phiên làm việc đã thay đổi."}, 403)
        email, platform_role = _verified_email(cursor, actor.user_id)
        invitation = cursor.execute(
            """SELECT * FROM organization_invitations
                WHERE id = ? AND status = 'pending' FOR UPDATE""",
            (invitation_id,),
        ).fetchone()
        now = int(time.time())
        if (
            not email or invitation is None
            or str(invitation["email_norm"]) != email
            or int(invitation["expires_at"]) <= now
        ):
            connection.rollback()
            return error_response(request, "INVITATION_NOT_FOUND", "Lời mời không còn hiệu lực.", status_code=404)
        organization_id = str(invitation["organization_id"])
        if not accept:
            cursor.execute(
                "UPDATE organization_invitations SET status = 'declined', responded_at = ? WHERE id = ?",
                (now, invitation_id),
            )
            log_audit(
                "organization.invitation_declined", actor_user_id=actor.user_id,
                organization_id=organization_id, target_type="organization_invitation",
                target_id=invitation_id, request=request, cursor=cursor, required=True,
            )
            connection.commit()
            return _json({"success": True, "message": "Đã từ chối lời mời."})
        if platform_role == "super_admin":
            connection.rollback()
            return error_response(
                request, "INVITATION_PLATFORM_ADMIN_FORBIDDEN",
                "Tài khoản quản trị nền tảng không tham gia tổ chức qua lời mời.", status_code=403,
            )
        lock_organization_membership_invariants(cursor, organization_id)
        organization = cursor.execute(
            "SELECT trang_thai FROM to_chuc WHERE id = ? FOR UPDATE", (organization_id,)
        ).fetchone()
        if not organization or str(organization["trang_thai"]) != "active":
            connection.rollback()
            return error_response(request, "ORGANIZATION_INACTIVE", "Tổ chức không còn hoạt động.", status_code=409)
        inviter_still_manager = cursor.execute(
            """SELECT 1 FROM tai_khoan AS tk
                 LEFT JOIN thanh_vien_to_chuc AS tv
                   ON tv.user_id = tk.id AND tv.organization_id = ?
                WHERE tk.id = ? AND tk.trang_thai = 'active'
                  AND (tk.vai_tro = 'super_admin'
                       OR (tv.vai_tro_trong_to_chuc = 'manager'
                           AND COALESCE(tv.trang_thai_thanh_vien, 'active') = 'active'))""",
            (organization_id, invitation["invited_by"]),
        ).fetchone()
        if not inviter_still_manager:
            # The invitation carries the inviter's authority; it ends with it.
            cursor.execute(
                "UPDATE organization_invitations SET status = 'revoked', responded_at = ? WHERE id = ?",
                (now, invitation_id),
            )
            log_audit(
                "organization.invitation_revoked", actor_user_id=actor.user_id,
                organization_id=organization_id, target_type="organization_invitation",
                target_id=invitation_id, request=request, cursor=cursor, required=True,
                metadata={"reason": "inviter_no_longer_manager"},
            )
            connection.commit()
            return error_response(request, "INVITATION_NOT_FOUND", "Lời mời không còn hiệu lực.", status_code=404)
        membership = cursor.execute(
            """SELECT COALESCE(trang_thai_thanh_vien, 'active') AS status
                 FROM thanh_vien_to_chuc WHERE user_id = ? AND organization_id = ?""",
            (actor.user_id, organization_id),
        ).fetchone()
        if membership and membership["status"] == "active":
            message = "Bạn đã là thành viên của tổ chức này."
        else:
            error, message = activate_organization_membership(
                cursor,
                request,
                actor_user_id=str(invitation["invited_by"]),
                org_id=organization_id,
                user_id=actor.user_id,
                employee_name=str(invitation["employee_name"]),
                phone=str(invitation["phone"] or ""),
                reactivate=bool(membership),
            )
            if error is not None:
                connection.rollback()
                return error
            ensure_default_member_permissions(cursor, organization_id, actor.user_id)
            message = "Bạn đã tham gia tổ chức."
        cursor.execute(
            """UPDATE organization_invitations
                  SET status = 'accepted', responded_at = ?, accepted_user_id = ?
                WHERE id = ?""",
            (now, actor.user_id, invitation_id),
        )
        log_audit(
            "organization.invitation_accepted", actor_user_id=actor.user_id,
            organization_id=organization_id, target_type="organization_invitation",
            target_id=invitation_id, request=request, cursor=cursor, required=True,
        )
        connection.commit()
        return _json({"success": True, "message": message, "organizationId": organization_id})
    except Exception as error:  # noqa: BLE001 - bounded public error; rolled back and logged
        connection.rollback()
        return log_and_error(request, error, "respond_invitation", "INVITATION_RESPONSE_FAILED", "Không thể xử lý lời mời.")
    finally:
        connection.close()


def _respond_api(accept):
    async def handler(request):
        invitation_id = str(request.path_params.get("invitation_id") or "")
        if not _ID_RE.fullmatch(invitation_id):
            return error_response(request, "INVITATION_NOT_FOUND", "Không tìm thấy lời mời.", status_code=404)
        try:
            valid, role = await run_database_read(verify_session, request)
            if not valid:
                return _json({"error": role, "code": "AUTH_REQUIRED"}, 403)
            return await run_database_write(_respond_invitation_sync, request, role, invitation_id, accept)
        except (BlockingIOBusyError, BlockingIOTimeoutError) as error:
            return database_unavailable_response(request, error)
    return handler


accept_invitation_api = _respond_api(True)
decline_invitation_api = _respond_api(False)


def organization_invitation_routes(Route):
    return [
        Route("/api/organizations/invitations", list_organization_invitations_api, methods=["GET"]),
        Route("/api/organizations/invitations", create_invitation_api, methods=["POST"]),
        Route("/api/organizations/invitations/{invitation_id}", revoke_invitation_api, methods=["DELETE"]),
        Route("/api/invitations", my_invitations_api, methods=["GET"]),
        Route("/api/invitations/{invitation_id}/accept", accept_invitation_api, methods=["POST"]),
        Route("/api/invitations/{invitation_id}/decline", decline_invitation_api, methods=["POST"]),
    ]
