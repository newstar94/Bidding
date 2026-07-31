import json

from scripts.check_critical_coverage import THRESHOLDS, check_coverage


def test_critical_coverage_gate_requires_every_owned_module(tmp_path):
    report = tmp_path / "coverage.json"
    report.write_text(json.dumps({"files": {}}), encoding="utf-8")

    errors = check_coverage(report)

    assert len(errors) == len(THRESHOLDS)
    assert all("missing from coverage report" in error for error in errors)
