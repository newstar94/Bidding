from __future__ import annotations

from pathlib import Path

from scripts.backup import _prune_local_snapshots, _snapshot_directories


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
