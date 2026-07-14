"""Create and verify an online BiddingFlow SQLite backup."""

import argparse
import json
import os
import pathlib
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.db.maintenance import DatabaseMaintenanceError, create_online_backup


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", default=os.environ.get("BIDDING_DB_PATH"))
    parser.add_argument("--backup-dir", default=os.environ.get("BIDDING_BACKUP_DIR"))
    parser.add_argument(
        "--retention",
        type=int,
        default=int(os.environ.get("BIDDING_BACKUP_RETENTION_COUNT", "14")),
    )
    args = parser.parse_args()
    if not args.database or not args.backup_dir:
        parser.error("--database and --backup-dir (or matching environment variables) are required")
    try:
        result = create_online_backup(args.database, args.backup_dir, args.retention)
    except DatabaseMaintenanceError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
