import sqlite3

import pytest

from backend.db.db_helper import CompatRow
from backend.sync.mapper import _save_clarifications


NOW = "2026-10-03T00:00:00Z"


@pytest.fixture
def clarification_database():
    connection = sqlite3.connect(":memory:")
    connection.row_factory = lambda cursor, values: CompatRow(
        [column[0] for column in cursor.description], values,
    )
    connection.execute(
        """CREATE TABLE goi_thau_lam_ro (
            id TEXT, organization_id TEXT, owner_type TEXT, goi_thau_id TEXT,
            loai TEXT, thoi_gian TEXT, noi_dung TEXT, sort_order INTEGER,
            sync_version INTEGER, updated_at TEXT,
            UNIQUE(organization_id, id)
        )"""
    )
    yield connection
    connection.close()


@pytest.mark.parametrize("key, kind, time_key, content_key", [
    ("yeuCauLamRoList", "yeu_cau", "thoiGianYeuCau", "noiDungYeuCau"),
    ("traLoiLamRoList", "tra_loi", "thoiGianTraLoi", "noiDungTraLoi"),
])
def test_distinct_source_child_ids_keep_equal_time_and_content(
    clarification_database, key, kind, time_key, content_key,
):
    content = {time_key: "2026-10-01T09:00:00", content_key: "Same source content"}
    _save_clarifications(
        clarification_database.cursor(), "package-a",
        {key: [{"id": "source-1", **content}, {"id": "source-2", **content}]},
        "org", "organization", 2, NOW,
    )
    rows = clarification_database.execute(
        "SELECT id, loai, noi_dung, sort_order FROM goi_thau_lam_ro ORDER BY sort_order",
    ).fetchall()
    assert [dict(row) for row in rows] == [
        {"id": "source-1", "loai": kind, "noi_dung": content[content_key], "sort_order": 0},
        {"id": "source-2", "loai": kind, "noi_dung": content[content_key], "sort_order": 1},
    ]


@pytest.mark.parametrize("key, time_key, content_key", [
    ("yeuCauLamRoList", "thoiGianYeuCau", "noiDungYeuCau"),
    ("traLoiLamRoList", "thoiGianTraLoi", "noiDungTraLoi"),
])
def test_exact_repeat_child_id_is_deduplicated(
    clarification_database, key, time_key, content_key,
):
    row = {"id": "source-1", time_key: "2026-10-01T09:00:00", content_key: "Content"}
    _save_clarifications(
        clarification_database.cursor(), "package-a", {key: [row, dict(row)]},
        "org", "organization", 2, NOW,
    )
    assert clarification_database.execute("SELECT COUNT(*) FROM goi_thau_lam_ro").fetchone()[0] == 1


@pytest.mark.parametrize("key, time_key, content_key", [
    ("yeuCauLamRoList", "thoiGianYeuCau", "noiDungYeuCau"),
    ("traLoiLamRoList", "thoiGianTraLoi", "noiDungTraLoi"),
])
def test_legacy_children_without_ids_keep_content_fallback_deduplication(
    clarification_database, key, time_key, content_key,
):
    row = {time_key: "2026-10-01T09:00:00", content_key: " Same  CONTENT "}
    _save_clarifications(
        clarification_database.cursor(), "package-a",
        {key: [row, {time_key: row[time_key], content_key: "same content"}]},
        "org", "organization", 2, NOW,
    )
    rows = clarification_database.execute("SELECT id, noi_dung FROM goi_thau_lam_ro").fetchall()
    assert len(rows) == 1
    assert rows[0]["id"]
    assert rows[0]["noi_dung"] == row[content_key]


def test_explicit_id_and_legacy_same_content_do_not_share_deduplication_identity(clarification_database):
    content = {"thoiGianYeuCau": "2026-10-01T09:00:00", "noiDungYeuCau": "Equal content"}
    _save_clarifications(
        clarification_database.cursor(), "package-a",
        {"yeuCauLamRoList": [content, {"id": "source-1", **content}]},
        "org", "organization", 2, NOW,
    )
    assert clarification_database.execute("SELECT COUNT(*) FROM goi_thau_lam_ro").fetchone()[0] == 2
