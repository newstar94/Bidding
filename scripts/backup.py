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
import hmac
import json
import os
import pathlib
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from urllib.parse import parse_qs, unquote, urlparse
from uuid import uuid4

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.shared.paths import DATA_DIR, resolve_runtime_path


_SNAPSHOT_PREFIX = "biddingflow-backup"
_MANIFEST_FILENAME = "manifest.json"
_MAX_MANIFEST_FILES = 500_000


def _load_env() -> None:
    path = ROOT / ".env"
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _postgres_binary(name: str) -> str:
    suffix = ".exe" if os.name == "nt" else ""
    configured = os.environ.get("POSTGRESQL_BIN_DIR", "").strip()
    candidates = []
    if configured:
        candidates.append(pathlib.Path(configured) / f"{name}{suffix}")
    candidates.append(
        ROOT / "data" / "tools" / "postgresql17" / "pgsql" / "bin" / f"{name}{suffix}"
    )
    discovered = shutil.which(name)
    if discovered:
        return discovered
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    raise RuntimeError(f"PostgreSQL utility is unavailable: {name}")


def _postgres_process(database_url: str) -> tuple[dict[str, str], str]:
    parsed = urlparse(database_url)
    if parsed.scheme not in {"postgresql", "postgres"} or not parsed.hostname:
        raise RuntimeError("DATABASE_URL must be a PostgreSQL URL.")
    database_name = parsed.path.lstrip("/")
    if not database_name:
        raise RuntimeError("PostgreSQL URL must include a database name.")
    environment = os.environ.copy()
    environment.update(
        {
            "PGHOST": parsed.hostname,
            "PGPORT": str(parsed.port or 5432),
            "PGDATABASE": database_name,
            "PGUSER": unquote(parsed.username or ""),
            "PGPASSWORD": unquote(parsed.password or ""),
        }
    )
    query = parse_qs(parsed.query)
    for query_name, environment_name in (
        ("sslmode", "PGSSLMODE"),
        ("sslrootcert", "PGSSLROOTCERT"),
        ("sslcert", "PGSSLCERT"),
        ("sslkey", "PGSSLKEY"),
    ):
        if query.get(query_name):
            environment[environment_name] = query[query_name][-1]
    return environment, database_name


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
    print(f"  Running pg_dump -> {dump_file} ...")
    environment, database_name = _postgres_process(database_url)
    result = subprocess.run(
        [
            _postgres_binary("pg_dump"),
            "--format=custom",
            "--file",
            str(dump_file),
            "--dbname",
            database_name,
        ],
        capture_output=True,
        text=True,
        env=environment,
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

    try:
        manifest = _verify_snapshot(snapshot_dir)
    except Exception as exc:
        print(f"ERROR: Backup verification failed: {exc}", file=sys.stderr)
        return 1

    dump_rel = manifest["database"]["relativePath"]
    dump_file = snapshot_dir / dump_rel

    print(f"Restoring database from {dump_file} ...")
    environment, database_name = _postgres_process(database_url)
    result = subprocess.run(
        [_postgres_binary("pg_restore"), "--clean", "--if-exists", "--no-owner",
         "--dbname", database_name, str(dump_file)],
        capture_output=True, text=True, env=environment,
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


def _verify_snapshot(snapshot_dir: pathlib.Path) -> dict:
    snapshot_dir = snapshot_dir.resolve()
    manifest_path = snapshot_dir / _MANIFEST_FILENAME
    if not manifest_path.is_file() or manifest_path.stat().st_size > 64 * 1024 * 1024:
        raise RuntimeError("manifest.json is missing or too large")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("format") != "biddingflow-pg-backup" or manifest.get("version") != 1:
        raise RuntimeError("unsupported backup format")
    files = manifest.get("files")
    if not isinstance(files, list) or len(files) > _MAX_MANIFEST_FILES:
        raise RuntimeError("invalid backup file list")
    if len(files) != int(manifest.get("fileCount", -1)):
        raise RuntimeError("backup file count mismatch")
    seen = set()
    for item in files:
        relative = pathlib.Path(str(item.get("relativePath") or ""))
        candidate = (snapshot_dir / relative).resolve()
        if candidate in seen or snapshot_dir not in candidate.parents:
            raise RuntimeError("unsafe or duplicate backup path")
        seen.add(candidate)
        if not candidate.is_file():
            raise RuntimeError(f"backup file is missing: {relative.as_posix()}")
        if candidate.stat().st_size != int(item.get("sizeBytes", -1)):
            raise RuntimeError(f"backup size mismatch: {relative.as_posix()}")
        if not hmac.compare_digest(_sha256(candidate), str(item.get("sha256") or "")):
            raise RuntimeError(f"backup checksum mismatch: {relative.as_posix()}")
    return manifest


def cmd_verify(args) -> int:
    snapshot = pathlib.Path(args.snapshot).resolve()
    try:
        manifest = _verify_snapshot(snapshot)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(
        json.dumps(
            {
                "snapshot": str(snapshot),
                "createdAt": manifest.get("createdAt"),
                "fileCount": manifest.get("fileCount"),
                "verified": True,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


def cmd_drill(args) -> int:
    import psycopg

    snapshot = pathlib.Path(args.snapshot).resolve()
    try:
        manifest = _verify_snapshot(snapshot)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    drill_url = _require_env("RESTORE_DRILL_DATABASE_URL")
    primary_url = _require_env("DATABASE_URL")
    primary = urlparse(primary_url)
    drill = urlparse(drill_url)
    if (primary.hostname, primary.port or 5432, primary.path) == (
        drill.hostname,
        drill.port or 5432,
        drill.path,
    ):
        print("ERROR: Restore drill database must be isolated from production.", file=sys.stderr)
        return 1
    environment, database_name = _postgres_process(drill_url)
    dump_file = snapshot / manifest["database"]["relativePath"]
    result = subprocess.run(
        [
            _postgres_binary("pg_restore"),
            "--clean",
            "--if-exists",
            "--no-owner",
            "--dbname",
            database_name,
            str(dump_file),
        ],
        capture_output=True,
        text=True,
        env=environment,
    )
    if result.returncode:
        print("ERROR: restore drill pg_restore failed.", file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        return 1
    with psycopg.connect(drill_url) as connection:
        version = connection.execute(
            "SELECT schema_version FROM database_metadata WHERE id = 1"
        ).fetchone()
        invalid_fks = connection.execute(
            "SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND NOT convalidated"
        ).fetchone()[0]
        if not version or invalid_fks:
            print("ERROR: restored database failed schema verification.", file=sys.stderr)
            return 1
    hmac_key = _require_env("BIDDING_RESTORE_DRILL_HMAC_KEY")
    if len(hmac_key.encode("utf-8")) < 32:
        print("ERROR: BIDDING_RESTORE_DRILL_HMAC_KEY must contain at least 32 bytes.", file=sys.stderr)
        return 1
    recorded_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    payload = {
        "format": "biddingflow-restore-drill",
        "version": 1,
        "recordedAt": recorded_at,
        "snapshot": str(snapshot),
        "databaseVerified": True,
        "filesVerified": True,
        "schemaVersion": int(version[0]),
    }
    material = json.dumps(
        payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")
    payload["integrity"] = {
        "algorithm": "HMAC-SHA256",
        "hmacSha256": hmac.new(hmac_key.encode("utf-8"), material, hashlib.sha256).hexdigest(),
    }
    state_file = pathlib.Path(
        os.environ.get("BIDDING_RESTORE_DRILL_STATE_FILE")
        or snapshot.parent / "last-restore-drill.json"
    ).resolve()
    state_file.parent.mkdir(parents=True, exist_ok=True)
    temporary = state_file.with_name(f".{state_file.name}.{uuid4().hex}.tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    temporary.replace(state_file)
    print(json.dumps({"restoreDrill": "success", "recordedAt": recorded_at}, indent=2))
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

    verify_p = sub.add_parser("verify", help="Verify manifest, size and checksums")
    verify_p.add_argument("--snapshot", required=True)

    drill_p = sub.add_parser("drill", help="Restore and verify in an isolated drill database")
    drill_p.add_argument("--snapshot", required=True)

    sub.add_parser("list", help="List available backups")
    return parser


def main(argv=None) -> int:
    _load_env()
    parser = _build_parser()
    args = parser.parse_args(argv)
    if args.command == "create":
        return cmd_create(args)
    elif args.command == "restore":
        return cmd_restore(args)
    elif args.command == "list":
        return cmd_list(args)
    elif args.command == "verify":
        return cmd_verify(args)
    elif args.command == "drill":
        return cmd_drill(args)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
