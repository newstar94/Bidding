import json
import subprocess
import sys
from pathlib import Path

from scripts.check_legal_readiness import evaluate_legal_readiness


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_legal_readiness_detects_placeholders_and_missing_facts(tmp_path):
    legal_page = tmp_path / "terms.html"
    legal_page.write_text(
        '<span class="legal-placeholder">[TODO: Verified operator]</span>',
        encoding="utf-8",
    )
    fact_sheet = tmp_path / "facts.md"
    fact_sheet.write_text(
        "| LEGAL-01 | Operator | Legal | — | missing | — | — |\n",
        encoding="utf-8",
    )

    issues = evaluate_legal_readiness([legal_page], fact_sheet)

    assert [issue.code for issue in issues] == [
        "LEGAL_PLACEHOLDER_PRESENT",
        "LEGAL_FACT_UNAPPROVED",
    ]


def test_legal_readiness_ignores_todo_text_outside_the_legal_contract(tmp_path):
    legal_page = tmp_path / "terms.html"
    legal_page.write_text(
        "<!-- Documentation example: [TODO: this comment is not public copy] -->",
        encoding="utf-8",
    )
    fact_sheet = tmp_path / "facts.md"
    fact_sheet.write_text(
        "| LEGAL-01 | Operator | Legal | evidence://approved | approved | 2026-07-30 | Counsel |\n",
        encoding="utf-8",
    )

    assert evaluate_legal_readiness([legal_page], fact_sheet) == []


def test_legal_cli_warns_for_development_and_fails_public_production():
    command = [sys.executable, "scripts/check_legal_readiness.py"]
    development = subprocess.run(
        command,
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    production = subprocess.run(
        [*command, "--production-public"],
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert development.returncode == 0
    assert "LEGAL_READINESS_WARNING" in development.stdout
    assert production.returncode == 1
    assert "LEGAL_READINESS_BLOCKED" in production.stdout


def test_public_production_package_runs_the_legal_gate_first():
    package = json.loads((PROJECT_ROOT / "package.json").read_text(encoding="utf-8"))

    assert package["scripts"]["check:legal:production"].endswith("--production-public")
    assert package["scripts"]["package:production"].startswith(
        "npm run check:legal:production &&"
    )
