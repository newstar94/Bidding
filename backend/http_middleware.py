"""HTTP transport safeguards kept separate from application routing/lifecycle."""

import os
import re
import secrets
from urllib.parse import urlparse

from starlette.datastructures import MutableHeaders
from starlette.requests import HTTPConnection, Request
from starlette.responses import JSONResponse, Response

from backend.shared.client_ip import (
    is_request_secure,
    is_trusted_proxy_peer,
    should_use_secure_cookie,
)
from backend.shared.logging_utils import error_response
from backend.shared.origin_policy import (
    get_allowed_websocket_origins,
    is_http_origin_allowed,
)


TURNSTILE_ORIGIN = "https://challenges.cloudflare.com"
_CONTENT_HASH_VERSION = re.compile(r"[0-9a-f]{64}\Z")
_DIST_CONTENT_HASHED_ASSET = re.compile(
    r"/dist/assets/.+-[A-Za-z0-9_-]{8}\.(?:js|css|png|webp|woff2|woff|ttf)\Z"
)


def _turnstile_enabled():
    from backend.security.turnstile import (
        TurnstileConfigurationError,
        get_turnstile_config,
    )

    try:
        return get_turnstile_config().enabled
    except TurnstileConfigurationError:
        return False


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
        TURNSTILE_ORIGIN if _turnstile_enabled() else None,
    ]
    return " ".join(dict.fromkeys(value for value in values if value))


class ProxyHeaderTrustMiddleware:
    """Remove proxy metadata unless the direct socket peer is explicitly trusted."""

    _PROXY_HEADERS = {
        b"forwarded",
        b"x-forwarded-for",
        b"x-forwarded-host",
        b"x-forwarded-port",
        b"x-forwarded-prefix",
        b"x-forwarded-proto",
        b"x-real-ip",
    }
    _NEVER_PROPAGATE = {
        b"forwarded",
        b"x-forwarded-host",
        b"x-forwarded-port",
        b"x-forwarded-prefix",
    }

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in {"http", "websocket"}:
            await self.app(scope, receive, send)
            return
        # HTTPConnection accepts both HTTP and WebSocket ASGI scopes.  Request
        # asserts an HTTP-only scope and would turn every WebSocket handshake
        # into a 500 response before it reached the endpoint.
        trusted_peer = is_trusted_proxy_peer(HTTPConnection(scope))
        sanitized_headers = []
        for name, value in scope.get("headers", ()):
            lower_name = name.lower()
            if lower_name in self._NEVER_PROPAGATE:
                continue
            if lower_name in self._PROXY_HEADERS and not trusted_peer:
                continue
            if lower_name == b"x-forwarded-proto":
                proto = value.decode("latin-1").strip().lower()
                if proto not in {"http", "https"}:
                    continue
                value = proto.encode("ascii")
            sanitized_headers.append((name, value))
        await self.app({**scope, "headers": sanitized_headers}, receive, send)


class ResponseIntegrityMiddleware:
    """Keep the final ASGI response framing valid at the HTTP-server boundary."""

    def __init__(self, app):
        self.app = app

    @staticmethod
    def _has_stable_static_body(scope):
        path = str(scope.get("path") or "")
        return path == "/service-worker.js" or path.startswith((
            "/dist/assets/",
            "/vendor/",
            "/css/",
            "/tabs/",
            "/modals/",
        ))

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        suppress_body = str(scope.get("method") or "").upper() == "HEAD"
        body_finished = False

        async def send_with_valid_framing(message):
            nonlocal suppress_body, body_finished
            if message["type"] == "http.response.start":
                status_code = int(message.get("status") or 0)
                suppress_body = suppress_body or status_code in {204, 304}
                headers = MutableHeaders(scope=message)
                if (
                    not suppress_body
                    and "Content-Length" in headers
                    and not self._has_stable_static_body(scope)
                ):
                    # Uvicorn will select chunked framing.  This avoids a stale
                    # length after any inner middleware or conditional response
                    # adapter changes the body.
                    del headers["Content-Length"]
                await send(message)
                return
            if message["type"] == "http.response.body" and suppress_body:
                if body_finished:
                    return
                body_finished = True
                await send({**message, "body": b"", "more_body": False})
                return
            await send(message)

        await self.app(scope, receive, send_with_valid_framing)


class SecurityHeadersMiddleware:
    """Pure ASGI middleware that preserves bodyless 204/304 responses."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope)
        suppress_body = request.method.upper() == "HEAD"
        body_finished = False

        async def send_with_security_headers(message):
            nonlocal suppress_body, body_finished
            if message["type"] == "http.response.body" and suppress_body:
                if body_finished:
                    return
                body_finished = True
                await send({**message, "body": b"", "more_body": False})
                return
            if message["type"] != "http.response.start":
                await send(message)
                return

            status_code = int(message.get("status") or 0)
            suppress_body = suppress_body or status_code in {204, 304}
            headers = MutableHeaders(scope=message)
            if status_code == 204 and "Content-Length" in headers:
                del headers["Content-Length"]
            headers["X-Content-Type-Options"] = "nosniff"
            headers["X-Frame-Options"] = "SAMEORIGIN"
            headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
            headers["Permissions-Policy"] = (
                "camera=(), microphone=(), geolocation=(), payment=(), usb=(), "
                "interest-cohort=(), identity-credentials-get=(self)"
            )
            headers["Cross-Origin-Opener-Policy"] = "same-origin-allow-popups"
            turnstile_source = f" {TURNSTILE_ORIGIN}" if _turnstile_enabled() else ""
            headers["Content-Security-Policy"] = (
                "default-src 'self'; "
                f"script-src 'self' https://accounts.google.com https://apis.google.com{turnstile_source}; "
                "style-src 'self' https://fonts.googleapis.com https://accounts.google.com; "
                "style-src-elem 'self' https://fonts.googleapis.com https://accounts.google.com; "
                # Google Identity Services sets one stable inline style on its own
                # iframe. Permit only that exact declaration; first-party inline
                # styles and every other attribute remain blocked.
                "style-src-attr 'unsafe-hashes' 'sha256-4PX7giCQMi8wBuhXIfPmyuw/Y9KfbeLY2K+XpOH6msQ='; "  # pragma: allowlist secret
                "img-src 'self' data: blob: https://lh3.googleusercontent.com; "
                f"connect-src {_connect_sources()}; "
                "font-src 'self' https://fonts.gstatic.com; "
                f"frame-src 'self' https://accounts.google.com{turnstile_source}; "
                "worker-src 'self'; base-uri 'self'; object-src 'none'; "
                "require-trusted-types-for 'script'; trusted-types biddingflow-html biddingflow-dompurify goog#html 'allow-duplicates';"
            )
            if "Content-Security-Policy-Report-Only" in headers:
                del headers["Content-Security-Policy-Report-Only"]
            path = request.url.path
            if is_request_secure(request):
                headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
            if path.startswith(("/api/", "/ws/")):
                headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
            elif (
                _DIST_CONTENT_HASHED_ASSET.fullmatch(path)
                or (
                    _CONTENT_HASH_VERSION.fullmatch(
                        request.query_params.get("v") or ""
                    )
                    and path.endswith(('.js', '.css', '.png', '.webp', '.woff2', '.woff', '.ttf'))
                )
            ):
                # A missing chunk can occur briefly while releases are switched.
                # Never let a browser or CDN preserve that transient response under
                # a content-addressed URL for the immutable one-year lifetime.
                if status_code in {200, 206, 304}:
                    headers["Cache-Control"] = "public, max-age=31536000, immutable"
                else:
                    headers["Cache-Control"] = "no-store"
            elif path.endswith(('.js', '.css')):
                headers["Cache-Control"] = "public, max-age=0, must-revalidate"
            await send(message)

        await self.app(scope, receive, send_with_security_headers)


class BodySizeLimitMiddleware:
    BODY_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
    DOCUMENT_PATHS = {"/api/templates/upload", "/api/import-excel"}
    SYNC_PATHS = {"/api/sync", "/api/plans/finalize-draft"}

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
        if path in cls.SYNC_PATHS:
            return cls._configured_limit("REQUEST_MAX_SYNC_BYTES", 10 * 1024 * 1024)
        if (
            path.startswith("/api/packages/")
            and "/documents/" in path
            and not path.endswith("/download")
        ):
            return cls._configured_limit(
                "REQUEST_MAX_PACKAGE_DOCUMENT_BYTES",
                26 * 1024 * 1024,
            )
        if path in cls.DOCUMENT_PATHS or (
            path.startswith("/api/templates/") and path.lower().endswith(".docx")
        ):
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
        received_size = 0
        response_started = False

        class BodyLimitSignal(BaseException):
            """Internal signal that cannot be swallowed by broad route handlers."""

            def __init__(self, code, message, status_code, fields=None):
                super().__init__(message)
                self.code = code
                self.message = message
                self.status_code = status_code
                self.fields = fields

        async def limited_receive():
            nonlocal received_size
            message = await receive()
            if message["type"] == "http.disconnect" and not response_started:
                raise BodyLimitSignal(
                    "REQUEST_BODY_INCOMPLETE",
                    "Kết nối bị ngắt trước khi nhận đủ dữ liệu.",
                    400,
                )
            if message["type"] == "http.request":
                received_size += len(message.get("body", b""))
                if received_size > limit:
                    raise BodyLimitSignal(
                        "REQUEST_BODY_TOO_LARGE",
                        "Dữ liệu gửi lên vượt quá giới hạn cho phép.",
                        413,
                        {"maxBytes": limit},
                    )
            return message

        async def track_response_start(message):
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, track_response_start)
        except BodyLimitSignal as signal:
            if response_started:
                raise RuntimeError(
                    "Request body validation failed after the response had started."
                ) from signal
            await self._reject(
                scope,
                send,
                signal.code,
                signal.message,
                signal.status_code,
                signal.fields,
            )


class CSRFMiddleware:
    MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
    EXEMPT_PATHS = {
        "/api/auth/login", "/api/auth/google-login", "/api/auth/register",
        "/api/auth/check-session", "/api/auth/verify", "/api/auth/resend-code",
        "/api/auth/forgot-password",
    }

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope)
        csrf_cookie = request.cookies.get("csrf_token")
        csrf_token = csrf_cookie or secrets.token_urlsafe(32)
        if request.method in self.MUTATING_METHODS:
            origin = request.headers.get("origin")
            referer = request.headers.get("referer")
            if origin and not is_http_origin_allowed(origin):
                response = JSONResponse({"error": "Yêu cầu bị từ chối do vi phạm CSRF! (Origin không khớp)"}, status_code=403)
                await response(scope, receive, send)
                return
            if referer and not is_http_origin_allowed(referer, allow_path=True):
                response = JSONResponse({"error": "Yêu cầu bị từ chối do vi phạm CSRF! (Referer không khớp)"}, status_code=403)
                await response(scope, receive, send)
                return
            requires_token = (
                request.url.path.startswith("/api/")
                and request.url.path not in self.EXEMPT_PATHS
                and bool(request.cookies.get("session_token"))
            )
            if requires_token:
                if not origin and not referer:
                    response = JSONResponse(
                        {
                            "error": "Yêu cầu bị từ chối do thiếu Origin/Referer.",
                            "code": "CSRF_ORIGIN_REQUIRED",
                        },
                        status_code=403,
                    )
                    await response(scope, receive, send)
                    return
                header_token = request.headers.get("x-csrf-token", "")
                if not csrf_cookie or not header_token or not secrets.compare_digest(csrf_cookie, header_token):
                    response = JSONResponse({"error": "Yêu cầu bị từ chối do thiếu hoặc sai CSRF token!", "code": "CSRF_TOKEN_INVALID"}, status_code=403)
                    await response(scope, receive, send)
                    return

        cookie_header = None
        if not csrf_cookie:
            cookie_response = Response()
            cookie_response.set_cookie(
                "csrf_token", csrf_token, httponly=False,
                secure=should_use_secure_cookie(
                    request,
                    os.environ.get("APP_SECURE_COOKIES", "False").lower() == "true",
                ),
                samesite="lax", path="/",
            )
            cookie_header = cookie_response.headers.get("set-cookie")

        async def send_with_csrf_cookie(message):
            if message["type"] == "http.response.start" and cookie_header:
                MutableHeaders(scope=message).append("set-cookie", cookie_header)
            await send(message)

        await self.app(scope, receive, send_with_csrf_cookie)
