"""Canonical outbound URL policy for AI provider transports."""

from __future__ import annotations

import urllib.parse
import urllib.request


class OutboundUrlPolicyError(ValueError):
    """Raised when an AI endpoint violates the outbound network policy."""


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        del req, fp, code, msg, headers, newurl
        return None


def open_outbound_request(
    request: urllib.request.Request,
    *,
    timeout: int,
    proxy_url: str = "",
):
    """Open one request without ambient proxies or automatic redirects."""

    proxies = {"http": proxy_url, "https": proxy_url} if proxy_url else {}
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler(proxies),
        _NoRedirectHandler(),
    )
    return opener.open(request, timeout=timeout)


def validate_outbound_url(
    url: str,
    *,
    allowed_hosts: tuple[str, ...] = (),
    label: str = "AI provider",
) -> str:
    """Return a normalized hosted-provider URL after enforcing HTTPS and host policy."""

    value = str(url or "").strip()
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme.casefold() != "https":
        raise OutboundUrlPolicyError(f"{label} URL must use HTTPS.")
    if parsed.username is not None or parsed.password is not None:
        raise OutboundUrlPolicyError(f"{label} URL must not contain userinfo.")
    try:
        port = parsed.port
    except ValueError as exc:
        raise OutboundUrlPolicyError(f"{label} URL contains an invalid port.") from exc
    if port not in {None, 443}:
        raise OutboundUrlPolicyError(f"{label} URL must use the default HTTPS port.")
    hostname = (parsed.hostname or "").casefold().rstrip(".")
    allowed = {str(host or "").strip().casefold().rstrip(".") for host in allowed_hosts}
    if not hostname or hostname not in allowed:
        raise OutboundUrlPolicyError(f"{label} host is not in the configured allowlist.")
    return value.rstrip("/")


def validate_loopback_url(url: str, *, label: str = "AI provider") -> str:
    """Allow an explicit HTTP(S) exception only for local loopback providers."""

    value = str(url or "").strip()
    parsed = urllib.parse.urlsplit(value)
    hostname = (parsed.hostname or "").casefold().rstrip(".")
    if parsed.scheme.casefold() not in {"http", "https"} or hostname not in {
        "127.0.0.1",
        "::1",
        "localhost",
    }:
        raise OutboundUrlPolicyError(f"{label} URL must use an HTTP(S) loopback host.")
    if parsed.username is not None or parsed.password is not None:
        raise OutboundUrlPolicyError(f"{label} URL must not contain userinfo.")
    try:
        parsed.port
    except ValueError as exc:
        raise OutboundUrlPolicyError(f"{label} URL contains an invalid port.") from exc
    return value.rstrip("/")


__all__ = [
    "OutboundUrlPolicyError",
    "open_outbound_request",
    "validate_loopback_url",
    "validate_outbound_url",
]
