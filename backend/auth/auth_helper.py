import hashlib
import os
import secrets
import threading
import time
from datetime import datetime
from backend.db.db_helper import database
from backend.shared.client_ip import get_client_ip, is_client_ip_allowed
from backend.auth.roles import effective_access_roles, normalize_platform_role
from backend.auth.session_store import load_session_user, session_invalid_reason, touch_session

ROLE_HIERARCHY = {
    'super_admin': effective_access_roles('super_admin'),
    'user': ['user'],
}

PASSWORD_HASH_ITERATIONS = int(os.environ.get("PASSWORD_HASH_ITERATIONS", "310000"))
PRIVILEGED_REAUTH_TTL_SECONDS = max(
    60,
    int(os.environ.get("PRIVILEGED_REAUTH_TTL_SECONDS", "600")),
)
PRIVILEGED_REAUTH_REQUIRED = "Cần xác thực lại mật khẩu để thực hiện thao tác quản trị nhạy cảm."
SUPER_ADMIN_NETWORK_DENIED = "Truy cập bị từ chối: mạng hiện tại không được phép dùng quyền quản trị tối cao."

SESSION_ACTIVITY_TOUCH_SECONDS = max(
    30, int(os.environ.get("SESSION_ACTIVITY_TOUCH_SECONDS", "60"))
)
SESSION_IDLE_TIMEOUT_SECONDS = max(
    60, int(os.environ.get("SESSION_INACTIVITY_TIMEOUT_HOURS", "10")) * 3600
)


def get_effective_roles(role_str):
    platform_role = normalize_platform_role(role_str)
    return set(ROLE_HIERARCHY[platform_role])

def hash_password(password: str, salt: str = None) -> str:
    if salt is None:
        salt = secrets.token_hex(16)
    pwd_hash = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), PASSWORD_HASH_ITERATIONS)
    return f"pbkdf2_sha256${PASSWORD_HASH_ITERATIONS}${salt}${pwd_hash.hex()}"

def verify_password(stored_password: str, provided_password: str) -> bool:
    try:
        if not stored_password:
            return False

        if stored_password.startswith("pbkdf2_sha256$"):
            parts = stored_password.split("$", 3)
            if len(parts) != 4:
                return False
            _, iterations_raw, salt, stored_hash = parts
            iterations = int(iterations_raw)
            pwd_hash = hashlib.pbkdf2_hmac('sha256', provided_password.encode('utf-8'), salt.encode('utf-8'), iterations)
            return secrets.compare_digest(stored_hash, pwd_hash.hex())

        return False
    except Exception:
        return False

def password_needs_rehash(stored_password: str) -> bool:
    try:
        if not stored_password:
            return True

        if stored_password.startswith("pbkdf2_sha256$"):
            parts = stored_password.split("$", 3)
            if len(parts) != 4:
                return True
            iterations = int(parts[1])
            return iterations < PASSWORD_HASH_ITERATIONS

        return True
    except Exception:
        return True




_session_cache = {}
_session_cache_lock = threading.Lock()
SESSION_CACHE_TTL = 60

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
    def __new__(cls, role, user_id, session_id=None):
        instance = super().__new__(cls, role)
        instance.user_id = user_id
        instance.session_id = session_id
        return instance


def verify_super_admin_controls(request, user, *, require_reauth=None):
    """Apply network allowlisting and recent password step-up after authentication."""
    if not is_client_ip_allowed(get_client_ip(request)):
        return False, SUPER_ADMIN_NETWORK_DENIED
    unsafe_method = str(getattr(request, "method", "GET") or "GET").upper() not in {
        "GET", "HEAD", "OPTIONS"
    }
    should_require_reauth = unsafe_method if require_reauth is None else bool(require_reauth)
    if should_require_reauth:
        try:
            reauthenticated_at = int(user.get("privileged_reauth_at") or 0)
        except (TypeError, ValueError):
            reauthenticated_at = 0
        if reauthenticated_at <= 0 or time.time() - reauthenticated_at > PRIVILEGED_REAUTH_TTL_SECONDS:
            return False, PRIVILEGED_REAUTH_REQUIRED
    return True, None

def verify_session(request, required_role=None):
    token = (request.cookies.get('session_token') or '').strip()
    if not token:
        return False, "Thiếu thông tin xác thực phiên làm việc!"

    # Read persistent state on every authorization decision so a revocation made
    # by another worker takes effect immediately instead of waiting for cache TTL.
    user = load_session_user(database, token)
    now = int(time.time())
    if (
        user
        and not session_invalid_reason(user, now)
        and now - int(user.get("last_seen_at") or 0) >= SESSION_ACTIVITY_TOUCH_SECONDS
    ):
        touch_session(
            database,
            user,
            idle_timeout_seconds=SESSION_IDLE_TIMEOUT_SECONDS,
            now=now,
        )
    if not user:
        return False, "Phiên làm việc đã hết hạn hoặc không hợp lệ!"
    if session_invalid_reason(user):
        _session_cache_invalidate(token)
        return False, "Phiên đăng nhập đã hết hạn! Vui lòng đăng nhập lại."

    if required_role and required_role not in get_effective_roles(user['vai_tro']):
        return False, "Bạn không có quyền thực hiện thao tác này!"
    if required_role == 'super_admin':
        controls_valid, controls_error = verify_super_admin_controls(request, user)
        if not controls_valid:
            return False, controls_error

    try:
        # Observability consumes only the opaque account ID. Usernames, email,
        # session tokens and other identity attributes never enter request logs.
        request.state.auth_user_id = str(user['id'])
    except (AttributeError, TypeError, KeyError):
        pass
    _session_cache_set(token, user)
    return True, SessionRole(
        normalize_platform_role(user['vai_tro']), user['id'], user.get('session_id')
    )
