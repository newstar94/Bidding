from scripts.check_python_quality import validate_module_debt


def test_module_debt_ratchet_rejects_shifting_findings_between_files():
    baseline = {
        "BLE001": {"backend/a.py": 1, "backend/b.py": 1},
        "S608": {},
    }
    findings = [
        {"code": "BLE001", "filename": "backend/a.py"},
        {"code": "BLE001", "filename": "backend/a.py"},
    ]

    failures = validate_module_debt(findings, baseline, root=None)

    assert any("backend/a.py" in failure and "1 to 2" in failure for failure in failures)
    assert any("backend/b.py" in failure and "1 to 0" in failure for failure in failures)
