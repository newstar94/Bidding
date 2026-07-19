import os
import traceback
import json
import time
import re
import queue
import threading
import uuid
from datetime import datetime, timezone
from starlette.datastructures import MutableHeaders
from starlette.requests import Request
from starlette.responses import JSONResponse
from backend.shared.client_ip import get_client_ip
from backend.shared.audit_chain import (
    append_audit_row,
    insert_audit_row,
    require_audit_chain_available,
)
from backend.shared.paths import LOG_DIR

_log_lock = threading.Lock()
_structured_worker_lock = threading.Lock()
_structured_log_queue = queue.Queue(maxsize=1024)
_structured_worker_started = False
_request_id_pattern = re.compile(r"^[A-Za-z0-9._-]{1,128}$")
_structured_key_pattern = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
_secret_patterns = (
    (
        re.compile(r"(?i)\b(authorization|cookie|set-cookie)\b\s*[\"']?\s*[:=]\s*[^\r\n]+"),
        "[REDACTED_HEADER]",
    ),
    (
        re.compile(
            r"(?i)[\"']?\b(session_token|csrf_token|access_token|refresh_token|"
            r"password|temporary_password|mat_khau|otp|otp_code|verification_code|"
            r"reset_token|credential|google_credential|client_secret|smtp_password|"
            r"database_url|connection_string|encryption_key)\b"
            r"[\"']?\s*[:=]\s*[\"']?[^\s,;\]}\"']+"
        ),
        "[REDACTED_SECRET]",
    ),
    (re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+"), "Bearer [REDACTED_SECRET]"),
    (
        re.compile(
            r"(?i)([?&](?:token|code|credential|access_token|refresh_token)=)[^&\s]+"
        ),
        r"\1[REDACTED_SECRET]",
    ),
    (
        re.compile(r"(?i)\bpostgres(?:ql)?://[^\s\"'<>\]]+"),
        "postgresql://[REDACTED_CONNECTION]",
    ),
    (re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"), "[REDACTED_EMAIL]"),
    (re.compile(r"(?i)data:[^;\s]+;base64,[A-Za-z0-9+/=]{32,}"), "[REDACTED_FILE_CONTENT]"),
    (
        re.compile(
            r"(?i)[\"']?\b(file_content|image_data|document_content|base64)\b"
            r"[\"']?\s*[:=]\s*[\"']?[A-Za-z0-9+/=]{32,}"
        ),
        "[REDACTED_FILE_CONTENT]",
    ),
    # Citizen IDs and bank-account-like values have no place in runtime logs.
    # This intentionally also redacts some long technical numbers.
    (re.compile(r"(?<![A-Za-z0-9])\d{9,19}(?![A-Za-z0-9])"), "[REDACTED_NUMBER]"),
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


def _append_redacted_runtime_log(filename, content):
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
            log_file.write(content)
        try:
            path.chmod(0o600)
        except OSError:
            pass


def append_runtime_log(filename, content):
    """Append a redacted entry to a rotated runtime log outside source artifacts."""
    _append_redacted_runtime_log(filename, redact_log_value(content))


def _structured_log_worker():
    while True:
        line = _structured_log_queue.get()
        try:
            _append_redacted_runtime_log("runtime.jsonl", line)
        except Exception:
            pass
        finally:
            _structured_log_queue.task_done()


def _enqueue_structured_log(line):
    global _structured_worker_started
    with _structured_worker_lock:
        if not _structured_worker_started:
            threading.Thread(
                target=_structured_log_worker,
                daemon=True,
                name="structured-runtime-log",
            ).start()
            _structured_worker_started = True
    try:
        _structured_log_queue.put_nowait(line)
    except queue.Full:
        try:
            from backend.observability.metrics import runtime_log_dropped

            runtime_log_dropped()
        except Exception:
            pass


def _structured_value(value):
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, int):
        return "[REDACTED_NUMBER]" if abs(value) >= 100_000_000 else value
    if isinstance(value, float):
        return value
    return redact_log_value(value)[:8_192]


def _safe_identifier(value):
    text = str(value or "").strip()
    return text if _request_id_pattern.fullmatch(text) else None


def _release_id():
    return _safe_identifier(os.environ.get("APP_RELEASE_ID", "")) or "development"


def log_structured_event(
    event,
    *,
    level="INFO",
    request_id=None,
    actor_user_id=None,
    organization_id=None,
    fields=None,
    nonblocking=False,
):
    """Write one JSON line using code-owned keys and redacted scalar values."""
    event_name = str(event or "application.event").strip()
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_.-]{0,95}", event_name):
        event_name = "application.event"
    payload = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "severity": str(level or "INFO").upper()[:16],
        "event": event_name,
        "releaseId": _release_id(),
    }
    safe_request_id = _safe_identifier(request_id)
    safe_user_id = _safe_identifier(actor_user_id)
    safe_organization_id = _safe_identifier(organization_id)
    if safe_request_id:
        payload["requestId"] = safe_request_id
    if safe_user_id:
        payload["userId"] = safe_user_id
    if safe_organization_id:
        payload["organizationId"] = safe_organization_id
    if isinstance(fields, dict):
        for key, value in fields.items():
            key_text = str(key or "")
            if _structured_key_pattern.fullmatch(key_text):
                payload[key_text] = _structured_value(value)
    line = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    if nonblocking:
        _enqueue_structured_log(line + "\n")
    else:
        _append_redacted_runtime_log("runtime.jsonl", line + "\n")


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


def _request_actor_context(request):
    state = getattr(request, "state", None)
    actor_user_id = getattr(state, "auth_user_id", None)
    organization_context = getattr(state, "organization_context", None)
    organization_id = getattr(organization_context, "active_org_id", None)
    return actor_user_id, organization_id


def log_http_request(request, *, method, route, status_code, duration_seconds):
    mode = str(os.environ.get("STRUCTURED_REQUEST_LOG_MODE", "errors")).strip().casefold()
    if mode == "off" or (mode != "all" and int(status_code) < 400):
        return
    actor_user_id, organization_id = _request_actor_context(request)
    log_structured_event(
        "http.request.completed",
        level="ERROR" if int(status_code) >= 500 else "WARN",
        request_id=get_request_id(request),
        actor_user_id=actor_user_id,
        organization_id=organization_id,
        fields={
            "method": str(method or "UNKNOWN").upper()[:16],
            "route": str(route or "unknown")[:96],
            "status": int(status_code),
            "durationMs": round(max(0.0, float(duration_seconds)) * 1000.0, 3),
        },
        nonblocking=True,
    )


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
    actor_user_id, organization_id = _request_actor_context(request)
    log_error(
        exception,
        context,
        request_id=request_id,
        actor_user_id=actor_user_id,
        organization_id=organization_id,
    )
    return error_response(request, code, message, status_code=status_code, fields=fields)


def log_error(
    e_or_msg,
    context="System",
    level="ERROR",
    request_id=None,
    actor_user_id=None,
    organization_id=None,
    fields=None,
):
    try:
        include_details = (
            os.environ.get("APP_DEBUG", "False").lower() == "true"
            or os.environ.get("LOG_INCLUDE_EXCEPTION_DETAILS", "False").lower() == "true"
        )
        event_fields = {
            "context": redact_log_value(context)[:256],
            **(fields if isinstance(fields, dict) else {}),
        }
        if isinstance(e_or_msg, Exception):
            event_fields["exceptionType"] = e_or_msg.__class__.__name__[:128]
            if include_details:
                event_fields.update(
                    {
                        "message": redact_log_value(e_or_msg)[:8_192],
                        "traceback": redact_log_value(traceback.format_exc())[:64_000],
                    }
                )
            event_name = "application.error"
        else:
            if include_details:
                event_fields["message"] = redact_log_value(e_or_msg)[:8_192]
            event_name = "application.message"
        log_structured_event(
            event_name,
            level=level,
            request_id=request_id,
            actor_user_id=actor_user_id,
            organization_id=organization_id,
            fields=event_fields,
        )
    except Exception:
        pass
    if os.environ.get("APP_DEBUG", "False").lower() == "true":
        print(redact_log_value(f"[{context}] [{level}] {e_or_msg}"))


def log_audit(
    action,
    actor_user_id=None,
    organization_id=None,
    target_type=None,
    target_id=None,
    request=None,
    metadata=None,
    *,
    cursor=None,
    required=False,
):
    """Record an audit event.

    Supplying ``cursor`` binds the event to the caller's ``BEGIN``
    transaction and requires the write to succeed.  Standalone calls retain
    the historical best-effort behaviour unless ``required=True`` is set.
    """

    conn = None
    try:
        if required:
            require_audit_chain_available()
        ip_address = None
        if request is not None:
            ip_address = get_client_ip(request)

        metadata_json = None
        if metadata is not None:
            metadata_json = json.dumps(metadata, ensure_ascii=False, default=str)

        event = {
            "actor_user_id": actor_user_id,
            "organization_id": organization_id,
            "action": action,
            "target_type": target_type,
            "target_id": target_id,
            "ip_address": ip_address,
            "metadata_json": metadata_json,
        }
        if cursor is not None:
            if not required:
                raise ValueError("Transactional audit writes must set required=True.")
            return insert_audit_row(cursor, **event)

        from backend.shared.helpers import database as _db
        # Do not retry with ``time.sleep`` here: many historical callers are
        # async routes, and a synchronous backoff would freeze the ASGI event
        # loop. Security-sensitive mutations bind required audit to their own
        # transaction; best-effort standalone events get one bounded attempt.
        conn = _db.get_connection()
        return append_audit_row(conn, **event)
    except Exception as audit_err:
        log_error(audit_err, "audit_log", level="WARN")
        if required:
            raise
        return None



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
            await send(message)

        try:
            await self.app(scope, receive, send_with_error_status)
        except Exception as e:
            if response_started:
                raise
            actor_user_id, organization_id = _request_actor_context(request)
            log_error(
                e,
                "HTTP request",
                request_id=get_request_id(request),
                actor_user_id=actor_user_id,
                organization_id=organization_id,
                fields={"method": request.method, "route": "unhandled_exception"},
            )
            response = error_response(
                request,
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
