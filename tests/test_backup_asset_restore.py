import json
import stat
from pathlib import Path
from types import SimpleNamespace

import pytest

from scripts import backup


def _create_snapshot(monkeypatch, tmp_path, *, missing_templates=False, asset_payload=None):
    uploads = tmp_path / "source-uploads"
    templates = tmp_path / "source-templates"
    catalog = tmp_path / "source-catalog"
    uploads.mkdir()
    catalog.mkdir()
    monkeypatch.setenv("BIDDING_WORD_TEMPLATE_CATALOG_DIR", str(catalog))
    if not missing_templates:
        templates.mkdir()
    if asset_payload is not None:
        (uploads / "image.txt").write_bytes(asset_payload)
        (templates / "template.txt").write_bytes(asset_payload)
    snapshots = tmp_path / "snapshots"
    monkeypatch.setenv("BACKUP_DATABASE_URL", "postgresql://backup:test@localhost/test")
    monkeypatch.setattr(backup, "_postgres_binary", lambda name: name)

    def fake_pg_dump(command, **_kwargs):
        Path(command[command.index("--file") + 1]).write_bytes(b"fake dump")
        return SimpleNamespace(returncode=0, stderr="")

    monkeypatch.setattr(backup.subprocess, "run", fake_pg_dump)
    result = backup.cmd_create(SimpleNamespace(
        backup_dir=str(snapshots), uploads=str(uploads), word_templates=str(templates),
    ))
    assert result == 0
    return next(path for path in snapshots.iterdir() if path.is_dir())


def _restore_destinations(monkeypatch, tmp_path):
    uploads = tmp_path / "live-uploads"
    templates = tmp_path / "live-templates"
    catalog = tmp_path / "live-catalog"
    for directory in (uploads, templates, catalog):
        directory.mkdir()
        (directory / "newer.txt").write_bytes(b"keep until restore commits")
    monkeypatch.setenv("DATABASE_URL", "postgresql://restore:test@localhost/test")
    monkeypatch.setenv("BIDDING_UPLOAD_DIR", str(uploads))
    monkeypatch.setenv("BIDDING_WORD_TEMPLATE_DIR", str(templates))
    monkeypatch.setenv("BIDDING_WORD_TEMPLATE_CATALOG_DIR", str(catalog))
    return uploads, templates


@pytest.mark.parametrize("asset_payload", [None, b"snapshot asset"])
def test_restore_snapshot_replaces_newer_live_assets(monkeypatch, tmp_path, asset_payload):
    snapshot = _create_snapshot(monkeypatch, tmp_path, asset_payload=asset_payload)
    uploads, templates = _restore_destinations(monkeypatch, tmp_path)
    monkeypatch.setattr(backup.subprocess, "run", lambda *_args, **_kwargs:
                        SimpleNamespace(returncode=0, stderr=""))

    assert backup.cmd_restore(SimpleNamespace(snapshot=str(snapshot))) == 0
    if asset_payload is None:
        assert list(uploads.iterdir()) == []
        assert list(templates.iterdir()) == []
    else:
        assert [path.name for path in uploads.iterdir()] == ["image.txt"]
        assert [path.name for path in templates.iterdir()] == ["template.txt"]
        assert (uploads / "image.txt").read_bytes() == asset_payload
        assert (templates / "template.txt").read_bytes() == asset_payload


def test_restore_empty_snapshot_rolls_back_assets_when_database_fails(monkeypatch, tmp_path):
    snapshot = _create_snapshot(monkeypatch, tmp_path)
    uploads, templates = _restore_destinations(monkeypatch, tmp_path)
    def fake_pg_restore(*_args, **_kwargs):
        assert list(uploads.iterdir()) == []
        assert list(templates.iterdir()) == []
        return SimpleNamespace(returncode=1, stderr="fake restore failure")

    monkeypatch.setattr(backup.subprocess, "run", fake_pg_restore)

    assert backup.cmd_restore(SimpleNamespace(snapshot=str(snapshot))) == 1
    for directory in (uploads, templates):
        assert (directory / "newer.txt").read_bytes() == b"keep until restore commits"
    assert not list(tmp_path.glob(".*.restore-*"))


def test_restore_rolls_back_assets_and_reraises_interrupt(monkeypatch, tmp_path):
    snapshot = _create_snapshot(monkeypatch, tmp_path)
    uploads, templates = _restore_destinations(monkeypatch, tmp_path)

    def interrupt_pg_restore(*_args, **_kwargs):
        raise KeyboardInterrupt

    monkeypatch.setattr(backup.subprocess, "run", interrupt_pg_restore)
    with pytest.raises(KeyboardInterrupt):
        backup.cmd_restore(SimpleNamespace(snapshot=str(snapshot)))
    for directory in (uploads, templates):
        assert (directory / "newer.txt").read_bytes() == b"keep until restore commits"
    assert not list(tmp_path.glob(".*.restore-*"))


def test_backup_manifest_and_verification_report_missing_asset_tree(monkeypatch, tmp_path, capsys):
    snapshot = _create_snapshot(monkeypatch, tmp_path, missing_templates=True)
    manifest = json.loads((snapshot / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["assetDirectories"] == {
        "uploads": True, "word-templates": False, "word-catalog": True,
    }
    capsys.readouterr()

    assert backup.cmd_verify(SimpleNamespace(snapshot=str(snapshot))) == 0
    assert json.loads(capsys.readouterr().out)["assetsComplete"] is False


def test_strict_verification_rejects_incomplete_snapshot(monkeypatch, tmp_path):
    snapshot = _create_snapshot(monkeypatch, tmp_path, missing_templates=True)
    assert backup.cmd_verify(SimpleNamespace(snapshot=str(snapshot), require_complete=True)) == 1


def test_drill_rejects_incomplete_snapshot_before_database_touch(monkeypatch, tmp_path):
    import psycopg

    snapshot = _create_snapshot(monkeypatch, tmp_path, missing_templates=True)
    monkeypatch.setenv("DATABASE_URL", "postgresql://primary:test@localhost/test")
    monkeypatch.setenv("RESTORE_DRILL_DATABASE_URL", "postgresql://drill:test@localhost/restore_test")
    connections = []

    def connect(*_args, **_kwargs):
        connections.append(1)
        raise RuntimeError("mock database boundary")

    monkeypatch.setattr(psycopg, "connect", connect)
    assert backup.cmd_drill(SimpleNamespace(snapshot=str(snapshot))) == 1
    assert connections == []


def test_staged_tree_inherits_private_target_identity_and_permissions(monkeypatch, tmp_path):
    destination = tmp_path / "destination"
    destination.mkdir()
    stage = tmp_path / "stage"
    nested = stage / "nested"
    nested.mkdir(parents=True)
    asset = nested / "asset.txt"
    asset.write_bytes(b"snapshot asset")
    original_stat = Path.stat

    def fixture_stat(path, *args, **kwargs):
        if path == destination:
            return SimpleNamespace(st_mode=stat.S_IFDIR | 0o770, st_uid=2345, st_gid=3456)
        if path == asset:
            return SimpleNamespace(st_mode=stat.S_IFREG | 0o644, st_uid=0, st_gid=0)
        return original_stat(path, *args, **kwargs)

    owners = {}
    modes = {}
    monkeypatch.setattr(Path, "stat", fixture_stat)
    monkeypatch.setattr(backup.os, "chown", lambda path, uid, gid: owners.update({path: (uid, gid)}), raising=False)
    monkeypatch.setattr(backup.os, "chmod", lambda path, mode: modes.update({path: mode}))

    backup._inherit_asset_tree_metadata(stage, destination)
    assert owners == {stage: (2345, 3456), nested: (2345, 3456), asset: (2345, 3456)}
    assert modes == {stage: 0o770, nested: 0o770, asset: 0o640}


def test_restore_rejects_lost_empty_directory_before_changing_live_assets(monkeypatch, tmp_path):
    snapshot = _create_snapshot(monkeypatch, tmp_path)
    (snapshot / "word-templates").rmdir()
    uploads, templates = _restore_destinations(monkeypatch, tmp_path)
    pg_calls = []
    monkeypatch.setattr(backup.subprocess, "run", lambda *_args, **_kwargs: pg_calls.append(1))

    assert backup.cmd_restore(SimpleNamespace(snapshot=str(snapshot))) == 1
    assert pg_calls == []
    for directory in (uploads, templates):
        assert (directory / "newer.txt").read_bytes() == b"keep until restore commits"
    assert not list(tmp_path.glob(".*.restore-*"))


@pytest.mark.parametrize("legacy", [False, True])
def test_restore_missing_asset_tree_fails_before_database_or_asset_changes(
    monkeypatch, tmp_path, legacy,
):
    snapshot = _create_snapshot(monkeypatch, tmp_path, missing_templates=True)
    if legacy:
        manifest_path = snapshot / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["version"] = 1
        manifest.pop("assetDirectories", None)
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    uploads, templates = _restore_destinations(monkeypatch, tmp_path)
    pg_calls = []

    def fake_pg_restore(*_args, **_kwargs):
        pg_calls.append(1)
        return SimpleNamespace(returncode=0, stderr="")

    monkeypatch.setattr(backup.subprocess, "run", fake_pg_restore)

    assert backup.cmd_restore(SimpleNamespace(snapshot=str(snapshot))) == 1
    assert pg_calls == []
    for directory in (uploads, templates):
        assert (directory / "newer.txt").read_bytes() == b"keep until restore commits"


def test_legacy_empty_directories_restore_without_guessing_missing_roots(monkeypatch, tmp_path):
    snapshot = _create_snapshot(monkeypatch, tmp_path)
    manifest_path = snapshot / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["version"] = 1
    manifest.pop("assetDirectories", None)
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    uploads, templates = _restore_destinations(monkeypatch, tmp_path)
    monkeypatch.setattr(backup.subprocess, "run", lambda *_args, **_kwargs:
                        SimpleNamespace(returncode=0, stderr=""))

    assert backup.cmd_restore(SimpleNamespace(snapshot=str(snapshot))) == 0
    assert list(uploads.iterdir()) == []
    assert list(templates.iterdir()) == []


def test_backup_default_destination_uses_data_root_set_after_import(monkeypatch, tmp_path):
    monkeypatch.setattr(backup, "DATA_DIR", tmp_path / "imported-root", raising=False)
    monkeypatch.delenv("BIDDING_BACKUP_DIR", raising=False)
    monkeypatch.setenv("BACKUP_DATABASE_URL", "postgresql://backup:test@localhost/test")
    monkeypatch.setenv("BIDDING_DATA_DIR", str(tmp_path / "late-data-root"))
    (tmp_path / "late-data-root" / "templates" / "images").mkdir(parents=True)
    (tmp_path / "late-data-root" / "templates" / "words").mkdir(parents=True)
    monkeypatch.delenv("BIDDING_UPLOAD_DIR", raising=False)
    monkeypatch.delenv("BIDDING_WORD_TEMPLATE_DIR", raising=False)
    touched = []

    def stop_before_writing_database(_url, destination):
        touched.append(destination)
        raise RuntimeError("stop before any database operation")

    monkeypatch.setattr(backup, "_backup_database", stop_before_writing_database)
    assert backup.cmd_create(SimpleNamespace(
        backup_dir=None, uploads=None, word_templates=None,
    )) == 1
    assert len(touched) == 1
    assert touched[0].parent == tmp_path / "late-data-root" / "backups"


def test_list_and_drill_latest_use_data_root_set_after_import(monkeypatch, tmp_path, capsys):
    snapshot = _create_snapshot(monkeypatch, tmp_path)
    monkeypatch.setenv("BIDDING_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("BIDDING_BACKUP_DIR", raising=False)
    backups = tmp_path / "backups"
    snapshot.parent.rename(backups)
    expected = backups / snapshot.name
    capsys.readouterr()

    assert backup.cmd_list(SimpleNamespace()) == 0
    assert expected.name in capsys.readouterr().out
    selected = []
    monkeypatch.setattr(backup, "cmd_drill", lambda args: selected.append(args.snapshot) or 0)
    assert backup.cmd_drill_latest(SimpleNamespace(backup_dir=None)) == 0
    assert selected == [str(expected)]
