import json
import sqlite3
import time
from types import SimpleNamespace

import pytest

from backend.auth.auth_helper import SessionRole
from backend.db.db_helper import SQLiteDatabase
from backend.db.db_utils import _build_create_table_sql
from backend.db.schema import SCHEMA_DINH_NGHIA
from backend.sync import service as sync_service
from backend.sync.delete_policy import (
    DeleteReferenceRule,
    archive_versioned_record,
    build_delete_impact,
    delete_assignment_dependents,
    find_blocking_delete_references,
)


def _connection():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
        CREATE TABLE goi_thau (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            ke_hoach_id TEXT
        );
        CREATE TABLE phan_cong_nhan_su (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            id_muc_tieu TEXT NOT NULL,
            loai_doi_tuong TEXT NOT NULL
        );
        """
    )
    return conn


def test_server_delete_policy_reports_owner_scoped_references():
    conn = _connection()
    try:
        conn.executemany(
            "INSERT INTO goi_thau (id, organization_id, ke_hoach_id) VALUES (?, ?, ?)",
            [
                ("gt-a", "org-a", "kh-1"),
                ("gt-b", "org-b", "kh-1"),
            ],
        )
        references = find_blocking_delete_references(
            conn.cursor(),
            "org-a",
            "ke_hoach_lcnt",
            "kh-1",
            rules=(DeleteReferenceRule("goi_thau", "ke_hoach_id", "gói thầu"),),
        )
    finally:
        conn.close()

    assert references == [{
        "table": "goi_thau",
        "column": "ke_hoach_id",
        "label": "gói thầu",
        "count": 1,
    }]


def test_assignment_rows_are_explicitly_deleted_with_their_aggregate():
    conn = _connection()
    try:
        conn.executemany(
            """
            INSERT INTO phan_cong_nhan_su (
                id, organization_id, id_muc_tieu, loai_doi_tuong
            ) VALUES (?, ?, ?, ?)
            """,
            [
                ("asg-1", "org-a", "gt-1", "goithau"),
                ("asg-2", "org-b", "gt-1", "goithau"),
                ("asg-3", "org-a", "gt-1", "hopdong"),
            ],
        )

        deleted = delete_assignment_dependents(
            conn.cursor(), "org-a", "goi_thau", "gt-1"
        )
        remaining = conn.execute(
            "SELECT id FROM phan_cong_nhan_su ORDER BY id"
        ).fetchall()
    finally:
        conn.close()

    assert deleted == 1
    assert [row[0] for row in remaining] == ["asg-2", "asg-3"]


def test_clean_schema_uses_restrict_for_historical_references():
    protected_specs = {
        "ke_hoach_lcnt": "chu_dau_tu_id",
        "goi_thau": "ke_hoach_id",
        "hop_dong": "nha_thau_id",
        "hop_dong_goi_thau": "goi_thau_id",
        "goi_thau_chuyen_gia": "chuyen_gia_id",
    }

    for table_name, column_name in protected_specs.items():
        foreign_keys = SCHEMA_DINH_NGHIA[table_name].get("foreign_keys", [])
        matching = [
            item for item in foreign_keys
            if f"(organization_id, {column_name})" in item
        ]
        assert matching, f"Missing FK for {table_name}.{column_name}"
        assert all("ON DELETE RESTRICT" in item for item in matching)

    additionally_protected = {
        "ke_hoach_cong_viec": "ke_hoach_id",
        "nha_thau_lien_danh_thanh_vien": "nha_thau_id",
        "goi_thau_phan_lo": "goi_thau_id",
        "goi_thau_gia_han": "goi_thau_id",
        "goi_thau_lam_ro": "goi_thau_id",
        "thong_tin_mo_thau": "goi_thau_id",
        "hop_dong_goi_thau": "hop_dong_id",
    }
    for table_name, column_name in additionally_protected.items():
        foreign_keys = SCHEMA_DINH_NGHIA[table_name].get("foreign_keys", [])
        matching = [
            item for item in foreign_keys
            if f"(organization_id, {column_name})" in item
        ]
        assert matching and all("ON DELETE RESTRICT" in item for item in matching)

    intentional_cascades = {
        "goi_thau_tuy_chon_mua_them": "goi_thau_id",
        "goi_thau_chuyen_gia": "goi_thau_id",
        "thong_tin_mo_thau_lien_danh_thanh_vien": "thong_tin_mo_thau_id",
    }
    for table_name, column_name in intentional_cascades.items():
        foreign_keys = SCHEMA_DINH_NGHIA[table_name].get("foreign_keys", [])
        matching = [
            item for item in foreign_keys
            if f"(organization_id, {column_name})" in item
        ]
        assert matching and all("ON DELETE CASCADE" in item for item in matching)


def test_archive_keeps_referenced_version_and_recalculates_impact():
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        CREATE TABLE goi_thau (
            id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, archived_at TEXT,
            is_latest INTEGER NOT NULL, updated_at TEXT, sync_version INTEGER
        );
        CREATE TABLE thong_tin_mo_thau (
            id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, goi_thau_id TEXT
        );
        CREATE TABLE goi_thau_phan_lo (id TEXT, organization_id TEXT, goi_thau_id TEXT);
        CREATE TABLE goi_thau_tuy_chon_mua_them (id TEXT, organization_id TEXT, goi_thau_id TEXT);
        CREATE TABLE goi_thau_gia_han (id TEXT, organization_id TEXT, goi_thau_id TEXT);
        CREATE TABLE goi_thau_lam_ro (id TEXT, organization_id TEXT, goi_thau_id TEXT);
        CREATE TABLE goi_thau_chuyen_gia (organization_id TEXT, goi_thau_id TEXT);
        CREATE TABLE phan_cong_nhan_su (
            id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, id_muc_tieu TEXT,
            loai_doi_tuong TEXT
        );
        INSERT INTO goi_thau VALUES ('gt-1', 'org-a', NULL, 1, NULL, 0);
        INSERT INTO thong_tin_mo_thau VALUES ('bid-1', 'org-a', 'gt-1');
        INSERT INTO phan_cong_nhan_su VALUES ('asg-1', 'org-a', 'gt-1', 'goithau');
        """
    )

    impact = build_delete_impact(connection.cursor(), "org-a", "goi_thau", "gt-1")
    archived = archive_versioned_record(
        connection.cursor(), "org-a", "goi_thau", "gt-1", "2026-07-14 12:00:00", 4
    )

    assert archived == 1
    assert impact["totalCount"] == 3
    row = connection.execute(
        "SELECT archived_at, is_latest, sync_version FROM goi_thau WHERE id = 'gt-1'"
    ).fetchone()
    assert tuple(row) == ("2026-07-14 12:00:00", 0, 4)
    assert connection.execute("SELECT count(*) FROM thong_tin_mo_thau").fetchone()[0] == 1
    connection.close()


def _sync_delete_database(path, *, reauthenticated=True, historical=False, option=False):
    database = SQLiteDatabase(path)
    connection = database.get_connection()
    for table_name, table_spec in SCHEMA_DINH_NGHIA.items():
        connection.execute(_build_create_table_sql(table_name, table_spec))
    connection.execute(
        "CREATE UNIQUE INDEX deleted_record_identity ON deleted_records(organization_id, table_name, record_id)"
    )
    reauth_at = int(time.time()) if reauthenticated else None
    connection.execute(
        """INSERT INTO tai_khoan (
               id, ten_dang_nhap, username_norm, mat_khau, email, email_norm,
               vai_tro
           ) VALUES (?, ?, ?, 'test-hash', 'manager@example.com', 'manager@example.com', 'user')""",
        ("manager-1", "manager-1", "manager-1"),
    )
    connection.execute(
        """INSERT INTO auth_sessions (
               id, user_id, token_hash, created_at, last_seen_at,
               idle_expires_at, absolute_expires_at, privileged_reauth_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            "session-manager",
            "manager-1",
            "a" * 64,
            1,
            1,
            9999999999,
            9999999999,
            reauth_at,
        ),
    )
    connection.execute(
        "INSERT INTO to_chuc (id, ten_to_chuc) VALUES ('org-a', 'Organization A')"
    )
    connection.execute(
        "INSERT INTO thanh_vien_to_chuc (user_id, organization_id, vai_tro_trong_to_chuc) VALUES ('manager-1', 'org-a', 'manager')"
    )
    connection.execute(
        "INSERT INTO sync_metadata (organization_id, current_version) VALUES ('org-a', 0)"
    )
    connection.execute(
        """INSERT INTO chu_dau_tu (
               id, organization_id, owner_type, ten_chu_dau_tu, ma_qhns
           ) VALUES ('investor-1', 'org-a', 'organization', 'Investor 1', 'QHNS-1')"""
    )
    connection.execute(
        """INSERT INTO ke_hoach_lcnt (
               id, organization_id, owner_type, ten_ke_hoach,
               ten_du_an_du_toan, loai_hinh_mua_sam, chu_dau_tu_id,
               ngay_phe_duyet, quyet_dinh_phe_duyet
           ) VALUES (
               'plan-1', 'org-a', 'organization', 'Plan 1',
               'Project 1', 'Du an', 'investor-1',
               '2026-07-01', 'Decision 1'
           )"""
    )
    connection.execute(
        """INSERT INTO goi_thau (
               id, organization_id, owner_type, ke_hoach_id, ten_goi_thau,
               gia_goi_thau, thoi_gian_thuc_hien, nguon_von,
               thoi_gian_to_chuc, thoi_gian_bat_dau_to_chuc
           ) VALUES (
               'gt-1', 'org-a', 'organization', 'plan-1', 'Package 1',
               100, '30 days', 'Budget', '30 days', '2026-07-01'
           )"""
    )
    if historical:
        connection.execute(
            """INSERT INTO nha_thau (
                id, organization_id, owner_type, ten_nha_thau, ma_nha_thau,
                phien_ban, is_latest
            ) VALUES ('contractor-1', 'org-a', 'organization', 'Nhà thầu 1', 'NT-1', 0, 1)"""
        )
        connection.execute(
            """INSERT INTO thong_tin_mo_thau (
                id, organization_id, owner_type, goi_thau_id, nha_thau_id, ma_phan_lo
            ) VALUES ('bid-1', 'org-a', 'organization', 'gt-1', 'contractor-1', '')"""
        )
    if option:
        connection.execute(
            "INSERT INTO goi_thau_tuy_chon_mua_them (id, organization_id, owner_type, goi_thau_id) VALUES ('option-1', 'org-a', 'organization', 'gt-1')"
        )
    connection.commit()
    connection.close()
    return database


def test_database_restrict_blocks_bypass_delete_of_historical_package(tmp_path):
    database = _sync_delete_database(
        tmp_path / "fk-restrict.db", historical=True, reauthenticated=True
    )
    connection = database.get_connection()
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute("DELETE FROM goi_thau WHERE id = 'gt-1'")
    connection.rollback()
    assert connection.execute(
        "SELECT count(*) FROM goi_thau WHERE id = 'gt-1'"
    ).fetchone()[0] == 1
    connection.close()


class _DeleteRequest:
    query_params = {}
    headers = {}
    client = SimpleNamespace(host="127.0.0.1")

    def __init__(self, include_bid=False):
        self.cookies = {}
        self.include_bid = include_bid

    async def json(self):
        deletions = [{"table": "goithau", "id": "gt-1", "expectedVersion": 1}]
        if self.include_bid:
            deletions.append({"table": "thongtinmothau", "id": "bid-1", "expectedVersion": 1})
        return {
            "baseSyncVersion": 0,
            "clientMutationId": "delete-gt-1",
            "deletions": deletions,
        }


def _patch_sync_actor(monkeypatch, database):
    monkeypatch.setattr(sync_service, "database", database)
    monkeypatch.setattr(
        sync_service,
        "verify_session",
        lambda _request: (True, SessionRole("user", "manager-1", "session-manager")),
    )
    monkeypatch.setattr(
        sync_service,
        "get_active_org",
        lambda _request, _user_id: "org-a",
    )


@pytest.mark.anyio
async def test_direct_sync_delete_archives_historical_aggregate_and_audits(
    monkeypatch, tmp_path
):
    database = _sync_delete_database(
        tmp_path / "archive.db", historical=True, reauthenticated=True
    )
    _patch_sync_actor(monkeypatch, database)

    response = await sync_service.process_sync_request(_DeleteRequest(include_bid=True))
    payload = json.loads(response.body)

    assert response.status_code == 200
    assert [item["action"] for item in payload["deleteImpacts"]] == [
        "archived", "archived"
    ]
    connection = database.get_connection()
    assert connection.execute(
        "SELECT archived_at FROM goi_thau WHERE id = 'gt-1'"
    ).fetchone()[0]
    assert connection.execute(
        "SELECT count(*) FROM thong_tin_mo_thau WHERE id = 'bid-1'"
    ).fetchone()[0] == 1
    assert connection.execute(
        "SELECT archived_at FROM thong_tin_mo_thau WHERE id = 'bid-1'"
    ).fetchone()[0]
    audit = connection.execute(
        "SELECT action, metadata_json FROM audit_log WHERE target_id = 'gt-1'"
    ).fetchone()
    connection.close()
    assert audit[0] == "sync.record_archived"
    assert json.loads(audit[1])["impact"]["totalCount"] >= 2


@pytest.mark.anyio
async def test_aggregate_delete_requires_recent_password_and_rolls_back(
    monkeypatch, tmp_path
):
    database = _sync_delete_database(
        tmp_path / "reauth-required.db", historical=True, reauthenticated=False
    )
    _patch_sync_actor(monkeypatch, database)

    response = await sync_service.process_sync_request(_DeleteRequest())

    assert response.status_code == 403
    assert json.loads(response.body)["code"] == "PRIVILEGED_REAUTH_REQUIRED"
    connection = database.get_connection()
    assert connection.execute(
        "SELECT archived_at FROM goi_thau WHERE id = 'gt-1'"
    ).fetchone()[0] is None
    assert connection.execute("SELECT count(*) FROM audit_log").fetchone()[0] == 0
    connection.close()


@pytest.mark.anyio
async def test_intentional_aggregate_cascade_reports_impact_and_audits(
    monkeypatch, tmp_path
):
    database = _sync_delete_database(
        tmp_path / "cascade.db", option=True, reauthenticated=True
    )
    _patch_sync_actor(monkeypatch, database)

    response = await sync_service.process_sync_request(_DeleteRequest())
    payload = json.loads(response.body)

    assert response.status_code == 200
    impact = payload["deleteImpacts"][0]
    assert impact["action"] == "deleted"
    assert impact["totalCount"] == 2
    connection = database.get_connection()
    assert connection.execute("SELECT count(*) FROM goi_thau").fetchone()[0] == 0
    assert connection.execute(
        "SELECT count(*) FROM goi_thau_tuy_chon_mua_them"
    ).fetchone()[0] == 0
    assert connection.execute(
        "SELECT count(*) FROM audit_log WHERE action = 'sync.record_deleted'"
    ).fetchone()[0] == 1
    connection.close()
