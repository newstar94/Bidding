import asyncio

import httpx2 as httpx
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.responses import PlainTextResponse
from starlette.routing import Route
from starlette.requests import Request

from backend.auth import auth_service
from backend.http_middleware import CSRFMiddleware


def _request(scheme):
    return Request(
        {
            "type": "http",
            "method": "GET",
            "scheme": scheme,
            "path": "/",
            "query_string": b"",
            "headers": [],
            "client": ("127.0.0.1", 12345),
            "server": ("localhost", 8000),
        }
    )


def test_secure_cookie_policy_does_not_break_local_http_webkit(monkeypatch):
    monkeypatch.setattr(auth_service, "_SECURE_COOKIES", True)
    monkeypatch.setenv("APP_ENV", "development")

    assert auth_service.session_cookie_secure(_request("http")) is False
    assert auth_service.session_cookie_secure(_request("https")) is True


def test_secure_cookie_policy_stays_fail_closed_in_production(monkeypatch):
    monkeypatch.setattr(auth_service, "_SECURE_COOKIES", True)
    monkeypatch.setenv("APP_ENV", "production")

    assert auth_service.session_cookie_secure(_request("http")) is True


def test_csrf_cookie_uses_the_same_local_http_policy(monkeypatch):
    monkeypatch.setenv("APP_SECURE_COOKIES", "true")
    monkeypatch.setenv("APP_ENV", "development")

    async def read(_request):
        return PlainTextResponse("ok")

    app = Starlette(
        routes=[Route("/", read)],
        middleware=[Middleware(CSRFMiddleware)],
    )

    async def request():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://127.0.0.1:8000",
        ) as client:
            return await client.get("/")

    response = asyncio.run(request())
    assert "Secure" not in response.headers["set-cookie"]
