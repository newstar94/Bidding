from __future__ import annotations

import json
import sys
from types import SimpleNamespace

from scripts.check_coverage_thresholds import (
    required_critical_modules,
    validate_coverage,
)
from tests.support import uvicorn_test_server


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


def test_uvicorn_test_server_flushes_subprocess_coverage(monkeypatch):
    calls = []
    active_coverage = SimpleNamespace(
        stop=lambda: calls.append("stop"),
        save=lambda: calls.append("save"),
    )
    fake_coverage = SimpleNamespace(
        Coverage=SimpleNamespace(current=lambda: active_coverage)
    )
    monkeypatch.setitem(sys.modules, "coverage", fake_coverage)

    uvicorn_test_server._flush_subprocess_coverage()

    assert calls == ["stop", "save"]


def test_uvicorn_test_server_starts_exported_subprocess_coverage(monkeypatch):
    calls = []
    fake_coverage = SimpleNamespace(
        Coverage=SimpleNamespace(current=lambda: None),
        process_startup=lambda: calls.append("start"),
    )
    monkeypatch.setenv("COVERAGE_PROCESS_CONFIG", "serialized-config")
    monkeypatch.setitem(sys.modules, "coverage", fake_coverage)

    uvicorn_test_server._start_subprocess_coverage()

    assert calls == ["start"]
