"""Create, verify, or safely restore a BiddingFlow full-state snapshot."""

import argparse
import json
import os
import pathlib
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.db.full_state_backup import (
    FullStateBackupError,
    create_full_state_snapshot,
    restore_full_state_snapshot,
    verify_full_state_snapshot,
)
from backend.shared.paths import DATA_DIR, resolve_runtime_path


def _build_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    create_parser = commands.add_parser(
        "create",
        help="atomically create and verify a new full-state snapshot",
    )
    create_parser.add_argument(
        "--database",
        default=os.environ.get("BIDDING_DB_PATH") or str(DATA_DIR / "bidding.db"),
    )
    create_parser.add_argument(
        "--backup-dir",
        default=str(resolve_runtime_path("BIDDING_BACKUP_DIR")),
    )
    create_parser.add_argument(
        "--uploads",
        default=str(resolve_runtime_path("BIDDING_UPLOAD_DIR")),
    )
    create_parser.add_argument(
        "--word-templates",
        default=str(resolve_runtime_path("BIDDING_WORD_TEMPLATE_DIR")),
    )

    verify_parser = commands.add_parser(
        "verify",
        help="verify the manifest, every checksum, and SQLite integrity",
    )
    verify_parser.add_argument("--snapshot", required=True)

    restore_parser = commands.add_parser(
        "restore",
        help="restore a verified snapshot into a new directory",
    )
    restore_parser.add_argument("--snapshot", required=True)
    restore_parser.add_argument("--destination", required=True)
    return parser


def main(argv=None):
    parser = _build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "create":
            missing = [
                option
                for option, value in (
                    ("--database", args.database),
                    ("--backup-dir", args.backup_dir),
                    ("--uploads", args.uploads),
                    ("--word-templates", args.word_templates),
                )
                if not value
            ]
            if missing:
                parser.error(
                    "create requires "
                    + ", ".join(missing)
                    + " (or the matching BIDDING_* environment variables)"
                )
            result = create_full_state_snapshot(
                args.database,
                args.backup_dir,
                args.uploads,
                args.word_templates,
            )
        elif args.command == "verify":
            result = verify_full_state_snapshot(args.snapshot)
        else:
            result = restore_full_state_snapshot(args.snapshot, args.destination)
    except FullStateBackupError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
