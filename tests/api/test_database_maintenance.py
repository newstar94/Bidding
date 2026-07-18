import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pytest

from backend.db.db_helper import SQLiteDatabase
from backend.db.maintenance import (
    DatabaseMaintenanceError,
    create_online_backup,
    inspect_database,
    restore_database,
)
from backend.startup import StartupValidationError, validate_startup_configuration


def _create_source_database(path):
    connection = sqlite3.connect(path)
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA foreign_keys = ON")
    connection.executescript(
        """
        PRAGMA user_version = 8;
        CREATE TABLE parent (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE child (
            id INTEGER PRIMARY KEY,
            parent_id INTEGER NOT NULL REFERENCES parent(id)
        );
        INSERT INTO parent (id, name) VALUES (1, 'snapshot row');
        INSERT INTO child (id, parent_id) VALUES (2, 1);
        """
    )
    connection.commit()
    return connection


def test_online_backup_and_rehearsal_restore_produce_usable_database(tmp_path):
    source_path = tmp_path / "database" / "bidding.db"
    source_path.parent.mkdir()
    writer = _create_source_database(source_path)
    try:
        backup = create_online_backup(source_path, tmp_path / "backups", retention_count=3)
    finally:
        writer.close()

    backup_path = Path(backup["backupDatabase"])
    metadata = json.loads(Path(f"{backup_path}.json").read_text(encoding="utf-8"))
    assert backup_path.is_file()
    assert metadata["integrity"] == "ok"
    assert metadata["schemaVersion"] == 8
    assert len(metadata["sha256"]) == 64
    assert set(metadata["walCheckpoint"]) == {"busy", "logFrames", "checkpointedFrames"}

    restored_path = tmp_path / "rehearsal" / "bidding-restored.db"
    result = restore_database(backup_path, restored_path)
    assert result["integrity"] == "ok"
    assert result["schemaVersion"] == 8
    assert result["backupMetadataVerified"] is True

    restored_connection = sqlite3.connect(restored_path)
    try:
        assert restored_connection.execute("SELECT name FROM parent WHERE id = 1").fetchone() == (
            "snapshot row",
        )
        assert restored_connection.execute("PRAGMA foreign_key_check").fetchall() == []
    finally:
        restored_connection.close()


def test_backup_retention_removes_old_database_and_metadata(tmp_path):
    source_path = tmp_path / "database" / "bidding.db"
    source_path.parent.mkdir()
    writer = _create_source_database(source_path)
    try:
        for _ in range(3):
            create_online_backup(source_path, tmp_path / "backups", retention_count=2)
    finally:
        writer.close()

    backups = list((tmp_path / "backups").glob("bidding-*.db"))
    metadata = list((tmp_path / "backups").glob("bidding-*.db.json"))
    assert len(backups) == 2
    assert len(metadata) == 2


def test_backup_rejects_same_database_directory(tmp_path):
    source_path = tmp_path / "bidding.db"
    writer = _create_source_database(source_path)
    writer.close()

    with pytest.raises(DatabaseMaintenanceError, match="must be separate"):
        create_online_backup(source_path, tmp_path)


def test_restore_rejects_backup_modified_after_verification(tmp_path):
    source_path = tmp_path / "database" / "bidding.db"
    source_path.parent.mkdir()
    writer = _create_source_database(source_path)
    writer.close()
    backup = create_online_backup(source_path, tmp_path / "backups")
    backup_path = Path(backup["backupDatabase"])
    with backup_path.open("ab") as output:
        output.write(b"tampered")

    with pytest.raises(DatabaseMaintenanceError, match="SHA-256"):
        restore_database(backup_path, tmp_path / "restore" / "bidding.db")


def test_writer_lease_rejects_second_application_process(tmp_path):
    database = SQLiteDatabase(tmp_path / "bidding.db")
    first_lease = database.acquire_writer_lease()
    try:
        with pytest.raises(RuntimeError, match="exactly one application instance"):
            database.acquire_writer_lease()
    finally:
        first_lease.release()


def test_production_rejects_synced_or_relative_sqlite_paths(tmp_path):
    relative_database = SQLiteDatabase(tmp_path / "relative.db")
    with pytest.raises(StartupValidationError, match="absolute path"):
        validate_startup_configuration(
            relative_database,
            {"APP_ENV": "production", "BIDDING_DB_PATH": "data/bidding.db"},
        )

    synced_path = tmp_path / "OneDrive" / "bidding.db"
    synced_database = SQLiteDatabase(synced_path)
    with pytest.raises(StartupValidationError, match="file-sync"):
        validate_startup_configuration(
            synced_database,
            {"APP_ENV": "production", "BIDDING_DB_PATH": str(synced_path.resolve())},
        )


def test_production_accepts_runtime_layout_derived_from_data_root(tmp_path):
    database = SQLiteDatabase(tmp_path / "database" / "bidding.db")
    writer = _create_source_database(database.db_path)
    writer.execute("CREATE TABLE tai_khoan (id TEXT PRIMARY KEY)")
    writer.commit()
    writer.close()
    environment = {
        "APP_ENV": "production",
        "APP_RELEASE_ID": "release-test-20260718",
        "APP_DEBUG": "False",
        "APP_SECURE_COOKIES": "True",
        "APP_PUBLIC_URL": "https://bidding.example.com",
        "ADMIN_PASSWORD": "valid first run password",
        "ADMIN_USERNAME": "admin",
        "ADMIN_NAME": "Administrator",
        "ADMIN_EMAIL": "admin@bidding.example.com",
        "DEFAULT_ORG_NAME": "Bidding Organization",
        "BIDDING_DATA_DIR": str(tmp_path.resolve()),
        "BIDDING_DB_PATH": database.db_path,
        "BIDDING_SQLITE_SINGLE_WRITER": "true",
        "AUDIT_CHECKPOINT_HMAC_KEY": "a" * 32,
        "BIDDING_RESTORE_DRILL_HMAC_KEY": "r" * 32,
        "AUDIT_CHECKPOINT_OFFHOST_CONFIRMED": "true",
        "DATA_AT_REST_ENCRYPTION_CONFIRMED": "true",
        "SECRET_ROTATION_CONFIRMED_AT": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
    }

    validate_startup_configuration(database, environment)
    assert inspect_database(database.db_path)["integrity"] == "ok"

    invalid_release = dict(environment, APP_RELEASE_ID="development")
    with pytest.raises(StartupValidationError, match="APP_RELEASE_ID"):
        validate_startup_configuration(database, invalid_release)


def test_production_requires_encrypted_volume_confirmation(tmp_path):
    database = SQLiteDatabase(tmp_path / "database" / "bidding.db")
    writer = _create_source_database(database.db_path)
    writer.execute("CREATE TABLE tai_khoan (id TEXT PRIMARY KEY)")
    writer.commit()
    writer.close()
    environment = {
        "APP_ENV": "production",
        "APP_RELEASE_ID": "release-test-20260718",
        "BIDDING_DB_PATH": database.db_path,
        "BIDDING_SQLITE_SINGLE_WRITER": "true",
        "AUDIT_CHECKPOINT_DIR": str((tmp_path / "audit-checkpoints").resolve()),
        "AUDIT_CHECKPOINT_HMAC_KEY": "a" * 32,
        "BIDDING_RESTORE_DRILL_HMAC_KEY": "r" * 32,
        "AUDIT_CHECKPOINT_OFFHOST_CONFIRMED": "true",
        "BIDDING_BACKUP_DIR": str((tmp_path / "backups").resolve()),
        "BIDDING_LOG_DIR": str((tmp_path / "logs").resolve()),
        "BIDDING_UPLOAD_DIR": str((tmp_path / "uploads").resolve()),
        "BIDDING_WORD_TEMPLATE_DIR": str((tmp_path / "templates").resolve()),
        "DOCUMENT_WORKER_TEMP_DIR": str((tmp_path / "temp").resolve()),
    }
    with pytest.raises(StartupValidationError, match="DATA_AT_REST_ENCRYPTION_CONFIRMED"):
        validate_startup_configuration(database, environment)


def test_production_rejects_stale_secret_rotation_attestation(tmp_path):
    database = SQLiteDatabase(tmp_path / "database" / "bidding.db")
    environment = {
        "APP_ENV": "production", "BIDDING_DB_PATH": database.db_path,
        "APP_RELEASE_ID": "release-test-20260718",
        "BIDDING_SQLITE_SINGLE_WRITER": "true", "DATA_AT_REST_ENCRYPTION_CONFIRMED": "true",
        "AUDIT_CHECKPOINT_DIR": str((tmp_path / "audit-checkpoints").resolve()),
        "AUDIT_CHECKPOINT_HMAC_KEY": "a" * 32,
        "BIDDING_RESTORE_DRILL_HMAC_KEY": "r" * 32,
        "AUDIT_CHECKPOINT_OFFHOST_CONFIRMED": "true",
        "SECRET_ROTATION_CONFIRMED_AT": "2020-01-01",
        "BIDDING_BACKUP_DIR": str((tmp_path / "backups").resolve()),
        "BIDDING_LOG_DIR": str((tmp_path / "logs").resolve()),
        "BIDDING_UPLOAD_DIR": str((tmp_path / "uploads").resolve()),
        "BIDDING_WORD_TEMPLATE_DIR": str((tmp_path / "templates").resolve()),
        "DOCUMENT_WORKER_TEMP_DIR": str((tmp_path / "temp").resolve()),
    }
    with pytest.raises(StartupValidationError, match="rotated"):
        validate_startup_configuration(database, environment)


def test_first_run_production_configuration_does_not_require_existing_database(tmp_path):
    database = SQLiteDatabase(tmp_path / "database" / "new-bidding.db")
    environment = {
        "APP_ENV": "production",
        "APP_RELEASE_ID": "release-test-20260718",
        "APP_DEBUG": "False",
        "APP_SECURE_COOKIES": "True",
        "APP_PUBLIC_URL": "https://bidding.example.com",
        "ADMIN_PASSWORD": "valid first run password",
        "ADMIN_USERNAME": "admin",
        "ADMIN_NAME": "Administrator",
        "ADMIN_EMAIL": "admin@bidding.example.com",
        "DEFAULT_ORG_NAME": "Bidding Organization",
        "BIDDING_DB_PATH": database.db_path,
        "BIDDING_SQLITE_SINGLE_WRITER": "true",
        "AUDIT_CHECKPOINT_DIR": str((tmp_path / "audit-checkpoints").resolve()),
        "AUDIT_CHECKPOINT_HMAC_KEY": "a" * 32,
        "BIDDING_RESTORE_DRILL_HMAC_KEY": "r" * 32,
        "AUDIT_CHECKPOINT_OFFHOST_CONFIRMED": "true",
        "DATA_AT_REST_ENCRYPTION_CONFIRMED": "true",
        "SECRET_ROTATION_CONFIRMED_AT": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "BIDDING_BACKUP_DIR": str((tmp_path / "backups").resolve()),
        "BIDDING_LOG_DIR": str((tmp_path / "logs").resolve()),
        "BIDDING_UPLOAD_DIR": str((tmp_path / "uploads").resolve()),
        "BIDDING_WORD_TEMPLATE_DIR": str((tmp_path / "templates").resolve()),
        "DOCUMENT_WORKER_TEMP_DIR": str((tmp_path / "temp").resolve()),
    }

    validate_startup_configuration(database, environment)
    assert not Path(database.db_path).exists()

    invalid_hmac = dict(environment, AUDIT_CHECKPOINT_HMAC_KEY="short")
    with pytest.raises(StartupValidationError, match="AUDIT_CHECKPOINT_HMAC_KEY"):
        validate_startup_configuration(database, invalid_hmac)

    missing_offhost_anchor = dict(
        environment, AUDIT_CHECKPOINT_OFFHOST_CONFIRMED="false"
    )
    with pytest.raises(StartupValidationError, match="OFFHOST"):
        validate_startup_configuration(database, missing_offhost_anchor)
