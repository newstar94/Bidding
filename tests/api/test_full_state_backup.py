import json
import sqlite3
from pathlib import Path
import threading

import pytest

from backend.db.full_state_backup import (
    DATABASE_RELATIVE_PATH,
    FullStateBackupError,
    create_full_state_snapshot,
    restore_full_state_snapshot,
    verify_full_state_snapshot,
)
from backend.db.db_helper import SQLiteDatabase
from scripts.full_state_backup import main as full_state_backup_main


def _runtime_layout(tmp_path):
    database_path = tmp_path / "database" / "bidding.db"
    database_path.parent.mkdir()
    uploads = tmp_path / "uploads"
    word_templates = tmp_path / "word-templates"
    uploads.mkdir()
    word_templates.mkdir()
    return database_path, uploads, word_templates


def _create_database(database_path):
    connection = sqlite3.connect(database_path)
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA foreign_keys = ON")
    connection.executescript(
        """
        PRAGMA user_version = 9;
        CREATE TABLE organization (id TEXT PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE package (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL REFERENCES organization(id),
            name TEXT NOT NULL
        );
        INSERT INTO organization (id, name) VALUES ('org-1', 'Snapshot organization');
        INSERT INTO package (id, organization_id, name)
        VALUES ('pkg-1', 'org-1', 'Snapshot package');
        """
    )
    connection.commit()
    return connection


def _create_snapshot(tmp_path):
    database_path, uploads, word_templates = _runtime_layout(tmp_path)
    writer = _create_database(database_path)
    (uploads / "chuyen_gia").mkdir()
    (uploads / "chuyen_gia" / "portrait.png").write_bytes(b"private image bytes")
    (word_templates / "users" / "user-1").mkdir(parents=True)
    (word_templates / "users" / "user-1" / "report.docx").write_bytes(
        b"private Word template bytes"
    )
    (word_templates / "users" / "user-1" / "config.json").write_text(
        json.dumps({"active_template": "report.docx"}),
        encoding="utf-8",
    )
    result = create_full_state_snapshot(
        database_path,
        tmp_path / "backups",
        uploads,
        word_templates,
    )
    return writer, Path(result["snapshot"]), result


def test_full_state_snapshot_has_checksums_and_excludes_runtime_secrets(tmp_path):
    database_path, uploads, word_templates = _runtime_layout(tmp_path)
    writer = _create_database(database_path)
    (uploads / "image.png").write_bytes(b"image")
    (uploads / ".env").write_text("IGNORED=true", encoding="utf-8")
    (uploads / "bidding.db.writer.lock").write_bytes(b"lock")
    (uploads / "cache-wal").write_bytes(b"wal")
    (word_templates / "template.docx").write_bytes(b"docx")
    (word_templates / "client_secret.json").write_text("{}", encoding="utf-8")
    try:
        result = create_full_state_snapshot(
            database_path,
            tmp_path / "backups",
            uploads,
            word_templates,
        )
    finally:
        writer.close()

    snapshot = Path(result["snapshot"])
    manifest = json.loads((snapshot / "manifest.json").read_text(encoding="utf-8"))
    entries = {entry["relativePath"]: entry for entry in manifest["files"]}
    assert manifest["format"] == "biddingflow-full-state"
    assert manifest["version"] == 2
    assert manifest["consistency"] == {
        "mode": "exclusive-writer-lease",
        "quiesced": True,
    }
    assert manifest["createdAt"].endswith("Z")
    assert set(entries) == {
        DATABASE_RELATIVE_PATH,
        "uploads/image.png",
        "word-templates/template.docx",
    }
    assert all(entry["sizeBytes"] >= 0 for entry in entries.values())
    assert all(len(entry["sha256"]) == 64 for entry in entries.values())
    assert result["excludedFileCount"] == 4
    assert not (snapshot / "database" / "bidding.db-wal").exists()
    assert not (snapshot / "database" / "bidding.db-shm").exists()
    assert verify_full_state_snapshot(snapshot)["verified"] is True


def test_full_state_verification_and_cli_detect_tampering(tmp_path, capsys):
    writer, snapshot, _result = _create_snapshot(tmp_path)
    writer.close()
    assert full_state_backup_main(["verify", "--snapshot", str(snapshot)]) == 0
    command_output = json.loads(capsys.readouterr().out)
    assert command_output["verified"] is True

    (snapshot / "uploads" / "chuyen_gia" / "portrait.png").write_bytes(
        b"tampered image bytes"
    )
    with pytest.raises(FullStateBackupError, match="checksum or size"):
        verify_full_state_snapshot(snapshot)
    assert full_state_backup_main(["verify", "--snapshot", str(snapshot)]) == 1
    assert "checksum or size" in capsys.readouterr().err


def test_full_state_restore_uses_a_new_directory_and_restores_usable_state(tmp_path):
    writer, snapshot, result = _create_snapshot(tmp_path)
    writer.close()
    destination = tmp_path / "restore-rehearsal"
    restored = restore_full_state_snapshot(snapshot, destination)

    assert restored["restored"] is True
    assert restored["fileCount"] == result["fileCount"]
    assert (destination / "uploads" / "chuyen_gia" / "portrait.png").read_bytes() == (
        b"private image bytes"
    )
    assert (
        destination / "word-templates" / "users" / "user-1" / "report.docx"
    ).read_bytes() == b"private Word template bytes"
    assert json.loads(
        (destination / "word-templates" / "users" / "user-1" / "config.json").read_text(
            encoding="utf-8"
        )
    ) == {"active_template": "report.docx"}
    connection = sqlite3.connect(destination / DATABASE_RELATIVE_PATH)
    try:
        assert connection.execute("SELECT name FROM package WHERE id = 'pkg-1'").fetchone() == (
            "Snapshot package",
        )
    finally:
        connection.close()
    assert verify_full_state_snapshot(destination)["verified"] is True

    with pytest.raises(FullStateBackupError, match="requires a new directory"):
        restore_full_state_snapshot(snapshot, destination)


def test_manifest_traversal_is_rejected_before_restore_writes_outside(tmp_path):
    writer, snapshot, _result = _create_snapshot(tmp_path)
    writer.close()
    manifest_path = snapshot / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    upload_entry = next(entry for entry in manifest["files"] if entry["kind"] == "upload")
    upload_entry["relativePath"] = "../outside.txt"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    outside = tmp_path / "outside.txt"
    with pytest.raises(FullStateBackupError, match="Unsafe manifest path"):
        verify_full_state_snapshot(snapshot)
    with pytest.raises(FullStateBackupError, match="Unsafe manifest path"):
        restore_full_state_snapshot(snapshot, tmp_path / "traversal-restore")
    assert not outside.exists()
    assert not (tmp_path / "traversal-restore").exists()


def test_restore_rejects_destination_inside_snapshot(tmp_path):
    writer, snapshot, _result = _create_snapshot(tmp_path)
    writer.close()
    with pytest.raises(FullStateBackupError, match="separate from the snapshot"):
        restore_full_state_snapshot(snapshot, snapshot / "nested-restore")


def test_full_state_backup_refuses_a_running_application_writer(tmp_path):
    database_path, uploads, word_templates = _runtime_layout(tmp_path)
    writer = _create_database(database_path)
    writer.close()
    lease = SQLiteDatabase(database_path).acquire_writer_lease()
    try:
        with pytest.raises(FullStateBackupError, match="quiesced application"):
            create_full_state_snapshot(
                database_path,
                tmp_path / "backups",
                uploads,
                word_templates,
            )
    finally:
        lease.release()


def test_full_state_backup_fails_closed_during_live_traffic_then_restores(
    tmp_path,
):
    database_path, uploads, word_templates = _runtime_layout(tmp_path)
    writer = _create_database(database_path)
    writer.close()
    application_database = SQLiteDatabase(database_path)
    application_lease = application_database.acquire_writer_lease()
    traffic_started = threading.Event()
    stop_traffic = threading.Event()
    writes = []

    def write_traffic():
        connection = sqlite3.connect(database_path, timeout=5)
        try:
            counter = 0
            while not stop_traffic.is_set():
                counter += 1
                connection.execute(
                    "UPDATE package SET name = ? WHERE id = 'pkg-1'",
                    (f"Snapshot package {counter}",),
                )
                connection.commit()
                writes.append(counter)
                traffic_started.set()
        finally:
            connection.close()

    traffic_thread = threading.Thread(target=write_traffic, daemon=True)
    traffic_thread.start()
    assert traffic_started.wait(timeout=5)
    try:
        with pytest.raises(FullStateBackupError, match="quiesced application"):
            create_full_state_snapshot(
                database_path,
                tmp_path / "backups",
                uploads,
                word_templates,
            )
    finally:
        stop_traffic.set()
        traffic_thread.join(timeout=5)
        application_lease.release()
        application_database.close()
    assert not traffic_thread.is_alive()
    assert writes

    snapshot_result = create_full_state_snapshot(
        database_path,
        tmp_path / "backups",
        uploads,
        word_templates,
    )
    restored_path = tmp_path / "traffic-drained-restore"
    restore_full_state_snapshot(snapshot_result["snapshot"], restored_path)
    restored_connection = sqlite3.connect(restored_path / DATABASE_RELATIVE_PATH)
    try:
        restored_name = restored_connection.execute(
            "SELECT name FROM package WHERE id = 'pkg-1'"
        ).fetchone()[0]
    finally:
        restored_connection.close()
    assert restored_name == f"Snapshot package {writes[-1]}"
    assert verify_full_state_snapshot(restored_path)["verified"] is True


def test_backup_timer_wraps_snapshot_in_a_quiesced_service_window():
    service = Path(
        "deploy/biddingflow-full-state-backup.service.example"
    ).read_text(encoding="utf-8")

    assert "ExecStartPre=+/usr/bin/systemctl stop biddingflow.service" in service
    assert "ExecStopPost=+/usr/bin/systemctl start biddingflow.service" in service
    assert "User=biddingflow" in service
