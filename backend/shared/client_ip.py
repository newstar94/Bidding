"""Resolve client IPs without trusting attacker-controlled proxy headers."""

import ipaddress
import os


def _trusted_proxy_networks():
    raw_value = os.environ.get("TRUSTED_PROXY_CIDRS", "")
    networks = []
    for raw_item in raw_value.split(","):
        item = raw_item.strip()
        if not item:
            continue
        try:
            networks.append(ipaddress.ip_network(item, strict=False))
        except ValueError:
            continue
    return tuple(networks)


def _parse_ip(value):
    try:
        return ipaddress.ip_address(str(value or "").strip())
    except ValueError:
        return None


def _is_trusted_proxy(address, networks):
    parsed = _parse_ip(address)
    return parsed is not None and any(parsed in network for network in networks)


def get_client_ip(request):
    """Return the first untrusted hop, starting from the socket peer.

    Forwarded headers are ignored unless the direct socket peer belongs to a
    configured trusted proxy CIDR. Malformed chains fail closed to the peer IP.
    """
    peer = str(getattr(getattr(request, "client", None), "host", "unknown") or "unknown")
    networks = _trusted_proxy_networks()
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
