"""Cache-first, same-key-coalesced procurement lookup module."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
from threading import Event, RLock
import time

from backend.procurement_lookup.source import ProcurementSource

from backend.procurement_import.domain import (
    ProcurementCodeKind,
    normalize_procurement_code,
)
from backend.procurement_lookup.domain import ProcurementLookupError


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

    def _observe(self, value, cache, result_class="success"):
        if not callable(self.observer):
            return
        source = value.get("source") if isinstance(value, dict) else {}
        metrics = value.get("metrics") if isinstance(value, dict) else {}
        event = {
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
            "cache": str(cache),
            "durationMs": (metrics or {}).get("totalMs", 0),
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

    def _observe_failure(self, kind, code, error, duration_ms):
        if not callable(self.observer):
            return
        allowed = {
            "PROCUREMENT_NOT_FOUND",
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
            "kind": str(kind),
            "canonicalCode": str(code),
            "driver": "unknown",
            "browserMode": "unknown",
            "extractor": "unknown",
            "cache": "miss",
            "durationMs": round(max(0, duration_ms), 3),
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

    def _cache_key(self, code, kind):
        return (
            str(self.source.name),
            str(kind),
            str(code),
            str(getattr(self.source, "parser_version", "unknown")),
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
        if self.shared_cache is not None:
            shared = self.shared_cache.get(key)
            if shared is not None:
                with self._lock:
                    self._cache[key] = _CacheEntry(
                        self.clock() + self._ttl_for(key[1], shared),
                        deepcopy(shared),
                    )
                return deepcopy(shared)
        return self._get_process_cache(key)

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

    def lookup(self, code):
        original = str(code or "").strip()
        try:
            normalized = normalize_procurement_code(original)
        except ValueError as error:
            raise ProcurementLookupError("PROCUREMENT_CODE_INVALID") from error
        kind = (
            "PLAN"
            if normalized.kind is ProcurementCodeKind.PLAN
            else "PACKAGE"
        )
        key = self._cache_key(normalized.base_code, kind)
        cached = self._get_cached(key)
        if cached is not None:
            self._observe(cached, "hit")
            return cached
        self._assert_circuit_available()

        with self._lock:
            cached = self._get_process_cache(key)
            if cached is not None:
                self._observe(cached, "hit")
                return cached
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
            self._observe(value, "coalesced")
            return value

        source_started = self.clock()
        try:
            value = self.source.lookup(normalized.base_code, kind)
            if not isinstance(value, dict):
                raise ProcurementLookupError("PROCUREMENT_SCHEMA_CHANGED")
            self._record_source_success()
            self._put_cached(key, value)
            pending.value = deepcopy(value)
            self._observe(value, "miss")
            return deepcopy(value)
        except Exception as error:
            self._record_source_failure(error)
            self._observe_failure(
                kind,
                normalized.base_code,
                error,
                (self.clock() - source_started) * 1000,
            )
            pending.error = error
            raise
        finally:
            with self._lock:
                self._in_flight.pop(key, None)
                pending.completed.set()
