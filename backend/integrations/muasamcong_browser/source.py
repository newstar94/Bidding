"""Stable procurement source backed by a browser runtime adapter."""

from __future__ import annotations

from datetime import datetime, timezone
import time

from backend.integrations.muasamcong_browser.classifier import PayloadClassifier
from backend.integrations.muasamcong_browser.parsers import ParserRegistry
from backend.procurement_import.domain import (
    ProcurementCodeKind,
    normalize_procurement_code,
)
from backend.procurement_lookup.domain import (
    LOOKUP_SCHEMA_VERSION,
    ProcurementLookupError,
)


class MuaSamCongBrowserSource:
    """Lookup through an injected browser runtime and return only stable DTOs."""

    name = "MUASAMCONG_BROWSER"
    parser_version = "2026.1"

    def __init__(
        self,
        *,
        runtime=None,
        launcher=None,
        classifier=None,
        parser_registry=None,
        clock=time.monotonic,
    ):
        if runtime is None and launcher is None:
            raise ProcurementLookupError("PROCUREMENT_BROWSER_FAILED")
        self.runtime = runtime
        self.launcher = launcher
        self.classifier = classifier or PayloadClassifier()
        self.clock = clock
        self.parser_registry = parser_registry or ParserRegistry()

    def lookup(self, code, kind):
        started = self.clock()
        original = str(code or "").strip()
        try:
            normalized = normalize_procurement_code(original)
        except ValueError as error:
            raise ProcurementLookupError("PROCUREMENT_CODE_INVALID") from error
        lookup_kind = str(kind or "").strip().upper()
        expected_kind = (
            "PLAN"
            if normalized.kind is ProcurementCodeKind.PLAN
            else "PACKAGE"
        )
        if lookup_kind != expected_kind:
            raise ProcurementLookupError("PROCUREMENT_CODE_INVALID")
        runtime = self.runtime or self.launcher.get_runtime()
        artifact = runtime.lookup(normalized.base_code, lookup_kind)
        if not isinstance(artifact, dict):
            raise ProcurementLookupError("PROCUREMENT_BROWSER_FAILED")
        classified = self.classifier.classify(
            artifact, code=normalized.base_code, kind=lookup_kind
        )
        parse_started = self.clock()
        parser = self.parser_registry.resolve(lookup_kind)
        data = parser.parse(classified.payload, normalized.base_code)
        normalize_ms = max(0, round((self.clock() - parse_started) * 1000, 3))
        total_ms = max(0, round((self.clock() - started) * 1000, 3))
        metrics = {
            key: value
            for key, value in (artifact.get("metrics") or {}).items()
            if key in {
                "browserStartupMs", "navigationMs", "lookupActionMs",
                "networkWaitMs", "extractMs",
            }
            and isinstance(value, (int, float))
        }
        metrics.update({"normalizeMs": normalize_ms, "totalMs": total_ms})
        return {
            "schemaVersion": LOOKUP_SCHEMA_VERSION,
            "found": True,
            "kind": lookup_kind,
            "inputCode": original,
            "canonicalCode": normalized.base_code,
            "source": {
                "provider": self.name,
                "driver": str(artifact.get("driver") or "unknown"),
                "driverVersion": str(
                    artifact.get("driverVersion") or "unknown"
                ),
                "browserMode": str(
                    artifact.get("browserMode") or "standard"
                ),
                "extractionStrategy": classified.strategy,
                "parserVersion": parser.version,
                "retrievedAt": datetime.now(timezone.utc).isoformat(),
            },
            "data": data,
            "metrics": metrics,
        }
