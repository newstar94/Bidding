"""Run full integrity and foreign-key checks for a BiddingFlow SQLite file."""

import argparse
import json
import os
import pathlib
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.db.maintenance import DatabaseMaintenanceError, inspect_database


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", default=os.environ.get("BIDDING_DB_PATH"))
    args = parser.parse_args()
    if not args.database:
        parser.error("--database or BIDDING_DB_PATH is required")
    try:
        result = inspect_database(args.database)
    except DatabaseMaintenanceError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
