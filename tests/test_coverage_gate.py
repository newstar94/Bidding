from __future__ import annotations

import json

from scripts.check_coverage_thresholds import (
    required_critical_modules,
    validate_coverage,
)


def _report(overall, critical=95):
    files = {}
    for name in required_critical_modules():
        files[name] = {
            "summary": {
                "covered_lines": critical,
                "num_statements": 100,
                "covered_branches": critical,
                "num_branches": 100,
            }
        }
    return {"totals": {"percent_covered": overall}, "files": files}


def test_coverage_gate_accepts_approved_thresholds(tmp_path):
    report = tmp_path / "coverage.json"
    report.write_text(json.dumps(_report(71)), encoding="utf-8")
    assert validate_coverage(report) == []


def test_coverage_gate_reports_total_critical_and_missing_modules(tmp_path):
    payload = _report(69, critical=89)
    payload["files"].pop("backend/sync/websocket.py")
    report = tmp_path / "coverage.json"
    report.write_text(json.dumps(payload), encoding="utf-8")
    failures = validate_coverage(report)
    assert any("backend total" in failure for failure in failures)
    assert any("auth_routes.py" in failure for failure in failures)
    assert any("missing" in failure for failure in failures)
