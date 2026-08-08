"""Fail CI when source text contains common double-decoded UTF-8 sequences."""

from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOTS = (
    "backend",
    "frontend",
    "shared",
    "tests",
    "scripts",
    "views",
    ".github",
)
TEXT_SUFFIXES = {
    ".cjs", ".css", ".html", ".js", ".json", ".md", ".mjs",
    ".py", ".toml", ".txt", ".yaml", ".yml",
}
EXCLUDED_PARTS = {
    ".git",
    ".pytest_cache",
    ".ruff_cache",
    "__pycache__",
    "coverage",
    "dist",
    "generated",
    "node_modules",
    "playwright-report",
    "release",
    "test-results",
    "vendor",
}
EXCLUDED_FILES = {Path("tests/test_mojibake_guard.py")}

# These signatures target UTF-8 bytes that were decoded as Latin-1/Windows-1252
# and then saved as Unicode. A bare `Ã` is intentionally not forbidden because
# it is valid Vietnamese in words such as `MÃ XÁC THỰC`.
MOJIBAKE_PATTERNS = (
    re.compile(r"Ã[\u00a0-\u00bf\u00e0-\u00ff]"),
    re.compile(r"Ä[\u0080-\uffff]"),
    re.compile(r"á[º»]"),
    re.compile(r"Æ[°±]"),
    re.compile(r"Å[\u00a0-\uffff]"),
    re.compile(r"â[€†œš]"),
    re.compile("\u00ef\u00bb\u00bf"),
    re.compile("\ufeff"),
    re.compile("\ufffd"),
)


def find_mojibake(text: str) -> list[tuple[int, str]]:
    findings: list[tuple[int, str]] = []
    for pattern in MOJIBAKE_PATTERNS:
        findings.extend((match.start(), match.group(0)) for match in pattern.finditer(text))
    return sorted(findings)


def _source_files():
    for root_name in SOURCE_ROOTS:
        source_root = ROOT / root_name
        if not source_root.exists():
            continue
        for path in source_root.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in TEXT_SUFFIXES:
                continue
            relative = path.relative_to(ROOT)
            if relative in EXCLUDED_FILES or EXCLUDED_PARTS.intersection(relative.parts):
                continue
            yield path


def scan_repository() -> list[str]:
    errors: list[str] = []
    for path in _source_files():
        relative = path.relative_to(ROOT)
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError as exc:
            errors.append(f"{relative}: invalid UTF-8 ({exc})")
            continue
        for line_number, line in enumerate(text.splitlines(), start=1):
            for column, token in find_mojibake(line):
                if token == "\ufeff" and line_number == 1 and column == 0:
                    continue
                errors.append(f"{relative}:{line_number}:{column + 1}: {token!r}")
    return errors


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
    errors = scan_repository()
    if errors:
        print("Mojibake guard failed:")
        print("\n".join(f"- {error}" for error in errors))
        return 1
    print("Mojibake guard passed: UTF-8 source text is clean.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
