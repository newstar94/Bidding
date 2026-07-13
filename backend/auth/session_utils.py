import time
import threading
from backend.db.db_helper import database

_org_cache = {}
_org_cache_lock = threading.Lock()
ORG_CACHE_TTL = 60

class OrgPermissionError(Exception):
    """Lỗi khi người dùng không có quyền truy cập vào tổ chức được yêu cầu."""
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
                return val
            else:
                del _org_cache[cache_key]

    conn = database.get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT tc.id, tc.ten_to_chuc
        FROM thanh_vien_to_chuc tvtc
        JOIN to_chuc tc ON tvtc.to_chuc_id = tc.id
        WHERE tvtc.user_id = ?
    """, (user_id,))
    rows = cursor.fetchall()
    conn.close()


    if active_org:
        matched = False
        for row in rows:
            if active_org == row['id'] or active_org == row['ten_to_chuc']:
                matched = True
                result = row['id']
                break
        if not matched:

            if active_org == str(user_id):
                result = str(user_id)
            else:
                exc = OrgPermissionError("Không có quyền truy cập tổ chức này!")
                with _org_cache_lock:
                    _org_cache[cache_key] = (exc, now + ORG_CACHE_TTL)
                raise exc
    else:
        if not rows:
            result = str(user_id)
        else:
            result = rows[0]['id']

    with _org_cache_lock:
        _org_cache[cache_key] = (result, now + ORG_CACHE_TTL)

    return result



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
