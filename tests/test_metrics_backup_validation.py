import json
from datetime import datetime, timezone

from backend.observability import metrics
from backend.observability.backup_validation import sha256_file


def _write_snapshot(root, *, include_database=True, include_assets=True):
    snapshot = root / "biddingflow-backup-20261005T120000Z"
    snapshot.mkdir()
    database = snapshot / "database" / "bidding.dump"
    database.parent.mkdir()
    database.write_bytes(b"dump-content")
    files = [{
        "relativePath": "database/bidding.dump",
        "sizeBytes": database.stat().st_size,
        "sha256": sha256_file(database),
    }]
    if include_assets:
        (snapshot / "uploads").mkdir()
        (snapshot / "word-templates").mkdir()
    manifest = {
        "format": "biddingflow-pg-backup",
        "version": 1,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "fileCount": len(files),
        "files": files,
        "assetDirectories": {"uploads": include_assets, "word-templates": include_assets},
    }
    if include_database:
        manifest["database"] = files[0]
    (snapshot / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return snapshot


def test_metrics_backup_timestamp_requires_verified_database_and_asset_metadata(tmp_path):
    valid_root = tmp_path / "valid"
    valid_root.mkdir()
    _write_snapshot(valid_root)
    assert metrics._latest_backup_timestamp(valid_root) is not None

    missing_db_root = tmp_path / "missing-db"
    missing_db_root.mkdir()
    _write_snapshot(missing_db_root, include_database=False)
    assert metrics._latest_backup_timestamp(missing_db_root) is None

    missing_assets_root = tmp_path / "missing-assets"
    missing_assets_root.mkdir()
    _write_snapshot(missing_assets_root)
    snapshot = next(missing_assets_root.glob("biddingflow-backup-*"))
    (snapshot / "uploads").rmdir()
    assert metrics._latest_backup_timestamp(missing_assets_root) is None


def test_metrics_backup_verification_does_not_use_whole_file_read(tmp_path, monkeypatch):
    root = tmp_path / "streaming"
    root.mkdir()
    _write_snapshot(root)

    def fail_read_bytes(_path):
        raise AssertionError("backup metrics must hash files by streaming")

    monkeypatch.setattr(type(root), "read_bytes", fail_read_bytes, raising=False)
    assert metrics._latest_backup_timestamp(root) is not None
