from scripts.benchmark_aggregate_versioning import run_case


def test_aggregate_clone_validation_2001_records_stays_bounded():
    result = run_case(2001)

    assert result["outputItems"] > 2000
    assert result["wallSeconds"] < 5
    assert result["peakMiB"] < 128
