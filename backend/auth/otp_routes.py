from backend.db.db_helper import DatabaseError, IntegrityError
import time
import hashlib
import os
from urllib.parse import quote
from starlette.responses import JSONResponse
from starlette.background import BackgroundTasks

from backend.shared.helpers import (
    database,
    hash_password,
    gui_email,
    log_error,
)
from backend.auth.auth_service import (
    get_client_ip,
    get_rate_limit_decision,
    RateLimitDecision,
    RATE_LIMIT_MAX,
    rate_limit_response,
    generate_otp,
)
from backend.db.id_utils import generate_record_id
from backend.auth.username_validator import validate_username
from backend.auth.password_policy import validate_new_password
from backend.auth.identity import (
    conflict_payload,
    identity_conflict_code,
    normalize_username,
)
from backend.auth.profile_validation import ProfileValidationError, validate_profile_fields
from backend.auth.password_reset_service import (
    InvalidResetToken,
    create_password_reset,
    redeem_password_reset,
)
from backend.shared.request_validation import read_json_object, validate_or_response
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError
from backend.shared.cpu_io import run_cpu_bound
from backend.shared.database_io import run_database_write
from backend.shared.database_io import run_database_read
from backend.auth.security_notifications import build_security_notification_tasks
from backend.auth.otp_security import (
    hash_registration_otp,
    verify_registration_otp,
)
from backend.documents.word_defaults import ensure_personal_word_workspace
from backend.security.turnstile import enforce_turnstile
from backend.shared.email_templates import render_branded_email


PASSWORD_RESET_SENT_MESSAGE = (
    "Đã gửi email hướng dẫn đặt lại mật khẩu. "
    "Vui lòng kiểm tra hộp thư đến hoặc thư rác."
)
TURNSTILE_VERIFY_AFTER_ATTEMPTS = max(
    1,
    int(os.environ.get("TURNSTILE_VERIFY_AFTER_ATTEMPTS", "3")),
)


def _verify_challenge_required(*decisions):
    for decision in decisions:
        if decision is None:
            continue
        remaining = max(0, int(getattr(decision, "remaining", RATE_LIMIT_MAX)))
        attempts_including_current = max(0, RATE_LIMIT_MAX - remaining)
        if max(0, attempts_including_current - 1) >= TURNSTILE_VERIFY_AFTER_ATTEMPTS:
            return True
    return False


def _load_security_recipient(user_id):
    conn = database.get_connection()
    try:
        row = conn.execute(
            "SELECT email, ho_ten FROM tai_khoan WHERE id = ?", (user_id,)
        ).fetchone()
        return tuple(row) if row else None
    finally:
        conn.close()


async def _rate_limit_decision(*args, **kwargs):
    try:
        return await run_database_write(get_rate_limit_decision, *args, **kwargs)
    except BlockingIOBusyError:
        return RateLimitDecision(
            False,
            int(kwargs.get("window_seconds", 60)),
            0,
            storage_failed=True,
        )


def _password_work_unavailable_response():
    response = JSONResponse(
        {
            "error": "Hệ thống đang xử lý nhiều yêu cầu xác thực. Vui lòng thử lại sau.",
            "code": "PASSWORD_CPU_QUEUE_BUSY",
        },
        status_code=503,
    )
    response.headers["Retry-After"] = "1"
    return response


def _database_write_unavailable_response():
    response = JSONResponse(
        {
            "error": "Hệ thống đang xử lý nhiều thay đổi. Vui lòng thử lại sau.",
            "code": "DATABASE_WRITE_QUEUE_FULL",
        },
        status_code=503,
    )
    response.headers["Retry-After"] = "1"
    return response

async def register_api(request):
    conn = None
    try:
        ip = get_client_ip(request)
        register_limit = await _rate_limit_decision(f"register:{ip}")
        if not register_limit.allowed:
            return rate_limit_response("Quá nhiều yêu cầu đăng ký. Vui lòng thử lại sau.", register_limit)

        data, json_error = await read_json_object(request)
        if json_error:
            return json_error
        invalid = validate_or_response(request, data, {
            "username": {"type": "string", "required": True, "min_length": 1, "max_length": 64},
            "password": {"type": "string", "required": True, "min_length": 1, "max_length": 256},
            "name": {"type": "string", "required": True, "min_length": 1, "max_length": 200},
            "email": {"type": "string", "required": True, "min_length": 3, "max_length": 320},
            "turnstileToken": {"type": "string", "max_length": 2048},
        })
        if invalid:
            return invalid
        challenge_error = await enforce_turnstile(
            request,
            data,
            expected_action="register",
        )
        if challenge_error:
            return challenge_error
        username = normalize_username(data.get('username'))
        password = data.get('password')
        try:
            name, email, _ = validate_profile_fields(data.get('name'), data.get('email'), '')
        except ProfileValidationError as exc:
            return JSONResponse({"error": str(exc), "code": exc.code}, status_code=400)
        role = 'user'

        if not username or not isinstance(password, str) or not password or not name or not email:
            return JSONResponse({"error": "Vui lòng nhập đầy đủ thông tin bắt buộc!"}, status_code=400)

        valid_password, password_error = validate_new_password(password)
        if not valid_password:
            return JSONResponse({"error": password_error, "code": "PASSWORD_POLICY_FAILED"}, status_code=400)

        register_identity = hashlib.sha256(
            f"{username}\0{email}".encode("utf-8")
        ).hexdigest()[:24]
        register_identity_limit = await _rate_limit_decision(
            f"register_identity:{register_identity}"
        )
        if not register_identity_limit.allowed:
            return rate_limit_response(
                "Quá nhiều yêu cầu đăng ký cho thông tin này. Vui lòng thử lại sau.",
                register_identity_limit,
            )


        valid, reason = validate_username(username)
        if not valid:
            return JSONResponse({"error": reason}, status_code=400)

        try:
            password_hash = await run_cpu_bound(
                hash_password,
                password,
                timeout_seconds=15,
            )
        except (BlockingIOBusyError, BlockingIOTimeoutError):
            return _password_work_unavailable_response()

        conn = database.get_connection()
        conn.execute("BEGIN")
        cursor = conn.cursor()

        cursor.execute("SELECT id FROM tai_khoan WHERE username_norm = ?", (username,))
        if cursor.fetchone():
            conn.rollback()
            return JSONResponse(conflict_payload("USERNAME_ALREADY_EXISTS"), status_code=409)

        cursor.execute("SELECT id FROM tai_khoan WHERE email_norm = ?", (email,))
        if cursor.fetchone():
            conn.rollback()
            return JSONResponse(conflict_payload("EMAIL_ALREADY_EXISTS"), status_code=409)

        user_uuid = generate_record_id("tai_khoan")
        code = generate_otp()
        expiry = int(time.time()) + 600

        cursor.execute(
            "INSERT INTO tai_khoan (id, ten_dang_nhap, username_norm, mat_khau, ho_ten, vai_tro, email, email_norm, da_xac_minh, ma_xac_minh, han_xac_minh) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                user_uuid, username, username, password_hash, name, role,
                email, email, 0, hash_registration_otp(code, user_uuid), expiry,
            )
        )
        ensure_personal_word_workspace(cursor, user_uuid)
        conn.commit()

        tieu_de = "[BiddingFlow] Xác thực tài khoản đăng ký mới"
        noi_dung_html = render_branded_email(
            title="Chào mừng bạn đến với BiddingFlow",
            preheader="Mã xác thực tài khoản BiddingFlow của bạn.",
            eyebrow="XÁC THỰC TÀI KHOẢN",
            recipient_name=name,
            lead="Tài khoản của bạn đã được tạo thành công.",
            paragraphs=(
                "Hoàn tất xác thực email bằng mã OTP dưới đây để bắt đầu sử dụng không gian làm việc BiddingFlow.",
            ),
            code=code,
            code_label="Mã OTP xác thực",
            notice="Mã có hiệu lực trong 10 phút. Không chia sẻ mã này với bất kỳ ai, kể cả người tự xưng là nhân viên hỗ trợ.",
            notice_tone="warning",
        )
        tasks = BackgroundTasks()
        tasks.add_task(gui_email, email, tieu_de, noi_dung_html)

        return JSONResponse(
            {"success": True, "message": "Đăng ký thành công! Vui lòng kiểm tra email để lấy mã xác nhận kích hoạt tài khoản."},
            background=tasks
        )
    except IntegrityError as e:
        if conn:
            conn.rollback()
        conflict_code = identity_conflict_code(e)
        if conflict_code:
            return JSONResponse(conflict_payload(conflict_code), status_code=409)
        log_error(e, "register_api_integrity")
        return JSONResponse({"error": "Không thể tạo tài khoản do xung đột dữ liệu."}, status_code=409)
    except Exception as e:
        if conn:
            conn.rollback()
        log_error(e, "register_api")
        return JSONResponse({"error": "Đã xảy ra lỗi khi đăng ký. Vui lòng thử lại sau."}, status_code=500)
    finally:
        if conn:
            try: conn.close()
            except DatabaseError: pass

async def verify_email_api(request):
    try:
        data, json_error = await read_json_object(request)
        if json_error:
            return json_error
        invalid = validate_or_response(request, data, {
            "username": {"type": "string", "required": True, "min_length": 1, "max_length": 64},
            "code": {"type": "string", "required": True, "min_length": 6, "max_length": 6},
            "turnstileToken": {"type": "string", "max_length": 2048},
        })
        if invalid:
            return invalid
        username = data.get('username', '').strip()
        code = data.get('code', '').strip()

        if not username or not code:
            return JSONResponse({"error": "Thiếu thông tin xác thực!"}, status_code=400)

        ip = get_client_ip(request)
        verify_ip_limit = await _rate_limit_decision(f"verify:{ip}")
        verify_identity_limit = await _rate_limit_decision(
            f"verify_identity:{username.lower()}"
        )
        if not verify_ip_limit.allowed or not verify_identity_limit.allowed:
            return rate_limit_response(
                "Quá nhiều lần xác thực thất bại. Vui lòng thử lại sau.",
                verify_ip_limit if not verify_ip_limit.allowed else verify_identity_limit,
            )

        challenge_error = await enforce_turnstile(
            request,
            data,
            expected_action="verify_email",
            required=_verify_challenge_required(
                verify_ip_limit,
                verify_identity_limit,
            ),
        )
        if challenge_error:
            return challenge_error

        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id, ma_xac_minh, han_xac_minh FROM tai_khoan WHERE username_norm = ?", (normalize_username(username),))
        row = cursor.fetchone()

        if not row:
            conn.close()
            return JSONResponse({"error": "Tài khoản không tồn tại!"}, status_code=400)

        user = dict(row)
        current_time = int(time.time())

        if not verify_registration_otp(user['ma_xac_minh'], code, user['id']):
            conn.close()
            return JSONResponse({"error": "Mã xác nhận không chính xác!"}, status_code=400)

        if user['han_xac_minh'] and current_time > user['han_xac_minh']:
            conn.close()
            return JSONResponse({"error": "Mã xác nhận đã hết hạn! Vui lòng yêu cầu mã mới."}, status_code=400)

        cursor.execute(
            """UPDATE tai_khoan
                  SET da_xac_minh = 1,
                      registration_verified_at = COALESCE(registration_verified_at, ?),
                      ma_xac_minh = NULL,
                      han_xac_minh = NULL
                WHERE id = ?""",
            (current_time, user['id']),
        )
        conn.commit()
        conn.close()

        return JSONResponse({"success": True, "message": "Xác thực email thành công! Bạn có thể đăng nhập ngay bây giờ."})
    except Exception as e:
        log_error(e, "verify_email_api")
        return JSONResponse({"error": "Đã xảy ra lỗi khi xác thực. Vui lòng thử lại sau."}, status_code=500)

async def resend_code_api(request):
    try:
        data, json_error = await read_json_object(request)
        if json_error:
            return json_error
        invalid = validate_or_response(request, data, {
            "username": {"type": "string", "required": True, "min_length": 1, "max_length": 64},
            "turnstileToken": {"type": "string", "max_length": 2048},
        })
        if invalid:
            return invalid
        username = data.get('username', '').strip()

        if not username:
            return JSONResponse({"error": "Thiếu thông tin người dùng!"}, status_code=400)

        ip = get_client_ip(request)
        resend_ip_limit = await _rate_limit_decision(f"resend:{ip}")
        resend_identity_limit = await _rate_limit_decision(
            f"resend_identity:{username.lower()}"
        )
        if not resend_ip_limit.allowed or not resend_identity_limit.allowed:
            return rate_limit_response(
                "Quá nhiều yêu cầu gửi lại OTP. Vui lòng thử lại sau.",
                resend_ip_limit if not resend_ip_limit.allowed else resend_identity_limit,
            )

        challenge_error = await enforce_turnstile(
            request,
            data,
            expected_action="resend_code",
        )
        if challenge_error:
            return challenge_error

        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id, ho_ten, email, da_xac_minh FROM tai_khoan WHERE username_norm = ?", (normalize_username(username),))
        row = cursor.fetchone()

        if not row:
            conn.close()
            return JSONResponse({"error": "Tài khoản không tồn tại!"}, status_code=400)

        user = dict(row)
        is_verified = bool(user.get('da_xac_minh'))

        if is_verified:
            conn.close()
            return JSONResponse({"error": "Tài khoản này đã được xác thực trước đó!"}, status_code=400)

        code = generate_otp()
        expiry = int(time.time()) + 600

        cursor.execute(
            "UPDATE tai_khoan SET ma_xac_minh = ?, han_xac_minh = ? WHERE id = ?",
            (hash_registration_otp(code, user['id']), expiry, user['id']),
        )
        conn.commit()
        conn.close()

        tieu_de = "[BiddingFlow] Gửi lại mã xác thực tài khoản"
        noi_dung_html = render_branded_email(
            title="Mã xác thực mới của bạn",
            preheader="Mã OTP mới để xác thực tài khoản BiddingFlow.",
            eyebrow="GỬI LẠI MÃ XÁC THỰC",
            recipient_name=user.get('ho_ten') or 'bạn',
            lead="Yêu cầu gửi lại mã đã được tiếp nhận.",
            paragraphs=(
                "Sử dụng mã OTP mới dưới đây để hoàn tất xác thực email. Mã cũ không còn hiệu lực.",
            ),
            code=code,
            code_label="Mã OTP mới",
            notice="Mã có hiệu lực trong 10 phút. Không chia sẻ mã này với bất kỳ ai.",
            notice_tone="warning",
        )
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
        data, json_error = await read_json_object(request)
        if json_error:
            return json_error
        invalid = validate_or_response(request, data, {
            "username": {"type": "string", "required": True, "min_length": 1, "max_length": 64},
            "email": {"type": "string", "required": True, "min_length": 3, "max_length": 320},
            "turnstileToken": {"type": "string", "max_length": 2048},
        })
        if invalid:
            return invalid
        username = data.get('username', '').strip()
        email = data.get('email', '').strip()

        identity_hash = hashlib.sha256(
            f"{username.lower()}\0{email.lower()}".encode("utf-8")
        ).hexdigest()[:24]
        forgot_ip_limit = await _rate_limit_decision(f"forgot:{ip}")
        forgot_identity_limit = await _rate_limit_decision(
            f"forgot_identity:{identity_hash}"
        )
        if not forgot_ip_limit.allowed or not forgot_identity_limit.allowed:
            return rate_limit_response(
                "Quá nhiều yêu cầu. Vui lòng thử lại sau.",
                forgot_ip_limit if not forgot_ip_limit.allowed else forgot_identity_limit,
            )

        challenge_error = await enforce_turnstile(
            request,
            data,
            expected_action="forgot_password",
        )
        if challenge_error:
            return challenge_error

        reset_request = None
        if username and email:
            try:
                reset_request = await run_database_write(
                    create_password_reset,
                    database,
                    username,
                    email,
                    ip,
                )
            except BlockingIOBusyError:
                return _database_write_unavailable_response()

        tasks = BackgroundTasks()
        if reset_request is None:
            return JSONResponse(
                {"success": True, "message": PASSWORD_RESET_SENT_MESSAGE},
            )

        public_url = os.environ.get("APP_PUBLIC_URL", "http://127.0.0.1:8000").rstrip("/")
        reset_link = f"{public_url}/reset-password#token={quote(reset_request['token'], safe='')}"
        subject = "[BiddingFlow] Đặt lại mật khẩu tài khoản"
        email_body = render_branded_email(
            title="Đặt lại mật khẩu BiddingFlow",
            preheader="Liên kết đặt lại mật khẩu an toàn cho tài khoản của bạn.",
            eyebrow="KHÔI PHỤC TÀI KHOẢN",
            recipient_name=reset_request.get('name') or 'bạn',
            lead="Chúng tôi đã nhận được yêu cầu đặt lại mật khẩu.",
            details=(("Tên đăng nhập", reset_request.get('username') or ''),),
            action_label="Đặt lại mật khẩu",
            action_url=reset_link,
            paragraphs=(
                "Nếu bạn không yêu cầu thao tác này, bạn có thể bỏ qua email và mật khẩu hiện tại vẫn được giữ nguyên.",
            ),
            notice="Liên kết chỉ sử dụng được một lần và sẽ hết hạn sau 30 phút.",
            notice_tone="warning",
        )
        tasks.add_task(gui_email, reset_request['email'], subject, email_body, True)

        return JSONResponse({
            "success": True,
            "message": PASSWORD_RESET_SENT_MESSAGE,
        }, background=tasks)
    except Exception as e:
        log_error(e, "forgot_password_api")
        return JSONResponse({"error": "Đã xảy ra lỗi. Vui lòng thử lại sau."}, status_code=500)


async def reset_password_api(request):
    try:
        ip = get_client_ip(request)
        data, json_error = await read_json_object(request)
        if json_error:
            return json_error
        invalid = validate_or_response(request, data, {
            "token": {"type": "string", "required": True, "min_length": 20, "max_length": 512},
            "new_password": {"type": "string", "required": True, "min_length": 1, "max_length": 256},
        })
        if invalid:
            return invalid
        token = str(data.get('token') or '').strip()
        new_password = data.get('new_password')
        token_key = hashlib.sha256(token.encode("utf-8")).hexdigest()[:24]
        reset_ip_limit = await _rate_limit_decision(f"reset_password:{ip}")
        reset_token_limit = await _rate_limit_decision(
            f"reset_password_token:{token_key}"
        )
        if not reset_ip_limit.allowed or not reset_token_limit.allowed:
            return rate_limit_response(
                "Quá nhiều yêu cầu. Vui lòng thử lại sau.",
                reset_ip_limit if not reset_ip_limit.allowed else reset_token_limit,
            )

        valid_password, password_error = validate_new_password(new_password)
        if not valid_password:
            return JSONResponse({"error": password_error, "code": "PASSWORD_POLICY_FAILED"}, status_code=400)

        try:
            password_hash = await run_cpu_bound(
                hash_password,
                new_password,
                timeout_seconds=15,
            )
        except (BlockingIOBusyError, BlockingIOTimeoutError):
            return _password_work_unavailable_response()

        try:
            user_id = await run_database_write(
                redeem_password_reset,
                database,
                token,
                new_password,
                password_hash=password_hash,
                request=request,
            )
        except InvalidResetToken:
            return JSONResponse(
                {
                    "error": "Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.",
                    "code": "RESET_TOKEN_INVALID",
                },
                status_code=400,
            )
        except BlockingIOBusyError:
            return _database_write_unavailable_response()

        from backend.sync.websocket import disconnect_user_websockets
        disconnect_user_websockets(user_id)
        recipient = await run_database_read(_load_security_recipient, user_id)
        return JSONResponse(
            {
                "success": True,
                "message": "Đặt lại mật khẩu thành công. Vui lòng đăng nhập bằng mật khẩu mới.",
            },
            background=build_security_notification_tasks(
                email=recipient[0] if recipient else None,
                display_name=recipient[1] if recipient else None,
                subject="[BiddingFlow] Mật khẩu đã được đặt lại",
                message="Mật khẩu tài khoản vừa được đặt lại bằng liên kết khôi phục và mọi phiên cũ đã bị thu hồi.",
            ),
        )
    except Exception as e:
        log_error(e, "reset_password_api")
        return JSONResponse({"error": "Đã xảy ra lỗi. Vui lòng thử lại sau."}, status_code=500)
