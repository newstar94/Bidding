import sqlite3
from types import SimpleNamespace

from backend.sync.record_writer import SyncRecordWriter
from backend.sync.uniqueness import (
    build_domain_uniqueness_context,
    validate_domain_uniqueness_from_context,
)


def _assignment_database():
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.execute(
        """CREATE TABLE phan_cong_nhan_su (
               id TEXT PRIMARY KEY,
               organization_id TEXT NOT NULL,
               owner_type TEXT NOT NULL DEFAULT 'organization',
               id_nhan_vien TEXT NOT NULL,
               id_muc_tieu TEXT NOT NULL,
               loai_doi_tuong TEXT NOT NULL,
               sync_version INTEGER NOT NULL DEFAULT 0,
               row_version INTEGER NOT NULL DEFAULT 1,
               created_at TEXT,
               updated_at TEXT,
               UNIQUE (
                   organization_id,
                   id_nhan_vien,
                   id_muc_tieu,
                   loai_doi_tuong
               )
           )"""
    )
    connection.execute(
        """INSERT INTO phan_cong_nhan_su (
               id, organization_id, id_nhan_vien, id_muc_tieu,
               loai_doi_tuong
           ) VALUES (?, ?, ?, ?, ?)""",
        (
            "asg-existing",
            "org-1",
            "user-1",
            "plan-1",
            "kehoach",
        ),
    )
    return connection


def _incoming_assignment():
    return {
        "id": "asg-incoming",
        "organization_id": "org-1",
        "owner_type": "organization",
        "id_nhan_vien": "user-1",
        "id_muc_tieu": "plan-1",
        "loai_doi_tuong": "kehoach",
        "sync_version": 2,
    }


def test_assignment_uniqueness_reports_existing_business_membership():
    connection = _assignment_database()
    try:
        item = {
            "id": "asg-incoming",
            "empId": "user-1",
            "targetId": "plan-1",
            "type": "kehoach",
        }
        context = build_domain_uniqueness_context(
            connection.cursor(),
            "org-1",
            {"phan_cong_nhan_su": [item]},
        )

        errors = validate_domain_uniqueness_from_context(
            context,
            "phan_cong_nhan_su",
            item,
            "asg-incoming",
            "asg-incoming",
        )

        assert errors == [{
            "field": "$record",
            "code": "ASSIGNMENT_ALREADY_EXISTS",
            "message": "Nhân sự đã được phân công cho đối tượng này.",
            "conflictingId": "asg-existing",
        }]
    finally:
        connection.close()


def test_assignment_writer_returns_structured_conflict_instead_of_integrity_error():
    connection = _assignment_database()
    try:
        cursor = connection.cursor()
        tracker = SimpleNamespace(
            record_row_version=lambda *_args: None,
            track_record=lambda *_args: None,
            track_activity=lambda *_args: None,
            track_audit=lambda *_args: None,
        )
        writer = SyncRecordWriter(
            SimpleNamespace(
                cursor=cursor,
                actor=SimpleNamespace(
                    organization_id="org-1",
                    user_id="user-1",
                ),
                owner_type="organization",
                current_time="2026-08-07 22:50:00",
            ),
            sync_version=2,
            mutation_tracker=tracker,
            clean_record_id=lambda _table, value: value,
            ownership_scoped_tables=set(),
            defer_latest_flag=lambda *_args: None,
            map_database_record=lambda *_args: None,
            save_children=lambda *_args: None,
        )

        result = writer.write(
            payload_key="assignments",
            table_name="phan_cong_nhan_su",
            item={"id": "asg-incoming"},
            db_row_data=_incoming_assignment(),
            previous_record=None,
        )

        assert result.conflict_error == {
            "table": "phan_cong_nhan_su",
            "id": "asg-incoming",
            "field": "$record",
            "code": "ASSIGNMENT_ALREADY_EXISTS",
            "message": "Nhân sự đã được phân công cho đối tượng này.",
            "conflictingId": "asg-existing",
        }
        assert cursor.execute(
            "SELECT count(*) FROM phan_cong_nhan_su"
        ).fetchone()[0] == 1
    finally:
        connection.close()
