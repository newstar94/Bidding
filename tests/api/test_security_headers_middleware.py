from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.responses import Response
from starlette.routing import Route
from starlette.testclient import TestClient

from backend.http_middleware import (
    CSRFMiddleware,
    ResponseIntegrityMiddleware,
    SecurityHeadersMiddleware,
)
from backend.shared.logging_utils import ErrorLoggingMiddleware, RequestIdMiddleware


async def _not_modified(_request):
    return Response(
        content=b"this body must never reach the HTTP server",
        status_code=304,
        headers={"ETag": '"qa-etag"', "Content-Length": "0"},
    )


def test_security_headers_preserve_bodyless_not_modified_response():
    app = Starlette(
        routes=[Route("/asset.js", _not_modified)],
        middleware=[
            Middleware(ResponseIntegrityMiddleware),
            Middleware(RequestIdMiddleware),
            Middleware(CSRFMiddleware),
            Middleware(SecurityHeadersMiddleware),
            Middleware(ErrorLoggingMiddleware),
        ],
    )

    with TestClient(app) as client:
        response = client.get("/asset.js")

    assert response.status_code == 304
    assert response.content == b""
    assert response.headers["etag"] == '"qa-etag"'
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["cache-control"] == "public, max-age=0, must-revalidate"
    assert response.headers["x-request-id"]
    assert "csrf_token=" in response.headers["set-cookie"]


async def _wrong_length(_request):
    return Response(content=b"complete response", headers={"Content-Length": "0"})


def test_response_integrity_reframes_a_stale_content_length():
    app = Starlette(
        routes=[Route("/payload", _wrong_length)],
        middleware=[Middleware(ResponseIntegrityMiddleware)],
    )

    with TestClient(app) as client:
        response = client.get("/payload")

    assert response.status_code == 200
    assert response.content == b"complete response"
    assert response.headers.get("content-length") != "0"
