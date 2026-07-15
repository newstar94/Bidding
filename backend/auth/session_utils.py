import time
import threading
from dataclasses import dataclass
from backend.db.db_helper import database

_org_cache = {}
_org_cache_lock = threading.Lock()
ORG_CACHE_TTL = 60

class OrgPermissionError(Exception):
    """Lỗi khi người dùng không có quyền truy cập vào tổ chức được yêu cầu."""
    pass


@dataclass(frozen=True)
class OrganizationContext:
    active_org_id: str
    membership_role: str
    organization_status: str


def _attach_organization_context(request, context):
    try:
        request.state.organization_context = context
    except (AttributeError, TypeError):
        # Lightweight request doubles used in tests may not expose Starlette state.
        pass



def get_active_org(request, user_id):
    active_org = request.headers.get('X-Active-Org')
    if active_org:
        import urllib.parse
        active_org = urllib.parse.unquote(active_org)

    cache_key = (user_id, active_org)
    now = time.time()
    with _org_cache_lock:
        if cache_key in _org_cache:
            val, expire = _org_cache[cache_key]
            if now < expire:
                if isinstance(val, Exception):
                    raise val
                _attach_organization_context(request, val)
                return val.active_org_id
            else:
                del _org_cache[cache_key]

    conn = database.get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT tc.id, tc.ten_to_chuc, tc.scope_type, tc.trang_thai,
               tvtc.vai_tro_trong_to_chuc,
               sub.status AS subscription_status, sub.expires_at,
               pkg.trang_thai AS package_status
        FROM thanh_vien_to_chuc tvtc
        JOIN to_chuc tc ON tvtc.organization_id = tc.id
        LEFT JOIN organization_subscriptions sub ON sub.organization_id = tc.id
        LEFT JOIN goi_dich_vu pkg ON pkg.id = sub.package_id
        WHERE tvtc.user_id = ?
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
        ORDER BY CASE tc.scope_type WHEN 'organization' THEN 0 ELSE 1 END,
                 lower(tc.ten_to_chuc), tc.id
    """, (user_id,))
    rows = cursor.fetchall()
    conn.close()


    if active_org:
        matched = False
        for row in rows:
            if active_org == row['id']:
                matched = True
                selected_row = row
                break
        if not matched:
            exc = OrgPermissionError("Không có quyền truy cập tổ chức này!")
            with _org_cache_lock:
                _org_cache[cache_key] = (exc, now + ORG_CACHE_TTL)
            raise exc
    else:
        if not rows:
            exc = OrgPermissionError("Tài khoản chưa thuộc tổ chức nào!")
            with _org_cache_lock:
                _org_cache[cache_key] = (exc, now + ORG_CACHE_TTL)
            raise exc
        else:
            selected_row = rows[0]

    status = str(selected_row['trang_thai'] or '').strip().lower()
    if status != 'active':
        exc = OrgPermissionError("Tổ chức đang bị tạm ngưng!")
        with _org_cache_lock:
            _org_cache[cache_key] = (exc, now + ORG_CACHE_TTL)
        raise exc
    subscription_status = str(selected_row['subscription_status'] or '').strip().lower()
    expires_at = selected_row['expires_at']
    package_status = str(selected_row['package_status'] or '').strip().lower()
    if subscription_status != 'active':
        exc = OrgPermissionError("Gói dịch vụ của tổ chức không hoạt động!")
        with _org_cache_lock:
            _org_cache[cache_key] = (exc, now + ORG_CACHE_TTL)
        raise exc
    if expires_at is not None and int(expires_at) <= int(now):
        exc = OrgPermissionError("Gói dịch vụ của tổ chức đã hết hạn!")
        with _org_cache_lock:
            _org_cache[cache_key] = (exc, now + ORG_CACHE_TTL)
        raise exc
    if package_status != 'active':
        exc = OrgPermissionError("Gói dịch vụ đang bị tạm khóa!")
        with _org_cache_lock:
            _org_cache[cache_key] = (exc, now + ORG_CACHE_TTL)
        raise exc
    membership_role = str(selected_row['vai_tro_trong_to_chuc'] or '').strip().lower()
    if membership_role not in {'manager', 'employee'}:
        raise OrgPermissionError("Vai trò thành viên tổ chức không hợp lệ!")
    context = OrganizationContext(
        active_org_id=str(selected_row['id']),
        membership_role=membership_role,
        organization_status=status,
    )

    with _org_cache_lock:
        _org_cache[cache_key] = (context, now + ORG_CACHE_TTL)

    _attach_organization_context(request, context)
    return context.active_org_id



def _org_cache_cleanup():
    """Dọn dẹp các org cache hết hạn. Gọi định kỳ mỗi 5 phút từ lifespan."""
    now = time.time()
    with _org_cache_lock:
        expired = [k for k, (_, exp) in _org_cache.items() if now > exp]
        for k in expired:
            del _org_cache[k]



def _org_cache_invalidate_by_user_id(user_id):
    """Xóa cache tổ chức của user để hiệu lực tức thì."""
    with _org_cache_lock:
        to_delete = [k for k in _org_cache.keys() if k[0] == user_id]
        for k in to_delete:
            _org_cache.pop(k, None)
