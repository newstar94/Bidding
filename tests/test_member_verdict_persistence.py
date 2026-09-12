import os
from pathlib import Path

import psycopg
import pytest

from backend.db.db_helper import PostgresCursor
from backend.sync.mapper import _save_member_children


@pytest.mark.parametrize("contractor,code,expected,checks,member_id", [
    ("contractor", "code", "VIOLATION_CONFIRMED", 1, "member"),
    ("other-contractor", "code", "NOT_CHECKED", 0, "member"),
    ("contractor", "other-code", "NOT_CHECKED", 0, "member"),
    ("contractor", "code", "NOT_CHECKED", 0, "new-member"),
])
def test_member_save_preserves_verdict_only_for_unchanged_identity(contractor, code, expected, checks, member_id):
    url = os.environ.get("TEST_DATABASE_URL", "")
    if not url:
        for line in (Path(__file__).resolve().parents[1] / ".env").read_text(encoding="utf-8-sig").splitlines():
            key, separator, value = line.partition("=")
            if separator and key == "TEST_DATABASE_URL":
                url = value.strip().strip('"').strip("'")
    if not url:
        pytest.skip("TEST_DATABASE_URL is required")
    with psycopg.connect(url, connect_timeout=5) as connection:
        connection.execute("SET LOCAL search_path TO pg_temp")
        connection.execute("SET LOCAL statement_timeout=10000")
        # Temporary tables shadow only this connection; no application data changes.
        connection.execute("""CREATE TEMP TABLE thong_tin_mo_thau_lien_danh_thanh_vien (
            id TEXT PRIMARY KEY, organization_id TEXT, owner_type TEXT,
            thong_tin_mo_thau_id TEXT, thanh_vien_nha_thau_id TEXT,
            ten_nha_thau TEXT, ma_nha_thau TEXT, ma_so_thue TEXT, vai_tro TEXT,
            nguoi_dai_dien TEXT, danh_xung TEXT, so_dien_thoai TEXT, email TEXT,
            dia_chi TEXT, dia_chi_goc TEXT, so_tai_khoan TEXT,
            noi_mo_tai_khoan TEXT, ma_ngan_hang TEXT, sort_order INTEGER,
            sync_version INTEGER, updated_at TEXT,
            violation_status TEXT DEFAULT 'NOT_CHECKED',
            violation_bid_closing_at TEXT, violation_checked_at TEXT
        ) ON COMMIT DROP""")
        connection.execute("""CREATE TEMP TABLE member_checks (
            member_id TEXT REFERENCES thong_tin_mo_thau_lien_danh_thanh_vien(id)
            ON DELETE CASCADE
        ) ON COMMIT DROP""")
        connection.execute("""INSERT INTO thong_tin_mo_thau_lien_danh_thanh_vien
            (id, organization_id, thong_tin_mo_thau_id, thanh_vien_nha_thau_id,
             ma_nha_thau, ma_so_thue, violation_status)
            VALUES ('member', 'org', 'opening', 'contractor', 'code', '', 'VIOLATION_CONFIRMED')""")
        connection.execute("INSERT INTO member_checks VALUES ('member')")
        _save_member_children(PostgresCursor(connection.cursor()),
            "thong_tin_mo_thau_lien_danh_thanh_vien", "thong_tin_mo_thau_id",
            "opening", {"thanhVienLienDanh": [{"id": member_id,
                "thanhVienNhaThauId": contractor, "maNhaThau": code,
                "violationStatus": "VIOLATION_CONFIRMED" if member_id == "new-member" else "NO_ACTIVE_VIOLATION"}]},
            "org", "organization", 2, "2026-09-12")
        assert connection.execute("SELECT violation_status FROM thong_tin_mo_thau_lien_danh_thanh_vien").fetchone()[0] == expected
        assert connection.execute("SELECT COUNT(*) FROM member_checks").fetchone()[0] == checks
