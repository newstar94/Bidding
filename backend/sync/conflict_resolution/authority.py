"""Signed, actor-bound preview authority for conflict decisions."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time


class AuthorityError(ValueError):
    pass


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _key(environ=None) -> bytes:
    environment = os.environ if environ is None else environ
    value = str(environment.get("CONFLICT_RESOLUTION_SIGNING_KEY") or "").encode("utf-8")
    if len(value) < 32:
        raise RuntimeError("CONFLICT_RESOLUTION_SIGNING_KEY must contain at least 32 bytes.")
    return value


def canonical_digest(value) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def issue_authority(claims: dict, *, ttl_seconds=900, now=None, environ=None) -> str:
    issued_at = int(time.time() if now is None else now)
    payload = {**claims, "iat": issued_at, "exp": issued_at + int(ttl_seconds), "v": 1}
    encoded = _b64encode(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8"))
    signature = _b64encode(hmac.new(_key(environ), encoded.encode("ascii"), hashlib.sha256).digest())
    return f"{encoded}.{signature}"


def verify_authority(token: str, expected: dict, *, now=None, environ=None) -> dict:
    try:
        encoded, supplied = str(token or "").split(".", 1)
        expected_signature = _b64encode(
            hmac.new(_key(environ), encoded.encode("ascii"), hashlib.sha256).digest()
        )
        if not hmac.compare_digest(supplied, expected_signature):
            raise AuthorityError("INVALID_AUTHORITY")
        payload = json.loads(_b64decode(encoded))
    except (ValueError, TypeError, json.JSONDecodeError, UnicodeDecodeError) as error:
        if isinstance(error, AuthorityError):
            raise
        raise AuthorityError("INVALID_AUTHORITY") from error
    current = int(time.time() if now is None else now)
    if int(payload.get("exp") or 0) < current:
        raise AuthorityError("EXPIRED_AUTHORITY")
    for key, value in expected.items():
        if payload.get(key) != value:
            raise AuthorityError("AUTHORITY_SCOPE_MISMATCH")
    return payload
