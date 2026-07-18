"""Verify a full-state restore drill and atomically record its completion."""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import pathlib
import sys
from datetime import datetime, timezone
from uuid import uuid4


ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.db.full_state_backup import FullStateBackupError, verify_full_state_snapshot


def _default_state_file():
    configured = str(os.environ.get("BIDDING_RESTORE_DRILL_STATE_FILE", "")).strip()
    if configured:
        return configured
    backup_directory = str(os.environ.get("BIDDING_BACKUP_DIR", "")).strip()
    return str(pathlib.Path(backup_directory) / "last-restore-drill.json") if backup_directory else None


def _build_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", required=True, help="verified source snapshot directory")
    parser.add_argument("--restored", required=True, help="restored full-state directory")
    parser.add_argument("--state-file", default=_default_state_file())
    return parser


def _inside(candidate: pathlib.Path, root: pathlib.Path) -> bool:
    try:
        candidate.relative_to(root)
        return True
    except ValueError:
        return False


def _manifest_sha256(root: pathlib.Path) -> str:
    manifest_path = root / "manifest.json"
    try:
        digest = hashlib.sha256()
        with manifest_path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()
    except OSError as exc:
        raise FullStateBackupError(
            f"Could not read verified restore-drill manifest: {manifest_path}"
        ) from exc


def record_restore_drill(snapshot, restored, state_file, *, now=None, hmac_key=None):
    snapshot_path = pathlib.Path(snapshot).resolve()
    restored_path = pathlib.Path(restored).resolve()
    state_path = pathlib.Path(state_file).resolve()
    if snapshot_path == restored_path:
        raise FullStateBackupError("Restore drill source and destination must be different.")
    if _inside(state_path, snapshot_path) or _inside(state_path, restored_path):
        raise FullStateBackupError("Restore drill state must be outside verified snapshot trees.")

    source_result = verify_full_state_snapshot(snapshot_path)
    restored_result = verify_full_state_snapshot(restored_path)
    comparable_keys = ("format", "version", "fileCount", "totalSizeBytes", "database")
    if any(source_result.get(key) != restored_result.get(key) for key in comparable_keys):
        raise FullStateBackupError("Restored state does not match the verified source snapshot.")
    if not hmac.compare_digest(
        _manifest_sha256(snapshot_path),
        _manifest_sha256(restored_path),
    ):
        raise FullStateBackupError(
            "Restored manifest does not match the verified source snapshot."
        )

    recorded_at = now or datetime.now(timezone.utc)
    if recorded_at.tzinfo is None:
        raise FullStateBackupError("Restore drill timestamp must include a timezone.")
    recorded_at = recorded_at.astimezone(timezone.utc)
    signing_key = str(
        hmac_key
        if hmac_key is not None
        else os.environ.get("BIDDING_RESTORE_DRILL_HMAC_KEY", "")
    )
    if len(signing_key.encode("utf-8")) < 32:
        raise FullStateBackupError(
            "BIDDING_RESTORE_DRILL_HMAC_KEY must contain at least 32 bytes."
        )
    payload = {
        "format": "biddingflow-restore-drill",
        "version": 1,
        "recordedAt": recorded_at.isoformat().replace("+00:00", "Z"),
        "snapshot": str(snapshot_path),
        "restored": str(restored_path),
        "fileCount": source_result["fileCount"],
        "totalSizeBytes": source_result["totalSizeBytes"],
        "schemaVersion": source_result["database"]["schemaVersion"],
    }
    material = json.dumps(
        payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")
    payload["integrity"] = {
        "algorithm": "HMAC-SHA-256",
        "hmacSha256": hmac.new(
            signing_key.encode("utf-8"), material, hashlib.sha256
        ).hexdigest(),
    }
    state_path.parent.mkdir(parents=True, exist_ok=True)
    partial_path = state_path.with_name(f".{state_path.name}.partial-{uuid4().hex}")
    try:
        with partial_path.open("x", encoding="utf-8", newline="\n") as output:
            json.dump(payload, output, ensure_ascii=False, indent=2, sort_keys=True)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        if os.name != "nt":
            partial_path.chmod(0o600)
        os.replace(partial_path, state_path)
    except OSError as exc:
        raise FullStateBackupError(f"Could not record restore drill state: {state_path}") from exc
    finally:
        partial_path.unlink(missing_ok=True)
    return payload


def main(argv=None):
    parser = _build_parser()
    args = parser.parse_args(argv)
    if not args.state_file:
        parser.error("--state-file or BIDDING_RESTORE_DRILL_STATE_FILE is required")
    try:
        result = record_restore_drill(args.snapshot, args.restored, args.state_file)
    except FullStateBackupError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
