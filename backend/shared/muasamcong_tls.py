"""Verified TLS policy shared by MuaSamCong/VNEPS adapters."""

from __future__ import annotations

import ssl


MUASAMCONG_CIPHERS = (
    "ECDHE+AESGCM:ECDHE+CHACHA20:!DHE:!aNULL:!eNULL:!MD5:!DSS"
)


def create_muasamcong_ssl_context() -> ssl.SSLContext:
    """Create a verified context that avoids the upstream's weak DHE path."""
    context = ssl.create_default_context()
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.set_ciphers(MUASAMCONG_CIPHERS)
    return context


MUASAMCONG_SSL_CONTEXT = create_muasamcong_ssl_context()
