from backend.db.db_helper import IntegrityError
import base64
import hashlib
import hmac
import os
import json
import uuid
import time
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone

from cryptography.fernet import Fernet, InvalidToken
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
    session_cookie_secure,
    SESSION_EXPIRY_HOURS,
    SESSION_INACTIVITY_TIMEOUT_HOURS,
)
from backend.db.id_utils import generate_record_id
from backend.auth.identity import (
    GOOGLE_ISSUERS,
    conflict_payload,
    identity_conflict_code,
    normalize_email,
    normalize_username,
)
from backend.shared.request_validation import read_json_object, validate_or_response
from backend.auth.profile_validation import ProfileValidationError, validate_profile_fields
from backend.auth.session_store import replace_user_session
from backend.auth.legal_consent import (
    CONSENT_METHOD_GOOGLE_REGISTRATION_CHECKBOX,
    LEGAL_CONSENT_REQUIRED_MESSAGE,
    record_legal_consent,
)
from backend.auth.email_delivery_service import (
    create_email_delivery,
    deliver_email_once,
)
from backend.shared.async_io import (
    BlockingIOBusyError,
    BlockingIOTimeoutError,
    run_blocking_io,
)
from backend.shared.database_io import run_database_write
from backend.documents.word_defaults import ensure_personal_word_workspace
from backend.shared.email_templates import render_branded_email
from backend.auth.password_reset_service import create_password_setup_token

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")

# ADR 0097: a Google identity without an account is only held, encrypted, in
# a short-lived cookie until the user picks a username and ticks consent.
GOOGLE_PENDING_COOKIE = "bf_google_pending"
GOOGLE_PENDING_COOKIE_PATH = "/api/auth/google-register"
GOOGLE_PENDING_TTL_SECONDS = 15 * 60
GOOGLE_REGISTRATION_EXPIRED_MESSAGE = (
    "Phiên tạo tài khoản bằng Google đã hết hạn. Vui lòng bấm lại nút Google."
)


def _pending_registration_cipher():
    key = str(os.environ.get("EMAIL_OUTBOX_ENCRYPTION_KEY", "")).strip()
    if not key:
        raise RuntimeError("EMAIL_OUTBOX_ENCRYPTION_KEY is required for Google registration.")
    # Derive a purpose-bound key so this cookie never decrypts outbox rows.
    derived = hmac.new(
        key.encode("ascii"), b"bf-google-pending-registration-v1", hashlib.sha256
    ).digest()
    return Fernet(base64.urlsafe_b64encode(derived))


def seal_pending_registration(identity):
    payload = json.dumps(identity, ensure_ascii=False, separators=(",", ":"))
    return _pending_registration_cipher().encrypt(payload.encode("utf-8")).decode("ascii")


def open_pending_registration(token):
    if not token:
        return None
    try:
        raw = _pending_registration_cipher().decrypt(
            token.encode("ascii"), ttl=GOOGLE_PENDING_TTL_SECONDS
        )
        identity = json.loads(raw)
    except (InvalidToken, UnicodeError, ValueError):
        return None
    if not isinstance(identity, dict) or not all(
        isinstance(identity.get(key), str) for key in ("google_id", "email", "name", "picture")
    ):
        return None
    return identity


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


from backend.auth.username_validator import generate_suggested_username, validate_username
from backend.shared.safe_http import open_allowlisted_https


_GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
_GOOGLE_JWKS_TTL_SECONDS = 3600
_google_jwks_cache = {"keys": None, "expires_at": 0.0}
_google_jwks_lock = __import__("threading").Lock()


def _b64url_decode(value: str) -> bytes:
    import base64

    padded = value + "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(padded.encode("ascii"))


def _google_signing_keys(*, refresh=False):
    now = time.time()
    with _google_jwks_lock:
        cached = _google_jwks_cache["keys"]
        if cached is not None and not refresh and now < _google_jwks_cache["expires_at"]:
            return cached
        req = urllib.request.Request(_GOOGLE_JWKS_URL, headers={"Accept": "application/json"})
        with open_allowlisted_https(
            req,
            allowed_hosts={"www.googleapis.com"},
            timeout=5,
        ) as resp:
            document = json.loads(resp.read().decode("utf-8"))
        keys = {
            str(item.get("kid")): item
            for item in document.get("keys", [])
            if item.get("kty") == "RSA" and item.get("kid")
        }
        _google_jwks_cache.update(keys=keys, expires_at=now + _GOOGLE_JWKS_TTL_SECONDS)
        return keys


def _verify_google_token_locally(id_token: str):
    """Verify an RS256 Google ID token with cached JWKS (no per-login HTTP call).

    Returns the claims, or raises on any doubt so the caller can fall back to
    Google's tokeninfo endpoint.
    """
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding, rsa

    header_b64, payload_b64, signature_b64 = id_token.split(".")
    header = json.loads(_b64url_decode(header_b64))
    if header.get("alg") != "RS256" or not header.get("kid"):
        raise ValueError("unsupported Google token header")
    keys = _google_signing_keys()
    jwk = keys.get(str(header["kid"]))
    if jwk is None:
        jwk = _google_signing_keys(refresh=True).get(str(header["kid"]))
    if jwk is None:
        raise ValueError("unknown Google signing key")
    public_key = rsa.RSAPublicNumbers(
        int.from_bytes(_b64url_decode(jwk["e"]), "big"),
        int.from_bytes(_b64url_decode(jwk["n"]), "big"),
    ).public_key()
    public_key.verify(
        _b64url_decode(signature_b64),
        f"{header_b64}.{payload_b64}".encode("ascii"),
        padding.PKCS1v15(),
        hashes.SHA256(),
    )
    payload = json.loads(_b64url_decode(payload_b64))
    if payload.get("aud") != GOOGLE_CLIENT_ID or payload.get("iss") not in GOOGLE_ISSUERS:
        return None
    if int(payload.get("exp", 0)) < int(time.time()):
        return None
    return payload


def _verify_google_token(id_token: str):

    if not id_token or not GOOGLE_CLIENT_ID:
        return None
    try:
        return _verify_google_token_locally(id_token)
    except Exception as local_error:  # noqa: BLE001 - any doubt falls back to Google's own check
        log_error(local_error, "google_token_local_verification", level="DEBUG")
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


def _password_setup_email(display_name, email, setup_link):
    subject = "[BiddingFlow] Đặt mật khẩu cho tài khoản"
    body = render_branded_email(
        title="Tài khoản BiddingFlow đã được tạo",
        preheader="Liên kết đặt mật khẩu một lần cho tài khoản Google của bạn.",
        eyebrow="TÀI KHOẢN MỚI",
        recipient_name=display_name or "bạn",
        lead="Bạn vừa tạo tài khoản BiddingFlow bằng Google.",
        details=(("Email đăng ký", email),),
        paragraphs=(
            "Nếu muốn đăng nhập bằng tên đăng nhập và mật khẩu, hãy dùng liên kết dưới đây để tự đặt mật khẩu.",
        ),
        action_label="Đặt mật khẩu",
        action_url=setup_link,
        notice="Liên kết chỉ dùng được một lần và hết hạn sau 2 giờ. Bạn vẫn có thể đăng nhập bằng Google nếu liên kết hết hạn.",
        notice_tone="warning",
    )
    return subject, body


def _google_link_notice_email(display_name, email, reset_link):
    subject = "[BiddingFlow] Tài khoản đã được liên kết với Google"
    body = render_branded_email(
        title="Tài khoản đã được liên kết với Google",
        preheader="Cảnh báo bảo mật: tài khoản BiddingFlow của bạn vừa được liên kết Google.",
        eyebrow="CẢNH BÁO BẢO MẬT",
        recipient_name=display_name or "bạn",
        lead="Bạn vừa đăng nhập BiddingFlow bằng Google và tài khoản đã được liên kết.",
        details=(("Email", email),),
        paragraphs=(
            "Tài khoản này cũng có mật khẩu đăng nhập. Nếu bạn không tự đặt mật khẩu đó, "
            "hãy dùng chức năng \"Quên mật khẩu\" trên trang đăng nhập để đặt mật khẩu mới ngay.",
        ),
        action_label="Mở trang đăng nhập",
        action_url=reset_link,
        notice="Nếu chính bạn đã đặt mật khẩu, bạn có thể bỏ qua email này.",
        notice_tone="danger",
    )
    return subject, body


def _complete_google_login(
    request, *, google_id, email, name, picture, ip, rate_key, new_username=None,
):
    """Account resolution, session issue and audit for Google login.

    Runs on the database write lane. Returns a rejection ``JSONResponse``, a
    ``{"pending_registration": ...}`` dict when the identity has no account
    yet, or a dict with the committed login outcome. ``new_username`` is set
    only by the consented registration step and creates the account.
    """
    created_new_account = False
    password_setup_delivery_id = None
    link_notice_delivery_id = None
    conn = database.get_connection()
    try:
        cursor = conn.cursor()
        conn.execute("BEGIN")


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
                log_audit(
                    "auth.google_account_linked",
                    actor_user_id=user["id"],
                    target_type="tai_khoan",
                    target_id=user["id"],
                    request=request,
                    metadata={"email": email, "had_username": already_has_username},
                    cursor=cursor,
                    required=True,
                )

        else:
            account_linked = False


        if user and new_username is not None:
            # The identity gained an account after the pending step began.
            conn.rollback()
            return JSONResponse(
                {
                    "error": "Email Google này đã có tài khoản. Vui lòng bấm lại nút Google để đăng nhập.",
                    "code": "GOOGLE_ACCOUNT_EXISTS",
                },
                status_code=409,
            )

        if not user and new_username is None:
            # ADR 0097: nothing is created until the user chooses a username
            # and explicitly accepts the legal documents.
            suggested_username = generate_suggested_username(name, email, cursor)
            conn.rollback()
            return {
                "pending_registration": {
                    "google_id": google_id,
                    "email": email,
                    "name": name,
                    "picture": picture,
                },
                "suggested_username": suggested_username,
            }

        if not user:
            cursor.execute(
                "SELECT 1 FROM tai_khoan WHERE username_norm = ?",
                (new_username,),
            )
            if cursor.fetchone():
                conn.rollback()
                return JSONResponse(
                    {"error": "Tên đăng nhập này đã được sử dụng. Vui lòng chọn tên khác."},
                    status_code=409,
                )
            new_id = generate_record_id("tai_khoan")
            cursor.execute(
                """INSERT INTO tai_khoan
                   (id, ten_dang_nhap, username_norm, mat_khau, ho_ten, vai_tro,
                    email, email_norm, anh_dai_dien, da_xac_minh,
                    registration_verified_at, username_da_dat)
                   VALUES (?, ?, ?, ?, ?, 'user', ?, ?, ?, 1, ?, 1)""",
                (new_id, new_username, new_username, "!google-external-only!", name,
                 email, email, picture, int(time.time())),
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
            log_audit(
                "auth.google_auto_register",
                actor_user_id=new_id,
                target_type="tai_khoan",
                target_id=new_id,
                request=request,
                metadata={"email": email, "username": new_username},
                cursor=cursor,
                required=True,
            )
            record_legal_consent(
                cursor,
                user_id=new_id,
                method=CONSENT_METHOD_GOOGLE_REGISTRATION_CHECKBOX,
                request=request,
            )


        existing_password_linked = bool(
            account_linked
            and user.get("da_xac_minh")
            and str(user.get("mat_khau") or "") not in {"", "!google-external-only!"}
        )
        promoted_unverified_account = not user.get("da_xac_minh")
        if promoted_unverified_account:
            # The Google owner has proved the email; a password chosen before
            # that proof must not become a credential for the verified account.
            cursor.execute(
                """UPDATE tai_khoan
                      SET da_xac_minh = 1,
                          mat_khau = ?,
                          registration_verified_at = COALESCE(registration_verified_at, ?)
                    WHERE id = ?""",
                ("!google-external-only!", int(time.time()), user["id"]),
            )
            user["da_xac_minh"] = 1
            user["mat_khau"] = "!google-external-only!"

        if created_new_account or promoted_unverified_account:
            setup_email = (
                user["email"]
                if normalize_email(user.get("email")) == email
                else email
            )
            setup_token = create_password_setup_token(
                cursor,
                user["id"],
                requested_ip=ip,
            )
            public_url = os.environ.get(
                "APP_PUBLIC_URL", "http://127.0.0.1:8000"
            ).rstrip("/")
            setup_link = (
                f"{public_url}/reset-password#token="
                f"{urllib.parse.quote(setup_token['token'], safe='')}"
            )
            email_subject, email_body = _password_setup_email(
                user.get("ho_ten"),
                setup_email,
                setup_link,
            )
            password_setup_delivery_id = create_email_delivery(
                cursor,
                user_id=user["id"],
                purpose="google_password_setup",
                recipient=setup_email,
                subject=email_subject,
                html_body=email_body,
            )
        elif existing_password_linked:
            # The Google owner has now proved the email, but someone else may
            # have set this account's password. Tell the owner; the existing
            # password and any pending recovery link stay untouched.
            public_url = os.environ.get(
                "APP_PUBLIC_URL", "http://127.0.0.1:8000"
            ).rstrip("/")
            email_subject, email_body = _google_link_notice_email(
                user.get("ho_ten"),
                email,
                f"{public_url}/dang-nhap",
            )
            link_notice_delivery_id = create_email_delivery(
                cursor,
                user_id=user["id"],
                # Only the schema-approved purposes are allowed (CHECK).
                purpose="user_notification",
                recipient=email,
                subject=email_subject,
                html_body=email_body,
            )

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
        log_audit(
            "auth.google_login_success",
            actor_user_id=user["id"],
            organization_id=access_payload["active_org_id"],
            target_type="tai_khoan",
            target_id=user["id"],
            request=request,
            metadata={"email": email},
            cursor=cursor,
            required=True,
        )
        conn.commit()
        needs_username = not user.get("ten_dang_nhap")


        suggested_username = ""
        if needs_username:
            suggested_username = generate_suggested_username(user.get("ho_ten", ""), email, cursor)
        return {
            "user": user,
            "account_linked": account_linked,
            "created_new_account": created_new_account,
            "password_setup_delivery_id": password_setup_delivery_id,
            "link_notice_delivery_id": link_notice_delivery_id,
            "access_payload": access_payload,
            "session_token": session_token,
            "needs_username": needs_username,
            "suggested_username": suggested_username,
        }
    except BaseException:
        if conn.in_transaction:
            conn.rollback()
        raise
    finally:
        conn.close()


async def _log_audit_off_event_loop(*args, **kwargs):
    """Best-effort standalone audit write without blocking the event loop."""
    try:
        return await run_database_write(log_audit, *args, **kwargs)
    except BlockingIOBusyError:
        return log_audit(*args, **kwargs)


def _google_login_success_response(request, login):
    """Session cookie, queued emails and payload for a committed Google login."""
    bg_tasks = None
    user = login["user"]
    password_setup_delivery_id = login["password_setup_delivery_id"]
    access_payload = login["access_payload"]
    disconnect_user_websockets(user["id"])

    # The durable outbox worker already retries pending deliveries. Run the
    # first attempt after the response as well, so Google login is never held
    # open by the SMTP timeout.
    password_setup_queued = bool(password_setup_delivery_id)
    for delivery_id in (password_setup_delivery_id, login.get("link_notice_delivery_id")):
        if not delivery_id:
            continue
        if bg_tasks is None:
            bg_tasks = BackgroundTasks()
        bg_tasks.add_task(deliver_email_once, database, delivery_id)

    response = JSONResponse({
        "success": True,
        "id": user["id"],
        "username": user["ten_dang_nhap"],
        "name": user["ho_ten"],
        **access_payload,
        "email": user["email"],
        "avatar": user.get("anh_dai_dien") or "",
        "inactivity_timeout_hours": SESSION_INACTIVITY_TIMEOUT_HOURS,
        "needs_username": login["needs_username"],
        "suggested_username": login["suggested_username"],
        "account_linked": login["account_linked"],
        "is_new_account": login["created_new_account"],
        "temporary_password_sent": False,
        "temporary_password_queued": False,
        "password_setup_queued": password_setup_queued,
    }, background=bg_tasks)
    cookie_max_age = SESSION_EXPIRY_HOURS * 3600
    response.set_cookie(
        "session_token", login["session_token"],
        httponly=True, secure=session_cookie_secure(request), samesite="lax", path="/", max_age=cookie_max_age,
    )
    response.delete_cookie("username", path="/")
    return response


def _google_write_failure_response(exc, context):
    if isinstance(exc, BlockingIOBusyError):
        response = JSONResponse(
            {
                "error": "Hệ thống đang xử lý nhiều thay đổi. Vui lòng thử lại sau.",
                "code": "DATABASE_WRITE_QUEUE_FULL",
            },
            status_code=503,
        )
        response.headers["Retry-After"] = "1"
        return response
    if isinstance(exc, IntegrityError):
        conflict_code = identity_conflict_code(exc)
        if conflict_code:
            return JSONResponse(conflict_payload(conflict_code), status_code=409)
        log_error(exc, f"{context}_integrity")
        return JSONResponse(
            {"error": "Không thể liên kết tài khoản do xung đột dữ liệu."},
            status_code=409,
        )
    log_error(exc, context)
    return JSONResponse(
        {"error": "Đã xảy ra lỗi khi đăng nhập bằng Google. Vui lòng thử lại sau."},
        status_code=500,
    )


async def google_login_api(request):

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
            await _log_audit_off_event_loop("auth.google_login_failed", request=request, metadata={"reason": "invalid_token"})
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

        login = await run_database_write(
            _complete_google_login,
            request,
            google_id=google_id,
            email=email,
            name=name,
            picture=picture,
            ip=ip,
            rate_key=rate_key,
        )
        if isinstance(login, JSONResponse):
            return login
        if "pending_registration" in login:
            identity = login["pending_registration"]
            response = JSONResponse({
                "success": True,
                "pending_registration": True,
                "needs_username": True,
                "suggested_username": login["suggested_username"],
                "name": identity["name"],
                "email": identity["email"],
                "avatar": identity["picture"],
            })
            response.set_cookie(
                GOOGLE_PENDING_COOKIE,
                seal_pending_registration(identity),
                httponly=True,
                secure=session_cookie_secure(request),
                samesite="strict",
                path=GOOGLE_PENDING_COOKIE_PATH,
                max_age=GOOGLE_PENDING_TTL_SECONDS,
            )
            return response
        return _google_login_success_response(request, login)

    except Exception as e:
        return _google_write_failure_response(e, "google_login_api")


async def google_register_api(request):
    """Create the account held by the pending Google step (ADR 0097)."""

    try:
        ip = get_client_ip(request)
        rate_key = f"google_register:{ip}"
        register_limit = await _rate_limit_decision(
            rate_key, consume_attempt=True
        )
        if not register_limit.allowed:
            return rate_limit_response("Quá nhiều yêu cầu đăng ký. Vui lòng thử lại sau.", register_limit)

        data, json_error = await read_json_object(request)
        if json_error:
            return json_error
        invalid = validate_or_response(request, data, {
            "username": {"type": "string", "required": True, "min_length": 1, "max_length": 64},
            "acceptLegal": {"type": "boolean", "required": True},
        })
        if invalid:
            return invalid
        if data.get("acceptLegal") is not True:
            return JSONResponse(
                {"error": LEGAL_CONSENT_REQUIRED_MESSAGE, "code": "LEGAL_CONSENT_REQUIRED"},
                status_code=400,
            )

        identity = open_pending_registration(request.cookies.get(GOOGLE_PENDING_COOKIE))
        if identity is None:
            response = JSONResponse(
                {"error": GOOGLE_REGISTRATION_EXPIRED_MESSAGE, "code": "GOOGLE_REGISTRATION_EXPIRED"},
                status_code=400,
            )
            response.delete_cookie(GOOGLE_PENDING_COOKIE, path=GOOGLE_PENDING_COOKIE_PATH)
            return response

        new_username = normalize_username(data.get("username"))
        valid, reason = validate_username(new_username)
        if not valid:
            return JSONResponse({"error": reason}, status_code=400)

        login = await run_database_write(
            _complete_google_login,
            request,
            google_id=identity["google_id"],
            email=identity["email"],
            name=identity["name"],
            picture=identity["picture"],
            ip=ip,
            rate_key=rate_key,
            new_username=new_username,
        )
        if isinstance(login, JSONResponse):
            if login.status_code == 409 and b"GOOGLE_ACCOUNT_EXISTS" in login.body:
                login.delete_cookie(GOOGLE_PENDING_COOKIE, path=GOOGLE_PENDING_COOKIE_PATH)
            return login
        response = _google_login_success_response(request, login)
        response.delete_cookie(GOOGLE_PENDING_COOKIE, path=GOOGLE_PENDING_COOKIE_PATH)
        return response

    except Exception as e:
        return _google_write_failure_response(e, "google_register_api")
