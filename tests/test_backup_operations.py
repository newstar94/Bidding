from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from scripts import backup
from scripts.backup import (
    _assert_distinct_database_targets,
    _copy_directory,
    _directory_matches_snapshot,
    _prune_local_snapshots,
    _snapshot_directories,
)


class _IdentityConnection:
    def __init__(self, identity):
        self.identity = identity

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, _query):
        return self

    def fetchone(self):
        return self.identity


def test_restore_drill_rejects_database_aliases_resolving_to_same_target() -> None:
    identities = {
        "postgresql://primary": ("127.0.0.1", 55432, 16384),
        "postgresql://alias": ("127.0.0.1", 55432, 16384),
    }

    with pytest.raises(RuntimeError, match="same PostgreSQL database"):
        _assert_distinct_database_targets(
            "postgresql://primary",
            "postgresql://alias",
            connect=lambda url: _IdentityConnection(identities[url]),
        )


def test_restore_drill_allows_distinct_databases_on_same_cluster() -> None:
    identities = {
        "postgresql://primary": ("127.0.0.1", 55432, 16384),
        "postgresql://drill": ("127.0.0.1", 55432, 24576),
    }

    _assert_distinct_database_targets(
        "postgresql://primary",
        "postgresql://drill",
        connect=lambda url: _IdentityConnection(identities[url]),
    )


def test_restore_uses_one_database_transaction_and_stops_on_first_error(
    tmp_path: Path,
    monkeypatch,
) -> None:
    dump_file = tmp_path / "database" / "bidding.dump"
    dump_file.parent.mkdir()
    dump_file.write_bytes(b"dump")
    (tmp_path / "manifest.json").write_text("{}", encoding="utf-8")
    manifest = {
        "database": {"relativePath": "database/bidding.dump"},
        "files": [],
    }
    commands = []

    monkeypatch.setattr(backup, "_require_env", lambda _name: "postgresql://database")
    monkeypatch.setattr(backup, "_verify_snapshot", lambda _snapshot: manifest)
    monkeypatch.setattr(backup, "_postgres_process", lambda _url: ({}, "biddingflow"))
    monkeypatch.setattr(backup, "_postgres_binary", lambda name: name)

    def run(command, **_kwargs):
        commands.append(command)
        return SimpleNamespace(returncode=0, stderr="")

    monkeypatch.setattr(backup.subprocess, "run", run)

    assert backup.cmd_restore(SimpleNamespace(snapshot=str(tmp_path))) == 0
    assert commands == [[
        "pg_restore",
        "--clean",
        "--if-exists",
        "--no-owner",
        "--single-transaction",
        "--exit-on-error",
        "--dbname",
        "biddingflow",
        str(dump_file),
    ]]


def test_backup_detects_asset_changes_during_database_dump(
    tmp_path: Path,
) -> None:
    source = tmp_path / "live-uploads"
    source.mkdir()
    live_file = source / "document.txt"
    live_file.write_text("before", encoding="utf-8")
    staging = tmp_path / "staging"
    entries = _copy_directory(source, "uploads", staging)

    assert _directory_matches_snapshot(source, "uploads", entries)
    live_file.write_text("after", encoding="utf-8")
    assert not _directory_matches_snapshot(source, "uploads", entries)


def test_restore_rolls_assets_back_when_database_restore_fails(
    tmp_path: Path,
    monkeypatch,
) -> None:
    snapshot = tmp_path / "snapshot"
    dump_file = snapshot / "database" / "bidding.dump"
    dump_file.parent.mkdir(parents=True)
    dump_file.write_bytes(b"dump")
    upload_file = snapshot / "uploads" / "new.txt"
    upload_file.parent.mkdir()
    upload_file.write_text("new", encoding="utf-8")
    (snapshot / "manifest.json").write_text("{}", encoding="utf-8")
    upload_target = tmp_path / "live-uploads"
    upload_target.mkdir()
    old_file = upload_target / "old.txt"
    old_file.write_text("old", encoding="utf-8")
    manifest = {
        "database": {"relativePath": "database/bidding.dump"},
        "files": [
            {
                "kind": "uploads",
                "relativePath": "uploads/new.txt",
            }
        ],
    }

    monkeypatch.setenv("BIDDING_UPLOAD_DIR", str(upload_target))
    monkeypatch.setattr(backup, "_require_env", lambda _name: "postgresql://database")
    monkeypatch.setattr(backup, "_verify_snapshot", lambda _snapshot: manifest)
    monkeypatch.setattr(backup, "_postgres_process", lambda _url: ({}, "biddingflow"))
    monkeypatch.setattr(backup, "_postgres_binary", lambda name: name)

    def fail_restore(_command, **_kwargs):
        assert (upload_target / "new.txt").read_text(encoding="utf-8") == "new"
        assert not old_file.exists()
        return SimpleNamespace(returncode=1, stderr="restore failed")

    monkeypatch.setattr(backup.subprocess, "run", fail_restore)

    assert backup.cmd_restore(SimpleNamespace(snapshot=str(snapshot))) == 1
    assert old_file.read_text(encoding="utf-8") == "old"
    assert not (upload_target / "new.txt").exists()


def test_backup_retention_only_removes_valid_old_snapshots(
    tmp_path: Path,
    monkeypatch,
) -> None:
    names = [
        "biddingflow-backup-20260716T010203Z",
        "biddingflow-backup-20260717T010203Z",
        "biddingflow-backup-20260718T010203Z",
    ]
    for name in names:
        (tmp_path / name).mkdir()
    invalid = tmp_path / "biddingflow-backup-not-a-timestamp"
    invalid.mkdir()
    unrelated = tmp_path / "keep-me"
    unrelated.mkdir()

    monkeypatch.setenv("BIDDING_BACKUP_RETENTION_COUNT", "2")
    removed = _prune_local_snapshots(tmp_path)

    assert removed == [names[0]]
    assert not (tmp_path / names[0]).exists()
    assert [path.name for path in _snapshot_directories(tmp_path)] == [
        names[2],
        names[1],
    ]
    assert invalid.is_dir()
    assert unrelated.is_dir()


def test_backup_retention_rejects_unsafe_configuration(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("BIDDING_BACKUP_RETENTION_COUNT", "0")

    try:
        _prune_local_snapshots(tmp_path)
    except RuntimeError as exc:
        assert "between 1 and 10000" in str(exc)
    else:
        raise AssertionError("unsafe retention configuration was accepted")
