"""Bounded redaction for AI audit payloads."""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any


_SECRET_KEY = re.compile(
    r"(?i)(token|cookie|authorization|password|otp|secret|api[_-]?key|database[_-]?url|credential)"
)
_EMAIL = re.compile(r"(?i)\b[^\s@]+@[^\s@]+\.[^\s@]+\b")
_BEARER = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+")
_JWT = re.compile(r"\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b")
_URL_SECRET = re.compile(r"(?i)([?&](?:token|secret|password|apikey|api_key|access_token|refresh_token)=)[^&#\s]+")
_CREDENTIAL = re.compile(r"(?i)\b([A-Za-z0-9._-]{1,64}):([^\s:@]{4,})@")
_PHONE = re.compile(r"(?<!\w)(?:\+\d{1,3}[ .-]?(?:\d[ .-]?){7,12}\d|0\d{9,10})(?!\w)")
_INLINE_SECRET = re.compile(
    r"(?i)\b(authorization|cookie|session(?:id|_id)?|access[_-]?token|refresh[_-]?token|api[_-]?key|secret|password)\s*[:=]\s*([^\s,;]+)"
)
_PREFIXED_SECRET = re.compile(
    r"\b(?:sk|pk|rk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b",
    re.IGNORECASE,
)


def _redact_text(value: str) -> str:
    value = _BEARER.sub("[REDACTED_BEARER]", value)
    value = _JWT.sub("[REDACTED_JWT]", value)
    value = _URL_SECRET.sub(r"\1[REDACTED]", value)
    value = _CREDENTIAL.sub(r"[REDACTED_CREDENTIAL]@", value)
    value = _INLINE_SECRET.sub(r"\1=[REDACTED]", value)
    value = _PREFIXED_SECRET.sub("[REDACTED_SECRET]", value)
    value = _EMAIL.sub("[REDACTED_EMAIL]", value)
    return _PHONE.sub("[REDACTED_PHONE]", value)


def redact_value(value: Any, *, max_length: int = 2000) -> Any:
    if isinstance(value, dict):
        return {
            str(key): "[REDACTED]" if _SECRET_KEY.search(str(key)) else redact_value(item, max_length=max_length)
            for key, item in list(value.items())[:40]
        }
    if isinstance(value, list):
        return [redact_value(item, max_length=max_length) for item in value[:40]]
    if isinstance(value, str):
        return _redact_text(value)[:max_length]
    return value


def redact_json(value: Any, *, max_length: int = 4000) -> str:
    payload = json.dumps(redact_value(value), ensure_ascii=False, separators=(",", ":"), default=str)
    return payload[:max_length]


def scope_hash(context: Any) -> str:
    payload = context.permission_hash_payload()
    return hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()[:24]
