import json
import subprocess
import sys
from pathlib import Path

from scripts import check_legal_readiness
from scripts.check_legal_readiness import evaluate_legal_readiness


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_legal_readiness_detects_placeholders_and_missing_pages(tmp_path):
    legal_page = tmp_path / "terms.html"
    legal_page.write_text(
        '<span class="legal-placeholder">[TODO: Verified operator]</span>',
        encoding="utf-8",
    )
    missing_page = tmp_path / "privacy.html"

    issues = evaluate_legal_readiness([legal_page, missing_page])

    assert [issue.code for issue in issues] == [
        "LEGAL_PLACEHOLDER_PRESENT",
        "LEGAL_PAGE_MISSING",
    ]


def test_legal_readiness_detects_placeholder_marker_without_todo_text(tmp_path):
    legal_page = tmp_path / "terms.html"
    legal_page.write_text(
        '<span class="legal-placeholder">Nội dung cần bổ sung</span>',
        encoding="utf-8",
    )

    issues = evaluate_legal_readiness([legal_page])

    assert [issue.code for issue in issues] == ["LEGAL_PLACEHOLDER_PRESENT"]


def test_legal_readiness_blocks_page_without_visible_copy(tmp_path):
    legal_page = tmp_path / "terms.html"
    legal_page.write_text("<section><!-- unpublished copy --></section>", encoding="utf-8")

    issues = evaluate_legal_readiness([legal_page])

    assert [issue.code for issue in issues] == ["LEGAL_PAGE_EMPTY"]


def test_legal_readiness_ignores_todo_text_outside_the_legal_contract(tmp_path):
    legal_page = tmp_path / "terms.html"
    legal_page.write_text(
        "<p>Nội dung công khai</p>"
        "<!-- Documentation example: [TODO: this comment is not public copy] -->",
        encoding="utf-8",
    )
    assert evaluate_legal_readiness([legal_page]) == []


def test_legal_cli_blocks_missing_pages_in_public_production(
    tmp_path, monkeypatch, capsys
):
    monkeypatch.setattr(
        check_legal_readiness, "LEGAL_PAGES", (tmp_path / "terms.html",)
    )

    assert check_legal_readiness.main([]) == 0
    assert "LEGAL_READINESS_WARNING: LEGAL_PAGE_MISSING=1" in capsys.readouterr().out
    assert check_legal_readiness.main(["--production-public"]) == 1
    assert "LEGAL_READINESS_BLOCKED: LEGAL_PAGE_MISSING=1" in capsys.readouterr().out


def test_legal_cli_blocks_public_placeholder(tmp_path, monkeypatch, capsys):
    legal_page = tmp_path / "terms.html"
    legal_page.write_text("<p>[TODO: replace this copy]</p>", encoding="utf-8")
    monkeypatch.setattr(check_legal_readiness, "LEGAL_PAGES", (legal_page,))

    assert check_legal_readiness.main(["--production-public"]) == 1
    assert (
        "LEGAL_READINESS_BLOCKED: LEGAL_PLACEHOLDER_PRESENT=1"
        in capsys.readouterr().out
    )


def test_legal_cli_allows_public_production_when_pages_are_ready():
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
    assert "LEGAL_READINESS_OK" in development.stdout
    assert production.returncode == 0
    assert "LEGAL_READINESS_OK" in production.stdout


def test_public_production_package_runs_the_legal_gate_first():
    package = json.loads((PROJECT_ROOT / "package.json").read_text(encoding="utf-8"))

    assert package["scripts"]["check:legal:production"].endswith("--production-public")
    assert package["scripts"]["package:production"].startswith(
        "npm run check:legal:production &&"
    )
