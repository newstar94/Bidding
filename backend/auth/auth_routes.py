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
from backend.auth.auth_helper import PRIVILEGED_REAUTH_TTL_SECONDS, verify_super_admin_controls
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
        cursor.execute(
            "UPDATE tai_khoan SET token_phien = ?, han_su_dung_token = ?, thong_tin_thiet_bi_cuoi = ?, privileged_reauth_at = NULL WHERE id = ?",
            (session_token, token_expiry, device_info, user['id'])
        )
        _session_cache_invalidate_by_user_id(user['id'])
        access_payload = build_user_access_payload(
            cursor,
            user['id'],
            user['vai_tro'],
            _active_org_hint(request),
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
            except Exception: pass

def _load_user_by_session_token(session_token):
    cached = _session_cache_get(session_token)
    if cached and cached.get('token_phien') == session_token and 'ten_dang_nhap' in cached:
        return cached

    conn = database.get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, ten_dang_nhap, ho_ten, vai_tro, email, anh_dai_dien,
                   token_phien, han_su_dung_token,
                   thong_tin_thiet_bi_cuoi, mat_khau,
                   EXISTS(
                       SELECT 1 FROM dinh_danh_ngoai dd
                       WHERE dd.user_id = tai_khoan.id
                   ) AS has_external_identity,
                   privileged_reauth_at
            FROM tai_khoan
            WHERE token_phien = ?
        """, (session_token,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def _validate_token_expiry(session_token, user):
    if not user:
        return "user_not_found"
    if user.get('token_phien') != session_token:
        return "logged_in_elsewhere"
    if user.get('han_su_dung_token'):
        try:
            if time.time() > float(user['han_su_dung_token']):
                _session_cache_invalidate(session_token)
                return "token_expired"
        except Exception:
            pass
    return None


def _extend_session_if_needed(user, remember):
    expiry_hours = SESSION_REMEMBER_EXPIRY_HOURS if remember else SESSION_EXPIRY_HOURS
    now = time.time()
    current_expiry = float(user.get('han_su_dung_token') or 0)
    if current_expiry - now >= (expiry_hours * 3600) / 2:
        return False

    new_expiry = int(now + expiry_hours * 3600)
    conn = database.get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE tai_khoan SET han_su_dung_token = ? WHERE id = ?",
            (new_expiry, user['id'])
        )
        conn.commit()
    finally:
        conn.close()
    user['han_su_dung_token'] = new_expiry
    return True


def _get_access_for_session(user, request):
    conn = database.get_connection()
    try:
        cursor = conn.cursor()
        return build_user_access_payload(
            cursor,
            user['id'],
            user['vai_tro'],
            _active_org_hint(request),
        )
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
        "device_info": user.get('thong_tin_thiet_bi_cuoi'),
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


def _session_response(user, remember, session_was_extended, request):
    needs_username, suggested_username, account_linked = _get_username_setup_state(user)
    access_payload = _get_access_for_session(user, request)
    response = JSONResponse({
        "valid": True,
        "device_info": user.get('thong_tin_thiet_bi_cuoi'),
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

    if session_was_extended:
        cookie_max_age = (SESSION_REMEMBER_EXPIRY_HOURS if remember else SESSION_EXPIRY_HOURS) * 3600
        response.set_cookie("session_token", user['token_phien'], httponly=True, secure=_SECURE_COOKIES, samesite="lax", path="/", max_age=cookie_max_age)
        response.delete_cookie("username", path="/")
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

        session_was_extended = _extend_session_if_needed(user, remember)
        _session_cache_set(session_token, user)
        response = _session_response(user, remember, session_was_extended, request)
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
            except Exception: pass

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
            "UPDATE tai_khoan SET mat_khau = ?, token_phien = ?, han_su_dung_token = ?, privileged_reauth_at = NULL WHERE id = ?",
            (hash_password(new_password), new_token, token_expiry, user['id'])
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
            except Exception: pass

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
            cursor.execute("SELECT id FROM tai_khoan WHERE token_phien = ?", (token,))
            user_row = cursor.fetchone()
            user_id = user_row['id'] if user_row else None
            cursor.execute(
                "UPDATE tai_khoan SET token_phien = NULL, han_su_dung_token = NULL, privileged_reauth_at = NULL WHERE token_phien = ?",
                (token,)
            )
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
            except Exception: pass


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
        cursor.execute(
            "UPDATE tai_khoan SET privileged_reauth_at = ? WHERE id = ?",
            (reauthenticated_at, role_or_err.user_id),
        )
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

async def list_users_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        conn = database.get_connection()
        cursor = conn.cursor()

        cursor.execute("SELECT vai_tro FROM tai_khoan WHERE id = ?", (role_or_err.user_id,))
        requester = cursor.fetchone()
        if not requester:
            conn.close()
            return JSONResponse({"error": "Không tìm thấy thông tin tài khoản yêu cầu!"}, status_code=404)

        req_role = requester['vai_tro']
        effective_roles = get_effective_roles(req_role)

        sql_base = "SELECT id, ten_dang_nhap AS username, ho_ten AS name, vai_tro AS role, vai_tro AS platform_role, email, anh_dai_dien AS avatar FROM tai_khoan"

        email_query = (request.query_params.get('email') or '').strip().lower()
        email_filter_sql = " AND email_norm = ?" if email_query else ""
        email_filter_tk_sql = " AND tk.email_norm = ?" if email_query else ""

        if 'super_admin' in effective_roles:
            if email_query:
                cursor.execute(sql_base + " WHERE email_norm = ?", (email_query,))
            else:
                cursor.execute(sql_base)
            users_raw = cursor.fetchall()
        else:
            active_org_id = get_active_org(request, role_or_err.user_id)
            cursor.execute(
                """
                SELECT lower(trim(vai_tro_trong_to_chuc))
                FROM thanh_vien_to_chuc
                WHERE user_id = ? AND organization_id = ?
                """,
                (role_or_err.user_id, active_org_id),
            )
            membership = cursor.fetchone()
            membership_role = str(membership[0] or "").strip().lower() if membership else ""
            if membership_role not in {'owner', 'manager'}:
                cursor.execute(f"""
                    SELECT tk.id, tk.ten_dang_nhap AS username, tk.ho_ten AS name,
                           tvtc.vai_tro_trong_to_chuc AS role,
                           tk.vai_tro AS platform_role,
                           tk.email, tk.anh_dai_dien AS avatar
                    FROM tai_khoan AS tk
                    JOIN thanh_vien_to_chuc AS tvtc ON tvtc.user_id = tk.id
                    WHERE tk.id = ? AND tvtc.organization_id = ?{email_filter_tk_sql}
                """, tuple([role_or_err.user_id, active_org_id] + ([email_query] if email_query else [])))
                users_raw = cursor.fetchall()
            else:
                cursor.execute(f"""
                    SELECT DISTINCT tk.id, tk.ten_dang_nhap AS username, tk.ho_ten AS name,
                                    tvtc.vai_tro_trong_to_chuc AS role,
                                    tk.vai_tro AS platform_role,
                                    tk.email, tk.anh_dai_dien AS avatar
                    FROM tai_khoan tk
                    JOIN thanh_vien_to_chuc tvtc ON tk.id = tvtc.user_id
                    WHERE tvtc.organization_id = ?{email_filter_tk_sql}
                """, tuple([active_org_id] + ([email_query] if email_query else [])))
                users_raw = cursor.fetchall()

        user_ids = [r['id'] for r in users_raw]
        orgs_by_user = defaultdict(list)
        if user_ids:
            placeholders = ",".join("?" for _ in user_ids)
            cursor.execute(f"""
                SELECT tvtc.user_id, tc.id, tc.ten_to_chuc, tc.scope_type,
                       tc.trang_thai AS organization_status,
                       tvtc.vai_tro_trong_to_chuc,
                       sub.package_id, sub.status AS subscription_status,
                       sub.starts_at, sub.expires_at, sub.member_quota, sub.revision,
                       pkg.trang_thai AS package_status,
                       (SELECT count(*) FROM thanh_vien_to_chuc members
                        WHERE members.organization_id = tc.id) AS member_count
                FROM thanh_vien_to_chuc tvtc
                JOIN to_chuc tc ON tvtc.organization_id = tc.id
                LEFT JOIN organization_subscriptions sub ON sub.organization_id = tc.id
                LEFT JOIN goi_dich_vu pkg ON pkg.id = sub.package_id
                WHERE tvtc.user_id IN ({placeholders})
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
            """, user_ids)
            for row in cursor.fetchall():
                expires_at = int(row['expires_at']) if row['expires_at'] is not None else None
                subscription_status = str(row['subscription_status'] or 'missing').strip().lower()
                if expires_at is not None and expires_at <= int(time.time()):
                    subscription_status = 'expired'
                effective_status = 'active'
                if row['organization_status'] != 'active' or subscription_status == 'suspended':
                    effective_status = 'suspended'
                elif subscription_status != 'active':
                    effective_status = subscription_status
                elif row['package_status'] != 'active':
                    effective_status = 'package_inactive'
                starts_at = int(row['starts_at']) if row['starts_at'] is not None else None
                orgs_by_user[row['user_id']].append({
                    "id": row['id'],
                    "name": row['ten_to_chuc'],
                    "scope_type": row['scope_type'],
                    "status": effective_status,
                    "role": row['vai_tro_trong_to_chuc'],
                    "subscription": {
                        "package_id": row['package_id'],
                        "status": subscription_status,
                        "starts_at": starts_at,
                        "expires_at": expires_at,
                        "start_date": time.strftime('%Y-%m-%d', time.gmtime(starts_at)) if starts_at else None,
                        "end_date": time.strftime('%Y-%m-%d', time.gmtime(expires_at)) if expires_at else None,
                        "member_quota": int(row['member_quota'] or 0),
                        "member_count": int(row['member_count'] or 0),
                        "revision": int(row['revision'] or 0),
                    },
                })

        users = []
        for row in users_raw:
            u = dict(row)
            u['organizations'] = orgs_by_user[u['id']]
            users.append(u)
        conn.close()
        return JSONResponse(users)
    except OrgPermissionError as e:
        return error_response(
            request,
            "ORG_ACCESS_DENIED",
            "Không có quyền truy cập tổ chức này.",
            status_code=403,
        )
    except Exception as e:
        log_error(e, "list_users_api")
        return JSONResponse({"error": "Đã xảy ra lỗi tải danh sách người dùng."}, status_code=500)

async def delete_user_api(request):
    conn = None
    try:
        is_valid, role_or_err = verify_session(request, required_role='super_admin')
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        user_id = request.path_params.get('user_id')
        if str(user_id) == str(role_or_err.user_id):
            return JSONResponse({"error": "Không thể tự xóa tài khoản quản trị."}, status_code=409)
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("BEGIN IMMEDIATE")
        cursor.execute("SELECT vai_tro FROM tai_khoan WHERE id = ?", (user_id,))
        target = cursor.fetchone()
        if not target:
            return JSONResponse({"error": "Người dùng không tồn tại."}, status_code=404)
        if str(target[0] or '').strip().lower() == 'super_admin':
            cursor.execute("SELECT count(*) FROM tai_khoan WHERE vai_tro = 'super_admin'")
            if int(cursor.fetchone()[0]) <= 1:
                return JSONResponse({"error": "Không thể xóa quản trị viên nền tảng cuối cùng."}, status_code=409)
        cursor.execute(
            """
            SELECT membership.organization_id
            FROM thanh_vien_to_chuc AS membership
            JOIN to_chuc AS organization
              ON organization.id = membership.organization_id
            WHERE membership.user_id = ?
              AND organization.scope_type = 'organization'
              AND lower(trim(membership.vai_tro_trong_to_chuc)) = 'owner'
              AND NOT EXISTS (
                  SELECT 1
                  FROM thanh_vien_to_chuc AS other_owner
                  WHERE other_owner.organization_id = membership.organization_id
                    AND other_owner.user_id != membership.user_id
                    AND lower(trim(other_owner.vai_tro_trong_to_chuc)) = 'owner'
              )
            LIMIT 1
            """,
            (user_id,),
        )
        if cursor.fetchone():
            return JSONResponse({"error": "Không thể xóa chủ sở hữu cuối cùng của tổ chức."}, status_code=409)
        personal_workspace_count = int(cursor.execute(
            "SELECT COUNT(*) FROM to_chuc WHERE scope_type = 'personal' AND personal_owner_user_id = ?",
            (user_id,),
        ).fetchone()[0])
        if personal_workspace_count:
            cursor.execute("SAVEPOINT delete_personal_workspace")
            try:
                cursor.execute(
                    "DELETE FROM to_chuc WHERE scope_type = 'personal' AND personal_owner_user_id = ?",
                    (user_id,),
                )
                cursor.execute("RELEASE SAVEPOINT delete_personal_workspace")
            except sqlite3.IntegrityError:
                cursor.execute("ROLLBACK TO SAVEPOINT delete_personal_workspace")
                cursor.execute("RELEASE SAVEPOINT delete_personal_workspace")
                conn.rollback()
                return JSONResponse({
                    "error": "Không thể xóa tài khoản khi không gian cá nhân còn dữ liệu.",
                    "code": "PERSONAL_WORKSPACE_NOT_EMPTY",
                }, status_code=409)
        impact = {
            "rootCount": 1,
            "personalWorkspaces": personal_workspace_count,
            "memberships": int(cursor.execute(
                "SELECT COUNT(*) FROM thanh_vien_to_chuc WHERE user_id = ?",
                (user_id,),
            ).fetchone()[0]),
            "assignments": int(cursor.execute(
                "SELECT COUNT(*) FROM phan_cong_nhan_su WHERE id_nhan_vien = ?",
                (user_id,),
            ).fetchone()[0]),
            "permissionRows": int(cursor.execute(
                "SELECT COUNT(*) FROM ma_tran_phan_quyen WHERE emp_id = ?",
                (user_id,),
            ).fetchone()[0]),
            "passwordResetTokens": int(cursor.execute(
                "SELECT COUNT(*) FROM password_reset_tokens WHERE user_id = ?",
                (user_id,),
            ).fetchone()[0]),
        }
        impact["totalCount"] = impact["rootCount"] + sum(
            value for key, value in impact.items() if key not in {"rootCount", "totalCount"}
        )
        cursor.execute("DELETE FROM ma_tran_phan_quyen WHERE emp_id = ?", (user_id,))
        cursor.execute("DELETE FROM tai_khoan WHERE id = ?", (user_id,))
        conn.commit()

        _session_cache_invalidate_by_user_id(user_id)
        _org_cache_invalidate_by_user_id(user_id)
        disconnect_user_websockets(user_id)
        log_audit(
            "admin.user_deleted",
            actor_user_id=role_or_err.user_id,
            target_type="tai_khoan",
            target_id=user_id,
            request=request,
            metadata={"impact": impact},
        )

        return JSONResponse({
            "success": True,
            "message": "Xóa người dùng thành công!",
            "deleteImpact": impact,
        })
    except Exception as e:
        if conn:
            conn.rollback()
        log_error(e, "delete_user_api")
        return JSONResponse({"error": "Đã xảy ra lỗi xóa tài khoản."}, status_code=500)
    finally:
        if conn:
            conn.close()

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
            if not actor_platform_admin and actor_role not in {"owner", "manager"}:
                conn.rollback()
                return JSONResponse({"error": "Không có quyền quản lý thành viên tổ chức."}, status_code=403)
            if new_role not in {"owner", "manager", "employee"}:
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

            hierarchy = {"employee": 0, "manager": 1, "owner": 2}
            if not actor_platform_admin:
                actor_rank = hierarchy[actor_role]
                if hierarchy[target_role] >= actor_rank or hierarchy[new_role] >= actor_rank:
                    conn.rollback()
                    return JSONResponse({"error": "Không thể sửa hoặc gán vai trò ngang/cao hơn mình."}, status_code=403)

            if target_role == "owner" and new_role != "owner":
                cursor.execute(
                    "SELECT count(*) FROM thanh_vien_to_chuc WHERE organization_id = ? AND lower(trim(vai_tro_trong_to_chuc)) = 'owner'",
                    (org_id,),
                )
                if int(cursor.fetchone()[0]) <= 1:
                    conn.rollback()
                    return JSONResponse({"error": "Không thể hạ quyền chủ sở hữu cuối cùng."}, status_code=409)

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
            except Exception:
                pass
