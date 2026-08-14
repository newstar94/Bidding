import os
from urllib.parse import urlparse


def normalize_http_origin(value, *, allow_path=False):
    """Return a canonical HTTP origin, or ``None`` for non-origin input."""

    candidate = str(value or "").strip()
    if not candidate or candidate.casefold() == "null":
        return None
    try:
        parsed = urlparse(candidate)
        port = parsed.port
    except (TypeError, ValueError):
        return None
    scheme = parsed.scheme.casefold()
    hostname = str(parsed.hostname or "").casefold().rstrip(".")
    if (
        scheme not in {"http", "https"}
        or not hostname
        or parsed.username
        or parsed.password
        or (
            not allow_path
            and (
                parsed.path not in {"", "/"}
                or parsed.params
                or parsed.query
                or parsed.fragment
            )
        )
    ):
        return None
    default_port = 443 if scheme == "https" else 80
    host = f"[{hostname}]" if ":" in hostname else hostname
    suffix = "" if port in {None, default_port} else f":{port}"
    return f"{scheme}://{host}{suffix}"


def get_allowed_http_origins(environ=None):
    environment = os.environ if environ is None else environ
    explicitly_trusted = str(
        environment.get("CSRF_TRUSTED_ORIGINS", "")
    ).strip()
    if explicitly_trusted:
        return frozenset(
            normalized
            for normalized in (
                normalize_http_origin(item)
                for item in explicitly_trusted.split(",")
            )
            if normalized
        )

    configured = normalize_http_origin(environment.get("APP_PUBLIC_URL"))
    if configured:
        return frozenset({configured})

    host = str(environment.get("APP_HOST", "127.0.0.1")).strip() or "127.0.0.1"
    try:
        port = int(environment.get("APP_PORT", "8000"))
    except (TypeError, ValueError):
        port = 8000
    secure = str(environment.get("APP_SECURE_COOKIES", "False")).casefold() == "true"
    scheme = "https" if secure else "http"
    suffix = "" if port in ({443} if secure else {80}) else f":{port}"
    return frozenset(
        normalize_http_origin(f"{scheme}://{candidate}{suffix}")
        for candidate in {host, "localhost", "127.0.0.1"}
    ) - {None}


def is_http_origin_allowed(value, allowed_origins=None, *, allow_path=False):
    candidate = normalize_http_origin(value, allow_path=allow_path)
    if candidate is None:
        return False
    allowed = (
        get_allowed_http_origins()
        if allowed_origins is None
        else frozenset(
            normalized
            for normalized in map(normalize_http_origin, allowed_origins)
            if normalized
        )
    )
    return candidate in allowed


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
    candidate = normalize_http_origin(origin)
    allowed = get_allowed_websocket_origins() if allowed_origins is None else allowed_origins
    return candidate is not None and candidate in {
        normalized
        for normalized in map(normalize_http_origin, allowed)
        if normalized
    }
