"""Fail the release gate when backend coverage drops below approved thresholds."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
NAMED_CRITICAL_MODULES = (
    "backend/auth/auth_routes.py",
    "backend/auth/admin_user_routes.py",
)


def required_critical_modules(repository_root: Path = REPOSITORY_ROOT) -> tuple[str, ...]:
    sync_root = repository_root / "backend" / "sync"
    sync_modules = tuple(
        f"backend/sync/{path.name}"
        for path in sorted(sync_root.glob("*.py"))
        if path.name != "__init__.py"
    )
    return NAMED_CRITICAL_MODULES + sync_modules


def _combined_percent(summary: dict) -> float:
    covered = int(summary.get("covered_lines", 0)) + int(summary.get("covered_branches", 0))
    total = int(summary.get("num_statements", 0)) + int(summary.get("num_branches", 0))
    return 100.0 if total == 0 else (covered / total) * 100.0


def _normalize(path: str) -> str:
    return path.replace("\\", "/")


def validate_coverage(
    report_path: Path,
    *,
    overall_minimum: float = 70.0,
    critical_minimum: float = 90.0,
) -> list[str]:
    payload = json.loads(report_path.read_text(encoding="utf-8"))
    failures = []
    overall = float(payload.get("totals", {}).get("percent_covered", 0.0))
    if overall < overall_minimum:
        failures.append(f"backend total {overall:.2f}% < {overall_minimum:.2f}%")

    files = {_normalize(name): data for name, data in payload.get("files", {}).items()}
    for module in required_critical_modules():
        entry = files.get(module)
        if entry is None:
            failures.append(f"critical module missing from coverage report: {module}")
            continue
        percentage = _combined_percent(entry.get("summary", {}))
        if percentage < critical_minimum:
            failures.append(f"{module} {percentage:.2f}% < {critical_minimum:.2f}%")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("report", nargs="?", default="coverage.json")
    parser.add_argument("--overall", type=float, default=70.0)
    parser.add_argument("--critical", type=float, default=90.0)
    args = parser.parse_args()
    failures = validate_coverage(
        Path(args.report),
        overall_minimum=args.overall,
        critical_minimum=args.critical,
    )
    if failures:
        print("Coverage release gate failed:")
        for failure in failures:
            print(f"- {failure}")
        return 1
    print(
        f"Coverage release gate passed (backend >= {args.overall:.0f}%, "
        f"critical modules >= {args.critical:.0f}%)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
