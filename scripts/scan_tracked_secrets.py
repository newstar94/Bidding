"""Scan Git-tracked files for high-confidence credential material."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MAX_FILE_BYTES = 8 * 1024 * 1024
SKIPPED_SUFFIXES = {
    ".woff",
    ".woff2",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".ico",
    ".zip",
}
SECRET_PATTERNS = (
    ("private key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),
    ("AWS access key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("Google API key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
    ("GitHub token", re.compile(r"\bgh[pousr]_[0-9A-Za-z]{36,255}\b")),
    ("Slack token", re.compile(r"\bxox[baprs]-[0-9A-Za-z-]{20,}\b")),
)
POSTGRES_CREDENTIAL = re.compile(
    r"postgres(?:ql)?://[^:/@\s]+:([^@\s/]+)@",
    re.IGNORECASE,
)
SAFE_EXAMPLE_MARKERS = (
    "example",
    "placeholder",
    "replace",
    "secret",
    "test",
    "${",
    "{{",
)


def _tracked_files() -> list[Path]:
    completed = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=ROOT,
        check=True,
        capture_output=True,
    )
    return [
        ROOT / item.decode("utf-8")
        for item in completed.stdout.split(b"\0")
        if item
    ]


def main() -> int:
    findings: list[str] = []
    scanned = 0
    for path in _tracked_files():
        if path.resolve() == Path(__file__).resolve():
            continue
        if "tests" in path.relative_to(ROOT).parts:
            continue
        if (
            not path.is_file()
            or path.suffix.casefold() in SKIPPED_SUFFIXES
            or path.stat().st_size > MAX_FILE_BYTES
        ):
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeError:
            continue
        scanned += 1
        relative = path.relative_to(ROOT).as_posix()
        for label, pattern in SECRET_PATTERNS:
            for match in pattern.finditer(content):
                line = content.count("\n", 0, match.start()) + 1
                findings.append(f"{relative}:{line}: {label}")
        for match in POSTGRES_CREDENTIAL.finditer(content):
            credential = match.group(1).casefold()
            if any(marker in credential for marker in SAFE_EXAMPLE_MARKERS):
                continue
            line = content.count("\n", 0, match.start()) + 1
            findings.append(f"{relative}:{line}: embedded PostgreSQL password")
    if findings:
        print("Tracked-secret scan failed:")
        for finding in findings:
            print(f"  {finding}")
        return 1
    print(f"Tracked-secret scan passed ({scanned} text files).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
