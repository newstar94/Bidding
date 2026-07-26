"""Canonical identity for sync mutation envelopes."""

from __future__ import annotations

import hashlib
import json


def sync_request_hash(payload) -> str:
    """Hash the semantic request body, excluding the idempotency key itself."""

    normalized = dict(payload) if isinstance(payload, dict) else {}
    normalized.pop("clientMutationId", None)
    canonical = json.dumps(
        normalized,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def request_hash_matches(stored_hash, current_hash: str) -> bool:
    """Legacy rows without a hash remain replayable during compatibility."""

    stored = str(stored_hash or "").strip().lower()
    if not stored:
        return True
    return stored == str(current_hash or "").strip().lower()
