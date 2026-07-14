import time
import secrets
import hashlib
import html
import os
from urllib.parse import quote
from starlette.responses import JSONResponse
from starlette.background import BackgroundTasks

from backend.shared.helpers import (
    database,
    hash_password,
    gui_email,
    log_error,
    log_audit,
    _session_cache_invalidate_by_user_id,
)
from backend.auth.auth_service import (
    get_client_ip,
    check_rate_limit,
    generate_otp,
    provision_user_organization,
)
from backend.db.id_utils import generate_record_id
from backend.auth.username_validator import validate_username
from backend.auth.password_policy import validate_new_password
from backend.auth.password_reset_service import (
    InvalidResetToken,
    create_password_reset,
    redeem_password_reset,
)


PASSWORD_RESET_REQUEST_MESSAGE = (
    "Nếu thông tin phù hợp với một tài khoản, chúng tôi sẽ gửi hướng dẫn đặt lại mật khẩu qua email."
)

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
        role = 'user'

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
        provision_user_organization(cursor, user_uuid, name)
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
    try:
        ip = get_client_ip(request)
        data = await request.json()
        username = data.get('username', '').strip()
        email = data.get('email', '').strip()

        identity_hash = hashlib.sha256(
            f"{username.lower()}\0{email.lower()}".encode("utf-8")
        ).hexdigest()[:24]
        if (
            not check_rate_limit(f"forgot:{ip}")
            or not check_rate_limit(f"forgot_identity:{identity_hash}")
        ):
            return JSONResponse({"error": "Quá nhiều yêu cầu. Vui lòng thử lại sau 60 giây."}, status_code=429)

        reset_request = None
        if username and email:
            reset_request = create_password_reset(database, username, email, ip)

        tasks = BackgroundTasks()
        if reset_request is not None:
            public_url = os.environ.get("APP_PUBLIC_URL", "http://127.0.0.1:8000").rstrip("/")
            reset_link = f"{public_url}/reset-password#token={quote(reset_request['token'], safe='')}"
            safe_name = html.escape(str(reset_request.get('name') or 'bạn'))
            safe_username = html.escape(str(reset_request.get('username') or ''))
            safe_link = html.escape(reset_link, quote=True)

            subject = "[BiddingFlow] Đặt lại mật khẩu tài khoản"
            email_body = f"""
            <html>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
                    <h2 style="color: #2563eb; text-align: center;">Đặt lại mật khẩu BiddingFlow</h2>
                    <p>Xin chào <strong>{safe_name}</strong>,</p>
                    <p>Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản <strong>{safe_username}</strong>.</p>
                    <p style="text-align: center; margin: 28px 0;">
                        <a href="{safe_link}" style="display: inline-block; padding: 12px 22px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 6px;">Đặt lại mật khẩu</a>
                    </p>
                    <p>Liên kết chỉ dùng được một lần và hết hạn sau 30 phút. Nếu bạn không yêu cầu thao tác này, hãy bỏ qua email.</p>
                    <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;">
                    <p style="font-size: 0.8rem; color: #94a3b8; text-align: center;">Hệ thống Đấu Thầu BiddingFlow</p>
                </div>
            </body>
            </html>
            """
            tasks.add_task(gui_email, reset_request['email'], subject, email_body, True)

        return JSONResponse({
            "success": True,
            "message": PASSWORD_RESET_REQUEST_MESSAGE,
        }, background=tasks)
    except Exception as e:
        log_error(e, "forgot_password_api")
        return JSONResponse({"error": "Đã xảy ra lỗi. Vui lòng thử lại sau."}, status_code=500)


async def reset_password_api(request):
    try:
        ip = get_client_ip(request)
        data = await request.json()
        token = str(data.get('token') or '').strip()
        new_password = data.get('new_password')
        token_key = hashlib.sha256(token.encode("utf-8")).hexdigest()[:24]
        if (
            not check_rate_limit(f"reset_password:{ip}")
            or not check_rate_limit(f"reset_password_token:{token_key}")
        ):
            return JSONResponse({"error": "Quá nhiều yêu cầu. Vui lòng thử lại sau 60 giây."}, status_code=429)

        valid_password, password_error = validate_new_password(new_password)
        if not valid_password:
            return JSONResponse({"error": password_error, "code": "PASSWORD_POLICY_FAILED"}, status_code=400)

        try:
            user_id = redeem_password_reset(database, token, new_password)
        except InvalidResetToken:
            return JSONResponse(
                {
                    "error": "Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.",
                    "code": "RESET_TOKEN_INVALID",
                },
                status_code=400,
            )

        _session_cache_invalidate_by_user_id(user_id)
        from backend.sync.websocket import disconnect_user_websockets
        disconnect_user_websockets(user_id)
        log_audit(
            "auth.password_reset",
            actor_user_id=user_id,
            target_type="tai_khoan",
            target_id=user_id,
            request=request,
        )
        return JSONResponse({
            "success": True,
            "message": "Đặt lại mật khẩu thành công. Vui lòng đăng nhập bằng mật khẩu mới.",
        })
    except Exception as e:
        log_error(e, "reset_password_api")
        return JSONResponse({"error": "Đã xảy ra lỗi. Vui lòng thử lại sau."}, status_code=500)
