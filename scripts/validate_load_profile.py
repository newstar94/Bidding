"""Validate BiddingFlow k6 profiles without contacting an application server."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.load_profile import (
    LoadProfileError,
    build_execution_plan,
    load_profile,
    validate_runtime_inputs,
)


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description=(
            "Validate a load profile and emit a redacted machine-readable plan. "
            "No network request is made."
        )
    )
    parser.add_argument("profile", type=Path, help="JSON profile to validate")
    parser.add_argument("--output", type=Path, help="Write the plan to this JSON file")
    parser.add_argument(
        "--runtime-inputs",
        action="store_true",
        help="Also validate staging-only credential/fixture files",
    )
    parser.add_argument("--sessions-file", type=Path)
    parser.add_argument("--login-users-file", type=Path)
    parser.add_argument("--upload-fixture", type=Path)
    parser.add_argument("--sync-fixture", type=Path)
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    try:
        profile = load_profile(args.profile)
        runtime = None
        if args.runtime_inputs:
            runtime = validate_runtime_inputs(
                profile,
                sessions_path=args.sessions_file,
                login_users_path=args.login_users_file,
                upload_fixture_path=args.upload_fixture,
                sync_fixture_path=args.sync_fixture,
            )
        plan = build_execution_plan(profile, runtime=runtime)
    except LoadProfileError as exc:
        print(json.dumps({"valid": False, "error": str(exc)}, ensure_ascii=False))
        return 2

    rendered = json.dumps(plan, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    sys.stdout.write(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
