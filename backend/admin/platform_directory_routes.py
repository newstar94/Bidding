import math

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
        return JSONResponse({"error": role_or_error}, status_code=403), None
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
        return JSONResponse(
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
        return JSONResponse({"error": str(exc)}, status_code=400)
    except Exception as exc:
        log_error(exc, "list_platform_admin_users")
        return JSONResponse({"error": "Đã xảy ra lỗi tải danh sách người dùng."}, status_code=500)


async def list_admin_users_api(request):
    try:
        return await run_database_read(_list_admin_users_sync, request)
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        response = JSONResponse(
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
        return JSONResponse(
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
        return JSONResponse({"error": str(exc)}, status_code=400)
    except Exception as exc:
        log_error(exc, "list_platform_admin_organizations")
        return JSONResponse({"error": "Đã xảy ra lỗi tải danh sách tổ chức."}, status_code=500)


async def list_admin_organizations_api(request):
    try:
        return await run_database_read(_list_admin_organizations_sync, request)
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        response = JSONResponse(
            {"error": "Hệ thống đang xử lý nhiều yêu cầu dữ liệu. Vui lòng thử lại sau."},
            status_code=503,
        )
        response.headers["Retry-After"] = "1"
        return response


def platform_admin_directory_routes(Route):
    return [
        Route("/api/admin/users", list_admin_users_api, methods=["GET"]),
        Route("/api/admin/organizations", list_admin_organizations_api, methods=["GET"]),
    ]
