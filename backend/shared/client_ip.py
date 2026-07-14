"""Resolve client IPs without trusting attacker-controlled proxy headers."""

import ipaddress
import os


def parse_ip_networks(raw_value, *, allow_wildcard=False):
    networks = []
    for raw_item in str(raw_value or "").split(","):
        item = raw_item.strip()
        if not item:
            continue
        if item == "*" and allow_wildcard:
            return ("*",)
        networks.append(ipaddress.ip_network(item, strict=False))
    return tuple(networks)


def trusted_proxy_networks():
    return parse_ip_networks(os.environ.get("TRUSTED_PROXY_CIDRS", ""))


def _parse_ip(value):
    try:
        return ipaddress.ip_address(str(value or "").strip())
    except ValueError:
        return None


def _is_trusted_proxy(address, networks):
    parsed = _parse_ip(address)
    return parsed is not None and any(parsed in network for network in networks)


def is_client_ip_allowed(address, raw_allowlist=None):
    raw_value = raw_allowlist if raw_allowlist is not None else os.environ.get(
        "SUPER_ADMIN_IP_ALLOWLIST",
        "127.0.0.1/32,::1/128",
    )
    try:
        networks = parse_ip_networks(raw_value, allow_wildcard=True)
    except ValueError:
        return False
    if networks == ("*",):
        return True
    return _is_trusted_proxy(address, networks)


def is_trusted_proxy_peer(request):
    peer = str(getattr(getattr(request, "client", None), "host", "unknown") or "unknown")
    try:
        return _is_trusted_proxy(peer, trusted_proxy_networks())
    except ValueError:
        return False


def is_request_secure(request):
    if str(getattr(getattr(request, "url", None), "scheme", "")).lower() == "https":
        return True
    if not is_trusted_proxy_peer(request):
        return False
    return request.headers.get("X-Forwarded-Proto", "").strip().lower() == "https"


def get_client_ip(request):
    """Return the first untrusted hop, starting from the socket peer.

    Forwarded headers are ignored unless the direct socket peer belongs to a
    configured trusted proxy CIDR. Malformed chains fail closed to the peer IP.
    """
    peer = str(getattr(getattr(request, "client", None), "host", "unknown") or "unknown")
    try:
        networks = trusted_proxy_networks()
    except ValueError:
        return peer
    if not networks or not _is_trusted_proxy(peer, networks):
        return peer

    forwarded = request.headers.get("X-Forwarded-For", "")
    if not forwarded:
        return peer
    hops = [item.strip() for item in forwarded.split(",") if item.strip()]
    parsed_hops = [_parse_ip(item) for item in hops]
    if not parsed_hops or any(item is None for item in parsed_hops):
        return peer

    for parsed_hop in reversed(parsed_hops):
        if not any(parsed_hop in network for network in networks):
            return str(parsed_hop)
    return str(parsed_hops[0])
