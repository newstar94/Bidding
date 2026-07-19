from backend.db.db_helper import IntegrityError
import json
import re
import time
from starlette.responses import JSONResponse
from backend.auth.security_notifications import build_security_notification_batch

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
from backend.shared.request_validation import read_json_object, validate_or_response
from backend.shared.date_utils import vietnam_date_from_epoch, vietnam_now_sql


_IDEMPOTENCY_KEY_RE = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")


def _subscription_payload(cursor, organization_id):
    row = cursor.execute(
        """
        SELECT sub.organization_id, sub.package_id, sub.status, sub.starts_at,
               sub.expires_at, sub.member_quota, sub.revision,
               (SELECT count(*) FROM thanh_vien_to_chuc members
                WHERE members.organization_id = sub.organization_id
                  AND COALESCE(members.trang_thai_thanh_vien, 'active') = 'active') AS member_count
        FROM organization_subscriptions sub
        WHERE sub.organization_id = ?
        """,
        (organization_id,),
    ).fetchone()
    if not row:
        return None
    result = dict(row)
    result["start_date"] = vietnam_date_from_epoch(result["starts_at"])
    result["end_date"] = vietnam_date_from_epoch(result["expires_at"])
    return result


async def update_organization_subscription_api(request):
    """Lock, unlock, renew or change an organization subscription atomically."""
    conn = None
    try:
        is_valid, role_or_err = verify_session(request, required_role='super_admin')
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
        conn.execute("BEGIN")
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
            cursor.execute("UPDATE to_chuc SET trang_thai = 'suspended', updated_at = CURRENT_TIMESTAMP WHERE id = ?", (organization_id,))
            cursor.execute(
                """UPDATE organization_subscriptions
                   SET status = 'suspended', revision = revision + ?, updated_at = CURRENT_TIMESTAMP
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
            cursor.execute("UPDATE to_chuc SET trang_thai = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?", (organization_id,))
            cursor.execute(
                """UPDATE organization_subscriptions
                   SET status = 'active', revision = revision + ?, updated_at = CURRENT_TIMESTAMP
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
            cursor.execute("UPDATE to_chuc SET trang_thai = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?", (organization_id,))
            cursor.execute(
                """UPDATE organization_subscriptions
                   SET status = 'active', expires_at = ?, revision = revision + 1,
                       updated_at = CURRENT_TIMESTAMP
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
                       updated_at = CURRENT_TIMESTAMP
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
        manager_recipients = cursor.execute(
            """SELECT accounts.email, accounts.ho_ten
               FROM thanh_vien_to_chuc AS memberships
               JOIN tai_khoan AS accounts ON accounts.id = memberships.user_id
               WHERE memberships.organization_id = ?
                 AND lower(trim(memberships.vai_tro_trong_to_chuc)) = 'manager'
                 AND COALESCE(memberships.trang_thai_thanh_vien, 'active') = 'active'""",
            (organization_id,),
        ).fetchall()
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
        return JSONResponse(
            response_payload,
            background=build_security_notification_batch(
                manager_recipients,
                subject="[BiddingFlow] Gói dịch vụ tổ chức đã thay đổi",
                message=f"Trạng thái hoặc gói dịch vụ của tổ chức vừa được cập nhật ({action}).",
            ),
        )
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

        org_id = get_active_org(request, role_or_err.user_id)

        conn = database.get_connection()
        conn.execute("BEGIN")
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

        membership = cursor.execute(
            """SELECT user_id, COALESCE(trang_thai_thanh_vien, 'active') AS membership_status
               FROM thanh_vien_to_chuc
               WHERE user_id = ? AND organization_id = ?""",
            (user_id, org_id),
        ).fetchone()
        if membership and membership['membership_status'] == 'active':
            cursor.execute(
                """UPDATE thanh_vien_to_chuc
                   SET ten_nhan_su = ?, so_dien_thoai = ?, updated_at = CURRENT_TIMESTAMP
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
            broadcast_websocket_event(org_id, {
                "event": "organization_member_changed",
                "userId": user_id,
                "status": "active",
            })
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
            """SELECT count(*) FROM thanh_vien_to_chuc WHERE organization_id = ?
               AND COALESCE(trang_thai_thanh_vien, 'active') = 'active'""",
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

        if membership:
            cursor.execute(
                """UPDATE thanh_vien_to_chuc
                   SET vai_tro_trong_to_chuc = 'employee',
                       ten_nhan_su = ?, so_dien_thoai = ?, trang_thai_thanh_vien = 'active',
                       left_at = NULL, left_by = NULL, updated_at = CURRENT_TIMESTAMP
                   WHERE user_id = ? AND organization_id = ?""",
                (employee_name, phone or None, user_id, org_id),
            )
            audit_event = "organization.member_reactivated"
            success_message = "Đã thêm lại nhân viên vào tổ chức!"
        else:
            cursor.execute(
                """INSERT INTO thanh_vien_to_chuc (
                       user_id, organization_id, vai_tro_trong_to_chuc, ten_nhan_su, so_dien_thoai
                   ) VALUES (?, ?, ?, ?, ?)""",
                (user_id, org_id, 'employee', employee_name, phone or None)
            )
            audit_event = "organization.member_added"
            success_message = "Thêm nhân sự vào tổ chức thành công!"

        log_audit(
            audit_event,
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
        broadcast_websocket_event(org_id, {
            "event": "organization_member_changed",
            "userId": user_id,
            "status": "active",
        })

        return JSONResponse({"success": True, "message": success_message})
    except OrgPermissionError as e:
        return error_response(
            request,
            "ORG_ACCESS_DENIED",
            "Không có quyền truy cập tổ chức này.",
            status_code=403,
        )
    except IntegrityError as e:
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
    conn = None
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        data, json_error = await read_json_object(request)
        if json_error:
            return json_error
        invalid = validate_or_response(request, data, {
            "user_id": {"type": "string", "required": True, "min_length": 1, "max_length": 128},
            "successor_user_id": {"type": "string", "max_length": 128},
        })
        if invalid:
            return invalid
        user_id = data.get('user_id')
        successor_user_id = str(data.get('successor_user_id') or '').strip()
        if not user_id:
            return JSONResponse({"error": "Thiếu thông tin bắt buộc!"}, status_code=400)

        if str(user_id) == str(role_or_err.user_id):
            return JSONResponse({"error": "Không thể tự gỡ chính mình khỏi tổ chức."}, status_code=400)

        org_id = get_active_org(request, role_or_err.user_id)
        current_time = vietnam_now_sql()

        conn = database.get_connection()
        conn.execute("BEGIN")
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
            """SELECT vai_tro_trong_to_chuc FROM thanh_vien_to_chuc
               WHERE user_id = ? AND organization_id = ?
                 AND COALESCE(trang_thai_thanh_vien, 'active') = 'active'""",
            (user_id, org_id),
        )
        target_membership = cursor.fetchone()
        if not target_membership:
            conn.close()
            return JSONResponse({"error": "Nguoi dung khong thuoc to chuc hien tai."}, status_code=404)
        if str(target_membership[0] or "").strip().lower() == "manager":
            manager_count = int(cursor.execute(
                """SELECT count(*) FROM thanh_vien_to_chuc WHERE organization_id = ?
                   AND lower(trim(vai_tro_trong_to_chuc)) = 'manager'
                   AND COALESCE(trang_thai_thanh_vien, 'active') = 'active'""",
                (org_id,),
            ).fetchone()[0])
            if manager_count <= 1:
                conn.close()
                return JSONResponse({"error": "Không thể xóa Quản lý cuối cùng của tổ chức."}, status_code=409)

        assignment_rows = cursor.execute(
            """SELECT pc.*,
                      CASE
                        WHEN pc.loai_doi_tuong = 'goithau' THEN
                          (SELECT CASE WHEN gt.trang_thai IN ('AWARDED','CANCELLED') THEN 0 ELSE 1 END
                           FROM goi_thau gt WHERE gt.organization_id = pc.organization_id AND gt.id = pc.id_muc_tieu)
                        WHEN pc.loai_doi_tuong = 'hopdong' THEN
                          (SELECT CASE WHEN hd.trang_thai_hop_dong IN ('COMPLETED','LIQUIDATED','CANCELLED') THEN 0 ELSE 1 END
                           FROM hop_dong hd WHERE hd.organization_id = pc.organization_id AND hd.id = pc.id_muc_tieu)
                        ELSE 0
                      END AS is_open
               FROM phan_cong_nhan_su pc
               WHERE pc.id_nhan_vien = ? AND pc.organization_id = ?""",
            (user_id, org_id),
        ).fetchall()
        open_assignments = [row for row in assignment_rows if int(row['is_open'] or 0) == 1]
        if open_assignments and not successor_user_id:
            candidates = cursor.execute(
                """SELECT tv.user_id, COALESCE(NULLIF(tv.ten_nhan_su, ''), tk.ho_ten, tk.ten_dang_nhap) AS name
                   FROM thanh_vien_to_chuc tv JOIN tai_khoan tk ON tk.id = tv.user_id
                   WHERE tv.organization_id = ? AND tv.user_id != ?
                     AND COALESCE(tv.trang_thai_thanh_vien, 'active') = 'active'
                   ORDER BY lower(name)""",
                (org_id, user_id),
            ).fetchall()
            conn.rollback()
            return JSONResponse({
                "error": "Nhân sự còn công việc đang mở. Phải chọn người tiếp quản trước khi rời tổ chức.",
                "code": "SUCCESSOR_REQUIRED",
                "openAssignments": [
                    {"id": row['id'], "targetId": row['id_muc_tieu'], "type": row['loai_doi_tuong']}
                    for row in open_assignments
                ],
                "successorCandidates": [dict(row) for row in candidates],
            }, status_code=409)
        if successor_user_id:
            successor = cursor.execute(
                """SELECT 1 FROM thanh_vien_to_chuc WHERE organization_id = ? AND user_id = ?
                   AND COALESCE(trang_thai_thanh_vien, 'active') = 'active'""",
                (org_id, successor_user_id),
            ).fetchone()
            if not successor or successor_user_id == str(user_id):
                conn.rollback()
                return JSONResponse({"error": "Người tiếp quản không hợp lệ."}, status_code=400)

        for assignment in assignment_rows:
            is_open = int(assignment['is_open'] or 0) == 1
            successor = successor_user_id if is_open else None
            cursor.execute(
                """INSERT INTO phan_cong_nhan_su_lich_su
                   (organization_id, assignment_id, id_nhan_vien, id_muc_tieu, loai_doi_tuong,
                    assigned_at, ended_at, ended_by, successor_user_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (org_id, assignment['id'], user_id, assignment['id_muc_tieu'],
                 assignment['loai_doi_tuong'], assignment['created_at'], current_time,
                 role_or_err.user_id, successor),
            )
            if successor:
                existing = cursor.execute(
                    """SELECT 1 FROM phan_cong_nhan_su WHERE organization_id = ? AND id_nhan_vien = ?
                       AND id_muc_tieu = ? AND loai_doi_tuong = ?""",
                    (org_id, successor, assignment['id_muc_tieu'], assignment['loai_doi_tuong']),
                ).fetchone()
                if existing:
                    cursor.execute("DELETE FROM phan_cong_nhan_su WHERE id = ?", (assignment['id'],))
                else:
                    cursor.execute(
                        """UPDATE phan_cong_nhan_su SET id_nhan_vien = ?, row_version = row_version + 1,
                           sync_version = ?, updated_at = ? WHERE id = ? AND organization_id = ?""",
                        (successor, sync_version, current_time, assignment['id'], org_id),
                    )
            else:
                cursor.execute("DELETE FROM phan_cong_nhan_su WHERE id = ?", (assignment['id'],))

        cursor.execute(
            """UPDATE thanh_vien_to_chuc SET trang_thai_thanh_vien = 'left', left_at = ?, left_by = ?,
               updated_at = ? WHERE user_id = ? AND organization_id = ?""",
            (current_time, role_or_err.user_id, current_time, user_id, org_id),
        )

        cursor.execute("SELECT id FROM ma_tran_phan_quyen WHERE emp_id = ? AND organization_id = ?", (user_id, org_id))
        pq_rows = cursor.fetchall()
        for row in pq_rows:
            pq_id = row['id']
            cursor.execute("DELETE FROM ma_tran_phan_quyen WHERE id = ?", (pq_id,))
            cursor.execute(
                DELETED_RECORD_UPSERT_SQL,
                ("ma_tran_phan_quyen", pq_id, org_id, current_time, sync_version)
            )

        impact = {
            "rootCount": 1,
            "permissionRows": len(pq_rows),
            "assignments": len(assignment_rows),
            "transferredAssignments": len(open_assignments),
        }
        impact["totalCount"] = sum(impact.values())

        log_audit(
            "organization.member_left",
            actor_user_id=role_or_err.user_id,
            organization_id=org_id,
            target_type="organization_membership",
            target_id=f"{org_id}:{user_id}",
            request=request,
            metadata={"organization_id": org_id, "impact": impact, "successor_user_id": successor_user_id or None},
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


_DOCUMENT_EXPORT_FIELDS = ("financial", "identity", "signature")


async def list_former_organization_members_api(request):
    valid, session = verify_session(request)
    if not valid:
        return JSONResponse({"error": session}, status_code=403)
    org_id = get_active_org(request, session.user_id)
    conn = database.get_connection()
    try:
        cursor = conn.cursor()
        if not is_organization_manager(cursor, str(session), session.user_id, org_id):
            return JSONResponse({"error": "Không có quyền xem lịch sử nhân sự."}, status_code=403)
        rows = cursor.execute(
            """SELECT tv.user_id, COALESCE(NULLIF(tv.ten_nhan_su, ''), tk.ho_ten, tk.ten_dang_nhap) AS name,
                      tk.email, tv.so_dien_thoai AS phone, tv.left_at,
                      h.loai_doi_tuong AS type, h.id_muc_tieu AS target_id, h.successor_user_id
               FROM thanh_vien_to_chuc tv JOIN tai_khoan tk ON tk.id = tv.user_id
               LEFT JOIN phan_cong_nhan_su_lich_su h
                 ON h.organization_id = tv.organization_id AND h.id_nhan_vien = tv.user_id
               WHERE tv.organization_id = ? AND tv.trang_thai_thanh_vien = 'left'
               ORDER BY tv.left_at DESC, h.ended_at DESC""",
            (org_id,),
        ).fetchall()
        members = {}
        for row in rows:
            member = members.setdefault(row['user_id'], {
                "id": row['user_id'], "name": row['name'], "email": row['email'] or "",
                "phone": row['phone'] or "", "status": "left", "leftAt": row['left_at'],
                "assignmentHistory": [],
            })
            if row['target_id']:
                member["assignmentHistory"].append({
                    "type": row['type'], "targetId": row['target_id'],
                    "successorUserId": row['successor_user_id'],
                })
        return JSONResponse(list(members.values()))
    finally:
        conn.close()


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


async def get_document_export_capabilities_api(request):
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


async def update_document_export_capabilities_api(request):
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

        organization_id = get_active_org(request, role_or_error.user_id)
        conn = database.get_connection()
        conn.execute("BEGIN")
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
                   updated_at = CURRENT_TIMESTAMP""",
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
    except IntegrityError as exc:
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
