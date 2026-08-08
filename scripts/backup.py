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
import base64
import hashlib
import hmac
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from urllib.parse import parse_qs, unquote, urlparse
from uuid import uuid4

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.shared.paths import DATA_DIR, resolve_runtime_path
from scripts.env_utils import load_env


_SNAPSHOT_PREFIX = "biddingflow-backup"
_MANIFEST_FILENAME = "manifest.json"
_MAX_MANIFEST_FILES = 500_000
_SNAPSHOT_NAME_PATTERN = re.compile(
    rf"^{re.escape(_SNAPSHOT_PREFIX)}-(\d{{8}}T\d{{6}}Z)$"
)


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


def _assert_distinct_database_targets(
    primary_url: str,
    drill_url: str,
    *,
    connect=None,
) -> None:
    """Fail closed unless the two URLs resolve to different PostgreSQL databases."""

    if connect is None:
        import psycopg

        connect = psycopg.connect

    identities = []
    for database_url in (primary_url, drill_url):
        with connect(database_url) as connection:
            identity = connection.execute(
                """SELECT COALESCE(inet_server_addr()::text, ''),
                          COALESCE(inet_server_port(), 0),
                          oid::bigint
                   FROM pg_database
                   WHERE datname = current_database()"""
            ).fetchone()
        if not identity or len(identity) != 3:
            raise RuntimeError("Cannot verify PostgreSQL database identity.")
        identities.append(
            (str(identity[0] or ""), int(identity[1] or 0), int(identity[2]))
        )
    if identities[0] == identities[1]:
        raise RuntimeError(
            "Restore drill target resolves to the same PostgreSQL database as primary."
        )


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


def _directory_matches_snapshot(
    source: pathlib.Path,
    target_root_name: str,
    entries: list[dict],
) -> bool:
    """Return whether the live tree still matches its staged copy."""

    prefix = f"{target_root_name}/"
    expected = {
        entry["relativePath"][len(prefix):]: (
            int(entry["sizeBytes"]),
            str(entry["sha256"]),
        )
        for entry in entries
        if str(entry.get("relativePath") or "").startswith(prefix)
    }
    actual_paths = (
        {
            path.relative_to(source).as_posix(): path
            for path in source.rglob("*")
            if path.is_file()
        }
        if source.is_dir()
        else {}
    )
    if set(actual_paths) != set(expected):
        return False
    return all(
        path.stat().st_size == expected[relative_path][0]
        and hmac.compare_digest(
            _sha256(path),
            expected[relative_path][1],
        )
        for relative_path, path in actual_paths.items()
    )


def _manifest_relative_path(value):
    raw = str(value or "")
    components = raw.split("/")
    if (
        not raw
        or "\\" in raw
        or any(
            not component
            or component in {".", ".."}
            or ":" in component
            or any(ord(character) < 32 for character in component)
            for component in components
        )
    ):
        raise RuntimeError("unsafe backup path")
    relative = pathlib.PurePosixPath(raw)
    if relative.is_absolute():
        raise RuntimeError("unsafe backup path")
    return pathlib.Path(*relative.parts)


def _stage_restore_assets(
    snapshot_dir: pathlib.Path,
    manifest: dict,
    destinations: dict[str, pathlib.Path],
) -> dict[pathlib.Path, pathlib.Path]:
    staged = {}
    try:
        for prefix, destination in destinations.items():
            entries = []
            for entry in manifest.get("files", []):
                relative_path = _manifest_relative_path(
                    entry.get("relativePath")
                )
                if relative_path.parts[0] == prefix:
                    entries.append((entry, relative_path))
            if not entries:
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            stage = destination.parent / (
                f".{destination.name}.restore-stage-{uuid4().hex}"
            )
            stage.mkdir(mode=0o700)
            staged[destination] = stage
            stage_root = stage.resolve()
            snapshot_root = snapshot_dir.resolve()
            for _entry, manifest_relative in entries:
                relative = pathlib.Path(*manifest_relative.parts[1:])
                source = (snapshot_root / manifest_relative).resolve()
                target = (stage_root / relative).resolve()
                if (
                    snapshot_root not in source.parents
                    or stage_root not in target.parents
                ):
                    raise RuntimeError("unsafe backup path")
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
        return staged
    except Exception:
        for stage in staged.values():
            shutil.rmtree(stage, ignore_errors=True)
        raise


def _activate_staged_assets(
    staged: dict[pathlib.Path, pathlib.Path],
) -> list[tuple[pathlib.Path, pathlib.Path | None]]:
    activated = []
    try:
        for destination, stage in staged.items():
            previous = None
            if destination.exists():
                previous = destination.parent / (
                    f".{destination.name}.restore-previous-{uuid4().hex}"
                )
                destination.replace(previous)
            activated.append((destination, previous))
            stage.replace(destination)
        return activated
    except Exception:
        _rollback_asset_swaps(activated)
        for stage in staged.values():
            if stage.exists():
                shutil.rmtree(stage, ignore_errors=True)
        raise


def _rollback_asset_swaps(
    activated: list[tuple[pathlib.Path, pathlib.Path | None]],
) -> None:
    for destination, previous in reversed(activated):
        if destination.exists():
            shutil.rmtree(destination)
        if previous is not None and previous.exists():
            previous.replace(destination)


def _finalize_asset_swaps(
    activated: list[tuple[pathlib.Path, pathlib.Path | None]],
) -> None:
    for _destination, previous in activated:
        if previous is not None and previous.exists():
            shutil.rmtree(previous)


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


def _snapshot_directories(backup_dir: pathlib.Path) -> list[pathlib.Path]:
    if not backup_dir.is_dir():
        return []
    snapshots: list[pathlib.Path] = []
    resolved_root = backup_dir.resolve()
    for candidate in backup_dir.iterdir():
        match = _SNAPSHOT_NAME_PATTERN.fullmatch(candidate.name)
        if not match or not candidate.is_dir() or candidate.is_symlink():
            continue
        try:
            datetime.strptime(match.group(1), "%Y%m%dT%H%M%SZ")
        except ValueError:
            continue
        resolved_candidate = candidate.resolve()
        if resolved_candidate.parent != resolved_root:
            continue
        snapshots.append(resolved_candidate)
    return sorted(snapshots, key=lambda item: item.name, reverse=True)


def _prune_local_snapshots(backup_dir: pathlib.Path) -> list[str]:
    try:
        retention_count = int(
            os.environ.get("BIDDING_BACKUP_RETENTION_COUNT", "14")
        )
    except ValueError as exc:
        raise RuntimeError(
            "BIDDING_BACKUP_RETENTION_COUNT must be an integer."
        ) from exc
    if retention_count < 1 or retention_count > 10_000:
        raise RuntimeError(
            "BIDDING_BACKUP_RETENTION_COUNT must be between 1 and 10000."
        )
    removed: list[str] = []
    for snapshot in _snapshot_directories(backup_dir)[retention_count:]:
        # _snapshot_directories already rejects symlinks, invalid names and
        # anything outside the exact backup root before recursive deletion.
        shutil.rmtree(snapshot)
        removed.append(snapshot.name)
    return removed


def cmd_create(args) -> int:
    database_url = os.environ.get("BACKUP_DATABASE_URL", "").strip()
    if not database_url:
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
        file_entries = []
        print(f"  Copying uploads from {upload_dir} ...")
        file_entries += _copy_directory(upload_dir, "uploads", staging_path)
        print(f"  Copying word-templates from {word_template_dir} ...")
        file_entries += _copy_directory(word_template_dir, "word-templates", staging_path)
        db_entry = _backup_database(database_url, staging_path)
        if not _directory_matches_snapshot(
            upload_dir, "uploads", file_entries
        ) or not _directory_matches_snapshot(
            word_template_dir, "word-templates", file_entries
        ):
            raise RuntimeError(
                "Assets changed while pg_dump was running; retry the backup."
            )
        _write_manifest(staging_path, db_entry, file_entries, timestamp)
        staging_path.rename(final_path)
        removed_snapshots = _prune_local_snapshots(backup_dir)
        total_size = sum(e["sizeBytes"] for e in [db_entry] + file_entries)
        result = {
            "snapshot": str(final_path),
            "createdAt": timestamp.isoformat().replace("+00:00", "Z"),
            "fileCount": len(file_entries) + 1,
            "totalSizeBytes": total_size,
            "retentionRemoved": removed_snapshots,
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

    dump_rel = _manifest_relative_path(manifest["database"]["relativePath"])
    dump_file = snapshot_dir / dump_rel
    upload_dir = pathlib.Path(
        os.environ.get("BIDDING_UPLOAD_DIR")
        or str(resolve_runtime_path("BIDDING_UPLOAD_DIR"))
    ).resolve()
    word_template_dir = pathlib.Path(
        os.environ.get("BIDDING_WORD_TEMPLATE_DIR")
        or str(resolve_runtime_path("BIDDING_WORD_TEMPLATE_DIR"))
    ).resolve()
    staged_assets = {}
    activated_assets = []

    try:
        staged_assets = _stage_restore_assets(
            snapshot_dir,
            manifest,
            {
                "uploads": upload_dir,
                "word-templates": word_template_dir,
            },
        )
        activated_assets = _activate_staged_assets(staged_assets)
        print(f"Restoring database from {dump_file} ...")
        environment, database_name = _postgres_process(database_url)
        result = subprocess.run(
            [
                _postgres_binary("pg_restore"),
                "--clean",
                "--if-exists",
                "--no-owner",
                "--single-transaction",
                "--exit-on-error",
                "--dbname",
                database_name,
                str(dump_file),
            ],
            capture_output=True, text=True, env=environment,
        )
    except Exception as exc:
        _rollback_asset_swaps(activated_assets)
        for stage in staged_assets.values():
            if stage.exists():
                shutil.rmtree(stage, ignore_errors=True)
        print(f"ERROR: Restore failed: {exc}", file=sys.stderr)
        return 1
    if result.returncode != 0:
        _rollback_asset_swaps(activated_assets)
        print("ERROR: pg_restore failed:", file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        return 1
    _finalize_asset_swaps(activated_assets)
    print("  Database restored successfully.")

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
    verified_entries = {}
    for item in files:
        relative = _manifest_relative_path(item.get("relativePath"))
        candidate = (snapshot_dir / relative).resolve()
        if candidate in seen or snapshot_dir not in candidate.parents:
            raise RuntimeError("unsafe or duplicate backup path")
        seen.add(candidate)
        if not candidate.is_file():
            raise RuntimeError(f"backup file is missing: {relative.as_posix()}")
        size = int(item.get("sizeBytes", -1))
        digest = str(item.get("sha256") or "")
        if candidate.stat().st_size != size:
            raise RuntimeError(f"backup size mismatch: {relative.as_posix()}")
        if not hmac.compare_digest(_sha256(candidate), digest):
            raise RuntimeError(f"backup checksum mismatch: {relative.as_posix()}")
        verified_entries[relative.as_posix()] = (size, digest)

    database_entry = manifest.get("database")
    if not isinstance(database_entry, dict):
        raise RuntimeError("invalid backup database entry")
    database_relative = _manifest_relative_path(
        database_entry.get("relativePath")
    )
    database_metadata = (
        int(database_entry.get("sizeBytes", -1)),
        str(database_entry.get("sha256") or ""),
    )
    if verified_entries.get(database_relative.as_posix()) != database_metadata:
        raise RuntimeError("backup database entry is not verified")
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

    drill_started_at = datetime.now(timezone.utc)
    snapshot = pathlib.Path(args.snapshot).resolve()
    try:
        manifest = _verify_snapshot(snapshot)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    drill_url = _require_env("RESTORE_DRILL_DATABASE_URL")
    primary_url = _require_env("DATABASE_URL")
    try:
        _assert_distinct_database_targets(primary_url, drill_url, connect=psycopg.connect)
    except Exception as exc:
        print(f"ERROR: Restore drill database isolation check failed: {exc}", file=sys.stderr)
        return 1
    environment, database_name = _postgres_process(drill_url)
    dump_file = snapshot / _manifest_relative_path(manifest["database"]["relativePath"])
    result = subprocess.run(
        [
            _postgres_binary("pg_restore"),
            "--clean",
            "--if-exists",
            "--no-owner",
            "--single-transaction",
            "--exit-on-error",
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
    private_key_text = _require_env("BIDDING_RESTORE_DRILL_PRIVATE_KEY")
    try:
        private_key_bytes = base64.urlsafe_b64decode(
            private_key_text.encode("ascii")
        )
        if len(private_key_bytes) != 32:
            raise ValueError
        signing_key = Ed25519PrivateKey.from_private_bytes(private_key_bytes)
    except (ValueError, TypeError):
        print(
            "ERROR: BIDDING_RESTORE_DRILL_PRIVATE_KEY must be a base64 "
            "Ed25519 raw private key.",
            file=sys.stderr,
        )
        return 1
    completed_at = datetime.now(timezone.utc)
    try:
        snapshot_created_at = datetime.fromisoformat(
            str(manifest["createdAt"]).replace("Z", "+00:00")
        ).astimezone(timezone.utc)
    except (KeyError, TypeError, ValueError):
        print("ERROR: Backup creation timestamp is invalid.", file=sys.stderr)
        return 1
    rto_seconds = max(
        0.0,
        (completed_at - drill_started_at).total_seconds(),
    )
    rpo_seconds = max(
        0.0,
        (drill_started_at - snapshot_created_at).total_seconds(),
    )
    max_rto = max(
        1,
        int(os.environ.get("RESTORE_MAX_RTO_SECONDS", "3600")),
    )
    max_rpo = max(
        1,
        int(os.environ.get("BACKUP_MAX_RPO_SECONDS", "93600")),
    )
    if rto_seconds > max_rto or rpo_seconds > max_rpo:
        print(
            "ERROR: Restore drill violates approved RPO/RTO "
            f"(rpo={rpo_seconds:.3f}s/{max_rpo}s, "
            f"rto={rto_seconds:.3f}s/{max_rto}s).",
            file=sys.stderr,
        )
        return 1
    recorded_at = completed_at.isoformat().replace("+00:00", "Z")
    payload = {
        "format": "biddingflow-restore-drill",
        "version": 2,
        "recordedAt": recorded_at,
        "snapshot": str(snapshot),
        "databaseVerified": True,
        "filesVerified": True,
        "schemaVersion": int(version[0]),
        "rpoSeconds": round(rpo_seconds, 3),
        "rtoSeconds": round(rto_seconds, 3),
    }
    material = json.dumps(
        payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")
    payload["integrity"] = {
        "algorithm": "Ed25519",
        "signature": base64.urlsafe_b64encode(
            signing_key.sign(material)
        ).decode("ascii"),
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
    snapshots = _snapshot_directories(backup_dir)
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


def cmd_drill_latest(args) -> int:
    backup_dir = pathlib.Path(
        args.backup_dir
        or os.environ.get("BIDDING_BACKUP_DIR")
        or str(DATA_DIR / "backups")
    ).resolve()
    snapshots = _snapshot_directories(backup_dir)
    if not snapshots:
        print(f"ERROR: No backup snapshot found in {backup_dir}.", file=sys.stderr)
        return 1
    args.snapshot = str(snapshots[0])
    return cmd_drill(args)


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

    drill_latest_p = sub.add_parser(
        "drill-latest",
        help="Restore and verify the newest snapshot in an isolated drill database",
    )
    drill_latest_p.add_argument("--backup-dir", default=None)

    sub.add_parser("list", help="List available backups")
    return parser


def main(argv=None) -> int:
    load_env(ROOT)
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
    elif args.command == "drill-latest":
        return cmd_drill_latest(args)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
