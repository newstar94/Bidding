"""Fail-closed helpers for fixed, allowlisted HTTPS upstreams."""

from __future__ import annotations

import ipaddress
import socket
import ssl
import urllib.request
from collections.abc import Collection
from urllib.parse import urlsplit


class UnsafeOutboundUrl(ValueError):
    """Raised when an outbound URL can reach outside its approved boundary."""


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _validate_public_dns(hostname: str) -> None:
    try:
        addresses = {
            item[4][0]
            for item in socket.getaddrinfo(
                hostname,
                443,
                type=socket.SOCK_STREAM,
            )
        }
    except socket.gaierror as exc:
        raise UnsafeOutboundUrl("Approved upstream DNS resolution failed.") from exc
    if not addresses:
        raise UnsafeOutboundUrl("Approved upstream has no network address.")
    for raw_address in addresses:
        address = ipaddress.ip_address(raw_address)
        if not address.is_global:
            raise UnsafeOutboundUrl(
                "Approved upstream resolved to a non-public network address."
            )


def open_allowlisted_https(
    request: urllib.request.Request,
    *,
    allowed_hosts: Collection[str],
    timeout: float,
    context: ssl.SSLContext | None = None,
):
    """Open one fixed HTTPS request without redirects or environment proxies."""

    parsed = urlsplit(request.full_url)
    approved = {str(host).strip().casefold() for host in allowed_hosts}
    hostname = (parsed.hostname or "").casefold()
    if (
        parsed.scheme.casefold() != "https"
        or not hostname
        or hostname not in approved
        or parsed.username is not None
        or parsed.password is not None
        or parsed.port not in {None, 443}
        or parsed.fragment
    ):
        raise UnsafeOutboundUrl("Outbound URL is outside the HTTPS allowlist.")
    _validate_public_dns(hostname)
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}),
        urllib.request.HTTPSHandler(context=context or ssl.create_default_context()),
        _NoRedirectHandler(),
    )
    return opener.open(request, timeout=timeout)
