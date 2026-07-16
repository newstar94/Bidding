import os
import traceback
import json
import sqlite3
import time
import re
import threading
import uuid
from datetime import datetime, timezone
from starlette.datastructures import MutableHeaders
from starlette.requests import Request
from starlette.responses import JSONResponse
from backend.shared.client_ip import get_client_ip
from backend.shared.audit_chain import insert_audit_row
from backend.shared.paths import LOG_DIR

_log_lock = threading.Lock()
_request_id_pattern = re.compile(r"^[A-Za-z0-9._-]{1,128}$")
_secret_patterns = (
    (
        re.compile(r"(?i)\b(authorization|cookie|set-cookie)\b\s*[\"']?\s*[:=]\s*[^\r\n]+"),
        "[REDACTED_HEADER]",
    ),
    (
        re.compile(
            r"(?i)[\"']?\b(session_token|csrf_token|access_token|refresh_token|password|mat_khau)\b"
            r"[\"']?\s*[:=]\s*[\"']?[^\s,;\]}\"']+"
        ),
        "[REDACTED_SECRET]",
    ),
    (re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+"), "Bearer [REDACTED_SECRET]"),
    (re.compile(r"(?i)([?&]token=)[^&\s]+"), r"\1[REDACTED_SECRET]"),
    (re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"), "[REDACTED_EMAIL]"),
    (re.compile(r"(?i)data:[^;\s]+;base64,[A-Za-z0-9+/=]{32,}"), "[REDACTED_FILE_CONTENT]"),
    (
        re.compile(
            r"(?i)[\"']?\b(file_content|image_data|document_content|base64)\b"
            r"[\"']?\s*[:=]\s*[\"']?[A-Za-z0-9+/=]{32,}"
        ),
        "[REDACTED_FILE_CONTENT]",
    ),
)


def redact_log_value(value):
    text = str(value or "")
    for pattern, replacement in _secret_patterns:
        text = pattern.sub(replacement, text)
    return text[:500_000]


def _rotate_log(path, max_bytes, backup_count):
    if not path.exists() or path.stat().st_size < max_bytes:
        return
    oldest = path.with_name(f"{path.name}.{backup_count}")
    if oldest.exists():
        oldest.unlink()
    for index in range(backup_count - 1, 0, -1):
        source = path.with_name(f"{path.name}.{index}")
        if source.exists():
            source.replace(path.with_name(f"{path.name}.{index + 1}"))
    path.replace(path.with_name(f"{path.name}.1"))


def append_runtime_log(filename, content):
    """Append a redacted entry to a rotated runtime log outside source artifacts."""
    configured_log_dir = os.environ.get("BIDDING_LOG_DIR", "").strip()
    log_dir = (type(LOG_DIR)(configured_log_dir) if configured_log_dir else LOG_DIR).resolve()
    log_dir.mkdir(parents=True, exist_ok=True)
    path = (log_dir / os.path.basename(filename)).resolve()
    if path.parent != log_dir:
        raise ValueError("Invalid runtime log path")
    max_bytes = max(64 * 1024, int(os.environ.get("LOG_MAX_BYTES", 5 * 1024 * 1024)))
    backup_count = min(30, max(1, int(os.environ.get("LOG_BACKUP_COUNT", 5))))
    with _log_lock:
        _rotate_log(path, max_bytes, backup_count)
        with path.open("a", encoding="utf-8") as log_file:
            log_file.write(redact_log_value(content))
        try:
            path.chmod(0o600)
        except OSError:
            pass


def get_request_id(request=None):
    if request is not None:
        existing = str(getattr(getattr(request, "state", None), "request_id", "") or "")
        if _request_id_pattern.fullmatch(existing):
            return existing
        headers = getattr(request, "headers", {}) or {}
        incoming = str(headers.get("X-Request-ID", "") or "")
        if _request_id_pattern.fullmatch(incoming):
            request_id = incoming
        else:
            request_id = uuid.uuid4().hex
        try:
            request.state.request_id = request_id
        except Exception:
            pass
        return request_id
    return uuid.uuid4().hex


def error_response(request, code, message, status_code=500, fields=None):
    request_id = get_request_id(request)
    payload = {
        "code": str(code),
        "message": str(message),
        "fields": fields if isinstance(fields, dict) else {},
        "requestId": request_id,
        # Temporary compatibility alias until P2-04 migrates every caller.
        "error": str(message),
    }
    return JSONResponse(payload, status_code=status_code, headers={"X-Request-ID": request_id})


def log_and_error(request, exception, context, code, message, status_code=500, fields=None):
    request_id = get_request_id(request)
    log_error(exception, context, request_id=request_id)
    return error_response(request, code, message, status_code=status_code, fields=fields)


def log_error(e_or_msg, context="System", level="ERROR", request_id=None):
    try:
        now_str = datetime.now(timezone.utc).isoformat()
        request_part = f" [requestId={request_id}]" if request_id else ""
        if isinstance(e_or_msg, Exception):
            tb = traceback.format_exc()
            msg = f"[{now_str}] [{context}] [{level}]{request_part} LỖI: {e_or_msg}\n{tb}\n"
        else:
            msg = f"[{now_str}] [{context}] [{level}]{request_part} THÔNG BÁO: {e_or_msg}\n"
        append_runtime_log("sync_error.log", msg)
    except Exception:
        pass
    if os.environ.get("APP_DEBUG", "False").lower() == "true":
        print(redact_log_value(f"[{context}] [{level}] {e_or_msg}"))


def log_audit(action, actor_user_id=None, organization_id=None, target_type=None, target_id=None, request=None, metadata=None):

    conn = None
    try:
        ip_address = None
        if request is not None:
            ip_address = get_client_ip(request)

        metadata_json = None
        if metadata is not None:
            metadata_json = json.dumps(metadata, ensure_ascii=False, default=str)

        from backend.shared.helpers import database as _db
        last_err = None
        for attempt in range(3):
            try:
                conn = _db.get_connection()
                try:
                    conn.execute("PRAGMA busy_timeout = 1000")
                except Exception:
                    pass
                cur = conn.cursor()
                insert_audit_row(
                    cur,
                    actor_user_id=actor_user_id,
                    organization_id=organization_id,
                    action=action,
                    target_type=target_type,
                    target_id=target_id,
                    ip_address=ip_address,
                    metadata_json=metadata_json,
                )
                conn.commit()
                return
            except sqlite3.OperationalError as err:
                last_err = err
                if conn:
                    try:
                        conn.rollback()
                    except Exception:
                        pass
                    try:
                        conn.close()
                    except Exception:
                        pass
                    conn = None
                if "locked" not in str(err).lower() or attempt == 2:
                    raise
                time.sleep(0.05 * (attempt + 1))
            finally:
                if conn:
                    try:
                        conn.close()
                    except Exception:
                        pass
                    conn = None

        if last_err:
            raise last_err
    except Exception as audit_err:
        log_error(audit_err, "audit_log", level="WARN")



class ErrorLoggingMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope)
        response_started = False

        async def send_with_error_status(message):
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
                status_code = int(message.get("status") or 0)
                if status_code >= 500:
                    log_error(
                        f"Phản hồi lỗi server {status_code}",
                        f"HTTP {request.method} {request.url.path}",
                        request_id=get_request_id(request),
                    )
            await send(message)

        try:
            await self.app(scope, receive, send_with_error_status)
        except Exception as e:
            if response_started:
                raise
            response = log_and_error(
                request,
                e,
                f"HTTP {request.method} {request.url.path}",
                "INTERNAL_SERVER_ERROR",
                "Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.",
            )
            await response(scope, receive, send)


class RequestIdMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope)
        request_id = get_request_id(request)

        async def send_with_request_id(message):
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message)["X-Request-ID"] = request_id
            await send(message)

        await self.app(scope, receive, send_with_request_id)
