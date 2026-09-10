# Dynamic SQL fragments come only from fixed allowlists; request values stay bound.
# ruff: noqa: S608
import math
import time
from urllib.parse import quote

from starlette.responses import JSONResponse

from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError
from backend.shared.database_io import run_database_read
from backend.shared.helpers import database, log_error, verify_session


_DEFAULT_PAGE_SIZE = 25
_MAX_PAGE_SIZE = 100
_MAX_SEARCH_LENGTH = 100

_USER_SORT_COLUMNS = {
    "name": "lower(COALESCE(account.ho_ten, ''))",
    "username": "lower(COALESCE(account.ten_dang_nhap, ''))",
    "email": "lower(account.email)",
    "role": "account.vai_tro",
    "status": "account.trang_thai",
    "created_at": "account.created_at",
    "updated_at": "account.updated_at",
}
_ORGANIZATION_SORT_COLUMNS = {
    "name": "lower(organization.ten_to_chuc)",
    "status": "organization.trang_thai",
    "member_count": "COALESCE(member_counts.member_count, 0)",
    "created_at": "organization.created_at",
    "updated_at": "organization.updated_at",
}


class _InvalidDirectoryQuery(ValueError):
    pass


def _response(payload, *, status_code=200):
    return JSONResponse(
        payload,
        status_code=status_code,
        headers={"Cache-Control": "private, no-store"},
    )


def _json_value(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    isoformat = getattr(value, "isoformat", None)
    return isoformat() if callable(isoformat) else str(value)


def _parse_common_query(request, *, sort_columns, default_sort, allowed_filters):
    params = request.query_params
    supported = {"page", "pageSize", "search", "sortBy", "sortDir", *allowed_filters}
    unknown = sorted(set(params.keys()) - supported)
    if unknown:
        raise _InvalidDirectoryQuery("Tham số truy vấn không được hỗ trợ.")
    try:
        page = int(params.get("page") or 1)
        page_size = int(params.get("pageSize") or _DEFAULT_PAGE_SIZE)
    except (TypeError, ValueError) as exc:
        raise _InvalidDirectoryQuery("Phân trang không hợp lệ.") from exc
    if page < 1 or page_size < 1 or page_size > _MAX_PAGE_SIZE:
        raise _InvalidDirectoryQuery("Phân trang không hợp lệ.")

    search = str(params.get("search") or "").strip()
    if len(search) > _MAX_SEARCH_LENGTH:
        raise _InvalidDirectoryQuery("Từ khóa tìm kiếm quá dài.")
    sort_by = str(params.get("sortBy") or default_sort).strip()
    if sort_by not in sort_columns:
        raise _InvalidDirectoryQuery("Trường sắp xếp không hợp lệ.")
    sort_direction = str(params.get("sortDir") or "asc").strip().lower()
    if sort_direction not in {"asc", "desc"}:
        raise _InvalidDirectoryQuery("Chiều sắp xếp không hợp lệ.")
    return page, page_size, search, sort_by, sort_direction


def _pagination(page, page_size, total_rows):
    return {
        "page": page,
        "pageSize": page_size,
        "totalRows": total_rows,
        "totalPages": max(1, math.ceil(total_rows / page_size)),
    }


def _forbidden_or_role(request):
    valid, role_or_error = verify_session(request, required_role="super_admin")
    if not valid:
        return _response({"error": role_or_error}, status_code=403), None
    return None, role_or_error


def _list_admin_users_sync(request):
    denied, _role = _forbidden_or_role(request)
    if denied:
        return denied
    try:
        page, page_size, search, sort_by, sort_direction = _parse_common_query(
            request,
            sort_columns=_USER_SORT_COLUMNS,
            default_sort="name",
            allowed_filters={"role", "status", "organizationId"},
        )
        role_filter = str(request.query_params.get("role") or "").strip().lower()
        status_filter = str(request.query_params.get("status") or "").strip().lower()
        organization_id = str(request.query_params.get("organizationId") or "").strip()
        if role_filter not in {"", "super_admin", "user"}:
            raise _InvalidDirectoryQuery("Vai trò lọc không hợp lệ.")
        if status_filter not in {"", "active", "inactive"}:
            raise _InvalidDirectoryQuery("Trạng thái lọc không hợp lệ.")
        if len(organization_id) > 200:
            raise _InvalidDirectoryQuery("Tổ chức lọc không hợp lệ.")

        predicates = []
        values = []
        if search:
            term = f"%{search.lower()}%"
            predicates.append(
                "(lower(COALESCE(account.ho_ten, '')) LIKE ? "
                "OR lower(COALESCE(account.ten_dang_nhap, '')) LIKE ? "
                "OR lower(account.email) LIKE ?)"
            )
            values.extend((term, term, term))
        if role_filter:
            predicates.append("account.vai_tro = ?")
            values.append(role_filter)
        if status_filter:
            predicates.append("account.trang_thai = ?")
            values.append(status_filter)
        if organization_id:
            predicates.append(
                "EXISTS (SELECT 1 FROM thanh_vien_to_chuc filtered_membership "
                "WHERE filtered_membership.user_id = account.id "
                "AND filtered_membership.organization_id = ?)"
            )
            values.append(organization_id)
        where_sql = f" WHERE {' AND '.join(predicates)}" if predicates else ""

        connection = database.get_connection()
        try:
            cursor = connection.cursor()
            cursor.execute(f"SELECT COUNT(*) AS total_rows FROM tai_khoan account{where_sql}", tuple(values))
            total_rows = int(cursor.fetchone()["total_rows"])
            cursor.execute(
                f"""SELECT account.id, account.ten_dang_nhap AS username,
                           account.ho_ten AS name, account.vai_tro AS role,
                           account.email, account.anh_dai_dien AS avatar,
                           account.trang_thai AS status,
                           account.created_at, account.updated_at
                      FROM tai_khoan account{where_sql}
                     ORDER BY {_USER_SORT_COLUMNS[sort_by]} {sort_direction.upper()}, account.id ASC
                     LIMIT ? OFFSET ?""",
                (*values, page_size, (page - 1) * page_size),
            )
            rows = cursor.fetchall()
            user_ids = [row["id"] for row in rows]
            memberships_by_user = {user_id: [] for user_id in user_ids}
            if user_ids:
                placeholders = ",".join("?" for _ in user_ids)
                cursor.execute(
                    f"""SELECT membership.user_id, organization.id,
                               organization.ten_to_chuc AS name,
                               membership.vai_tro_trong_to_chuc AS role,
                               membership.ten_nhan_su AS employee_name,
                               membership.so_dien_thoai AS employee_phone,
                               membership.trang_thai_thanh_vien AS status
                          FROM thanh_vien_to_chuc membership
                          JOIN to_chuc organization
                            ON organization.id = membership.organization_id
                         WHERE membership.user_id IN ({placeholders})
                         ORDER BY lower(organization.ten_to_chuc), organization.id""",
                    tuple(user_ids),
                )
                for membership in cursor.fetchall():
                    memberships_by_user[membership["user_id"]].append(
                        {
                            "id": membership["id"],
                            "name": membership["name"],
                            "role": membership["role"],
                            "employeeName": membership["employee_name"],
                            "employeePhone": membership["employee_phone"],
                            "status": membership["status"],
                        }
                    )
        finally:
            connection.close()

        items = []
        for row in rows:
            organizations = memberships_by_user[row["id"]]
            items.append(
                {
                    "id": row["id"],
                    "username": row["username"],
                    "name": row["name"],
                    "role": row["role"],
                    "email": row["email"],
                    "avatar": row["avatar"],
                    "status": row["status"],
                    "createdAt": _json_value(row["created_at"]),
                    "updatedAt": _json_value(row["updated_at"]),
                    "organizationCount": len(organizations),
                    "organizations": organizations,
                }
            )
        return _response(
            {
                "items": items,
                "pagination": _pagination(page, page_size, total_rows),
                "sort": {"by": sort_by, "direction": sort_direction},
                "filters": {
                    "search": search,
                    "role": role_filter,
                    "status": status_filter,
                    "organizationId": organization_id,
                },
            }
        )
    except _InvalidDirectoryQuery as exc:
        return _response({"error": str(exc)}, status_code=400)
    except Exception as exc:  # noqa: BLE001 - keep database details private.
        log_error(exc, "list_platform_admin_users")
        return _response({"error": "Đã xảy ra lỗi tải danh sách người dùng."}, status_code=500)


async def list_admin_users_api(request):
    try:
        return await run_database_read(_list_admin_users_sync, request)
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        response = _response(
            {"error": "Hệ thống đang xử lý nhiều yêu cầu dữ liệu. Vui lòng thử lại sau."},
            status_code=503,
        )
        response.headers["Retry-After"] = "1"
        return response


def _list_admin_organizations_sync(request):
    denied, _role = _forbidden_or_role(request)
    if denied:
        return denied
    try:
        page, page_size, search, sort_by, sort_direction = _parse_common_query(
            request,
            sort_columns=_ORGANIZATION_SORT_COLUMNS,
            default_sort="name",
            allowed_filters={"status", "packageId", "subscriptionStatus"},
        )
        status_filter = str(request.query_params.get("status") or "").strip().lower()
        package_id = str(request.query_params.get("packageId") or "").strip()
        subscription_status = str(request.query_params.get("subscriptionStatus") or "").strip().lower()
        if status_filter not in {"", "active", "suspended"}:
            raise _InvalidDirectoryQuery("Trạng thái tổ chức không hợp lệ.")
        if subscription_status not in {"", "active", "expired", "suspended", "cancelled"}:
            raise _InvalidDirectoryQuery("Trạng thái thuê bao không hợp lệ.")
        if len(package_id) > 200:
            raise _InvalidDirectoryQuery("Gói dịch vụ lọc không hợp lệ.")

        predicates = []
        values = []
        if search:
            term = f"%{search.lower()}%"
            predicates.append("(lower(organization.ten_to_chuc) LIKE ? OR lower(organization.id) LIKE ?)")
            values.extend((term, term))
        if status_filter:
            predicates.append("organization.trang_thai = ?")
            values.append(status_filter)
        if package_id:
            predicates.append("subscription.package_id = ?")
            values.append(package_id)
        if subscription_status:
            predicates.append("subscription.status = ?")
            values.append(subscription_status)
        where_sql = f" WHERE {' AND '.join(predicates)}" if predicates else ""
        joins = " LEFT JOIN organization_subscriptions subscription ON subscription.organization_id = organization.id"

        connection = database.get_connection()
        try:
            cursor = connection.cursor()
            cursor.execute(
                f"SELECT COUNT(*) AS total_rows FROM to_chuc organization{joins}{where_sql}",
                tuple(values),
            )
            total_rows = int(cursor.fetchone()["total_rows"])
            cursor.execute(
                f"""SELECT organization.id, organization.ten_to_chuc AS name,
                           organization.trang_thai AS status,
                           organization.created_at, organization.updated_at,
                           COALESCE(member_counts.member_count, 0) AS member_count,
                           subscription.package_id, subscription.status AS subscription_status,
                           subscription.starts_at, subscription.expires_at,
                           subscription.member_quota, subscription.revision
                      FROM to_chuc organization
                      LEFT JOIN (
                          SELECT organization_id, COUNT(*) AS member_count
                            FROM thanh_vien_to_chuc
                           WHERE COALESCE(trang_thai_thanh_vien, 'active') = 'active'
                           GROUP BY organization_id
                      ) member_counts ON member_counts.organization_id = organization.id
                      {joins}{where_sql}
                     ORDER BY {_ORGANIZATION_SORT_COLUMNS[sort_by]} {sort_direction.upper()}, organization.id ASC
                     LIMIT ? OFFSET ?""",
                (*values, page_size, (page - 1) * page_size),
            )
            rows = cursor.fetchall()
        finally:
            connection.close()

        items = []
        for row in rows:
            subscription = None
            if row["package_id"] is not None:
                subscription = {
                    "packageId": row["package_id"],
                    "status": row["subscription_status"],
                    "startsAt": _json_value(row["starts_at"]),
                    "expiresAt": _json_value(row["expires_at"]),
                    "memberQuota": int(row["member_quota"] or 0),
                    "revision": int(row["revision"] or 0),
                }
            items.append(
                {
                    "id": row["id"],
                    "name": row["name"],
                    "status": row["status"],
                    "createdAt": _json_value(row["created_at"]),
                    "updatedAt": _json_value(row["updated_at"]),
                    "memberCount": int(row["member_count"] or 0),
                    "subscription": subscription,
                }
            )
        return _response(
            {
                "items": items,
                "pagination": _pagination(page, page_size, total_rows),
                "sort": {"by": sort_by, "direction": sort_direction},
                "filters": {
                    "search": search,
                    "status": status_filter,
                    "packageId": package_id,
                    "subscriptionStatus": subscription_status,
                },
            }
        )
    except _InvalidDirectoryQuery as exc:
        return _response({"error": str(exc)}, status_code=400)
    except Exception as exc:  # noqa: BLE001 - keep database details private.
        log_error(exc, "list_platform_admin_organizations")
        return _response({"error": "Đã xảy ra lỗi tải danh sách tổ chức."}, status_code=500)


async def list_admin_organizations_api(request):
    try:
        return await run_database_read(_list_admin_organizations_sync, request)
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        response = _response(
            {"error": "Hệ thống đang xử lý nhiều yêu cầu dữ liệu. Vui lòng thử lại sau."},
            status_code=503,
        )
        response.headers["Retry-After"] = "1"
        return response


_DETAIL_MEMBER_LIMIT = 20
_DETAIL_AUDIT_LIMIT = 10


def _subscription(row, prefix=""):
    package_id = row[f"{prefix}package_id"]
    if package_id is None:
        return None
    return {
        "packageId": package_id,
        "planVersionId": row[f"{prefix}plan_version_id"],
        "status": row[f"{prefix}subscription_status"],
        "source": row[f"{prefix}subscription_source"],
        "startsAt": _json_value(row[f"{prefix}starts_at"]),
        "expiresAt": _json_value(row[f"{prefix}expires_at"]),
        "memberQuota": (
            int(row[f"{prefix}member_quota"])
            if row[f"{prefix}member_quota"] is not None
            else None
        ),
        "revision": int(row[f"{prefix}subscription_revision"] or 0),
    }


def _audit_items(rows):
    return [
        {
            "id": row["id"],
            "action": row["action"],
            "actorUserId": row["actor_user_id"],
            "organizationId": row["organization_id"],
            "targetType": row["target_type"],
            "targetId": row["target_id"],
            "createdAt": _json_value(row["created_at"]),
        }
        for row in rows
    ]


def _user_detail(request):
    denied, _role = _forbidden_or_role(request)
    if denied:
        return denied
    user_id = str(request.path_params.get("user_id") or "").strip()
    if not user_id or len(user_id) > 200:
        return _response({"error": "Người dùng không hợp lệ."}, status_code=400)
    now = int(time.time())
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        row = cursor.execute(
            """SELECT account.id, account.ten_dang_nhap AS username,
                      account.ho_ten AS name, account.email, account.vai_tro AS role,
                      account.trang_thai AS status, account.created_at, account.updated_at,
                      subscription.package_id, subscription.plan_version_id,
                      subscription.status AS subscription_status,
                      subscription.source AS subscription_source,
                      subscription.starts_at, subscription.expires_at,
                      NULL AS member_quota, subscription.revision AS subscription_revision,
                      (SELECT MAX(last_seen_at) FROM auth_sessions WHERE user_id = account.id)
                        AS last_active_at,
                      (SELECT COUNT(*) FROM auth_sessions
                        WHERE user_id = account.id AND revoked_at IS NULL
                          AND idle_expires_at > ? AND absolute_expires_at > ?)
                        AS active_session_count
                 FROM tai_khoan account
                 LEFT JOIN account_subscriptions subscription
                   ON subscription.user_id = account.id
                WHERE account.id = ? LIMIT 1""",
            (now, now, user_id),
        ).fetchone()
        if not row:
            return _response({"error": "Người dùng không tồn tại."}, status_code=404)
        memberships = cursor.execute(
            """SELECT organization.id, organization.ten_to_chuc AS name,
                      membership.vai_tro_trong_to_chuc AS role,
                      membership.ten_nhan_su AS employee_name,
                      membership.so_dien_thoai AS employee_phone,
                      membership.trang_thai_thanh_vien AS status
                 FROM thanh_vien_to_chuc membership
                 JOIN to_chuc organization ON organization.id = membership.organization_id
                WHERE membership.user_id = ?
                ORDER BY lower(organization.ten_to_chuc), organization.id
                LIMIT ?""",
            (user_id, _DETAIL_MEMBER_LIMIT),
        ).fetchall()
        membership_total = int(cursor.execute(
            "SELECT COUNT(*) AS count FROM thanh_vien_to_chuc WHERE user_id = ?",
            (user_id,),
        ).fetchone()["count"])
        usage = cursor.execute(
            """SELECT COALESCE(SUM(event_count), 0) AS event_count,
                      MAX(last_seen_at) AS last_seen_at
                 FROM product_usage_hourly WHERE user_id = ?""",
            (user_id,),
        ).fetchone()
        audit = cursor.execute(
            """SELECT id, actor_user_id, organization_id, action,
                      target_type, target_id, created_at
                 FROM audit_log
                WHERE actor_user_id = ? OR target_id = ?
                ORDER BY created_at DESC, id DESC LIMIT ?""",
            (user_id, user_id, _DETAIL_AUDIT_LIMIT),
        ).fetchall()
    finally:
        connection.close()
    encoded_user_id = quote(user_id, safe="")
    return _response({
        "user": {
            "id": row["id"], "username": row["username"], "name": row["name"],
            "email": row["email"], "role": row["role"], "status": row["status"],
            "createdAt": _json_value(row["created_at"]),
            "updatedAt": _json_value(row["updated_at"]),
            "lastActiveAt": _json_value(row["last_active_at"]),
            "activeSessionCount": int(row["active_session_count"] or 0),
            "subscription": _subscription(row),
            "organizations": [
                {"id": item["id"], "name": item["name"], "role": item["role"],
                 "employeeName": item["employee_name"], "employeePhone": item["employee_phone"],
                 "status": item["status"]}
                for item in memberships
            ],
            "organizationCount": membership_total,
            "usage": {"eventCount": int(usage["event_count"] or 0),
                      "lastSeenAt": _json_value(usage["last_seen_at"])},
            "recentAudit": _audit_items(audit),
            "links": {
                "sessions": f"/admin/security?userId={encoded_user_id}",
                "subscription": f"/admin/subscriptions?ownerKind=account&search={encoded_user_id}",
                "usage": "/admin/analytics",
                "audit": f"/admin/audit?actorUserId={encoded_user_id}",
            },
        },
        "limits": {"organizations": _DETAIL_MEMBER_LIMIT, "audit": _DETAIL_AUDIT_LIMIT},
    })


def _organization_detail(request):
    denied, _role = _forbidden_or_role(request)
    if denied:
        return denied
    organization_id = str(request.path_params.get("organization_id") or "").strip()
    if not organization_id or len(organization_id) > 200:
        return _response({"error": "Tổ chức không hợp lệ."}, status_code=400)
    now = int(time.time())
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        row = cursor.execute(
            """SELECT organization.id, organization.ten_to_chuc AS name,
                      organization.trang_thai AS status,
                      organization.created_at, organization.updated_at,
                      subscription.package_id, subscription.plan_version_id,
                      subscription.status AS subscription_status,
                      subscription.source AS subscription_source,
                      subscription.starts_at, subscription.expires_at,
                      subscription.member_quota, subscription.revision AS subscription_revision,
                      (SELECT COUNT(*) FROM thanh_vien_to_chuc member
                        WHERE member.organization_id = organization.id
                          AND COALESCE(member.trang_thai_thanh_vien, 'active') = 'active')
                        AS member_count
                 FROM to_chuc organization
                 LEFT JOIN organization_subscriptions subscription
                   ON subscription.organization_id = organization.id
                WHERE organization.id = ? LIMIT 1""",
            (organization_id,),
        ).fetchone()
        if not row:
            return _response({"error": "Tổ chức không tồn tại."}, status_code=404)
        members = cursor.execute(
            """SELECT account.id, account.ho_ten AS name, account.email,
                      membership.vai_tro_trong_to_chuc AS role,
                      membership.ten_nhan_su AS employee_name,
                      membership.so_dien_thoai AS employee_phone,
                      membership.trang_thai_thanh_vien AS membership_status,
                      MAX(session.last_seen_at) AS last_active_at
                 FROM thanh_vien_to_chuc membership
                 JOIN tai_khoan account ON account.id = membership.user_id
                 LEFT JOIN auth_sessions session ON session.user_id = account.id
                WHERE membership.organization_id = ?
                GROUP BY account.id, account.ho_ten, account.email,
                         membership.vai_tro_trong_to_chuc,
                         membership.ten_nhan_su, membership.so_dien_thoai,
                         membership.trang_thai_thanh_vien
                ORDER BY CASE lower(trim(membership.vai_tro_trong_to_chuc))
                              WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END,
                         lower(COALESCE(account.ho_ten, account.email)), account.id
                LIMIT ?""",
            (organization_id, _DETAIL_MEMBER_LIMIT),
        ).fetchall()
        usage = cursor.execute(
            """SELECT COALESCE(SUM(event_count), 0) AS event_count,
                      MAX(last_seen_at) AS last_seen_at
                 FROM product_usage_hourly WHERE organization_id = ?""",
            (organization_id,),
        ).fetchone()
        active_sessions = int(cursor.execute(
            """SELECT COUNT(*) AS count FROM auth_sessions session
                JOIN thanh_vien_to_chuc membership ON membership.user_id = session.user_id
                WHERE membership.organization_id = ? AND session.revoked_at IS NULL
                  AND COALESCE(membership.trang_thai_thanh_vien, 'active') = 'active'
                  AND session.idle_expires_at > ? AND session.absolute_expires_at > ?""",
            (organization_id, now, now),
        ).fetchone()["count"])
        audit = cursor.execute(
            """SELECT id, actor_user_id, organization_id, action,
                      target_type, target_id, created_at
                 FROM audit_log WHERE organization_id = ?
                ORDER BY created_at DESC, id DESC LIMIT ?""",
            (organization_id, _DETAIL_AUDIT_LIMIT),
        ).fetchall()
    finally:
        connection.close()
    users = [
        {"id": item["id"], "name": item["name"], "email": item["email"],
         "role": item["role"], "status": item["membership_status"],
         "employeeName": item["employee_name"], "employeePhone": item["employee_phone"],
         "lastActiveAt": _json_value(item["last_active_at"])}
        for item in members
    ]
    primary_contact = next(
        (item for item in users
         if str(item["role"] or "").strip().lower() in {"owner", "manager"}
         and str(item["status"] or "active").strip().lower() == "active"),
        None,
    )
    encoded_organization_id = quote(organization_id, safe="")
    return _response({
        "organization": {
            "id": row["id"], "name": row["name"], "status": row["status"],
            "createdAt": _json_value(row["created_at"]),
            "updatedAt": _json_value(row["updated_at"]),
            "memberCount": int(row["member_count"] or 0),
            "primaryContact": primary_contact, "users": users,
            "subscription": _subscription(row),
            "usage": {"eventCount": int(usage["event_count"] or 0),
                      "lastSeenAt": _json_value(usage["last_seen_at"])},
            "security": {"activeSessionCount": active_sessions},
            "recentAudit": _audit_items(audit),
            "links": {
                "users": f"/admin/users?organizationId={encoded_organization_id}",
                "subscription": f"/admin/subscriptions?ownerKind=organization&search={encoded_organization_id}",
                "usage": "/admin/analytics",
                "activity": f"/admin/audit?organizationId={encoded_organization_id}",
                "security": "/admin/security",
            },
        },
        "limits": {"users": _DETAIL_MEMBER_LIMIT, "audit": _DETAIL_AUDIT_LIMIT},
    })


async def admin_user_detail_api(request):
    try:
        return await run_database_read(_user_detail, request)
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _response({"error": "Hệ thống đang bận. Vui lòng thử lại sau."}, status_code=503)
    except Exception as exc:  # noqa: BLE001 - keep database details private.
        log_error(exc, "platform_admin_user_detail")
        return _response({"error": "Đã xảy ra lỗi tải chi tiết người dùng."}, status_code=500)


async def admin_organization_detail_api(request):
    try:
        return await run_database_read(_organization_detail, request)
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _response({"error": "Hệ thống đang bận. Vui lòng thử lại sau."}, status_code=503)
    except Exception as exc:  # noqa: BLE001 - keep database details private.
        log_error(exc, "platform_admin_organization_detail")
        return _response({"error": "Đã xảy ra lỗi tải chi tiết tổ chức."}, status_code=500)


def platform_admin_directory_routes(Route):
    return [
        Route("/api/admin/users", list_admin_users_api, methods=["GET"]),
        Route("/api/admin/organizations", list_admin_organizations_api, methods=["GET"]),
        Route("/api/admin/users/{user_id}", admin_user_detail_api, methods=["GET"]),
        Route("/api/admin/organizations/{organization_id}", admin_organization_detail_api, methods=["GET"]),
    ]
