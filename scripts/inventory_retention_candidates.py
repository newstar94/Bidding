"""Create a read-only inventory for retention decisions; never deletes files."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SCOPES = {
    "data/logs": {
        "owner": "operations",
        "policy": "BLOCKED_DECISION",
        "reason": "Cần chốt thời gian giữ log và PostgreSQL log trước khi dọn.",
    },
    "release": {
        "owner": "release-engineering",
        "policy": "BLOCKED_DECISION",
        "reason": "Có private symbols/provenance; cần chốt cửa sổ N/N-1/N-2.",
    },
    "test-results": {
        "owner": "quality-assurance",
        "policy": "BLOCKED_DECISION",
        "reason": "Cần chốt retention của failure trace và screenshot.",
    },
    "test-artifacts": {
        "owner": "quality-assurance",
        "policy": "BLOCKED_DECISION",
        "reason": "Cần chốt retention của artifact kiểm thử.",
    },
    "dist": {
        "owner": "release-engineering",
        "policy": "review-rebuildable",
        "reason": "Build có thể tái tạo nhưng có thể đang được server cục bộ phục vụ.",
    },
}


def inventory(root: Path) -> dict:
    root = root.resolve()
    if root != PROJECT_ROOT.resolve():
        raise ValueError("Inventory root must be the BiddingFlow repository root.")
    rows = []
    for relative, policy in SCOPES.items():
        target = (root / relative).resolve()
        try:
            target.relative_to(root)
        except ValueError as error:
            raise ValueError(f"Retention target escaped repository: {target}") from error
        files = [path for path in target.rglob("*") if path.is_file()] if target.exists() else []
        rows.append({
            "path": relative,
            "exists": target.exists(),
            "fileCount": len(files),
            "bytes": sum(path.stat().st_size for path in files),
            **policy,
            "action": "inventory-only",
        })
    return {
        "schemaVersion": "biddingflow-retention-inventory-v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "repository": str(root),
        "destructiveActionPerformed": False,
        "entries": rows,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    payload = inventory(PROJECT_ROOT)
    encoded = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        output = args.output.resolve()
        try:
            output.relative_to(PROJECT_ROOT.resolve())
        except ValueError as error:
            raise ValueError("Output must remain inside the repository.") from error
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(encoded, encoding="utf-8")
    else:
        # Windows PowerShell can inherit a legacy CP1252 console even when the
        # payload is valid UTF-8.  Write bytes explicitly so Vietnamese policy
        # text remains lossless and the read-only inventory command cannot fail
        # merely because of the parent console code page.
        sys.stdout.buffer.write(encoded.encode("utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
