import time
from collections import defaultdict

from starlette.responses import JSONResponse

from backend.db.errors import INTEGRITY_ERRORS
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError
from backend.shared.database_io import run_database_read, run_database_write
from backend.shared.helpers import (
    OrgPermissionError,
    _org_cache_invalidate_by_user_id,
    _session_cache_invalidate_by_user_id,
    database,
    get_active_org,
    get_effective_roles,
    log_audit,
    log_error,
    verify_session,
)
from backend.shared.logging_utils import error_response
from backend.sync.api import disconnect_user_websockets


def _database_lane_unavailable_response(request, *, write=False, timed_out=False):
    if write:
        code = "DATABASE_WRITE_QUEUE_FULL"
    elif timed_out:
        code = "DATABASE_READ_TIMEOUT"
    else:
        code = "DATABASE_READ_QUEUE_FULL"
    response = error_response(
        request,
        code,
        "Hệ thống đang xử lý nhiều yêu cầu dữ liệu. Vui lòng thử lại sau.",
        status_code=503,
    )
    response.headers["Retry-After"] = "1"
    return response


def _list_users_sync(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        conn = database.get_connection()
        cursor = conn.cursor()

        cursor.execute("SELECT vai_tro FROM tai_khoan WHERE id = ?", (role_or_err.user_id,))
        requester = cursor.fetchone()
        if not requester:
            conn.close()
            return JSONResponse({"error": "Không tìm thấy thông tin tài khoản yêu cầu!"}, status_code=404)

        req_role = requester['vai_tro']
        effective_roles = get_effective_roles(req_role)

        sql_base = "SELECT id, ten_dang_nhap AS username, ho_ten AS name, vai_tro AS role, vai_tro AS platform_role, email, anh_dai_dien AS avatar FROM tai_khoan"

        email_query = (request.query_params.get('email') or '').strip().lower()
        email_filter_sql = " AND email_norm = ?" if email_query else ""
        email_filter_tk_sql = " AND tk.email_norm = ?" if email_query else ""

        if 'super_admin' in effective_roles:
            if email_query:
                cursor.execute(sql_base + " WHERE email_norm = ?", (email_query,))
            else:
                cursor.execute(sql_base)
            users_raw = cursor.fetchall()
        else:
            active_org_id = get_active_org(request, role_or_err.user_id)
            cursor.execute(
                """
                SELECT lower(trim(vai_tro_trong_to_chuc))
                FROM thanh_vien_to_chuc
                WHERE user_id = ? AND organization_id = ?
                """,
                (role_or_err.user_id, active_org_id),
            )
            membership = cursor.fetchone()
            membership_role = str(membership[0] or "").strip().lower() if membership else ""
            if membership_role != 'manager':
                cursor.execute(f"""
                    SELECT tk.id, tk.ten_dang_nhap AS username, tk.ho_ten AS name,
                           tvtc.vai_tro_trong_to_chuc AS role,
                           tk.vai_tro AS platform_role,
                           tk.email, tk.anh_dai_dien AS avatar
                    FROM tai_khoan AS tk
                    JOIN thanh_vien_to_chuc AS tvtc ON tvtc.user_id = tk.id
                    WHERE tk.id = ? AND tvtc.organization_id = ?{email_filter_tk_sql}
                """, tuple([role_or_err.user_id, active_org_id] + ([email_query] if email_query else [])))
                users_raw = cursor.fetchall()
            else:
                cursor.execute(f"""
                    SELECT DISTINCT tk.id, tk.ten_dang_nhap AS username, tk.ho_ten AS name,
                                    tvtc.vai_tro_trong_to_chuc AS role,
                                    tk.vai_tro AS platform_role,
                                    tk.email, tk.anh_dai_dien AS avatar
                    FROM tai_khoan tk
                    JOIN thanh_vien_to_chuc tvtc ON tk.id = tvtc.user_id
                    WHERE tvtc.organization_id = ?{email_filter_tk_sql}
                """, tuple([active_org_id] + ([email_query] if email_query else [])))
                users_raw = cursor.fetchall()

        user_ids = [r['id'] for r in users_raw]
        orgs_by_user = defaultdict(list)
        if user_ids:
            placeholders = ",".join("?" for _ in user_ids)
            cursor.execute(f"""
                SELECT tvtc.user_id, tc.id, tc.ten_to_chuc, tc.scope_type,
                       tc.trang_thai AS organization_status,
                       tvtc.vai_tro_trong_to_chuc,
                       tvtc.ten_nhan_su, tvtc.so_dien_thoai,
                       sub.package_id, sub.status AS subscription_status,
                       sub.starts_at, sub.expires_at, sub.member_quota, sub.revision,
                       pkg.trang_thai AS package_status,
                       (SELECT count(*) FROM thanh_vien_to_chuc members
                        WHERE members.organization_id = tc.id) AS member_count
                FROM thanh_vien_to_chuc tvtc
                JOIN to_chuc tc ON tvtc.organization_id = tc.id
                LEFT JOIN organization_subscriptions sub ON sub.organization_id = tc.id
                LEFT JOIN goi_dich_vu pkg ON pkg.id = sub.package_id
                WHERE tvtc.user_id IN ({placeholders})
                  AND (
                      tc.scope_type = 'organization'
                      OR NOT EXISTS (
                          SELECT 1
                          FROM thanh_vien_to_chuc business_membership
                          JOIN to_chuc business_org
                            ON business_org.id = business_membership.organization_id
                          WHERE business_membership.user_id = tvtc.user_id
                            AND business_org.scope_type = 'organization'
                      )
                  )
            """, user_ids)
            for row in cursor.fetchall():
                scope_type = str(row['scope_type'] or 'organization').strip().lower()
                has_subscription = row['package_id'] is not None
                expires_at = int(row['expires_at']) if row['expires_at'] is not None else None
                subscription_status = (
                    str(row['subscription_status'] or 'missing').strip().lower()
                    if has_subscription
                    else None
                )
                if subscription_status and expires_at is not None and expires_at <= int(time.time()):
                    subscription_status = 'expired'
                effective_status = 'active'
                if row['organization_status'] != 'active':
                    effective_status = 'suspended'
                elif scope_type != 'personal':
                    if subscription_status == 'suspended':
                        effective_status = 'suspended'
                    elif subscription_status != 'active':
                        effective_status = subscription_status or 'missing'
                    elif row['package_status'] != 'active':
                        effective_status = 'package_inactive'
                starts_at = int(row['starts_at']) if row['starts_at'] is not None else None
                orgs_by_user[row['user_id']].append({
                    "id": row['id'],
                    "name": row['ten_to_chuc'],
                    "scope_type": scope_type,
                    "status": effective_status,
                    "role": row['vai_tro_trong_to_chuc'],
                    "employee_name": row['ten_nhan_su'],
                    "employee_phone": row['so_dien_thoai'],
                    "subscription": {
                        "package_id": row['package_id'],
                        "status": subscription_status,
                        "starts_at": starts_at,
                        "expires_at": expires_at,
                        "start_date": time.strftime('%Y-%m-%d', time.gmtime(starts_at)) if starts_at else None,
                        "end_date": time.strftime('%Y-%m-%d', time.gmtime(expires_at)) if expires_at else None,
                        "member_quota": int(row['member_quota'] or 0),
                        "member_count": int(row['member_count'] or 0),
                        "revision": int(row['revision'] or 0),
                    } if has_subscription else None,
                })

        users = []
        for row in users_raw:
            u = dict(row)
            u['organizations'] = orgs_by_user[u['id']]
            users.append(u)
        conn.close()
        return JSONResponse(users)
    except OrgPermissionError as e:
        return error_response(
            request,
            "ORG_ACCESS_DENIED",
            "Không có quyền truy cập tổ chức này.",
            status_code=403,
        )
    except Exception as e:
        log_error(e, "list_users_api")
        return JSONResponse({"error": "Đã xảy ra lỗi tải danh sách người dùng."}, status_code=500)


async def list_users_api(request):
    try:
        return await run_database_read(_list_users_sync, request)
    except BlockingIOBusyError:
        return _database_lane_unavailable_response(request)
    except BlockingIOTimeoutError:
        return _database_lane_unavailable_response(request, timed_out=True)


def _delete_user_sync(request):
    conn = None
    try:
        is_valid, role_or_err = verify_session(request, required_role='super_admin')
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        user_id = request.path_params.get('user_id')
        if str(user_id) == str(role_or_err.user_id):
            return JSONResponse({"error": "Không thể tự xóa tài khoản quản trị."}, status_code=409)
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("BEGIN IMMEDIATE")
        cursor.execute("SELECT vai_tro FROM tai_khoan WHERE id = ?", (user_id,))
        target = cursor.fetchone()
        if not target:
            return JSONResponse({"error": "Người dùng không tồn tại."}, status_code=404)
        if str(target[0] or '').strip().lower() == 'super_admin':
            cursor.execute("SELECT count(*) FROM tai_khoan WHERE vai_tro = 'super_admin'")
            if int(cursor.fetchone()[0]) <= 1:
                return JSONResponse({"error": "Không thể xóa quản trị viên nền tảng cuối cùng."}, status_code=409)
        cursor.execute(
            """
            SELECT membership.organization_id
            FROM thanh_vien_to_chuc AS membership
            JOIN to_chuc AS organization
              ON organization.id = membership.organization_id
            WHERE membership.user_id = ?
              AND organization.scope_type = 'organization'
              AND lower(trim(membership.vai_tro_trong_to_chuc)) = 'manager'
              AND NOT EXISTS (
                  SELECT 1
                  FROM thanh_vien_to_chuc AS other_owner
                  WHERE other_owner.organization_id = membership.organization_id
                    AND other_owner.user_id != membership.user_id
                    AND lower(trim(other_owner.vai_tro_trong_to_chuc)) = 'manager'
              )
            LIMIT 1
            """,
            (user_id,),
        )
        if cursor.fetchone():
            return JSONResponse({"error": "Không thể xóa Quản lý cuối cùng của tổ chức."}, status_code=409)
        personal_workspace_count = int(cursor.execute(
            "SELECT COUNT(*) FROM to_chuc WHERE scope_type = 'personal' AND personal_owner_user_id = ?",
            (user_id,),
        ).fetchone()[0])
        if personal_workspace_count:
            cursor.execute("SAVEPOINT delete_personal_workspace")
            try:
                cursor.execute(
                    "DELETE FROM to_chuc WHERE scope_type = 'personal' AND personal_owner_user_id = ?",
                    (user_id,),
                )
                cursor.execute("RELEASE SAVEPOINT delete_personal_workspace")
            except INTEGRITY_ERRORS:
                cursor.execute("ROLLBACK TO SAVEPOINT delete_personal_workspace")
                cursor.execute("RELEASE SAVEPOINT delete_personal_workspace")
                conn.rollback()
                return JSONResponse({
                    "error": "Không thể xóa tài khoản khi không gian cá nhân còn dữ liệu.",
                    "code": "PERSONAL_WORKSPACE_NOT_EMPTY",
                }, status_code=409)
        impact = {
            "rootCount": 1,
            "personalWorkspaces": personal_workspace_count,
            "memberships": int(cursor.execute(
                "SELECT COUNT(*) FROM thanh_vien_to_chuc WHERE user_id = ?",
                (user_id,),
            ).fetchone()[0]),
            "assignments": int(cursor.execute(
                "SELECT COUNT(*) FROM phan_cong_nhan_su WHERE id_nhan_vien = ?",
                (user_id,),
            ).fetchone()[0]),
            "permissionRows": int(cursor.execute(
                "SELECT COUNT(*) FROM ma_tran_phan_quyen WHERE emp_id = ?",
                (user_id,),
            ).fetchone()[0]),
            "passwordResetTokens": int(cursor.execute(
                "SELECT COUNT(*) FROM password_reset_tokens WHERE user_id = ?",
                (user_id,),
            ).fetchone()[0]),
        }
        impact["totalCount"] = impact["rootCount"] + sum(
            value for key, value in impact.items() if key not in {"rootCount", "totalCount"}
        )
        cursor.execute("DELETE FROM ma_tran_phan_quyen WHERE emp_id = ?", (user_id,))
        cursor.execute("DELETE FROM tai_khoan WHERE id = ?", (user_id,))
        log_audit(
            "admin.user_deleted",
            actor_user_id=role_or_err.user_id,
            target_type="tai_khoan",
            target_id=user_id,
            request=request,
            metadata={"impact": impact},
            cursor=cursor,
            required=True,
        )
        conn.commit()

        _session_cache_invalidate_by_user_id(user_id)
        _org_cache_invalidate_by_user_id(user_id)
        disconnect_user_websockets(user_id)
        return JSONResponse({
            "success": True,
            "message": "Xóa người dùng thành công!",
            "deleteImpact": impact,
        })
    except Exception as e:
        if conn:
            conn.rollback()
        log_error(e, "delete_user_api")
        return JSONResponse({"error": "Đã xảy ra lỗi xóa tài khoản."}, status_code=500)
    finally:
        if conn:
            conn.close()


async def delete_user_api(request):
    try:
        return await run_database_write(_delete_user_sync, request)
    except BlockingIOBusyError:
        return _database_lane_unavailable_response(request, write=True)
