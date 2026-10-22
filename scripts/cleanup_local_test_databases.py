"""List (default) or drop leftover scratch databases in the local dev cluster.

Only the repository-managed loopback cluster is touched. Databases that hold
real or shared data are never candidates:

* ``biddingflow_dev`` (pilot/live data) and ``biddingflow_dev_*`` copies,
* the configured test databases used by the suites, and ``postgres``.

Usage::

    python scripts/cleanup_local_test_databases.py            # dry run
    python scripts/cleanup_local_test_databases.py --apply    # drop listed DBs
    python scripts/cleanup_local_test_databases.py --apply --remove-path <dir>

``--remove-path`` additionally deletes one directory (e.g. an old ``dist``
backup) after confirming it is not inside the repository's tracked tree.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import shutil
import sys
from urllib.parse import urlsplit, urlunsplit

import psycopg
from psycopg import sql


ROOT = Path(__file__).resolve().parents[1]
SCRATCH_PREFIXES = (
    "biddingflow_codex_",
    "biddingflow_e2e_",
    "biddingflow_lifecycle_",
    "biddingflow_contract_",
    "biddingflow_verify_",
    "biddingflow_py_full_",
    "biddingflow_test_codex_",
)
PROTECTED = frozenset({
    "postgres",
    "biddingflow_dev",
    "biddingflow_test",
    "biddingflow_api_test",
    "biddingflow_multiworker_test",
    "biddingflow_load_test",
    "biddingflow_restore_drill",
})


def _env_values():
    values = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8-sig").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def _admin_url(values):
    source = values.get("TEST_DATABASE_URL") or values.get("DATABASE_URL") or ""
    parsed = urlsplit(source)
    if parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise SystemExit("Refusing: the configured cluster is not on loopback.")
    return urlunsplit(parsed._replace(path="/postgres"))


def candidates(names):
    return sorted(
        name for name in names
        if name not in PROTECTED
        and not name.startswith("biddingflow_dev")
        and name.startswith(SCRATCH_PREFIXES)
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--apply", action="store_true", help="drop the listed databases")
    parser.add_argument("--remove-path", help="also delete this directory (outside the repo)")
    args = parser.parse_args(argv)

    url = _admin_url(_env_values())
    with psycopg.connect(url, autocommit=True, connect_timeout=5) as connection:
        names = [row[0] for row in connection.execute(
            "SELECT datname FROM pg_database WHERE NOT datistemplate"
        )]
        targets = candidates(names)
        kept = sorted(set(names) - set(targets))
        print(f"Kept ({len(kept)}): {', '.join(kept)}")
        print(f"{'Dropping' if args.apply else 'Would drop'} ({len(targets)}):")
        for name in targets:
            print(f"  - {name}")
        if args.apply:
            for name in targets:
                try:
                    # No FORCE: a database with live sessions is skipped, not killed.
                    connection.execute(sql.SQL("DROP DATABASE {}").format(sql.Identifier(name)))
                except psycopg.Error as error:
                    print(f"  ! skipped {name}: {error.__class__.__name__}")
        else:
            print("Dry run only. Re-run with --apply to drop them.")

    if args.remove_path:
        target = Path(args.remove_path).resolve()
        if ROOT == target or ROOT in target.parents:
            raise SystemExit("Refusing to delete a path inside the repository.")
        if not target.is_dir():
            raise SystemExit(f"Not a directory: {target}")
        if args.apply:
            shutil.rmtree(target)
            print(f"Removed {target}")
        else:
            print(f"Would remove {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
