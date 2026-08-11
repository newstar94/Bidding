"""Bounded diagnostic artifacts that cannot persist session secrets."""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import re
from uuid import uuid4


_SECRET_KEYS = re.compile(
    r"token|cookie|authorization|session|recaptcha|secret|password",
    re.I,
)


def sanitized_shape(value, *, depth=0, max_depth=8, max_items=200):
    """Keep keys and value types while discarding values and known secrets."""

    if depth > max_depth:
        return "<depth-limit>"
    if isinstance(value, dict):
        result = {}
        for key, item in list(value.items())[:max_items]:
            text_key = str(key)[:128]
            result[text_key] = (
                "<redacted>"
                if _SECRET_KEYS.search(text_key)
                else sanitized_shape(
                    item,
                    depth=depth + 1,
                    max_depth=max_depth,
                    max_items=max_items,
                )
            )
        return result
    if isinstance(value, list):
        return {
            "type": "array",
            "length": len(value),
            "items": [
                sanitized_shape(
                    item,
                    depth=depth + 1,
                    max_depth=max_depth,
                    max_items=max_items,
                )
                for item in value[: min(3, max_items)]
            ],
        }
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    return "string"


class DiagnosticRecorder:
    def __init__(self, root, *, enabled=False, clock=None):
        self.root = Path(root)
        self.enabled = bool(enabled)
        self.clock = clock or (lambda: datetime.now(timezone.utc))

    def record(
        self,
        *,
        kind,
        code,
        operation,
        fingerprint,
        strategy,
        error_code,
        raw,
    ):
        if not self.enabled:
            return None
        now = self.clock()
        safe_kind = re.sub(r"[^A-Z0-9_-]", "_", str(kind).upper())[:32]
        safe_code = re.sub(r"[^A-Z0-9_-]", "_", str(code).upper())[:32]
        directory = self.root / now.date().isoformat() / f"{safe_kind}_{safe_code}"
        directory.mkdir(parents=True, exist_ok=True)
        target = directory / f"{now.strftime('%H%M%S')}-{uuid4().hex}.json"
        artifact = {
            "recordedAt": now.isoformat(),
            "kind": safe_kind,
            "code": safe_code,
            "operation": str(operation or "unknown")[:128],
            "schemaFingerprint": str(fingerprint or "unknown")[:256],
            "extractionStrategy": str(strategy or "unknown")[:64],
            "errorCode": str(error_code or "PROCUREMENT_SCHEMA_CHANGED")[:128],
            "shape": sanitized_shape(raw),
        }
        temporary = target.with_suffix(".tmp")
        temporary.write_text(
            json.dumps(artifact, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        temporary.replace(target)
        return target

