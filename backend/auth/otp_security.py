"""HMAC protection for short-lived registration verification codes."""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets


_DEVELOPMENT_PROCESS_KEY = secrets.token_bytes(32)
_PREFIX = "hmac-sha256$"


def _key(environ=None):
    environ = os.environ if environ is None else environ
    configured = str(environ.get("OTP_HMAC_KEY") or "").encode("utf-8")
    return configured if configured else _DEVELOPMENT_PROCESS_KEY


def validate_otp_hmac_configuration(environ=None, *, required=False):
    environ = os.environ if environ is None else environ
    configured = str(environ.get("OTP_HMAC_KEY") or "").encode("utf-8")
    if required and len(configured) < 32:
        raise ValueError("OTP_HMAC_KEY must contain at least 32 bytes in production.")
    return bool(configured)


def hash_registration_otp(code, user_id, *, environ=None):
    message = f"registration-email\0{user_id}\0{code}".encode("utf-8")
    digest = hmac.new(_key(environ), message, hashlib.sha256).hexdigest()
    return _PREFIX + digest


def verify_registration_otp(stored, code, user_id, *, environ=None):
    expected = hash_registration_otp(code, user_id, environ=environ)
    candidate = str(stored or "")
    return candidate.startswith(_PREFIX) and hmac.compare_digest(candidate, expected)
