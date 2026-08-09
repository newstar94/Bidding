"""Authenticated, PII-safe browser error telemetry."""

from __future__ import annotations

import re
import threading
import time
from collections import OrderedDict, deque

from starlette.responses import JSONResponse

from backend.auth.auth_helper import verify_session
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError
from backend.shared.database_io import run_database_read
from backend.shared.logging_utils import error_response, get_request_id, log_structured_event
from backend.shared.request_validation import read_json_object, validate_json_object


_REPORT_FIELDS = {
    "kind": {"type": "string", "required": True, "enum": {"error", "unhandledrejection"}},
    "releaseId": {"type": "string", "required": True, "min_length": 1, "max_length": 128},
    "errorName": {"type": "string", "required": True, "min_length": 1, "max_length": 64},
    "source": {"type": "string", "required": True, "min_length": 1, "max_length": 256},
    "line": {"type": "integer", "required": True, "min": 0, "max": 10_000_000},
    "column": {"type": "integer", "required": True, "min": 0, "max": 10_000_000},
    "operation": {"type": "string", "required": False, "min_length": 1, "max_length": 64},
    "phase": {"type": "string", "required": False, "min_length": 1, "max_length": 64},
    "retryable": {"type": "boolean", "required": False},
    "backendStatus": {"type": "string", "required": False, "min_length": 1, "max_length": 64},
    "workspaceHash": {"type": "string", "required": False, "min_length": 16, "max_length": 16},
    "correlationId": {"type": "string", "required": False, "min_length": 1, "max_length": 64},
}
_IDENTIFIER = re.compile(r"[A-Za-z][A-Za-z0-9_.-]{0,127}")
_CORRELATION_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}")
_WORKSPACE_HASH = re.compile(r"[0-9a-f]{16}")
_SOURCE_PATH = re.compile(r"(?:/dist/assets/|/frontend/)[A-Za-z0-9_./-]{1,240}|unknown")


class _ClientErrorRateLimiter:
    def __init__(self, limit=10, window_seconds=60, max_keys=4_096):
        self.limit = max(1, int(limit))
        self.window_seconds = max(1, int(window_seconds))
        self.max_keys = max(16, int(max_keys))
        self._entries = OrderedDict()
        self._lock = threading.Lock()

    def allow(self, opaque_user_id, now=None):
        current = time.monotonic() if now is None else float(now)
        cutoff = current - self.window_seconds
        key = str(opaque_user_id)
        with self._lock:
            timestamps = self._entries.pop(key, deque())
            while timestamps and timestamps[0] <= cutoff:
                timestamps.popleft()
            allowed = len(timestamps) < self.limit
            if allowed:
                timestamps.append(current)
            self._entries[key] = timestamps
            while len(self._entries) > self.max_keys:
                self._entries.popitem(last=False)
        return allowed


_rate_limiter = _ClientErrorRateLimiter()


def normalize_client_error_payload(payload):
    errors = validate_json_object(payload, _REPORT_FIELDS)
    if errors:
        return None, errors
    if not _IDENTIFIER.fullmatch(payload["releaseId"]):
        return None, [{"field": "releaseId", "code": "INVALID_IDENTIFIER", "message": "Release ID không hợp lệ."}]
    if not _IDENTIFIER.fullmatch(payload["errorName"]):
        return None, [{"field": "errorName", "code": "INVALID_IDENTIFIER", "message": "Loại lỗi không hợp lệ."}]
    if not _SOURCE_PATH.fullmatch(payload["source"]):
        return None, [{"field": "source", "code": "INVALID_SOURCE", "message": "Nguồn lỗi không hợp lệ."}]
    for name in ("operation", "phase", "backendStatus"):
        if name in payload and not _IDENTIFIER.fullmatch(payload[name]):
            return None, [{"field": name, "code": "INVALID_IDENTIFIER", "message": "Invalid telemetry dimension."}]
    if "workspaceHash" in payload and not _WORKSPACE_HASH.fullmatch(payload["workspaceHash"]):
        return None, [{"field": "workspaceHash", "code": "INVALID_HASH", "message": "Invalid workspace hash."}]
    if "correlationId" in payload and not _CORRELATION_ID.fullmatch(payload["correlationId"]):
        return None, [{"field": "correlationId", "code": "INVALID_IDENTIFIER", "message": "Invalid correlation ID."}]
    return {name: payload[name] for name in _REPORT_FIELDS if name in payload}, []


async def client_error_api(request):
    try:
        valid, session = await run_database_read(
            verify_session,
            request,
            timeout_seconds=5.0,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return error_response(
            request,
            "CLIENT_ERROR_AUTH_UNAVAILABLE",
            "Không thể xác thực báo cáo lỗi lúc này.",
            status_code=503,
        )
    if not valid:
        return error_response(
            request,
            "AUTH_REQUIRED",
            "Cần đăng nhập để gửi báo cáo lỗi.",
            status_code=403,
        )

    payload, json_error = await read_json_object(request)
    if json_error:
        return json_error
    normalized, errors = normalize_client_error_payload(payload)
    if errors:
        return error_response(
            request,
            "CLIENT_ERROR_PAYLOAD_INVALID",
            "Báo cáo lỗi không hợp lệ.",
            status_code=400,
            fields={"errors": errors},
        )

    user_id = str(session.user_id)
    if not _rate_limiter.allow(user_id):
        return JSONResponse(
            {"code": "CLIENT_ERROR_RATE_LIMITED", "error": "Quá nhiều báo cáo lỗi."},
            status_code=429,
            headers={"Retry-After": "60"},
        )
    log_structured_event(
        "client.error",
        level="WARN",
        request_id=get_request_id(request),
        actor_user_id=user_id,
        fields=normalized,
        nonblocking=True,
    )
    return JSONResponse({"accepted": True}, status_code=202)
