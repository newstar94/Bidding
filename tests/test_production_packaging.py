from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

from scripts import package_production


PROJECT_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def packaging_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    for directory_name in ("backend", "views", "deploy"):
        shutil.copytree(PROJECT_ROOT / directory_name, tmp_path / directory_name)

    asset = tmp_path / "dist" / "assets" / "app-12345678.js"
    asset.parent.mkdir(parents=True)
    asset.write_text("export const ready = true;\n", encoding="utf-8")
    manifest = tmp_path / "dist" / ".vite" / "manifest.json"
    manifest.parent.mkdir(parents=True)
    manifest.write_text(
        json.dumps({
            "frontend/app/app.js": {
                "file": "assets/app-12345678.js",
                "isEntry": True,
            }
        }),
        encoding="utf-8",
    )
    (tmp_path / "dist" / "secure-build.json").write_text(
        json.dumps({"version": 2, "deadCodeInjection": False}),
        encoding="utf-8",
    )

    for relative_name in package_production.RUNTIME_FILES:
        source = PROJECT_ROOT / relative_name
        destination = tmp_path / relative_name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)

    monkeypatch.setattr(package_production, "PROJECT_ROOT", tmp_path)
    return tmp_path


def _build_test_archive(packaging_root: Path) -> Path:
    archive_path = packaging_root / "biddingflow-production.zip"
    package_production.build_archive(archive_path)
    return archive_path


def test_packaged_operational_scripts_can_be_imported(
    packaging_root: Path,
    tmp_path: Path,
) -> None:
    archive_path = _build_test_archive(packaging_root)
    extracted = tmp_path / "extracted"
    with zipfile.ZipFile(archive_path) as archive:
        archive.extractall(extracted)

    environment = os.environ.copy()
    environment["PYTHONPATH"] = str(extracted)
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "import scripts.backup; "
                "import scripts.configure_database_roles; "
                "import scripts.manage_database"
            ),
        ],
        cwd=extracted,
        env=environment,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=30,
        check=False,
    )

    assert result.returncode == 0, result.stderr


def test_packaged_hashed_entry_uses_one_canonical_module_url(
    packaging_root: Path,
) -> None:
    environment = os.environ.copy()
    environment.update({
        "APP_ENV": "test",
        "APP_DEBUG": "False",
        "APP_SECURE_COOKIES": "False",
        "PYTHONPATH": str(packaging_root),
    })
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "from pathlib import Path; "
                "from backend.app import compile_html; "
                "html = compile_html(Path('views/index.html')); "
                "assert '<script type=\"module\" src=\"/dist/assets/app-12345678.js\"></script>' in html, html"
            ),
        ],
        cwd=packaging_root,
        env=environment,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )

    assert result.returncode == 0, result.stderr


def test_packaged_alert_runbooks_resolve_inside_archive(
    packaging_root: Path,
) -> None:
    archive_path = _build_test_archive(packaging_root)
    with zipfile.ZipFile(archive_path) as archive:
        names = set(archive.namelist())
        alerts = archive.read(
            "deploy/prometheus/biddingflow-alerts.yml"
        ).decode("utf-8")

    runbook_paths = set(re.findall(r'runbook:\s*"([^"#]+)', alerts))
    assert runbook_paths
    assert runbook_paths <= names


@pytest.mark.parametrize(
    "forbidden_directory",
    [
        ".claude",
        ".codex",
        ".hallmark",
        ".pytest_cache",
        ".vscode",
        "agent",
        "data",
        "docs",
        "security",
    ],
)
def test_packager_rejects_internal_directory_even_if_allowlisted(
    packaging_root: Path,
    monkeypatch: pytest.MonkeyPatch,
    forbidden_directory: str,
) -> None:
    internal_file = packaging_root / forbidden_directory / "private.txt"
    internal_file.parent.mkdir(parents=True, exist_ok=True)
    internal_file.write_text("must not ship", encoding="utf-8")
    monkeypatch.setattr(
        package_production,
        "RUNTIME_DIRECTORIES",
        {
            **package_production.RUNTIME_DIRECTORIES,
            forbidden_directory: lambda path: path.is_file(),
        },
    )

    with pytest.raises(RuntimeError, match="Forbidden production path"):
        package_production.collect_runtime_files()
