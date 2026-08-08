import hashlib
import os
import secrets
import time
from backend.db.db_helper import database
from backend.shared.client_ip import get_client_ip, is_client_ip_allowed
from backend.auth.roles import effective_access_roles, normalize_platform_role
from backend.auth.session_store import load_session_user, session_invalid_reason, touch_session
from argon2 import PasswordHasher, Type
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

ROLE_HIERARCHY = {
    'super_admin': effective_access_roles('super_admin'),
    'user': ['user'],
}

ARGON2_TIME_COST = max(2, min(6, int(os.environ.get("ARGON2_TIME_COST", "3"))))
ARGON2_MEMORY_COST_KIB = max(
    19_456, min(262_144, int(os.environ.get("ARGON2_MEMORY_COST_KIB", "65536")))
)
ARGON2_PARALLELISM = max(
    1, min(4, int(os.environ.get("ARGON2_PARALLELISM", "2")))
)
_PASSWORD_HASHER = PasswordHasher(
    time_cost=ARGON2_TIME_COST,
    memory_cost=ARGON2_MEMORY_COST_KIB,
    parallelism=ARGON2_PARALLELISM,
    hash_len=32,
    salt_len=16,
    type=Type.ID,
)
PRIVILEGED_REAUTH_TTL_SECONDS = max(
    60,
    int(os.environ.get("PRIVILEGED_REAUTH_TTL_SECONDS", "600")),
)
PRIVILEGED_REAUTH_REQUIRED = "Cần xác thực lại mật khẩu để thực hiện thao tác quản trị nhạy cảm."
SUPER_ADMIN_NETWORK_DENIED = "Truy cập bị từ chối: mạng hiện tại không được phép dùng quyền quản trị tối cao."
SESSION_ACTIVITY_TOUCH_SECONDS = max(
    60, int(os.environ.get("SESSION_ACTIVITY_TOUCH_SECONDS", "300"))
)
SESSION_IDLE_TIMEOUT_SECONDS = max(
    60, int(os.environ.get("SESSION_INACTIVITY_TIMEOUT_HOURS", "10")) * 3600
)


def get_effective_roles(role_str):
    platform_role = normalize_platform_role(role_str)
    return set(ROLE_HIERARCHY[platform_role])

def hash_password(password: str, salt: str = None) -> str:
    """Hash all new credentials with Argon2id and a library-generated salt."""
    del salt
    if not isinstance(password, str):
        raise TypeError("Password must be a string.")
    return _PASSWORD_HASHER.hash(password)

def verify_password(stored_password: str, provided_password: str) -> bool:
    try:
        if not stored_password:
            return False

        if stored_password.startswith("$argon2id$"):
            try:
                return bool(_PASSWORD_HASHER.verify(stored_password, provided_password))
            except (VerifyMismatchError, VerificationError, InvalidHashError):
                return False

        # Transitional verification only. A successful login is immediately
        # rehashed by the caller using Argon2id.
        if stored_password.startswith("pbkdf2_sha256$"):
            parts = stored_password.split("$", 3)
            if len(parts) != 4:
                return False
            _, iterations_raw, salt, stored_hash = parts
            iterations = int(iterations_raw)
            if not 100_000 <= iterations <= 10_000_000:
                return False
            pwd_hash = hashlib.pbkdf2_hmac('sha256', provided_password.encode('utf-8'), salt.encode('utf-8'), iterations)
            return secrets.compare_digest(stored_hash, pwd_hash.hex())

        return False
    except (AttributeError, TypeError, UnicodeError, ValueError):
        return False

def password_needs_rehash(stored_password: str) -> bool:
    try:
        if not stored_password:
            return True

        if stored_password.startswith("$argon2id$"):
            return _PASSWORD_HASHER.check_needs_rehash(stored_password)

        return True
    except (InvalidHashError, VerificationError, TypeError, ValueError):
        return True




def _load_request_session_user(request, token):
    """Load one persistent session snapshot per request, never across requests."""

    state = getattr(request, "state", None)
    if (
        state is not None
        and getattr(state, "auth_session_token", None) == token
        and hasattr(state, "auth_session_user")
    ):
        return state.auth_session_user

    user = load_session_user(database, token)
    if state is not None:
        state.auth_session_token = token
        state.auth_session_user = user
    return user

class SessionRole(str):
    def __new__(
        cls,
        role,
        user_id,
        session_id=None,
        *,
        platform_role=None,
        active_role=None,
    ):
        instance = super().__new__(cls, role)
        instance.user_id = user_id
        instance.session_id = session_id
        instance.platform_role = platform_role or role
        instance.active_role = active_role
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


def verify_recent_reauthentication(user):
    try:
        reauthenticated_at = int(user.get("privileged_reauth_at") or 0)
    except (AttributeError, TypeError, ValueError):
        reauthenticated_at = 0
    if (
        reauthenticated_at <= 0
        or time.time() - reauthenticated_at > PRIVILEGED_REAUTH_TTL_SECONDS
    ):
        return False, PRIVILEGED_REAUTH_REQUIRED
    return True, None

def verify_session(request, required_role=None):
    token = (request.cookies.get('session_token') or '').strip()
    if not token:
        return False, "Thiếu thông tin xác thực phiên làm việc!"

    # The snapshot lives only on this request. A new request always reloads
    # PostgreSQL, so revocation by another worker takes effect immediately.
    user = _load_request_session_user(request, token)
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
    invalid_reason = session_invalid_reason(user)
    if invalid_reason:
        return False, "Phiên đăng nhập đã hết hạn! Vui lòng đăng nhập lại."

    platform_role = normalize_platform_role(user['vai_tro'])
    requested_active_role = str(user.get('active_role') or '').strip().lower()
    allowed_active_roles = (
        {'super_admin', 'manager', 'employee'}
        if platform_role == 'super_admin'
        else {'manager', 'employee'}
    )
    active_role = (
        requested_active_role
        if requested_active_role in allowed_active_roles
        else None
    )
    effective_role = active_role or platform_role

    if required_role and (
        required_role not in get_effective_roles(user['vai_tro'])
        or required_role not in get_effective_roles(effective_role)
    ):
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
    return True, SessionRole(
        effective_role,
        user['id'],
        user.get('session_id'),
        platform_role=platform_role,
        active_role=active_role,
    )
