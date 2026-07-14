import os
import re
import json
import uuid
import time
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime

from starlette.responses import JSONResponse
from starlette.background import BackgroundTasks

from backend.shared.helpers import (
    database,
    log_error,
    log_audit,
    _session_cache_invalidate_by_user_id,
)
from backend.auth.auth_service import (
    get_client_ip,
    check_rate_limit,
    record_rate_limit_failure,
    build_user_access_payload,
    provision_user_organization,
    _SECURE_COOKIES,
    SESSION_EXPIRY_HOURS,
    SESSION_INACTIVITY_TIMEOUT_HOURS,
)
from backend.db.id_utils import generate_record_id

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")


_GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo?id_token={token}"


_UNICODE_MAP = str.maketrans(
    "àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ"
    "ÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ",
    "aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd"
    "AAAAAAAAAAAAAAAAAEEEEEEEEEEEIIIIIOOOOOOOOOOOOOOOOOUUUUUUUUUUUYYYYYD",
)

from backend.auth.username_validator import validate_username as _validate_username


def _generate_suggested_username(name: str, email: str, cursor) -> str:

    import re as _re_u
    import random as _random

    email_prefix = email.split('@')[0].lower()
    base = _re_u.sub(r'[^a-z0-9_]', '_', email_prefix)
    base = _re_u.sub(r'_+', '_', base).strip('_')

    if len(base) < 3:
        base = 'user'


    ok, _ = _validate_username(base)
    if not ok:
        base = (base[:26] + '_u').strip('_')

    candidate = base
    while True:
        try:
            cursor.execute("SELECT 1 FROM tai_khoan WHERE ten_dang_nhap = ?", (candidate,))
            if not cursor.fetchone():
                ok, _ = _validate_username(candidate)
                if ok:
                    break
        except Exception:
            break

        rand_suffix = ''.join(_random.choice('abcdefghijklmnopqrstuvwxyz0123456789') for _ in range(4))
        candidate = f"{base[:25]}_{rand_suffix}"

    return candidate


def _verify_google_token(id_token: str):

    if not id_token or not GOOGLE_CLIENT_ID:
        return None
    try:
        url = _GOOGLE_TOKENINFO_URL.format(token=urllib.parse.quote(id_token))
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.HTTPError, urllib.error.URLError, json.JSONDecodeError, Exception):
        return None


    aud = payload.get("aud", "")
    if aud != GOOGLE_CLIENT_ID:
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


async def google_login_api(request):

    conn = None
    bg_tasks = None
    pending_audits = []
    try:
        ip = get_client_ip(request)
        rate_key = f"google_login:{ip}"
        if not check_rate_limit(rate_key, consume_attempt=False):
            return JSONResponse(
                {"error": "Quá nhiều yêu cầu đăng nhập. Vui lòng thử lại sau 60 giây."},
                status_code=429,
            )

        if not GOOGLE_CLIENT_ID:
            return JSONResponse(
                {"error": "Đăng nhập Google chưa được cấu hình trên máy chủ."},
                status_code=503,
            )

        try:
            data = await request.json()
        except Exception:
            return JSONResponse({"error": "Dữ liệu yêu cầu không hợp lệ."}, status_code=400)

        credential = (data.get("credential") or "").strip()
        if not credential:
            record_rate_limit_failure(rate_key)
            return JSONResponse({"error": "Thiếu thông tin xác thực Google."}, status_code=400)

        payload = _verify_google_token(credential)
        if not payload:
            record_rate_limit_failure(rate_key)
            log_audit("auth.google_login_failed", request=request, metadata={"reason": "invalid_token"})
            return JSONResponse(
                {"error": "Token Google không hợp lệ hoặc đã hết hạn. Vui lòng thử lại."},
                status_code=401,
            )

        google_id = payload.get("sub", "")
        email = (payload.get("email") or "").strip().lower()
        name = (payload.get("name") or email.split("@")[0]).strip()
        picture = payload.get("picture", "")
        email_verified = payload.get("email_verified", "false") == "true"

        if not google_id or not email:
            record_rate_limit_failure(rate_key)
            return JSONResponse({"error": "Không lấy được thông tin từ tài khoản Google."}, status_code=400)

        if not email_verified:
            return JSONResponse(
                {"error": "Email Google chưa được xác minh. Vui lòng xác minh email Google trước."},
                status_code=400,
            )

        conn = database.get_connection()
        cursor = conn.cursor()


        user = None
        try:
            cursor.execute("SELECT * FROM tai_khoan WHERE google_id = ?", (google_id,))
            row = cursor.fetchone()
            if row:
                user = dict(row)
        except Exception:
            pass


        account_linked = False
        if not user:
            cursor.execute(
                "SELECT * FROM tai_khoan WHERE email != '' AND lower(email) = ?",
                (email,),
            )
            row = cursor.fetchone()
            if row:
                user = dict(row)
                account_linked = True


                already_has_username = bool(user.get("ten_dang_nhap"))
                try:
                    cursor.execute(
                        "UPDATE tai_khoan SET google_id = ?, anh_dai_dien = COALESCE(NULLIF(anh_dai_dien,''), ?)"
                        ", username_da_dat = ? WHERE id = ?",
                        (google_id, picture, 1 if already_has_username else 0, user["id"]),
                    )
                    user["google_id"] = google_id
                    user["username_da_dat"] = 1 if already_has_username else 0
                    if not user.get("anh_dai_dien") and picture:
                        user["anh_dai_dien"] = picture
                except Exception:
                    pass
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
            import secrets as _secrets
            from backend.shared.helpers import hash_password as _hash_password


            temp_password = _secrets.token_urlsafe(8)
            temp_password_hash = _hash_password(temp_password)


            new_id = generate_record_id("tai_khoan")

            try:
                cursor.execute(
                    """INSERT INTO tai_khoan
                       (id, ten_dang_nhap, mat_khau, ho_ten, vai_tro, email,
                        anh_dai_dien, da_xac_minh, google_id, username_da_dat)
                       VALUES (?, NULL, ?, ?, 'user', ?, ?, 1, ?, 0)""",
                    (new_id, temp_password_hash, name, email, picture, google_id),
                )
            except Exception:

                cursor.execute(
                    """INSERT INTO tai_khoan
                       (id, ten_dang_nhap, mat_khau, ho_ten, vai_tro, email,
                        anh_dai_dien, da_xac_minh)
                       VALUES (?, NULL, ?, ?, 'user', ?, ?, 1)""",
                    (new_id, temp_password_hash, name, email, picture),
                )
            cursor.execute("SELECT * FROM tai_khoan WHERE id = ?", (new_id,))
            user = dict(cursor.fetchone())
            provision_user_organization(cursor, new_id, name)

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


            bg_tasks = BackgroundTasks()
            try:
                from backend.shared.helpers import gui_email as _gui_email
                tieu_de = "[BiddingFlow] Tài khoản mới — Mật khẩu tạm thời của bạn"
                noi_dung_html = f"""
                <html>
                <body style="font-family: Arial, sans-serif; background: #f4f6fa; margin: 0; padding: 0;">
                  <div style="max-width: 520px; margin: 40px auto; background: #fff; border-radius: 12px;
                              box-shadow: 0 2px 12px rgba(0,0,0,0.08); overflow: hidden;">
                    <div style="background: linear-gradient(135deg, #4f46e5, #7c3aed); padding: 32px; text-align: center;">
                      <h1 style="color: #fff; margin: 0; font-size: 1.4rem;">BiddingFlow</h1>
                      <p style="color: #c4b5fd; margin: 8px 0 0;">Hệ thống quản lý đấu thầu</p>
                    </div>
                    <div style="padding: 32px;">
                      <p style="color: #374151; font-size: 1rem; margin-top: 0;">Xin chào <strong>{name}</strong>,</p>
                      <p style="color: #6b7280;">Tài khoản của bạn vừa được tạo tự động qua đăng nhập Google.
                         Bên dưới là mật khẩu tạm thời để đăng nhập bằng tên đăng nhập (sau khi bạn đặt):</p>
                      <div style="background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 8px;
                                  padding: 20px; text-align: center; margin: 24px 0;">
                        <p style="color: #6b7280; font-size: 0.8rem; margin: 0 0 8px;">MẬT KHẨU TẠM THỜI</p>
                        <span style="font-size: 1.6rem; font-weight: 700; color: #4f46e5;
                                     letter-spacing: 4px; font-family: monospace;">{temp_password}</span>
                      </div>
                      <p style="color: #ef4444; font-size: 0.85rem;">
                        ⚠️ Vui lòng đổi mật khẩu ngay sau khi đăng nhập để bảo mật tài khoản.
                      </p>
                      <p style="color: #6b7280; font-size: 0.85rem;">
                        Lần đăng nhập tiếp theo bạn sẽ được yêu cầu đặt tên đăng nhập (username) cho tài khoản.
                        Tên đăng nhập chỉ có thể đặt một lần và không thể thay đổi sau đó.
                      </p>
                    </div>
                    <div style="background: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
                      <p style="color: #9ca3af; font-size: 0.75rem; margin: 0;">
                        Email này được gửi tự động từ BiddingFlow. Vui lòng không trả lời email này.
                      </p>
                    </div>
                  </div>
                </body>
                </html>
                """
                bg_tasks.add_task(_gui_email, email, tieu_de, noi_dung_html)
            except Exception as _e:
                log_error(_e, "google_login_send_temp_password_email")



        if not user.get("da_xac_minh"):
            cursor.execute("UPDATE tai_khoan SET da_xac_minh = 1 WHERE id = ?", (user["id"],))
            user["da_xac_minh"] = 1


        session_token = str(uuid.uuid4())
        token_expiry = int(time.time() + SESSION_EXPIRY_HOURS * 3600)
        device_info = json.dumps({
            "user_agent": request.headers.get("User-Agent", "")[:200],
            "ip": request.client.host,
            "login_time": datetime.utcnow().isoformat(),
            "method": "google",
        })
        cursor.execute(
            "UPDATE tai_khoan SET token_phien = ?, han_su_dung_token = ?, thong_tin_thiet_bi_cuoi = ? WHERE id = ?",
            (session_token, token_expiry, device_info, user["id"]),
        )
        _session_cache_invalidate_by_user_id(user["id"])

        active_org_hint = urllib.parse.unquote(
            (request.headers.get("X-Active-Org") or "").strip()
        ) or None
        access_payload = build_user_access_payload(
            cursor,
            user["id"],
            user["vai_tro"],
            active_org_hint,
        )
        conn.commit()

        for audit_action, audit_kwargs in pending_audits:
            bg_tasks = _add_background_audit(bg_tasks, audit_action, **audit_kwargs)

        bg_tasks = _add_background_audit(
            bg_tasks,
            "auth.google_login_success",
            actor_user_id=user["id"],
            owner_id=access_payload["active_org_id"],
            target_type="tai_khoan",
            target_id=user["id"],
            request=request,
            metadata={"email": email},
        )

        needs_username = not user.get("ten_dang_nhap")


        suggested_username = ""
        if needs_username:
            suggested_username = _generate_suggested_username(user.get("ho_ten", ""), email, cursor)

        response = JSONResponse({
            "success": True,
            "id": user["id"],
            "username": user["ten_dang_nhap"],
            "name": user["ho_ten"],
            **access_payload,
            "email": user["email"],
            "avatar": user.get("anh_dai_dien") or "",
            "package_id": user.get("goi_dich_vu_id"),
            "inactivity_timeout_hours": SESSION_INACTIVITY_TIMEOUT_HOURS,
            "needs_username": needs_username,
            "suggested_username": suggested_username,
            "account_linked": account_linked,
        }, background=bg_tasks)
        cookie_max_age = SESSION_EXPIRY_HOURS * 3600
        response.set_cookie(
            "session_token", session_token,
            httponly=True, secure=_SECURE_COOKIES, samesite="lax", path="/", max_age=cookie_max_age,
        )
        response.delete_cookie("username", path="/")
        return response

    except Exception as e:
        log_error(e, "google_login_api")
        return JSONResponse(
            {"error": "Đã xảy ra lỗi khi đăng nhập bằng Google. Vui lòng thử lại sau."},
            status_code=500,
        )
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass
