from dataclasses import dataclass
import urllib.parse

from backend.db.db_helper import database
from backend.shared.workspace_scope import personal_scope_id


class OrgPermissionError(Exception):
    """Lỗi khi người dùng không có quyền truy cập vào tổ chức được yêu cầu."""


@dataclass(frozen=True)
class OrganizationContext:
    active_org_id: str
    membership_role: str
    organization_status: str
    scope_type: str = "organization"


def _attach_organization_context(request, context):
    try:
        request.state.organization_context = context
    except (AttributeError, TypeError):
        # Lightweight request doubles used in tests may not expose Starlette state.
        pass


def get_active_org(request, user_id):
    active_org = request.headers.get("X-Active-Org")
    if active_org:
        active_org = urllib.parse.unquote(active_org)

    # Membership is an authorization decision and must always be read from the
    # shared database. A process-local positive cache lets a removed member keep
    # using another worker until that worker's TTL expires.
    conn = database.get_connection()
    try:
        cursor = conn.cursor()
        account_row = cursor.execute(
            "SELECT vai_tro FROM tai_khoan WHERE id = ? LIMIT 1", (user_id,)
        ).fetchone()
        personal_scope_allowed = bool(
            account_row
            and str(account_row[0] or "").strip().lower() != "super_admin"
        )
        cursor.execute(
            """
            SELECT tc.id, tc.ten_to_chuc, tc.trang_thai,
                   tvtc.vai_tro_trong_to_chuc,
                   sub.status AS subscription_status, sub.expires_at,
                   pkg.trang_thai AS package_status
            FROM thanh_vien_to_chuc tvtc
            JOIN to_chuc tc ON tvtc.organization_id = tc.id
            LEFT JOIN organization_subscriptions sub ON sub.organization_id = tc.id
            LEFT JOIN goi_dich_vu pkg ON pkg.id = sub.package_id
            WHERE tvtc.user_id = ?
              AND COALESCE(tvtc.trang_thai_thanh_vien, 'active') = 'active'
            ORDER BY lower(tc.ten_to_chuc), tc.id
            """,
            (user_id,),
        )
        rows = cursor.fetchall()
    finally:
        conn.close()

    implicit_scope_id = personal_scope_id(user_id)
    if active_org == implicit_scope_id or not rows:
        if not personal_scope_allowed:
            raise OrgPermissionError(
                "Tài khoản quản trị nền tảng không có không gian cá nhân!"
            )
        if active_org and active_org != implicit_scope_id:
            raise OrgPermissionError("Không có quyền truy cập phạm vi dữ liệu này!")
        context = OrganizationContext(
            active_org_id=implicit_scope_id,
            membership_role="employee",
            organization_status="active",
            scope_type="personal",
        )
        _attach_organization_context(request, context)
        return context.active_org_id

    if active_org:
        selected_row = next((row for row in rows if active_org == row["id"]), None)
        if selected_row is None:
            raise OrgPermissionError("Không có quyền truy cập tổ chức này!")
    else:
        selected_row = rows[0]

    status = str(selected_row["trang_thai"] or "").strip().lower()
    if status != "active":
        raise OrgPermissionError("Tổ chức đang bị tạm ngưng!")
    membership_role = str(
        selected_row["vai_tro_trong_to_chuc"] or ""
    ).strip().lower()
    if membership_role not in {"manager", "employee"}:
        raise OrgPermissionError("Vai trò thành viên tổ chức không hợp lệ!")
    context = OrganizationContext(
        active_org_id=str(selected_row["id"]),
        membership_role=membership_role,
        organization_status=status,
        scope_type="organization",
    )
    _attach_organization_context(request, context)
    return context.active_org_id


def _org_cache_cleanup():
    """Compatibility hook; authorization contexts are no longer cached."""

    return None


def _org_cache_invalidate_by_user_id(user_id):
    """Compatibility hook; every authorization decision reads PostgreSQL."""

    del user_id
    return None
