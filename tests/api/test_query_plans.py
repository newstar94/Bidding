import sqlite3

from backend.db.db_utils import (
    _build_create_table_sql,
    _create_baseline_indexes_and_triggers,
    _ensure_fts_indexes,
)
from backend.db.migrations import m0005_selective_fts_updates
from backend.db.schema import SCHEMA_DINH_NGHIA


def _details(connection, sql, params):
    return " ".join(
        str(row[3]) for row in connection.execute(f"EXPLAIN QUERY PLAN {sql}", params)
    )


def test_large_list_filters_and_latest_dashboard_use_indexes():
    connection = sqlite3.connect(":memory:")
    connection.executescript(
        """
        CREATE TABLE ke_hoach_lcnt (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            is_latest INTEGER NOT NULL,
            archived_at TEXT,
            ngay_phe_duyet TEXT
        );
        CREATE INDEX idx_ke_hoach_lcnt_latest_date
            ON ke_hoach_lcnt (organization_id, is_latest, archived_at, ngay_phe_duyet);
        CREATE INDEX idx_ke_hoach_lcnt_latest_month
            ON ke_hoach_lcnt (
                organization_id, is_latest, archived_at, substr(ngay_phe_duyet, 6, 2)
            );
        """
    )
    connection.executemany(
        "INSERT INTO ke_hoach_lcnt VALUES (?, ?, 1, NULL, ?)",
        (
            (f"plan-{index}", f"org-{index % 4}", f"202{index % 7}-{index % 12 + 1:02d}-15")
            for index in range(10_000)
        ),
    )
    connection.execute("ANALYZE")

    range_plan = _details(
        connection,
        """
        SELECT id FROM ke_hoach_lcnt
        WHERE organization_id = ? AND is_latest = 1 AND archived_at IS NULL
          AND ngay_phe_duyet >= ? AND ngay_phe_duyet < ?
        """,
        ("org-1", "2026-01-01", "2027-01-01"),
    )
    month_plan = _details(
        connection,
        """
        SELECT id FROM ke_hoach_lcnt
        WHERE organization_id = ? AND is_latest = 1 AND archived_at IS NULL
          AND substr(ngay_phe_duyet, 6, 2) = ?
        """,
        ("org-1", "07"),
    )
    latest_plan = _details(
        connection,
        """
        SELECT COUNT(*) FROM ke_hoach_lcnt
        WHERE organization_id = ? AND is_latest = 1 AND archived_at IS NULL
        """,
        ("org-1",),
    )
    connection.close()

    assert "idx_ke_hoach_lcnt_latest_date" in range_plan
    assert "idx_ke_hoach_lcnt_latest_month" in month_plan
    assert "idx_ke_hoach_lcnt_latest_" in latest_plan
    assert "SCAN ke_hoach_lcnt" not in range_plan
    assert "SCAN ke_hoach_lcnt" not in month_plan


def test_fts5_matches_vietnamese_with_or_without_diacritics_and_tracks_updates():
    connection = sqlite3.connect(":memory:")
    connection.executescript("""
        CREATE TABLE ke_hoach_lcnt (organization_id TEXT, id TEXT, ma_ke_hoach TEXT, ten_ke_hoach TEXT, ten_du_an_du_toan TEXT);
        CREATE TABLE goi_thau (organization_id TEXT, id TEXT, ma_goi_thau TEXT, ten_goi_thau TEXT);
        CREATE TABLE chu_dau_tu (organization_id TEXT, id TEXT, ma_chu_dau_tu TEXT, ten_chu_dau_tu TEXT, ten_viet_tat TEXT, ma_so_thue TEXT);
        CREATE TABLE nha_thau (organization_id TEXT, id TEXT, ma_nha_thau TEXT, ten_nha_thau TEXT, ten_viet_tat TEXT, ma_so_thue TEXT);
        CREATE TABLE hop_dong (organization_id TEXT, id TEXT, so_hop_dong TEXT, ten_hop_dong TEXT);
    """)
    _ensure_fts_indexes(connection.cursor())
    m0005_selective_fts_updates.apply(connection.cursor(), context=None)
    connection.execute(
        "INSERT INTO goi_thau VALUES ('org-1', 'package-1', 'GT-01', 'Mua sắm thiết bị y tế')"
    )
    assert connection.execute(
        "SELECT id FROM fts_goi_thau WHERE fts_goi_thau MATCH 'thiet bi' AND organization_id = 'org-1'"
    ).fetchone()[0] == "package-1"
    connection.execute("UPDATE goi_thau SET ten_goi_thau = 'Dịch vụ tư vấn' WHERE id = 'package-1'")
    assert connection.execute(
        "SELECT id FROM fts_goi_thau WHERE fts_goi_thau MATCH 'tu van' AND organization_id = 'org-1'"
    ).fetchone()[0] == "package-1"
    assert connection.execute(
        "SELECT id FROM fts_goi_thau WHERE fts_goi_thau MATCH 'thiet bi' AND organization_id = 'org-1'"
    ).fetchone() is None
    connection.close()


def test_fts_update_trigger_skips_unindexed_technical_only_updates():
    connection = sqlite3.connect(":memory:")
    connection.executescript("""
        CREATE TABLE ke_hoach_lcnt (organization_id TEXT, id TEXT, ma_ke_hoach TEXT, ten_ke_hoach TEXT, ten_du_an_du_toan TEXT);
        CREATE TABLE goi_thau (organization_id TEXT, id TEXT, ma_goi_thau TEXT, ten_goi_thau TEXT, sync_version INTEGER, updated_at TEXT);
        CREATE TABLE chu_dau_tu (organization_id TEXT, id TEXT, ma_chu_dau_tu TEXT, ten_chu_dau_tu TEXT, ten_viet_tat TEXT, ma_so_thue TEXT);
        CREATE TABLE nha_thau (organization_id TEXT, id TEXT, ma_nha_thau TEXT, ten_nha_thau TEXT, ten_viet_tat TEXT, ma_so_thue TEXT);
        CREATE TABLE hop_dong (organization_id TEXT, id TEXT, so_hop_dong TEXT, ten_hop_dong TEXT);
    """)
    _ensure_fts_indexes(connection.cursor())
    m0005_selective_fts_updates.apply(connection.cursor(), context=None)
    connection.execute(
        """INSERT INTO goi_thau (
               organization_id, id, ma_goi_thau, ten_goi_thau, sync_version, updated_at
           ) VALUES ('org-1', 'package-1', 'GT-01', 'Thiết bị y tế', 1, '2026-01-01')"""
    )
    connection.commit()

    before_technical_update = connection.total_changes
    connection.execute(
        "UPDATE goi_thau SET sync_version = 2, updated_at = '2026-01-02' WHERE id = 'package-1'"
    )
    assert connection.total_changes - before_technical_update == 1
    assert connection.execute(
        "SELECT id FROM fts_goi_thau WHERE fts_goi_thau MATCH 'thiet bi'"
    ).fetchone()[0] == "package-1"
    connection.commit()

    before_indexed_update = connection.total_changes
    connection.execute(
        "UPDATE goi_thau SET ten_goi_thau = 'Dịch vụ tư vấn' WHERE id = 'package-1'"
    )
    assert connection.total_changes - before_indexed_update > 1
    assert connection.execute(
        "SELECT id FROM fts_goi_thau WHERE fts_goi_thau MATCH 'tu van'"
    ).fetchone()[0] == "package-1"
    assert connection.execute(
        "SELECT id FROM fts_goi_thau WHERE fts_goi_thau MATCH 'thiet bi'"
    ).fetchone() is None
    trigger_sql = connection.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_goi_thau_fts_au'"
    ).fetchone()[0]
    assert "WHEN" in trigger_sql
    assert "old.ten_goi_thau IS NOT new.ten_goi_thau" in trigger_sql
    connection.close()


def test_fts5_file_database_accepts_first_business_row(tmp_path):
    connection = sqlite3.connect(tmp_path / "fts-file.db")
    connection.executescript("""
        CREATE TABLE ke_hoach_lcnt (organization_id TEXT, id TEXT, ma_ke_hoach TEXT, ten_ke_hoach TEXT, ten_du_an_du_toan TEXT);
        CREATE TABLE goi_thau (organization_id TEXT, id TEXT, ma_goi_thau TEXT, ten_goi_thau TEXT);
        CREATE TABLE chu_dau_tu (organization_id TEXT, id TEXT, ma_chu_dau_tu TEXT, ten_chu_dau_tu TEXT, ten_viet_tat TEXT, ma_so_thue TEXT);
        CREATE TABLE nha_thau (organization_id TEXT, id TEXT, ma_nha_thau TEXT, ten_nha_thau TEXT, ten_viet_tat TEXT, ma_so_thue TEXT);
        CREATE TABLE hop_dong (organization_id TEXT, id TEXT, so_hop_dong TEXT, ten_hop_dong TEXT);
    """)
    _ensure_fts_indexes(connection.cursor())
    connection.execute("INSERT INTO chu_dau_tu VALUES ('org-1','investor-1','CDT-1','Bệnh viện tỉnh',NULL,NULL)")
    connection.commit()
    assert connection.execute(
        "SELECT id FROM fts_chu_dau_tu WHERE fts_chu_dau_tu MATCH 'benh vien'"
    ).fetchone()[0] == "investor-1"
    assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    connection.close()


def test_fts_trigger_tolerates_lineage_update_during_insert(tmp_path):
    connection = sqlite3.connect(tmp_path / "fts-lineage.db")
    connection.execute("CREATE TABLE chu_dau_tu (organization_id TEXT, id TEXT, id_goc TEXT, ma_chu_dau_tu TEXT, ten_chu_dau_tu TEXT, ten_viet_tat TEXT, ma_so_thue TEXT)")
    connection.executescript("""
        CREATE TABLE ke_hoach_lcnt (organization_id TEXT, id TEXT, ma_ke_hoach TEXT, ten_ke_hoach TEXT, ten_du_an_du_toan TEXT);
        CREATE TABLE goi_thau (organization_id TEXT, id TEXT, ma_goi_thau TEXT, ten_goi_thau TEXT);
        CREATE TABLE nha_thau (organization_id TEXT, id TEXT, ma_nha_thau TEXT, ten_nha_thau TEXT, ten_viet_tat TEXT, ma_so_thue TEXT);
        CREATE TABLE hop_dong (organization_id TEXT, id TEXT, so_hop_dong TEXT, ten_hop_dong TEXT);
        CREATE TRIGGER lineage AFTER INSERT ON chu_dau_tu BEGIN UPDATE chu_dau_tu SET id_goc=NEW.id WHERE rowid=NEW.rowid; END;
    """)
    _ensure_fts_indexes(connection.cursor())
    connection.execute("INSERT INTO chu_dau_tu VALUES ('org-1','investor-1',NULL,'CDT-1','Bệnh viện tỉnh',NULL,NULL)")
    assert connection.execute("SELECT COUNT(*) FROM fts_chu_dau_tu WHERE fts_chu_dau_tu MATCH 'benh vien'").fetchone()[0] == 1
    connection.close()


def test_baseline_has_no_duplicate_non_unique_indexes():
    connection = sqlite3.connect(":memory:")
    for table_name, table_spec in SCHEMA_DINH_NGHIA.items():
        connection.execute(_build_create_table_sql(table_name, table_spec))
    _create_baseline_indexes_and_triggers(connection.cursor())
    duplicates = []
    tables = [row[0] for row in connection.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'fts_%'"
    )]
    for table_name in tables:
        signatures = {}
        for index_row in connection.execute(f"PRAGMA index_list('{table_name}')"):
            index_name, unique, partial = index_row[1], index_row[2], index_row[4]
            if index_name.startswith("sqlite_autoindex") or unique or partial:
                continue
            columns = tuple(row[2] for row in connection.execute(f"PRAGMA index_info('{index_name}')"))
            if columns in signatures:
                duplicates.append((table_name, signatures[columns], index_name, columns))
            signatures[columns] = index_name
    connection.close()
    assert duplicates == []
