"""Cache-first, same-key-coalesced procurement lookup module."""

from __future__ import annotations

from copy import deepcopy
from contextlib import nullcontext
from dataclasses import dataclass
from datetime import datetime, timezone
from threading import Event, RLock
import time

from backend.procurement_lookup.source import ProcurementSource

from backend.procurement_import.domain import (
    ProcurementCodeKind,
    normalize_procurement_code,
)
from backend.procurement_lookup.domain import (
    ProcurementLookupError,
    normalize_lookup_options,
)


@dataclass(slots=True)
class _CacheEntry:
    expires_at: float
    value: dict


@dataclass(slots=True)
class _InFlight:
    completed: Event
    value: dict | None = None
    error: BaseException | None = None


class ProcurementLookupService:
    """Hide caching and request coalescing behind one lookup interface."""

    def __init__(
        self,
        source: ProcurementSource,
        *,
        ttl_seconds=300,
        shared_cache=None,
        coalesce_timeout_seconds=30,
        failure_threshold=3,
        circuit_seconds=30,
        clock=time.monotonic,
        observer=None,
        ttl_by_kind=None,
        utc_now=lambda: datetime.now(timezone.utc),
    ):
        self.source = source
        self.ttl_seconds = max(1.0, min(float(ttl_seconds), 86400.0))
        configured_ttls = ttl_by_kind or {}
        self.ttl_by_kind = {
            key: max(
                1.0,
                min(float(configured_ttls.get(key, self.ttl_seconds)), 86400.0),
            )
            for key in ("PLAN", "OPEN_PACKAGE", "CLOSED_PACKAGE")
        }
        self.utc_now = utc_now
        self.shared_cache = shared_cache
        self.coalesce_timeout_seconds = max(
            1.0, min(float(coalesce_timeout_seconds), 60.0)
        )
        self.clock = clock
        self.observer = observer
        self.failure_threshold = max(1, min(int(failure_threshold), 10))
        self.circuit_seconds = max(1.0, min(float(circuit_seconds), 300.0))
        self._cache: dict[tuple[str, ...], _CacheEntry] = {}
        self._in_flight: dict[tuple[str, ...], _InFlight] = {}
        self._consecutive_failures = 0
        self._opened_until = 0.0
        self._lock = RLock()

    def _observe(
        self,
        value,
        cache_layer,
        result_class="success",
        *,
        lookup_request_id=None,
    ):
        if not callable(self.observer):
            return
        source = value.get("source") if isinstance(value, dict) else {}
        metrics = value.get("metrics") if isinstance(value, dict) else {}
        event = {
            "provider": str((source or {}).get("provider") or self.source.name),
            "kind": str(value.get("kind") or "unknown")
            if isinstance(value, dict) else "unknown",
            "canonicalCode": str(value.get("canonicalCode") or "")
            if isinstance(value, dict) else "",
            "driver": str((source or {}).get("driver") or "unknown"),
            "browserMode": str(
                (source or {}).get("browserMode") or "unknown"
            ),
            "extractor": str(
                (source or {}).get("extractionStrategy") or "unknown"
            ),
            "lookupRequestId": str(lookup_request_id or ""),
            "cache": "hit" if cache_layer not in {None, "NONE", "MISS"} else "miss",
            "cacheLayer": str(((metrics or {}).get("cache") or {}).get(
                "layer"
            ) or cache_layer or "NONE"),
            "detailLevel": str(value.get("detailLevel") or "CANONICAL"),
            "revisionMode": str(value.get("revisionMode") or "LATEST"),
            "durationMs": (metrics or {}).get("totalMs", 0),
            "browserStartupMs": (metrics or {}).get("browserStartupMs", 0),
            "sessionAcquireMs": (metrics or {}).get("sessionAcquireMs", 0),
            "sessionCacheHit": bool(
                (metrics or {}).get("sessionCacheHit", False)
            ),
            "upstreamDurationMs": (
                ((metrics or {}).get("upstream") or {}).get("networkMs")
                or (metrics or {}).get("networkWaitMs")
                or 0
            ),
            "collectionDurationMs": (metrics or {}).get("collectionMs", 0),
            "mappingDurationMs": (metrics or {}).get("mappingMs", 0),
            "normalizeDurationMs": (metrics or {}).get("normalizeMs", 0),
            "upstreamRequestCount": int(
                ((metrics or {}).get("upstream") or {}).get("requestCount")
                or (metrics or {}).get("upstreamRequestCount")
                or 0
            ),
            "partialFailureCount": len(value.get("rawBundle", {}).get(
                "failures", []
            )) if isinstance(value, dict) else 0,
            "resultClass": str(result_class),
            "parserVersion": str(
                (source or {}).get("parserVersion")
                or getattr(self.source, "parser_version", "unknown")
            ),
        }
        try:
            self.observer(event)
        except Exception:  # noqa: BLE001 - telemetry cannot break lookup.
            return

    def _observe_failure(
        self,
        kind,
        code,
        error,
        duration_ms,
        *,
        detail_level="CANONICAL",
        revision_mode="LATEST",
        lookup_request_id=None,
    ):
        if not callable(self.observer):
            return
        allowed = {
            "PROCUREMENT_NOT_FOUND",
            "PROCUREMENT_REVISION_INVALID",
            "PROCUREMENT_INTERACTION_REQUIRED",
            "PROCUREMENT_TIMEOUT",
            "PROCUREMENT_UPSTREAM_UNAVAILABLE",
            "PROCUREMENT_BROWSER_FAILED",
            "PROCUREMENT_SCHEMA_CHANGED",
            "PROCUREMENT_ADAPTER_UNSUPPORTED",
            "PROCUREMENT_LOOKUP_BUSY",
        }
        result_class = str(error)
        if result_class not in allowed:
            result_class = "PROCUREMENT_UPSTREAM_UNAVAILABLE"
        event = {
            "provider": str(self.source.name),
            "lookupRequestId": str(lookup_request_id or ""),
            "kind": str(kind),
            "canonicalCode": str(code),
            "driver": "unknown",
            "browserMode": "unknown",
            "extractor": "unknown",
            "cache": "miss",
            "cacheLayer": "NONE",
            "detailLevel": str(detail_level),
            "revisionMode": str(revision_mode),
            "durationMs": round(max(0, duration_ms), 3),
            "browserStartupMs": 0,
            "sessionAcquireMs": 0,
            "sessionCacheHit": False,
            "upstreamDurationMs": 0,
            "collectionDurationMs": 0,
            "mappingDurationMs": 0,
            "normalizeDurationMs": 0,
            "upstreamRequestCount": 0,
            "partialFailureCount": 0,
            "resultClass": result_class,
            "parserVersion": str(
                getattr(self.source, "parser_version", "unknown")
            ),
        }
        try:
            self.observer(event)
        except Exception:  # noqa: BLE001 - telemetry cannot break lookup.
            return

    def _assert_circuit_available(self):
        with self._lock:
            if self._opened_until > self.clock():
                raise ProcurementLookupError("PROCUREMENT_LOOKUP_BUSY")

    def _record_source_success(self):
        with self._lock:
            self._consecutive_failures = 0
            self._opened_until = 0.0

    def _record_source_failure(self, error):
        if str(error) not in {
            "PROCUREMENT_BROWSER_FAILED",
            "PROCUREMENT_UPSTREAM_UNAVAILABLE",
            "PROCUREMENT_TIMEOUT",
            "PROCUREMENT_SCHEMA_CHANGED",
            "PROCUREMENT_ADAPTER_UNSUPPORTED",
        }:
            return
        with self._lock:
            self._consecutive_failures += 1
            if self._consecutive_failures >= self.failure_threshold:
                self._opened_until = self.clock() + self.circuit_seconds

    def _cache_key(
        self,
        code,
        kind,
        detail_level="CANONICAL",
        revision_mode="LATEST",
        revision_numbers=(),
        cache_scope="GLOBAL",
    ):
        variant = ":".join((
            str(getattr(self.source, "parser_version", "unknown")),
            str(detail_level),
            str(revision_mode),
            ",".join(revision_numbers),
            f"scope={cache_scope or 'GLOBAL'}",
        ))
        return (
            str(self.source.name),
            str(kind),
            str(code),
            variant,
        )

    def _get_process_cache(self, key):
        with self._lock:
            entry = self._cache.get(key)
            if entry is None:
                return None
            if entry.expires_at <= self.clock():
                self._cache.pop(key, None)
                return None
            return deepcopy(entry.value)

    def _get_cached(self, key):
        process = self._get_process_cache(key)
        if process is not None:
            return process, "L1"
        if self.shared_cache is not None:
            shared = self.shared_cache.get(key)
            if shared is not None:
                with self._lock:
                    self._cache[key] = _CacheEntry(
                        self.clock() + self._ttl_for(key[1], shared),
                        deepcopy(shared),
                    )
                return deepcopy(shared), "L2"
        return None, None

    @staticmethod
    def _with_cache_metrics(value, *, hit, layer):
        copied = deepcopy(value)
        metrics = copied.get("metrics")
        if not isinstance(metrics, dict):
            metrics = {}
            copied["metrics"] = metrics
        metrics["cache"] = {"hit": bool(hit), "layer": layer}
        return copied

    def _put_cached(self, key, value):
        copied = deepcopy(value)
        ttl_seconds = self._ttl_for(key[1], copied)
        with self._lock:
            self._cache[key] = _CacheEntry(
                self.clock() + ttl_seconds,
                copied,
            )
        if self.shared_cache is not None:
            self.shared_cache.put(key, deepcopy(copied), ttl_seconds)

    def _ttl_for(self, kind, value):
        if kind == "PLAN":
            return self.ttl_by_kind["PLAN"]
        close_date = (value.get("data") or {}).get("bidCloseDate")
        if close_date:
            try:
                parsed = datetime.fromisoformat(str(close_date).replace("Z", "+00:00"))
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=timezone.utc)
                if parsed.astimezone(timezone.utc) <= self.utc_now():
                    return self.ttl_by_kind["CLOSED_PACKAGE"]
            except (TypeError, ValueError):
                pass
        return self.ttl_by_kind["OPEN_PACKAGE"]

    def lookup(
        self,
        code,
        *,
        detail_level="CANONICAL",
        revision_mode="LATEST",
        revision_numbers=None,
        raw_bundle_loader=None,
        cache_scope="GLOBAL",
        lookup_request_id=None,
    ):
        original = str(code or "").strip()
        try:
            detail_level, revision_mode, revision_numbers = (
                normalize_lookup_options(
                    detail_level, revision_mode, revision_numbers
                )
            )
        except ValueError as error:
            raise ProcurementLookupError("PROCUREMENT_CODE_INVALID") from error
        try:
            normalized = normalize_procurement_code(original)
        except ValueError as error:
            raise ProcurementLookupError("PROCUREMENT_CODE_INVALID") from error
        kind = (
            "PLAN"
            if normalized.kind is ProcurementCodeKind.PLAN
            else "PACKAGE"
        )
        key = self._cache_key(
            normalized.base_code,
            kind,
            detail_level,
            revision_mode,
            revision_numbers,
            cache_scope,
        )
        cached, cache_layer = self._get_cached(key)
        if cached is not None:
            value = self._with_cache_metrics(
                cached, hit=True, layer=cache_layer
            )
            self._observe(
                value,
                cache_layer,
                lookup_request_id=lookup_request_id,
            )
            return value
        self._assert_circuit_available()

        with self._lock:
            cached = self._get_process_cache(key)
            if cached is not None:
                value = self._with_cache_metrics(
                    cached, hit=True, layer="L1"
                )
                self._observe(
                    value,
                    "L1",
                    lookup_request_id=lookup_request_id,
                )
                return value
            pending = self._in_flight.get(key)
            owner = pending is None
            if pending is None:
                pending = _InFlight(completed=Event())
                self._in_flight[key] = pending

        if not owner:
            if not pending.completed.wait(self.coalesce_timeout_seconds):
                raise ProcurementLookupError("PROCUREMENT_LOOKUP_BUSY")
            if pending.error is not None:
                raise pending.error
            value = deepcopy(pending.value)
            value = self._with_cache_metrics(
                value, hit=True, layer="IN_FLIGHT"
            )
            self._observe(
                value,
                "IN_FLIGHT",
                lookup_request_id=lookup_request_id,
            )
            return value

        source_started = self.clock()
        try:
            request_context = getattr(
                self.source, "lookup_request_context", None
            )
            context = (
                request_context(lookup_request_id)
                if callable(request_context)
                else nullcontext()
            )
            with context:
                raw_bundle = None
                if (
                    detail_level == "COMPLETE"
                    and callable(raw_bundle_loader)
                ):
                    raw_bundle = raw_bundle_loader()
                if isinstance(raw_bundle, dict):
                    project = getattr(
                        self.source, "lookup_from_raw_bundle", None
                    )
                    if not callable(project):
                        raise ProcurementLookupError(
                            "PROCUREMENT_ADAPTER_UNSUPPORTED"
                        )
                    value = project(
                        normalized.base_code,
                        raw_bundle,
                        revision_mode=revision_mode,
                    )
                    result_layer = "RAW_SNAPSHOT"
                elif (
                    detail_level == "CANONICAL"
                    and revision_mode == "LATEST"
                ):
                    value = self.source.lookup(normalized.base_code, kind)
                    result_layer = None
                else:
                    detailed_lookup = getattr(
                        self.source, "lookup_with_options", None
                    )
                    if not callable(detailed_lookup):
                        raise ProcurementLookupError(
                            "PROCUREMENT_ADAPTER_UNSUPPORTED"
                        )
                    value = detailed_lookup(
                        normalized.base_code,
                        kind,
                        detail_level=detail_level,
                        revision_mode=revision_mode,
                        revision_numbers=list(revision_numbers),
                    )
                    result_layer = None
            if not isinstance(value, dict):
                raise ProcurementLookupError("PROCUREMENT_SCHEMA_CHANGED")
            self._record_source_success()
            self._put_cached(key, value)
            pending.value = deepcopy(value)
            response = self._with_cache_metrics(
                value,
                hit=result_layer is not None,
                layer=result_layer or "NONE",
            )
            self._observe(
                response,
                result_layer or "MISS",
                lookup_request_id=lookup_request_id,
            )
            return response
        except Exception as error:
            self._record_source_failure(error)
            self._observe_failure(
                kind,
                normalized.base_code,
                error,
                (self.clock() - source_started) * 1000,
                detail_level=detail_level,
                revision_mode=revision_mode,
                lookup_request_id=lookup_request_id,
            )
            pending.error = error
            raise
        finally:
            with self._lock:
                self._in_flight.pop(key, None)
                pending.completed.set()
