import os
import sys
import json
import uuid
import time
import hashlib
import sqlite3
import urllib.parse
from datetime import datetime, timezone
from collections import defaultdict

from starlette.responses import JSONResponse

from backend.shared.helpers import (
    database,
    verify_session,
    verify_password,
    hash_password,
    password_needs_rehash,
    get_effective_roles,
    log_error,
    log_audit,
    _session_cache_invalidate,
    _session_cache_invalidate_by_user_id,
    get_active_org,
    _org_cache_invalidate_by_user_id,
    OrgPermissionError
)
from backend.auth.auth_helper import _session_cache_get, _session_cache_set
from backend.auth.auth_helper import (
    PRIVILEGED_REAUTH_TTL_SECONDS,
    SESSION_ACTIVITY_TOUCH_SECONDS,
    verify_super_admin_controls,
)
from backend.auth.session_store import (
    create_session,
    load_session_user,
    revoke_session,
    revoke_user_sessions,
    session_invalid_reason,
    set_session_reauthentication,
    touch_session,
)
from backend.auth.profile_validation import ProfileValidationError, validate_profile_email, validate_profile_fields
from backend.auth.identity import (
    conflict_payload,
    identity_conflict_code,
    normalize_username,
)
from backend.auth.password_policy import validate_new_password, validate_password_input
from backend.shared.numeric_utils import money_json_value, parse_vnd_amount
from backend.sync.api import disconnect_user_websockets
from backend.shared.logging_utils import error_response
from backend.shared.request_validation import validate_or_response
from backend.shared.access_policy import is_business_organization


from backend.auth.auth_service import (
    get_client_ip,
    get_rate_limit_decision,
    rate_limit_response,
    record_rate_limit_failure,
    build_user_access_payload,
    _SECURE_COOKIES,
    SESSION_EXPIRY_HOURS,
    SESSION_REMEMBER_EXPIRY_HOURS,
    SESSION_INACTIVITY_TIMEOUT_HOURS
)


def _active_org_hint(request):
    value = (request.headers.get('X-Active-Org') or '').strip()
    return urllib.parse.unquote(value) if value else None

async def login_api(request):
    conn = None
    try:
        ip = get_client_ip(request)
        ip_rate_key = f"login:{ip}"
        ip_limit = get_rate_limit_decision(ip_rate_key, consume_attempt=False)
        if not ip_limit.allowed:
            return rate_limit_response("Quá nhiều lần đăng nhập thất bại. Vui lòng thử lại sau.", ip_limit)

        data = await request.json()
        invalid = validate_or_response(request, data, {
            "username": {"type": "string", "required": True, "min_length": 1, "max_length": 320},
            "password": {"type": "string", "required": True, "min_length": 1, "max_length": 256},
            "remember": {"type": "boolean"},
        })
        if invalid:
            return invalid
        username = normalize_username(data.get('username'))
        password = data.get('password')
        remember = data.get('remember', False)

        username_rate_key = hashlib.sha256(username.lower().encode('utf-8')).hexdigest()
        user_rate_key = f"login_user:{username_rate_key}" if username else None
        user_limit = get_rate_limit_decision(user_rate_key, consume_attempt=False) if user_rate_key else None
        if user_limit and not user_limit.allowed:
            return rate_limit_response("Quá nhiều lần đăng nhập cho tài khoản này. Vui lòng thử lại sau.", user_limit)

        def record_failed_login():
            record_rate_limit_failure(ip_rate_key)
            if user_rate_key:
                record_rate_limit_failure(user_rate_key)
            log_audit(
                "auth.login_failed",
                request=request,
                metadata={"username": username}
            )

        if not username or not validate_password_input(password):
            record_failed_login()
            return JSONResponse({"error": "Vui lòng nhập tài khoản và mật khẩu!"}, status_code=400)

        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM tai_khoan WHERE username_norm = ? OR email_norm = ?",
            (username, username)
        )
        row = cursor.fetchone()

        if not row:
            record_failed_login()
            return JSONResponse({"error": "Tên đăng nhập hoặc mật khẩu không đúng"}, status_code=400)

        user = dict(row)
        if not verify_password(user['mat_khau'], password):
            record_failed_login()
            return JSONResponse({"error": "Tên đăng nhập hoặc mật khẩu không đúng"}, status_code=400)

        if password_needs_rehash(user.get('mat_khau')):
            cursor.execute("UPDATE tai_khoan SET mat_khau = ? WHERE id = ?", (hash_password(password), user['id']))

        if not user.get('da_xac_minh'):
            return JSONResponse({
                "error": "Tài khoản của bạn chưa được xác thực email. Vui lòng xác thực trước khi đăng nhập!",
                "unverified": True,
                "username": user['ten_dang_nhap']
            }, status_code=400)

        session_token = str(uuid.uuid4())
        expiry_hours = SESSION_REMEMBER_EXPIRY_HOURS if remember else SESSION_EXPIRY_HOURS
        token_expiry = int(time.time() + expiry_hours * 3600)
        device_info = json.dumps({
            "user_agent": request.headers.get("User-Agent", "")[:200],
            "ip": ip,
            "login_time": datetime.now(timezone.utc).isoformat()
        })
        create_session(
            cursor,
            user_id=user['id'],
            token=session_token,
            absolute_expires_at=token_expiry,
            idle_timeout_seconds=SESSION_INACTIVITY_TIMEOUT_HOURS * 3600,
            remember=remember,
            device_info=device_info,
        )
        _session_cache_invalidate_by_user_id(user['id'])
        access_payload = build_user_access_payload(
            cursor,
            user['id'],
            user['vai_tro'],
            _active_org_hint(request),
            user.get('ho_ten'),
        )
        conn.commit()
        log_audit(
            "auth.login_success",
            actor_user_id=user['id'],
            organization_id=access_payload['active_org_id'],
            target_type="tai_khoan",
            target_id=user['id'],
            request=request,
            metadata={"remember": remember}
        )

        response = JSONResponse({
            "success": True,
            "id": user['id'],
            "username": user['ten_dang_nhap'],
            "name": user['ho_ten'],
            **access_payload,
            "email": user['email'],
            "avatar": user.get('anh_dai_dien'),
            "inactivity_timeout_hours": SESSION_INACTIVITY_TIMEOUT_HOURS
        })



        cookie_max_age = (SESSION_REMEMBER_EXPIRY_HOURS if remember else SESSION_EXPIRY_HOURS) * 3600
        response.set_cookie("session_token", session_token, httponly=True, secure=_SECURE_COOKIES, samesite="lax", path="/", max_age=cookie_max_age)
        response.delete_cookie("username", path="/")
        return response
    except Exception as e:
        log_error(e, "login_api")
        return JSONResponse({"error": "Đã xảy ra lỗi khi đăng nhập. Vui lòng thử lại sau."}, status_code=500)
    finally:
        if conn:
            try: conn.close()
            except sqlite3.Error: pass

def _load_user_by_session_token(session_token):
    # Session revocation is security-sensitive and must be visible across workers.
    return load_session_user(database, session_token)


def _validate_token_expiry(session_token, user):
    del session_token
    return session_invalid_reason(user)


def _extend_session_if_needed(user):
    now = int(time.time())
    if now - int(user.get("last_seen_at") or 0) < SESSION_ACTIVITY_TOUCH_SECONDS:
        return False
    return touch_session(
        database,
        user,
        idle_timeout_seconds=SESSION_INACTIVITY_TIMEOUT_HOURS * 3600,
        now=now,
    )


def _get_access_for_session(user, request):
    conn = database.get_connection()
    try:
        cursor = conn.cursor()
        access = build_user_access_payload(
            cursor,
            user['id'],
            user['vai_tro'],
            _active_org_hint(request),
            user.get('ho_ten'),
        )
        conn.commit()
        return access
    finally:
        conn.close()


def _get_username_setup_state(user):
    needs_username = not user.get('ten_dang_nhap')
    if not needs_username:
        return False, "", False

    conn_suggest = database.get_connection()
    try:
        from backend.auth.username_validator import generate_suggested_username
        cursor_suggest = conn_suggest.cursor()
        suggested_username = generate_suggested_username(
            user.get('ho_ten', ''),
            user.get('email', ''),
            cursor_suggest
        )
    finally:
        conn_suggest.close()
    account_linked = bool(user.get('has_external_identity') and user.get('mat_khau'))
    return needs_username, suggested_username, account_linked


def build_session_bootstrap(request):
    """Return a read-only session snapshot for the HTML bootstrap payload."""
    session_token = (request.cookies.get('session_token') or '').strip()
    if not session_token:
        return {"valid": False, "reason": "missing_auth"}

    user = _load_user_by_session_token(session_token)
    invalid_reason = _validate_token_expiry(session_token, user)
    if invalid_reason:
        return {"valid": False, "reason": invalid_reason}

    needs_username, suggested_username, account_linked = _get_username_setup_state(user)
    access_payload = _get_access_for_session(user, request)
    _session_cache_set(session_token, user)
    return {
        "valid": True,
        "device_info": user.get('device_info'),
        "user": {
            "id": user['id'],
            "username": user['ten_dang_nhap'],
            "name": user['ho_ten'],
            **access_payload,
            "email": user['email'],
            "avatar": user.get('anh_dai_dien'),
            "inactivity_timeout_hours": SESSION_INACTIVITY_TIMEOUT_HOURS,
            "needs_username": needs_username,
            "suggested_username": suggested_username,
            "account_linked": account_linked
        }
    }


def _session_response(user, request):
    needs_username, suggested_username, account_linked = _get_username_setup_state(user)
    access_payload = _get_access_for_session(user, request)
    response = JSONResponse({
        "valid": True,
        "device_info": user.get('device_info'),
        "user": {
            "id": user['id'],
            "username": user['ten_dang_nhap'],
            "name": user['ho_ten'],
            **access_payload,
            "email": user['email'],
            "avatar": user.get('anh_dai_dien'),
            "inactivity_timeout_hours": SESSION_INACTIVITY_TIMEOUT_HOURS,
            "needs_username": needs_username,
            "suggested_username": suggested_username,
            "account_linked": account_linked
        }
    })

    return response


async def check_session_api(request):
    started_at = time.perf_counter()
    try:
        try:
            data = await request.json()
        except Exception:
            data = {}
        invalid = validate_or_response(request, data, {
            "remember": {"type": "boolean"},
        })
        if invalid:
            return invalid
        session_token = (request.cookies.get('session_token') or '').strip()
        remember = data.get('remember', False)

        if not session_token:
            return JSONResponse({"valid": False, "reason": "missing_auth"})

        user = _load_user_by_session_token(session_token)
        invalid_reason = _validate_token_expiry(session_token, user)
        if invalid_reason:
            return JSONResponse({"valid": False, "reason": invalid_reason})

        _extend_session_if_needed(user)
        _session_cache_set(session_token, user)
        response = _session_response(user, request)
        response.headers["Server-Timing"] = f"session-check;dur={(time.perf_counter() - started_at) * 1000:.1f}"
        return response
    except Exception as e:
        log_error(e, "check_session_api")
        return JSONResponse({"valid": False, "error": "Lỗi kiểm tra phiên làm việc."}, status_code=500)


async def update_profile_api(request):
    conn = None
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        data = await request.json()
        if 'organization_name' in data:
            return JSONResponse({
                "error": "Tên tổ chức là trường chỉ đọc trong hồ sơ cá nhân.",
                "code": "ORGANIZATION_NAME_READ_ONLY",
            }, status_code=400)
        invalid = validate_or_response(request, data, {
            "name": {"type": "string", "required": True, "max_length": 200},
            "email": {"type": "string", "required": True, "max_length": 320},
            "avatar": {"type": "string", "max_length": 8_000_000},
        })
        if invalid:
            return invalid
        try:
            name, email, avatar = validate_profile_fields(
                data.get('name', ''),
                data.get('email', ''),
                data.get('avatar', ''),
            )
        except ProfileValidationError as exc:
            return JSONResponse({"error": str(exc), "code": exc.code}, status_code=400)

        conn = database.get_connection()
        conn.execute("BEGIN IMMEDIATE")
        cursor = conn.cursor()

        cursor.execute("SELECT ten_dang_nhap FROM tai_khoan WHERE email_norm = ? AND id != ?", (email, role_or_err.user_id))
        if cursor.fetchone():
            conn.rollback()
            return JSONResponse(conflict_payload("EMAIL_ALREADY_EXISTS"), status_code=409)

        if avatar:
            cursor.execute("UPDATE tai_khoan SET ho_ten = ?, email = ?, email_norm = ?, anh_dai_dien = ? WHERE id = ?", (name, email, email, avatar, role_or_err.user_id))
        else:
            cursor.execute("UPDATE tai_khoan SET ho_ten = ?, email = ?, email_norm = ? WHERE id = ?", (name, email, email, role_or_err.user_id))

        cursor.execute(
            """
            SELECT ten_dang_nhap AS username, ho_ten AS name, email,
                   COALESCE(anh_dai_dien, '') AS avatar
            FROM tai_khoan
            WHERE id = ?
            """,
            (role_or_err.user_id,),
        )
        updated_profile = cursor.fetchone()
        if not updated_profile:
            conn.rollback()
            return JSONResponse({"error": "Tài khoản không còn tồn tại."}, status_code=404)

        conn.commit()
        _session_cache_invalidate_by_user_id(role_or_err.user_id)

        return JSONResponse({
            "success": True,
            "message": "Cập nhật thông tin tài khoản thành công!",
            "profile": dict(updated_profile),
        })
    except sqlite3.IntegrityError as e:
        if conn:
            conn.rollback()
        conflict_code = identity_conflict_code(e)
        if conflict_code:
            return JSONResponse(conflict_payload(conflict_code), status_code=409)
        log_error(e, "update_profile_api_integrity")
        return JSONResponse({"error": "Không thể cập nhật do xung đột dữ liệu."}, status_code=409)
    except Exception as e:
        if conn:
            conn.rollback()
        log_error(e, "update_profile_api")
        return JSONResponse({"error": "Đã xảy ra lỗi cập nhật hồ sơ."}, status_code=500)
    finally:
        if conn:
            try: conn.close()
            except sqlite3.Error: pass

async def change_password_api(request):
    conn = None
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        data = await request.json()
        invalid = validate_or_response(request, data, {
            "old_password": {"type": "string", "required": True, "min_length": 1, "max_length": 256},
            "new_password": {"type": "string", "required": True, "min_length": 1, "max_length": 256},
        })
        if invalid:
            return invalid
        old_password = data.get('old_password')
        new_password = data.get('new_password')

        if not validate_password_input(old_password) or not isinstance(new_password, str):
            return JSONResponse({"error": "Vui lòng nhập đầy đủ mật khẩu cũ và mới!"}, status_code=400)

        valid_password, password_error = validate_new_password(new_password)
        if not valid_password:
            return JSONResponse({"error": password_error, "code": "PASSWORD_POLICY_FAILED"}, status_code=400)

        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT mat_khau, id FROM tai_khoan WHERE id = ?", (role_or_err.user_id,))
        row = cursor.fetchone()

        if not row:
            return JSONResponse({"error": "Người dùng không tồn tại!"}, status_code=400)

        user = dict(row)
        if not verify_password(user['mat_khau'], old_password):
            return JSONResponse({"error": "Mật khẩu cũ không chính xác!"}, status_code=400)

        old_token = request.cookies.get('session_token')
        new_token = str(uuid.uuid4())
        token_expiry = int(time.time() + SESSION_EXPIRY_HOURS * 3600)
        cursor.execute(
            "UPDATE tai_khoan SET mat_khau = ? WHERE id = ?",
            (hash_password(new_password), user['id'])
        )
        revoke_user_sessions(cursor, user['id'])
        create_session(
            cursor,
            user_id=user['id'],
            token=new_token,
            absolute_expires_at=token_expiry,
            idle_timeout_seconds=SESSION_INACTIVITY_TIMEOUT_HOURS * 3600,
            remember=False,
            device_info=None,
        )
        conn.commit()
        if old_token:
            _session_cache_invalidate(old_token)
        disconnect_user_websockets(user['id'])
        log_audit(
            "auth.password_changed",
            actor_user_id=role_or_err.user_id,
            target_type="tai_khoan",
            target_id=user['id'],
            request=request
        )

        response = JSONResponse({
            "success": True,
            "message": "Thay đổi mật khẩu thành công! Các phiên đăng nhập trên thiết bị khác đã bị đăng xuất."
        })
        response.set_cookie("session_token", new_token, httponly=True, secure=_SECURE_COOKIES, samesite="lax", path="/")
        return response
    except Exception as e:
        log_error(e, "change_password_api")
        return JSONResponse({"error": "Đã xảy ra lỗi khi đổi mật khẩu."}, status_code=500)
    finally:
        if conn:
            try: conn.close()
            except sqlite3.Error: pass

async def logout_api(request):
    conn = None
    user_id = None
    try:
        token = request.cookies.get('session_token')
        if token:
            _session_cache_invalidate(token)
        if token:
            conn = database.get_connection()
            cursor = conn.cursor()
            user_id = revoke_session(cursor, token)
            conn.commit()
            if user_id:
                disconnect_user_websockets(user_id)
        log_audit(
            "auth.logout",
            actor_user_id=None,
            target_type="session",
            request=request
        )
        response = JSONResponse({"success": True})
        response.delete_cookie("session_token", path="/")
        response.delete_cookie("username", path="/")
        return response
    except Exception as e:
        log_error(e, "logout_api")
        response = JSONResponse({"success": True})
        response.delete_cookie("session_token", path="/")
        response.delete_cookie("username", path="/")
        return response
    finally:
        if conn:
            try: conn.close()
            except sqlite3.Error: pass


async def privileged_reauth_api(request):
    conn = None
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        ip = get_client_ip(request)
        ip_rate_key = f"privileged_reauth:{ip}"
        user_rate_key = f"privileged_reauth_user:{role_or_err.user_id}"
        reauth_ip_limit = get_rate_limit_decision(ip_rate_key, consume_attempt=False)
        reauth_user_limit = get_rate_limit_decision(user_rate_key, consume_attempt=False)
        if not reauth_ip_limit.allowed or not reauth_user_limit.allowed:
            return rate_limit_response(
                "Quá nhiều lần xác thực lại thất bại. Vui lòng thử lại sau.",
                reauth_ip_limit if not reauth_ip_limit.allowed else reauth_user_limit,
            )
        data = await request.json()
        invalid = validate_or_response(request, data, {
            "password": {"type": "string", "required": True, "min_length": 1, "max_length": 256},
        })
        if invalid:
            return invalid
        password = data.get("password")
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, vai_tro, mat_khau FROM tai_khoan WHERE id = ?",
            (role_or_err.user_id,),
        )
        row = cursor.fetchone()
        if not row:
            return JSONResponse({"error": "Phiên người dùng không còn hợp lệ."}, status_code=403)
        is_super_admin = "super_admin" in get_effective_roles(row["vai_tro"])
        if is_super_admin:
            controls_valid, controls_error = verify_super_admin_controls(
                request,
                dict(row),
                require_reauth=False,
            )
            if not controls_valid:
                return JSONResponse({"error": controls_error}, status_code=403)
        if not password or not verify_password(row["mat_khau"], password):
            record_rate_limit_failure(ip_rate_key)
            record_rate_limit_failure(user_rate_key)
            log_audit(
                "admin.privileged_reauth_failed" if is_super_admin else "security.password_reauth_failed",
                actor_user_id=role_or_err.user_id,
                target_type="session",
                request=request,
            )
            return JSONResponse({"error": "Mật khẩu không chính xác."}, status_code=400)
        reauthenticated_at = int(time.time())
        if not set_session_reauthentication(
            cursor, request.cookies.get('session_token'), reauthenticated_at
        ):
            return JSONResponse({"error": "Phiên người dùng không còn hợp lệ."}, status_code=403)
        conn.commit()
        _session_cache_invalidate_by_user_id(role_or_err.user_id)
        log_audit(
            "admin.privileged_reauth_succeeded" if is_super_admin else "security.password_reauth_succeeded",
            actor_user_id=role_or_err.user_id,
            target_type="session",
            request=request,
        )
        return JSONResponse({"success": True, "expires_in": PRIVILEGED_REAUTH_TTL_SECONDS})
    except Exception as exc:
        if conn:
            conn.rollback()
        log_error(exc, "privileged_reauth_api")
        return JSONResponse({"error": "Không thể xác thực lại quyền quản trị."}, status_code=500)
    finally:
        if conn:
            conn.close()

from backend.auth.admin_user_routes import delete_user_api, list_users_api

async def update_user_role_api(request):
    """Update a platform role or a role in the active organization.

    Organization roles are membership-scoped.  A platform-role change requires an
    explicit ``scope=platform`` so an organization manager can never accidentally
    or deliberately promote an account globally.
    """

    conn = None
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        data = await request.json()
        invalid = validate_or_response(request, data, {
            "user_id": {"type": "string", "required": True, "min_length": 1, "max_length": 128},
            "role": {"type": "string", "required": True, "min_length": 1, "max_length": 32},
            "scope": {"type": "string", "max_length": 32},
        })
        if invalid:
            return invalid
        user_id = str(data.get("user_id") or "").strip()
        new_role = str(data.get("role") or "").strip().lower()
        scope = str(data.get("scope") or "organization").strip().lower()
        if not user_id or not new_role:
            return JSONResponse({"error": "Thiếu thông tin bắt buộc!"}, status_code=400)
        if "," in new_role:
            return JSONResponse({"error": "Mỗi phạm vi chỉ được có một vai trò."}, status_code=400)

        actor_platform_admin = "super_admin" in get_effective_roles(str(role_or_err))
        if actor_platform_admin:
            controls_valid, controls_error = verify_super_admin_controls(
                request,
                _load_user_by_session_token(request.cookies.get("session_token")) or {},
            )
            if not controls_valid:
                return JSONResponse({"error": controls_error}, status_code=403)
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("BEGIN IMMEDIATE")

        if scope == "platform":
            if not actor_platform_admin:
                conn.rollback()
                return JSONResponse({"error": "Không có quyền thay đổi vai trò nền tảng."}, status_code=403)
            if new_role not in {"super_admin", "user"}:
                conn.rollback()
                return JSONResponse({"error": "Vai trò nền tảng không hợp lệ."}, status_code=400)
            if user_id == str(role_or_err.user_id):
                conn.rollback()
                return JSONResponse({"error": "Không thể tự thay đổi quyền nền tảng."}, status_code=409)
            cursor.execute("SELECT 1 FROM tai_khoan WHERE id = ?", (user_id,))
            if not cursor.fetchone():
                conn.rollback()
                return JSONResponse({"error": "Người dùng không tồn tại."}, status_code=404)
            cursor.execute("SELECT vai_tro FROM tai_khoan WHERE id = ?", (user_id,))
            target_platform_role = str(cursor.fetchone()[0] or '').strip().lower()
            if target_platform_role == 'super_admin' and new_role != 'super_admin':
                cursor.execute("SELECT count(*) FROM tai_khoan WHERE vai_tro = 'super_admin'")
                if int(cursor.fetchone()[0]) <= 1:
                    conn.rollback()
                    return JSONResponse({"error": "Không thể hạ quyền quản trị viên nền tảng cuối cùng."}, status_code=409)
            cursor.execute("UPDATE tai_khoan SET vai_tro = ? WHERE id = ?", (new_role, user_id))
            audit_metadata = {"scope": "platform", "role": new_role}
            audit_event = "admin.platform_role_updated"
        elif scope == "organization":
            org_id = get_active_org(request, role_or_err.user_id)
            if not is_business_organization(cursor, org_id):
                conn.rollback()
                return JSONResponse({
                    "error": "Không thể thay đổi membership của không gian cá nhân.",
                    "code": "PERSONAL_WORKSPACE_MEMBERSHIP_FORBIDDEN",
                }, status_code=409)
            cursor.execute(
                "SELECT lower(trim(vai_tro_trong_to_chuc)) FROM thanh_vien_to_chuc WHERE user_id = ? AND organization_id = ?",
                (role_or_err.user_id, org_id),
            )
            actor_row = cursor.fetchone()
            actor_role = str(actor_row[0] or "").strip().lower() if actor_row else ""
            if not actor_platform_admin and actor_role != "manager":
                conn.rollback()
                return JSONResponse({"error": "Không có quyền quản lý thành viên tổ chức."}, status_code=403)
            if new_role not in {"manager", "employee"}:
                conn.rollback()
                return JSONResponse({"error": "Vai trò thành viên không hợp lệ."}, status_code=400)

            cursor.execute(
                "SELECT lower(trim(vai_tro_trong_to_chuc)) FROM thanh_vien_to_chuc WHERE user_id = ? AND organization_id = ?",
                (user_id, org_id),
            )
            target_row = cursor.fetchone()
            if not target_row:
                conn.rollback()
                return JSONResponse({"error": "Người dùng không thuộc tổ chức hiện tại."}, status_code=404)
            target_role = str(target_row[0] or "").strip().lower()
            if user_id == str(role_or_err.user_id) and new_role != target_role:
                conn.rollback()
                return JSONResponse({"error": "Không thể tự thay đổi vai trò tổ chức."}, status_code=409)

            hierarchy = {"employee": 0, "manager": 1}
            if not actor_platform_admin:
                actor_rank = hierarchy[actor_role]
                if hierarchy[target_role] >= actor_rank or hierarchy[new_role] >= actor_rank:
                    conn.rollback()
                    return JSONResponse({"error": "Không thể sửa hoặc gán vai trò ngang/cao hơn mình."}, status_code=403)

            if target_role == "manager" and new_role != "manager":
                cursor.execute(
                    "SELECT count(*) FROM thanh_vien_to_chuc WHERE organization_id = ? AND lower(trim(vai_tro_trong_to_chuc)) = 'manager'",
                    (org_id,),
                )
                if int(cursor.fetchone()[0]) <= 1:
                    conn.rollback()
                    return JSONResponse({"error": "Không thể hạ quyền Quản lý cuối cùng."}, status_code=409)

            cursor.execute(
                "UPDATE thanh_vien_to_chuc SET vai_tro_trong_to_chuc = ?, updated_at = datetime('now') WHERE user_id = ? AND organization_id = ?",
                (new_role, user_id, org_id),
            )
            audit_metadata = {"scope": "organization", "organization_id": org_id, "role": new_role}
            audit_event = "organization.member_role_updated"
        else:
            conn.rollback()
            return JSONResponse({"error": "Phạm vi vai trò không hợp lệ."}, status_code=400)

        conn.commit()
        _session_cache_invalidate_by_user_id(user_id)
        _org_cache_invalidate_by_user_id(user_id)
        disconnect_user_websockets(user_id)
        log_audit(
            audit_event,
            actor_user_id=role_or_err.user_id,
            target_type="tai_khoan" if scope == "platform" else "organization_membership",
            target_id=user_id,
            request=request,
            metadata=audit_metadata,
        )
        return JSONResponse({"success": True, "message": "Cập nhật vai trò thành công!"})
    except OrgPermissionError as e:
        if conn:
            conn.rollback()
        return error_response(
            request,
            "ORG_ACCESS_DENIED",
            "Không có quyền truy cập tổ chức này.",
            status_code=403,
        )
    except Exception as e:
        if conn:
            conn.rollback()
        log_error(e, "update_user_role_api")
        return JSONResponse({"error": "Đã xảy ra lỗi khi cập nhật vai trò."}, status_code=500)
    finally:
        if conn:
            conn.close()


async def update_user_metadata_api(request):
    try:
        is_valid, role_or_err = verify_session(request, required_role='super_admin')
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        data = await request.json()
        invalid = validate_or_response(request, data, {
            "user_id": {"type": "string", "required": True, "min_length": 1, "max_length": 128},
            "field": {"type": "string", "required": True, "enum": {"name", "email"}},
            "value": {"required": True},
        })
        if invalid:
            return invalid
        user_id = data.get('user_id')
        field = data.get('field')
        value = data.get('value')

        if not user_id or not field:
            return JSONResponse({"error": "Thiếu thông tin bắt buộc!"}, status_code=400)

        field_map = {
            'name': 'ho_ten',
        }

        conn = database.get_connection()
        cursor = conn.cursor()

        if field == 'email':
            try:
                email = validate_profile_email(value)
            except ProfileValidationError as exc:
                conn.close()
                return JSONResponse({"error": str(exc), "code": exc.code}, status_code=400)
            cursor.execute(
                "UPDATE tai_khoan SET email = ?, email_norm = ? WHERE id = ?",
                (email, email, user_id),
            )
        else:
            if field not in field_map:
                conn.close()
                return JSONResponse({"error": "Trường cập nhật không hợp lệ!"}, status_code=400)
            db_field = field_map[field]
            cursor.execute(f"UPDATE tai_khoan SET {db_field} = ? WHERE id = ?", (value, user_id))

        conn.commit()
        conn.close()
        _session_cache_invalidate_by_user_id(user_id)
        _org_cache_invalidate_by_user_id(user_id)
        log_audit(
            "admin.user_metadata_updated",
            actor_user_id=role_or_err.user_id,
            target_type="tai_khoan",
            target_id=user_id,
            request=request,
            metadata={"field": field}
        )
        return JSONResponse({"success": True, "message": "Cập nhật thông tin thành công!"})
    except sqlite3.IntegrityError as e:
        conflict_code = identity_conflict_code(e)
        if conflict_code:
            return JSONResponse(conflict_payload(conflict_code), status_code=409)
        log_error(e, "update_user_metadata_api_integrity")
        return JSONResponse({"error": "Không thể cập nhật do xung đột dữ liệu."}, status_code=409)
    except Exception as e:
        log_error(e, "update_user_metadata_api")
        return JSONResponse({"error": "Đã xảy ra lỗi khi cập nhật thông tin."}, status_code=500)

async def list_system_packages_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id, ten_goi AS name, gia_ca AS price, han_muc_nhan_su AS quota, mo_ta AS description, trang_thai AS status FROM goi_dich_vu")
        packages = []
        for row in cursor.fetchall():
            package = dict(row)
            package['price'] = money_json_value(package['price'])
            package['isLocked'] = package['status'] != 'active'
            packages.append(package)
        conn.close()
        return JSONResponse(packages)
    except Exception as e:
        log_error(e, "list_system_packages_api")
        return JSONResponse({"error": "Đã xảy ra lỗi khi tải danh sách gói dịch vụ."}, status_code=500)

async def list_public_packages_api(request):
    """Expose active commercial package metadata for the public landing page."""
    conn = None
    try:
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, ten_goi AS name, gia_ca AS price,
                   han_muc_nhan_su AS quota, mo_ta AS description
            FROM goi_dich_vu
            WHERE trang_thai = 'active'
            ORDER BY CASE id
                WHEN 'silver' THEN 1
                WHEN 'gold' THEN 2
                WHEN 'diamond' THEN 3
                ELSE 4
            END, gia_ca ASC
        """)
        packages = []
        for row in cursor.fetchall():
            package = dict(row)
            package["price"] = money_json_value(package["price"])
            packages.append(package)
        return JSONResponse(
            {"packages": packages},
            headers={"Cache-Control": "public, max-age=300"},
        )
    except Exception as exc:
        log_error(exc, "list_public_packages_api")
        return JSONResponse(
            {"error": "Không thể tải bảng giá dịch vụ."},
            status_code=500,
        )
    finally:
        if conn is not None:
            conn.close()

async def update_system_package_api(request):
    try:
        is_valid, role_or_err = verify_session(request, required_role='super_admin')
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        data = await request.json()
        invalid = validate_or_response(request, data, {
            "id": {"type": "string", "required": True, "min_length": 1, "max_length": 128},
            "name": {"type": "string", "required": True, "min_length": 1, "max_length": 200},
            "price": {"type": "money", "required": True},
            "quota": {"type": "integer", "required": True, "min": 1, "max": 1_000_000},
            "description": {"type": "string", "max_length": 5_000},
            "status": {"type": "string", "enum": {"active", "inactive"}},
        })
        if invalid:
            return invalid
        pkg_id = data.get('id')
        name = data.get('name')
        price = parse_vnd_amount(data.get('price'))
        quota = int(data.get('quota', 0))
        description = data.get('description', '')
        status = str(data.get('status') or 'active').strip().lower()

        if not pkg_id or not name or price is None or status not in {'active', 'inactive'}:
            return JSONResponse({"error": "Thiếu thông tin bắt buộc!"}, status_code=400)

        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE goi_dich_vu
            SET ten_goi = ?, gia_ca = ?, han_muc_nhan_su = ?, mo_ta = ?, trang_thai = ?
            WHERE id = ?
        """, (name, price, quota, description, status, pkg_id))
        conn.commit()
        conn.close()
        log_audit(
            "admin.system_package_updated",
            actor_user_id=role_or_err.user_id,
            target_type="goi_dich_vu",
            target_id=pkg_id,
            request=request,
            metadata={"name": name, "price": price, "quota": quota, "status": status}
        )
        return JSONResponse({"success": True, "message": "Cập nhật gói dịch vụ thành công!"})
    except Exception as e:
        log_error(e, "update_system_package_api")
        return JSONResponse({"error": "Đã xảy ra lỗi khi cập nhật gói dịch vụ."}, status_code=500)


import re as _re
from backend.auth.username_validator import validate_username

async def set_username_api(request):

    conn = None
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        data = await request.json()
        invalid = validate_or_response(request, data, {
            "username": {"type": "string", "required": True, "min_length": 1, "max_length": 64},
        })
        if invalid:
            return invalid
        new_username = normalize_username(data.get("username"))


        valid, reason = validate_username(new_username)
        if not valid:
            return JSONResponse({"error": reason}, status_code=400)

        conn = database.get_connection()
        conn.execute("BEGIN IMMEDIATE")
        cursor = conn.cursor()


        cursor.execute("SELECT id, ten_dang_nhap, username_da_dat FROM tai_khoan WHERE id = ?", (role_or_err.user_id,))
        row = cursor.fetchone()
        if not row:
            return JSONResponse({"error": "Không tìm thấy tài khoản."}, status_code=404)

        user = dict(row)


        if user.get("username_da_dat") == 1 and user.get("ten_dang_nhap"):
            return JSONResponse(
                {"error": "Tên đăng nhập đã được đặt trước đó và không thể thay đổi."},
                status_code=400
            )


        cursor.execute("SELECT 1 FROM tai_khoan WHERE username_norm = ? AND id != ?", (new_username, role_or_err.user_id))
        if cursor.fetchone():
            return JSONResponse(
                {"error": "Tên đăng nhập này đã được sử dụng. Vui lòng chọn tên khác."},
                status_code=409
            )


        cursor.execute(
            "UPDATE tai_khoan SET ten_dang_nhap = ?, username_norm = ?, username_da_dat = 1, updated_at = datetime('now') WHERE id = ?",
            (new_username, new_username, role_or_err.user_id)
        )
        _session_cache_invalidate_by_user_id(role_or_err.user_id)
        conn.commit()

        log_audit(
            "auth.set_username",
            actor_user_id=role_or_err.user_id,
            target_type="tai_khoan",
            target_id=role_or_err.user_id,
            request=request,
            metadata={"new_username": new_username}
        )

        return JSONResponse({"success": True, "username": new_username})

    except sqlite3.IntegrityError as e:
        if conn:
            conn.rollback()
        conflict_code = identity_conflict_code(e)
        if conflict_code:
            return JSONResponse(conflict_payload(conflict_code), status_code=409)
        log_error(e, "set_username_api_integrity")
        return JSONResponse({"error": "Không thể đặt tên đăng nhập do xung đột dữ liệu."}, status_code=409)
    except Exception as e:
        if conn:
            conn.rollback()
        log_error(e, "set_username_api")
        return JSONResponse({"error": "Đã xảy ra lỗi. Vui lòng thử lại."}, status_code=500)
    finally:
        if conn:
            try:
                conn.close()
            except sqlite3.Error:
                pass
