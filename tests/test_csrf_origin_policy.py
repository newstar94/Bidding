import asyncio

import httpx2 as httpx
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.responses import JSONResponse
from starlette.routing import Route

from backend.http_middleware import CSRFMiddleware
from backend.shared.origin_policy import (
    is_http_origin_allowed,
    normalize_http_origin,
)


async def _mutate(_request):
    return JSONResponse({"ok": True})


def _client(monkeypatch, public_url="https://biddingflow.example"):
    monkeypatch.setenv("APP_PUBLIC_URL", public_url)
    app = Starlette(
        routes=[Route("/api/data", _mutate, methods=["POST"])],
        middleware=[Middleware(CSRFMiddleware)],
    )
    return app


def _request(client, *, origin=None, referer=None, host="biddingflow.example"):
    headers = {"Host": host, "X-CSRF-Token": "csrf-value"}
    if origin is not None:
        headers["Origin"] = origin
    if referer is not None:
        headers["Referer"] = referer
    async def send():
        transport = httpx.ASGITransport(app=client)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="https://biddingflow.example",
        ) as http_client:
            http_client.cookies.update(
                {"session_token": "session", "csrf_token": "csrf-value"}
            )
            return await http_client.post("/api/data", headers=headers)

    return asyncio.run(send())


def test_canonical_origin_handles_default_ports_and_ipv6():
    assert normalize_http_origin("https://EXAMPLE.com:443/") == "https://example.com"
    assert normalize_http_origin("http://example.com:80") == "http://example.com"
    assert normalize_http_origin("https://[2001:db8::1]:8443") == "https://[2001:db8::1]:8443"


def test_origin_policy_rejects_malformed_null_and_credentials():
    allowed = {"https://biddingflow.example"}
    for candidate in (
        "null",
        "not a url",
        "https://user@biddingflow.example",
        "https://biddingflow.example/path",
        "https://biddingflow.example?query=1",
        "https://[2001:db8::1",
    ):
        assert not is_http_origin_allowed(candidate, allowed)


def test_authenticated_mutation_uses_configured_origin_not_spoofed_host(monkeypatch):
    client = _client(monkeypatch)
    response = _request(
        client,
        origin="https://biddingflow.example",
        host="attacker.example",
    )
    assert response.status_code == 200


def test_origin_rejects_scheme_subdomain_suffix_and_port_mismatch(monkeypatch):
    client = _client(monkeypatch)
    candidates = (
        "http://biddingflow.example",
        "https://sub.biddingflow.example",
        "https://biddingflow.example.attacker.test",
        "https://biddingflow.example:444",
    )
    for candidate in candidates:
        assert _request(client, origin=candidate).status_code == 403


def test_authenticated_mutation_requires_origin_or_referer(monkeypatch):
    response = _request(_client(monkeypatch))
    assert response.status_code == 403
    assert response.json()["code"] == "CSRF_ORIGIN_REQUIRED"


def test_exact_referer_origin_is_accepted(monkeypatch):
    response = _request(
        _client(monkeypatch),
        referer="https://biddingflow.example/package/1?tab=goods",
    )
    assert response.status_code == 200
