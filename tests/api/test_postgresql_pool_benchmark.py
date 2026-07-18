from scripts.benchmark_postgresql_pool import (
    evaluate_pool_result,
    percentile,
    wait_for_pool_quiescence,
)


THRESHOLDS = {
    "maxErrorRate": 0,
    "maxAcquireTimeouts": 0,
    "maxP95Ms": 750,
    "maxP99Ms": 1500,
}


def _passing_result():
    return {
        "poolSize": 5,
        "errorRate": 0,
        "latencyMs": {"p95": 100, "p99": 200},
        "counterActual": 12,
        "counterExpected": 12,
        "pool": {
            "size": 5,
            "available": 5,
            "in_use": 0,
            "waiting": 0,
            "acquire_timeouts": 0,
        },
    }


def test_pool_benchmark_percentiles_are_deterministic():
    assert percentile(range(1, 101), 0.95) == 95.0
    assert percentile(range(1, 101), 0.99) == 99.0
    assert percentile([], 0.95) == 0.0


def test_pool_result_accepts_zero_error_and_every_connection_returned():
    assert evaluate_pool_result(_passing_result(), THRESHOLDS) == []


def test_pool_result_rejects_timeout_lost_update_latency_and_leak():
    result = _passing_result()
    result["errorRate"] = 0.01
    result["latencyMs"] = {"p95": 751, "p99": 1501}
    result["counterActual"] = 11
    result["pool"].update(
        {"available": 3, "in_use": 2, "waiting": 1, "acquire_timeouts": 1}
    )
    failures = evaluate_pool_result(result, THRESHOLDS)
    assert len(failures) == 7


def test_pool_quiescence_waits_for_background_connection_setup():
    class CompletingPool:
        def __init__(self):
            self.calls = 0

        def pool_stats(self):
            self.calls += 1
            in_use = 1 if self.calls == 1 else 0
            return {
                "size": 5,
                "available": 5 - in_use,
                "in_use": in_use,
                "waiting": 0,
            }

    pool = CompletingPool()
    stats, elapsed_ms = wait_for_pool_quiescence(pool, timeout_seconds=0.1)
    assert pool.calls == 2
    assert stats["in_use"] == 0
    assert elapsed_ms >= 0
