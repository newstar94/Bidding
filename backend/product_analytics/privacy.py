"""Pseudonymous identifiers for aggregate analytics."""

from __future__ import annotations

import hashlib
import hmac


def analytics_identifier(namespace: str, identifier: str, key: str) -> str:
    secret = str(key or "").encode("utf-8")
    value = str(identifier or "").strip()
    scope = str(namespace or "").strip().lower()
    if len(secret) < 16 or not value or scope not in {"user", "workspace"}:
        raise ValueError("Analytics HMAC configuration or identifier is invalid.")
    return hmac.new(secret, f"{scope}:{value}".encode(), hashlib.sha256).hexdigest()

