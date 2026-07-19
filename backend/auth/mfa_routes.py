"""Authenticated MFA enrollment and lifecycle endpoints."""

from __future__ import annotations

import html
import time

from starlette.background import BackgroundTasks
from starlette.responses import JSONResponse

from backend.auth.auth_helper import verify_password, verify_session
from backend.auth.mfa_service import (
    MfaConfigurationError,
    MfaStateError,
    begin_mfa_enrollment,
    confirm_mfa_enrollment,
    consume_mfa_code,
    disable_mfa,
    get_mfa_status,
    is_mfa_required_for_role,
)
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError
from backend.shared.cpu_io import run_cpu_bound
from backend.shared.database_io import run_database_read, run_database_write
from backend.shared.helpers import database, gui_email, log_audit, log_error
from backend.shared.request_validation import read_json_object, validate_or_response


def _load_mfa_status(user_id, role):
    conn = database.get_connection()
    try:
        return get_mfa_status(conn.cursor(), user_id, role)
    finally:
        conn.close()


def _load_account_password(user_id):
    conn = database.get_connection()
    try:
        row = conn.execute(
            "SELECT mat_khau, email, ho_ten, vai_tro FROM tai_khoan WHERE id = ?",
            (user_id,),
        ).fetchone()
        return tuple(row) if row else None
    finally:
        conn.close()


def _begin_enrollment(user_id, account_label, request):
    conn = database.get_connection()
    try:
        conn.execute("BEGIN")
        cursor = conn.cursor()
        payload = begin_mfa_enrollment(
            cursor, user_id=user_id, account_label=account_label
        )
        log_audit(
            "auth.mfa_enrollment_started",
            actor_user_id=user_id,
            target_type="tai_khoan",
            target_id=user_id,
            request=request,
            cursor=cursor,
            required=True,
        )
        conn.commit()
        return payload
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _confirm_enrollment(user_id, session_id, code, request):
    conn = database.get_connection()
    try:
        conn.execute("BEGIN")
        cursor = conn.cursor()
        recovery_codes = confirm_mfa_enrollment(
            cursor, user_id=user_id, code=code
        )
        now = int(time.time())
        cursor.execute(
            """UPDATE auth_sessions
               SET mfa_verified_at = ?, privileged_reauth_at = ?
               WHERE id = ? AND user_id = ? AND revoked_at IS NULL""",
            (now, now, session_id, user_id),
        )
        if cursor.rowcount != 1:
            raise MfaStateError("Phiên đăng nhập không còn hợp lệ.")
        log_audit(
            "auth.mfa_enabled",
            actor_user_id=user_id,
            target_type="tai_khoan",
            target_id=user_id,
            request=request,
            cursor=cursor,
            required=True,
        )
        conn.commit()
        return recovery_codes
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _disable_mfa(user_id, code, request):
    conn = database.get_connection()
    try:
        conn.execute("BEGIN")
        cursor = conn.cursor()
        if not consume_mfa_code(cursor, user_id=user_id, code=code):
            raise MfaStateError("Mã xác thực không đúng hoặc đã được sử dụng.")
        disable_mfa(cursor, user_id=user_id)
        cursor.execute(
            "UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
            (int(time.time()), user_id),
        )
        log_audit(
            "auth.mfa_disabled",
            actor_user_id=user_id,
            target_type="tai_khoan",
            target_id=user_id,
            request=request,
            cursor=cursor,
            required=True,
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _security_notification(email, display_name, subject, message):
    if not email:
        return None
    safe_name = html.escape(str(display_name or "bạn"))
    safe_message = html.escape(str(message))
    return (
        str(email),
        subject,
        (
            '<html><body style="font-family:Arial,sans-serif;line-height:1.6">'
            f"<p>Xin chào <strong>{safe_name}</strong>,</p>"
            f"<p>{safe_message}</p>"
            "<p>Nếu không phải bạn thực hiện, hãy đổi mật khẩu và liên hệ quản trị viên ngay.</p>"
            "</body></html>"
        ),
    )


async def mfa_status_api(request):
    valid, role_or_error = verify_session(request, allow_pending_mfa=True)
    if not valid:
        return JSONResponse({"error": role_or_error}, status_code=401)
    try:
        status = await run_database_read(
            _load_mfa_status, role_or_error.user_id, str(role_or_error)
        )
        return JSONResponse(status, headers={"Cache-Control": "no-store"})
    except Exception as exc:
        log_error(exc, "mfa_status_api")
        return JSONResponse({"error": "Không thể đọc trạng thái MFA."}, status_code=500)


async def mfa_setup_api(request):
    valid, role_or_error = verify_session(request, allow_pending_mfa=True)
    if not valid:
        return JSONResponse({"error": role_or_error}, status_code=401)
    data, json_error = await read_json_object(request)
    if json_error:
        return json_error
    invalid = validate_or_response(
        request,
        data,
        {"password": {"type": "string", "required": True, "min_length": 1, "max_length": 256}},
    )
    if invalid:
        return invalid
    try:
        account = await run_database_read(
            _load_account_password, role_or_error.user_id
        )
        if not account:
            return JSONResponse({"error": "Không tìm thấy tài khoản."}, status_code=404)
        password_ok = await run_cpu_bound(
            verify_password, account[0], data["password"], timeout_seconds=15
        )
        if not password_ok:
            return JSONResponse({"error": "Mật khẩu không đúng."}, status_code=403)
        payload = await run_database_write(
            _begin_enrollment,
            role_or_error.user_id,
            account[1] or role_or_error.user_id,
            request,
        )
        return JSONResponse(
            {"success": True, **payload},
            headers={"Cache-Control": "no-store"},
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return JSONResponse({"error": "Hệ thống đang bận. Vui lòng thử lại."}, status_code=503)
    except (MfaConfigurationError, MfaStateError) as exc:
        return JSONResponse({"error": str(exc)}, status_code=409)
    except Exception as exc:
        log_error(exc, "mfa_setup_api")
        return JSONResponse({"error": "Không thể bắt đầu thiết lập MFA."}, status_code=500)


async def mfa_confirm_api(request):
    valid, role_or_error = verify_session(request, allow_pending_mfa=True)
    if not valid:
        return JSONResponse({"error": role_or_error}, status_code=401)
    data, json_error = await read_json_object(request)
    if json_error:
        return json_error
    invalid = validate_or_response(
        request,
        data,
        {"code": {"type": "string", "required": True, "min_length": 6, "max_length": 32}},
    )
    if invalid:
        return invalid
    try:
        recovery_codes = await run_database_write(
            _confirm_enrollment,
            role_or_error.user_id,
            role_or_error.session_id,
            data["code"],
            request,
        )
        account = await run_database_read(
            _load_account_password, role_or_error.user_id
        )
        tasks = BackgroundTasks()
        if account:
            notification = _security_notification(
                account[1],
                account[2],
                "[BiddingFlow] Xác thực hai lớp đã được bật",
                "Xác thực hai lớp vừa được bật cho tài khoản BiddingFlow của bạn.",
            )
            if notification:
                tasks.add_task(gui_email, *notification)
        return JSONResponse(
            {"success": True, "recovery_codes": recovery_codes},
            headers={"Cache-Control": "no-store"},
            background=tasks,
        )
    except (MfaConfigurationError, MfaStateError) as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    except Exception as exc:
        log_error(exc, "mfa_confirm_api")
        return JSONResponse({"error": "Không thể xác nhận MFA."}, status_code=500)


async def mfa_disable_api(request):
    valid, role_or_error = verify_session(request)
    if not valid:
        return JSONResponse({"error": role_or_error}, status_code=401)
    data, json_error = await read_json_object(request)
    if json_error:
        return json_error
    invalid = validate_or_response(
        request,
        data,
        {
            "password": {"type": "string", "required": True, "min_length": 1, "max_length": 256},
            "code": {"type": "string", "required": True, "min_length": 6, "max_length": 32},
        },
    )
    if invalid:
        return invalid
    try:
        account = await run_database_read(
            _load_account_password, role_or_error.user_id
        )
        if not account:
            return JSONResponse({"error": "Không tìm thấy tài khoản."}, status_code=404)
        if is_mfa_required_for_role(account[3]):
            return JSONResponse(
                {"error": "Super Admin bắt buộc phải duy trì MFA."},
                status_code=403,
            )
        password_ok = await run_cpu_bound(
            verify_password, account[0], data["password"], timeout_seconds=15
        )
        if not password_ok:
            return JSONResponse({"error": "Mật khẩu không đúng."}, status_code=403)
        await run_database_write(
            _disable_mfa, role_or_error.user_id, data["code"], request
        )
        tasks = BackgroundTasks()
        notification = _security_notification(
            account[1],
            account[2],
            "[BiddingFlow] Xác thực hai lớp đã bị tắt",
            "Xác thực hai lớp vừa bị tắt và tất cả phiên đăng nhập đã bị thu hồi.",
        )
        if notification:
            tasks.add_task(gui_email, *notification)
        response = JSONResponse({"success": True}, background=tasks)
        response.delete_cookie("session_token", path="/")
        return response
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return JSONResponse({"error": "Hệ thống đang bận. Vui lòng thử lại."}, status_code=503)
    except (MfaConfigurationError, MfaStateError) as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    except Exception as exc:
        log_error(exc, "mfa_disable_api")
        return JSONResponse({"error": "Không thể tắt MFA."}, status_code=500)
