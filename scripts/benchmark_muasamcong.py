"""Benchmark 50-100 operator-supplied PL/IB codes on the production lookup stack."""

from __future__ import annotations

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import json
import math
import os
from pathlib import Path
import time

from backend.integrations.muasamcong_browser.procurement_source import (
    MuaSamCongProcurementSource,
)
from backend.integrations.muasamcong_browser.source import MuaSamCongBrowserSource
from backend.procurement_import.domain import normalize_procurement_code
from backend.procurement_lookup.cache import PostgresProcurementLookupCache
from backend.procurement_lookup.config import ProcurementLookupSettings
from backend.procurement_lookup.domain import ProcurementLookupError
from backend.procurement_lookup.service import ProcurementLookupService
from backend.shared.helpers import database


SCENARIOS = (
    "coldWorkerColdSession",
    "warmWorkerColdSession",
    "warmSession",
    "l1Hit",
    "l2Hit",
    "completeLatest",
    "completeAll",
)


def _percentile(values, percentile):
    if not values:
        return None
    ordered = sorted(values)
    index = max(0, math.ceil(percentile * len(ordered)) - 1)
    return round(ordered[index], 3)


def _rates(counter):
    total = sum(counter.values())
    if not total:
        return {}
    return {
        key: round(value * 100 / total, 3)
        for key, value in sorted(counter.items())
    }


def _outcome(error):
    code = str(error)
    return {
        "PROCUREMENT_NOT_FOUND": "not-found",
        "PROCUREMENT_INTERACTION_REQUIRED": "interaction-required",
        "PROCUREMENT_TIMEOUT": "timeout",
        "PROCUREMENT_SCHEMA_CHANGED": "schema-error",
        "PROCUREMENT_REVISION_INVALID": "revision-error",
    }.get(code, "upstream-error")


def _counter_delta(before, after, section, field):
    return max(
        0,
        int((after.get(section) or {}).get(field) or 0)
        - int((before.get(section) or {}).get(field) or 0),
    )


def _measure(
    stack,
    entry,
    scenario,
    clock,
    *,
    started=None,
    lookup_options=None,
    snapshot_before=True,
):
    before = stack.snapshot() if snapshot_before else {}
    started = clock() if started is None else started
    options = dict(lookup_options or {})
    try:
        result = stack.service.lookup(entry["code"], **options)
        duration_ms = round(max(0, clock() - started) * 1000, 3)
        source = result.get("source") or {}
        metrics = result.get("metrics") or {}
        upstream = metrics.get("upstream") or {}
        cache = metrics.get("cache") or {}
        after = stack.snapshot()
        refreshes = _counter_delta(before, after, "session", "refreshCount")
        fallback_before = bool(
            (before.get("browserFallback") or {}).get("launched")
        )
        fallback_after = bool(
            (after.get("browserFallback") or {}).get("launched")
        )
        return {
            "scenario": scenario,
            "code": entry["code"],
            "category": entry["category"],
            "outcome": "success",
            "durationMs": duration_ms,
            "driver": str(source.get("driver") or "unknown"),
            "extractor": str(
                source.get("extractionStrategy") or "unknown"
            ),
            "browserMode": str(source.get("browserMode") or "unknown"),
            "cacheLayer": str(cache.get("layer") or "NONE"),
            "browserStartupMs": float(metrics.get("browserStartupMs") or 0),
            "sessionAcquireMs": float(metrics.get("sessionAcquireMs") or 0),
            "upstreamNetworkMs": float(
                upstream.get("networkMs")
                or metrics.get("networkWaitMs")
                or 0
            ),
            "normalizeMs": float(metrics.get("normalizeMs") or 0),
            "mappingMs": float(metrics.get("mappingMs") or 0),
            "upstreamRequestCount": int(
                upstream.get("requestCount")
                or metrics.get("upstreamRequestCount")
                or 0
            ),
            "partialFailureCount": len(
                (result.get("rawBundle") or {}).get("failures") or []
            ),
            "sessionRefreshCount": refreshes,
            "browserLaunches": refreshes + int(
                fallback_after and not fallback_before
            ),
        }
    except ProcurementLookupError as error:
        return {
            "scenario": scenario,
            "code": entry["code"],
            "category": entry["category"],
            "outcome": _outcome(error),
            "durationMs": round(max(0, clock() - started) * 1000, 3),
            "driver": "unknown",
            "extractor": "unknown",
            "browserMode": "unknown",
            "cacheLayer": "NONE",
            "browserStartupMs": 0,
            "sessionAcquireMs": 0,
            "upstreamNetworkMs": 0,
            "normalizeMs": 0,
            "mappingMs": 0,
            "upstreamRequestCount": 0,
            "partialFailureCount": 0,
            "sessionRefreshCount": 0,
            "browserLaunches": 0,
        }


def _measure_isolated(entries, stack_factory, scenario, clock, *, cold=False):
    records = []
    for entry in entries:
        started = clock() if cold else None
        stack = stack_factory()
        try:
            records.append(_measure(
                stack,
                entry,
                scenario,
                clock,
                started=started,
                lookup_options={"cache_scope": scenario},
                snapshot_before=not cold,
            ))
        finally:
            stack.close()
    return records


def run_benchmark(
    entries,
    *,
    stack_factory,
    clock=time.perf_counter,
    concurrency=4,
):
    """Run every required scenario without silently reusing the wrong layer."""

    records = []
    records.extend(_measure_isolated(
        entries, stack_factory, "coldWorkerColdSession", clock, cold=True
    ))
    records.extend(_measure_isolated(
        entries, stack_factory, "warmWorkerColdSession", clock
    ))

    for entry in entries:
        stack = stack_factory()
        try:
            # This call warms the protected session under a throwaway cache key.
            _measure(
                stack,
                entry,
                "sessionWarmup",
                clock,
                lookup_options={"cache_scope": "session-warmup"},
            )
            warm = _measure(
                stack,
                entry,
                "warmSession",
                clock,
                lookup_options={"cache_scope": "warm-session"},
            )
            records.append(warm)
            records.append(_measure(
                stack,
                entry,
                "l1Hit",
                clock,
                lookup_options={"cache_scope": "warm-session"},
            ))

            # Populate L2, then replace only the service/L1 while keeping source,
            # protected session and shared cache alive.
            _measure(
                stack,
                entry,
                "l2Populate",
                clock,
                lookup_options={"cache_scope": "l2"},
            )
            stack.reset_l1()
            records.append(_measure(
                stack,
                entry,
                "l2Hit",
                clock,
                lookup_options={"cache_scope": "l2"},
            ))

            if entry["code"].startswith("PL"):
                records.append(_measure(
                    stack,
                    entry,
                    "completeLatest",
                    clock,
                    lookup_options={
                        "detail_level": "COMPLETE",
                        "revision_mode": "LATEST",
                        "cache_scope": "complete-latest",
                    },
                ))
                records.append(_measure(
                    stack,
                    entry,
                    "completeAll",
                    clock,
                    lookup_options={
                        "detail_level": "COMPLETE",
                        "revision_mode": "ALL",
                        "cache_scope": "complete-all",
                    },
                ))
        finally:
            stack.close()

    concurrent_stack = stack_factory()
    worker_count = max(1, min(int(concurrency), 16, len(entries)))
    concurrent_scenario = f"concurrentX{worker_count}"
    try:
        with ThreadPoolExecutor(max_workers=worker_count) as pool:
            futures = [
                pool.submit(
                    _measure,
                    concurrent_stack,
                    entry,
                    concurrent_scenario,
                    clock,
                    lookup_options={"cache_scope": concurrent_scenario},
                )
                for entry in entries
            ]
            records.extend(future.result() for future in futures)
    finally:
        concurrent_stack.close()

    outcomes = Counter(record["outcome"] for record in records)
    successful = [record for record in records if record["outcome"] == "success"]
    latency = {}
    scenario_names = (*SCENARIOS, concurrent_scenario)
    for scenario in scenario_names:
        values = [
            record["durationMs"]
            for record in successful
            if record["scenario"] == scenario
        ]
        latency[scenario] = {
            "p50": _percentile(values, 0.50),
            "p95": _percentile(values, 0.95),
            "min": round(min(values), 3) if values else None,
            "max": round(max(values), 3) if values else None,
            "samples": len(values),
        }
    total = len(records) or 1
    return {
        "schemaVersion": "biddingflow-muasamcong-benchmark-v2",
        "sampleCount": len(entries),
        "concurrency": worker_count,
        "categories": dict(sorted(Counter(
            entry["category"] for entry in entries
        ).items())),
        "outcomes": dict(sorted(outcomes.items())),
        "driverUsage": _rates(Counter(
            record["driver"] for record in successful
        )),
        "extractorUsage": _rates(Counter(
            record["extractor"] for record in successful
        )),
        "browserModeUsage": _rates(Counter(
            record["browserMode"] for record in successful
        )),
        "latencyMs": latency,
        "interactionRequiredRate": round(
            outcomes.get("interaction-required", 0) * 100 / total, 3
        ),
        "schemaErrorRate": round(
            outcomes.get("schema-error", 0) * 100 / total, 3
        ),
        "counters": {
            field: sum(int(record[field]) for record in records)
            for field in (
                "upstreamRequestCount",
                "partialFailureCount",
                "sessionRefreshCount",
                "browserLaunches",
            )
        },
        "records": records,
    }


class _LiveStack:
    def __init__(self, config):
        self.source = MuaSamCongProcurementSource.from_environ()
        self.shared_cache = PostgresProcurementLookupCache(database=database)
        self.config = config
        self.reset_l1()

    def reset_l1(self):
        self.service = ProcurementLookupService(
            self.source,
            ttl_by_kind=self.config.ttl_by_kind,
            shared_cache=self.shared_cache,
        )

    def snapshot(self):
        return self.source.health()

    def close(self):
        self.source.close()


class _MemorySharedCache:
    def __init__(self):
        self.values = {}

    def get(self, key):
        return deepcopy(self.values.get(key))

    def put(self, key, value, _ttl_seconds):
        self.values[key] = deepcopy(value)


class _FixtureRuntime:
    def __init__(self, artifacts):
        self.artifacts = artifacts

    def lookup(self, code, _kind):
        return deepcopy(self.artifacts[code])


class _FixtureSource:
    name = "MUASAMCONG_FIXTURE"
    parser_version = "benchmark-v2"

    def __init__(self, artifacts):
        self.artifacts = artifacts
        self.canonical = MuaSamCongBrowserSource(
            runtime=_FixtureRuntime(artifacts)
        )

    def lookup(self, code, kind):
        result = self.canonical.lookup(code, kind)
        result.setdefault("metrics", {})["upstreamRequestCount"] = 1
        return result

    def lookup_with_options(
        self,
        code,
        kind,
        *,
        detail_level,
        revision_mode,
        revision_numbers=None,
    ):
        if kind != "PLAN":
            raise ProcurementLookupError("PROCUREMENT_ADAPTER_UNSUPPORTED")
        result = self.lookup(code, kind)
        result["detailLevel"] = detail_level
        result["revisionMode"] = revision_mode
        if detail_level != "COMPLETE":
            return result
        envelope = {
            "operation": "FIXTURE",
            "endpoint": "fixture:artifact",
            "request": {"code": code},
            "response": deepcopy(self.artifacts[code]),
            "success": True,
            "retrievedAt": "fixture",
        }
        bundle = {
            "schemaVersion": "biddingflow-muasamcong-raw-bundle-v2",
            "provider": "MUASAMCONG_FIXTURE",
            "entity": {"kind": "PLAN", "planNo": code},
            "detailLevel": "COMPLETE",
            "revisionMode": revision_mode,
            "sources": {"fixture": envelope},
            "revisions": {},
            "failures": [],
            "complete": True,
            "status": "FOUND_COMPLETE",
            "manifest": {
                "sourceCount": 1,
                "successCount": 1,
                "failedCount": 0,
                "revisions": ["00"],
                "packages": len((result.get("data") or {}).get("packages") or []),
                "operations": ["FIXTURE"],
            },
        }
        result["rawBundle"] = bundle
        result["manifest"] = bundle["manifest"]
        result["metrics"] = {
            "upstream": {"requestCount": 1, "networkMs": 0},
            "totalMs": 0,
        }
        return result


class _FixtureStack:
    def __init__(self, artifacts):
        self.source = _FixtureSource(artifacts)
        self.shared_cache = _MemorySharedCache()
        self.reset_l1()

    def reset_l1(self):
        self.service = ProcurementLookupService(
            self.source, shared_cache=self.shared_cache
        )

    def snapshot(self):
        return {}

    def close(self):
        return None


def _load_entries(path, fixture_mode):
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list) or not payload or len(payload) > 100:
        raise ValueError("Benchmark input must contain 1-100 entries.")
    entries = []
    artifacts = {}
    for item in payload:
        if not isinstance(item, dict):
            raise ValueError("Every benchmark entry must be an object.")
        normalized = normalize_procurement_code(item.get("code"))
        category = str(item.get("category") or "unspecified").strip()
        if not category or len(category) > 64:
            raise ValueError("Invalid benchmark category.")
        entry = {"code": normalized.base_code, "category": category}
        entries.append(entry)
        if fixture_mode:
            fixture = (path.parent / str(item.get("fixture") or "")).resolve()
            if not fixture.is_file():
                raise ValueError(f"Missing fixture for {normalized.base_code}")
            artifacts[normalized.base_code] = json.loads(
                fixture.read_text(encoding="utf-8")
            )
    if len({entry["code"] for entry in entries}) != len(entries):
        raise ValueError("Benchmark codes must be unique.")
    return entries, artifacts


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--concurrency", type=int, default=4)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--live", action="store_true")
    mode.add_argument("--fixtures", action="store_true")
    args = parser.parse_args(argv)

    if not 1 <= args.concurrency <= 16:
        raise ValueError("--concurrency must be between 1 and 16.")
    if args.live and os.environ.get(
        "APP_ENV", "development"
    ).casefold() == "production":
        raise RuntimeError("Live benchmark is disabled in production.")
    entries, artifacts = _load_entries(args.input.resolve(), args.fixtures)
    if args.live and len(entries) < 50:
        raise ValueError("Live benchmark requires 50-100 operator-supplied codes.")
    if args.live:
        config = ProcurementLookupSettings.from_environ()
        if not config.enabled:
            raise RuntimeError(
                "Remove PROCUREMENT_LOOKUP_ENABLED=false or set it to true "
                "for live benchmark."
            )
        stack_factory = lambda: _LiveStack(config)
    else:
        stack_factory = lambda: _FixtureStack(artifacts)
    report = run_benchmark(
        entries,
        stack_factory=stack_factory,
        concurrency=args.concurrency,
    )
    serialized = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True)
    if args.output:
        args.output.write_text(serialized + "\n", encoding="utf-8")
    else:
        print(serialized)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
