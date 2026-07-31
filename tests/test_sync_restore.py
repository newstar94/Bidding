import json

from backend.auth.auth_helper import SessionRole
from backend.db.upgrades import DB_SCHEMA_VERSION, UPGRADES
from backend.sync.restore_service import restore_tombstoned_record

from tests.test_sync_conflict_authorization import (
    _seed_denied_package,
    _test_database,
)


def _prepare_tombstoned_package(cursor):
    organization_id, employee_id, package_id = _seed_denied_package(cursor)
    stored = dict(cursor.execute(
        "SELECT * FROM goi_thau WHERE organization_id = ? AND id = ?",
        (organization_id, package_id),
    ).fetchone())
    cursor.execute(
        "ALTER TABLE deleted_records ADD COLUMN IF NOT EXISTS record_snapshot_json TEXT",
    )
    cursor.execute(
        "ALTER TABLE deleted_records ADD COLUMN IF NOT EXISTS delete_actor_user_id TEXT",
    )
    cursor.execute(
        "ALTER TABLE deleted_records ADD COLUMN IF NOT EXISTS delete_mutation_id TEXT",
    )
    cursor.execute(
        "DELETE FROM phan_cong_nhan_su WHERE organization_id = ? AND id_muc_tieu = ?",
        (organization_id, package_id),
    )
    cursor.execute(
        "DELETE FROM goi_thau WHERE organization_id = ? AND id = ?",
        (organization_id, package_id),
    )
    cursor.execute(
        """INSERT INTO sync_metadata
           (organization_id, current_version, min_available_version)
           VALUES (?, 5, 0)
           ON CONFLICT (organization_id) DO UPDATE SET current_version = 5""",
        (organization_id,),
    )
    cursor.execute(
        """INSERT INTO deleted_records
           (table_name, record_id, organization_id, deleted_at, delete_version,
            record_snapshot_json, delete_actor_user_id, delete_mutation_id)
           VALUES ('goi_thau', ?, ?, CURRENT_TIMESTAMP, 5, ?, ?, ?)
           ON CONFLICT (organization_id, table_name, record_id) DO UPDATE SET
             delete_version = EXCLUDED.delete_version,
             record_snapshot_json = EXCLUDED.record_snapshot_json,
             delete_actor_user_id = EXCLUDED.delete_actor_user_id,
             delete_mutation_id = EXCLUDED.delete_mutation_id""",
        (
            package_id,
            organization_id,
            json.dumps(stored, ensure_ascii=False, default=str),
            employee_id,
            "delete-mutation-1",
        ),
    )
    return organization_id, employee_id, package_id


def test_restore_schema_is_added_by_a_new_immutable_migration():
    assert DB_SCHEMA_VERSION >= 32
    upgrade = next(item for item in UPGRADES if item.version == 30)
    assert upgrade.name == "add_tombstone_restore_evidence"


def test_restore_requires_separate_permission_and_reason():
    database = _test_database()
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        organization_id, employee_id, package_id = _prepare_tombstoned_package(cursor)
        employee_role = SessionRole(
            "user",
            employee_id,
            platform_role="user",
            active_role="employee",
        )

        missing_reason = restore_tombstoned_record(
            cursor,
            organization_id=organization_id,
            actor_user_id=employee_id,
            actor_role=employee_role,
            table="goithau",
            record_id=package_id,
            reason="",
            expected_delete_version=5,
            client_mutation_id="restore-mutation-missing-reason",
            ip_address="127.0.0.1",
        )
        denied = restore_tombstoned_record(
            cursor,
            organization_id=organization_id,
            actor_user_id=employee_id,
            actor_role=employee_role,
            table="goithau",
            record_id=package_id,
            reason="Phục hồi theo biên bản đã duyệt",
            expected_delete_version=5,
            client_mutation_id="restore-mutation-denied",
            ip_address="127.0.0.1",
        )

        assert missing_reason["code"] == "RESTORE_REASON_REQUIRED"
        assert denied["code"] == "RESTORE_PERMISSION_REQUIRED"
        assert cursor.execute(
            "SELECT 1 FROM goi_thau WHERE organization_id = ? AND id = ?",
            (organization_id, package_id),
        ).fetchone() is None
    finally:
        connection.rollback()
        connection.close()
        database.close()


def test_restore_is_transactional_audited_and_idempotent():
    database = _test_database()
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        organization_id, employee_id, package_id = _prepare_tombstoned_package(cursor)
        cursor.execute(
            """UPDATE thanh_vien_to_chuc
               SET vai_tro_trong_to_chuc = 'manager'
               WHERE organization_id = ? AND user_id = ?""",
            (organization_id, employee_id),
        )
        manager_role = SessionRole(
            "user",
            employee_id,
            platform_role="user",
            active_role="manager",
        )
        command = dict(
            organization_id=organization_id,
            actor_user_id=employee_id,
            actor_role=manager_role,
            table="goithau",
            record_id=package_id,
            reason="Phục hồi theo biên bản đã duyệt",
            expected_delete_version=5,
            client_mutation_id="restore-mutation-1",
            ip_address="127.0.0.1",
        )

        restored = restore_tombstoned_record(cursor, **command)
        retried = restore_tombstoned_record(cursor, **command)

        assert restored == retried
        assert restored["status"] == "restored"
        assert restored["record"]["id"] == package_id
        assert restored["record"]["tenGoiThau"] == "Gói thầu kiểm thử conflict"
        assert cursor.execute(
            "SELECT 1 FROM deleted_records WHERE organization_id = ? AND table_name = 'goi_thau' AND record_id = ?",
            (organization_id, package_id),
        ).fetchone() is None
        audit_rows = cursor.execute(
            """SELECT metadata_json FROM audit_log
               WHERE organization_id = ? AND action = 'sync.record_restored'
                 AND target_type = 'goi_thau' AND target_id = ?""",
            (organization_id, package_id),
        ).fetchall()
        assert len(audit_rows) == 1
        audit_metadata = json.loads(audit_rows[0][0])
        assert audit_metadata["reason"] == "Phục hồi theo biên bản đã duyệt"
        assert audit_metadata["clientMutationId"] == "restore-mutation-1"
        assert "recordSnapshot" not in audit_metadata
    finally:
        connection.rollback()
        connection.close()
        database.close()
