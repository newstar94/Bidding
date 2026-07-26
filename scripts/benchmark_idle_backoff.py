"""Reproducible claim-attempt simulation for durable worker idle backoff."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
import random
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.shared.idle_backoff import IdlePollBackoff


@dataclass(frozen=True)
class Scenario:
    name: str
    old_fixed_seconds: float
    initial_seconds: float
    maximum_seconds: float = 10.0


SCENARIOS = (
    Scenario("document_external", 1.0, 1.0),
    Scenario("document_embedded", 5.0, 5.0),
    Scenario("email", 5.0, 5.0),
    Scenario("partner", 5.0, 1.0),
)


def _percentile(values: list[float], percentile: float) -> float:
    ordered = sorted(values)
    index = min(len(ordered) - 1, int((len(ordered) - 1) * percentile))
    return ordered[index]


def simulate(scenario: Scenario, duration_seconds: float, seed: int) -> dict:
    random_source = random.Random(seed).random
    backoff = IdlePollBackoff(
        scenario.initial_seconds,
        scenario.maximum_seconds,
        jitter_ratio=0.1,
        random_fraction=random_source,
    )
    elapsed = 0.0
    delays = []
    while elapsed < duration_seconds:
        delay = backoff.next_delay()
        delays.append(delay)
        elapsed += delay
    fixed_attempts = int(duration_seconds // scenario.old_fixed_seconds)
    attempts = len(delays)
    return {
        "name": scenario.name,
        "fixed_attempts": fixed_attempts,
        "backoff_attempts": attempts,
        "reduction_percent": (1.0 - attempts / fixed_attempts) * 100.0,
        "pickup_delay_p95": _percentile(delays, 0.95),
        "pickup_delay_max": max(delays),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--duration-seconds", type=float, default=3600.0)
    parser.add_argument("--seed", type=int, default=20260726)
    args = parser.parse_args(argv)
    if args.duration_seconds <= 0:
        parser.error("--duration-seconds must be positive")

    print("scenario fixed backoff reduction p95_delay max_delay")
    for scenario in SCENARIOS:
        result = simulate(scenario, args.duration_seconds, args.seed)
        print(
            f"{result['name']} {result['fixed_attempts']} "
            f"{result['backoff_attempts']} {result['reduction_percent']:.1f}% "
            f"{result['pickup_delay_p95']:.3f}s "
            f"{result['pickup_delay_max']:.3f}s"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
