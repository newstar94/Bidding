import hashlib
import secrets
import threading
import time
from datetime import datetime
from db_helper import database

ROLE_HIERARCHY = {
    'super_admin': ['super_admin', 'manager', 'employee'],
    'manager':     ['manager', 'employee'],
    'employee':    ['employee'],
}

def get_effective_roles(role_str):
    roles = [r.strip() for r in (role_str or '').split(',') if r.strip()]
    effective = set()
    for r in roles:
        effective.update(ROLE_HIERARCHY.get(r, [r]))
    return effective

def hash_password(password: str, salt: str = None) -> str:
    if salt is None:
        salt = secrets.token_hex(16)
    pwd_hash = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 100000)
    return f"{salt}:{pwd_hash.hex()}"

def verify_password(stored_password: str, provided_password: str) -> bool:
    try:
        if not stored_password:
            return False
        if ":" not in stored_password:
            return False
        salt, stored_hash = stored_password.split(":", 1)
        pwd_hash = hashlib.pbkdf2_hmac('sha256', provided_password.encode('utf-8'), salt.encode('utf-8'), 100000)
        return secrets.compare_digest(stored_hash, pwd_hash.hex())
    except Exception:
        return False

# ==========================================
# SESSION CACHE (In-memory, TTL 60 giây)
# ==========================================
_session_cache = {}          # token -> (user_dict, expire_at)
_session_cache_lock = threading.Lock()
SESSION_CACHE_TTL = 60      # giây

def _session_cache_get(token: str):
    with _session_cache_lock:
        entry = _session_cache.get(token)
        if entry and time.time() < entry[1]:
            return entry[0]
        if entry:
            del _session_cache[token]
    return None

def _session_cache_set(token: str, user_dict: dict):
    with _session_cache_lock:
        _session_cache[token] = (user_dict, time.time() + SESSION_CACHE_TTL)

def _session_cache_invalidate(token: str):
    with _session_cache_lock:
        _session_cache.pop(token, None)

def _session_cache_invalidate_by_user_id(user_id: str):
    """
    Xoá cache của tất cả session thuộc về user_id.
    Gọi khi vai trò hoặc gói dịch vụ của user bị thay đổi,
    để hiệu lực ngay lập tức thay vì chờ TTL 60 giây hết hạn.
    """
    with _session_cache_lock:
        to_delete = [
            token for token, (user_dict, _) in _session_cache.items()
            if user_dict.get('id') == user_id
        ]
        for token in to_delete:
            del _session_cache[token]

def _session_cache_cleanup():
    """Dọn dẹp các session hết hạn khỏi cache. Gọi định kỳ mỗi 5 phút."""
    now = time.time()
    with _session_cache_lock:
        expired_keys = [k for k, (_, exp) in _session_cache.items() if now > exp]
        for k in expired_keys:
            del _session_cache[k]

class SessionRole(str):
    def __new__(cls, role, user_id):
        instance = super().__new__(cls, role)
        instance.user_id = user_id
        return instance

def verify_session(request, required_role=None):
    token = request.cookies.get('session_token') or request.headers.get('X-Session-Token')
    username = request.cookies.get('username') or request.headers.get('X-Username')
    
    if not token or not username:
        return False, "Thiếu thông tin xác thực phiên làm việc!"

    if required_role == 'super_admin':
        # Kiểm tra IP allowlist cho quyền super_admin (Mục 12)
        import os
        allowlist_str = os.environ.get("SUPER_ADMIN_IP_ALLOWLIST", "127.0.0.1,::1,localhost")
        allowlist = [ip.strip() for ip in allowlist_str.split(",") if ip.strip()]
        
        if "*" not in allowlist:
            forwarded = request.headers.get('X-Forwarded-For')
            if forwarded:
                client_ip = forwarded.split(',')[0].strip()
            else:
                client_ip = getattr(request.client, 'host', 'unknown')
            if client_ip not in allowlist:
                return False, "Truy cập bị từ chối: IP không được phép truy cập quyền quản trị tối cao!"

    cached_user = _session_cache_get(token)
    if cached_user:
        if cached_user.get('token_phien') != token:
            _session_cache_invalidate(token)
        else:
            if required_role and required_role not in get_effective_roles(cached_user['vai_tro']):
                return False, "Bạn không có quyền thực hiện thao tác này!"
            return True, SessionRole(cached_user['vai_tro'], cached_user['id'])
    
    conn = database.get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM tai_khoan WHERE ten_dang_nhap = ? OR (email != '' AND email = ?)", (username, username))
    row = cursor.fetchone()
    conn.close()
    
    if not row:
        return False, "Tài khoản không tồn tại!"
        
    user = dict(row)
    if user['token_phien'] != token:
        return False, "Phiên làm việc đã hết hạn hoặc không hợp lệ!"

    if user.get('han_su_dung_token'):
        try:
            import time as _time
            if _time.time() > float(user['han_su_dung_token']):
                _session_cache_invalidate(token)
                return False, "Phiên đăng nhập đã hết hạn! Vui lòng đăng nhập lại."
        except Exception:
            pass
        
    if required_role and required_role not in get_effective_roles(user['vai_tro']):
        return False, "Bạn không có quyền thực hiện thao tác này!"



    _session_cache_set(token, user)
    return True, SessionRole(user['vai_tro'], user['id'])
