"""Enforce fatal Ruff rules and prevent growth of measured legacy debt."""

from __future__ import annotations

from collections import Counter
import json
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
TARGETS = ("backend", "scripts", "tests")
MODULE_BASELINE_PATH = ROOT / "scripts" / "python_quality_module_baseline.json"
MODULE_RATCHET_CODES = {"BLE001", "S608"}
DEBT_LIMITS = {
    "BLE001": 117,
    "F401": 0,
    "F841": 0,
    "S110": 0,
    "S608": 127,
}


def _run(*arguments):
    return subprocess.run(
        [sys.executable, "-m", "ruff", "check", *TARGETS, *arguments],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


def validate_module_debt(findings, baseline, *, root=ROOT):
    counts = Counter()
    for item in findings:
        code = str(item.get("code") or "")
        if code not in MODULE_RATCHET_CODES:
            continue
        filename = Path(str(item.get("filename") or ""))
        if root is not None:
            try:
                filename = filename.resolve().relative_to(Path(root).resolve())
            except ValueError:
                pass
        counts[(code, filename.as_posix())] += 1

    failures = []
    for code in sorted(MODULE_RATCHET_CODES):
        expected_files = baseline.get(code, {})
        paths = set(expected_files).union(
            path for finding_code, path in counts if finding_code == code
        )
        for path in sorted(paths):
            expected = int(expected_files.get(path, 0))
            actual = counts[(code, path)]
            if actual > expected:
                failures.append(f"{code} {path} increased from {expected} to {actual}")
            elif actual < expected:
                failures.append(
                    f"{code} {path} baseline is stale from {expected} to {actual}; lower it"
                )
    return failures


def main():
    fatal = _run("--select", "E9,F63,F7,F82", "--output-format", "concise")
    if fatal.returncode:
        sys.stderr.write(fatal.stdout + fatal.stderr)
        return fatal.returncode

    measured = _run(
        "--select",
        ",".join(DEBT_LIMITS),
        "--output-format",
        "json",
        "--exit-zero",
    )
    findings = json.loads(measured.stdout or "[]")
    counts = Counter(item["code"] for item in findings)
    module_baseline = json.loads(MODULE_BASELINE_PATH.read_text(encoding="utf-8"))
    module_failures = validate_module_debt(findings, module_baseline)
    exceeded = {
        code: {"count": counts[code], "limit": limit}
        for code, limit in DEBT_LIMITS.items()
        if counts[code] > limit
    }
    print(
        "Python quality baseline: "
        + ", ".join(f"{code}={counts[code]}/{limit}" for code, limit in DEBT_LIMITS.items())
    )
    if exceeded:
        sys.stderr.write(
            "Python legacy-debt baseline increased: "
            + json.dumps(exceeded, sort_keys=True)
            + "\n"
        )
    for failure in module_failures:
        sys.stderr.write(f"Python module-debt baseline changed: {failure}\n")
    return 1 if exceeded or module_failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
