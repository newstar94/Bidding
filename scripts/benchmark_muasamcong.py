"""Benchmark 50-100 operator-supplied PL/IB lookups without enumeration."""

from __future__ import annotations

import argparse
from collections import Counter
from copy import deepcopy
import json
import math
import os
from pathlib import Path
import time

from backend.integrations.muasamcong_browser.launchers import (
    BrowserLauncherFactory,
)
from backend.integrations.muasamcong_browser.source import MuaSamCongBrowserSource
from backend.procurement_import.domain import normalize_procurement_code
from backend.procurement_lookup.domain import ProcurementLookupError
from backend.procurement_lookup.config import ProcurementLookupSettings
from backend.procurement_lookup.service import ProcurementLookupService


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
    }.get(code, "upstream-error")


def _measure(stack, entry, phase, clock):
    started = clock()
    try:
        result = stack.service.lookup(entry["code"])
        duration_ms = round(max(0, clock() - started) * 1000, 3)
        source = result.get("source") or {}
        return {
            "phase": phase,
            "code": entry["code"],
            "category": entry["category"],
            "outcome": "success",
            "durationMs": duration_ms,
            "driver": str(source.get("driver") or "unknown"),
            "extractor": str(source.get("extractionStrategy") or "unknown"),
            "browserMode": str(source.get("browserMode") or "unknown"),
        }
    except ProcurementLookupError as error:
        duration_ms = round(max(0, clock() - started) * 1000, 3)
        return {
            "phase": phase,
            "code": entry["code"],
            "category": entry["category"],
            "outcome": _outcome(error),
            "durationMs": duration_ms,
            "driver": "unknown",
            "extractor": "unknown",
            "browserMode": "unknown",
        }


def run_benchmark(entries, *, stack_factory, clock=time.perf_counter):
    records = []
    for entry in entries:
        stack = stack_factory()
        try:
            records.append(_measure(stack, entry, "cold", clock))
        finally:
            stack.close()

    warm_stack = stack_factory()
    try:
        warm_stack.warm()
        records.extend(
            _measure(warm_stack, entry, "warm", clock) for entry in entries
        )
        records.extend(
            _measure(warm_stack, entry, "cache", clock) for entry in entries
        )
    finally:
        warm_stack.close()

    outcomes = Counter(record["outcome"] for record in records)
    successful = [record for record in records if record["outcome"] == "success"]
    driver_usage = Counter(record["driver"] for record in successful)
    extractor_usage = Counter(record["extractor"] for record in successful)
    browser_modes = Counter(record["browserMode"] for record in successful)
    latency = {}
    for phase in ("cold", "warm", "cache"):
        values = [
            record["durationMs"]
            for record in records
            if record["phase"] == phase and record["outcome"] == "success"
        ]
        latency[phase] = {
            "p50": _percentile(values, 0.50),
            "p95": _percentile(values, 0.95),
        }
    total = len(records) or 1
    return {
        "schemaVersion": "biddingflow-muasamcong-benchmark-v1",
        "sampleCount": len(entries),
        "categories": dict(sorted(Counter(
            entry["category"] for entry in entries
        ).items())),
        "outcomes": dict(sorted(outcomes.items())),
        "driverUsage": _rates(driver_usage),
        "extractorUsage": _rates(extractor_usage),
        "browserModeUsage": _rates(browser_modes),
        "latencyMs": latency,
        "interactionRequiredRate": round(
            outcomes.get("interaction-required", 0) * 100 / total, 3
        ),
        "schemaErrorRate": round(
            outcomes.get("schema-error", 0) * 100 / total, 3
        ),
        "records": records,
    }


class _LiveStack:
    def __init__(self, config):
        self.launcher = BrowserLauncherFactory.create(
            config.mode,
            **config.launcher_options,
        )
        self.service = ProcurementLookupService(
            MuaSamCongBrowserSource(launcher=self.launcher),
            ttl_by_kind=config.ttl_by_kind,
        )

    def warm(self):
        self.launcher.get_runtime()

    def close(self):
        self.launcher.close()


class _FixtureRuntime:
    def __init__(self, artifacts):
        self.artifacts = artifacts

    def lookup(self, code, _kind):
        return deepcopy(self.artifacts[code])


class _FixtureStack:
    def __init__(self, artifacts):
        self.service = ProcurementLookupService(
            MuaSamCongBrowserSource(runtime=_FixtureRuntime(artifacts))
        )

    def warm(self):
        return None

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
        raise ValueError("Benchmark codes must be unique; cache phase repeats them explicitly.")
    return entries, artifacts


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--live", action="store_true")
    mode.add_argument("--fixtures", action="store_true")
    args = parser.parse_args(argv)

    if args.live and os.environ.get("APP_ENV", "development").casefold() == "production":
        raise RuntimeError("Live benchmark is disabled in production.")
    entries, artifacts = _load_entries(args.input.resolve(), args.fixtures)
    if args.live and len(entries) < 50:
        raise ValueError("Live benchmark requires 50-100 operator-supplied codes.")
    if args.live:
        config = ProcurementLookupSettings.from_environ()
        if not config.enabled:
            raise RuntimeError("Set PROCUREMENT_LOOKUP_ENABLED=true for live benchmark.")
        stack_factory = lambda: _LiveStack(config)
    else:
        stack_factory = lambda: _FixtureStack(artifacts)
    report = run_benchmark(entries, stack_factory=stack_factory)
    serialized = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True)
    if args.output:
        args.output.write_text(serialized + "\n", encoding="utf-8")
    else:
        print(serialized)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
