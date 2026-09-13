"""Same-origin public gateway for the independent Chuẩn Hóa API.

Only end-user access/bootstrap paths are exposed. Admin integration remains a
server-to-server call and is intentionally not proxied to the browser.
"""

from __future__ import annotations

import os
from urllib.parse import urljoin

import httpx
from starlette.responses import Response


_ALLOWED_PREFIXES = ("v1/access/", "v1/access", "health")
_HOP_BY_HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailers", "transfer-encoding", "upgrade", "host"}
_INTEGRATION_HEADERS = {"x-integration-client", "x-integration-timestamp", "x-integration-nonce", "x-integration-signature", "idempotency-key"}


def _upstream() -> str:
    value = str(os.environ.get("CHUAN_HOA_PUBLIC_UPSTREAM_URL", "")).strip().rstrip("/")
    if value:
        return value
    if str(os.environ.get("APP_ENV", "development")).strip().casefold() in {"development", "test"}:
        return "http://127.0.0.1:5206"
    return ""


def _allowed(path: str) -> bool:
    normalized = path.lstrip("/")
    return any(normalized == prefix.rstrip("/") or normalized.startswith(prefix) for prefix in _ALLOWED_PREFIXES)


async def chuan_hoa_public_proxy(request):
    path = request.path_params.get("path", "").lstrip("/")
    if not _allowed(path):
        return Response('{"error":"RESOURCE_NOT_FOUND"}', status_code=404, media_type="application/json")
    upstream = _upstream()
    if not upstream:
        return Response('{"error":"CHUAN_HOA_PUBLIC_UPSTREAM_NOT_CONFIGURED"}', status_code=503, media_type="application/json")
    body = await request.body()
    if len(body) > 1_048_576:
        return Response('{"error":"REQUEST_BODY_TOO_LARGE"}', status_code=413, media_type="application/json")
    target = urljoin(upstream + "/", path)
    if request.url.query:
        target += "?" + request.url.query
    headers = {key: value for key, value in request.headers.items() if key.lower() not in _HOP_BY_HOP and key.lower() not in _INTEGRATION_HEADERS}
    headers["X-Forwarded-Host"] = request.headers.get("host", "")
    headers["X-Forwarded-Prefix"] = "/chuan-hoa"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=3.0), follow_redirects=False) as client:
            upstream_response = await client.request(request.method, target, content=body, headers=headers)
    except (httpx.TimeoutException, httpx.HTTPError):
        return Response('{"error":"CHUAN_HOA_PUBLIC_UPSTREAM_UNAVAILABLE"}', status_code=503, media_type="application/json")
    response_headers = {key: value for key, value in upstream_response.headers.items() if key.lower() not in _HOP_BY_HOP}
    response_headers["Cache-Control"] = "no-store"
    return Response(upstream_response.content, status_code=upstream_response.status_code, headers=response_headers)


def chuan_hoa_public_proxy_routes(Route):
    return [
        Route("/chuan-hoa", chuan_hoa_public_proxy, methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]),
        Route("/chuan-hoa/{path:path}", chuan_hoa_public_proxy, methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]),
    ]
