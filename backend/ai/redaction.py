"""Bounded redaction for AI audit payloads."""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any


_SECRET_KEY = re.compile(
    r"(?i)(token|cookie|authorization|password|otp|secret|api[_-]?key|database[_-]?url|credential)"
)
_EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def redact_value(value: Any, *, max_length: int = 2000) -> Any:
    if isinstance(value, dict):
        return {
            str(key): "[REDACTED]" if _SECRET_KEY.search(str(key)) else redact_value(item, max_length=max_length)
            for key, item in list(value.items())[:40]
        }
    if isinstance(value, list):
        return [redact_value(item, max_length=max_length) for item in value[:40]]
    if isinstance(value, str):
        if _EMAIL.fullmatch(value.strip()):
            return "[REDACTED_EMAIL]"
        return value[:max_length]
    return value


def redact_json(value: Any, *, max_length: int = 4000) -> str:
    payload = json.dumps(redact_value(value), ensure_ascii=False, separators=(",", ":"), default=str)
    return payload[:max_length]


def scope_hash(context: Any) -> str:
    payload = context.permission_hash_payload()
    return hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()[:24]
