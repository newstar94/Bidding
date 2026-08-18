import json

from scripts.check_critical_coverage import THRESHOLDS, check_coverage


def test_critical_coverage_gate_requires_every_owned_module(tmp_path):
    report = tmp_path / "coverage.json"
    report.write_text(json.dumps({"files": {}}), encoding="utf-8")

    errors = check_coverage(report)

    assert len(errors) == len(THRESHOLDS)
    assert all("missing from coverage report" in error for error in errors)


def test_critical_coverage_floors_cannot_drop_below_reviewed_risk_baseline():
    reviewed = {
        "backend/shared/access_policy.py": (55.0, 40.0),
        "backend/sync/service.py": (35.0, 25.0),
        "backend/sync/restore_service.py": (65.0, 45.0),
        "backend/shared/audit_monitor.py": (10.0, 0.0),
        "backend/sync/websocket.py": (30.0, 20.0),
        "backend/lot_lifecycle_routes.py": (8.0, 0.0),
        "backend/documents/document_worker.py": (40.0, 15.0),
        "backend/documents/package_document_routes.py": (12.0, 3.0),
        "backend/shared/media_helper.py": (45.0, 30.0),
        "backend/sync/conflict_projection.py": (100.0, 100.0),
        "backend/sync/delta_paging.py": (45.0, 30.0),
        "backend/sync/evaluation_persistence.py": (85.0, 60.0),
        "backend/versioning/aggregate_snapshot.py": (80.0, 60.0),
        "backend/versioning/command.py": (85.0, 70.0),
        "backend/versioning/repository.py": (92.0, 65.0),
        "backend/versioning/service.py": (65.0, 45.0),
    }

    assert THRESHOLDS.keys() == reviewed.keys()
    for module, minimums in reviewed.items():
        assert THRESHOLDS[module][0] >= minimums[0]
        assert THRESHOLDS[module][1] >= minimums[1]
