from scripts.benchmark_muasamcong import run_benchmark


def test_benchmark_report_separates_cold_warm_cache_and_usage_rates():
    entries = [
        {"code": "PL2600000001", "category": "plan-normal"},
        {"code": "IB2600000002", "category": "package-open"},
    ]

    class Service:
        def lookup(self, code):
            kind = "PLAN" if code.startswith("PL") else "PACKAGE"
            return {
                "schemaVersion": "biddingflow-procurement-preview-v1",
                "kind": kind,
                "canonicalCode": code,
                "source": {
                    "driver": "vue2" if kind == "PLAN" else "generic",
                    "browserMode": "standard",
                    "extractionStrategy": "network-json",
                },
                "data": {},
            }

    class Stack:
        def __init__(self):
            self.service = Service()

        def warm(self):
            return None

        def close(self):
            return None

    timestamps = iter(index / 10 for index in range(12))
    report = run_benchmark(
        entries,
        stack_factory=Stack,
        clock=lambda: next(timestamps),
    )

    assert report["sampleCount"] == 2
    assert report["categories"] == {"package-open": 1, "plan-normal": 1}
    assert report["latencyMs"]["cold"] == {"p50": 100.0, "p95": 100.0}
    assert report["latencyMs"]["warm"] == {"p50": 100.0, "p95": 100.0}
    assert report["latencyMs"]["cache"] == {"p50": 100.0, "p95": 100.0}
    assert report["driverUsage"] == {"generic": 50.0, "vue2": 50.0}
    assert report["extractorUsage"] == {"network-json": 100.0}
    assert report["outcomes"] == {"success": 6}
    assert report["interactionRequiredRate"] == 0.0
    assert report["schemaErrorRate"] == 0.0
