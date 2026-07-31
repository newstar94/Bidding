"""Validate that public legal copy is backed by approved operational facts."""

from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


PROJECT_ROOT = Path(__file__).resolve().parents[1]
LEGAL_PAGES = (
    PROJECT_ROOT / "views" / "legal" / "terms.html",
    PROJECT_ROOT / "views" / "legal" / "privacy.html",
    PROJECT_ROOT / "views" / "legal" / "security.html",
)
FACT_SHEET = PROJECT_ROOT / "docs" / "legal-fact-sheet.md"

_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)
_PUBLIC_PLACEHOLDER = re.compile(
    r"<span\b[^>]*\bclass=[\"'][^\"']*\blegal-placeholder\b[^\"']*[\"'][^>]*>"
    r"\s*\[TODO(?::[^]]*)?]\s*</span>",
    re.IGNORECASE | re.DOTALL,
)
_FACT_ID = re.compile(r"^LEGAL-\d{2}$")


@dataclass(frozen=True, slots=True)
class LegalReadinessIssue:
    code: str
    source: str
    fact_id: str | None = None


def _fact_rows(fact_sheet: Path) -> list[list[str]]:
    if not fact_sheet.is_file():
        return []
    rows = []
    for line in fact_sheet.read_text(encoding="utf-8").splitlines():
        values = [value.strip() for value in line.strip().strip("|").split("|")]
        if values and _FACT_ID.fullmatch(values[0]):
            rows.append(values)
    return rows


def evaluate_legal_readiness(
    legal_pages: Iterable[Path] = LEGAL_PAGES,
    fact_sheet: Path = FACT_SHEET,
) -> list[LegalReadinessIssue]:
    issues: list[LegalReadinessIssue] = []
    for page in legal_pages:
        if not page.is_file():
            issues.append(LegalReadinessIssue("LEGAL_PAGE_MISSING", str(page)))
            continue
        public_copy = _COMMENT.sub("", page.read_text(encoding="utf-8"))
        for _match in _PUBLIC_PLACEHOLDER.finditer(public_copy):
            issues.append(LegalReadinessIssue("LEGAL_PLACEHOLDER_PRESENT", str(page)))

    rows = _fact_rows(fact_sheet)
    if not rows:
        issues.append(LegalReadinessIssue("LEGAL_FACT_SHEET_MISSING", str(fact_sheet)))
        return issues
    for row in rows:
        status = row[4].lower() if len(row) > 4 else "missing"
        if status != "approved":
            issues.append(
                LegalReadinessIssue(
                    "LEGAL_FACT_UNAPPROVED",
                    str(fact_sheet),
                    fact_id=row[0],
                )
            )
    return issues


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--production-public",
        action="store_true",
        help="fail when public legal facts are not approved",
    )
    args = parser.parse_args(argv)
    issues = evaluate_legal_readiness()
    if not issues:
        print("LEGAL_READINESS_OK: public legal facts are approved.")
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
