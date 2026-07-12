import os
import sys
import json
import uuid
import time
import hashlib
from datetime import datetime
from collections import defaultdict

from starlette.responses import JSONResponse

from helpers import (
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
from helpers_py.auth_helper import _session_cache_get, _session_cache_set
from .sync_routes import disconnect_user_websockets


from services.auth_service import (
    get_client_ip,
    check_rate_limit,
    record_rate_limit_failure,
    get_user_org_names,
    update_user_organizations,
    _SECURE_COOKIES,
    SESSION_EXPIRY_HOURS,
    SESSION_REMEMBER_EXPIRY_HOURS,
    SESSION_INACTIVITY_TIMEOUT_HOURS
)

async def login_api(request):
    conn = None
    try:
        ip = get_client_ip(request)
        ip_rate_key = f"login:{ip}"
        if not check_rate_limit(ip_rate_key, consume_attempt=False):
            return JSONResponse({"error": "Quá nhiều lần đăng nhập thất bại. Vui lòng thử lại sau 60 giây."}, status_code=429)

        data = await request.json()
        username = data.get('username', '').strip()
        password = data.get('password', '').strip()
        remember = data.get('remember', False)

        username_rate_key = hashlib.sha256(username.lower().encode('utf-8')).hexdigest()
        user_rate_key = f"login_user:{username_rate_key}" if username else None
        if user_rate_key and not check_rate_limit(user_rate_key, consume_attempt=False):
            return JSONResponse({"error": "Quá nhiều lần đăng nhập cho tài khoản này. Vui lòng thử lại sau 60 giây."}, status_code=429)

        def record_failed_login():
            record_rate_limit_failure(ip_rate_key)
            if user_rate_key:
                record_rate_limit_failure(user_rate_key)
            log_audit(
                "auth.login_failed",
                request=request,
                metadata={"username": username}
            )

        if not username or not password:
            record_failed_login()
            return JSONResponse({"error": "Vui lòng nhập tài khoản và mật khẩu!"}, status_code=400)

        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM tai_khoan WHERE ten_dang_nhap = ? OR (email != '' AND email = ?)",
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
            "ip": request.client.host,
            "login_time": datetime.utcnow().isoformat()
        })
        cursor.execute(
            "UPDATE tai_khoan SET token_phien = ?, han_su_dung_token = ?, thong_tin_thiet_bi_cuoi = ? WHERE id = ?",
            (session_token, token_expiry, device_info, user['id'])
        )
        _session_cache_invalidate_by_user_id(user['id'])
        org_names = get_user_org_names(cursor, user['id'])
        conn.commit()
        log_audit(
            "auth.login_success",
            actor_user_id=user['id'],
            owner_id=org_names,
            target_type="tai_khoan",
            target_id=user['id'],
            request=request,
            metadata={"remember": remember}
        )

        effective_roles = list(get_effective_roles(user['vai_tro']))
        response = JSONResponse({
            "success": True,
            "id": user['id'],
            "username": user['ten_dang_nhap'],
            "name": user['ho_ten'],
            "role": user['vai_tro'],
            "effective_roles": effective_roles,
            "email": user['email'],
            "avatar": user.get('anh_dai_dien'),
            "package_id": user.get('goi_dich_vu_id'),
            "organization_name": org_names,
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
                   goi_dich_vu_id, token_phien, han_su_dung_token,
                   thong_tin_thiet_bi_cuoi, google_id, mat_khau
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


def _get_org_names_for_session(user_id):
    conn = database.get_connection()
    try:
        cursor = conn.cursor()
        return get_user_org_names(cursor, user_id)
    finally:
        conn.close()


def _get_username_setup_state(user):
    needs_username = not user.get('ten_dang_nhap')
    if not needs_username:
        return False, "", False

    suggested_username = ""
    conn_suggest = database.get_connection()
    try:
        from google_auth_routes import _generate_suggested_username
        cursor_suggest = conn_suggest.cursor()
        suggested_username = _generate_suggested_username(
            user.get('ho_ten', ''),
            user.get('email', ''),
            cursor_suggest
        )
    except Exception:
        pass
    finally:
        conn_suggest.close()
    account_linked = bool(user.get('google_id') and user.get('mat_khau'))
    return needs_username, suggested_username, account_linked


def _session_response(user, remember, session_was_extended):
    needs_username, suggested_username, account_linked = _get_username_setup_state(user)
    response = JSONResponse({
        "valid": True,
        "device_info": user.get('thong_tin_thiet_bi_cuoi'),
        "user": {
            "id": user['id'],
            "username": user['ten_dang_nhap'],
            "name": user['ho_ten'],
            "role": user['vai_tro'],
            "effective_roles": list(get_effective_roles(user['vai_tro'])),
            "email": user['email'],
            "avatar": user.get('anh_dai_dien'),
            "package_id": user.get('goi_dich_vu_id'),
            "organization_name": _get_org_names_for_session(user['id']),
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
    try:
        try:
            data = await request.json()
        except Exception:
            data = {}
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
        return _session_response(user, remember, session_was_extended)
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
        name = data.get('name', '').strip()
        email = data.get('email', '').strip()
        avatar = data.get('avatar', '')

        if not name or not email:
            return JSONResponse({"error": "Vui lòng điền đầy đủ Họ tên và Email!"}, status_code=400)

        conn = database.get_connection()
        cursor = conn.cursor()

        cursor.execute("SELECT ten_dang_nhap FROM tai_khoan WHERE email = ? AND id != ?", (email, role_or_err.user_id))
        if cursor.fetchone():
            return JSONResponse({"error": "Địa chỉ email này đã được sử dụng bởi một tài khoản khác!"}, status_code=400)

        if avatar:
            cursor.execute("UPDATE tai_khoan SET ho_ten = ?, email = ?, anh_dai_dien = ? WHERE id = ?", (name, email, avatar, role_or_err.user_id))
        else:
            cursor.execute("UPDATE tai_khoan SET ho_ten = ?, email = ? WHERE id = ?", (name, email, role_or_err.user_id))

        _session_cache_invalidate_by_user_id(role_or_err.user_id)

        conn.commit()

        return JSONResponse({"success": True, "message": "Cập nhật thông tin tài khoản thành công!"})
    except Exception as e:
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
        old_password = data.get('old_password', '').strip()
        new_password = data.get('new_password', '').strip()

        if not old_password or not new_password:
            return JSONResponse({"error": "Vui lòng nhập đầy đủ mật khẩu cũ và mới!"}, status_code=400)

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
            "UPDATE tai_khoan SET mat_khau = ?, token_phien = ?, han_su_dung_token = ? WHERE id = ?",
            (hash_password(new_password), new_token, token_expiry, user['id'])
        )
        conn.commit()
        if old_token:
            _session_cache_invalidate(old_token)
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
    try:
        token = request.cookies.get('session_token')
        if token:
            _session_cache_invalidate(token)
        if token:
            conn = database.get_connection()
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE tai_khoan SET token_phien = NULL, han_su_dung_token = NULL WHERE token_phien = ?",
                (token,)
            )
            conn.commit()
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

        cursor.execute("SELECT to_chuc_id FROM thanh_vien_to_chuc WHERE user_id = ?", (role_or_err.user_id,))
        req_org_ids = [r['to_chuc_id'] for r in cursor.fetchall()]

        sql_base = "SELECT id, ten_dang_nhap AS username, ho_ten AS name, vai_tro AS role, email, anh_dai_dien AS avatar, goi_dich_vu_id AS package_id, ngay_bat_dau_goi AS package_start_date, ngay_het_han_goi AS package_end_date FROM tai_khoan"

        email_query = (request.query_params.get('email') or '').strip().lower()
        email_filter_sql = " AND lower(email) = ?" if email_query else ""
        email_filter_tk_sql = " AND lower(tk.email) = ?" if email_query else ""

        if 'super_admin' in effective_roles:
            if email_query:
                cursor.execute(sql_base + " WHERE lower(email) = ?", (email_query,))
            else:
                cursor.execute(sql_base)
            users_raw = cursor.fetchall()
        elif 'manager' not in effective_roles:
            cursor.execute(sql_base + " WHERE id = ?" + email_filter_sql, tuple([role_or_err.user_id] + ([email_query] if email_query else [])))
            users_raw = cursor.fetchall()
        else:
            if not req_org_ids:
                cursor.execute(sql_base + " WHERE id = ?" + email_filter_sql, tuple([role_or_err.user_id] + ([email_query] if email_query else [])))
                users_raw = cursor.fetchall()
            else:
                active_org_id = get_active_org(request, role_or_err.user_id)
                if active_org_id and active_org_id in req_org_ids:
                    cursor.execute(f"""
                        SELECT DISTINCT tk.id, tk.ten_dang_nhap AS username, tk.ho_ten AS name, tk.vai_tro AS role,
                                        tk.email, tk.anh_dai_dien AS avatar, tk.goi_dich_vu_id AS package_id,
                                        tk.ngay_bat_dau_goi AS package_start_date, tk.ngay_het_han_goi AS package_end_date
                        FROM tai_khoan tk
                        JOIN thanh_vien_to_chuc tvtc ON tk.id = tvtc.user_id
                        WHERE tvtc.to_chuc_id = ?{email_filter_tk_sql}
                    """, tuple([active_org_id] + ([email_query] if email_query else [])))
                    users_raw = cursor.fetchall()
                else:
                    placeholders = ",".join("?" for _ in req_org_ids)
                    cursor.execute(f"""
                        SELECT DISTINCT tk.id, tk.ten_dang_nhap AS username, tk.ho_ten AS name, tk.vai_tro AS role,
                                        tk.email, tk.anh_dai_dien AS avatar, tk.goi_dich_vu_id AS package_id,
                                        tk.ngay_bat_dau_goi AS package_start_date, tk.ngay_het_han_goi AS package_end_date
                        FROM tai_khoan tk
                        JOIN thanh_vien_to_chuc tvtc ON tk.id = tvtc.user_id
                        WHERE tvtc.to_chuc_id IN ({placeholders}){email_filter_tk_sql}
                    """, tuple(req_org_ids + ([email_query] if email_query else [])))
                    users_raw = cursor.fetchall()

        user_ids = [r['id'] for r in users_raw]
        orgs_by_user = defaultdict(list)
        if user_ids:
            placeholders = ",".join("?" for _ in user_ids)
            cursor.execute(f"""
                SELECT tvtc.user_id, tc.ten_to_chuc
                FROM thanh_vien_to_chuc tvtc
                JOIN to_chuc tc ON tvtc.to_chuc_id = tc.id
                WHERE tvtc.user_id IN ({placeholders})
            """, user_ids)
            for row in cursor.fetchall():
                orgs_by_user[row['user_id']].append(row['ten_to_chuc'])

        users = []
        for row in users_raw:
            u = dict(row)
            u['organization_name'] = ", ".join(orgs_by_user[u['id']])
            users.append(u)
        conn.close()
        return JSONResponse(users)
    except OrgPermissionError as e:
        return JSONResponse({"error": str(e)}, status_code=403)
    except Exception as e:
        log_error(e, "list_users_api")
        return JSONResponse({"error": "Đã xảy ra lỗi tải danh sách người dùng."}, status_code=500)

async def delete_user_api(request):
    try:
        is_valid, role_or_err = verify_session(request, required_role='super_admin')
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        user_id = request.path_params.get('user_id')
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM tai_khoan WHERE id = ?", (user_id,))
        conn.commit()
        conn.close()

        _session_cache_invalidate_by_user_id(user_id)
        _org_cache_invalidate_by_user_id(user_id)
        disconnect_user_websockets(user_id)
        log_audit(
            "admin.user_deleted",
            actor_user_id=role_or_err.user_id,
            target_type="tai_khoan",
            target_id=user_id,
            request=request
        )

        return JSONResponse({"success": True, "message": "Xóa người dùng thành công!"})
    except Exception as e:
        log_error(e, "delete_user_api")
        return JSONResponse({"error": "Đã xảy ra lỗi xóa tài khoản."}, status_code=500)

async def update_user_role_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        effective_roles = get_effective_roles(str(role_or_err))
        if 'manager' not in effective_roles:
            return JSONResponse({"error": "Bạn không có quyền thực hiện thao tác này!"}, status_code=403)

        data = await request.json()
        user_id = data.get('user_id')
        new_role = data.get('role')

        if not user_id or not new_role:
            return JSONResponse({"error": "Thiếu thông tin bắt buộc!"}, status_code=400)

        valid_roles = {'super_admin', 'manager', 'employee'}
        requested_roles = [r.strip() for r in new_role.split(',') if r.strip()]
        if not requested_roles or not all(r in valid_roles for r in requested_roles):
            return JSONResponse({"error": "Vai trò không hợp lệ!"}, status_code=400)

        if 'super_admin' not in effective_roles and 'super_admin' in requested_roles:
            return JSONResponse({"error": "Bạn không có quyền gán vai trò Quản trị viên tối cao!"}, status_code=403)

        if 'super_admin' not in effective_roles and any(role != 'employee' for role in requested_roles):
            return JSONResponse({"error": "Ban khong co quyen gan vai tro quan tri."}, status_code=403)

        if 'super_admin' not in effective_roles:
            requester_id = role_or_err.user_id
            conn_check = database.get_connection()
            cur_check = conn_check.cursor()
            cur_check.execute(
                "SELECT to_chuc_id FROM thanh_vien_to_chuc WHERE user_id = ?",
                (requester_id,)
            )
            requester_orgs = {row[0] for row in cur_check.fetchall()}
            cur_check.execute(
                "SELECT to_chuc_id FROM thanh_vien_to_chuc WHERE user_id = ?",
                (user_id,)
            )
            target_orgs = {row[0] for row in cur_check.fetchall()}
            conn_check.close()
            if not requester_orgs.intersection(target_orgs):
                return JSONResponse({"error": "Bạn không có quyền thay đổi vai trò của người dùng này!"}, status_code=403)

        normalized_role = ','.join(requested_roles)

        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("UPDATE tai_khoan SET vai_tro = ? WHERE id = ?", (normalized_role, user_id))
        conn.commit()
        conn.close()
        _session_cache_invalidate_by_user_id(user_id)
        log_audit(
            "admin.user_role_updated",
            actor_user_id=role_or_err.user_id,
            target_type="tai_khoan",
            target_id=user_id,
            request=request,
            metadata={"role": normalized_role}
        )
        return JSONResponse({"success": True, "message": "Cập nhật vai trò người dùng thành công!"})
    except Exception as e:
        log_error(e, "update_user_role_api")
        return JSONResponse({"error": "Đã xảy ra lỗi khi cập nhật vai trò."}, status_code=500)

async def update_user_package_api(request):
    try:
        is_valid, role_or_err = verify_session(request, required_role='super_admin')
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        data = await request.json()
        user_id = data.get('user_id')
        new_package = data.get('package_id')

        if not user_id or new_package is None:
            return JSONResponse({"error": "Thiếu thông tin bắt buộc!"}, status_code=400)

        pkgs = [p.strip() for p in new_package.split(',')]
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM goi_dich_vu")
        valid_pkg_ids = {row['id'] for row in cursor.fetchall()} | {'none', ''}
        for p in pkgs:
            if p and p not in valid_pkg_ids:
                conn.close()
                return JSONResponse({"error": "Gói đăng ký không hợp lệ!"}, status_code=400)
        db_package = None if new_package in ('none', '', None) else new_package
        cursor.execute("UPDATE tai_khoan SET goi_dich_vu_id = ? WHERE id = ?", (db_package, user_id))
        conn.commit()
        conn.close()
        _session_cache_invalidate_by_user_id(user_id)
        log_audit(
            "admin.user_package_updated",
            actor_user_id=role_or_err.user_id,
            target_type="tai_khoan",
            target_id=user_id,
            request=request,
            metadata={"package_id": db_package}
        )
        return JSONResponse({"success": True, "message": "Cập nhật gói đăng ký thành công!"})
    except Exception as e:
        log_error(e, "update_user_package_api")
        return JSONResponse({"error": "Đã xảy ra lỗi khi cập nhật gói dịch vụ."}, status_code=500)

async def update_user_metadata_api(request):
    try:
        is_valid, role_or_err = verify_session(request, required_role='super_admin')
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        data = await request.json()
        user_id = data.get('user_id')
        field = data.get('field')
        value = data.get('value')

        if not user_id or not field:
            return JSONResponse({"error": "Thiếu thông tin bắt buộc!"}, status_code=400)

        field_map = {
            'package_start_date': 'ngay_bat_dau_goi',
            'package_end_date': 'ngay_het_han_goi',
            'name': 'ho_ten',
            'email': 'email'
        }

        conn = database.get_connection()
        cursor = conn.cursor()

        if field == 'organization_name':
            cursor.execute("SELECT vai_tro FROM tai_khoan WHERE id = ?", (user_id,))
            u_row = cursor.fetchone()
            role = u_row['vai_tro'] if u_row else 'employee'
            update_user_organizations(cursor, user_id, value, role)
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
        cursor.execute("SELECT id, ten_goi AS name, gia_ca AS price, han_muc_nhan_su AS quota, mo_ta AS description FROM goi_dich_vu")
        packages = [dict(row) for row in cursor.fetchall()]
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
        pkg_id = data.get('id')
        name = data.get('name')
        price = float(data.get('price', 0))
        quota = int(data.get('quota', 0))
        description = data.get('description', '')

        if not pkg_id or not name:
            return JSONResponse({"error": "Thiếu thông tin bắt buộc!"}, status_code=400)

        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE goi_dich_vu
            SET ten_goi = ?, gia_ca = ?, han_muc_nhan_su = ?, mo_ta = ?
            WHERE id = ?
        """, (name, price, quota, description, pkg_id))
        conn.commit()
        conn.close()
        log_audit(
            "admin.system_package_updated",
            actor_user_id=role_or_err.user_id,
            target_type="goi_dich_vu",
            target_id=pkg_id,
            request=request,
            metadata={"name": name, "price": price, "quota": quota}
        )
        return JSONResponse({"success": True, "message": "Cập nhật gói dịch vụ thành công!"})
    except Exception as e:
        log_error(e, "update_system_package_api")
        return JSONResponse({"error": "Đã xảy ra lỗi khi cập nhật gói dịch vụ."}, status_code=500)


import re as _re
from helpers_py.username_validator import validate_username

async def set_username_api(request):

    conn = None
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        data = await request.json()
        new_username = (data.get("username") or "").strip().lower()


        valid, reason = validate_username(new_username)
        if not valid:
            return JSONResponse({"error": reason}, status_code=400)

        conn = database.get_connection()
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


        cursor.execute("SELECT 1 FROM tai_khoan WHERE ten_dang_nhap = ? AND id != ?", (new_username, role_or_err.user_id))
        if cursor.fetchone():
            return JSONResponse(
                {"error": "Tên đăng nhập này đã được sử dụng. Vui lòng chọn tên khác."},
                status_code=409
            )


        cursor.execute(
            "UPDATE tai_khoan SET ten_dang_nhap = ?, username_da_dat = 1, updated_at = datetime('now', 'localtime') WHERE id = ?",
            (new_username, role_or_err.user_id)
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

    except Exception as e:
        log_error(e, "set_username_api")
        return JSONResponse({"error": "Đã xảy ra lỗi. Vui lòng thử lại."}, status_code=500)
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass
