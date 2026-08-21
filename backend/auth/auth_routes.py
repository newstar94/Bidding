from backend.db.db_helper import DatabaseError, IntegrityError
import os
import json
import uuid
import time
import hashlib
import urllib.parse
from datetime import datetime, timezone

from starlette.responses import JSONResponse
from starlette.background import BackgroundTasks

from backend.shared.helpers import (
    database,
    verify_session,
    verify_password,
    hash_password,
    password_needs_rehash,
    get_effective_roles,
    log_error,
    log_audit,
    get_active_org,
    OrgPermissionError,
    gui_email,
)
from backend.auth.auth_helper import (
    PRIVILEGED_REAUTH_TTL_SECONDS,
    SESSION_ACTIVITY_TOUCH_SECONDS,
    verify_super_admin_controls,
    verify_recent_reauthentication,
)
from backend.auth.roles import resolve_workspace_active_role
from backend.auth.session_store import (
    create_session,
    load_session_user,
    replace_user_session,
    revoke_session,
    revoke_user_sessions,
    session_invalid_reason,
    set_session_reauthentication,
    set_session_active_role,
    touch_session,
)
from backend.auth.profile_validation import ProfileValidationError, validate_profile_fields
from backend.auth.identity import (
    conflict_payload,
    identity_conflict_code,
    normalize_username,
)
from backend.auth.password_policy import validate_new_password, validate_password_input
from backend.auth.security_notifications import build_security_notification_tasks
from backend.shared.numeric_utils import money_json_value, parse_vnd_amount
from backend.sync.api import disconnect_user_websockets
from backend.sync.websocket import enqueue_websocket_event
from backend.shared.logging_utils import error_response
from backend.shared.request_validation import read_json_object, validate_or_response
from backend.shared.access_policy import (
    is_business_organization,
    organization_membership_role,
)
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError
from backend.shared.cpu_io import run_cpu_bound
from backend.shared.database_io import run_database_read, run_database_write
from backend.shared.logging_utils import log_structured_event
from backend.shared.membership_invariants import (
    lock_organization_membership_invariants,
)
from backend.shared.platform_role_invariants import lock_platform_role_invariants
from backend.security.turnstile import edge_challenge_required, enforce_turnstile
from backend.runtime_capabilities import with_server_capabilities
from backend.shared.email_templates import render_branded_email


from backend.auth.auth_service import (
    get_client_ip,
    get_rate_limit_decision,
    RateLimitDecision,
    rate_limit_response,
    clear_rate_limit_buckets,
    build_user_access_payload,
    session_cookie_secure,
    SESSION_EXPIRY_HOURS,
    SESSION_REMEMBER_EXPIRY_HOURS,
    SESSION_INACTIVITY_TIMEOUT_HOURS,
    generate_otp,
    RATE_LIMIT_MAX,
)


EMAIL_CHANGE_OTP_TTL_SECONDS = max(
    300, int(os.environ.get("EMAIL_CHANGE_OTP_TTL_SECONDS", "600"))
)
EMAIL_CHANGE_REQUEST_MAX = max(
    1, int(os.environ.get("EMAIL_CHANGE_REQUEST_MAX", "3"))
)
EMAIL_CHANGE_REQUEST_WINDOW_SECONDS = max(
    60, int(os.environ.get("EMAIL_CHANGE_REQUEST_WINDOW_SECONDS", "900"))
)
EMAIL_CHANGE_VERIFY_MAX = max(
    1, int(os.environ.get("EMAIL_CHANGE_VERIFY_MAX", "5"))
)
EMAIL_CHANGE_VERIFY_WINDOW_SECONDS = max(
    60, int(os.environ.get("EMAIL_CHANGE_VERIFY_WINDOW_SECONDS", "600"))
)
TURNSTILE_LOGIN_AFTER_ATTEMPTS = max(
    1,
    int(os.environ.get("TURNSTILE_LOGIN_AFTER_ATTEMPTS", "3")),
)


def _login_challenge_required(*decisions):
    """Require a challenge only after the configured number of prior attempts."""

    for decision in decisions:
        if decision is None:
            continue
        remaining = max(0, int(getattr(decision, "remaining", RATE_LIMIT_MAX)))
        attempts_including_current = max(0, RATE_LIMIT_MAX - remaining)
        if max(0, attempts_including_current - 1) >= TURNSTILE_LOGIN_AFTER_ATTEMPTS:
            return True
    return False


def _password_cpu_unavailable_response(request):
    response = error_response(
        request,
        "PASSWORD_CPU_QUEUE_BUSY",
        "Hệ thống đang xử lý nhiều yêu cầu xác thực. Vui lòng thử lại sau.",
        status_code=503,
    )
    response.headers["Retry-After"] = "1"
    return response


def _verify_and_maybe_rehash(stored_password, provided_password):
    verified = verify_password(stored_password, provided_password)
    replacement = None
    if verified and password_needs_rehash(stored_password):
        replacement = hash_password(provided_password)
    return verified, replacement


def _prepare_email_change_credentials(stored_password, password, otp_code):
    if not verify_password(stored_password, password):
        return False, None, None
    otp_hash = hash_password(otp_code)
    replacement = hash_password(password) if password_needs_rehash(stored_password) else None
    return True, otp_hash, replacement


def _database_lane_unavailable_response(request, *, write: bool):
    response = error_response(
        request,
        "DATABASE_WRITE_QUEUE_FULL" if write else "DATABASE_READ_QUEUE_FULL",
        "Hệ thống đang xử lý nhiều yêu cầu dữ liệu. Vui lòng thử lại sau.",
        status_code=503,
    )
    response.headers["Retry-After"] = "1"
    return response


async def _get_rate_limit_decision_off_event_loop(*args, **kwargs):
    try:
        return await run_database_write(get_rate_limit_decision, *args, **kwargs)
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return RateLimitDecision(
            False,
            int(kwargs.get("window_seconds", 60)),
            0,
            storage_failed=True,
        )


def _load_login_user(username):
    conn = database.get_connection()
    try:
        row = conn.execute(
            """SELECT id, ten_dang_nhap, mat_khau, ho_ten, vai_tro, email,
                      anh_dai_dien, da_xac_minh
               FROM tai_khoan
               WHERE trang_thai = 'active'
                 AND (username_norm = ? OR email_norm = ?)""",
            (username, username),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def _record_failed_login(ip_rate_key, user_rate_key, request):
    del request
    log_structured_event(
        "auth.login_failed",
        level="WARN",
        fields={
            "reason": "invalid_credentials",
            "ipBucket": hashlib.sha256(
                str(ip_rate_key).encode("utf-8")
            ).hexdigest()[:16],
            "accountBucket": hashlib.sha256(
                str(user_rate_key or "").encode("utf-8")
            ).hexdigest()[:16],
        },
        nonblocking=True,
    )


def _commit_successful_login(
    user,
    replacement_password_hash,
    session_token,
    token_expiry,
    remember,
    device_info,
    active_org_hint,
    request,
    ip_rate_key,
    user_rate_key,
):
    conn = database.get_connection()
    try:
        conn.execute("BEGIN")
        cursor = conn.cursor()
        if replacement_password_hash:
            cursor.execute(
                "UPDATE tai_khoan SET mat_khau = ? WHERE id = ?",
                (replacement_password_hash, user["id"]),
            )
        replace_user_session(
            cursor,
            user_id=user["id"],
            token=session_token,
            absolute_expires_at=token_expiry,
            idle_timeout_seconds=SESSION_INACTIVITY_TIMEOUT_HOURS * 3600,
            remember=remember,
            device_info=device_info,
        )
        access_payload = build_user_access_payload(
            cursor,
            user["id"],
            user["vai_tro"],
            active_org_hint,
            user.get("ho_ten"),
        )
        access_payload = _attach_effective_session_role(user, access_payload)
        log_audit(
            "auth.login_success",
            actor_user_id=user["id"],
            organization_id=access_payload["active_org_id"],
            target_type="tai_khoan",
            target_id=user["id"],
            request=request,
            metadata={"remember": remember},
            cursor=cursor,
            required=True,
        )
        clear_rate_limit_buckets(cursor, ip_rate_key, user_rate_key)
        conn.commit()
        return access_payload
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _verify_and_hash_replacement(stored_password, old_password, new_password):
    if not verify_password(stored_password, old_password):
        return False, None
    return True, hash_password(new_password)


def _email_change_request_tasks(*, old_email, new_email, display_name, code):
    tasks = BackgroundTasks()
    tasks.add_task(
        gui_email,
        new_email,
        "[BiddingFlow] Xác minh địa chỉ email mới",
        render_branded_email(
            title="Xác minh địa chỉ email mới",
            preheader="Mã OTP xác minh email mới cho tài khoản BiddingFlow.",
            eyebrow="BẢO MẬT TÀI KHOẢN",
            recipient_name=display_name or "bạn",
            lead="Bạn đang hoàn tất thay đổi địa chỉ email đăng nhập.",
            code=code,
            code_label="Mã OTP xác minh email",
            notice=(
                f"Mã có hiệu lực trong {EMAIL_CHANGE_OTP_TTL_SECONDS // 60} phút. "
                "Không chia sẻ mã này với bất kỳ ai."
            ),
            notice_tone="warning",
        ),
        True,
    )
    tasks.add_task(
        gui_email,
        old_email,
        "[BiddingFlow] Cảnh báo yêu cầu thay đổi email",
        render_branded_email(
            title="Yêu cầu thay đổi email tài khoản",
            preheader="Cảnh báo bảo mật về yêu cầu thay đổi email BiddingFlow.",
            eyebrow="CẢNH BÁO BẢO MẬT",
            lead="Chúng tôi vừa nhận được yêu cầu thay đổi email đăng nhập.",
            details=(("Email mới", new_email),),
            paragraphs=(
                "Email hiện tại vẫn được giữ nguyên cho đến khi địa chỉ mới được xác minh.",
            ),
            notice="Nếu không phải bạn thực hiện, hãy đổi mật khẩu và liên hệ quản trị viên ngay.",
            notice_tone="danger",
        ),
    )
    return tasks


def _email_change_completed_tasks(*, old_email, new_email):
    tasks = BackgroundTasks()
    tasks.add_task(
        gui_email,
        old_email,
        "[BiddingFlow] Email tài khoản đã được thay đổi",
        render_branded_email(
            title="Email tài khoản đã được thay đổi",
            preheader="Thông báo bảo mật về thay đổi email tài khoản BiddingFlow.",
            eyebrow="THAY ĐỔI THÔNG TIN ĐĂNG NHẬP",
            lead="Địa chỉ email đăng nhập vừa được thay đổi sau khi xác minh OTP.",
            paragraphs=("Tất cả phiên đăng nhập cũ đã được thu hồi để bảo vệ tài khoản.",),
            notice="Nếu không phải bạn thực hiện, hãy liên hệ quản trị viên ngay.",
            notice_tone="danger",
        ),
    )
    tasks.add_task(
        gui_email,
        new_email,
        "[BiddingFlow] Xác minh email mới thành công",
        render_branded_email(
            title="Xác minh email thành công",
            preheader="Email mới đã trở thành địa chỉ đăng nhập BiddingFlow.",
            eyebrow="CẬP NHẬT THÀNH CÔNG",
            lead="Email này hiện là địa chỉ đăng nhập của tài khoản BiddingFlow.",
            paragraphs=("Vui lòng đăng nhập lại vì các phiên cũ đã được thu hồi.",),
            notice="Thông tin đăng nhập đã được cập nhật an toàn.",
            notice_tone="success",
        ),
    )
    return tasks


def _active_org_hint(request):
    value = (request.headers.get('X-Active-Org') or '').strip()
    return urllib.parse.unquote(value) if value else None

async def login_api(request):
    try:
        ip = get_client_ip(request)
        ip_rate_key = f"login:{ip}"
        try:
            ip_limit = await run_database_write(
                get_rate_limit_decision, ip_rate_key, consume_attempt=True
            )
        except (BlockingIOBusyError, BlockingIOTimeoutError):
            return _database_lane_unavailable_response(request, write=True)
        if not ip_limit.allowed:
            return rate_limit_response("Quá nhiều lần đăng nhập thất bại. Vui lòng thử lại sau.", ip_limit)

        data, json_error = await read_json_object(request)
        if json_error:
            return json_error
        invalid = validate_or_response(request, data, {
            "username": {"type": "string", "required": True, "min_length": 1, "max_length": 320},
            "password": {"type": "string", "required": True, "min_length": 1, "max_length": 256},
            "remember": {"type": "boolean"},
            "turnstileToken": {"type": "string", "max_length": 2048},
        })
        if invalid:
            return invalid
        username = normalize_username(data.get('username'))
        password = data.get('password')
        remember = data.get('remember', False)

        username_rate_key = hashlib.sha256(username.lower().encode('utf-8')).hexdigest()
        user_rate_key = f"login_user:{username_rate_key}" if username else None
        try:
            user_limit = (
                await run_database_write(
                    get_rate_limit_decision, user_rate_key, consume_attempt=True
                )
                if user_rate_key
                else None
            )
        except (BlockingIOBusyError, BlockingIOTimeoutError):
            return _database_lane_unavailable_response(request, write=True)
        if user_limit and not user_limit.allowed:
            return rate_limit_response("Quá nhiều lần đăng nhập cho tài khoản này. Vui lòng thử lại sau.", user_limit)

        challenge_error = await enforce_turnstile(
            request,
            data,
            expected_action="login",
            required=(
                _login_challenge_required(ip_limit, user_limit)
                or edge_challenge_required(request)
            ),
        )
        if challenge_error:
            return challenge_error

        async def record_failed_login():
            _record_failed_login(ip_rate_key, user_rate_key, request)

        if not username or not validate_password_input(password):
            await record_failed_login()
            return JSONResponse({"error": "Vui lòng nhập tài khoản và mật khẩu!"}, status_code=400)

        try:
            user = await run_database_read(
                _load_login_user, username, timeout_seconds=5.0
            )
        except (BlockingIOBusyError, BlockingIOTimeoutError):
            return _database_lane_unavailable_response(request, write=False)

        if not user:
            await record_failed_login()
            return JSONResponse({"error": "Tên đăng nhập hoặc mật khẩu không đúng"}, status_code=400)

        try:
            password_verified, replacement_password_hash = await run_cpu_bound(
                _verify_and_maybe_rehash,
                user['mat_khau'],
                password,
                timeout_seconds=15,
            )
        except (BlockingIOBusyError, BlockingIOTimeoutError):
            return _password_cpu_unavailable_response(request)

        if not password_verified:
            await record_failed_login()
            return JSONResponse({"error": "Tên đăng nhập hoặc mật khẩu không đúng"}, status_code=400)

        if not user.get('da_xac_minh'):
            return JSONResponse({
                "error": "Tài khoản của bạn chưa được xác thực email. Vui lòng xác thực trước khi đăng nhập!",
                "unverified": True,
                "username": user['ten_dang_nhap']
            }, status_code=400)

        session_token = str(uuid.uuid4())
        expiry_hours = SESSION_REMEMBER_EXPIRY_HOURS if remember else SESSION_EXPIRY_HOURS
        token_expiry = int(time.time() + expiry_hours * 3600)
        user_agent = request.headers.get("User-Agent", "")[:200]
        device_info = json.dumps({
            "user_agent": user_agent,
            "ip": ip,
            "login_time": datetime.now(timezone.utc).isoformat()
        })
        try:
            access_payload = await run_database_write(
                _commit_successful_login,
                user,
                replacement_password_hash,
                session_token,
                token_expiry,
                remember,
                device_info,
                _active_org_hint(request),
                request,
                ip_rate_key,
                user_rate_key,
            )
        except (BlockingIOBusyError, BlockingIOTimeoutError):
            return _database_lane_unavailable_response(request, write=True)
        disconnect_user_websockets(user["id"])
        response = JSONResponse({
            "success": True,
            "id": user['id'],
            "username": user['ten_dang_nhap'],
            "name": user['ho_ten'],
            **access_payload,
            "active_role": access_payload.get('active_role'),
            "email": user['email'],
            "avatar": user.get('anh_dai_dien'),
            "inactivity_timeout_hours": SESSION_INACTIVITY_TIMEOUT_HOURS,
        })



        cookie_max_age = (SESSION_REMEMBER_EXPIRY_HOURS if remember else SESSION_EXPIRY_HOURS) * 3600
        response.set_cookie("session_token", session_token, httponly=True, secure=session_cookie_secure(request), samesite="lax", path="/", max_age=cookie_max_age)
        response.delete_cookie("username", path="/")
        return response
    except Exception as e:
        log_error(e, "login_api")
        return JSONResponse({"error": "Đã xảy ra lỗi khi đăng nhập. Vui lòng thử lại sau."}, status_code=500)

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
        return _attach_effective_session_role(user, access)
    finally:
        conn.close()


def _attach_effective_session_role(user, access_payload):
    access = dict(access_payload or {})
    active_organization_id = str(access.get("active_org_id") or "").strip()
    selected_workspace = next(
        (
            workspace
            for workspace in access.get("organizations", [])
            if str(workspace.get("id") or "").strip() == active_organization_id
        ),
        {},
    )
    access["active_role"] = resolve_workspace_active_role(
        platform_role=user.get("vai_tro"),
        membership_role=access.get("membership_role"),
        scope_type=selected_workspace.get("scope_type", "organization"),
        organization_id=active_organization_id,
        selected_role=user.get("active_role"),
        selected_organization_id=user.get("active_role_organization_id"),
    )
    return access


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
        return with_server_capabilities({"valid": False, "reason": "missing_auth"})

    user = _load_user_by_session_token(session_token)
    invalid_reason = _validate_token_expiry(session_token, user)
    if invalid_reason:
        return with_server_capabilities({"valid": False, "reason": invalid_reason})

    needs_username, suggested_username, account_linked = _get_username_setup_state(user)
    access_payload = _get_access_for_session(user, request)
    return with_server_capabilities({
        "valid": True,
        "device_info": user.get('device_info'),
        "user": {
            "id": user['id'],
            "username": user['ten_dang_nhap'],
            "name": user['ho_ten'],
            **access_payload,
            "active_role": access_payload.get('active_role'),
            "email": user['email'],
            "avatar": user.get('anh_dai_dien'),
            "inactivity_timeout_hours": SESSION_INACTIVITY_TIMEOUT_HOURS,
            "needs_username": needs_username,
            "suggested_username": suggested_username,
            "account_linked": account_linked
        }
    })


def _session_response(user, request):
    needs_username, suggested_username, account_linked = _get_username_setup_state(user)
    access_payload = _get_access_for_session(user, request)
    response = JSONResponse(with_server_capabilities({
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
    }))

    return response


def _check_session_sync(request, data, started_at):
    try:
        session_token = (request.cookies.get('session_token') or '').strip()

        if not session_token:
            return JSONResponse(with_server_capabilities({"valid": False, "reason": "missing_auth"}))

        user = _load_user_by_session_token(session_token)
        invalid_reason = _validate_token_expiry(session_token, user)
        if invalid_reason:
            return JSONResponse(with_server_capabilities({"valid": False, "reason": invalid_reason}))

        _extend_session_if_needed(user)
        response = _session_response(user, request)
        response.headers["Server-Timing"] = f"session-check;dur={(time.perf_counter() - started_at) * 1000:.1f}"
        return response
    except Exception as e:
        log_error(e, "check_session_api")
        return JSONResponse(
            with_server_capabilities({"valid": False, "error": "Lỗi kiểm tra phiên làm việc."}),
            status_code=500,
        )


async def check_session_api(request):
    started_at = time.perf_counter()
    try:
        data = await request.json()
    except Exception:
        data = {}
    invalid = validate_or_response(request, data, {
        "remember": {"type": "boolean"},
    })
    if invalid:
        return invalid
    try:
        return await run_database_read(
            _check_session_sync,
            request,
            data,
            started_at,
            timeout_seconds=10.0,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _database_lane_unavailable_response(request, write=False)


def _set_active_role_sync(request, active_role):
    is_valid, session = verify_session(request)
    if not is_valid:
        return JSONResponse({"error": session}, status_code=403)

    platform_role = str(getattr(session, "platform_role", session) or "").strip()
    if active_role == "super_admin" and platform_role != "super_admin":
        return JSONResponse(
            {"error": "Tài khoản không có quyền Super Admin."},
            status_code=403,
        )

    conn = database.get_connection()
    try:
        cursor = conn.cursor()
        organization_id = get_active_org(request, session.user_id, cursor=cursor)
        if active_role == "manager" and platform_role != "super_admin":
            membership_role = organization_membership_role(
                cursor, session.user_id, organization_id
            )
            if membership_role != "manager":
                return JSONResponse(
                    {"error": "Tài khoản không có quyền Quản lý trong tổ chức này."},
                    status_code=403,
                )

        if not set_session_active_role(
            cursor,
            session.session_id,
            session.user_id,
            active_role,
            organization_id,
        ):
            conn.rollback()
            return JSONResponse(
                {"error": "Phiên làm việc không còn hiệu lực."},
                status_code=403,
            )
        log_audit(
            "auth.active_role_changed",
            actor_user_id=session.user_id,
            organization_id=organization_id,
            target_type="auth_session",
            target_id=session.session_id,
            request=request,
            metadata={"active_role": active_role},
            cursor=cursor,
            required=True,
        )
        conn.commit()
        return JSONResponse({"success": True, "activeRole": active_role})
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


async def set_active_role_api(request):
    data, json_error = await read_json_object(request)
    if json_error:
        return json_error
    invalid = validate_or_response(request, data, {
        "active_role": {
            "type": "string",
            "required": True,
            "enum": {"super_admin", "manager", "employee"},
        },
    })
    if invalid:
        return invalid
    try:
        return await run_database_write(
            _set_active_role_sync,
            request,
            str(data["active_role"]).strip().lower(),
        )
    except BlockingIOBusyError:
        return _database_lane_unavailable_response(request, write=True)
    except Exception as exc:
        log_error(exc, "set_active_role_api")
        return JSONResponse(
            {"error": "Không thể chuyển chế độ làm việc."},
            status_code=500,
        )


async def update_profile_api(request):
    conn = None
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        data, json_error = await read_json_object(request)
        if json_error:
            return json_error
        if 'organization_name' in data:
            return JSONResponse({
                "error": "Tên tổ chức là trường chỉ đọc trong hồ sơ cá nhân.",
                "code": "ORGANIZATION_NAME_READ_ONLY",
            }, status_code=400)
        invalid = validate_or_response(request, data, {
            "name": {"type": "string", "required": True, "max_length": 200},
            "email": {"type": "string", "required": True, "max_length": 320},
            "avatar": {"type": "string", "max_length": 1_000_000},
            "password": {"type": "string", "min_length": 1, "max_length": 256},
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
        cursor = conn.cursor()
        cursor.execute(
            """SELECT id, ten_dang_nhap, mat_khau, ho_ten, email, email_norm,
                      COALESCE(anh_dai_dien, '') AS anh_dai_dien
               FROM tai_khoan WHERE id = ?""",
            (role_or_err.user_id,),
        )
        initial_user = cursor.fetchone()
        if not initial_user:
            return JSONResponse({"error": "Tài khoản không còn tồn tại."}, status_code=404)

        initial_user = dict(initial_user)
        email_change_requested = email != str(initial_user.get("email_norm") or "")
        password = data.get("password")
        email_change_code = None
        email_change_otp_hash = None
        replacement_password_hash = None
        request_ip = get_client_ip(request)

        if email_change_requested:
            session_identity = (
                request.cookies.get("session_token")
                or getattr(role_or_err, "session_id", "")
            )
            session_rate_hash = hashlib.sha256(
                str(session_identity).encode("utf-8")
            ).hexdigest()[:24]
            ip_limit = await _get_rate_limit_decision_off_event_loop(
                f"email_change_request:{request_ip}",
                max_attempts=EMAIL_CHANGE_REQUEST_MAX,
                window_seconds=EMAIL_CHANGE_REQUEST_WINDOW_SECONDS,
            )
            user_limit = await _get_rate_limit_decision_off_event_loop(
                f"email_change_request_user:{role_or_err.user_id}",
                max_attempts=EMAIL_CHANGE_REQUEST_MAX,
                window_seconds=EMAIL_CHANGE_REQUEST_WINDOW_SECONDS,
            )
            session_limit = await _get_rate_limit_decision_off_event_loop(
                f"email_change_request_session:{session_rate_hash}",
                max_attempts=EMAIL_CHANGE_REQUEST_MAX,
                window_seconds=EMAIL_CHANGE_REQUEST_WINDOW_SECONDS,
            )
            request_limits = (ip_limit, user_limit, session_limit)
            if any(not limit.allowed for limit in request_limits):
                log_audit(
                    "auth.email_change_rate_limited",
                    actor_user_id=role_or_err.user_id,
                    target_type="tai_khoan",
                    target_id=role_or_err.user_id,
                    request=request,
                    metadata={"stage": "request"},
                )
                return rate_limit_response(
                    "Quá nhiều yêu cầu thay đổi email. Vui lòng thử lại sau.",
                    next(limit for limit in request_limits if not limit.allowed),
                )
            if not validate_password_input(password):
                log_audit(
                    "auth.email_change_reauth_failed",
                    actor_user_id=role_or_err.user_id,
                    target_type="tai_khoan",
                    target_id=role_or_err.user_id,
                    request=request,
                    metadata={"reason": "missing_password"},
                )
                return JSONResponse(
                    {
                        "error": "Cần nhập mật khẩu hiện tại để thay đổi email.",
                        "code": "EMAIL_CHANGE_REAUTH_REQUIRED",
                    },
                    status_code=403,
                )
            email_change_code = generate_otp()
            try:
                (
                    password_verified,
                    email_change_otp_hash,
                    replacement_password_hash,
                ) = await run_cpu_bound(
                    _prepare_email_change_credentials,
                    initial_user.get("mat_khau"),
                    password,
                    email_change_code,
                    timeout_seconds=20,
                )
            except (BlockingIOBusyError, BlockingIOTimeoutError):
                return _password_cpu_unavailable_response(request)

            if not password_verified:
                log_audit(
                    "auth.email_change_reauth_failed",
                    actor_user_id=role_or_err.user_id,
                    target_type="tai_khoan",
                    target_id=role_or_err.user_id,
                    request=request,
                    metadata={"reason": "invalid_password"},
                )
                return JSONResponse(
                    {
                        "error": "Mật khẩu hiện tại không chính xác.",
                        "code": "EMAIL_CHANGE_REAUTH_FAILED",
                    },
                    status_code=403,
                )

        conn.execute("BEGIN")
        cursor.execute(
            """SELECT id, ten_dang_nhap, mat_khau, ho_ten, email, email_norm,
                      COALESCE(anh_dai_dien, '') AS anh_dai_dien
               FROM tai_khoan WHERE id = ?""",
            (role_or_err.user_id,),
        )
        locked_user = cursor.fetchone()
        if not locked_user:
            conn.rollback()
            return JSONResponse({"error": "Tài khoản không còn tồn tại."}, status_code=404)
        locked_user = dict(locked_user)
        email_change_requested = email != str(locked_user.get("email_norm") or "")
        if email_change_requested and (
            not email_change_otp_hash
            or locked_user.get("mat_khau") != initial_user.get("mat_khau")
        ):
            conn.rollback()
            return JSONResponse(
                {
                    "error": "Thông tin xác thực vừa thay đổi. Vui lòng nhập lại mật khẩu.",
                    "code": "EMAIL_CHANGE_REAUTH_REQUIRED",
                },
                status_code=409,
            )

        now = int(time.time())
        if email_change_requested:
            cursor.execute("DELETE FROM pending_email_changes WHERE expires_at <= ?", (now,))
            cursor.execute(
                "SELECT id FROM tai_khoan WHERE email_norm = ? AND id != ?",
                (email, role_or_err.user_id),
            )
            active_conflict = cursor.fetchone()
            cursor.execute(
                """SELECT user_id FROM pending_email_changes
                   WHERE pending_email_norm = ? AND user_id != ? AND expires_at > ?""",
                (email, role_or_err.user_id, now),
            )
            pending_conflict = cursor.fetchone()
            if active_conflict or pending_conflict:
                conn.rollback()
                return JSONResponse(conflict_payload("EMAIL_ALREADY_EXISTS"), status_code=409)
            expires_at = now + EMAIL_CHANGE_OTP_TTL_SECONDS
            cursor.execute(
                """INSERT INTO pending_email_changes (
                       user_id, current_email_norm, pending_email, pending_email_norm,
                       otp_hash, requested_at, expires_at, requested_ip
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(user_id) DO UPDATE SET
                       current_email_norm = excluded.current_email_norm,
                       pending_email = excluded.pending_email,
                       pending_email_norm = excluded.pending_email_norm,
                       otp_hash = excluded.otp_hash,
                       requested_at = excluded.requested_at,
                       expires_at = excluded.expires_at,
                       verified_at = NULL,
                       requested_ip = excluded.requested_ip""",
                (
                    role_or_err.user_id,
                    locked_user["email_norm"],
                    email,
                    email,
                    email_change_otp_hash,
                    now,
                    expires_at,
                    request_ip,
                ),
            )
            if replacement_password_hash:
                cursor.execute(
                    "UPDATE tai_khoan SET mat_khau = ? WHERE id = ?",
                    (replacement_password_hash, role_or_err.user_id),
                )

        if avatar:
            cursor.execute(
                "UPDATE tai_khoan SET ho_ten = ?, anh_dai_dien = ? WHERE id = ?",
                (name, avatar, role_or_err.user_id),
            )
        else:
            cursor.execute(
                "UPDATE tai_khoan SET ho_ten = ? WHERE id = ?",
                (name, role_or_err.user_id),
            )

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

        if email_change_requested:
            log_audit(
                "auth.email_change_requested",
                actor_user_id=role_or_err.user_id,
                target_type="tai_khoan",
                target_id=role_or_err.user_id,
                request=request,
                metadata={"expires_in": EMAIL_CHANGE_OTP_TTL_SECONDS},
                cursor=cursor,
                required=True,
            )
        conn.commit()
        payload = {
            "success": True,
            "message": "Cập nhật thông tin tài khoản thành công!",
            "profile": dict(updated_profile),
        }
        background = None
        if email_change_requested:
            payload.update({
                "message": "Thông tin hồ sơ đã được cập nhật. Hãy nhập OTP đã gửi đến email mới để hoàn tất thay đổi email.",
                "emailChangePending": True,
                "pendingEmail": email,
                "expiresIn": EMAIL_CHANGE_OTP_TTL_SECONDS,
            })
            background = _email_change_request_tasks(
                old_email=locked_user["email"],
                new_email=email,
                display_name=name,
                code=email_change_code,
            )
        return JSONResponse(payload, background=background)
    except IntegrityError as e:
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
            except DatabaseError: pass

async def verify_email_change_api(request):
    conn = None
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        data, json_error = await read_json_object(request)
        if json_error:
            return json_error
        invalid = validate_or_response(request, data, {
            "code": {"type": "string", "required": True, "min_length": 6, "max_length": 6},
        })
        if invalid:
            return invalid
        code = str(data.get("code") or "").strip()
        request_ip = get_client_ip(request)
        session_identity = (
            request.cookies.get("session_token")
            or getattr(role_or_err, "session_id", "")
        )
        session_rate_hash = hashlib.sha256(
            str(session_identity).encode("utf-8")
        ).hexdigest()[:24]
        ip_limit = await _get_rate_limit_decision_off_event_loop(
            f"email_change_verify:{request_ip}",
            max_attempts=EMAIL_CHANGE_VERIFY_MAX,
            window_seconds=EMAIL_CHANGE_VERIFY_WINDOW_SECONDS,
        )
        user_limit = await _get_rate_limit_decision_off_event_loop(
            f"email_change_verify_user:{role_or_err.user_id}",
            max_attempts=EMAIL_CHANGE_VERIFY_MAX,
            window_seconds=EMAIL_CHANGE_VERIFY_WINDOW_SECONDS,
        )
        session_limit = await _get_rate_limit_decision_off_event_loop(
            f"email_change_verify_session:{session_rate_hash}",
            max_attempts=EMAIL_CHANGE_VERIFY_MAX,
            window_seconds=EMAIL_CHANGE_VERIFY_WINDOW_SECONDS,
        )
        verify_limits = (ip_limit, user_limit, session_limit)
        if any(not limit.allowed for limit in verify_limits):
            log_audit(
                "auth.email_change_rate_limited",
                actor_user_id=role_or_err.user_id,
                target_type="tai_khoan",
                target_id=role_or_err.user_id,
                request=request,
                metadata={"stage": "verify"},
            )
            return rate_limit_response(
                "Quá nhiều lần xác minh email. Vui lòng thử lại sau.",
                next(limit for limit in verify_limits if not limit.allowed),
            )
        if not code.isdigit():
            log_audit(
                "auth.email_change_verification_failed",
                actor_user_id=role_or_err.user_id,
                target_type="tai_khoan",
                target_id=role_or_err.user_id,
                request=request,
                metadata={"reason": "invalid_otp_format"},
            )
            return JSONResponse(
                {"error": "Mã OTP không hợp lệ.", "code": "EMAIL_CHANGE_OTP_INVALID"},
                status_code=400,
            )

        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """SELECT change.user_id, change.current_email_norm,
                      change.pending_email, change.pending_email_norm,
                      change.otp_hash, change.requested_at, change.expires_at,
                      account.email AS current_email,
                      account.email_norm AS account_email_norm
               FROM pending_email_changes AS change
               JOIN tai_khoan AS account ON account.id = change.user_id
               WHERE change.user_id = ?""",
            (role_or_err.user_id,),
        )
        initial_change = cursor.fetchone()
        if not initial_change:
            return JSONResponse(
                {"error": "Không có yêu cầu thay đổi email đang chờ.", "code": "EMAIL_CHANGE_NOT_PENDING"},
                status_code=400,
            )
        initial_change = dict(initial_change)
        now = int(time.time())
        if now >= int(initial_change["expires_at"]):
            conn.execute("BEGIN")
            cursor.execute(
                "DELETE FROM pending_email_changes WHERE user_id = ? AND otp_hash = ?",
                (role_or_err.user_id, initial_change["otp_hash"]),
            )
            conn.commit()
            log_audit(
                "auth.email_change_verification_failed",
                actor_user_id=role_or_err.user_id,
                target_type="tai_khoan",
                target_id=role_or_err.user_id,
                request=request,
                metadata={"reason": "expired"},
            )
            return JSONResponse(
                {"error": "Mã OTP đã hết hạn.", "code": "EMAIL_CHANGE_OTP_EXPIRED"},
                status_code=400,
            )
        try:
            otp_verified = await run_cpu_bound(
                verify_password,
                initial_change["otp_hash"],
                code,
                timeout_seconds=15,
            )
        except (BlockingIOBusyError, BlockingIOTimeoutError):
            return _password_cpu_unavailable_response(request)

        if not otp_verified:
            log_audit(
                "auth.email_change_verification_failed",
                actor_user_id=role_or_err.user_id,
                target_type="tai_khoan",
                target_id=role_or_err.user_id,
                request=request,
                metadata={"reason": "invalid_otp"},
            )
            return JSONResponse(
                {"error": "Mã OTP không chính xác.", "code": "EMAIL_CHANGE_OTP_INVALID"},
                status_code=400,
            )

        conn.execute("BEGIN")
        cursor.execute(
            """SELECT change.user_id, change.current_email_norm,
                      change.pending_email, change.pending_email_norm,
                      change.otp_hash, change.expires_at,
                      account.email AS current_email,
                      account.email_norm AS account_email_norm
               FROM pending_email_changes AS change
               JOIN tai_khoan AS account ON account.id = change.user_id
               WHERE change.user_id = ?""",
            (role_or_err.user_id,),
        )
        locked_change = cursor.fetchone()
        if not locked_change:
            conn.rollback()
            return JSONResponse(
                {"error": "Yêu cầu thay đổi email không còn hiệu lực.", "code": "EMAIL_CHANGE_NOT_PENDING"},
                status_code=409,
            )
        locked_change = dict(locked_change)
        if locked_change["otp_hash"] != initial_change["otp_hash"]:
            conn.rollback()
            return JSONResponse(
                {"error": "Yêu cầu thay đổi email đã được thay thế.", "code": "EMAIL_CHANGE_REQUEST_REPLACED"},
                status_code=409,
            )
        now = int(time.time())
        if now >= int(locked_change["expires_at"]):
            cursor.execute(
                "DELETE FROM pending_email_changes WHERE user_id = ?",
                (role_or_err.user_id,),
            )
            conn.commit()
            return JSONResponse(
                {"error": "Mã OTP đã hết hạn.", "code": "EMAIL_CHANGE_OTP_EXPIRED"},
                status_code=400,
            )
        if locked_change["account_email_norm"] != locked_change["current_email_norm"]:
            cursor.execute(
                "DELETE FROM pending_email_changes WHERE user_id = ?",
                (role_or_err.user_id,),
            )
            conn.commit()
            return JSONResponse(
                {"error": "Email tài khoản đã thay đổi. Hãy tạo yêu cầu mới.", "code": "EMAIL_CHANGE_REQUEST_STALE"},
                status_code=409,
            )
        cursor.execute(
            "SELECT id FROM tai_khoan WHERE email_norm = ? AND id != ?",
            (locked_change["pending_email_norm"], role_or_err.user_id),
        )
        if cursor.fetchone():
            cursor.execute(
                "DELETE FROM pending_email_changes WHERE user_id = ?",
                (role_or_err.user_id,),
            )
            conn.commit()
            return JSONResponse(conflict_payload("EMAIL_ALREADY_EXISTS"), status_code=409)
        affected_organization_ids = [
            str(row[0])
            for row in cursor.execute(
                """SELECT organization_id
                   FROM thanh_vien_to_chuc
                   WHERE user_id = ?""",
                (role_or_err.user_id,),
            ).fetchall()
        ]

        cursor.execute(
            """UPDATE pending_email_changes
               SET verified_at = ?
               WHERE user_id = ? AND otp_hash = ? AND verified_at IS NULL""",
            (now, role_or_err.user_id, locked_change["otp_hash"]),
        )
        if cursor.rowcount != 1:
            conn.rollback()
            return JSONResponse(
                {"error": "Yêu cầu thay đổi email không còn hiệu lực.", "code": "EMAIL_CHANGE_NOT_PENDING"},
                status_code=409,
            )
        cursor.execute(
            """UPDATE tai_khoan
               SET email = ?, email_norm = ?, da_xac_minh = 1
               WHERE id = ? AND email_norm = ?""",
            (
                locked_change["pending_email"],
                locked_change["pending_email_norm"],
                role_or_err.user_id,
                locked_change["current_email_norm"],
            ),
        )
        if cursor.rowcount != 1:
            conn.rollback()
            return JSONResponse(
                {"error": "Không thể hoàn tất thay đổi email.", "code": "EMAIL_CHANGE_REQUEST_STALE"},
                status_code=409,
            )
        cursor.execute(
            "DELETE FROM pending_email_changes WHERE user_id = ?",
            (role_or_err.user_id,),
        )
        revoke_user_sessions(cursor, role_or_err.user_id, now=now)
        log_audit(
            "auth.email_changed",
            actor_user_id=role_or_err.user_id,
            target_type="tai_khoan",
            target_id=role_or_err.user_id,
            request=request,
            metadata={"sessions_revoked": True},
            cursor=cursor,
            required=True,
        )
        enqueue_websocket_event(
            cursor,
            "revoke_user",
            user_id=role_or_err.user_id,
        )
        for organization_id in affected_organization_ids:
            enqueue_websocket_event(
                cursor,
                "broadcast",
                organization_id=organization_id,
                payload={"event": "organization_member_changed"},
            )
        conn.commit()
        response = JSONResponse(
            {
                "success": True,
                "message": "Email đã được xác minh và thay đổi. Vui lòng đăng nhập lại.",
                "reauthenticationRequired": True,
            },
            background=_email_change_completed_tasks(
                old_email=locked_change["current_email"],
                new_email=locked_change["pending_email"],
            ),
        )
        response.delete_cookie("session_token", path="/")
        return response
    except IntegrityError as exc:
        if conn:
            conn.rollback()
        conflict_code = identity_conflict_code(exc)
        if conflict_code:
            return JSONResponse(conflict_payload(conflict_code), status_code=409)
        log_error(exc, "verify_email_change_api_integrity")
        return JSONResponse({"error": "Không thể thay đổi email do xung đột dữ liệu."}, status_code=409)
    except Exception as exc:
        if conn:
            conn.rollback()
        log_error(exc, "verify_email_change_api")
        return JSONResponse({"error": "Đã xảy ra lỗi khi xác minh email mới."}, status_code=500)
    finally:
        if conn:
            try: conn.close()
            except DatabaseError: pass


async def change_password_api(request):
    conn = None
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        data, json_error = await read_json_object(request)
        if json_error:
            return json_error
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
        cursor.execute(
            "SELECT mat_khau, id, email, ho_ten FROM tai_khoan WHERE id = ?",
            (role_or_err.user_id,),
        )
        row = cursor.fetchone()

        if not row:
            return JSONResponse({"error": "Người dùng không tồn tại!"}, status_code=400)

        user = dict(row)
        try:
            old_password_verified, new_password_hash = await run_cpu_bound(
                _verify_and_hash_replacement,
                user['mat_khau'],
                old_password,
                new_password,
                timeout_seconds=20,
            )
        except (BlockingIOBusyError, BlockingIOTimeoutError):
            return _password_cpu_unavailable_response(request)

        if not old_password_verified:
            return JSONResponse({"error": "Mật khẩu cũ không chính xác!"}, status_code=400)

        new_token = str(uuid.uuid4())
        token_expiry = int(time.time() + SESSION_EXPIRY_HOURS * 3600)
        conn.execute("BEGIN")
        cursor.execute(
            "UPDATE tai_khoan SET mat_khau = ? WHERE id = ?",
            (new_password_hash, user['id'])
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
        log_audit(
            "auth.password_changed",
            actor_user_id=role_or_err.user_id,
            target_type="tai_khoan",
            target_id=user['id'],
            request=request,
            cursor=cursor,
            required=True,
        )
        conn.commit()
        disconnect_user_websockets(user['id'])
        response = JSONResponse(
            {
                "success": True,
                "message": "Thay đổi mật khẩu thành công! Các phiên đăng nhập trên thiết bị khác đã bị đăng xuất."
            },
            background=build_security_notification_tasks(
                email=user.get("email"),
                display_name=user.get("ho_ten"),
                subject="[BiddingFlow] Mật khẩu đã được thay đổi",
                message="Mật khẩu tài khoản vừa được thay đổi và các phiên đăng nhập cũ đã bị thu hồi.",
            ),
        )
        response.set_cookie("session_token", new_token, httponly=True, secure=session_cookie_secure(request), samesite="lax", path="/")
        return response
    except Exception as e:
        if conn:
            conn.rollback()
        log_error(e, "change_password_api")
        return JSONResponse({"error": "Đã xảy ra lỗi khi đổi mật khẩu."}, status_code=500)
    finally:
        if conn:
            try: conn.close()
            except DatabaseError: pass

async def logout_api(request):
    conn = None
    user_id = None
    try:
        token = request.cookies.get('session_token')
        if token:
            conn = database.get_connection()
            cursor = conn.cursor()
            user_id = revoke_session(cursor, token)
            log_audit(
                "auth.logout",
                actor_user_id=user_id,
                target_type="session",
                request=request,
                cursor=cursor,
                required=True,
            )
            conn.commit()
            if user_id:
                disconnect_user_websockets(user_id)
        else:
            log_audit(
                "auth.logout",
                actor_user_id=None,
                target_type="session",
                request=request,
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
            except DatabaseError: pass


async def privileged_reauth_api(request):
    conn = None
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        ip = get_client_ip(request)
        ip_rate_key = f"privileged_reauth:{ip}"
        user_rate_key = f"privileged_reauth_user:{role_or_err.user_id}"
        reauth_ip_limit = await _get_rate_limit_decision_off_event_loop(
            ip_rate_key, consume_attempt=True
        )
        reauth_user_limit = await _get_rate_limit_decision_off_event_loop(
            user_rate_key, consume_attempt=True
        )
        if not reauth_ip_limit.allowed or not reauth_user_limit.allowed:
            return rate_limit_response(
                "Quá nhiều lần xác thực lại thất bại. Vui lòng thử lại sau.",
                reauth_ip_limit if not reauth_ip_limit.allowed else reauth_user_limit,
            )
        data, json_error = await read_json_object(request)
        if json_error:
            return json_error
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
            session_user = _load_user_by_session_token(
                request.cookies.get("session_token")
            ) or {}
            controls_valid, controls_error = verify_super_admin_controls(
                request,
                session_user,
                require_reauth=False,
            )
            if not controls_valid:
                return JSONResponse({"error": controls_error}, status_code=403)
        password_verified = False
        if password:
            try:
                password_verified = await run_cpu_bound(
                    verify_password,
                    row["mat_khau"],
                    password,
                    timeout_seconds=15,
                )
            except (BlockingIOBusyError, BlockingIOTimeoutError):
                return _password_cpu_unavailable_response(request)
        if not password_verified:
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
        log_audit(
            "admin.privileged_reauth_succeeded" if is_super_admin else "security.password_reauth_succeeded",
            actor_user_id=role_or_err.user_id,
            target_type="session",
            request=request,
            cursor=cursor,
            required=True,
        )
        clear_rate_limit_buckets(cursor, ip_rate_key, user_rate_key)
        conn.commit()
        return JSONResponse({"success": True, "expires_in": PRIVILEGED_REAUTH_TTL_SECONDS})
    except Exception as exc:
        if conn:
            conn.rollback()
        log_error(exc, "privileged_reauth_api")
        return JSONResponse({"error": "Không thể xác thực lại quyền quản trị."}, status_code=500)
    finally:
        if conn:
            conn.close()

from backend.auth.admin_user_routes import (
    delete_user_api as delete_user_api,
    list_users_api as list_users_api,
    update_user_access_settings_api as update_user_access_settings_api,
)

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

        data, json_error = await read_json_object(request)
        if json_error:
            return json_error
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

        actor_platform_admin = (
            getattr(role_or_err, "active_role", None) == "super_admin"
            or (
                getattr(role_or_err, "active_role", None) is None
                and getattr(role_or_err, "platform_role", str(role_or_err)) == "super_admin"
            )
        )
        actor_session = _load_user_by_session_token(
            request.cookies.get("session_token")
        ) or {}
        if actor_platform_admin:
            controls_valid, controls_error = verify_super_admin_controls(
                request,
                actor_session,
            )
            if not controls_valid:
                return JSONResponse({"error": controls_error}, status_code=403)
        else:
            reauth_valid, reauth_error = verify_recent_reauthentication(actor_session)
            if not reauth_valid:
                return JSONResponse({"error": reauth_error}, status_code=403)
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("BEGIN")
        if scope == "platform":
            if not actor_platform_admin:
                conn.rollback()
                return JSONResponse({"error": "Không có quyền thay đổi vai trò nền tảng."}, status_code=403)
            if new_role not in {"super_admin", "user"}:
                conn.rollback()
                return JSONResponse({"error": "Vai trò nền tảng không hợp lệ."}, status_code=400)
            lock_platform_role_invariants(cursor)
            if user_id == str(role_or_err.user_id):
                conn.rollback()
                return JSONResponse({"error": "Không thể tự thay đổi quyền nền tảng."}, status_code=409)
            cursor.execute(
                "SELECT 1 FROM tai_khoan WHERE id = ? AND trang_thai = 'active'",
                (user_id,),
            )
            if not cursor.fetchone():
                conn.rollback()
                return JSONResponse({"error": "Người dùng không tồn tại."}, status_code=404)
            cursor.execute("SELECT vai_tro FROM tai_khoan WHERE id = ?", (user_id,))
            target_platform_role = str(cursor.fetchone()[0] or '').strip().lower()
            if target_platform_role == 'super_admin' and new_role != 'super_admin':
                cursor.execute(
                    """SELECT count(*) FROM tai_khoan
                       WHERE vai_tro = 'super_admin' AND trang_thai = 'active'"""
                )
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
            lock_organization_membership_invariants(cursor, org_id)
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
                    """SELECT count(*) FROM thanh_vien_to_chuc
                       WHERE organization_id = ?
                         AND lower(trim(vai_tro_trong_to_chuc)) = 'manager'
                         AND COALESCE(trang_thai_thanh_vien, 'active') = 'active'""",
                    (org_id,),
                )
                if int(cursor.fetchone()[0]) <= 1:
                    conn.rollback()
                    return JSONResponse({"error": "Không thể hạ quyền Quản lý cuối cùng."}, status_code=409)

            cursor.execute(
                "UPDATE thanh_vien_to_chuc SET vai_tro_trong_to_chuc = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND organization_id = ?",
                (new_role, user_id, org_id),
            )
            audit_metadata = {"scope": "organization", "organization_id": org_id, "role": new_role}
            audit_event = "organization.member_role_updated"
        else:
            conn.rollback()
            return JSONResponse({"error": "Phạm vi vai trò không hợp lệ."}, status_code=400)

        log_audit(
            audit_event,
            actor_user_id=role_or_err.user_id,
            organization_id=audit_metadata.get("organization_id"),
            target_type="tai_khoan" if scope == "platform" else "organization_membership",
            target_id=user_id,
            request=request,
            metadata=audit_metadata,
            cursor=cursor,
            required=True,
        )
        conn.commit()
        disconnect_user_websockets(user_id)
        return JSONResponse(
            {"success": True, "message": "Cập nhật vai trò thành công!"}
        )
    except OrgPermissionError:
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


def _update_user_metadata_sync(request, actor_user_id, user_id, field, value):
    conn = None
    try:
        field_map = {
            'name': 'ho_ten',
        }

        if field not in field_map:
            return JSONResponse({"error": "Trường cập nhật không hợp lệ!"}, status_code=400)

        conn = database.get_connection()
        conn.execute("BEGIN")
        cursor = conn.cursor()
        db_field = field_map[field]
        cursor.execute(
            f"""UPDATE tai_khoan SET {db_field} = ?
                WHERE id = ? AND trang_thai = 'active'""",
            (value, user_id),
        )
        if cursor.rowcount != 1:
            conn.rollback()
            return JSONResponse({"error": "Người dùng không tồn tại."}, status_code=404)

        log_audit(
            "admin.user_metadata_updated",
            actor_user_id=actor_user_id,
            target_type="tai_khoan",
            target_id=user_id,
            request=request,
            metadata={"field": field},
            cursor=cursor,
            required=True,
        )
        conn.commit()
        return JSONResponse({"success": True, "message": "Cập nhật thông tin thành công!"})
    except IntegrityError as e:
        if conn:
            conn.rollback()
        conflict_code = identity_conflict_code(e)
        if conflict_code:
            return JSONResponse(conflict_payload(conflict_code), status_code=409)
        log_error(e, "update_user_metadata_api_integrity")
        return JSONResponse({"error": "Không thể cập nhật do xung đột dữ liệu."}, status_code=409)
    except Exception as e:
        if conn:
            conn.rollback()
        log_error(e, "update_user_metadata_api")
        return JSONResponse({"error": "Đã xảy ra lỗi khi cập nhật thông tin."}, status_code=500)
    finally:
        if conn:
            conn.close()


async def update_user_metadata_api(request):
    try:
        is_valid, role_or_err = await run_database_read(
            verify_session,
            request,
            required_role='super_admin',
            timeout_seconds=5.0,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _database_lane_unavailable_response(request, write=False)
    if not is_valid:
        return JSONResponse({"error": role_or_err}, status_code=403)
    data, json_error = await read_json_object(request)
    if json_error:
        return json_error
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
    if field == "email":
        return JSONResponse(
            {
                "error": "Email chỉ được thay đổi sau khi chủ tài khoản xác thực mật khẩu và OTP gửi đến email mới.",
                "code": "EMAIL_CHANGE_VERIFICATION_REQUIRED",
            },
            status_code=403,
        )
    try:
        return await run_database_write(
            _update_user_metadata_sync,
            request,
            role_or_err.user_id,
            user_id,
            field,
            value,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _database_lane_unavailable_response(request, write=True)

def _list_system_packages_sync(request):
    conn = None
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
        return JSONResponse(packages)
    except Exception as e:
        log_error(e, "list_system_packages_api")
        return JSONResponse({"error": "Đã xảy ra lỗi khi tải danh sách gói dịch vụ."}, status_code=500)
    finally:
        if conn:
            conn.close()

def _list_public_packages_sync(request):
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


async def list_system_packages_api(request):
    try:
        return await run_database_read(
            _list_system_packages_sync,
            request,
            timeout_seconds=10.0,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _database_lane_unavailable_response(request, write=False)


async def list_public_packages_api(request):
    try:
        return await run_database_read(
            _list_public_packages_sync,
            request,
            timeout_seconds=10.0,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _database_lane_unavailable_response(request, write=False)

def _update_system_package_sync(request, actor_user_id, pkg_id, name, price, quota, description, status):
    conn = None
    try:
        conn = database.get_connection()
        conn.execute("BEGIN")
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE goi_dich_vu
            SET ten_goi = ?, gia_ca = ?, han_muc_nhan_su = ?, mo_ta = ?, trang_thai = ?
            WHERE id = ?
        """, (name, price, quota, description, status, pkg_id))
        if cursor.rowcount != 1:
            conn.rollback()
            return JSONResponse({"error": "Gói dịch vụ không tồn tại."}, status_code=404)
        log_audit(
            "admin.system_package_updated",
            actor_user_id=actor_user_id,
            target_type="goi_dich_vu",
            target_id=pkg_id,
            request=request,
            metadata={
                "updated_fields": ["name", "price", "quota", "description", "status"],
                "status": status,
            },
            cursor=cursor,
            required=True,
        )
        conn.commit()
        return JSONResponse({"success": True, "message": "Cập nhật gói dịch vụ thành công!"})
    except Exception as e:
        if conn:
            conn.rollback()
        log_error(e, "update_system_package_api")
        return JSONResponse({"error": "Đã xảy ra lỗi khi cập nhật gói dịch vụ."}, status_code=500)
    finally:
        if conn:
            conn.close()


async def update_system_package_api(request):
    try:
        is_valid, role_or_err = await run_database_read(
            verify_session,
            request,
            required_role='super_admin',
            timeout_seconds=5.0,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _database_lane_unavailable_response(request, write=False)
    if not is_valid:
        return JSONResponse({"error": role_or_err}, status_code=403)
    data, json_error = await read_json_object(request)
    if json_error:
        return json_error
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
    try:
        return await run_database_write(
            _update_system_package_sync,
            request,
            role_or_err.user_id,
            pkg_id,
            name,
            price,
            quota,
            description,
            status,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _database_lane_unavailable_response(request, write=True)


from backend.auth.username_validator import validate_username

def _set_username_sync(request, role_or_err, new_username):
    conn = None
    try:
        conn = database.get_connection()
        conn.execute("BEGIN")
        cursor = conn.cursor()


        cursor.execute("SELECT id, ten_dang_nhap, username_da_dat FROM tai_khoan WHERE id = ?", (role_or_err.user_id,))
        row = cursor.fetchone()
        if not row:
            conn.rollback()
            return JSONResponse({"error": "Không tìm thấy tài khoản."}, status_code=404)

        user = dict(row)


        if user.get("username_da_dat") == 1 and user.get("ten_dang_nhap"):
            conn.rollback()
            return JSONResponse(
                {"error": "Tên đăng nhập đã được đặt trước đó và không thể thay đổi."},
                status_code=400
            )


        cursor.execute("SELECT 1 FROM tai_khoan WHERE username_norm = ? AND id != ?", (new_username, role_or_err.user_id))
        if cursor.fetchone():
            conn.rollback()
            return JSONResponse(
                {"error": "Tên đăng nhập này đã được sử dụng. Vui lòng chọn tên khác."},
                status_code=409
            )


        cursor.execute(
            "UPDATE tai_khoan SET ten_dang_nhap = ?, username_norm = ?, username_da_dat = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (new_username, new_username, role_or_err.user_id)
        )
        log_audit(
            "auth.set_username",
            actor_user_id=role_or_err.user_id,
            target_type="tai_khoan",
            target_id=role_or_err.user_id,
            request=request,
            metadata={"updated_fields": ["username"]},
            cursor=cursor,
            required=True,
        )
        conn.commit()
        return JSONResponse({"success": True, "username": new_username})

    except IntegrityError as e:
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
            except DatabaseError:
                pass


async def set_username_api(request):
    try:
        is_valid, role_or_err = await run_database_read(
            verify_session,
            request,
            timeout_seconds=5.0,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _database_lane_unavailable_response(request, write=False)
    if not is_valid:
        return JSONResponse({"error": role_or_err}, status_code=403)
    data, json_error = await read_json_object(request)
    if json_error:
        return json_error
    invalid = validate_or_response(request, data, {
        "username": {"type": "string", "required": True, "min_length": 1, "max_length": 64},
    })
    if invalid:
        return invalid
    new_username = normalize_username(data.get("username"))
    valid, reason = validate_username(new_username)
    if not valid:
        return JSONResponse({"error": reason}, status_code=400)
    try:
        return await run_database_write(
            _set_username_sync,
            request,
            role_or_err,
            new_username,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _database_lane_unavailable_response(request, write=True)
