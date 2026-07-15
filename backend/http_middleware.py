"""HTTP transport safeguards kept separate from application routing/lifecycle."""

import json
import os
import secrets
from urllib.parse import urlparse

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from backend.shared.client_ip import is_request_secure
from backend.shared.logging_utils import error_response
from backend.shared.origin_policy import get_allowed_websocket_origins


def _websocket_source(origin):
    parsed = urlparse(origin)
    if not parsed.netloc:
        return None
    if parsed.scheme in {"https", "wss"}:
        return f"wss://{parsed.netloc}"
    if parsed.scheme in {"http", "ws"}:
        return f"ws://{parsed.netloc}"
    return None


def _connect_sources():
    values = [
        "'self'",
        *(_websocket_source(origin) for origin in get_allowed_websocket_origins()),
        "https://accounts.google.com",
        "https://oauth2.googleapis.com",
    ]
    return " ".join(dict.fromkeys(value for value in values if value))


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()"
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin-allow-popups"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' https://accounts.google.com https://apis.google.com; "
            "style-src 'self' https://fonts.googleapis.com https://accounts.google.com; "
            "style-src-elem 'self' https://fonts.googleapis.com https://accounts.google.com; "
            # Google Identity Services sets one stable inline style on its own
            # iframe. Permit only that exact declaration; first-party inline
            # styles and every other attribute remain blocked.
            "style-src-attr 'unsafe-hashes' 'sha256-4PX7giCQMi8wBuhXIfPmyuw/Y9KfbeLY2K+XpOH6msQ='; "
            "img-src 'self' data: blob: https://lh3.googleusercontent.com; "
            f"connect-src {_connect_sources()}; "
            "font-src 'self' https://fonts.gstatic.com; "
            "frame-src 'self' https://accounts.google.com; "
            "worker-src 'self'; base-uri 'self'; object-src 'none'; "
            "require-trusted-types-for 'script'; trusted-types default goog#html;"
        )
        if "Content-Security-Policy-Report-Only" in response.headers:
            del response.headers["Content-Security-Policy-Report-Only"]
        path = request.url.path
        if is_request_secure(request):
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        if path.startswith(("/api/", "/ws/")):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        elif request.query_params.get("v") and path.endswith(('.js', '.css', '.png', '.woff2', '.woff', '.ttf')):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        elif path.endswith(('.js', '.css')):
            response.headers["Cache-Control"] = "public, max-age=0, must-revalidate"
        return response


class BodySizeLimitMiddleware:
    BODY_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
    DOCUMENT_PATHS = {"/api/templates/upload", "/api/import-excel"}

    def __init__(self, app):
        self.app = app

    @staticmethod
    def _configured_limit(name, default):
        try:
            value = int(os.environ.get(name, str(default)))
        except (TypeError, ValueError):
            value = default
        return min(64 * 1024 * 1024, max(64 * 1024, value))

    @classmethod
    def _limit_for_path(cls, path):
        if path == "/api/sync":
            return cls._configured_limit("REQUEST_MAX_SYNC_BYTES", 10 * 1024 * 1024)
        if path in cls.DOCUMENT_PATHS:
            return cls._configured_limit("REQUEST_MAX_DOCUMENT_BYTES", 11 * 1024 * 1024)
        return cls._configured_limit("REQUEST_MAX_JSON_BYTES", 1024 * 1024)

    @staticmethod
    async def _reject(scope, send, code, message, status_code, fields=None):
        response = error_response(Request(scope), code, message, status_code=status_code, fields=fields)

        async def empty_receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        await response(scope, empty_receive, send)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method") not in self.BODY_METHODS:
            await self.app(scope, receive, send)
            return
        request = Request(scope)
        limit = self._limit_for_path(scope.get("path", ""))
        if (request.headers.get("content-encoding") or "identity").lower() not in {"", "identity"}:
            await self._reject(scope, send, "REQUEST_CONTENT_ENCODING_UNSUPPORTED", "Không hỗ trợ nội dung request đã nén.", 415)
            return
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                declared_size = int(content_length)
                if declared_size < 0:
                    raise ValueError
            except ValueError:
                await self._reject(scope, send, "CONTENT_LENGTH_INVALID", "Content-Length không hợp lệ.", 400)
                return
            if declared_size > limit:
                await self._reject(scope, send, "REQUEST_BODY_TOO_LARGE", "Dữ liệu gửi lên vượt quá giới hạn cho phép.", 413, {"maxBytes": limit})
                return
        messages = []
        received_size = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                await self._reject(scope, send, "REQUEST_BODY_INCOMPLETE", "Kết nối bị ngắt trước khi nhận đủ dữ liệu.", 400)
                return
            messages.append(message)
            if message["type"] != "http.request":
                continue
            received_size += len(message.get("body", b""))
            if received_size > limit:
                await self._reject(scope, send, "REQUEST_BODY_TOO_LARGE", "Dữ liệu gửi lên vượt quá giới hạn cho phép.", 413, {"maxBytes": limit})
                return
            if not message.get("more_body", False):
                break
        content_type = (request.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
        if content_type == "application/json":
            raw_body = b"".join(message.get("body", b"") for message in messages if message.get("type") == "http.request")
            try:
                parsed_body = json.loads(raw_body.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                await self._reject(scope, send, "REQUEST_JSON_INVALID", "Nội dung JSON không hợp lệ.", 400)
                return
            if not isinstance(parsed_body, dict):
                await self._reject(scope, send, "REQUEST_JSON_OBJECT_REQUIRED", "Nội dung JSON phải là một object.", 400)
                return
        message_index = 0

        async def replay_receive():
            nonlocal message_index
            if message_index < len(messages):
                message = messages[message_index]
                message_index += 1
                return message
            return {"type": "http.request", "body": b"", "more_body": False}

        await self.app(scope, replay_receive, send)


class CSRFMiddleware(BaseHTTPMiddleware):
    MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
    EXEMPT_PATHS = {
        "/api/auth/login", "/api/auth/google-login", "/api/auth/register",
        "/api/auth/check-session", "/api/auth/verify", "/api/auth/resend-code",
        "/api/auth/forgot-password",
    }

    async def dispatch(self, request, call_next):
        csrf_cookie = request.cookies.get("csrf_token")
        csrf_token = csrf_cookie or secrets.token_urlsafe(32)
        if request.method in self.MUTATING_METHODS:
            host = request.headers.get("host")

            def same_host(value):
                try:
                    return urlparse(value).netloc == host
                except Exception:
                    return False

            origin = request.headers.get("origin")
            referer = request.headers.get("referer")
            if origin and not same_host(origin):
                return JSONResponse({"error": "Yêu cầu bị từ chối do vi phạm CSRF! (Origin không khớp)"}, status_code=403)
            if referer and not same_host(referer):
                return JSONResponse({"error": "Yêu cầu bị từ chối do vi phạm CSRF! (Referer không khớp)"}, status_code=403)
            requires_token = (
                request.url.path.startswith("/api/")
                and request.url.path not in self.EXEMPT_PATHS
                and bool(request.cookies.get("session_token"))
            )
            if requires_token:
                header_token = request.headers.get("x-csrf-token", "")
                if not csrf_cookie or not header_token or not secrets.compare_digest(csrf_cookie, header_token):
                    return JSONResponse({"error": "Yêu cầu bị từ chối do thiếu hoặc sai CSRF token!", "code": "CSRF_TOKEN_INVALID"}, status_code=403)
        response = await call_next(request)
        if not csrf_cookie:
            response.set_cookie(
                "csrf_token", csrf_token, httponly=False,
                secure=os.environ.get("APP_SECURE_COOKIES", "False").lower() == "true",
                samesite="lax", path="/",
            )
        return response
