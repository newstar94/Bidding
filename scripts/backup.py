"""Backup and restore the BiddingFlow PostgreSQL database and file assets.

Usage
-----
  # Create a backup (database + uploads + word-templates)
  python scripts/backup.py create

  # Restore from a backup directory
  python scripts/backup.py restore --from <backup-dir>

  # List available backups
  python scripts/backup.py list

Environment variables
---------------------
  DATABASE_URL          PostgreSQL DSN (required)
  BIDDING_BACKUP_DIR    Where backups are stored (default: data/backups)
  BIDDING_UPLOAD_DIR    Upload directory to include in backup
  BIDDING_WORD_TEMPLATE_DIR  Word-template directory to include in backup
"""

import argparse
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from uuid import uuid4

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.shared.paths import DATA_DIR, resolve_runtime_path


_SNAPSHOT_PREFIX = "biddingflow-backup"
_MANIFEST_FILENAME = "manifest.json"
_MAX_MANIFEST_FILES = 500_000


def _require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        print(f"ERROR: Environment variable {name} is required.", file=sys.stderr)
        sys.exit(1)
    return value


def _sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _backup_database(database_url: str, destination: pathlib.Path) -> dict:
    """Run pg_dump and return metadata about the dump file."""
    dump_file = destination / "database" / "bidding.dump"
    dump_file.parent.mkdir(parents=True, exist_ok=True)
    print(f"  Running pg_dump → {dump_file} ...")
    result = subprocess.run(
        ["pg_dump", "--format=custom", "--file", str(dump_file), database_url],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print("ERROR: pg_dump failed:", file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        sys.exit(1)
    size = dump_file.stat().st_size
    digest = _sha256(dump_file)
    print(f"  Database dump: {size:,} bytes, sha256={digest[:16]}...")
    return {
        "kind": "pg_dump",
        "relativePath": "database/bidding.dump",
        "sizeBytes": size,
        "sha256": digest,
    }


def _copy_directory(source: pathlib.Path, target_root_name: str, staging: pathlib.Path) -> list[dict]:
    """Copy a directory into the staging area and return file entries."""
    entries = []
    if not source.is_dir():
        print(f"  WARNING: Directory not found, skipping: {source}")
        return entries
    destination_root = staging / target_root_name
    destination_root.mkdir(parents=True, exist_ok=True)
    for src_path in sorted(source.rglob("*")):
        if not src_path.is_file():
            continue
        rel = src_path.relative_to(source)
        dst_path = destination_root / rel
        dst_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src_path, dst_path)
        size = dst_path.stat().st_size
        digest = _sha256(dst_path)
        rel_posix = f"{target_root_name}/{rel.as_posix()}"
        entries.append({
            "kind": target_root_name.replace("-", "_"),
            "relativePath": rel_posix,
            "sizeBytes": size,
            "sha256": digest,
        })
    return entries


def _write_manifest(staging: pathlib.Path, database_entry: dict, file_entries: list[dict], timestamp: datetime) -> None:
    all_files = [database_entry] + file_entries
    manifest = {
        "format": "biddingflow-pg-backup",
        "version": 1,
        "createdAt": timestamp.isoformat().replace("+00:00", "Z"),
        "database": {
            "engine": "postgresql",
            "relativePath": database_entry["relativePath"],
            "sizeBytes": database_entry["sizeBytes"],
            "sha256": database_entry["sha256"],
        },
        "files": all_files,
        "fileCount": len(all_files),
    }
    manifest_path = staging / _MANIFEST_FILENAME
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def cmd_create(args) -> int:
    database_url = _require_env("DATABASE_URL")
    backup_dir = pathlib.Path(
        args.backup_dir or os.environ.get("BIDDING_BACKUP_DIR") or str(DATA_DIR / "backups")
    ).resolve()
    upload_dir = pathlib.Path(
        args.uploads or os.environ.get("BIDDING_UPLOAD_DIR") or str(resolve_runtime_path("BIDDING_UPLOAD_DIR"))
    ).resolve()
    word_template_dir = pathlib.Path(
        args.word_templates or os.environ.get("BIDDING_WORD_TEMPLATE_DIR") or str(resolve_runtime_path("BIDDING_WORD_TEMPLATE_DIR"))
    ).resolve()

    timestamp = datetime.now(timezone.utc)
    snapshot_name = f"{_SNAPSHOT_PREFIX}-{timestamp.strftime('%Y%m%dT%H%M%SZ')}"
    final_path = backup_dir / snapshot_name
    staging_path = backup_dir / f".{snapshot_name}.staging-{uuid4().hex}"

    if final_path.exists():
        print(f"ERROR: Backup already exists: {final_path}", file=sys.stderr)
        return 1

    backup_dir.mkdir(parents=True, exist_ok=True)
    staging_path.mkdir(mode=0o700)

    try:
        print(f"Creating backup: {final_path}")
        db_entry = _backup_database(database_url, staging_path)
        file_entries = []
        print(f"  Copying uploads from {upload_dir} ...")
        file_entries += _copy_directory(upload_dir, "uploads", staging_path)
        print(f"  Copying word-templates from {word_template_dir} ...")
        file_entries += _copy_directory(word_template_dir, "word-templates", staging_path)
        _write_manifest(staging_path, db_entry, file_entries, timestamp)
        staging_path.rename(final_path)
        total_size = sum(e["sizeBytes"] for e in [db_entry] + file_entries)
        result = {
            "snapshot": str(final_path),
            "createdAt": timestamp.isoformat().replace("+00:00", "Z"),
            "fileCount": len(file_entries) + 1,
            "totalSizeBytes": total_size,
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        if staging_path.exists():
            shutil.rmtree(staging_path, ignore_errors=True)
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


def cmd_restore(args) -> int:
    database_url = _require_env("DATABASE_URL")
    snapshot_dir = pathlib.Path(args.snapshot).resolve()
    manifest_path = snapshot_dir / _MANIFEST_FILENAME

    if not manifest_path.is_file():
        print(f"ERROR: manifest.json not found in {snapshot_dir}", file=sys.stderr)
        return 1

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("format") != "biddingflow-pg-backup":
        print("ERROR: Unsupported backup format (expected biddingflow-pg-backup).", file=sys.stderr)
        return 1

    dump_rel = manifest["database"]["relativePath"]
    dump_file = snapshot_dir / dump_rel

    print(f"Restoring database from {dump_file} ...")
    result = subprocess.run(
        ["pg_restore", "--clean", "--if-exists", "--no-owner",
         f"--dbname={database_url}", str(dump_file)],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        print("ERROR: pg_restore failed:", file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        return 1
    print("  Database restored successfully.")

    upload_dir = pathlib.Path(
        os.environ.get("BIDDING_UPLOAD_DIR") or str(resolve_runtime_path("BIDDING_UPLOAD_DIR"))
    ).resolve()
    word_template_dir = pathlib.Path(
        os.environ.get("BIDDING_WORD_TEMPLATE_DIR") or str(resolve_runtime_path("BIDDING_WORD_TEMPLATE_DIR"))
    ).resolve()

    for entry in manifest.get("files", []):
        if entry["kind"] == "pg_dump":
            continue
        src = snapshot_dir / entry["relativePath"]
        if entry["relativePath"].startswith("uploads/"):
            dst = upload_dir / entry["relativePath"][len("uploads/"):]
        elif entry["relativePath"].startswith("word-templates/"):
            dst = word_template_dir / entry["relativePath"][len("word-templates/"):]
        else:
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)

    print("Restore complete.")
    return 0


def cmd_list(args) -> int:
    backup_dir = pathlib.Path(
        os.environ.get("BIDDING_BACKUP_DIR") or str(DATA_DIR / "backups")
    ).resolve()
    if not backup_dir.is_dir():
        print(f"No backup directory found at {backup_dir}")
        return 0
    snapshots = sorted(
        [d for d in backup_dir.iterdir() if d.is_dir() and d.name.startswith(_SNAPSHOT_PREFIX)],
        key=lambda d: d.name,
        reverse=True,
    )
    if not snapshots:
        print("No backups found.")
        return 0
    for snap in snapshots:
        manifest_path = snap / _MANIFEST_FILENAME
        created_at = "?"
        if manifest_path.is_file():
            try:
                m = json.loads(manifest_path.read_text(encoding="utf-8"))
                created_at = m.get("createdAt", "?")
            except Exception:
                pass
        print(f"  {snap.name}  ({created_at})")
    return 0


def _build_parser():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    create_p = sub.add_parser("create", help="Create a new backup (pg_dump + file assets)")
    create_p.add_argument("--backup-dir", default=None)
    create_p.add_argument("--uploads", default=None)
    create_p.add_argument("--word-templates", default=None)

    restore_p = sub.add_parser("restore", help="Restore from a backup directory")
    restore_p.add_argument("--snapshot", required=True, help="Path to the snapshot directory")

    sub.add_parser("list", help="List available backups")
    return parser


def main(argv=None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    if args.command == "create":
        return cmd_create(args)
    elif args.command == "restore":
        return cmd_restore(args)
    elif args.command == "list":
        return cmd_list(args)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
