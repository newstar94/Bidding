"""Check that required public legal pages exist and contain no placeholders."""

from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from html import unescape
from pathlib import Path
from typing import Iterable


PROJECT_ROOT = Path(__file__).resolve().parents[1]
LEGAL_PAGES = (
    PROJECT_ROOT / "views" / "legal" / "terms.html",
    PROJECT_ROOT / "views" / "legal" / "privacy.html",
    PROJECT_ROOT / "views" / "legal" / "security.html",
)
_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)
_PUBLIC_PLACEHOLDER = re.compile(
    r"\blegal-placeholder\b|\[TODO(?::[^]]*)?]",
    re.IGNORECASE,
)


@dataclass(frozen=True, slots=True)
class LegalReadinessIssue:
    code: str
    source: str


def evaluate_legal_readiness(
    legal_pages: Iterable[Path] | None = None,
) -> list[LegalReadinessIssue]:
    if legal_pages is None:
        legal_pages = LEGAL_PAGES
    issues: list[LegalReadinessIssue] = []
    for page in legal_pages:
        if not page.is_file():
            issues.append(LegalReadinessIssue("LEGAL_PAGE_MISSING", str(page)))
            continue
        public_copy = _COMMENT.sub("", page.read_text(encoding="utf-8"))
        visible_copy = unescape(re.sub(r"<[^>]+>", "", public_copy)).strip()
        if not visible_copy:
            issues.append(LegalReadinessIssue("LEGAL_PAGE_EMPTY", str(page)))
        if _PUBLIC_PLACEHOLDER.search(public_copy):
            issues.append(LegalReadinessIssue("LEGAL_PLACEHOLDER_PRESENT", str(page)))

    return issues


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--production-public",
        action="store_true",
        help="fail when required legal pages are missing or contain placeholders",
    )
    args = parser.parse_args(argv)
    issues = evaluate_legal_readiness()
    if not issues:
        print("LEGAL_READINESS_OK: required legal pages have no placeholders.")
        return 0

    issue_counts: dict[str, int] = {}
    for issue in issues:
        issue_counts[issue.code] = issue_counts.get(issue.code, 0) + 1
    summary = ", ".join(
        f"{code}={count}" for code, count in sorted(issue_counts.items())
    )
    if args.production_public:
        print(f"LEGAL_READINESS_BLOCKED: {summary}")
        return 1
    print(f"LEGAL_READINESS_WARNING: {summary}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
