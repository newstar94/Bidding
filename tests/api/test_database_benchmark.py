from scripts.benchmark_database import run_benchmark


def test_write_amplification_benchmark_compares_identical_targeted_and_legacy_state(
    tmp_path,
):
    result = run_benchmark(
        tmp_path / "write-amplification.db",
        plans=20,
        packages=100,
        rounds=1,
    )

    comparison = result["measurements"]["writeAmplification"]
    optimized = comparison["optimized"]
    legacy = comparison["legacyWholeTenant"]

    assert optimized["packageRowsMatched"] == 1
    assert optimized["planRowsMatched"] == 1
    assert optimized["syncVersionAllocated"] == 2
    assert legacy["packageRowsMatched"] == 200
    assert legacy["planRowsMatched"] == 20
    assert legacy["syncVersionAllocated"] == 220
    assert optimized["wal"]["frames"] < legacy["wal"]["frames"]
