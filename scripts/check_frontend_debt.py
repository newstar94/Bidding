"""Ratchet selected frontend/CSS debt metrics without requiring a bulk rewrite."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BASELINE = {
    "important": 425,
    "raw_colors": 842,
    "runtime_styles": 565,
    "inferred_actions": 6,
    "direct_state_writes": 92,
}

_RAW_COLOR = re.compile(
    r"(?<![-\w])#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch)\s*\(",
)
_DIRECT_STATE_WRITE = re.compile(
    r"\bmodel\.state(?:\[[^\]]+\]|\.[A-Za-z_$][\w$]*)\s*=",
)
_INFERRED_ACTION = re.compile(
    r"\b(?:inferButtonIcon|inferButtonVariant|enhanceButtonSystem)\s*\(",
)


def collect_debt_metrics(root: Path) -> dict[str, int]:
    metrics = {key: 0 for key in BASELINE}
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix not in {".css", ".js"}:
            continue
        text = path.read_text(encoding="utf-8")
        if path.suffix == ".css":
            metrics["important"] += len(re.findall(r"!important\b", text))
            metrics["raw_colors"] += len(_RAW_COLOR.findall(text))
        else:
            metrics["runtime_styles"] += len(re.findall(r"\bsetRuntimeStyle\s*\(", text))
            metrics["inferred_actions"] += len(_INFERRED_ACTION.findall(text))
            metrics["direct_state_writes"] += len(_DIRECT_STATE_WRITE.findall(text))
    return metrics


def validate_debt_metrics(
    metrics: dict[str, int],
    baseline: dict[str, int] = BASELINE,
) -> list[str]:
    return [
        f"{key} increased from {int(baseline.get(key, 0))} to {int(value)}"
        for key, value in metrics.items()
        if int(value) > int(baseline.get(key, 0))
    ]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--print", action="store_true", dest="print_only")
    args = parser.parse_args(argv)
    metrics = {
        key: collect_debt_metrics(PROJECT_ROOT / "views" / "css").get(key, 0)
        for key in ("important", "raw_colors")
    }
    frontend = collect_debt_metrics(PROJECT_ROOT / "frontend")
    metrics.update({
        key: frontend[key]
        for key in ("runtime_styles", "inferred_actions", "direct_state_writes")
    })
    print(json.dumps(metrics, sort_keys=True))
    if args.print_only:
        return 0
    failures = validate_debt_metrics(metrics)
    for failure in failures:
        print(f"FRONTEND_DEBT_INCREASED: {failure}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
