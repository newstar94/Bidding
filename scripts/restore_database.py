"""Verify and restore a BiddingFlow SQLite backup."""

import argparse
import json
import pathlib
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.db.maintenance import DatabaseMaintenanceError, restore_database


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backup", required=True)
    parser.add_argument("--destination", required=True)
    parser.add_argument(
        "--replace",
        action="store_true",
        help="replace a stopped database; rehearsal restores should omit this",
    )
    args = parser.parse_args()
    try:
        result = restore_database(args.backup, args.destination, replace=args.replace)
    except DatabaseMaintenanceError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
