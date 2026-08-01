import asyncio

import pytest

from backend.http_middleware import SecurityHeadersMiddleware
from backend.startup import StartupValidationError, validate_http_resource_limits


def test_http_resource_limit_defaults_match_application_websocket_limit():
    limits = validate_http_resource_limits({})

    assert limits == {
        "limit_concurrency": 256,
        "backlog": 512,
        "timeout_keep_alive": 5,
        "max_requests": 10_000,
        "max_requests_jitter": 1_000,
        "ws_max_size": 65_536,
        "ws_max_queue": 16,
    }


def test_http_resource_limits_reject_mismatched_websocket_boundaries():
    with pytest.raises(
        StartupValidationError,
        match="UVICORN_WS_MAX_SIZE must equal WEBSOCKET_MAX_FRAME_BYTES",
    ):
        validate_http_resource_limits({
            "UVICORN_WS_MAX_SIZE": "131072",
            "WEBSOCKET_MAX_FRAME_BYTES": "65536",
        })


def test_http_resource_limits_reject_restart_jitter_above_request_budget():
    with pytest.raises(StartupValidationError, match="cannot exceed"):
        validate_http_resource_limits({
            "UVICORN_MAX_REQUESTS": "1000",
            "UVICORN_MAX_REQUESTS_JITTER": "1001",
        })


def _security_headers(monkeypatch, enabled):
    monkeypatch.setenv("TURNSTILE_ENABLED", "true" if enabled else "false")
    messages = []

    async def inner_app(_scope, _receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        messages.append(message)

    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": "/",
        "raw_path": b"/",
        "query_string": b"",
        "headers": [],
        "client": ("127.0.0.1", 12345),
        "server": ("127.0.0.1", 8000),
    }
    asyncio.run(SecurityHeadersMiddleware(inner_app)(scope, receive, send))
    return {
        key.decode("latin-1").lower(): value.decode("latin-1")
        for key, value in messages[0]["headers"]
    }


def test_csp_allows_turnstile_only_when_feature_is_enabled(monkeypatch):
    enabled = _security_headers(monkeypatch, True)["content-security-policy"]
    disabled = _security_headers(monkeypatch, False)["content-security-policy"]

    assert "https://challenges.cloudflare.com" in enabled
    assert "https://challenges.cloudflare.com" not in disabled

