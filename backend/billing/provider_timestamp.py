"""Strict normalization of authoritative provider transaction timestamps."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import math
import re


_INTEGER_SECONDS = re.compile(r"^[+-]?\d+$")
_MAX_UNIX_SECONDS = 253_402_300_799  # 9999-12-31T23:59:59Z


@dataclass(frozen=True)
class ProviderTransactionTime:
    ok: bool
    unix_seconds: int | None = None
    reason: str | None = None


def _invalid(reason: str) -> ProviderTransactionTime:
    return ProviderTransactionTime(False, reason=reason)


def _unix_seconds(value) -> ProviderTransactionTime:
    if isinstance(value, bool):
        return _invalid("PAYMENT_TIMESTAMP_INVALID")
    if isinstance(value, str) and _INTEGER_SECONDS.fullmatch(value.strip()):
        value = int(value.strip())
    if isinstance(value, float):
        if not math.isfinite(value) or not value.is_integer():
            return _invalid("PAYMENT_TIMESTAMP_INVALID")
        value = int(value)
    if not isinstance(value, int):
        return _invalid("PAYMENT_TIMESTAMP_INVALID")
    if value < 0 or value > _MAX_UNIX_SECONDS:
        return _invalid("PAYMENT_TIMESTAMP_OUT_OF_RANGE")
    return ProviderTransactionTime(True, unix_seconds=value)


def parse_provider_transaction_time(result) -> ProviderTransactionTime:
    """Return a UTC Unix timestamp only for an explicit transaction time.

    ``createdAt`` is intentionally not promoted to a payment occurrence time:
    payOS uses it for payment-link creation. Naive SQL-like values are retained
    for review because the provider contract does not define their timezone.
    """

    payload = result if isinstance(result, dict) else {}
    if "transactionDateTime" not in payload or payload.get("transactionDateTime") in {None, ""}:
        if payload.get("createdAt") not in {None, ""}:
            return _invalid("PAYMENT_OCCURRENCE_TIME_REVIEW_REQUIRED")
        return _invalid("PAYMENT_OCCURRENCE_TIME_MISSING")

    value = payload.get("transactionDateTime")
    if isinstance(value, (int, float)) or (
        isinstance(value, str) and _INTEGER_SECONDS.fullmatch(value.strip())
    ):
        return _unix_seconds(value)
    if not isinstance(value, str):
        return _invalid("PAYMENT_TIMESTAMP_INVALID")

    text = value.strip()
    try:
        parsed = datetime.fromisoformat(text[:-1] + "+00:00" if text.endswith(("Z", "z")) else text)
    except ValueError:
        return _invalid("PAYMENT_TIMESTAMP_INVALID")
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return _invalid("PAYMENT_TIMESTAMP_TIMEZONE_REQUIRED")
    try:
        seconds = int(parsed.astimezone(timezone.utc).timestamp())
    except (OverflowError, OSError, ValueError):
        return _invalid("PAYMENT_TIMESTAMP_OUT_OF_RANGE")
    return _unix_seconds(seconds)
