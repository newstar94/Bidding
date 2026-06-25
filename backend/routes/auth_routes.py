import os
import sys
import json
import uuid
import time
import secrets
from datetime import datetime, timedelta
from collections import defaultdict

from starlette.responses import JSONResponse
from starlette.background import BackgroundTasks

# Import helpers from helpers.py
from helpers import (
    database,
    verify_session,
    hash_password,
    verify_password,
    get_effective_roles,
    gui_email,
    log_error,
    _session_cache_invalidate,
    _session_cache_invalidate_by_user_id,
    OrgPermissionError
)
from helpers_py.auth_helper import _session_cache_get, _session_cache_set

# ==========================================
# RATE LIMITER (In-memory, per IP)
# Bảo vệ chống brute force / spam OTP
# BE-3: Kết hợp in-memory + DB persist để survive server restart
# ==========================================
_rate_limit_store = defaultdict(list)   # ip -> [timestamps]
RATE_LIMIT_MAX = 5         # Tối đa 5 lần
RATE_LIMIT_WINDOW = 60     # Trong vòng 60 giây

def _get_client_ip(request) -> str:
    """Lấy IP thật từ header X-Forwarded-For (nếu qua proxy/nginx) hoặc client.host"""
    forwarded = request.headers.get('X-Forwarded-For')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return getattr(request.client, 'host', 'unknown')

def _check_rate_limit(ip: str) -> bool:
    """Trả về True nếu chưa vượt giới hạn, False nếu bị throttle.
    Ghi lần thử vào DB để survive server restart (BE-3).
    """
    now = time.time()
    window_start = now - RATE_LIMIT_WINDOW
    
    # 1) In-memory check (nhanh)
    _rate_limit_store[ip] = [t for t in _rate_limit_store[ip] if t > window_start]
    
    # 2) DB-backed count để persist qua restart
    try:
        from helpers import database as _db
        conn = _db.get_connection()
        cur = conn.cursor()
        key = f"rate_limit:{ip}"
        cur.execute("SELECT config_value FROM sys_config WHERE config_key = ?", (key,))
        row = cur.fetchone()
        if row:
            import json as _json
            try:
                db_timestamps = [t for t in _json.loads(row[0]) if t > window_start]
            except Exception:
                db_timestamps = []
        else:
            db_timestamps = list(_rate_limit_store[ip])
        
        # Merge in-memory + DB entries
        all_timestamps = sorted(set(list(_rate_limit_store[ip]) + db_timestamps))
        all_timestamps = [t for t in all_timestamps if t > window_start]
        
        if len(all_timestamps) >= RATE_LIMIT_MAX:
            conn.close()
            return False
        
        # Ghi lại vào DB
        all_timestamps.append(now)
        import json as _json
        cur.execute(
            "INSERT INTO sys_config (config_key, config_value) VALUES (?, ?) "
            "ON CONFLICT(config_key) DO UPDATE SET config_value = excluded.config_value",
            (key, _json.dumps(all_timestamps[-RATE_LIMIT_MAX:]))
        )
        conn.commit()
        conn.close()
        _rate_limit_store[ip] = all_timestamps
    except Exception:
        # Fallback: chỉ dùng in-memory nếu DB lỗi
        if len(_rate_limit_store[ip]) >= RATE_LIMIT_MAX:
            return False
        _rate_limit_store[ip].append(now)
    
    return True

def _generate_otp() -> str:
    """Tạo mã OTP 6 số dùng secrets (cryptographically secure)."""
    return str(secrets.randbelow(900000) + 100000)

# ==========================================
# CÁC HÀM TRỢ GIÚP CHO TÀI KHOẢN / TỔ CHỨC
# ==========================================

def get_user_org_names(cursor, user_id):
    cursor.execute("""
        SELECT tc.ten_to_chuc 
        FROM thanh_vien_to_chuc tvtc
        JOIN to_chuc tc ON tvtc.to_chuc_id = tc.id
        WHERE tvtc.user_id = ?
    """, (user_id,))
    rows = cursor.fetchall()
    return ", ".join(row['ten_to_chuc'] for row in rows)

def update_user_organizations(cursor, user_id, organization_name, user_role='employee'):
    import hashlib
    # Parse new organizations
    new_orgs = [o.strip() for o in organization_name.split(',') if o.strip()]
    
    # Get current associations
    cursor.execute("""
        SELECT tc.id, tc.ten_to_chuc 
        FROM thanh_vien_to_chuc tvtc
        JOIN to_chuc tc ON tvtc.to_chuc_id = tc.id
        WHERE tvtc.user_id = ?
    """, (user_id,))
    current_assoc = {row['ten_to_chuc']: row['id'] for row in cursor.fetchall()}
    
    # 1. Add new associations
    for org_name in new_orgs:
        if org_name not in current_assoc:
            # Check if organization already exists in to_chuc by name
            cursor.execute("SELECT id FROM to_chuc WHERE ten_to_chuc = ?", (org_name,))
            org_row = cursor.fetchone()
            if org_row:
                org_id = org_row['id']
            else:
                # Create new organization
                org_id = "org-" + hashlib.md5(org_name.encode('utf-8')).hexdigest()[:16]
                cursor.execute(
                    "INSERT OR IGNORE INTO to_chuc (id, ten_to_chuc, quan_ly_id) VALUES (?, ?, ?)",
                    (org_id, org_name, user_id)
                )
            
            # Create association
            role_in_org = 'employee'
            if 'super_admin' in user_role:
                role_in_org = 'super_admin'
            elif 'manager' in user_role:
                role_in_org = 'manager'
            cursor.execute(
                "INSERT OR IGNORE INTO thanh_vien_to_chuc (user_id, to_chuc_id, vai_tro_trong_to_chuc) VALUES (?, ?, ?)",
                (user_id, org_id, role_in_org)
            )
            
    # 2. Remove associations for organizations no longer specified
    removed_any = False
    for org_name, org_id in current_assoc.items():
        if org_name not in new_orgs:
            cursor.execute(
                "DELETE FROM thanh_vien_to_chuc WHERE user_id = ? AND to_chuc_id = ?",
                (user_id, org_id)
            )
            removed_any = True

    if removed_any:
        # Xóa cache tổ chức hoạt động và ngắt kết nối WebSocket
        from helpers import _org_cache_invalidate_by_user_id
        _org_cache_invalidate_by_user_id(user_id)
        from .sync_routes import disconnect_user_websockets
        disconnect_user_websockets(user_id)

# ==========================================
# CÁC ENDPOINT ĐĂNG KÝ, ĐĂNG NHẬP, QUÊN MẬT KHẨU
# ==========================================

async def register_api(request):
    try:
        # Rate limiting
        ip = _get_client_ip(request)
        if not _check_rate_limit(f"register:{ip}"):
            return JSONResponse({"error": "Quá nhiều yêu cầu đăng ký. Vui lòng thử lại sau 60 giây."}, status_code=429)

        data = await request.json()
        username = data.get('username', '').strip()
        password = data.get('password', '').strip()
        name = data.get('name', '').strip()
        email = data.get('email', '').strip()
        role = 'employee'
        
        if not username or not password or not name or not email:
            return JSONResponse({"error": "Vui lòng nhập đầy đủ thông tin bắt buộc!"}, status_code=400)
            
        conn = database.get_connection()
        cursor = conn.cursor()
        
        # Check if username exists
        cursor.execute("SELECT id FROM tai_khoan WHERE ten_dang_nhap = ?", (username,))
        if cursor.fetchone():
            conn.close()
            return JSONResponse({"error": "Tài khoản đăng nhập đã tồn tại!"}, status_code=400)
            
        # Check if email exists
        cursor.execute("SELECT id FROM tai_khoan WHERE email = ?", (email,))
        if cursor.fetchone():
            conn.close()
            return JSONResponse({"error": "Địa chỉ email này đã được sử dụng bởi một tài khoản khác!"}, status_code=400)
            
        user_uuid = "user-" + str(uuid.uuid4())
        
        # Generate verification code (cryptographically secure OTP)
        code = _generate_otp()
        expiry = int(time.time()) + 600 # 10 minutes from now
        
        cursor.execute(
            "INSERT INTO tai_khoan (id, ten_dang_nhap, mat_khau, ho_ten, vai_tro, email, goi_dich_vu_id, da_xac_minh, ma_xac_minh, han_xac_minh) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (user_uuid, username, hash_password(password), name, role, email, 'silver', 0, code, expiry)
        )
        conn.commit()
        conn.close()
        
        # Send Email
        tieu_de = "[BiddingFlow] Xác thực tài khoản đăng ký mới"
        noi_dung_html = f"""
        <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
                <h2 style="color: #2563eb; text-align: center;">Chào mừng bạn đến với BiddingFlow</h2>
                <p>Xin chào <strong>{name}</strong>,</p>
                <p>Cảm ơn bạn đã đăng ký tài khoản tại BiddingFlow. Mã OTP xác thực email của bạn là:</p>
                <div style="background-color: #f1f5f9; padding: 15px; text-align: center; border-radius: 6px; margin: 20px 0;">
                    <span style="font-size: 24px; font-weight: bold; color: #1e3a8a; letter-spacing: 4px;">{code}</span>
                </div>
                <p style="font-size: 0.9rem; color: #64748b;">Mã OTP này có hiệu lực trong vòng 10 phút. Vui lòng không chia sẻ mã này với bất kỳ ai.</p>
                <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;">
                <p style="font-size: 0.8rem; color: #94a3b8; text-align: center;">Hệ thống Đấu Thầu BiddingFlow</p>
            </div>
        </body>
        </html>
        """
        tasks = BackgroundTasks()
        tasks.add_task(gui_email, email, tieu_de, noi_dung_html)
        
        return JSONResponse(
            {"success": True, "message": "Đăng ký thành công! Vui lòng kiểm tra email để lấy mã xác nhận kích hoạt tài khoản."},
            background=tasks
        )
    except Exception as e:
        log_error(e, "register_api")
        return JSONResponse({"error": "Đã xảy ra lỗi khi đăng ký. Vui lòng thử lại sau."}, status_code=500)

async def verify_email_api(request):
    try:
        data = await request.json()
        username = data.get('username', '').strip()
        code = data.get('code', '').strip()
        
        if not username or not code:
            return JSONResponse({"error": "Thiếu thông tin xác thực!"}, status_code=400)
            
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id, ma_xac_minh, han_xac_minh FROM tai_khoan WHERE ten_dang_nhap = ?", (username,))
        row = cursor.fetchone()
        
        if not row:
            conn.close()
            return JSONResponse({"error": "Tài khoản không tồn tại!"}, status_code=400)
            
        user = dict(row)
        current_time = int(time.time())
        
        if user['ma_xac_minh'] != code:
            conn.close()
            return JSONResponse({"error": "Mã xác nhận không chính xác!"}, status_code=400)
            
        if user['han_xac_minh'] and current_time > user['han_xac_minh']:
            conn.close()
            return JSONResponse({"error": "Mã xác nhận đã hết hạn! Vui lòng yêu cầu mã mới."}, status_code=400)
            
        cursor.execute("UPDATE tai_khoan SET da_xac_minh = 1, ma_xac_minh = NULL, han_xac_minh = NULL WHERE id = ?", (user['id'],))
        conn.commit()
        conn.close()
        
        return JSONResponse({"success": True, "message": "Xác thực email thành công! Bạn có thể đăng nhập ngay bây giờ."})
    except Exception as e:
        log_error(e, "verify_email_api")
        return JSONResponse({"error": "Đã xảy ra lỗi khi xác thực. Vui lòng thử lại sau."}, status_code=500)

async def resend_code_api(request):
    try:
        data = await request.json()
        username = data.get('username', '').strip()
        
        if not username:
            return JSONResponse({"error": "Thiếu thông tin người dùng!"}, status_code=400)
            
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id, ho_ten, email, da_xac_minh FROM tai_khoan WHERE ten_dang_nhap = ?", (username,))
        row = cursor.fetchone()
        
        if not row:
            conn.close()
            return JSONResponse({"error": "Tài khoản không tồn tại!"}, status_code=400)
            
        user = dict(row)
        if user['da_xac_minh']:
            conn.close()
            return JSONResponse({"error": "Tài khoản này đã được xác thực trước đó!"}, status_code=400)
            
        # Rate limiting cho resend
        ip = _get_client_ip(request)
        if not _check_rate_limit(f"resend:{ip}"):
            return JSONResponse({"error": "Quá nhiều yêu cầu gửi lại OTP. Vui lòng thử lại sau 60 giây."}, status_code=429)

        code = _generate_otp()
        expiry = int(time.time()) + 600
        
        cursor.execute("UPDATE tai_khoan SET ma_xac_minh = ?, han_xac_minh = ? WHERE id = ?", (code, expiry, user['id']))
        conn.commit()
        conn.close()
        
        tieu_de = "[BiddingFlow] Gửi lại mã xác thực tài khoản"
        noi_dung_html = f"""
        <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
                <h2 style="color: #2563eb; text-align: center;">Mã xác thực mới của bạn</h2>
                <p>Xin chào <strong>{user['ho_ten']}</strong>,</p>
                <p>Bạn đã yêu cầu gửi lại mã xác nhận email cho tài khoản BiddingFlow. Mã OTP mới là:</p>
                <div style="background-color: #f1f5f9; padding: 15px; text-align: center; border-radius: 6px; margin: 20px 0;">
                    <span style="font-size: 24px; font-weight: bold; color: #1e3a8a; letter-spacing: 4px;">{code}</span>
                </div>
                <p style="font-size: 0.9rem; color: #64748b;">Mã OTP này có hiệu lực trong vòng 10 phút. Vui lòng không chia sẻ mã này với bất kỳ ai.</p>
                <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;">
                <p style="font-size: 0.8rem; color: #94a3b8; text-align: center;">Hệ thống Đấu Thầu BiddingFlow</p>
            </div>
        </body>
        </html>
        """
        tasks = BackgroundTasks()
        tasks.add_task(gui_email, user['email'], tieu_de, noi_dung_html)
        
        return JSONResponse(
            {"success": True, "message": "Đã gửi lại mã OTP xác nhận vào email của bạn!"},
            background=tasks
        )
    except Exception as e:
        log_error(e, "resend_code_api")
        return JSONResponse({"error": "Đã xảy ra lỗi. Vui lòng thử lại sau."}, status_code=500)

async def login_api(request):
    try:
        # Rate limiting bảo vệ brute force
        ip = _get_client_ip(request)
        if not _check_rate_limit(f"login:{ip}"):
            return JSONResponse({"error": "Quá nhiều lần đăng nhập thất bại. Vui lòng thử lại sau 60 giây."}, status_code=429)

        data = await request.json()
        username = data.get('username', '').strip()
        password = data.get('password', '').strip()
        
        if not username or not password:
            return JSONResponse({"error": "Vui lòng nhập tài khoản và mật khẩu!"}, status_code=400)
            
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM tai_khoan WHERE ten_dang_nhap = ? OR (email != '' AND email = ?)",
            (username, username)
        )
        row = cursor.fetchone()

        if not row:
            conn.close()
            return JSONResponse({"error": "Tên đăng nhập hoặc mật khẩu không đúng"}, status_code=400)
            
        user = dict(row)
        if not verify_password(user['mat_khau'], password):
            conn.close()
            return JSONResponse({"error": "Tên đăng nhập hoặc mật khẩu không đúng"}, status_code=400)
            
        if not user.get('da_xac_minh'):
            conn.close()
            return JSONResponse({
                "error": "Tài khoản của bạn chưa được xác thực email. Vui lòng xác thực trước khi đăng nhập!",
                "unverified": True,
                "username": user['ten_dang_nhap']
            }, status_code=400)
            
        # Generate new active session token (uuid) to log out other devices
        session_token = str(uuid.uuid4())
        token_expiry = int((datetime.utcnow() + timedelta(hours=12)).timestamp())  # Unix timestamp (Giảm xuống 12 giờ theo Mục 11)
        device_info = json.dumps({
            "user_agent": request.headers.get("User-Agent", "")[:200],
            "ip": request.client.host,
            "login_time": datetime.utcnow().isoformat()
        })
        cursor.execute(
            "UPDATE tai_khoan SET token_phien = ?, han_su_dung_token = ?, thong_tin_thiet_bi_cuoi = ? WHERE id = ?",
            (session_token, token_expiry, device_info, user['id'])
        )
        org_names = get_user_org_names(cursor, user['id'])
        conn.commit()
        conn.close()
        
        effective_roles = list(get_effective_roles(user['vai_tro']))
        response = JSONResponse({
            "success": True,
            "id": user['id'],
            "session_token": session_token,
            "username": user['ten_dang_nhap'],
            "name": user['ho_ten'],
            "role": user['vai_tro'],
            "effective_roles": effective_roles,
            "email": user['email'],
            "avatar": user.get('anh_dai_dien'),
            "package_id": user.get('goi_dich_vu_id'),
            "organization_name": org_names
        })
        response.set_cookie("session_token", session_token, httponly=True, secure=False, samesite="lax", path="/")
        response.set_cookie("username", user['ten_dang_nhap'], httponly=True, secure=False, samesite="lax", path="/")
        return response
    except Exception as e:
        log_error(e, "login_api")
        return JSONResponse({"error": "Đã xảy ra lỗi khi đăng nhập. Vui lòng thử lại sau."}, status_code=500)

async def check_session_api(request):
    try:
        data = await request.json()
        username = data.get('username', '').strip()
        session_token = data.get('session_token', '').strip()
        
        if not username or not session_token:
            return JSONResponse({"valid": False, "error": "Thi\u1ebfu th\u00f4ng tin x\u00e1c th\u1ef1c"}, status_code=400)
        
        # BE-4: Th\u1eed l\u1ea5y t\u1eeb session cache tr\u01b0\u1edbc \u0111\u1ec3 tr\u00e1nh query DB kh\u00f4ng c\u1ea7n thi\u1ebft
        cached = _session_cache_get(session_token)
        if cached and cached.get('token_phien') == session_token and 'ten_dang_nhap' in cached:
            # Kiểm tra token expiry trong cache
            if cached.get('han_su_dung_token'):
                try:
                    if time.time() > float(cached['han_su_dung_token']):
                        _session_cache_invalidate(session_token)
                        return JSONResponse({"valid": False, "reason": "token_expired"})
                except Exception:
                    pass
            effective_roles = list(get_effective_roles(cached['vai_tro']))
            # Lấy org_names từ DB khi cần (không có trong cache những thông tin đó)
            conn = database.get_connection()
            cursor = conn.cursor()
            org_names = get_user_org_names(cursor, cached['id'])
            conn.close()
            return JSONResponse({
                "valid": True,
                "device_info": cached.get('thong_tin_thiet_bi_cuoi'),
                "user": {
                    "id": cached['id'],
                    "username": cached['ten_dang_nhap'],
                    "name": cached['ho_ten'],
                    "role": cached['vai_tro'],
                    "effective_roles": effective_roles,
                    "email": cached['email'],
                    "avatar": cached.get('anh_dai_dien'),
                    "package_id": cached.get('goi_dich_vu_id'),
                    "organization_name": org_names
                }
            })
            
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id, ten_dang_nhap, ho_ten, vai_tro, email, anh_dai_dien, goi_dich_vu_id, token_phien, han_su_dung_token, thong_tin_thiet_bi_cuoi FROM tai_khoan WHERE ten_dang_nhap = ? OR (email != '' AND email = ?)", (username, username))
        row = cursor.fetchone()
        if not row:
            conn.close()
            return JSONResponse({"valid": False, "reason": "user_not_found"})
            
        user = dict(row)
        org_names = get_user_org_names(cursor, user['id'])
        conn.close()
        
        active_token = user.get('token_phien')
        if active_token != session_token:
            return JSONResponse({"valid": False, "reason": "logged_in_elsewhere"})
            
        if user.get('han_su_dung_token'):
            try:
                # So s\u00e1nh Unix timestamp (s\u1ed1 nguy\u00ean) thay v\u00ec ISO string
                if time.time() > float(user['han_su_dung_token']):
                    return JSONResponse({"valid": False, "reason": "token_expired"})
            except Exception:
                pass
        
        # L\u01b0u v\u00e0o session cache sau khi verify th\u00e0nh c\u00f4ng
        _session_cache_set(session_token, user)
                
        effective_roles = list(get_effective_roles(user['vai_tro']))
        return JSONResponse({
            "valid": True,
            "device_info": user.get('thong_tin_thiet_bi_cuoi'),
            "user": {
                "id": user['id'],
                "username": user['ten_dang_nhap'],
                "name": user['ho_ten'],
                "role": user['vai_tro'],
                "effective_roles": effective_roles,
                "email": user['email'],
                "avatar": user.get('anh_dai_dien'),
                "package_id": user.get('goi_dich_vu_id'),
                "organization_name": org_names
            }
        })
    except Exception as e:
        log_error(e, "check_session_api")
        return JSONResponse({"valid": False, "error": "L\u1ed7i ki\u1ec3m tra phi\u00ean l\u00e0m vi\u1ec7c."}, status_code=500)

async def forgot_password_api(request):
    try:
        # Rate limiting cho quên mật khẩu
        ip = _get_client_ip(request)
        if not _check_rate_limit(f"forgot:{ip}"):
            return JSONResponse({"error": "Quá nhiều yêu cầu. Vui lòng thử lại sau 60 giây."}, status_code=429)

        data = await request.json()
        username = data.get('username', '').strip()
        email = data.get('email', '').strip()
        
        if not username or not email:
            return JSONResponse({"error": "Vui lòng nhập tài khoản và email đã đăng ký!"}, status_code=400)
            
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id, ho_ten FROM tai_khoan WHERE ten_dang_nhap = ? AND email = ?", (username, email))
        row = cursor.fetchone()
        
        if not row:
            conn.close()
            return JSONResponse({"error": "Thông tin tài khoản hoặc email không khớp!"}, status_code=400)
            
        user = dict(row)
        user_id = user['id']
        name = user['ho_ten']
        temp_pwd = secrets.token_hex(4)
        cursor.execute("UPDATE tai_khoan SET mat_khau = ? WHERE id = ?", (hash_password(temp_pwd), user_id))
        conn.commit()
        conn.close()
        
        tieu_de = "[BiddingFlow] Khôi phục mật khẩu tài khoản"
        noi_dung_html = f"""
        <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
                <h2 style="color: #dc2626; text-align: center;">Khôi phục mật khẩu BiddingFlow</h2>
                <p>Xin chào <strong>{name}</strong>,</p>
                <p>Chúng tôi nhận được yêu cầu khôi phục mật khẩu cho tài khoản <strong>{username}</strong>.</p>
                <p>Mật khẩu tạm thời mới của bạn là:</p>
                <div style="background-color: #fef2f2; padding: 15px; text-align: center; border-radius: 6px; margin: 20px 0; border: 1px solid #fca5a5;">
                    <span style="font-size: 22px; font-weight: bold; color: #991b1b; letter-spacing: 2px;">{temp_pwd}</span>
                </div>
                <p>Vui lòng đăng nhập bằng mật khẩu tạm thời này và tiến hành thay đổi mật khẩu ngay lập tức trong phần quản lý tài khoản để đảm bảo bảo mật thông tin.</p>
                <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;">
                <p style="font-size: 0.8rem; color: #94a3b8; text-align: center;">Hệ thống Đấu Thầu BiddingFlow</p>
            </div>
        </body>
        </html>
        """
        tasks = BackgroundTasks()
        tasks.add_task(gui_email, email, tieu_de, noi_dung_html)
        
        return JSONResponse({
            "success": True, 
            "message": "Yêu cầu khôi phục mật khẩu thành công! Mật khẩu mới đã được gửi tới địa chỉ email của bạn. Vui lòng kiểm tra hộp thư (và thư mục Spam nếu không thấy)."
        }, background=tasks)
    except Exception as e:
        log_error(e, "forgot_password_api")
        return JSONResponse({"error": "Đã xảy ra lỗi. Vui lòng thử lại sau."}, status_code=500)

async def update_profile_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
            
        data = await request.json()
        username = data.get('username', '').strip()
        name = data.get('name', '').strip()
        email = data.get('email', '').strip()
        avatar = data.get('avatar', '')
        
        organization_name = data.get('organization_name', '').strip()
        
        if not username or not name or not email:
            return JSONResponse({"error": "Vui lòng điền đầy đủ Họ tên và Email!"}, status_code=400)
            
        conn = database.get_connection()
        cursor = conn.cursor()
        
        # Check if email is in use by another user
        cursor.execute("SELECT ten_dang_nhap FROM tai_khoan WHERE email = ? AND ten_dang_nhap != ?", (email, username))
        if cursor.fetchone():
            conn.close()
            return JSONResponse({"error": "Địa chỉ email này đã được sử dụng bởi một tài khoản khác!"}, status_code=400)
            
        if avatar:
            cursor.execute("UPDATE tai_khoan SET ho_ten = ?, email = ?, anh_dai_dien = ? WHERE ten_dang_nhap = ?", (name, email, avatar, username))
        else:
            cursor.execute("UPDATE tai_khoan SET ho_ten = ?, email = ? WHERE ten_dang_nhap = ?", (name, email, username))
            
        cursor.execute("SELECT id, vai_tro FROM tai_khoan WHERE ten_dang_nhap = ?", (username,))
        u_row = cursor.fetchone()
        if u_row:
            update_user_organizations(cursor, u_row['id'], organization_name, u_row['vai_tro'])
            
        conn.commit()
        conn.close()
        
        return JSONResponse({"success": True, "message": "Cập nhật thông tin tài khoản thành công!"})
    except Exception as e:
        log_error(e, "update_profile_api")
        return JSONResponse({"error": "Đã xảy ra lỗi cập nhật hồ sơ."}, status_code=500)

async def change_password_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
            
        data = await request.json()
        username = data.get('username', '').strip()
        old_password = data.get('old_password', '').strip()
        new_password = data.get('new_password', '').strip()
        
        if not username or not old_password or not new_password:
            return JSONResponse({"error": "Vui lòng nhập đầy đủ mật khẩu cũ và mới!"}, status_code=400)
            
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT mat_khau, id FROM tai_khoan WHERE ten_dang_nhap = ?", (username,))
        row = cursor.fetchone()
        
        if not row:
            conn.close()
            return JSONResponse({"error": "Người dùng không tồn tại!"}, status_code=400)
            
        user = dict(row)
        if not verify_password(user['mat_khau'], old_password):
            conn.close()
            return JSONResponse({"error": "Mật khẩu cũ không chính xác!"}, status_code=400)
            
        # Đổi mật khẩu và làm mới token (kích hoạt đăng xuất thiết bị khác)
        old_token = request.headers.get('X-Session-Token')
        new_token = str(uuid.uuid4())
        cursor.execute(
            "UPDATE tai_khoan SET mat_khau = ?, token_phien = ? WHERE id = ?",
            (hash_password(new_password), new_token, user['id'])
        )
        conn.commit()
        conn.close()
        # Xóa session cũ khỏi cache
        if old_token:
            _session_cache_invalidate(old_token)
        
        return JSONResponse({
            "success": True, 
            "new_session_token": new_token,
            "message": "Thay đổi mật khẩu thành công! Các phiên đăng nhập trên thiết bị khác đã bị đăng xuất."
        })
    except Exception as e:
        log_error(e, "change_password_api")
        return JSONResponse({"error": "Đã xảy ra lỗi khi đổi mật khẩu."}, status_code=500)

async def list_users_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
            
        conn = database.get_connection()
        cursor = conn.cursor()
        
        # Lấy thông tin tổ chức và vai trò của người đang yêu cầu
        cursor.execute("SELECT vai_tro FROM tai_khoan WHERE id = ?", (role_or_err.user_id,))
        requester = cursor.fetchone()
        if not requester:
            conn.close()
            return JSONResponse({"error": "Không tìm thấy thông tin tài khoản yêu cầu!"}, status_code=404)
            
        req_role = requester['vai_tro']
        
        # Lấy danh sách ID các tổ chức mà requester thuộc về
        cursor.execute("SELECT to_chuc_id FROM thanh_vien_to_chuc WHERE user_id = ?", (role_or_err.user_id,))
        req_org_ids = [r['to_chuc_id'] for r in cursor.fetchall()]
        
        sql_base = "SELECT id, ten_dang_nhap AS username, ho_ten AS name, vai_tro AS role, email, anh_dai_dien AS avatar, goi_dich_vu_id AS package_id, ngay_bat_dau_goi AS package_start_date, ngay_het_han_goi AS package_end_date FROM tai_khoan"
        
        # Hỗ trợ tìm kiếm theo email chính xác cho cả vai trò quản lý
        email_query = request.query_params.get('email')
        if email_query:
            cursor.execute(sql_base + " WHERE email = ?", (email_query.strip().lower(),))
            users_raw = cursor.fetchall()
        elif 'super_admin' in get_effective_roles(req_role):
            cursor.execute(sql_base)
            users_raw = cursor.fetchall()
        else:
            if not req_org_ids:
                # Nếu người dùng không thuộc tổ chức nào và không phải super_admin, chỉ trả về chính họ
                cursor.execute(sql_base + " WHERE id = ?", (role_or_err.user_id,))
                users_raw = cursor.fetchall()
            else:
                # Lọc những tài khoản thuộc tổ chức hoạt động hiện tại (active_org) thay vì tất cả tổ chức của requester
                from helpers import get_active_org
                active_org_id = get_active_org(request, role_or_err.user_id)
                if active_org_id and active_org_id in req_org_ids:
                    cursor.execute(f"""
                        SELECT DISTINCT tk.id, tk.ten_dang_nhap AS username, tk.ho_ten AS name, tk.vai_tro AS role, 
                                        tk.email, tk.anh_dai_dien AS avatar, tk.goi_dich_vu_id AS package_id, 
                                        tk.ngay_bat_dau_goi AS package_start_date, tk.ngay_het_han_goi AS package_end_date 
                        FROM tai_khoan tk
                        JOIN thanh_vien_to_chuc tvtc ON tk.id = tvtc.user_id
                        WHERE tvtc.to_chuc_id = ?
                    """, (active_org_id,))
                    users_raw = cursor.fetchall()
                else:
                    # Fallback nếu không có active_org hợp lệ
                    placeholders = ",".join("?" for _ in req_org_ids)
                    cursor.execute(f"""
                        SELECT DISTINCT tk.id, tk.ten_dang_nhap AS username, tk.ho_ten AS name, tk.vai_tro AS role, 
                                        tk.email, tk.anh_dai_dien AS avatar, tk.goi_dich_vu_id AS package_id, 
                                        tk.ngay_bat_dau_goi AS package_start_date, tk.ngay_het_han_goi AS package_end_date 
                        FROM tai_khoan tk
                        JOIN thanh_vien_to_chuc tvtc ON tk.id = tvtc.user_id
                        WHERE tvtc.to_chuc_id IN ({placeholders})
                    """, req_org_ids)
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
        
        # Xóa cache session, cache tổ chức hoạt động và ngắt kết nối WebSocket
        _session_cache_invalidate_by_user_id(user_id)
        from helpers import _org_cache_invalidate_by_user_id
        _org_cache_invalidate_by_user_id(user_id)
        from .sync_routes import disconnect_user_websockets
        disconnect_user_websockets(user_id)
        
        return JSONResponse({"success": True, "message": "Xóa người dùng thành công!"})
    except Exception as e:
        log_error(e, "delete_user_api")
        return JSONResponse({"error": "Đã xảy ra lỗi xóa tài khoản."}, status_code=500)

async def update_user_role_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
            
        effective_roles = get_effective_roles(role_or_err)
        if 'manager' not in effective_roles:
            return JSONResponse({"error": "Bạn không có quyền thực hiện thao tác này!"}, status_code=403)
            
        data = await request.json()
        user_id = data.get('user_id')
        new_role = data.get('role')
        
        if not user_id or not new_role:
            return JSONResponse({"error": "Thiếu thông tin bắt buộc!"}, status_code=400)
            
        # Hỗ trợ nhiều role phân tách bằng dấu phẩy (VD: 'super_admin,manager')
        valid_roles = {'super_admin', 'manager', 'employee'}
        requested_roles = [r.strip() for r in new_role.split(',') if r.strip()]
        if not requested_roles or not all(r in valid_roles for r in requested_roles):
            return JSONResponse({"error": "Vai trò không hợp lệ!"}, status_code=400)
            
        # Nếu người thực hiện không phải là super_admin, không được phép gán vai trò super_admin
        if 'super_admin' not in effective_roles and 'super_admin' in requested_roles:
            return JSONResponse({"error": "Bạn không có quyền gán vai trò Quản trị viên tối cao!"}, status_code=403)
        
        # BE-7: Kiểm tra target user có trong cùng tổ chức với requester không (trừ super_admin)
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
        
        # Chuẩn hóa: nếu có super_admin thì không cần liệt kê lại manager/employee
        normalized_role = ','.join(requested_roles)
            
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("UPDATE tai_khoan SET vai_tro = ? WHERE id = ?", (normalized_role, user_id))
        conn.commit()
        conn.close()
        # Invalidate session cache ngay lập tức để quyền hạn có hiệu lực tức thời
        _session_cache_invalidate_by_user_id(user_id)
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
        # Lấy danh sách gói hợp lệ từ DB thay vì hardcode
        cursor.execute("SELECT id FROM goi_dich_vu")
        valid_pkg_ids = {row['id'] for row in cursor.fetchall()} | {'none', ''}
        for p in pkgs:
            if p and p not in valid_pkg_ids:
                conn.close()
                return JSONResponse({"error": "Gói đăng ký không hợp lệ!"}, status_code=400)
        cursor.execute("UPDATE tai_khoan SET goi_dich_vu_id = ? WHERE id = ?", (new_package, user_id))
        conn.commit()
        conn.close()
        # Invalidate session cache ngay lập tức để thay đổi gói có hiệu lực tức thời
        _session_cache_invalidate_by_user_id(user_id)
        return JSONResponse({"success": True, "message": "Cập nhật gói đăng ký thành công!"})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

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
            # Get user role
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
        return JSONResponse({"success": True, "message": "Cập nhật thông tin thành công!"})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

async def list_system_packages_api(request):
    try:
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id, ten_goi AS name, gia_ca AS price, han_muc_nhan_su AS quota, mo_ta AS description FROM goi_dich_vu")
        packages = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return JSONResponse(packages)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

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
        return JSONResponse({"success": True, "message": "Cập nhật gói dịch vụ thành công!"})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

async def add_user_to_org_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
            
        effective_roles = get_effective_roles(role_or_err)
        if 'manager' not in effective_roles:
            return JSONResponse({"error": "Bạn không có quyền thực hiện thao tác này!"}, status_code=403)
            
        data = await request.json()
        user_id = data.get('user_id')
        if not user_id:
            return JSONResponse({"error": "Thiếu thông tin bắt buộc!"}, status_code=400)
            
        from helpers import get_active_org
        org_id = get_active_org(request, role_or_err.user_id)
        
        conn = database.get_connection()
        cursor = conn.cursor()
        
        # Kiểm tra xem tổ chức đã tồn tại chưa, nếu chưa thì tự động tạo
        cursor.execute("SELECT 1 FROM to_chuc WHERE id = ?", (org_id,))
        if not cursor.fetchone():
            cursor.execute("SELECT ho_ten, email FROM tai_khoan WHERE id = ?", (role_or_err.user_id,))
            mgr_row = cursor.fetchone()
            if mgr_row:
                mgr_name = mgr_row['ho_ten'] or mgr_row['email'] or f"Quản lý {role_or_err.user_id}"
            else:
                mgr_name = f"Quản lý {role_or_err.user_id}"
            
            org_name = f"Tổ chức của {mgr_name}"
            cursor.execute("SELECT 1 FROM to_chuc WHERE ten_to_chuc = ?", (org_name,))
            if cursor.fetchone():
                org_name = f"Tổ chức của {mgr_name} ({org_id})"
                
            cursor.execute(
                "INSERT INTO to_chuc (id, ten_to_chuc, quan_ly_id) VALUES (?, ?, ?)",
                (org_id, org_name, role_or_err.user_id)
            )
            cursor.execute(
                "INSERT OR IGNORE INTO thanh_vien_to_chuc (user_id, to_chuc_id, vai_tro_trong_to_chuc) VALUES (?, ?, ?)",
                (role_or_err.user_id, org_id, 'manager')
            )
        
        # Kiểm tra xem nhân sự đã thuộc tổ chức này chưa
        cursor.execute("SELECT user_id FROM thanh_vien_to_chuc WHERE user_id = ? AND to_chuc_id = ?", (user_id, org_id))
        if cursor.fetchone():
            conn.close()
            return JSONResponse({"success": True, "message": "Nhân sự đã thuộc tổ chức này!"})
            
        # Thêm vào tổ chức
        cursor.execute(
            "INSERT OR IGNORE INTO thanh_vien_to_chuc (user_id, to_chuc_id, vai_tro_trong_to_chuc) VALUES (?, ?, ?)",
            (user_id, org_id, 'employee')
        )
        
        # Cập nhật vai trò hệ thống của tài khoản thành employee nếu vai trò trống hoặc là none
        cursor.execute("SELECT vai_tro FROM tai_khoan WHERE id = ?", (user_id,))
        u_row = cursor.fetchone()
        if u_row:
            current_role = u_row['vai_tro'] or ''
            if not current_role or current_role == 'none':
                cursor.execute("UPDATE tai_khoan SET vai_tro = 'employee' WHERE id = ?", (user_id,))
                
        conn.commit()
        conn.close()
        _session_cache_invalidate_by_user_id(user_id)
        
        return JSONResponse({"success": True, "message": "Thêm nhân sự vào tổ chức thành công!"})
    except OrgPermissionError as e:
        return JSONResponse({"error": str(e)}, status_code=403)
    except Exception as e:
        log_error(e, "add_user_to_org_api")
        return JSONResponse({"error": str(e)}, status_code=500)

async def remove_user_from_org_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
            
        effective_roles = get_effective_roles(role_or_err)
        if 'manager' not in effective_roles:
            return JSONResponse({"error": "Bạn không có quyền thực hiện thao tác này!"}, status_code=403)
            
        data = await request.json()
        user_id = data.get('user_id')
        if not user_id:
            return JSONResponse({"error": "Thiếu thông tin bắt buộc!"}, status_code=400)
            
        from helpers import get_active_org
        org_id = get_active_org(request, role_or_err.user_id)
        
        conn = database.get_connection()
        cursor = conn.cursor()
        
        cursor.execute("DELETE FROM thanh_vien_to_chuc WHERE user_id = ? AND to_chuc_id = ?", (user_id, org_id))
        
        # Gỡ các bản ghi ma_tran_phan_quyen của nhân sự trong tổ chức này và ghi nhận deletion log
        cursor.execute("SELECT id FROM ma_tran_phan_quyen WHERE emp_id = ? AND owner_id = ?", (user_id, org_id))
        pq_rows = cursor.fetchall()
        for row in pq_rows:
            pq_id = row['id']
            cursor.execute("DELETE FROM ma_tran_phan_quyen WHERE id = ?", (pq_id,))
            cursor.execute(
                "INSERT OR IGNORE INTO deleted_records (table_name, record_id, owner_id, deleted_at) VALUES (?, ?, ?, ?)",
                ("ma_tran_phan_quyen", pq_id, org_id, int(time.time()))
            )
            
        # Gỡ các bản ghi phan_cong_nhan_su (tự động ghi nhận deletion log qua DB trigger)
        cursor.execute("DELETE FROM phan_cong_nhan_su WHERE id_nhan_vien = ? AND owner_id = ?", (user_id, org_id))
        
        conn.commit()
        conn.close()
        
        # Xóa cache session, cache tổ chức hoạt động và ngắt kết nối WebSocket
        _session_cache_invalidate_by_user_id(user_id)
        from helpers import _org_cache_invalidate_by_user_id
        _org_cache_invalidate_by_user_id(user_id)
        from .sync_routes import disconnect_user_websockets
        disconnect_user_websockets(user_id)
        
        return JSONResponse({"success": True, "message": "Gỡ nhân sự khỏi tổ chức thành công!"})
    except OrgPermissionError as e:
        return JSONResponse({"error": str(e)}, status_code=403)
    except Exception as e:
        log_error(e, "remove_user_from_org_api")
        return JSONResponse({"error": str(e)}, status_code=500)
