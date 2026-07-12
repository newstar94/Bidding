import time
import secrets
import uuid
from starlette.responses import JSONResponse
from starlette.background import BackgroundTasks

from helpers import (
    database,
    hash_password,
    gui_email,
    log_error,
    _session_cache_invalidate_by_user_id,
)
from services.auth_service import (
    get_client_ip,
    check_rate_limit,
    generate_otp
)
from helpers_py.id_utils import generate_record_id
from helpers_py.username_validator import validate_username

async def register_api(request):
    conn = None
    try:
        ip = get_client_ip(request)
        if not check_rate_limit(f"register:{ip}"):
            return JSONResponse({"error": "Quá nhiều yêu cầu đăng ký. Vui lòng thử lại sau 60 giây."}, status_code=429)

        data = await request.json()
        username = data.get('username', '').strip().lower()
        password = data.get('password', '').strip()
        name = data.get('name', '').strip()
        email = data.get('email', '').strip()
        role = 'employee'

        if not username or not password or not name or not email:
            return JSONResponse({"error": "Vui lòng nhập đầy đủ thông tin bắt buộc!"}, status_code=400)


        valid, reason = validate_username(username)
        if not valid:
            return JSONResponse({"error": reason}, status_code=400)

        conn = database.get_connection()
        cursor = conn.cursor()

        cursor.execute("SELECT id FROM tai_khoan WHERE ten_dang_nhap = ?", (username,))
        if cursor.fetchone():
            return JSONResponse({"error": "Tên đăng nhập đã tồn tại!"}, status_code=400)

        cursor.execute("SELECT id FROM tai_khoan WHERE email = ?", (email,))
        if cursor.fetchone():
            return JSONResponse({"error": "Địa chỉ email này đã được sử dụng bởi một tài khoản khác!"}, status_code=400)

        user_uuid = generate_record_id("tai_khoan")
        code = generate_otp()
        expiry = int(time.time()) + 600

        cursor.execute(
            "INSERT INTO tai_khoan (id, ten_dang_nhap, mat_khau, ho_ten, vai_tro, email, da_xac_minh, ma_xac_minh, han_xac_minh) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (user_uuid, username, hash_password(password), name, role, email, 0, code, expiry)
        )
        conn.commit()

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
    finally:
        if conn:
            try: conn.close()
            except Exception: pass

async def verify_email_api(request):
    try:
        data = await request.json()
        username = data.get('username', '').strip()
        code = data.get('code', '').strip()

        if not username or not code:
            return JSONResponse({"error": "Thiếu thông tin xác thực!"}, status_code=400)

        ip = get_client_ip(request)
        if not check_rate_limit(f"verify:{ip}:{username.lower()}"):
            return JSONResponse({"error": "Quá nhiều lần xác thực thất bại. Vui lòng thử lại sau 60 giây."}, status_code=429)

        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id, ma_xac_minh, han_xac_minh FROM tai_khoan WHERE ten_dang_nhap = ?", (username,))
        row = cursor.fetchone()

        if not row:
            conn.close()
            return JSONResponse({"error": "Tài khoản không tồn tại!"}, status_code=400)

        user = dict(row)
        current_time = int(time.time())

        if not secrets.compare_digest(str(user['ma_xac_minh']), str(code)):
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
        is_verified = bool(user.get('da_xac_minh'))

        if is_verified:
            conn.close()
            return JSONResponse({"error": "Tài khoản này đã được xác thực trước đó!"}, status_code=400)

        ip = get_client_ip(request)
        if not check_rate_limit(f"resend:{ip}"):
            return JSONResponse({"error": "Quá nhiều yêu cầu gửi lại OTP. Vui lòng thử lại sau 60 giây."}, status_code=429)

        code = generate_otp()
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

async def forgot_password_api(request):
    conn = None
    try:
        ip = get_client_ip(request)
        if not check_rate_limit(f"forgot:{ip}"):
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
            return JSONResponse({"error": "Thông tin tài khoản hoặc email không khớp!"}, status_code=400)

        user = dict(row)
        user_id = user['id']
        name = user['ho_ten']
        temp_pwd = secrets.token_urlsafe(12)
        cursor.execute(
            "UPDATE tai_khoan SET mat_khau = ?, token_phien = NULL, han_su_dung_token = NULL WHERE id = ?",
            (hash_password(temp_pwd), user_id)
        )
        conn.commit()
        _session_cache_invalidate_by_user_id(user_id)

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
    finally:
        if conn:
            try: conn.close()
            except Exception: pass
