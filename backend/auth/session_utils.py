"""Resolve the request's active personal or organization workspace."""

from dataclasses import dataclass
import time
import urllib.parse

from backend.db.db_helper import database
from backend.observability.recording import record_database_phase
from backend.shared.workspace_scope import personal_scope_id


class OrgPermissionError(Exception):
    """The account cannot access the requested workspace."""


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


def _personal_context(request, user_id: str, *, allowed: bool) -> str:
    if not allowed:
        raise OrgPermissionError(
            "Tài khoản quản trị nền tảng không có không gian cá nhân!"
        )
    context = OrganizationContext(
        active_org_id=personal_scope_id(user_id),
        membership_role="employee",
        organization_status="active",
        scope_type="personal",
    )
    _attach_organization_context(request, context)
    return context.active_org_id


def get_active_org(request, user_id, *, cursor=None):
    """Resolve authorization from PostgreSQL, optionally reusing a caller cursor.

    Reusing a cursor prevents nested pool leases on large sync reads. When an
    explicit organization header exists, only that membership is queried.
    """

    started_at = time.perf_counter()
    outcome = "ok"
    connection = None
    active_org = request.headers.get("X-Active-Org")
    if active_org:
        active_org = urllib.parse.unquote(active_org)

    if cursor is None:
        connection = database.get_connection()
        cursor = connection.cursor()

    try:
        account_row = cursor.execute(
            "SELECT vai_tro FROM tai_khoan WHERE id = ? LIMIT 1",
            (user_id,),
        ).fetchone()
        personal_scope_allowed = bool(
            account_row
            and str(account_row[0] or "").strip().lower() != "super_admin"
        )
        implicit_scope_id = personal_scope_id(user_id)

        if active_org == implicit_scope_id:
            return _personal_context(
                request,
                user_id,
                allowed=personal_scope_allowed,
            )

        if active_org:
            selected_row = cursor.execute(
                """
                SELECT tc.id, tc.trang_thai, tvtc.vai_tro_trong_to_chuc
                FROM thanh_vien_to_chuc AS tvtc
                JOIN to_chuc AS tc ON tc.id = tvtc.organization_id
                WHERE tvtc.user_id = ? AND tvtc.organization_id = ?
                  AND tvtc.trang_thai_thanh_vien = 'active'
                LIMIT 1
                """,
                (user_id, active_org),
            ).fetchone()
            if selected_row is None:
                raise OrgPermissionError(
                    "Không có quyền truy cập tổ chức này!"
                )
        else:
            selected_row = cursor.execute(
                """
                SELECT tc.id, tc.trang_thai, tvtc.vai_tro_trong_to_chuc
                FROM thanh_vien_to_chuc AS tvtc
                JOIN to_chuc AS tc ON tc.id = tvtc.organization_id
                WHERE tvtc.user_id = ?
                  AND tvtc.trang_thai_thanh_vien = 'active'
                ORDER BY lower(tc.ten_to_chuc), tc.id
                LIMIT 1
                """,
                (user_id,),
            ).fetchone()
            if selected_row is None:
                return _personal_context(
                    request,
                    user_id,
                    allowed=personal_scope_allowed,
                )

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
    except Exception:
        outcome = "error"
        raise
    finally:
        if connection is not None:
            connection.close()
        record_database_phase(
            "auth",
            "organization_lookup",
            time.perf_counter() - started_at,
            outcome=outcome,
        )
