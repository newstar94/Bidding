from backend.db.db_helper import DatabaseError, IntegrityError
import os
import json
import uuid
import time
import urllib.request
import urllib.error
import urllib.parse
import secrets
from datetime import datetime, timezone

from starlette.responses import JSONResponse
from starlette.background import BackgroundTasks

from backend.shared.helpers import (
    database,
    log_error,
    log_audit,
)
from backend.sync.api import disconnect_user_websockets
from backend.auth.auth_service import (
    get_client_ip,
    get_rate_limit_decision,
    RateLimitDecision,
    rate_limit_response,
    clear_rate_limit_buckets,
    build_user_access_payload,
    _SECURE_COOKIES,
    SESSION_EXPIRY_HOURS,
    SESSION_INACTIVITY_TIMEOUT_HOURS,
)
from backend.db.id_utils import generate_record_id
from backend.auth.identity import (
    GOOGLE_ISSUERS,
    conflict_payload,
    identity_conflict_code,
    normalize_email,
)
from backend.shared.request_validation import read_json_object, validate_or_response
from backend.auth.profile_validation import ProfileValidationError, validate_profile_fields
from backend.auth.session_store import replace_user_session
from backend.auth.email_delivery_service import (
    create_email_delivery,
    deliver_email_once,
)
from backend.shared.async_io import (
    BlockingIOBusyError,
    BlockingIOTimeoutError,
    run_blocking_io,
)
from backend.shared.cpu_io import run_cpu_bound
from backend.shared.database_io import run_database_write
from backend.documents.word_defaults import ensure_personal_word_workspace
from backend.shared.email_templates import render_branded_email

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")


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


_GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo?id_token={token}"


_UNICODE_MAP = str.maketrans(
    "àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ"
    "ÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ",
    "aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd"
    "AAAAAAAAAAAAAAAAAEEEEEEEEEEEIIIIIOOOOOOOOOOOOOOOOOUUUUUUUUUUUYYYYYD",
)

from backend.auth.username_validator import generate_suggested_username
from backend.shared.safe_http import open_allowlisted_https


def _verify_google_token(id_token: str):

    if not id_token or not GOOGLE_CLIENT_ID:
        return None
    try:
        url = _GOOGLE_TOKENINFO_URL.format(token=urllib.parse.quote(id_token))
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with open_allowlisted_https(
            req,
            allowed_hosts={"oauth2.googleapis.com"},
            timeout=10,
        ) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.HTTPError, urllib.error.URLError, json.JSONDecodeError, Exception):
        return None


    aud = payload.get("aud", "")
    if aud != GOOGLE_CLIENT_ID:
        return None

    if payload.get("iss") not in GOOGLE_ISSUERS:
        return None


    try:
        if int(payload.get("exp", 0)) < int(time.time()):
            return None
    except (ValueError, TypeError):
        return None

    return payload


def _add_background_audit(bg_tasks, action, **kwargs):
    if bg_tasks is None:
        bg_tasks = BackgroundTasks()
    bg_tasks.add_task(log_audit, action, **kwargs)
    return bg_tasks


def _temporary_password_email(display_name, email, temporary_password):
    subject = "[BiddingFlow] Mật khẩu tạm cho tài khoản"
    body = render_branded_email(
        title="Tài khoản BiddingFlow đã được tạo",
        preheader="Thông tin đăng nhập dự phòng cho tài khoản Google của bạn.",
        eyebrow="TÀI KHOẢN MỚI",
        recipient_name=display_name or "bạn",
        lead="Bạn vừa tạo tài khoản BiddingFlow bằng Google.",
        details=(("Email đăng ký", email),),
        paragraphs=(
            "Sau khi đặt tên đăng nhập trong ứng dụng, bạn có thể dùng tên đăng nhập và mật khẩu tạm dưới đây để đăng nhập.",
        ),
        code=temporary_password,
        code_label="Mật khẩu tạm",
        notice="Hãy đổi mật khẩu ngay sau lần đăng nhập đầu tiên. Nếu bạn không thực hiện thao tác này, hãy liên hệ quản trị viên.",
        notice_tone="warning",
    )
    return subject, body


async def google_login_api(request):

    conn = None
    bg_tasks = None
    pending_audits = []
    temporary_password = None
    temporary_password_delivery_id = None
    temporary_password_sent = False
    temporary_password_queued = False
    created_new_account = False
    try:
        ip = get_client_ip(request)
        rate_key = f"google_login:{ip}"
        google_limit = await _rate_limit_decision(
            rate_key, consume_attempt=True
        )
        if not google_limit.allowed:
            return rate_limit_response("Quá nhiều yêu cầu đăng nhập. Vui lòng thử lại sau.", google_limit)

        if not GOOGLE_CLIENT_ID:
            return JSONResponse(
                {"error": "Đăng nhập Google chưa được cấu hình trên máy chủ."},
                status_code=503,
            )

        data, json_error = await read_json_object(request)
        if json_error:
            return json_error
        invalid = validate_or_response(request, data, {
            "credential": {"type": "string", "required": True, "min_length": 1, "max_length": 20_000},
        })
        if invalid:
            return invalid

        credential = (data.get("credential") or "").strip()
        if not credential:
            return JSONResponse({"error": "Thiếu thông tin xác thực Google."}, status_code=400)

        try:
            payload = await run_blocking_io(
                _verify_google_token,
                credential,
                timeout_seconds=12,
            )
        except (BlockingIOBusyError, BlockingIOTimeoutError):
            return JSONResponse(
                {
                    "error": "Dịch vụ xác thực Google đang bận. Vui lòng thử lại sau.",
                    "code": "GOOGLE_AUTH_UPSTREAM_BUSY",
                },
                status_code=503,
            )
        if not payload:
            log_audit("auth.google_login_failed", request=request, metadata={"reason": "invalid_token"})
            return JSONResponse(
                {"error": "Token Google không hợp lệ hoặc đã hết hạn. Vui lòng thử lại."},
                status_code=401,
            )

        google_id = str(payload.get("sub") or "").strip()
        email = normalize_email(payload.get("email"))
        name = payload.get("name") or email.split("@")[0]
        picture = payload.get("picture") or ""
        email_verified = payload.get("email_verified") in (True, "true", "True", "1")

        if not google_id or not email:
            return JSONResponse({"error": "Không lấy được thông tin từ tài khoản Google."}, status_code=400)

        if not email_verified:
            return JSONResponse(
                {"error": "Email Google chưa được xác minh. Vui lòng xác minh email Google trước."},
                status_code=400,
            )

        if len(google_id) > 255:
            return JSONResponse({"error": "Định danh Google không hợp lệ."}, status_code=400)

        try:
            name, email, picture = validate_profile_fields(name, email, picture)
        except ProfileValidationError as exc:
            return JSONResponse({"error": str(exc), "code": exc.code}, status_code=400)

        conn = database.get_connection()
        conn.execute("BEGIN")
        cursor = conn.cursor()


        user = None
        cursor.execute(
            """
            SELECT tk.*
            FROM dinh_danh_ngoai dd
            JOIN tai_khoan tk ON tk.id = dd.user_id
            WHERE dd.issuer = ? AND dd.subject = ?
            FOR UPDATE OF tk
            """,
            ("https://accounts.google.com", google_id),
        )
        row = cursor.fetchone()
        if row:
            user = dict(row)
            if str(user.get("trang_thai") or "active").strip().lower() != "active":
                conn.rollback()
                return JSONResponse(
                    {
                        "error": "Tài khoản đã ngừng hoạt động.",
                        "code": "ACCOUNT_INACTIVE",
                    },
                    status_code=403,
                )


        account_linked = False
        if not user:
            cursor.execute(
                "SELECT * FROM tai_khoan WHERE email_norm = ? FOR UPDATE",
                (email,),
            )
            row = cursor.fetchone()
            if row:
                user = dict(row)
                if str(user.get("trang_thai") or "active").strip().lower() != "active":
                    conn.rollback()
                    return JSONResponse(
                        {
                            "error": "Tài khoản đã ngừng hoạt động.",
                            "code": "ACCOUNT_INACTIVE",
                        },
                        status_code=403,
                    )
                account_linked = True


                already_has_username = bool(user.get("ten_dang_nhap"))
                cursor.execute(
                    """
                    INSERT INTO dinh_danh_ngoai (issuer, subject, user_id, email_norm)
                    VALUES (?, ?, ?, ?)
                    """,
                    ("https://accounts.google.com", google_id, user["id"], email),
                )
                cursor.execute(
                    "UPDATE tai_khoan SET anh_dai_dien = COALESCE(NULLIF(anh_dai_dien,''), ?), username_da_dat = ? WHERE id = ?",
                    (picture, 1 if already_has_username else 0, user["id"]),
                )
                user["username_da_dat"] = 1 if already_has_username else 0
                if not user.get("anh_dai_dien") and picture:
                    user["anh_dai_dien"] = picture
                pending_audits.append((
                    "auth.google_account_linked",
                    {
                        "actor_user_id": user["id"],
                        "target_type": "tai_khoan",
                        "target_id": user["id"],
                        "request": request,
                        "metadata": {"email": email, "had_username": already_has_username},
                    },
                ))

        else:
            account_linked = False


        if not user:
            from backend.shared.helpers import hash_password as _hash_password

            # A newly created Google account also receives a one-time bootstrap
            # password so the owner can use the regular login flow after choosing
            # a username. Only the hash is stored; the clear value is emailed once.
            temporary_password = secrets.token_urlsafe(12)
            try:
                random_password_hash = await run_cpu_bound(
                    _hash_password,
                    temporary_password,
                    timeout_seconds=15,
                )
            except (BlockingIOBusyError, BlockingIOTimeoutError):
                conn.rollback()
                response = JSONResponse(
                    {
                        "error": "Hệ thống đang xử lý nhiều yêu cầu xác thực. Vui lòng thử lại sau.",
                        "code": "PASSWORD_CPU_QUEUE_BUSY",
                    },
                    status_code=503,
                )
                response.headers["Retry-After"] = "1"
                return response
            new_id = generate_record_id("tai_khoan")
            cursor.execute(
                """INSERT INTO tai_khoan
                   (id, ten_dang_nhap, username_norm, mat_khau, ho_ten, vai_tro,
                    email, email_norm, anh_dai_dien, da_xac_minh, username_da_dat)
                   VALUES (?, NULL, NULL, ?, ?, 'user', ?, ?, ?, 1, 0)""",
                (new_id, random_password_hash, name, email, email, picture),
            )
            ensure_personal_word_workspace(cursor, new_id)
            cursor.execute(
                """
                INSERT INTO dinh_danh_ngoai (issuer, subject, user_id, email_norm)
                VALUES (?, ?, ?, ?)
                """,
                ("https://accounts.google.com", google_id, new_id, email),
            )
            cursor.execute("SELECT * FROM tai_khoan WHERE id = ?", (new_id,))
            user = dict(cursor.fetchone())
            created_new_account = True
            email_subject, email_body = _temporary_password_email(
                user.get("ho_ten"),
                email,
                temporary_password,
            )
            temporary_password_delivery_id = create_email_delivery(
                cursor,
                user_id=new_id,
                purpose="google_temporary_password",
                recipient=email,
                subject=email_subject,
                html_body=email_body,
            )
            pending_audits.append((
                "auth.google_auto_register",
                {
                    "actor_user_id": new_id,
                    "target_type": "tai_khoan",
                    "target_id": new_id,
                    "request": request,
                    "metadata": {"email": email, "username": None},
                },
            ))


        if not user.get("da_xac_minh"):
            cursor.execute("UPDATE tai_khoan SET da_xac_minh = 1 WHERE id = ?", (user["id"],))
            user["da_xac_minh"] = 1

        session_token = str(uuid.uuid4())
        token_expiry = int(time.time() + SESSION_EXPIRY_HOURS * 3600)
        user_agent = request.headers.get("User-Agent", "")[:200]
        device_info = json.dumps({
            "user_agent": user_agent,
            "ip": get_client_ip(request),
            "login_time": datetime.now(timezone.utc).isoformat(),
            "method": "google",
        })
        replace_user_session(
            cursor,
            user_id=user["id"],
            token=session_token,
            absolute_expires_at=token_expiry,
            idle_timeout_seconds=SESSION_INACTIVITY_TIMEOUT_HOURS * 3600,
            remember=False,
            device_info=device_info,
        )
        active_org_hint = urllib.parse.unquote(
            (request.headers.get("X-Active-Org") or "").strip()
        ) or None
        access_payload = build_user_access_payload(
            cursor,
            user["id"],
            user["vai_tro"],
            active_org_hint,
            user.get("ho_ten"),
        )
        clear_rate_limit_buckets(cursor, rate_key)
        conn.commit()
        disconnect_user_websockets(user["id"])

        if created_new_account and temporary_password and temporary_password_delivery_id:
            # The durable outbox worker already retries pending deliveries. Run
            # the first attempt after the response as well, so Google login is
            # never held open by the SMTP timeout.
            temporary_password_queued = True

        for audit_action, audit_kwargs in pending_audits:
            bg_tasks = _add_background_audit(bg_tasks, audit_action, **audit_kwargs)

        bg_tasks = _add_background_audit(
            bg_tasks,
            "auth.google_login_success",
            actor_user_id=user["id"],
            organization_id=access_payload["active_org_id"],
            target_type="tai_khoan",
            target_id=user["id"],
            request=request,
            metadata={"email": email},
        )
        if temporary_password_queued:
            bg_tasks.add_task(
                deliver_email_once,
                database,
                temporary_password_delivery_id,
            )
        needs_username = not user.get("ten_dang_nhap")


        suggested_username = ""
        if needs_username:
            suggested_username = generate_suggested_username(user.get("ho_ten", ""), email, cursor)

        response = JSONResponse({
            "success": True,
            "id": user["id"],
            "username": user["ten_dang_nhap"],
            "name": user["ho_ten"],
            **access_payload,
            "email": user["email"],
            "avatar": user.get("anh_dai_dien") or "",
            "inactivity_timeout_hours": SESSION_INACTIVITY_TIMEOUT_HOURS,
            "needs_username": needs_username,
            "suggested_username": suggested_username,
            "account_linked": account_linked,
            "is_new_account": created_new_account,
            "temporary_password_sent": temporary_password_sent,
            "temporary_password_queued": temporary_password_queued,
        }, background=bg_tasks)
        cookie_max_age = SESSION_EXPIRY_HOURS * 3600
        response.set_cookie(
            "session_token", session_token,
            httponly=True, secure=_SECURE_COOKIES, samesite="lax", path="/", max_age=cookie_max_age,
        )
        response.delete_cookie("username", path="/")
        return response

    except IntegrityError as e:
        if conn:
            conn.rollback()
        conflict_code = identity_conflict_code(e)
        if conflict_code:
            return JSONResponse(conflict_payload(conflict_code), status_code=409)
        log_error(e, "google_login_api_integrity")
        return JSONResponse(
            {"error": "Không thể liên kết tài khoản do xung đột dữ liệu."},
            status_code=409,
        )
    except Exception as e:
        if conn:
            conn.rollback()
        log_error(e, "google_login_api")
        return JSONResponse(
            {"error": "Đã xảy ra lỗi khi đăng nhập bằng Google. Vui lòng thử lại sau."},
            status_code=500,
        )
    finally:
        if conn:
            try:
                conn.close()
            except DatabaseError:
                pass
