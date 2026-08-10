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
    log_audit,
    OrgPermissionError
)
from backend.sync.websocket import enqueue_websocket_event
from backend.sync.repository import next_sync_version
from backend.shared.access_policy import (
    is_business_organization,
    is_organization_manager,
    is_personal_workspace_owner,
    resolve_document_export_capabilities,
)
from backend.shared.logging_utils import error_response, log_and_error
from backend.shared.idempotency import acquire_idempotency_lock
from backend.shared.membership_invariants import (
    lock_organization_membership_invariants,
)
from backend.shared.request_validation import read_json_object, validate_or_response
from backend.shared.date_utils import vietnam_date_from_epoch, vietnam_now_sql
from backend.notifications.service import (
    queue_assignment_state_changes,
    queue_membership_notification,
    snapshot_assignment_state,
)
from backend.activity.service import (
    build_assignment_activity_events,
    insert_activity_events,
)


_IDEMPOTENCY_KEY_RE = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")
_QUERY_CHUNK_SIZE = 500


def _insert_assignment_departure_history(
    cursor,
    organization_id,
    removed_user_id,
    assignment_changes,
    current_time,
    ended_by,
):
    history_rows = [
        (
            organization_id,
            assignment["id"],
            removed_user_id,
            assignment["id_muc_tieu"],
            assignment["loai_doi_tuong"],
            assignment["created_at"],
            current_time,
            ended_by,
            successor,
        )
        for assignment, successor, _delete_assignment in assignment_changes
    ]
    for offset in range(0, len(history_rows), _QUERY_CHUNK_SIZE):
        chunk = history_rows[offset:offset + _QUERY_CHUNK_SIZE]
        value_sql = ", ".join("(" + ", ".join("?" for _ in row) + ")" for row in chunk)
        cursor.execute(
            f"""INSERT INTO phan_cong_nhan_su_lich_su
                (organization_id, assignment_id, id_nhan_vien, id_muc_tieu,
                 loai_doi_tuong, assigned_at, ended_at, ended_by, successor_user_id)
                VALUES {value_sql}""",
            tuple(value for row in chunk for value in row),
        )


def _apply_assignment_departures(
    cursor,
    organization_id,
    assignment_changes,
    sync_version,
    current_time,
):
    assignment_ids_to_delete = [
        str(assignment["id"])
        for assignment, _successor, delete_assignment in assignment_changes
        if delete_assignment
    ]
    for offset in range(0, len(assignment_ids_to_delete), _QUERY_CHUNK_SIZE):
        chunk = assignment_ids_to_delete[offset:offset + _QUERY_CHUNK_SIZE]
        placeholders = ", ".join("?" for _ in chunk)
        cursor.execute(
            f"""DELETE FROM phan_cong_nhan_su
                WHERE organization_id = ? AND id IN ({placeholders})""",
            (organization_id, *chunk),
        )

    transfers = [
        (str(assignment["id"]), successor)
        for assignment, successor, delete_assignment in assignment_changes
        if successor and not delete_assignment
    ]
    for offset in range(0, len(transfers), _QUERY_CHUNK_SIZE):
        chunk = transfers[offset:offset + _QUERY_CHUNK_SIZE]
        value_sql = ", ".join("(?, ?)" for _ in chunk)
        cursor.execute(
            f"""UPDATE phan_cong_nhan_su AS assignment
                SET id_nhan_vien = transfer.successor_user_id,
                    row_version = assignment.row_version + 1,
                    sync_version = ?,
                    updated_at = ?
                FROM (VALUES {value_sql}) AS transfer(assignment_id, successor_user_id)
                WHERE assignment.organization_id = ?
                  AND assignment.id = transfer.assignment_id""",
            (
                sync_version,
                current_time,
                *(value for transfer in chunk for value in transfer),
                organization_id,
            ),
        )


def _assignments_requiring_successor(
    cursor,
    organization_id,
    removed_user_id,
    assignment_rows,
):
    """Only singleton package/contract memberships require a handover."""

    candidates = [
        row for row in assignment_rows
        if str(row["loai_doi_tuong"] or "") in {"goithau", "hopdong"}
    ]
    target_pairs = list(dict.fromkeys(
        (str(row["loai_doi_tuong"]), str(row["id_muc_tieu"]))
        for row in candidates
    ))
    if not target_pairs:
        return []
    value_sql = ", ".join("(?, ?)" for _ in target_pairs)
    remaining_pairs = {
        (str(row[0]), str(row[1]))
        for row in cursor.execute(
            f"""SELECT DISTINCT assignment.loai_doi_tuong, assignment.id_muc_tieu
                FROM phan_cong_nhan_su AS assignment
                JOIN (VALUES {value_sql}) AS target(loai_doi_tuong, id_muc_tieu)
                  ON target.loai_doi_tuong = assignment.loai_doi_tuong
                 AND target.id_muc_tieu = assignment.id_muc_tieu
                JOIN thanh_vien_to_chuc AS membership
                  ON membership.organization_id = assignment.organization_id
                 AND membership.user_id = assignment.id_nhan_vien
                 AND COALESCE(membership.trang_thai_thanh_vien, 'active') = 'active'
                WHERE assignment.organization_id = ?
                  AND assignment.id_nhan_vien != ?""",
            (
                *(value for pair in target_pairs for value in pair),
                organization_id,
                removed_user_id,
            ),
        ).fetchall()
    }
    return [
        row for row in candidates
        if (str(row["loai_doi_tuong"]), str(row["id_muc_tieu"]))
        not in remaining_pairs
    ]

def _delete_member_permissions(
    cursor,
    user_id,
    organization_id,
    current_time,
    sync_version,
):
    return cursor.execute(
        """WITH deleted_permissions AS (
               DELETE FROM ma_tran_phan_quyen
               WHERE emp_id = ? AND organization_id = ?
               RETURNING id
           )
           INSERT INTO deleted_records
               (table_name, record_id, organization_id, deleted_at, delete_version)
           SELECT 'ma_tran_phan_quyen', id, ?, ?, ?
           FROM deleted_permissions
           ON CONFLICT(organization_id, table_name, record_id) DO UPDATE SET
               deleted_at = excluded.deleted_at,
               delete_version = GREATEST(
                   COALESCE(deleted_records.delete_version, 0),
                   COALESCE(excluded.delete_version, 0)
               )
           RETURNING record_id AS id""",
        (user_id, organization_id, organization_id, current_time, sync_version),
    ).fetchall()


def _subscription_payload(cursor, organization_id, *, for_update=False):
    lock_clause = " FOR UPDATE OF sub" if for_update else ""
    row = cursor.execute(
        f"""
        SELECT sub.organization_id, sub.package_id, sub.status, sub.starts_at,
               sub.expires_at, sub.member_quota, sub.revision,
               (SELECT count(*) FROM thanh_vien_to_chuc members
                WHERE members.organization_id = sub.organization_id
                  AND COALESCE(members.trang_thai_thanh_vien, 'active') = 'active') AS member_count
        FROM organization_subscriptions sub
        WHERE sub.organization_id = ?
        {lock_clause}
        """,
        (organization_id,),
    ).fetchone()
    if not row:
        return None
    result = dict(row)
    result["start_date"] = vietnam_date_from_epoch(result["starts_at"])
    result["end_date"] = vietnam_date_from_epoch(result["expires_at"])
    return result


def _lock_organization_member_quota(cursor, organization_id):
    """Lock the subscription row and count active members in that lock scope."""

    subscription = cursor.execute(
        """
        SELECT sub.status, sub.expires_at, sub.member_quota,
               tc.trang_thai AS organization_status,
               pkg.trang_thai AS package_status
        FROM organization_subscriptions sub
        JOIN to_chuc tc ON tc.id = sub.organization_id
        JOIN goi_dich_vu pkg ON pkg.id = sub.package_id
        WHERE sub.organization_id = ?
        FOR UPDATE OF sub
        """,
        (organization_id,),
    ).fetchone()
    if not subscription:
        return None, 0
    member_count = int(cursor.execute(
        """SELECT count(*) FROM thanh_vien_to_chuc
           WHERE organization_id = ?
             AND COALESCE(trang_thai_thanh_vien, 'active') = 'active'""",
        (organization_id,),
    ).fetchone()[0])
    return subscription, member_count


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
        acquire_idempotency_lock(
            cursor,
            "organization_subscription",
            organization_id,
            role_or_err.user_id,
            action,
            idempotency_key,
        )
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

        lock_organization_membership_invariants(cursor, organization_id)
        current = _subscription_payload(
            cursor, organization_id, for_update=True
        )
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
        if action == "lock":
            for user_id in member_ids:
                enqueue_websocket_event(
                    cursor,
                    "revoke_user",
                    user_id=user_id,
                )
        enqueue_websocket_event(
            cursor,
            "broadcast",
            organization_id=organization_id,
            payload={"event": "organization_subscription_changed"},
        )
        conn.commit()
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
            cursor, role_or_err, role_or_err.user_id, org_id
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
            enqueue_websocket_event(
                cursor,
                "broadcast",
                organization_id=org_id,
                payload={
                    "event": "organization_member_changed",
                    "userId": user_id,
                    "status": "active",
                },
            )
            conn.commit()
            return JSONResponse({"success": True, "message": "Thông tin nhân sự đã được cập nhật!"})

        cursor.execute(
            """SELECT vai_tro FROM tai_khoan
               WHERE id = ? AND trang_thai = 'active'""",
            (user_id,),
        )
        u_row = cursor.fetchone()
        if not u_row:
            conn.rollback()
            return JSONResponse(
                {"error": "Người dùng không tồn tại hoặc đã ngừng hoạt động."},
                status_code=404,
            )
        if 'super_admin' not in effective_roles and 'super_admin' in get_effective_roles(u_row['vai_tro'] or ''):
            conn.rollback()
            return JSONResponse({"error": "Ban khong co quyen them super_admin vao to chuc."}, status_code=403)

        subscription, member_count = _lock_organization_member_quota(
            cursor, org_id
        )
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
        queue_membership_notification(
            cursor,
            user_id=user_id,
            organization_id=org_id,
            added=True,
        )
        enqueue_websocket_event(
            cursor,
            "broadcast",
            organization_id=org_id,
            payload={
                "event": "organization_member_changed",
                "userId": user_id,
                "status": "active",
            },
        )
        conn.commit()

        return JSONResponse({"success": True, "message": success_message})
    except OrgPermissionError:
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
            "assignment_successors": {"type": "array", "max_length": 500},
        })
        if invalid:
            return invalid
        user_id = data.get('user_id')
        successor_user_id = str(data.get('successor_user_id') or '').strip()
        assignment_successor_rows = data.get('assignment_successors') or []
        if successor_user_id and assignment_successor_rows:
            return JSONResponse({
                "error": "Chỉ được chọn một cách chuyển giao công việc.",
                "code": "TRANSFER_MODE_CONFLICT",
            }, status_code=400)
        assignment_successors = {}
        for index, item in enumerate(assignment_successor_rows):
            if not isinstance(item, dict):
                return JSONResponse({
                    "error": "Danh sách người tiếp quản không hợp lệ.",
                    "code": "ASSIGNMENT_SUCCESSORS_INVALID",
                    "index": index,
                }, status_code=400)
            assignment_id = str(item.get('assignment_id') or '').strip()
            item_successor_id = str(item.get('successor_user_id') or '').strip()
            if (
                not assignment_id
                or not item_successor_id
                or len(assignment_id) > 128
                or len(item_successor_id) > 128
                or assignment_id in assignment_successors
            ):
                return JSONResponse({
                    "error": "Mỗi công việc phải có đúng một người tiếp quản hợp lệ.",
                    "code": "ASSIGNMENT_SUCCESSORS_INVALID",
                    "index": index,
                }, status_code=400)
            assignment_successors[assignment_id] = item_successor_id
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
            cursor, role_or_err, role_or_err.user_id, org_id
        ):
            conn.close()
            return JSONResponse({"error": "Bạn không có quyền thực hiện thao tác này!"}, status_code=403)
        lock_organization_membership_invariants(cursor, org_id)
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

        assignment_state_before = snapshot_assignment_state(cursor, org_id)
        assignment_rows = cursor.execute(
            """SELECT pc.*
               FROM phan_cong_nhan_su pc
               WHERE pc.id_nhan_vien = ? AND pc.organization_id = ?""",
            (user_id, org_id),
        ).fetchall()
        transfer_required_assignments = _assignments_requiring_successor(
            cursor,
            org_id,
            user_id,
            assignment_rows,
        )
        if transfer_required_assignments and not successor_user_id and not assignment_successors:
            candidates = cursor.execute(
                """SELECT tv.user_id, COALESCE(NULLIF(tv.ten_nhan_su, ''), tk.ho_ten, tk.ten_dang_nhap) AS name
                   FROM thanh_vien_to_chuc tv JOIN tai_khoan tk ON tk.id = tv.user_id
                   WHERE tv.organization_id = ? AND tv.user_id != ?
                     AND COALESCE(tv.trang_thai_thanh_vien, 'active') = 'active'
                     AND (
                         lower(trim(COALESCE(tv.vai_tro_trong_to_chuc, ''))) = 'employee'
                         OR tv.user_id = ?
                     )
                   ORDER BY lower(COALESCE(NULLIF(tv.ten_nhan_su, ''), tk.ho_ten, tk.ten_dang_nhap))""",
                (org_id, user_id, role_or_err.user_id),
            ).fetchall()
            conn.rollback()
            return JSONResponse({
                "error": "Nhân sự còn gói thầu hoặc hợp đồng đang phụ trách. Phải chọn người tiếp quản trước khi rời tổ chức.",
                "code": "SUCCESSOR_REQUIRED",
                "openAssignments": [
                    {"id": row['id'], "targetId": row['id_muc_tieu'], "type": row['loai_doi_tuong']}
                    for row in transfer_required_assignments
                ],
                "assignmentsRequiringTransfer": [
                    {"id": row['id'], "targetId": row['id_muc_tieu'], "type": row['loai_doi_tuong']}
                    for row in transfer_required_assignments
                ],
                "successorCandidates": [dict(row) for row in candidates],
            }, status_code=409)
        required_assignment_ids = {
            str(row['id']) for row in transfer_required_assignments
        }
        if assignment_successors and set(assignment_successors) != required_assignment_ids:
            conn.rollback()
            return JSONResponse({
                "error": "Danh sách công việc đã thay đổi hoặc chưa được phân công đầy đủ. Vui lòng thực hiện lại.",
                "code": "ASSIGNMENT_SUCCESSORS_INCOMPLETE",
                "missingAssignmentIds": sorted(required_assignment_ids - set(assignment_successors)),
            }, status_code=409)

        requested_successor_ids = (
            {successor_user_id}
            if successor_user_id
            else set(assignment_successors.values())
        )
        valid_successor_ids = set()
        if requested_successor_ids:
            placeholders = ", ".join("?" for _ in requested_successor_ids)
            valid_successor_ids = {
                str(row["user_id"])
                for row in cursor.execute(
                    f"""SELECT user_id FROM thanh_vien_to_chuc
                        WHERE organization_id = ?
                          AND user_id IN ({placeholders})
                          AND COALESCE(trang_thai_thanh_vien, 'active') = 'active'""",
                    (org_id, *sorted(requested_successor_ids)),
                ).fetchall()
            }
        if (
            valid_successor_ids != requested_successor_ids
            or str(user_id) in requested_successor_ids
        ):
            conn.rollback()
            return JSONResponse({"error": "Người tiếp quản không hợp lệ."}, status_code=400)

        existing_assignment_keys = set()
        if requested_successor_ids:
            placeholders = ", ".join("?" for _ in requested_successor_ids)
            existing_assignment_keys = {
                (
                    str(row["id_nhan_vien"]),
                    str(row["id_muc_tieu"]),
                    str(row["loai_doi_tuong"]),
                )
                for row in cursor.execute(
                    f"""SELECT id_nhan_vien, id_muc_tieu, loai_doi_tuong
                        FROM phan_cong_nhan_su
                        WHERE organization_id = ?
                          AND id_nhan_vien IN ({placeholders})""",
                    (org_id, *sorted(requested_successor_ids)),
                ).fetchall()
            }

        assignment_changes = []
        for assignment in assignment_rows:
            requires_transfer = str(assignment['id']) in required_assignment_ids
            successor = (
                successor_user_id or assignment_successors.get(str(assignment['id']))
            ) if requires_transfer else None
            delete_assignment = not successor
            if successor:
                assignment_key = (
                    str(successor),
                    str(assignment['id_muc_tieu']),
                    str(assignment['loai_doi_tuong']),
                )
                if assignment_key in existing_assignment_keys:
                    delete_assignment = True
                else:
                    existing_assignment_keys.add(assignment_key)
            assignment_changes.append((assignment, successor, delete_assignment))

        _insert_assignment_departure_history(
            cursor,
            org_id,
            user_id,
            assignment_changes,
            current_time,
            role_or_err.user_id,
        )
        _apply_assignment_departures(
            cursor,
            org_id,
            assignment_changes,
            sync_version,
            current_time,
        )

        cursor.execute(
            """UPDATE thanh_vien_to_chuc SET trang_thai_thanh_vien = 'left', left_at = ?, left_by = ?,
               updated_at = ? WHERE user_id = ? AND organization_id = ?""",
            (current_time, role_or_err.user_id, current_time, user_id, org_id),
        )

        pq_rows = _delete_member_permissions(
            cursor,
            user_id,
            org_id,
            current_time,
            sync_version,
        )

        impact = {
            "rootCount": 1,
            "permissionRows": len(pq_rows),
            "assignments": len(assignment_rows),
            "transferredAssignments": len(transfer_required_assignments),
        }
        impact["totalCount"] = sum(impact.values())

        log_audit(
            "organization.member_left",
            actor_user_id=role_or_err.user_id,
            organization_id=org_id,
            target_type="organization_membership",
            target_id=f"{org_id}:{user_id}",
            request=request,
            metadata={
                "organization_id": org_id,
                "impact": impact,
                "transfer_mode": "individual" if assignment_successors else "all" if successor_user_id else None,
                "successor_user_id": successor_user_id or None,
                "assignment_successors": assignment_successors or None,
            },
            cursor=cursor,
            required=True,
        )
        assignment_state_after = snapshot_assignment_state(cursor, org_id)
        insert_activity_events(
            cursor,
            organization_id=org_id,
            owner_type="organization",
            actor_user_id=role_or_err.user_id,
            occurred_at=current_time,
            events=build_assignment_activity_events(
                assignment_state_before,
                assignment_state_after,
                client_mutation_id=str(
                    getattr(request, "headers", {}).get("Idempotency-Key") or ""
                ).strip()[:128] or None,
            ),
        )
        queue_assignment_state_changes(
            cursor,
            organization_id=org_id,
            before=assignment_state_before,
            after=assignment_state_after,
        )
        queue_membership_notification(
            cursor,
            user_id=user_id,
            organization_id=org_id,
            added=False,
        )
        enqueue_websocket_event(
            cursor,
            "revoke_user",
            user_id=user_id,
        )
        enqueue_websocket_event(
            cursor,
            "broadcast",
            organization_id=org_id,
            payload={"event": "db_changed"},
        )
        conn.commit()
        conn.close()
        conn = None

        return JSONResponse({
            "success": True,
            "message": "Gỡ nhân sự khỏi tổ chức thành công!",
            "deleteImpact": impact,
        })
    except OrgPermissionError:
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
        if not is_organization_manager(cursor, session, session.user_id, org_id):
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
