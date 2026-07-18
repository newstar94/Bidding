import json
import re
import time
from starlette.responses import JSONResponse

from backend.db.errors import INTEGRITY_ERRORS

from backend.shared.helpers import (
    database,
    verify_session,
    get_effective_roles,
    get_active_org,
    _session_cache_invalidate_by_user_id,
    _org_cache_invalidate_by_user_id,
    log_audit,
    OrgPermissionError
)
from backend.sync.api import broadcast_websocket_event, disconnect_user_websockets
from backend.sync.repository import DELETED_RECORD_UPSERT_SQL, next_sync_version
from backend.shared.access_policy import (
    is_business_organization,
    is_organization_manager,
    is_personal_workspace_owner,
    resolve_document_export_capabilities,
)
from backend.shared.logging_utils import error_response, log_and_error
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError
from backend.shared.database_io import run_database_read, run_database_write
from backend.shared.request_validation import read_json_object, validate_or_response
from backend.shared.date_utils import utc_now_sql
from backend.auth.auth_service import activate_personal_subscription, build_user_access_payload


_IDEMPOTENCY_KEY_RE = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")


def _activate_personal_subscription_sync(
    request,
    actor_user_id,
    user_id,
    package_id,
    duration_days,
):
    conn = None
    try:
        conn = database.get_connection()
        conn.execute("BEGIN IMMEDIATE")
        cursor = conn.cursor()
        user = cursor.execute(
            "SELECT ho_ten, vai_tro FROM tai_khoan WHERE id = ?",
            (user_id,),
        ).fetchone()
        if not user:
            conn.rollback()
            return JSONResponse({"error": "Người dùng không tồn tại.", "code": "USER_NOT_FOUND"}, status_code=404)
        try:
            organization_id = activate_personal_subscription(
                cursor, user_id, user[0], package_id, duration_days
            )
        except ValueError as exc:
            conn.rollback()
            code = exc.args[0] if exc.args else "PERSONAL_SUBSCRIPTION_INVALID"
            message = "Gói dịch vụ không hoạt động." if code == "PACKAGE_INACTIVE" else "Tài khoản đã thuộc một tổ chức."
            return JSONResponse({"error": message, "code": code}, status_code=409)
        log_audit(
            "personal_subscription.activated",
            actor_user_id=actor_user_id,
            organization_id=organization_id,
            target_type="tai_khoan",
            target_id=user_id,
            request=request,
            metadata={"package_id": package_id, "duration_days": duration_days},
            cursor=cursor,
            required=True,
        )
        access = build_user_access_payload(cursor, user_id, user[1], organization_id)
        conn.commit()
        _session_cache_invalidate_by_user_id(user_id)
        _org_cache_invalidate_by_user_id(user_id)
        return JSONResponse({"success": True, "user": access})
    except Exception as exc:
        if conn:
            conn.rollback()
        return log_and_error(request, exc, "activate_personal_subscription_api", "PERSONAL_SUBSCRIPTION_FAILED", "Không thể kích hoạt gói cá nhân.")
    finally:
        if conn:
            conn.close()


async def activate_personal_subscription_api(request):
    """Grant a package to an account without blocking the event loop on its transaction."""
    is_valid, role_or_err = verify_session(request, required_role='super_admin')
    if not is_valid:
        return JSONResponse({"error": role_or_err}, status_code=403)
    data, json_error = await read_json_object(request)
    if json_error:
        return json_error
    invalid = validate_or_response(request, data, {
        "user_id": {"type": "string", "required": True, "min_length": 1, "max_length": 128},
        "package_id": {"type": "string", "required": True, "min_length": 1, "max_length": 128},
        "duration_days": {"type": "integer", "min": 1, "max": 3650},
    })
    if invalid:
        return invalid
    try:
        return await run_database_write(
            _activate_personal_subscription_sync,
            request,
            role_or_err.user_id,
            str(data.get("user_id") or "").strip(),
            str(data.get("package_id") or "").strip(),
            data.get("duration_days", 365),
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        response = error_response(
            request,
            "DATABASE_WRITE_QUEUE_FULL",
            "Hệ thống đang xử lý nhiều yêu cầu dữ liệu. Vui lòng thử lại sau.",
            status_code=503,
        )
        response.headers["Retry-After"] = "1"
        return response


def _subscription_payload(cursor, organization_id):
    row = cursor.execute(
        """
        SELECT sub.organization_id, sub.package_id, sub.status, sub.starts_at,
               sub.expires_at, sub.member_quota, sub.revision,
               (SELECT count(*) FROM thanh_vien_to_chuc members
                WHERE members.organization_id = sub.organization_id) AS member_count
        FROM organization_subscriptions sub
        WHERE sub.organization_id = ?
        """,
        (organization_id,),
    ).fetchone()
    if not row:
        return None
    result = dict(row)
    result["start_date"] = time.strftime('%Y-%m-%d', time.gmtime(result["starts_at"]))
    result["end_date"] = (
        time.strftime('%Y-%m-%d', time.gmtime(result["expires_at"]))
        if result["expires_at"] is not None else None
    )
    return result


def _update_organization_subscription_sync(request, data, idempotency_key):
    """Lock, unlock, renew or change an organization subscription atomically."""
    conn = None
    try:
        is_valid, role_or_err = verify_session(request, required_role='super_admin')
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        organization_id = str(data.get("organization_id") or "").strip()
        action = str(data.get("action") or "").strip().lower()
        if not organization_id or action not in {"lock", "unlock", "renew", "set_package"}:
            return JSONResponse(
                {"error": "Yêu cầu cập nhật gói dịch vụ không hợp lệ.", "code": "INVALID_SUBSCRIPTION_UPDATE"},
                status_code=400,
            )
        if not _IDEMPOTENCY_KEY_RE.fullmatch(idempotency_key):
            return JSONResponse(
                {"error": "Thiếu Idempotency-Key hợp lệ.", "code": "INVALID_IDEMPOTENCY_KEY"},
                status_code=400,
            )

        operation = f"organization_subscription:{organization_id}:{action}"
        conn = database.get_connection()
        conn.execute("BEGIN IMMEDIATE")
        cursor = conn.cursor()
        replay = cursor.execute(
            """
            SELECT response_json FROM api_idempotency
            WHERE actor_user_id = ? AND operation = ? AND idempotency_key = ?
            """,
            (role_or_err.user_id, operation, idempotency_key),
        ).fetchone()
        if replay:
            conn.commit()
            return JSONResponse(json.loads(replay[0]))

        current = _subscription_payload(cursor, organization_id)
        if not current:
            conn.rollback()
            return JSONResponse(
                {"error": "Không tìm thấy gói dịch vụ của tổ chức.", "code": "ORG_SUBSCRIPTION_NOT_FOUND"},
                status_code=404,
            )

        now = int(time.time())
        changed = False
        if action == "lock":
            changed = current["status"] != "suspended"
            cursor.execute("UPDATE to_chuc SET trang_thai = 'suspended', updated_at = datetime('now') WHERE id = ?", (organization_id,))
            cursor.execute(
                """UPDATE organization_subscriptions
                   SET status = 'suspended', revision = revision + ?, updated_at = datetime('now')
                   WHERE organization_id = ?""",
                (1 if changed else 0, organization_id),
            )
        elif action == "unlock":
            package = cursor.execute(
                "SELECT trang_thai FROM goi_dich_vu WHERE id = ?",
                (current["package_id"],),
            ).fetchone()
            if current["expires_at"] is not None and int(current["expires_at"]) <= now:
                conn.rollback()
                return JSONResponse(
                    {"error": "Gói đã hết hạn; cần gia hạn trước khi mở khóa.", "code": "ORG_SUBSCRIPTION_EXPIRED"},
                    status_code=409,
                )
            if not package or package[0] != 'active':
                conn.rollback()
                return JSONResponse(
                    {"error": "Loại gói dịch vụ đang bị khóa.", "code": "PACKAGE_INACTIVE"},
                    status_code=409,
                )
            changed = current["status"] != "active"
            cursor.execute("UPDATE to_chuc SET trang_thai = 'active', updated_at = datetime('now') WHERE id = ?", (organization_id,))
            cursor.execute(
                """UPDATE organization_subscriptions
                   SET status = 'active', revision = revision + ?, updated_at = datetime('now')
                   WHERE organization_id = ?""",
                (1 if changed else 0, organization_id),
            )
        elif action == "renew":
            duration_days = data.get("duration_days", 365)
            if not isinstance(duration_days, int) or isinstance(duration_days, bool) or not 1 <= duration_days <= 3650:
                conn.rollback()
                return JSONResponse(
                    {"error": "Số ngày gia hạn phải từ 1 đến 3650.", "code": "INVALID_RENEWAL_DURATION"},
                    status_code=400,
                )
            base = max(now, int(current["expires_at"] or now))
            cursor.execute("UPDATE to_chuc SET trang_thai = 'active', updated_at = datetime('now') WHERE id = ?", (organization_id,))
            cursor.execute(
                """UPDATE organization_subscriptions
                   SET status = 'active', expires_at = ?, revision = revision + 1,
                       updated_at = datetime('now')
                   WHERE organization_id = ?""",
                (base + duration_days * 24 * 60 * 60, organization_id),
            )
            changed = True
        else:
            package_id = str(data.get("package_id") or "").strip()
            package = cursor.execute(
                "SELECT han_muc_nhan_su FROM goi_dich_vu WHERE id = ? AND trang_thai = 'active'",
                (package_id,),
            ).fetchone()
            if not package:
                conn.rollback()
                return JSONResponse(
                    {"error": "Gói dịch vụ không hợp lệ hoặc đang bị khóa.", "code": "PACKAGE_INACTIVE"},
                    status_code=400,
                )
            changed = current["package_id"] != package_id or current["member_quota"] != int(package[0])
            cursor.execute(
                """UPDATE organization_subscriptions
                   SET package_id = ?, member_quota = ?, revision = revision + ?,
                       updated_at = datetime('now')
                   WHERE organization_id = ?""",
                (package_id, int(package[0]), 1 if changed else 0, organization_id),
            )

        subscription = _subscription_payload(cursor, organization_id)
        response_payload = {"success": True, "changed": changed, "subscription": subscription}
        cursor.execute(
            """
            INSERT INTO api_idempotency (
                actor_user_id, operation, idempotency_key, response_json, created_at
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (
                role_or_err.user_id,
                operation,
                idempotency_key,
                json.dumps(response_payload, ensure_ascii=False),
                now,
            ),
        )
        member_ids = [row[0] for row in cursor.execute(
            "SELECT user_id FROM thanh_vien_to_chuc WHERE organization_id = ?",
            (organization_id,),
        ).fetchall()]
        log_audit(
            f"organization.subscription_{action}",
            actor_user_id=role_or_err.user_id,
            organization_id=organization_id,
            target_type="organization_subscription",
            target_id=organization_id,
            request=request,
            metadata={"changed": changed, "subscription": subscription},
            cursor=cursor,
            required=True,
        )
        conn.commit()

        for user_id in member_ids:
            _session_cache_invalidate_by_user_id(user_id)
            _org_cache_invalidate_by_user_id(user_id)
            if action == 'lock':
                disconnect_user_websockets(user_id)
        broadcast_websocket_event(organization_id, {"event": "organization_subscription_changed"})
        return JSONResponse(response_payload)
    except Exception as exc:
        if conn:
            conn.rollback()
        return log_and_error(
            request,
            exc,
            "update_organization_subscription_api",
            "ORG_SUBSCRIPTION_UPDATE_FAILED",
            "Không thể cập nhật gói dịch vụ của tổ chức.",
        )
    finally:
        if conn:
            conn.close()


async def update_organization_subscription_api(request):
    """Lock, unlock, renew or change a subscription through the DB write lane."""
    try:
        is_valid, role_or_err = await run_database_read(
            verify_session,
            request,
            required_role='super_admin',
            timeout_seconds=10.0,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        response = error_response(
            request,
            "DATABASE_READ_QUEUE_FULL",
            "Hệ thống đang xử lý nhiều yêu cầu dữ liệu. Vui lòng thử lại sau.",
            status_code=503,
        )
        response.headers["Retry-After"] = "1"
        return response
    if not is_valid:
        return JSONResponse({"error": role_or_err}, status_code=403)
    data, json_error = await read_json_object(request)
    if json_error:
        return json_error
    invalid = validate_or_response(request, data, {
        "organization_id": {"type": "string", "required": True, "min_length": 1, "max_length": 128},
        "action": {"type": "string", "required": True, "enum": {"lock", "unlock", "renew", "set_package"}},
        "duration_days": {"type": "integer", "min": 1, "max": 3650},
        "package_id": {"type": "string", "min_length": 1, "max_length": 128},
    })
    if invalid:
        return invalid
    idempotency_key = str(request.headers.get("Idempotency-Key") or "").strip()
    try:
        return await run_database_write(
            _update_organization_subscription_sync,
            request,
            data,
            idempotency_key,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        response = error_response(
            request,
            "DATABASE_WRITE_QUEUE_FULL",
            "Hệ thống đang xử lý nhiều thay đổi. Vui lòng thử lại sau.",
            status_code=503,
        )
        response.headers["Retry-After"] = "1"
        return response


def _add_user_to_org_sync(request, user_id, employee_name, phone):
    conn = None
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        org_id = get_active_org(request, role_or_err.user_id)

        conn = database.get_connection()
        conn.execute("BEGIN IMMEDIATE")
        cursor = conn.cursor()

        if not is_business_organization(cursor, org_id):
            conn.rollback()
            return JSONResponse(
                {"error": "Không thể thêm thành viên vào không gian cá nhân.", "code": "PERSONAL_WORKSPACE_MEMBERSHIP_FORBIDDEN"},
                status_code=409,
            )

        if not is_organization_manager(
            cursor, str(role_or_err), role_or_err.user_id, org_id
        ):
            conn.rollback()
            return JSONResponse({"error": "Bạn không có quyền thực hiện thao tác này!"}, status_code=403)

        effective_roles = get_effective_roles(role_or_err)

        cursor.execute("SELECT user_id FROM thanh_vien_to_chuc WHERE user_id = ? AND organization_id = ?", (user_id, org_id))
        if cursor.fetchone():
            cursor.execute(
                """UPDATE thanh_vien_to_chuc
                   SET ten_nhan_su = ?, so_dien_thoai = ?, updated_at = datetime('now')
                   WHERE user_id = ? AND organization_id = ?""",
                (employee_name, phone or None, user_id, org_id),
            )
            log_audit(
                "organization.member_profile_updated",
                actor_user_id=role_or_err.user_id,
                organization_id=org_id,
                target_type="organization_membership",
                target_id=f"{org_id}:{user_id}",
                request=request,
                metadata={"updated_fields": ["employee_name", "phone"]},
                cursor=cursor,
                required=True,
            )
            conn.commit()
            return JSONResponse({"success": True, "message": "Thông tin nhân sự đã được cập nhật!"})

        cursor.execute("SELECT vai_tro FROM tai_khoan WHERE id = ?", (user_id,))
        u_row = cursor.fetchone()
        if not u_row:
            conn.rollback()
            return JSONResponse({"error": "Nguoi dung khong ton tai."}, status_code=404)
        if 'super_admin' not in effective_roles and 'super_admin' in get_effective_roles(u_row['vai_tro'] or ''):
            conn.rollback()
            return JSONResponse({"error": "Ban khong co quyen them super_admin vao to chuc."}, status_code=403)

        subscription = cursor.execute(
            """
            SELECT sub.status, sub.expires_at, sub.member_quota,
                   tc.trang_thai AS organization_status,
                   pkg.trang_thai AS package_status
            FROM organization_subscriptions sub
            JOIN to_chuc tc ON tc.id = sub.organization_id
            JOIN goi_dich_vu pkg ON pkg.id = sub.package_id
            WHERE sub.organization_id = ?
            """,
            (org_id,),
        ).fetchone()
        now = int(time.time())
        if (
            not subscription
            or subscription['status'] != 'active'
            or subscription['organization_status'] != 'active'
            or subscription['package_status'] != 'active'
            or subscription['expires_at'] is not None and int(subscription['expires_at']) <= now
        ):
            conn.rollback()
            return JSONResponse(
                {"error": "Gói dịch vụ của tổ chức không hoạt động.", "code": "ORG_SUBSCRIPTION_INACTIVE"},
                status_code=403,
            )
        member_count = int(cursor.execute(
            "SELECT count(*) FROM thanh_vien_to_chuc WHERE organization_id = ?",
            (org_id,),
        ).fetchone()[0])
        member_quota = int(subscription['member_quota'])
        if member_count >= member_quota:
            conn.rollback()
            return JSONResponse(
                {
                    "error": "Tổ chức đã sử dụng hết hạn mức thành viên.",
                    "code": "ORG_MEMBER_QUOTA_EXCEEDED",
                    "quota": member_quota,
                    "current": member_count,
                },
                status_code=409,
            )

        cursor.execute(
            """INSERT INTO thanh_vien_to_chuc (
                   user_id, organization_id, vai_tro_trong_to_chuc, ten_nhan_su, so_dien_thoai
               ) VALUES (?, ?, ?, ?, ?)""",
            (user_id, org_id, 'employee', employee_name, phone or None)
        )

        log_audit(
            "organization.member_added",
            actor_user_id=role_or_err.user_id,
            organization_id=org_id,
            target_type="organization_membership",
            target_id=f"{org_id}:{user_id}",
            request=request,
            metadata={"organization_id": org_id, "membership_role": "employee"},
            cursor=cursor,
            required=True,
        )
        conn.commit()
        _session_cache_invalidate_by_user_id(user_id)
        _org_cache_invalidate_by_user_id(user_id)

        return JSONResponse({"success": True, "message": "Thêm nhân sự vào tổ chức thành công!"})
    except OrgPermissionError as e:
        return error_response(
            request,
            "ORG_ACCESS_DENIED",
            "Không có quyền truy cập tổ chức này.",
            status_code=403,
        )
    except INTEGRITY_ERRORS as e:
        if conn:
            conn.rollback()
        return log_and_error(
            request,
            e,
            "add_user_to_org_api_integrity",
            "ORGANIZATION_MEMBER_CONFLICT",
            "Không thể thêm thành viên do xung đột dữ liệu.",
            status_code=409,
        )
    except Exception as e:
        if conn:
            conn.rollback()
        return log_and_error(
            request,
            e,
            "add_user_to_org_api",
            "ORGANIZATION_MEMBER_ADD_FAILED",
            "Không thể thêm thành viên vào tổ chức.",
        )
    finally:
        if conn:
            conn.close()


async def add_user_to_org_api(request):
    try:
        is_valid, role_or_err = await run_database_read(
            verify_session,
            request,
            timeout_seconds=10.0,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        response = error_response(request, "DATABASE_READ_QUEUE_FULL", "Hệ thống đang xử lý nhiều yêu cầu dữ liệu. Vui lòng thử lại sau.", status_code=503)
        response.headers["Retry-After"] = "1"
        return response
    if not is_valid:
        return JSONResponse({"error": role_or_err}, status_code=403)
    data, json_error = await read_json_object(request)
    if json_error:
        return json_error
    invalid = validate_or_response(request, data, {
        "user_id": {"type": "string", "required": True, "min_length": 1, "max_length": 128},
        "employee_name": {"type": "string", "required": True, "min_length": 1, "max_length": 200},
        "phone": {"type": "string", "max_length": 32},
    })
    if invalid:
        return invalid
    user_id = str(data.get('user_id') or '').strip()
    employee_name = re.sub(r"\s+", " ", str(data.get('employee_name') or '').strip())
    phone = str(data.get('phone') or '').strip()
    if not user_id or not employee_name:
        return JSONResponse({"error": "Thiếu thông tin bắt buộc!"}, status_code=400)
    try:
        return await run_database_write(
            _add_user_to_org_sync,
            request,
            user_id,
            employee_name,
            phone,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        response = error_response(request, "DATABASE_WRITE_QUEUE_FULL", "Hệ thống đang xử lý nhiều thay đổi. Vui lòng thử lại sau.", status_code=503)
        response.headers["Retry-After"] = "1"
        return response


def _remove_user_from_org_sync(request, user_id):
    conn = None
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        if str(user_id) == str(role_or_err.user_id):
            return JSONResponse({"error": "Không thể tự gỡ chính mình khỏi tổ chức."}, status_code=400)

        org_id = get_active_org(request, role_or_err.user_id)
        current_time = utc_now_sql()

        conn = database.get_connection()
        conn.execute("BEGIN IMMEDIATE")
        cursor = conn.cursor()
        if not is_business_organization(cursor, org_id):
            conn.close()
            return JSONResponse(
                {"error": "Không thể quản lý thành viên trong không gian cá nhân.", "code": "PERSONAL_WORKSPACE_MEMBERSHIP_FORBIDDEN"},
                status_code=409,
            )
        if not is_organization_manager(
            cursor, str(role_or_err), role_or_err.user_id, org_id
        ):
            conn.close()
            return JSONResponse({"error": "Bạn không có quyền thực hiện thao tác này!"}, status_code=403)
        sync_version = next_sync_version(cursor, org_id)

        cursor.execute(
            "SELECT vai_tro_trong_to_chuc FROM thanh_vien_to_chuc WHERE user_id = ? AND organization_id = ?",
            (user_id, org_id),
        )
        target_membership = cursor.fetchone()
        if not target_membership:
            conn.close()
            return JSONResponse({"error": "Nguoi dung khong thuoc to chuc hien tai."}, status_code=404)
        if str(target_membership[0] or "").strip().lower() == "manager":
            manager_count = int(cursor.execute(
                "SELECT count(*) FROM thanh_vien_to_chuc WHERE organization_id = ? AND lower(trim(vai_tro_trong_to_chuc)) = 'manager'",
                (org_id,),
            ).fetchone()[0])
            if manager_count <= 1:
                conn.close()
                return JSONResponse({"error": "Không thể xóa Quản lý cuối cùng của tổ chức."}, status_code=409)

        cursor.execute("DELETE FROM thanh_vien_to_chuc WHERE user_id = ? AND organization_id = ?", (user_id, org_id))

        cursor.execute("SELECT id FROM ma_tran_phan_quyen WHERE emp_id = ? AND organization_id = ?", (user_id, org_id))
        pq_rows = cursor.fetchall()
        for row in pq_rows:
            pq_id = row['id']
            cursor.execute("DELETE FROM ma_tran_phan_quyen WHERE id = ?", (pq_id,))
            cursor.execute(
                DELETED_RECORD_UPSERT_SQL,
                ("ma_tran_phan_quyen", pq_id, org_id, current_time, sync_version)
            )

        assignment_result = cursor.execute(
            "DELETE FROM phan_cong_nhan_su WHERE id_nhan_vien = ? AND organization_id = ?",
            (user_id, org_id),
        )
        impact = {
            "rootCount": 1,
            "permissionRows": len(pq_rows),
            "assignments": int(assignment_result.rowcount or 0),
        }
        impact["totalCount"] = sum(impact.values())

        log_audit(
            "organization.member_removed",
            actor_user_id=role_or_err.user_id,
            organization_id=org_id,
            target_type="organization_membership",
            target_id=f"{org_id}:{user_id}",
            request=request,
            metadata={"organization_id": org_id, "impact": impact},
            cursor=cursor,
            required=True,
        )
        conn.commit()
        conn.close()
        conn = None

        _session_cache_invalidate_by_user_id(user_id)
        _org_cache_invalidate_by_user_id(user_id)
        disconnect_user_websockets(user_id)
        broadcast_websocket_event(org_id, {"event": "db_changed"})

        return JSONResponse({
            "success": True,
            "message": "Gỡ nhân sự khỏi tổ chức thành công!",
            "deleteImpact": impact,
        })
    except OrgPermissionError as e:
        return error_response(
            request,
            "ORG_ACCESS_DENIED",
            "Không có quyền truy cập tổ chức này.",
            status_code=403,
        )
    except Exception as e:
        if conn:
            conn.rollback()
            conn.close()
        return log_and_error(
            request,
            e,
            "remove_user_from_org_api",
            "ORGANIZATION_MEMBER_REMOVE_FAILED",
            "Không thể gỡ thành viên khỏi tổ chức.",
        )


async def remove_user_from_org_api(request):
    try:
        is_valid, role_or_err = await run_database_read(
            verify_session,
            request,
            timeout_seconds=10.0,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        response = error_response(request, "DATABASE_READ_QUEUE_FULL", "Hệ thống đang xử lý nhiều yêu cầu dữ liệu. Vui lòng thử lại sau.", status_code=503)
        response.headers["Retry-After"] = "1"
        return response
    if not is_valid:
        return JSONResponse({"error": role_or_err}, status_code=403)
    data, json_error = await read_json_object(request)
    if json_error:
        return json_error
    invalid = validate_or_response(request, data, {
        "user_id": {"type": "string", "required": True, "min_length": 1, "max_length": 128},
    })
    if invalid:
        return invalid
    user_id = data.get('user_id')
    if not user_id:
        return JSONResponse({"error": "Thiếu thông tin bắt buộc!"}, status_code=400)
    if str(user_id) == str(role_or_err.user_id):
        return JSONResponse({"error": "Không thể tự gỡ chính mình khỏi tổ chức."}, status_code=400)
    try:
        return await run_database_write(_remove_user_from_org_sync, request, user_id)
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        response = error_response(request, "DATABASE_WRITE_QUEUE_FULL", "Hệ thống đang xử lý nhiều thay đổi. Vui lòng thử lại sau.", status_code=503)
        response.headers["Retry-After"] = "1"
        return response


_DOCUMENT_EXPORT_FIELDS = ("financial", "identity", "signature")


def _stored_document_export_grants(cursor, organization_id, user_id):
    row = cursor.execute(
        """SELECT financial, identity, signature
           FROM document_export_capabilities
           WHERE organization_id = ? AND user_id = ?
           LIMIT 1""",
        (organization_id, user_id),
    ).fetchone()
    if not row:
        return {field: False for field in _DOCUMENT_EXPORT_FIELDS}
    return {
        field: bool(row[index])
        for index, field in enumerate(_DOCUMENT_EXPORT_FIELDS)
    }


def _document_export_target(cursor, organization_id, user_id):
    return cursor.execute(
        """SELECT account.vai_tro, member.vai_tro_trong_to_chuc
           FROM thanh_vien_to_chuc AS member
           JOIN tai_khoan AS account ON account.id = member.user_id
           WHERE member.organization_id = ? AND member.user_id = ?
           LIMIT 1""",
        (organization_id, user_id),
    ).fetchone()


def _can_manage_document_export_grants(cursor, role_str, user_id, organization_id):
    return is_organization_manager(cursor, role_str, user_id, organization_id) or (
        is_personal_workspace_owner(cursor, user_id, organization_id)
    )


def _inherits_all_document_export_capabilities(
    cursor, role_str, user_id, organization_id
):
    return is_organization_manager(cursor, role_str, user_id, organization_id) or (
        is_personal_workspace_owner(cursor, user_id, organization_id)
    )


def _document_export_grant_payload(cursor, organization_id, user_id, role_str):
    grants = _stored_document_export_grants(cursor, organization_id, user_id)
    effective = resolve_document_export_capabilities(
        cursor, role_str, user_id, organization_id
    ).as_dict()
    return {
        "success": True,
        "organizationId": organization_id,
        "userId": user_id,
        "grants": grants,
        "effectiveCapabilities": effective,
        "inherited": _inherits_all_document_export_capabilities(
            cursor, role_str, user_id, organization_id
        ),
    }


def _get_document_export_capabilities_sync(request):
    """Read explicit and effective sensitive-export capabilities in the active org."""

    conn = None
    try:
        is_valid, role_or_error = verify_session(request)
        if not is_valid:
            return error_response(
                request,
                "AUTH_REQUIRED",
                "Phiên đăng nhập không hợp lệ.",
                status_code=403,
            )
        target_user_id = str(request.path_params.get("user_id") or "").strip()
        if not target_user_id or len(target_user_id) > 128:
            return error_response(
                request,
                "DOCUMENT_EXPORT_CAPABILITY_TARGET_INVALID",
                "Mã người dùng không hợp lệ.",
                status_code=400,
            )
        organization_id = get_active_org(request, role_or_error.user_id)
        conn = database.get_connection()
        cursor = conn.cursor()
        if not _can_manage_document_export_grants(
            cursor, str(role_or_error), role_or_error.user_id, organization_id
        ):
            return error_response(
                request,
                "DOCUMENT_EXPORT_CAPABILITY_MANAGE_FORBIDDEN",
                "Bạn không có quyền quản lý quyền xuất tài liệu.",
                status_code=403,
            )
        target = _document_export_target(cursor, organization_id, target_user_id)
        if not target:
            return error_response(
                request,
                "DOCUMENT_EXPORT_CAPABILITY_TARGET_NOT_FOUND",
                "Không tìm thấy thành viên trong tổ chức hiện tại.",
                status_code=404,
            )
        return JSONResponse(
            _document_export_grant_payload(
                cursor, organization_id, target_user_id, target[0]
            )
        )
    except OrgPermissionError:
        return error_response(
            request,
            "ORG_ACCESS_DENIED",
            "Không có quyền truy cập tổ chức này.",
            status_code=403,
        )
    except Exception as exc:
        return log_and_error(
            request,
            exc,
            "get_document_export_capabilities_api",
            "DOCUMENT_EXPORT_CAPABILITY_READ_FAILED",
            "Không thể đọc quyền xuất tài liệu.",
        )
    finally:
        if conn:
            conn.close()


async def get_document_export_capabilities_api(request):
    try:
        return await run_database_read(
            _get_document_export_capabilities_sync,
            request,
            timeout_seconds=10.0,
        )
    except BlockingIOBusyError:
        response = error_response(
            request,
            "DATABASE_READ_QUEUE_FULL",
            "Hệ thống đang xử lý nhiều yêu cầu dữ liệu. Vui lòng thử lại sau.",
            status_code=503,
        )
        response.headers["Retry-After"] = "1"
        return response
    except BlockingIOTimeoutError:
        response = error_response(
            request,
            "DATABASE_READ_TIMEOUT",
            "Không thể đọc quyền xuất tài liệu trong thời gian cho phép.",
            status_code=503,
        )
        response.headers["Retry-After"] = "1"
        return response


def _update_document_export_capabilities_sync(request, target_user_id, data):
    """Replace an ordinary member's sensitive-export grants in the active org."""

    conn = None
    try:
        is_valid, role_or_error = verify_session(request)
        if not is_valid:
            return error_response(
                request,
                "AUTH_REQUIRED",
                "Phiên đăng nhập không hợp lệ.",
                status_code=403,
            )
        organization_id = get_active_org(request, role_or_error.user_id)
        conn = database.get_connection()
        conn.execute("BEGIN IMMEDIATE")
        cursor = conn.cursor()
        if not _can_manage_document_export_grants(
            cursor, str(role_or_error), role_or_error.user_id, organization_id
        ):
            conn.rollback()
            return error_response(
                request,
                "DOCUMENT_EXPORT_CAPABILITY_MANAGE_FORBIDDEN",
                "Bạn không có quyền quản lý quyền xuất tài liệu.",
                status_code=403,
            )
        target = _document_export_target(cursor, organization_id, target_user_id)
        if not target:
            conn.rollback()
            return error_response(
                request,
                "DOCUMENT_EXPORT_CAPABILITY_TARGET_NOT_FOUND",
                "Không tìm thấy thành viên trong tổ chức hiện tại.",
                status_code=404,
            )
        if _inherits_all_document_export_capabilities(
            cursor, target[0], target_user_id, organization_id
        ):
            conn.rollback()
            return error_response(
                request,
                "DOCUMENT_EXPORT_CAPABILITY_INHERITED",
                "Thành viên này được thừa hưởng toàn bộ quyền xuất tài liệu.",
                status_code=409,
            )

        values = tuple(1 if data[field] else 0 for field in _DOCUMENT_EXPORT_FIELDS)
        cursor.execute(
            """INSERT INTO document_export_capabilities (
                   organization_id, user_id, financial, identity, signature
               ) VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(organization_id, user_id) DO UPDATE SET
                   financial = excluded.financial,
                   identity = excluded.identity,
                   signature = excluded.signature,
                   updated_at = datetime('now')""",
            (organization_id, target_user_id, *values),
        )
        payload = _document_export_grant_payload(
            cursor, organization_id, target_user_id, target[0]
        )
        enabled_ids = [field for field in _DOCUMENT_EXPORT_FIELDS if data[field]]
        disabled_ids = [
            field for field in _DOCUMENT_EXPORT_FIELDS if not data[field]
        ]
        log_audit(
            "document.export_capabilities_updated",
            actor_user_id=role_or_error.user_id,
            organization_id=organization_id,
            target_type="document_export_capabilities",
            target_id=f"{organization_id}:{target_user_id}",
            request=request,
            metadata={
                "organization_id": organization_id,
                "user_id": target_user_id,
                "enabled_capability_ids": enabled_ids,
                "disabled_capability_ids": disabled_ids,
            },
            cursor=cursor,
            required=True,
        )
        conn.commit()
        return JSONResponse(payload)
    except OrgPermissionError:
        if conn:
            conn.rollback()
        return error_response(
            request,
            "ORG_ACCESS_DENIED",
            "Không có quyền truy cập tổ chức này.",
            status_code=403,
        )
    except INTEGRITY_ERRORS as exc:
        if conn:
            conn.rollback()
        return log_and_error(
            request,
            exc,
            "update_document_export_capabilities_api_integrity",
            "DOCUMENT_EXPORT_CAPABILITY_CONFLICT",
            "Không thể cập nhật quyền do xung đột dữ liệu.",
            status_code=409,
        )
    except Exception as exc:
        if conn:
            conn.rollback()
        return log_and_error(
            request,
            exc,
            "update_document_export_capabilities_api",
            "DOCUMENT_EXPORT_CAPABILITY_UPDATE_FAILED",
            "Không thể cập nhật quyền xuất tài liệu.",
        )
    finally:
        if conn:
            conn.close()


async def update_document_export_capabilities_api(request):
    """Replace sensitive-export grants without blocking the event loop."""
    try:
        is_valid, role_or_error = await run_database_read(
            verify_session,
            request,
            timeout_seconds=10.0,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        response = error_response(
            request,
            "DATABASE_READ_QUEUE_FULL",
            "Hệ thống đang xử lý nhiều yêu cầu dữ liệu. Vui lòng thử lại sau.",
            status_code=503,
        )
        response.headers["Retry-After"] = "1"
        return response
    if not is_valid:
        return error_response(
            request,
            "AUTH_REQUIRED",
            "Phiên đăng nhập không hợp lệ.",
            status_code=403,
        )
    del role_or_error
    target_user_id = str(request.path_params.get("user_id") or "").strip()
    if not target_user_id or len(target_user_id) > 128:
        return error_response(
            request,
            "DOCUMENT_EXPORT_CAPABILITY_TARGET_INVALID",
            "Mã người dùng không hợp lệ.",
            status_code=400,
        )
    data, json_error = await read_json_object(request)
    if json_error:
        return json_error
    invalid = validate_or_response(
        request,
        data,
        {
            "financial": {"type": "boolean", "required": True},
            "identity": {"type": "boolean", "required": True},
            "signature": {"type": "boolean", "required": True},
        },
    )
    if invalid:
        return invalid
    try:
        return await run_database_write(
            _update_document_export_capabilities_sync,
            request,
            target_user_id,
            data,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        response = error_response(
            request,
            "DATABASE_WRITE_QUEUE_FULL",
            "Hệ thống đang xử lý nhiều thay đổi. Vui lòng thử lại sau.",
            status_code=503,
        )
        response.headers["Retry-After"] = "1"
        return response
