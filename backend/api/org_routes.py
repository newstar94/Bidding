from datetime import datetime
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
from backend.shared.access_policy import is_organization_manager
from backend.shared.logging_utils import error_response, log_and_error

async def add_user_to_org_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        data = await request.json()
        user_id = data.get('user_id')
        if not user_id:
            return JSONResponse({"error": "Thiếu thông tin bắt buộc!"}, status_code=400)

        org_id = get_active_org(request, role_or_err.user_id)

        conn = database.get_connection()
        cursor = conn.cursor()

        if not is_organization_manager(
            cursor, str(role_or_err), role_or_err.user_id, org_id
        ):
            conn.close()
            return JSONResponse({"error": "Bạn không có quyền thực hiện thao tác này!"}, status_code=403)

        effective_roles = get_effective_roles(role_or_err)

        cursor.execute("SELECT 1 FROM to_chuc WHERE id = ?", (org_id,))
        if not cursor.fetchone():
            cursor.execute("SELECT ho_ten, email FROM tai_khoan WHERE id = ?", (role_or_err.user_id,))
            mgr_row = cursor.fetchone()
            if mgr_row:
                mgr_name = mgr_row['ho_ten'] or mgr_row['email'] or f"Quản lý {role_or_err.user_id}"
            else:
                mgr_name = f"Quản lý {role_or_err.user_id}"

            org_name = f"Tổ chức của {mgr_name}"
            cursor.execute("SELECT 1 FROM to_chuc WHERE ten_to_chuc = ?", (org_name,))
            if cursor.fetchone():
                org_name = f"Tổ chức của {mgr_name} ({org_id})"

            cursor.execute(
                "INSERT INTO to_chuc (id, ten_to_chuc, quan_ly_id) VALUES (?, ?, ?)",
                (org_id, org_name, role_or_err.user_id)
            )
            cursor.execute(
                "INSERT OR IGNORE INTO thanh_vien_to_chuc (user_id, organization_id, vai_tro_trong_to_chuc) VALUES (?, ?, ?)",
                (role_or_err.user_id, org_id, 'owner')
            )

        cursor.execute("SELECT user_id FROM thanh_vien_to_chuc WHERE user_id = ? AND organization_id = ?", (user_id, org_id))
        if cursor.fetchone():
            conn.close()
            return JSONResponse({"success": True, "message": "Nhân sự đã thuộc tổ chức này!"})

        cursor.execute("SELECT vai_tro FROM tai_khoan WHERE id = ?", (user_id,))
        u_row = cursor.fetchone()
        if not u_row:
            conn.close()
            return JSONResponse({"error": "Nguoi dung khong ton tai."}, status_code=404)
        if 'super_admin' not in effective_roles and 'super_admin' in get_effective_roles(u_row['vai_tro'] or ''):
            conn.close()
            return JSONResponse({"error": "Ban khong co quyen them super_admin vao to chuc."}, status_code=403)

        cursor.execute(
            "INSERT OR IGNORE INTO thanh_vien_to_chuc (user_id, organization_id, vai_tro_trong_to_chuc) VALUES (?, ?, ?)",
            (user_id, org_id, 'employee')
        )

        conn.commit()
        conn.close()
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
    except Exception as e:
        return log_and_error(
            request,
            e,
            "add_user_to_org_api",
            "ORGANIZATION_MEMBER_ADD_FAILED",
            "Không thể thêm thành viên vào tổ chức.",
        )

async def remove_user_from_org_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        data = await request.json()
        user_id = data.get('user_id')
        if not user_id:
            return JSONResponse({"error": "Thiếu thông tin bắt buộc!"}, status_code=400)

        if str(user_id) == str(role_or_err.user_id):
            return JSONResponse({"error": "Không thể tự gỡ chính mình khỏi tổ chức."}, status_code=400)

        org_id = get_active_org(request, role_or_err.user_id)
        current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        conn = database.get_connection()
        cursor = conn.cursor()
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
        if str(target_membership[0] or "").strip().lower() == "owner":
            conn.close()
            return JSONResponse({"error": "Không thể xóa chủ sở hữu tổ chức."}, status_code=409)

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
