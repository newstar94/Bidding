"""Unified Mua Sắm Công source for lookup, version import, and opening data."""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from copy import deepcopy
import os
from pathlib import Path
import re
from threading import RLock
import time

from backend.integrations.muasamcong_browser.canonical import (
    ImportParserRegistry,
)
from backend.integrations.muasamcong_browser.classifier import (
    classify_upstream_error,
)
from backend.integrations.muasamcong_browser.launchers import NodeBrowserRuntime
from backend.integrations.muasamcong_browser.diagnostics import DiagnosticRecorder
from backend.integrations.muasamcong_browser.source import MuaSamCongBrowserSource
from backend.procurement_import.source import ProcurementSourceError
from backend.procurement_lookup.domain import ProcurementLookupError


_PLAN_PATTERN = re.compile(r"^PL\d{10}$", re.I)
_NOTICE_PATTERN = re.compile(r"^IB\d{10}$", re.I)
_ALLOWED_ERRORS = {
    "PROCUREMENT_NOT_FOUND",
    "PROCUREMENT_REVISION_INVALID",
    "PROCUREMENT_SCHEMA_CHANGED",
    "PROCUREMENT_SESSION_FAILED",
    "PROCUREMENT_ENDPOINT_CHANGED",
    "PROCUREMENT_UPSTREAM_UNAVAILABLE",
    "PROCUREMENT_TIMEOUT",
    "PROCUREMENT_LOOKUP_TIMEOUT",
    "PROCUREMENT_LOOKUP_BUSY",
    "PROCUREMENT_BROWSER_FAILED",
    "PROCUREMENT_ADAPTER_UNSUPPORTED",
}


def _bounded_int(name, default, minimum, maximum):
    try:
        value = int(os.environ.get(name, default))
    except (TypeError, ValueError):
        value = default
    return min(maximum, max(minimum, value))


def _boolean(name, default):
    return str(os.environ.get(name, default)).strip().casefold() == "true"


def _canonical_code(value, pattern):
    code = str(value or "").strip().upper()
    if not pattern.fullmatch(code):
        raise ProcurementSourceError("PROCUREMENT_CODE_INVALID")
    return code


class MuaSamCongProcurementSource:
    """Adapter keeping every upstream detail outside Bidding domain code."""

    name = "MUASAMCONG"
    schema_version = "biddingflow-muasamcong-source-v1"
    parser_version = "2026.08"

    def __init__(
        self,
        runtime,
        *,
        diagnostics=None,
        browser_fallback=None,
        shadow_parser_enabled=False,
        observer=None,
        clock=time.monotonic,
    ):
        self.runtime = runtime
        self._plan_revisions = {}
        self._notice_revisions = {}
        self._lock = RLock()
        self.parser_registry = ImportParserRegistry(
            shadow_enabled=shadow_parser_enabled
        )
        self.diagnostics = diagnostics or DiagnosticRecorder(".", enabled=False)
        self.browser_fallback = browser_fallback or MuaSamCongBrowserSource(
            runtime=runtime
        )
        self.observer = observer
        self.clock = clock
        self._lookup_request_id = ContextVar(
            f"muasamcong_lookup_request_id_{id(self)}", default=""
        )

    @contextmanager
    def lookup_request_context(self, request_id):
        """Correlate nested source operations without cross-thread leakage."""

        token = self._lookup_request_id.set(str(request_id or ""))
        try:
            yield
        finally:
            self._lookup_request_id.reset(token)

    @classmethod
    def from_environ(cls, *, observer=None):
        configuration = {
            "headless": _boolean("MUASAMCONG_BROWSER_HEADLESS", "true"),
            "browserMode": "standard",
            "targetHost": "muasamcong.mpi.gov.vn",
            "chromiumArgs": [],
            "drivers": {
                "vue2": _boolean("MUASAMCONG_DRIVER_VUE2", "true"),
                "generic": _boolean("MUASAMCONG_DRIVER_GENERIC", "true"),
            },
            "extractors": {
                "network": _boolean("MUASAMCONG_EXTRACT_NETWORK", "true"),
                "vue": _boolean("MUASAMCONG_EXTRACT_VUE", "true"),
                "vue3": _boolean("MUASAMCONG_EXTRACT_VUE3", "true"),
                "react": _boolean("MUASAMCONG_EXTRACT_REACT", "true"),
                "dom": _boolean("MUASAMCONG_EXTRACT_DOM", "true"),
            },
            "browserExecutablePath": os.environ.get(
                "MUASAMCONG_BROWSER_EXECUTABLE_PATH", ""
            ).strip(),
            "endpointProfile": os.environ.get(
                "MUASAMCONG_ENDPOINT_PROFILE", "2026.08"
            ).strip(),
            "sessionTtlMs": _bounded_int(
                "MUASAMCONG_SESSION_TTL_SECONDS", 1800, 60, 3600
            )
            * 1000,
            "sessionTimeoutMs": _bounded_int(
                "MUASAMCONG_SESSION_TIMEOUT_SECONDS", 55, 20, 60
            )
            * 1000,
            "apiTimeoutMs": _bounded_int(
                "MUASAMCONG_API_TIMEOUT_SECONDS", 15, 2, 30
            )
            * 1000,
            "apiRetries": _bounded_int("MUASAMCONG_API_RETRIES", 1, 0, 2),
            "apiCircuitMs": _bounded_int(
                "MUASAMCONG_CIRCUIT_SECONDS", 30, 1, 300
            )
            * 1000,
            "apiMaxConcurrency": _bounded_int(
                "MUASAMCONG_MAX_CONCURRENCY", 6, 1, 16
            ),
            "apiQueueTimeoutMs": _bounded_int(
                "MUASAMCONG_API_QUEUE_TIMEOUT_MS", 5000, 100, 30000
            ),
            "workerResponseTimeoutMs": _bounded_int(
                "MUASAMCONG_WORKER_TIMEOUT_SECONDS", 60, 20, 60
            )
            * 1000,
            "workerQueueTimeoutMs": _bounded_int(
                "MUASAMCONG_WORKER_QUEUE_TIMEOUT_MS", 1000, 10, 5000
            ),
            "maxResponseBytes": _bounded_int(
                "MUASAMCONG_MAX_RESPONSE_BYTES", 4_194_304, 65_536, 8_388_608
            ),
            "navigationTimeoutMs": _bounded_int(
                "MUASAMCONG_NAVIGATION_TIMEOUT_MS", 20_000, 5_000, 60_000
            ),
            "actionTimeoutMs": _bounded_int(
                "MUASAMCONG_ACTION_TIMEOUT_MS", 15_000, 5_000, 60_000
            ),
        }
        shadow_parser_enabled = _boolean(
            "MUASAMCONG_SHADOW_PARSER_ENABLED", "false"
        )
        diagnostics = DiagnosticRecorder(
            Path(
                os.environ.get(
                    "MUASAMCONG_DIAGNOSTICS_DIR",
                    "data/procurement-diagnostics",
                )
            ),
            enabled=(
                _boolean("MUASAMCONG_DIAGNOSTICS_ENABLED", "false")
                or shadow_parser_enabled
            ),
        )
        return cls(
            NodeBrowserRuntime(configuration),
            diagnostics=diagnostics,
            shadow_parser_enabled=shadow_parser_enabled,
            observer=observer,
        )

    def _parse(self, result, *, kind, code, raw, **kwargs):
        started = self.clock()
        try:
            canonical = self.parser_registry.parse(
                result.get("fingerprint"),
                raw,
                shadow_observer=lambda event: self.diagnostics.record(
                    kind=kind,
                    code=code,
                    operation=(result.get("metadata") or {}).get("operation"),
                    fingerprint=result.get("fingerprint"),
                    strategy="shadow-parser",
                    error_code=(
                        "PROCUREMENT_SHADOW_PARSER_DIFF"
                        if event.get("status") == "DIFF"
                        else "PROCUREMENT_SHADOW_PARSER_FAILED"
                    ),
                    raw=raw,
                ),
                **kwargs,
            )
            metadata = result.setdefault("metadata", {})
            metadata["normalizeMs"] = round(
                max(0, self.clock() - started) * 1000,
                3,
            )
            if isinstance(canonical.get("source"), dict):
                canonical["source"] = self._source_metadata(result)
            return canonical
        except ProcurementSourceError as error:
            source = self._source_metadata(result)
            self.diagnostics.record(
                kind=kind,
                code=code,
                operation=source.get("semanticOperation"),
                fingerprint=source.get("schemaFingerprint"),
                strategy=source.get("extractionStrategy"),
                error_code=str(error),
                raw=raw,
            )
            raise

    @staticmethod
    def _source_metadata(result):
        metadata = result.get("metadata") or {}
        metrics = {
            key: value
            for key, value in metadata.items()
            if key in {
                "totalMs",
                "browserStartupMs",
                "sessionAcquireMs",
                "sessionCacheHit",
                "networkWaitMs",
                "normalizeMs",
                "retries",
                "sessionRefreshCount",
            }
            and isinstance(value, (int, float))
        }
        return {
            "provider": "MUASAMCONG",
            "profile": str(metadata.get("profile") or "2026.08"),
            "parserVersion": "2026.08",
            "schemaFingerprint": result.get("fingerprint"),
            "extractionStrategy": "protected-api",
            "retrievedAt": result.get("retrievedAt"),
            "semanticOperation": metadata.get("operation"),
            "metrics": metrics,
            "classification": str(classify_upstream_error()),
        }

    def _observe(self, kind, result, canonical=None):
        if not callable(self.observer):
            return
        source = (
            canonical.get("source")
            if isinstance(canonical, dict)
            and isinstance(canonical.get("source"), dict)
            else self._source_metadata(result)
        )
        metrics = source.get("metrics") or {}
        event = {
            "provider": self.name,
            "lookupRequestId": self._lookup_request_id.get(),
            "kind": str(kind or "UNKNOWN")[:32],
            "semanticOperation": str(
                source.get("semanticOperation") or "UNKNOWN"
            )[:64],
            "totalMs": metrics.get("totalMs", 0),
            "browserStartupMs": metrics.get("browserStartupMs", 0),
            "sessionAcquireMs": metrics.get("sessionAcquireMs", 0),
            "sessionCacheHit": bool(metrics.get("sessionCacheHit", False)),
            "navigationMs": metrics.get("navigationMs", 0),
            "networkWaitMs": metrics.get("networkWaitMs", 0),
            "extractMs": metrics.get("extractMs", 0),
            "normalizeMs": metrics.get("normalizeMs", 0),
            "parserVersion": source.get("parserVersion") or self.parser_version,
            "schemaFingerprint": source.get("schemaFingerprint") or "unknown",
            "extractionStrategy": source.get("extractionStrategy") or "unknown",
            "retries": metrics.get("retries", 0),
            "sessionRefreshCount": metrics.get("sessionRefreshCount", 0),
            "classification": (
                canonical.get("classification")
                if isinstance(canonical, dict)
                else source.get("classification")
            ) or str(classify_upstream_error()),
        }
        try:
            self.observer(event)
        except Exception:  # noqa: BLE001 - telemetry cannot break imports.
            return

    @staticmethod
    def _call(callback, *args, **kwargs):
        try:
            result = callback(*args, **kwargs)
        except Exception as error:  # noqa: BLE001 - process boundary normalization.
            code = str(error)
            if code not in _ALLOWED_ERRORS:
                code = "PROCUREMENT_UPSTREAM_UNAVAILABLE"
            raise ProcurementSourceError(code) from error
        if not isinstance(result, dict):
            raise ProcurementSourceError("PROCUREMENT_SCHEMA_CHANGED")
        return result

    def list_plan_revisions(self, family_no: str) -> list[dict]:
        family_no = _canonical_code(family_no, _PLAN_PATTERN)
        result = self._call(self.runtime.list_plan_revisions, family_no)
        rows = result.get("revisions")
        if not isinstance(rows, list):
            raise ProcurementSourceError("PROCUREMENT_SCHEMA_CHANGED")
        normalized = []
        for row in rows:
            if not isinstance(row, dict) or not row.get("revisionId"):
                continue
            item = {
                "familyNo": family_no,
                "revisionId": str(row["revisionId"]),
                "revisionNumber": str(row.get("revisionNumber") or "").zfill(2),
            }
            normalized.append(item)
        with self._lock:
            self._plan_revisions[family_no] = {
                row["revisionId"]: row for row in normalized
            }
        return deepcopy(normalized)

    def _plan_revision_hint(self, family_no, revision_id):
        with self._lock:
            hint = (self._plan_revisions.get(family_no) or {}).get(str(revision_id))
        if hint is None:
            self.list_plan_revisions(family_no)
            with self._lock:
                hint = (self._plan_revisions.get(family_no) or {}).get(
                    str(revision_id)
                )
        if hint is None:
            raise ProcurementSourceError("PROCUREMENT_REVISION_INVALID")
        return hint

    def get_plan_revision(self, family_no: str, revision_id: str) -> dict:
        family_no = _canonical_code(family_no, _PLAN_PATTERN)
        hint = self._plan_revision_hint(family_no, revision_id)
        result = self._call(
            self.runtime.get_plan_revision, family_no, str(revision_id)
        )
        raw = result.get("raw")
        if not isinstance(raw, dict):
            raise ProcurementSourceError("PROCUREMENT_SCHEMA_CHANGED")
        canonical = self._parse(
            result,
            kind="PLAN",
            code=family_no,
            raw=raw,
            family_no=family_no,
            revision_id=str(revision_id),
            revision_number=hint["revisionNumber"],
            source=self._source_metadata(result),
        )
        self._observe("PLAN", result, canonical)
        return canonical

    def list_notice_revisions(self, notice_no: str) -> list[dict]:
        notice_no = _canonical_code(notice_no, _NOTICE_PATTERN)
        result = self._call(self.runtime.list_notice_revisions, notice_no)
        rows = result.get("revisions")
        if not isinstance(rows, list):
            raise ProcurementSourceError("PROCUREMENT_SCHEMA_CHANGED")
        normalized = []
        for row in rows:
            if not isinstance(row, dict) or not row.get("revisionId"):
                continue
            normalized.append(
                {
                    "noticeNo": notice_no,
                    "revisionId": str(row["revisionId"]),
                    "revisionNumber": str(row.get("revisionNumber") or "").zfill(2),
                    "processApply": str(row.get("processApply") or ""),
                }
            )
        with self._lock:
            self._notice_revisions[notice_no] = {
                row["revisionId"]: row for row in normalized
            }
        return deepcopy(normalized)

    def _notice_revision_hint(self, notice_no, revision_id):
        with self._lock:
            hint = (self._notice_revisions.get(notice_no) or {}).get(
                str(revision_id)
            )
        if hint is None:
            self.list_notice_revisions(notice_no)
            with self._lock:
                hint = (self._notice_revisions.get(notice_no) or {}).get(
                    str(revision_id)
                )
        if hint is None:
            raise ProcurementSourceError("PROCUREMENT_REVISION_INVALID")
        return hint

    def get_notice_revision(self, notice_no: str, revision_id: str) -> dict:
        notice_no = _canonical_code(notice_no, _NOTICE_PATTERN)
        hint = self._notice_revision_hint(notice_no, revision_id)
        result = self._call(
            self.runtime.get_notice_revision, notice_no, str(revision_id)
        )
        raw = result.get("raw")
        if not isinstance(raw, dict):
            raise ProcurementSourceError("PROCUREMENT_SCHEMA_CHANGED")
        canonical = self._parse(
            result,
            kind="PACKAGE",
            code=notice_no,
            raw=raw,
            notice_no=notice_no,
            revision_id=str(revision_id),
            revision_number=hint["revisionNumber"],
            source=self._source_metadata(result),
        )
        self._observe("NOTICE", result, canonical)
        return canonical

    def resolve_notice_package(
        self, notice_no: str, revision_id: str
    ) -> dict | None:
        notice = self.get_notice_revision(notice_no, revision_id)
        if not notice.get("planNo"):
            return None
        return {
            "planNo": notice["planNo"],
            "planDetailRevisionId": notice.get("planDetailRevisionId"),
            "stablePackageId": notice.get("stablePackageId"),
            "symbol": notice.get("symbol"),
        }

    def get_opening_bundle(self, notice_no: str, revision_id: str) -> dict:
        notice_no = _canonical_code(notice_no, _NOTICE_PATTERN)
        self._notice_revision_hint(notice_no, revision_id)
        result = self._call(
            self.runtime.get_opening_bundle, notice_no, str(revision_id)
        )
        raw = result.get("raw")
        if not isinstance(raw, dict):
            raise ProcurementSourceError("PROCUREMENT_SCHEMA_CHANGED")
        canonical = self._parse(
            result,
            kind="OPENING",
            code=notice_no,
            raw=raw,
            notice_no=notice_no,
            revision_id=str(revision_id),
        )
        canonical.update(
            {
                "schemaVersion": "biddingflow-opening-bundle-v1",
                "processApply": result.get("processApply"),
                "bidMode": result.get("bidMode"),
                "partial": bool(result.get("failures")),
                "failedOperations": deepcopy(result.get("failures") or []),
                "classification": str(
                    classify_upstream_error(
                        partial=bool(result.get("failures"))
                    )
                ),
                "source": self._source_metadata(result),
            }
        )
        self._observe("OPENING", result, canonical)
        return canonical

    def get_result_bundle(self, notice_no: str, revision_id: str) -> dict:
        notice_no = _canonical_code(notice_no, _NOTICE_PATTERN)
        self._notice_revision_hint(notice_no, revision_id)
        result = self._call(
            self.runtime.get_result_bundle, notice_no, str(revision_id)
        )
        raw = result.get("raw")
        if not isinstance(raw, dict):
            raise ProcurementSourceError("PROCUREMENT_SCHEMA_CHANGED")
        canonical = self._parse(
            result,
            kind="RESULT",
            code=notice_no,
            raw=raw,
            notice_no=notice_no,
            revision_id=str(revision_id),
        )
        canonical.update(
            {
                "schemaVersion": "biddingflow-result-bundle-v1",
                "partial": bool(result.get("failures")),
                "failedOperations": deepcopy(result.get("failures") or []),
                "classification": str(
                    classify_upstream_error(
                        partial=bool(result.get("failures"))
                    )
                ),
                "source": self._source_metadata(result),
            }
        )
        self._observe("RESULT", result, canonical)
        return canonical

    def collect_complete_bundle(
        self,
        record: dict,
        *,
        revision_mode="ALL",
        revision_numbers=None,
        search_source=None,
    ) -> dict:
        if not isinstance(record, dict):
            raise ProcurementSourceError("PROCUREMENT_CODE_INVALID")
        options_are_default = (
            str(revision_mode or "ALL").upper() == "ALL"
            and not revision_numbers
            and search_source is None
        )
        if options_are_default:
            result = self._call(
                self.runtime.collect_complete_bundle, deepcopy(record)
            )
        else:
            result = self._call(
                self.runtime.collect_complete_bundle,
                deepcopy(record),
                revision_mode=str(revision_mode or "ALL").upper(),
                revision_numbers=list(revision_numbers or []),
                search_source=deepcopy(search_source),
            )
        sources = result.get("sources")
        if not isinstance(sources, dict):
            raise ProcurementSourceError("PROCUREMENT_SCHEMA_CHANGED")
        if result.get("schemaVersion") == (
            "biddingflow-muasamcong-raw-bundle-v2"
        ):
            bundle = deepcopy(result)
            self._observe("COMPLETE_BUNDLE", result, bundle)
            return bundle
        canonical = {
            "schemaVersion": "biddingflow-muasamcong-complete-bundle-v1",
            "type": str(result.get("type") or ""),
            "fetchedAt": result.get("fetchedAt"),
            "schemaFingerprint": result.get("fingerprint"),
            "partial": bool(result.get("failures")),
            "failedOperations": deepcopy(result.get("failures") or []),
            "classification": str(
                classify_upstream_error(partial=bool(result.get("failures")))
            ),
            "sources": deepcopy(sources),
        }
        self._observe("COMPLETE_BUNDLE", result, canonical)
        return canonical

    @staticmethod
    def _plan_lookup_data(family_no, revision):
        return {
            "planNo": family_no,
            "planName": revision.get("name"),
            "projectName": revision.get("projectName"),
            "investorName": revision.get("investorName"),
            "decisionNo": revision.get("approvalDecisionNo"),
            "decisionDate": revision.get("approvalDecisionDate"),
            "publicDate": revision.get("publishedAt"),
            "packages": [
                {
                    "notifyNo": (package.get("noticeLink") or {}).get(
                        "noticeNo"
                    ),
                    "planNo": family_no,
                    "bidName": package.get("name"),
                    "bidPrice": package.get("priceVnd"),
                    "capitalDetail": package.get("capitalDetail"),
                    "bidField": package.get("field"),
                    "bidForm": package.get("selectionForm"),
                    "bidMode": package.get("selectionMode"),
                    "contractType": package.get("contractType"),
                    "implementationPeriod": package.get("executionPeriod"),
                    "lots": package.get("lots"),
                }
                for package in revision.get("packages") or []
            ],
        }

    def map_plan_raw_bundle(self, bundle: dict) -> dict:
        """Reprocess a stored v2 raw bundle without calling upstream."""

        if not isinstance(bundle, dict) or bundle.get("schemaVersion") != (
            "biddingflow-muasamcong-raw-bundle-v2"
        ):
            raise ProcurementSourceError("PROCUREMENT_SCHEMA_CHANGED")
        entity = bundle.get("entity") or {}
        family_no = _canonical_code(entity.get("planNo"), _PLAN_PATTERN)
        revisions = []
        field_sources = {}
        for revision_number, node in sorted(
            (bundle.get("revisions") or {}).items(),
            key=lambda item: str(item[0]),
        ):
            source = ((node or {}).get("sources") or {}).get("planDetail") or {}
            raw = source.get("response")
            if source.get("success") is not True or not isinstance(raw, dict):
                continue
            canonical = self.parser_registry.parse(
                source.get("schemaFingerprint") or "plan:v1:unknown",
                raw,
                family_no=family_no,
                revision_id=str(node.get("revisionId") or ""),
                revision_number=str(revision_number).zfill(2),
                source={
                    "provider": self.name,
                    "semanticOperation": "PLAN_DETAIL",
                    "schemaFingerprint": source.get("schemaFingerprint"),
                    "retrievedAt": source.get("retrievedAt"),
                },
            )
            revisions.append(canonical)
            for field in (
                "name", "projectName", "investorName",
                "approvalDecisionNo", "approvalDecisionDate", "publishedAt",
            ):
                if canonical.get(field) is not None:
                    field_sources[f"revisions.{revision_number}.{field}"] = {
                        "operation": "PLAN_DETAIL",
                        "revision": str(revision_number),
                        "sourcePath": field,
                    }
        return {
            "schemaVersion": "biddingflow-procurement-canonical-v2",
            "mappingSchemaVersion": "biddingflow-muasamcong-mapping-v2",
            "kind": "PLAN",
            "canonicalCode": family_no,
            "revisions": revisions,
            "fieldSources": field_sources,
        }

    def lookup_from_raw_bundle(
        self,
        code: str,
        bundle: dict,
        *,
        revision_mode="ALL",
    ) -> dict:
        """Project a stored COMPLETE bundle without any upstream request."""

        started = self.clock()
        family_no = _canonical_code(code, _PLAN_PATTERN)
        entity = bundle.get("entity") if isinstance(bundle, dict) else {}
        bundle_code = str(
            (entity or {}).get("canonicalCode")
            or (entity or {}).get("planNo")
            or ""
        ).strip().upper()
        if bundle_code != family_no:
            raise ProcurementLookupError("PROCUREMENT_SCHEMA_CHANGED")
        mapping_started = self.clock()
        try:
            canonical = self.map_plan_raw_bundle(bundle)
        except ProcurementSourceError as error:
            raise ProcurementLookupError(str(error)) from error
        mapping_ms = max(0, self.clock() - mapping_started) * 1000
        revisions = canonical.get("revisions") or []
        if not revisions:
            raise ProcurementLookupError("PROCUREMENT_REVISION_INVALID")
        raw_bundle = deepcopy(bundle)
        metrics = deepcopy(raw_bundle.get("metrics") or {})
        metrics["mappingMs"] = round(mapping_ms, 3)
        metrics["upstream"] = {"requestCount": 0, "networkMs": 0}
        metrics["totalMs"] = round(
            max(0, self.clock() - started) * 1000, 3
        )
        status = str(raw_bundle.get("status") or "FOUND_PARTIAL")
        return {
            "schemaVersion": "biddingflow-procurement-preview-v1",
            "found": True,
            "kind": "PLAN",
            "inputCode": str(code or "").strip(),
            "canonicalCode": family_no,
            "detailLevel": "COMPLETE",
            "revisionMode": str(revision_mode or "ALL").upper(),
            "status": status,
            "classification": status,
            "source": {
                "provider": self.name,
                "driver": "raw-snapshot",
                "browserMode": "not-launched",
                "extractionStrategy": "stored-raw-projection",
                "parserVersion": self.parser_version,
                "retrievedAt": raw_bundle.get("retrievedAt"),
            },
            "data": self._plan_lookup_data(family_no, revisions[-1]),
            "canonical": canonical,
            "rawBundle": raw_bundle,
            "manifest": deepcopy(raw_bundle.get("manifest") or {}),
            "metrics": metrics,
        }

    @staticmethod
    def _select_canonical_revisions(rows, mode, numbers):
        ordered = sorted(
            rows,
            key=lambda row: (
                int(row.get("revisionNumber") or -1)
                if str(row.get("revisionNumber") or "").isdigit()
                else -1,
                str(row.get("revisionNumber") or ""),
            ),
        )
        if mode == "ALL":
            return ordered
        if mode == "LATEST":
            return ordered[-1:] if ordered else []
        selected = {str(number).zfill(2) for number in numbers}
        return [
            row for row in ordered
            if str(row.get("revisionNumber") or "").zfill(2) in selected
        ]

    def lookup_with_options(
        self,
        code: str,
        kind: str,
        *,
        detail_level,
        revision_mode,
        revision_numbers=None,
    ) -> dict:
        """Fetch only the endpoint graph required by the requested detail."""

        started = self.clock()
        normalized_kind = str(kind or "").strip().upper()
        if normalized_kind != "PLAN":
            raise ProcurementLookupError("PROCUREMENT_ADAPTER_UNSUPPORTED")
        family_no = _canonical_code(code, _PLAN_PATTERN)
        numbers = list(revision_numbers or [])
        try:
            if detail_level == "SUMMARY":
                search = self._call(self.runtime.search, family_no, "PLAN")
                record = search.get("record") or {}
                data = {
                    "planNo": family_no,
                    "planName": record.get("name") or record.get("planName"),
                    "investorName": record.get("investorName"),
                    "planVersion": record.get("planVersion"),
                    "status": record.get("status"),
                }
                canonical = None
                raw_bundle = None
                status = "FOUND_COMPLETE"
                metrics = deepcopy(search.get("metadata") or {})
            elif detail_level == "COMPLETE":
                collection_started = self.clock()
                search = self._call(self.runtime.search, family_no, "PLAN")
                record = search.get("record")
                if not isinstance(record, dict):
                    raise ProcurementSourceError("PROCUREMENT_SCHEMA_CHANGED")
                raw_bundle = self.collect_complete_bundle(
                    record,
                    revision_mode=revision_mode,
                    revision_numbers=numbers,
                    search_source=search,
                )
                mapping_started = self.clock()
                canonical = self.map_plan_raw_bundle(raw_bundle)
                mapping_ms = max(0, self.clock() - mapping_started) * 1000
                selected = canonical.get("revisions") or []
                if not selected:
                    raise ProcurementSourceError("PROCUREMENT_REVISION_INVALID")
                data = self._plan_lookup_data(family_no, selected[-1])
                status = str(raw_bundle.get("status") or "FOUND_PARTIAL")
                metrics = deepcopy(raw_bundle.get("metrics") or {})
                metrics["collectionMs"] = round(
                    max(0, self.clock() - collection_started) * 1000, 3
                )
                metrics["mappingMs"] = round(mapping_ms, 3)
            else:
                available = self.list_plan_revisions(family_no)
                hints = self._select_canonical_revisions(
                    available, revision_mode, numbers
                )
                if not hints:
                    raise ProcurementSourceError("PROCUREMENT_REVISION_INVALID")
                selected = [
                    self.get_plan_revision(family_no, row["revisionId"])
                    for row in hints
                ]
                canonical = {
                    "schemaVersion": "biddingflow-procurement-canonical-v2",
                    "mappingSchemaVersion": "biddingflow-muasamcong-mapping-v2",
                    "kind": "PLAN",
                    "canonicalCode": family_no,
                    "revisions": selected,
                }
                raw_bundle = None
                data = self._plan_lookup_data(family_no, selected[-1])
                status = "FOUND_COMPLETE"
                metrics = {}
        except ProcurementSourceError as error:
            raise ProcurementLookupError(str(error)) from error
        metrics["totalMs"] = round(
            max(0, self.clock() - started) * 1000, 3
        )
        response = {
            "schemaVersion": "biddingflow-procurement-preview-v1",
            "found": True,
            "kind": "PLAN",
            "inputCode": str(code or "").strip(),
            "canonicalCode": family_no,
            "detailLevel": detail_level,
            "revisionMode": revision_mode,
            "status": status,
            "classification": status,
            "source": {
                "provider": self.name,
                "driver": "protected-api",
                "browserMode": "lazy-session-bootstrap",
                "extractionStrategy": "protected-api",
                "parserVersion": self.parser_version,
            },
            "data": data,
            "metrics": metrics,
        }
        if canonical is not None:
            response["canonical"] = canonical
        if raw_bundle is not None:
            response["rawBundle"] = raw_bundle
            response["manifest"] = deepcopy(raw_bundle.get("manifest") or {})
        return response

    def health(self):
        return self._call(self.runtime.integration_health)

    def lookup(self, code: str, kind: str) -> dict:
        """Expose the same source through the existing lookup contract."""

        lookup_started = self.clock()
        list_ms = 0.0
        detail_ms = 0.0
        try:
            normalized_kind = str(kind or "").strip().upper()
            if normalized_kind == "PLAN":
                family_no = _canonical_code(code, _PLAN_PATTERN)
                list_started = self.clock()
                revisions = self.list_plan_revisions(family_no)
                list_ms = max(0, self.clock() - list_started) * 1000
                latest = max(
                    revisions,
                    key=lambda row: (
                        int(row["revisionNumber"])
                        if str(row["revisionNumber"]).isdigit()
                        else -1,
                        row["revisionNumber"],
                    ),
                )
                detail_started = self.clock()
                revision = self.get_plan_revision(
                    family_no, latest["revisionId"]
                )
                detail_ms = max(0, self.clock() - detail_started) * 1000
                data = self._plan_lookup_data(family_no, revision)
            elif normalized_kind == "PACKAGE":
                notice_no = _canonical_code(code, _NOTICE_PATTERN)
                list_started = self.clock()
                revisions = self.list_notice_revisions(notice_no)
                list_ms = max(0, self.clock() - list_started) * 1000
                latest = max(
                    revisions,
                    key=lambda row: (
                        int(row["revisionNumber"])
                        if str(row["revisionNumber"]).isdigit()
                        else -1,
                        row["revisionNumber"],
                    ),
                )
                detail_started = self.clock()
                revision = self.get_notice_revision(
                    notice_no, latest["revisionId"]
                )
                detail_ms = max(0, self.clock() - detail_started) * 1000
                data = {
                    "notifyNo": notice_no,
                    "notifyId": revision.get("notifyId"),
                    "planNo": revision.get("planNo"),
                    "bidName": revision.get("name"),
                    "bidForm": revision.get("selectionForm"),
                    "bidMode": revision.get("selectionMode"),
                    "processApply": revision.get("processApply"),
                    "contractType": revision.get("contractType"),
                    "bidCloseDate": revision.get("bidClosingAt"),
                    "bidOpenDate": revision.get("bidOpeningAt"),
                    "bidOpenId": revision.get("bidOpenId"),
                    "inputResultId": revision.get("inputResultId"),
                }
            else:
                raise ProcurementSourceError("PROCUREMENT_CODE_INVALID")
        except ProcurementSourceError as error:
            primary_code = str(error)
            if primary_code == "PROCUREMENT_CODE_INVALID":
                raise ProcurementLookupError(primary_code) from error
            try:
                fallback = self.browser_fallback.lookup(code, normalized_kind)
            except ProcurementLookupError as fallback_error:
                fallback_code = str(fallback_error)
                if "PROCUREMENT_SCHEMA_CHANGED" in {
                    primary_code, fallback_code,
                }:
                    raise ProcurementLookupError(
                        "PROCUREMENT_SCHEMA_CHANGED"
                    ) from fallback_error
                raise
            fallback["source"] = {
                **(fallback.get("source") or {}),
                "provider": self.name,
            }
            return fallback
        source = revision.get("source") or {}
        metrics = {
            **(source.get("metrics") or {}),
            "listMs": round(list_ms, 3),
            "detailMs": round(detail_ms, 3),
            "upstreamRequestCount": 2,
            "totalMs": round(
                max(0, self.clock() - lookup_started) * 1000,
                3,
            ),
        }
        return {
            "schemaVersion": "biddingflow-procurement-preview-v1",
            "found": True,
            "kind": normalized_kind,
            "inputCode": str(code or "").strip(),
            "canonicalCode": str(code or "").strip().upper().split("-", 1)[0],
            "source": {
                "provider": self.name,
                "driver": "protected-api",
                "driverVersion": source.get("profile") or self.parser_version,
                "browserMode": "session-bootstrap",
                "extractionStrategy": "protected-api",
                "parserVersion": self.parser_version,
                "retrievedAt": source.get("retrievedAt"),
                "schemaFingerprint": source.get("schemaFingerprint"),
            },
            "data": data,
            "metrics": metrics,
            "classification": str(classify_upstream_error()),
        }

    def close(self):
        self.runtime.close()
