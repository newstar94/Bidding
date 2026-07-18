"""Run the reproducible checks required before creating a release candidate.

The same stages are used by GitHub Actions and by developers locally.  Every
pytest base directory is created outside the source tree so production path
guards do not confuse a synced checkout (for example, OneDrive) with the
isolated test runtime.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
FILE_SYNC_MARKERS = ("onedrive", "dropbox", "google drive", "icloud")
DATA_SAFETY_TESTS = (
    "tests/api/test_schema_rebuild_safety.py",
    "tests/api/test_database_maintenance.py",
    "tests/api/test_full_state_backup.py",
)


@dataclass(frozen=True)
class Check:
    label: str
    command: tuple[str, ...]


def _npm_executable() -> str:
    executable = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not executable:
        raise RuntimeError("npm is required for the release preflight.")
    return executable


def _run(check: Check, environment: dict[str, str] | None = None) -> None:
    print(f"\n==> {check.label}", flush=True)
    result = subprocess.run(
        check.command,
        cwd=PROJECT_ROOT,
        env=environment,
        check=False,
    )
    if result.returncode:
        raise RuntimeError(
            f"Release preflight failed at '{check.label}' (exit {result.returncode})."
        )


def _npm_check(label: str, script: str) -> Check:
    return Check(label, (_npm_executable(), "run", script))


def _python_check(label: str, *arguments: str) -> Check:
    return Check(label, (sys.executable, *arguments))


def run_quality_stage() -> None:
    checks = (
        _npm_check("JavaScript and Python lint", "lint"),
        _python_check("Python bytecode compilation", "-m", "compileall", "-q", "backend", "scripts"),
        _npm_check("Frontend unit tests", "test:unit"),
        _npm_check("Module reference audit", "audit:modules"),
        _npm_check("Source-size audit", "audit:size"),
        _npm_check("Dead-code audit", "audit:dead"),
        _npm_check("Accessibility audit", "audit:a11y"),
        _npm_check("Inline-style audit", "audit:styles"),
    )
    for check in checks:
        _run(check)


def _assert_isolated_base(path: Path) -> None:
    resolved = path.resolve()
    try:
        resolved.relative_to(PROJECT_ROOT)
    except ValueError:
        pass
    else:
        raise RuntimeError("Pytest base directory must be outside the source tree.")
    if any(marker in str(resolved).casefold() for marker in FILE_SYNC_MARKERS):
        raise RuntimeError("Pytest base directory must not be inside a file-sync path.")


def run_api_stage() -> None:
    with tempfile.TemporaryDirectory(prefix="biddingflow-release-pytest-") as directory:
        runtime_root = Path(directory).resolve()
        _assert_isolated_base(runtime_root)
        data_base = runtime_root / "data-safety"
        api_base = runtime_root / "api"
        environment = os.environ.copy()
        environment.update({
            "APP_ENV": "test",
            "PYTHONDONTWRITEBYTECODE": "1",
        })
        _run(
            _python_check(
                "Migration and backup/restore smoke tests",
                "-m",
                "pytest",
                *DATA_SAFETY_TESTS,
                f"--basetemp={data_base}",
                "-q",
            ),
            environment,
        )
        _run(
            _python_check(
                "Complete API regression suite",
                "-m",
                "pytest",
                "tests/api",
                f"--basetemp={api_base}",
                "-q",
            ),
            environment,
        )


def run_security_stage() -> None:
    _run(_npm_check("Dependency, vendor and secret audits", "audit:dependencies"))
    _run(_npm_check("Reproducible software bills of materials", "sbom"))


def run_package_stage(artifact: Path | None = None) -> None:
    _run(_npm_check("Secure frontend build", "build:secure"))
    _run(_npm_check("Extracted production-package smoke test", "audit:package"))
    if artifact is not None:
        artifact = artifact.resolve()
        try:
            artifact.relative_to(PROJECT_ROOT)
        except ValueError as exc:
            raise RuntimeError("Release artifact must be written inside the source tree.") from exc
        _run(
            _python_check(
                "Production release-candidate archive",
                "scripts/package_production.py",
                "--output",
                str(artifact),
            )
        )


def run_e2e_stage() -> None:
    with tempfile.TemporaryDirectory(prefix="biddingflow-release-playwright-") as directory:
        runtime_root = Path(directory).resolve()
        _assert_isolated_base(runtime_root)
        environment = os.environ.copy()
        environment.update(
            {
                "PLAYWRIGHT_OUTPUT_DIR": str(runtime_root / "test-results"),
                "PLAYWRIGHT_HTML_REPORT": str(runtime_root / "html-report"),
            }
        )
        _run(
            _npm_check("Isolated cross-browser end-to-end tests", "test:e2e"),
            environment,
        )


STAGES = {
    "quality": run_quality_stage,
    "api": run_api_stage,
    "security": run_security_stage,
    "e2e": run_e2e_stage,
}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "stage",
        choices=("all", "quality", "api", "security", "package", "e2e"),
        help="preflight stage to execute",
    )
    parser.add_argument(
        "--artifact",
        type=Path,
        help="when running package/all, keep the validated release archive at this path",
    )
    args = parser.parse_args(argv)
    try:
        if args.stage == "all":
            run_quality_stage()
            run_api_stage()
            run_security_stage()
            run_package_stage(args.artifact)
            run_e2e_stage()
        elif args.stage == "package":
            run_package_stage(args.artifact)
        else:
            STAGES[args.stage]()
    except (OSError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(f"\nRelease preflight stage '{args.stage}' passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
