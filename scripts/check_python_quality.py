"""Enforce fatal Ruff rules and prevent growth of measured legacy debt."""

from __future__ import annotations

from collections import Counter
import json
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
TARGETS = ("backend", "scripts", "tests")
DEBT_LIMITS = {
    "BLE001": 147,
    "F401": 0,
    "F841": 0,
    "S110": 14,
    "S608": 129,
}


def _run(*arguments):
    return subprocess.run(
        [sys.executable, "-m", "ruff", "check", *TARGETS, *arguments],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


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
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
