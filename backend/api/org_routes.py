import json
import re
import sqlite3
import time
from starlette.responses import JSONResponse

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
from backend.shared.access_policy import is_business_organization, is_organization_manager
from backend.shared.logging_utils import error_response, log_and_error
from backend.shared.request_validation import validate_or_response
from backend.shared.date_utils import utc_now_sql
from backend.auth.auth_service import activate_personal_subscription, build_user_access_payload


_IDEMPOTENCY_KEY_RE = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")


async def activate_personal_subscription_api(request):
    """Grant a package to an account without creating an organization at registration time."""
    conn = None
    try:
        is_valid, role_or_err = verify_session(request, required_role='super_admin')
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        data = await request.json()
        invalid = validate_or_response(request, data, {
            "user_id": {"type": "string", "required": True, "min_length": 1, "max_length": 128},
            "package_id": {"type": "string", "required": True, "min_length": 1, "max_length": 128},
            "duration_days": {"type": "integer", "min": 1, "max": 3650},
        })
        if invalid:
            return invalid
        user_id = str(data.get("user_id") or "").strip()
        package_id = str(data.get("package_id") or "").strip()
        duration_days = data.get("duration_days", 365)
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
        access = build_user_access_payload(cursor, user_id, user[1], organization_id)
        conn.commit()
        _session_cache_invalidate_by_user_id(user_id)
        _org_cache_invalidate_by_user_id(user_id)
        log_audit(
            "personal_subscription.activated",
            actor_user_id=role_or_err.user_id,
            organization_id=organization_id,
            target_type="tai_khoan",
            target_id=user_id,
            request=request,
            metadata={"package_id": package_id, "duration_days": duration_days},
        )
        return JSONResponse({"success": True, "user": access})
    except Exception as exc:
        if conn:
            conn.rollback()
        return log_and_error(request, exc, "activate_personal_subscription_api", "PERSONAL_SUBSCRIPTION_FAILED", "Không thể kích hoạt gói cá nhân.")
    finally:
        if conn:
            conn.close()


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


async def update_organization_subscription_api(request):
    """Lock, unlock, renew or change an organization subscription atomically."""
    conn = None
    try:
        is_valid, role_or_err = verify_session(request, required_role='super_admin')
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        data = await request.json()
        invalid = validate_or_response(request, data, {
            "organization_id": {"type": "string", "required": True, "min_length": 1, "max_length": 128},
            "action": {"type": "string", "required": True, "enum": {"lock", "unlock", "renew", "set_package"}},
            "duration_days": {"type": "integer", "min": 1, "max": 3650},
            "package_id": {"type": "string", "min_length": 1, "max_length": 128},
        })
        if invalid:
            return invalid
        organization_id = str(data.get("organization_id") or "").strip()
        action = str(data.get("action") or "").strip().lower()
        idempotency_key = str(request.headers.get("Idempotency-Key") or "").strip()
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
        conn.commit()

        for user_id in member_ids:
            _session_cache_invalidate_by_user_id(user_id)
            _org_cache_invalidate_by_user_id(user_id)
            if action == 'lock':
                disconnect_user_websockets(user_id)
        broadcast_websocket_event(organization_id, {"event": "organization_subscription_changed"})
        log_audit(
            f"organization.subscription_{action}",
            actor_user_id=role_or_err.user_id,
            organization_id=organization_id,
            target_type="organization_subscription",
            target_id=organization_id,
            request=request,
            metadata={"changed": changed, "subscription": subscription},
        )
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

async def add_user_to_org_api(request):
    conn = None
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        data = await request.json()
        invalid = validate_or_response(request, data, {
            "user_id": {"type": "string", "required": True, "min_length": 1, "max_length": 128},
        })
        if invalid:
            return invalid
        user_id = str(data.get('user_id') or '').strip()
        if not user_id:
            return JSONResponse({"error": "Thiếu thông tin bắt buộc!"}, status_code=400)

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
            conn.commit()
            return JSONResponse({"success": True, "message": "Nhân sự đã thuộc tổ chức này!"})

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
            "INSERT INTO thanh_vien_to_chuc (user_id, organization_id, vai_tro_trong_to_chuc) VALUES (?, ?, ?)",
            (user_id, org_id, 'employee')
        )

        conn.commit()
        _session_cache_invalidate_by_user_id(user_id)
        _org_cache_invalidate_by_user_id(user_id)

        log_audit(
            "organization.member_added",
            actor_user_id=role_or_err.user_id,
            target_type="organization_membership",
            target_id=f"{org_id}:{user_id}",
            request=request,
            metadata={"organization_id": org_id, "membership_role": "employee"},
        )

        return JSONResponse({"success": True, "message": "Thêm nhân sự vào tổ chức thành công!"})
    except OrgPermissionError as e:
        return error_response(
            request,
            "ORG_ACCESS_DENIED",
            "Không có quyền truy cập tổ chức này.",
            status_code=403,
        )
    except sqlite3.IntegrityError as e:
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

async def remove_user_from_org_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        data = await request.json()
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

        org_id = get_active_org(request, role_or_err.user_id)
        current_time = utc_now_sql()

        conn = database.get_connection()
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

        conn.commit()
        conn.close()

        _session_cache_invalidate_by_user_id(user_id)
        _org_cache_invalidate_by_user_id(user_id)
        disconnect_user_websockets(user_id)
        broadcast_websocket_event(org_id, {"event": "db_changed"})

        log_audit(
            "organization.member_removed",
            actor_user_id=role_or_err.user_id,
            target_type="organization_membership",
            target_id=f"{org_id}:{user_id}",
            request=request,
            metadata={"organization_id": org_id, "impact": impact},
        )

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
        return log_and_error(
            request,
            e,
            "remove_user_from_org_api",
            "ORGANIZATION_MEMBER_REMOVE_FAILED",
            "Không thể gỡ thành viên khỏi tổ chức.",
        )
