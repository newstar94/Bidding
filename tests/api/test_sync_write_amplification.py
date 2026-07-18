import json
import sqlite3

import pytest

from backend.auth.auth_helper import SessionRole
from backend.db import db_utils
from backend.db import migration_runner
from backend.db.db_helper import SQLiteDatabase
from backend.db.db_utils import recalculate_is_latest, recalculate_tong_muc_dau_tu
import backend.sync.service as sync_service


_IMMUTABLE_M0001_CHECKSUM = (
    "896636bd793f98bcbe8e90104ca99a8d03145f611a192f602a6c9f15a0367660"
)


class _RecordingCursor:
    def __init__(self, cursor):
        self._cursor = cursor
        self.statements = []

    def execute(self, sql, params=()):
        self.statements.append(" ".join(str(sql).split()))
        self._cursor.execute(sql, params)
        return self

    def fetchone(self):
        return self._cursor.fetchone()


class _SyncRequest:
    headers = {}
    cookies = {}
    query_params = {}

    def __init__(self, payload):
        self._payload = payload

    async def json(self):
        return self._payload


def test_latest_recalculation_updates_only_targeted_lineage_and_skips_noops():
    connection = sqlite3.connect(":memory:")
    connection.executescript(
        """
        CREATE TABLE ke_hoach_lcnt (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            id_goc TEXT,
            phien_ban INTEGER NOT NULL,
            is_latest INTEGER NOT NULL,
            archived_at TEXT,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE update_log (record_id TEXT NOT NULL);
        CREATE TRIGGER log_plan_latest_update
        AFTER UPDATE OF is_latest ON ke_hoach_lcnt
        BEGIN
            INSERT INTO update_log(record_id) VALUES (new.id);
        END;
        INSERT INTO ke_hoach_lcnt VALUES
            ('a-0', 'org-1', 'root-a', 0, 1, NULL, '2026-01-01 00:00:00'),
            ('a-1', 'org-1', 'root-a', 1, 0, NULL, '2026-02-01 00:00:00'),
            ('b-0', 'org-1', 'root-b', 0, 1, NULL, '2026-01-01 00:00:00'),
            ('b-1', 'org-1', 'root-b', 1, 0, NULL, '2026-02-01 00:00:00'),
            ('other-0', 'org-2', 'root-a', 0, 1, NULL, '2026-01-01 00:00:00');
        """
    )
    cursor = _RecordingCursor(connection.cursor())

    changed = recalculate_is_latest(
        cursor,
        "ke_hoach_lcnt",
        organization_id="org-1",
        affected_families={"root-a"},
    )

    assert changed == 2
    assert connection.execute(
        "SELECT record_id FROM update_log ORDER BY record_id"
    ).fetchall() == [("a-0",), ("a-1",)]
    assert connection.execute(
        "SELECT id, is_latest FROM ke_hoach_lcnt ORDER BY id"
    ).fetchall() == [
        ("a-0", 0),
        ("a-1", 1),
        ("b-0", 1),
        ("b-1", 0),
        ("other-0", 1),
    ]
    assert sum("UPDATE ke_hoach_lcnt" in sql for sql in cursor.statements) == 1

    connection.execute("DELETE FROM update_log")
    cursor.statements.clear()
    assert recalculate_is_latest(
        cursor,
        "ke_hoach_lcnt",
        organization_id="org-1",
        affected_families={"root-a"},
    ) == 0
    assert connection.execute("SELECT count(*) FROM update_log").fetchone()[0] == 0
    assert sum("UPDATE ke_hoach_lcnt" in sql for sql in cursor.statements) == 1
    connection.close()


def test_package_latest_recalculation_keeps_plan_snapshot_families_separate():
    connection = sqlite3.connect(":memory:")
    connection.executescript(
        """
        CREATE TABLE goi_thau (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            id_goc TEXT,
            ke_hoach_id TEXT NOT NULL,
            phien_ban INTEGER NOT NULL,
            is_latest INTEGER NOT NULL,
            archived_at TEXT,
            updated_at TEXT NOT NULL
        );
        INSERT INTO goi_thau VALUES
            ('a-0', 'org-1', 'shared-root', 'plan-a', 0, 1, NULL, '2026-01-01 00:00:00'),
            ('a-1', 'org-1', 'shared-root', 'plan-a', 1, 0, NULL, '2026-02-01 00:00:00'),
            ('b-0', 'org-1', 'shared-root', 'plan-b', 0, 1, NULL, '2026-01-01 00:00:00'),
            ('b-1', 'org-1', 'shared-root', 'plan-b', 1, 0, NULL, '2026-02-01 00:00:00');
        """
    )

    changed = recalculate_is_latest(
        connection.cursor(),
        "goi_thau",
        organization_id="org-1",
        affected_families={("shared-root", "plan-a")},
    )

    assert changed == 2
    assert connection.execute(
        "SELECT id, is_latest FROM goi_thau ORDER BY id"
    ).fetchall() == [
        ("a-0", 0),
        ("a-1", 1),
        ("b-0", 1),
        ("b-1", 0),
    ]
    connection.close()


def test_plan_total_recalculation_is_targeted_set_based_and_change_only():
    connection = sqlite3.connect(":memory:")
    connection.executescript(
        """
        CREATE TABLE ke_hoach_lcnt (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            loai_hinh_mua_sam TEXT NOT NULL,
            is_tong_muc_tu_dong INTEGER NOT NULL,
            archived_at TEXT,
            tong_muc_dau_tu INTEGER
        );
        CREATE TABLE goi_thau (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            ke_hoach_id TEXT NOT NULL,
            gia_goi_thau INTEGER,
            is_latest INTEGER NOT NULL,
            archived_at TEXT,
            is_rebid INTEGER NOT NULL
        );
        CREATE TABLE ke_hoach_cong_viec (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            ke_hoach_id TEXT NOT NULL,
            loai TEXT NOT NULL,
            gia_tri INTEGER
        );
        CREATE TABLE total_update_log (plan_id TEXT NOT NULL);
        CREATE TRIGGER log_plan_total_update
        AFTER UPDATE OF tong_muc_dau_tu ON ke_hoach_lcnt
        BEGIN
            INSERT INTO total_update_log(plan_id) VALUES (new.id);
        END;
        INSERT INTO ke_hoach_lcnt VALUES
            ('plan-a', 'org-1', 'Dự án', 1, NULL, 0),
            ('plan-b', 'org-1', 'Dự toán mua sắm', 1, NULL, 0),
            ('plan-c', 'org-2', 'Dự án', 1, NULL, 0);
        INSERT INTO goi_thau VALUES
            ('package-a', 'org-1', 'plan-a', 100, 1, NULL, 0),
            ('package-b', 'org-1', 'plan-b', 200, 1, NULL, 0),
            ('rebid-a', 'org-1', 'plan-a', 999, 1, NULL, 1),
            ('package-c', 'org-2', 'plan-c', 300, 1, NULL, 0);
        INSERT INTO ke_hoach_cong_viec VALUES
            ('work-a-1', 'org-1', 'plan-a', 'da_thuc_hien', 10),
            ('work-a-2', 'org-1', 'plan-a', 'khong_ap_dung', 20),
            ('work-a-3', 'org-1', 'plan-a', 'chua_du_dieu_kien', 30),
            ('work-b-1', 'org-1', 'plan-b', 'da_thuc_hien', 50),
            ('work-b-2', 'org-1', 'plan-b', 'khong_ap_dung', 5);
        """
    )
    cursor = _RecordingCursor(connection.cursor())

    changed = recalculate_tong_muc_dau_tu(
        cursor,
        organization_id="org-1",
        plan_ids={"plan-a", "plan-b"},
    )

    assert changed == 2
    assert connection.execute(
        "SELECT id, tong_muc_dau_tu FROM ke_hoach_lcnt ORDER BY id"
    ).fetchall() == [
        ("plan-a", 160),
        ("plan-b", 205),
        ("plan-c", 0),
    ]
    assert connection.execute(
        "SELECT plan_id FROM total_update_log ORDER BY plan_id"
    ).fetchall() == [("plan-a",), ("plan-b",)]
    assert sum("UPDATE ke_hoach_lcnt" in sql for sql in cursor.statements) == 1

    connection.execute("DELETE FROM total_update_log")
    cursor.statements.clear()
    assert recalculate_tong_muc_dau_tu(
        cursor,
        organization_id="org-1",
        plan_ids={"plan-a", "plan-b"},
    ) == 0
    assert connection.execute("SELECT count(*) FROM total_update_log").fetchone()[0] == 0
    assert sum("UPDATE ke_hoach_lcnt" in sql for sql in cursor.statements) == 1
    connection.close()


@pytest.mark.anyio
async def test_sync_passes_only_mutated_version_families_and_plan_ids(
    monkeypatch, tmp_path
):
    database = SQLiteDatabase(tmp_path / "targeted-sync.db")
    monkeypatch.setattr(db_utils, "database", database)
    monkeypatch.setenv("ADMIN_PASSWORD", "Test-only-password-123!")
    db_utils.khoi_tao_va_di_tru_he_thong()

    connection = database.get_connection()
    organization_id = connection.execute("SELECT id FROM to_chuc LIMIT 1").fetchone()[0]
    user_id = connection.execute("SELECT id FROM tai_khoan LIMIT 1").fetchone()[0]
    connection.close()
    role = SessionRole("super_admin", user_id)
    monkeypatch.setattr(sync_service, "database", database)
    monkeypatch.setattr(sync_service, "verify_session", lambda _request: (True, role))
    monkeypatch.setattr(
        sync_service,
        "get_active_org",
        lambda _request, _user_id: organization_id,
    )

    real_latest = sync_service.recalculate_is_latest
    real_total = sync_service.recalculate_tong_muc_dau_tu
    latest_calls = []
    total_calls = []

    def record_latest(cursor, table_name, organization_id=None, **kwargs):
        latest_calls.append(
            (table_name, organization_id, set(kwargs.get("affected_families") or ()))
        )
        return real_latest(cursor, table_name, organization_id, **kwargs)

    def record_total(cursor, organization_id=None, **kwargs):
        total_calls.append((organization_id, set(kwargs.get("plan_ids") or ())))
        return real_total(cursor, organization_id, **kwargs)

    monkeypatch.setattr(sync_service, "recalculate_is_latest", record_latest)
    monkeypatch.setattr(sync_service, "recalculate_tong_muc_dau_tu", record_total)

    create_response = await sync_service.process_sync_request(_SyncRequest({
        "clientMutationId": "create-targeted-families",
        "chudautu": [{
            "id": "investor-a",
            "tenChuDauTu": "Chủ đầu tư A",
        }],
        "kehoach": [{
            "id": "plan-a",
            "tenKeHoach": "Kế hoạch A",
            "tenDuAnDuToan": "Dự toán A",
            "loaiHinhMuaSam": "Dự toán mua sắm",
            "chuDauTuId": "investor-a",
            "ngayPheDuyet": "2026-01-02",
            "quyetDinhPheDuyet": "QD-A",
            "isTongMucTuDong": 1,
        }],
        "goithau": [{
            "id": "package-a",
            "keHoachId": "plan-a",
            "tenGoiThau": "Gói thầu A",
            "giaGoiThau": 100,
            "thoiGianThucHien": "30 ngày",
            "nguonVon": "Ngân sách",
            "thoiGianToChuc": "30 ngày",
            "thoiGianBatDauToChuc": "Quý I/2026",
        }],
    }))
    assert create_response.status_code == 200, json.loads(create_response.body)
    assert {
        (table_name, frozenset(families))
        for table_name, _org, families in latest_calls
    } == {
        ("chu_dau_tu", frozenset({"investor-a"})),
        ("ke_hoach_lcnt", frozenset({"plan-a"})),
        ("goi_thau", frozenset({("package-a", "plan-a")})),
    }
    assert total_calls == [(organization_id, {"plan-a"})]

    latest_calls.clear()
    total_calls.clear()
    update_response = await sync_service.process_sync_request(_SyncRequest({
        "clientMutationId": "update-one-package-family",
        "goithau": [{
            "id": "package-a",
            "expectedVersion": 1,
            "keHoachId": "plan-a",
            "tenGoiThau": "Gói thầu A cập nhật",
            "giaGoiThau": 150,
            "thoiGianThucHien": "30 ngày",
            "nguonVon": "Ngân sách",
            "thoiGianToChuc": "30 ngày",
            "thoiGianBatDauToChuc": "Quý I/2026",
        }],
    }))
    assert update_response.status_code == 200, json.loads(update_response.body)
    assert latest_calls == [
        ("goi_thau", organization_id, {("package-a", "plan-a")})
    ]
    assert total_calls == [(organization_id, {"plan-a"})]


def test_v4_upgrade_applies_selective_fts_trigger_without_rewriting_baseline(
    monkeypatch, tmp_path
):
    database = SQLiteDatabase(tmp_path / "fts-v4-upgrade.db")
    monkeypatch.setattr(db_utils, "database", database)
    monkeypatch.setenv("ADMIN_PASSWORD", "Test-only-password-123!")
    all_migrations = migration_runner.MIGRATIONS
    assert all_migrations[3].NAME == "0004_pending_email_changes"

    connection = database.get_connection()
    try:
        context = migration_runner.MigrationContext(
            build_create_table_sql=db_utils._build_create_table_sql,
            create_indexes_and_triggers=db_utils._create_baseline_indexes_and_triggers,
            assert_foreign_key_integrity=db_utils._assert_foreign_key_integrity,
        )
        with monkeypatch.context() as v4_patch:
            v4_patch.setattr(migration_runner, "MIGRATIONS", all_migrations[:4])
            connection.execute("BEGIN IMMEDIATE")
            assert migration_runner.run_migrations(connection.cursor(), context) == 4
            connection.commit()

        baseline_checksum = connection.execute(
            "SELECT checksum FROM schema_migrations WHERE version = 1"
        ).fetchone()[0]
        assert baseline_checksum == _IMMUTABLE_M0001_CHECKSUM
        old_trigger_sql = connection.execute(
            """SELECT sql FROM sqlite_master
               WHERE type = 'trigger' AND name = 'trg_goi_thau_fts_au'"""
        ).fetchone()[0]
        assert "WHEN" not in old_trigger_sql.upper()
        connection.execute(
            """INSERT INTO fts_goi_thau (
                   rowid, organization_id, id, ma_goi_thau, ten_goi_thau
               ) VALUES (987654321, 'upgrade-org', 'upgrade-marker', 'M5', 'sentinel migration')"""
        )
        connection.commit()
    finally:
        connection.close()

    db_utils.khoi_tao_va_di_tru_he_thong()

    connection = database.get_connection()
    try:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == db_utils.DB_SCHEMA_VERSION
        assert connection.execute(
            "SELECT name FROM schema_migrations WHERE version = 5"
        ).fetchone()[0] == "0005_selective_fts_updates"
        assert connection.execute(
            "SELECT checksum FROM schema_migrations WHERE version = 1"
        ).fetchone()[0] == _IMMUTABLE_M0001_CHECKSUM
        upgraded_trigger_sql = connection.execute(
            """SELECT sql FROM sqlite_master
               WHERE type = 'trigger' AND name = 'trg_goi_thau_fts_au'"""
        ).fetchone()[0]
        assert "WHEN" in upgraded_trigger_sql.upper()
        assert "old.ten_goi_thau IS NOT new.ten_goi_thau" in upgraded_trigger_sql
        assert connection.execute(
            "SELECT id FROM fts_goi_thau WHERE fts_goi_thau MATCH 'sentinel'"
        ).fetchone()[0] == "upgrade-marker"
    finally:
        connection.close()
