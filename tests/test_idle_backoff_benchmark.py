from __future__ import annotations

from scripts.benchmark_idle_backoff import SCENARIOS, simulate


def test_idle_backoff_benchmark_is_reproducible_and_bounded() -> None:
    results = [simulate(scenario, 3600, 20260726) for scenario in SCENARIOS]

    assert [result["backoff_attempts"] for result in results] == [382, 380, 380, 382]
    assert all(result["pickup_delay_max"] <= 10 for result in results)
    assert all(result["pickup_delay_p95"] < 10 for result in results)
    assert results[0]["reduction_percent"] > 89
    assert all(result["reduction_percent"] > 46 for result in results[1:])
