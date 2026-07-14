import os
from urllib.parse import urlparse


def _split_origins(value):
    return frozenset(
        item.strip().rstrip("/")
        for item in str(value or "").split(",")
        if item.strip()
    )


def get_allowed_websocket_origins():
    configured = _split_origins(os.environ.get("ALLOWED_WS_ORIGINS", ""))
    if configured:
        return configured
    host = os.environ.get("APP_HOST", "127.0.0.1").strip() or "127.0.0.1"
    port = int(os.environ.get("APP_PORT", "8000"))
    secure = os.environ.get("APP_SECURE_COOKIES", "False").lower() == "true"
    scheme = "https" if secure else "http"
    suffix = f":{port}" if port not in (80, 443) else ""
    return frozenset({
        f"{scheme}://{host}{suffix}",
        f"{scheme}://localhost{suffix}",
        f"{scheme}://127.0.0.1{suffix}",
    })


def is_websocket_origin_allowed(origin, allowed_origins=None):
    candidate = str(origin or "").strip().rstrip("/")
    if not candidate:
        return False
    try:
        parsed = urlparse(candidate)
    except Exception:
        return False
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return False
    if parsed.username or parsed.password or parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
        return False
    allowed = get_allowed_websocket_origins() if allowed_origins is None else frozenset(allowed_origins)
    return candidate in allowed
