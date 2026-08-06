import sqlite3

from backend.sync.delete_policy import archive_versioned_record
from backend.sync.mapper import _save_opening_participant_registry


def test_archiving_opening_releases_participant_registry_scope():
    connection = sqlite3.connect(":memory:")
    connection.executescript(
        """
        CREATE TABLE thong_tin_mo_thau (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            archived_at TEXT,
            updated_at TEXT,
            sync_version INTEGER
        );
        CREATE TABLE nha_thau_tham_du_mo_thau (
            organization_id TEXT NOT NULL,
            thong_tin_mo_thau_id TEXT NOT NULL,
            goi_thau_id TEXT NOT NULL,
            lot_scope TEXT NOT NULL,
            nha_thau_goc_id TEXT NOT NULL
        );
        INSERT INTO thong_tin_mo_thau (id, organization_id)
        VALUES ('mt-old', 'org-1');
        INSERT INTO nha_thau_tham_du_mo_thau (
            organization_id, thong_tin_mo_thau_id, goi_thau_id, lot_scope, nha_thau_goc_id
        ) VALUES ('org-1', 'mt-old', 'gt-1', '__PACKAGE__', 'nt-root');
        """
    )

    archive_versioned_record(
        connection.cursor(),
        "org-1",
        "thong_tin_mo_thau",
        "mt-old",
        "2026-08-07 12:00:00",
        42,
    )
    connection.commit()

    assert connection.execute(
        "SELECT archived_at FROM thong_tin_mo_thau WHERE id = 'mt-old'"
    ).fetchone()[0] == "2026-08-07 12:00:00"
    assert connection.execute(
        "SELECT COUNT(*) FROM nha_thau_tham_du_mo_thau WHERE thong_tin_mo_thau_id = 'mt-old'"
    ).fetchone()[0] == 0
    connection.close()


def test_saving_opening_removes_orphaned_registry_before_insert():
    connection = sqlite3.connect(":memory:")
    connection.executescript(
        """
        CREATE TABLE nha_thau (
            id TEXT PRIMARY KEY,
            id_goc TEXT,
            organization_id TEXT
        );
        CREATE TABLE thong_tin_mo_thau (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            goi_thau_id TEXT NOT NULL,
            nha_thau_id TEXT NOT NULL,
            ma_phan_lo TEXT,
            loai_nha_thau TEXT,
            archived_at TEXT
        );
        CREATE TABLE nha_thau_tham_du_mo_thau (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            owner_type TEXT NOT NULL,
            thong_tin_mo_thau_id TEXT NOT NULL,
            goi_thau_id TEXT NOT NULL,
            lot_scope TEXT NOT NULL,
            nha_thau_goc_id TEXT NOT NULL,
            nha_thau_phien_ban_id TEXT NOT NULL
        );
        INSERT INTO nha_thau (id, id_goc, organization_id) VALUES ('nt-version', 'nt-root', 'org-1');
        INSERT INTO thong_tin_mo_thau (
            id, organization_id, goi_thau_id, nha_thau_id, ma_phan_lo, loai_nha_thau, archived_at
        ) VALUES ('mt-old', 'org-1', 'gt-1', 'nt-version', '', 'Độc lập', '2026-08-07 11:00:00');
        INSERT INTO nha_thau_tham_du_mo_thau (
            id, organization_id, owner_type, thong_tin_mo_thau_id, goi_thau_id,
            lot_scope, nha_thau_goc_id, nha_thau_phien_ban_id
        ) VALUES ('registry-old', 'org-1', 'organization', 'mt-old', 'gt-1', '__PACKAGE__', 'nt-root', 'nt-version');
        INSERT INTO thong_tin_mo_thau (
            id, organization_id, goi_thau_id, nha_thau_id, ma_phan_lo, loai_nha_thau, archived_at
        ) VALUES ('mt-new', 'org-1', 'gt-1', 'nt-version', '', 'Độc lập', NULL);
        """
    )

    _save_opening_participant_registry(
        connection.cursor(),
        "mt-new",
        {"nhaThauId": "nt-version", "thanhVienLienDanh": []},
        "org-1",
        "organization",
    )
    connection.commit()

    rows = connection.execute(
        "SELECT thong_tin_mo_thau_id FROM nha_thau_tham_du_mo_thau"
    ).fetchall()
    assert rows == [("mt-new",)]
    connection.close()
