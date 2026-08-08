"""Risk-based line/branch coverage ratchet for critical backend modules."""

from __future__ import annotations

import json
import pathlib
import sys


# Owner: platform/security. Values are the reviewed 2026-07-30 baseline and
# may only move upward as route-level integration coverage expands.
THRESHOLDS = {
    "backend/shared/access_policy.py": (40.0, 30.0),
    "backend/sync/service.py": (30.0, 20.0),
    "backend/sync/restore_service.py": (55.0, 40.0),
    "backend/shared/audit_monitor.py": (8.0, 0.0),
    "backend/sync/websocket.py": (12.0, 2.0),
    "backend/lot_lifecycle_routes.py": (5.0, 0.0),
    "backend/documents/document_worker.py": (20.0, 5.0),
    "backend/documents/package_document_routes.py": (10.0, 1.0),
    "backend/shared/media_helper.py": (35.0, 20.0),
    "backend/sync/conflict_projection.py": (95.0, 90.0),
    "backend/sync/delta_paging.py": (40.0, 25.0),
    "backend/versioning/aggregate_snapshot.py": (70.0, 55.0),
    "backend/versioning/command.py": (80.0, 60.0),
    "backend/versioning/repository.py": (90.0, 55.0),
    "backend/versioning/service.py": (60.0, 40.0),
}


def check_coverage(report_path: pathlib.Path) -> list[str]:
    report = json.loads(report_path.read_text(encoding="utf-8"))
    files = {
        name.replace("\\", "/"): value
        for name, value in report.get("files", {}).items()
    }
    errors = []
    for filename, (minimum_line, minimum_branch) in THRESHOLDS.items():
        summary = files.get(filename, {}).get("summary")
        if not summary:
            errors.append(f"{filename}: missing from coverage report")
            continue
        line = 100.0 * int(summary["covered_lines"]) / max(1, int(summary["num_statements"]))
        branches = int(summary.get("num_branches") or 0)
        branch = 100.0 * int(summary.get("covered_branches") or 0) / max(1, branches)
        if line + 1e-9 < minimum_line:
            errors.append(f"{filename}: line {line:.1f}% < {minimum_line:.1f}%")
        if branch + 1e-9 < minimum_branch:
            errors.append(f"{filename}: branch {branch:.1f}% < {minimum_branch:.1f}%")
    return errors


def main(argv=None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    report_path = pathlib.Path(arguments[0] if arguments else "coverage.json")
    errors = check_coverage(report_path)
    if errors:
        print("Critical coverage ratchet failed:")
        print("\n".join(f"- {error}" for error in errors))
        return 1
    print(f"Critical coverage ratchet passed ({len(THRESHOLDS)} modules).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
