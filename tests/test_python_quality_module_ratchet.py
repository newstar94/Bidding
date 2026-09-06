from pathlib import Path

from scripts.check_python_quality import (
    find_duplicate_top_level_definitions,
    validate_module_debt,
)


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


def test_duplicate_top_level_definition_gate(tmp_path):
    clean = tmp_path / "clean.py"
    clean.write_text("def one():\n    return 1\n", encoding="utf-8")
    assert find_duplicate_top_level_definitions([tmp_path]) == []

    duplicate = tmp_path / "duplicate.py"
    duplicate.write_text(
        "def repeated():\n    return 1\n\ndef repeated():\n    return 2\n",
        encoding="utf-8",
    )
    findings = find_duplicate_top_level_definitions([Path(tmp_path)])
    assert findings == [(duplicate, "repeated", 1, 4)]
