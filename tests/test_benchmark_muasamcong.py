from scripts.benchmark_muasamcong import run_benchmark


def test_benchmark_report_covers_every_required_scenario_and_usage_rate():
    entries = [
        {"code": "PL2600000001", "category": "plan-normal"},
        {"code": "IB2600000002", "category": "package-open"},
    ]

    class Service:
        def lookup(self, code, **_options):
            kind = "PLAN" if code.startswith("PL") else "PACKAGE"
            return {
                "schemaVersion": "biddingflow-procurement-preview-v1",
                "kind": kind,
                "canonicalCode": code,
                "source": {
                    "driver": "vue2" if kind == "PLAN" else "generic",
                    "extractionStrategy": "network-json",
                },
                "data": {},
            }

    class Stack:
        def __init__(self):
            self.service = Service()

        def warm(self):
            return None

        def snapshot(self):
            return {}

        def reset_l1(self):
            return None

        def close(self):
            return None

    ticks = iter(index / 10 for index in range(1000))
    report = run_benchmark(
        entries,
        stack_factory=Stack,
        clock=lambda: next(ticks),
        concurrency=2,
    )

    assert report["sampleCount"] == 2
    assert report["categories"] == {"package-open": 1, "plan-normal": 1}
    assert set(report["latencyMs"]) == {
        "coldWorkerColdSession",
        "warmWorkerColdSession",
        "warmSession",
        "l1Hit",
        "l2Hit",
        "completeLatest",
        "completeAll",
        "concurrentX2",
    }
    assert report["latencyMs"]["completeAll"]["samples"] == 1
    assert report["latencyMs"]["concurrentX2"]["samples"] == 2
    assert report["driverUsage"] == {"generic": 42.857, "vue2": 57.143}
    assert report["extractorUsage"] == {"network-json": 100.0}
    assert report["outcomes"] == {"success": 14}
    assert report["interactionRequiredRate"] == 0.0
    assert report["schemaErrorRate"] == 0.0
    assert report["counters"] == {
        "upstreamRequestCount": 0,
        "partialFailureCount": 0,
        "sessionRefreshCount": 0,
        "browserLaunches": 0,
    }
