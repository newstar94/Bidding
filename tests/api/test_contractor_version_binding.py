import sqlite3

from backend.app import app  # noqa: F401 - initializes backend import paths
from backend.documents.docx_service import enrich_bids_with_contractor_fields


def test_word_bid_context_uses_exact_contractor_version_and_keeps_jv_name():
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    cursor = connection.cursor()
    cursor.execute(
        """
        CREATE TABLE nha_thau (
            id TEXT PRIMARY KEY,
            ten_nha_thau TEXT,
            ten_viet_tat TEXT,
            ma_nha_thau TEXT,
            ma_so_thue TEXT,
            nguoi_dai_dien TEXT,
            chuc_vu_dai_dien TEXT,
            danh_xung TEXT,
            dia_chi TEXT,
            dia_chi_goc TEXT,
            so_dien_thoai TEXT,
            email TEXT,
            so_tai_khoan TEXT,
            noi_mo_tai_khoan TEXT,
            ma_ngan_hang TEXT
        )
        """
    )
    cursor.executemany(
        """
        INSERT INTO nha_thau (
            id, ten_nha_thau, ten_viet_tat, ma_nha_thau, ma_so_thue
        ) VALUES (?, ?, ?, ?, ?)
        """,
        [
            ("nt-00", "Nhà thầu A", "A00", "vn-a", "0100000000"),
            ("nt-01", "Nhà thầu A phiên bản mới", "A01", "vn-a", "0100000000"),
        ],
    )
    bids = [
        {"nha_thau_id": "nt-00", "loai_nha_thau": "Độc lập", "ten_nha_thau": "Snapshot"},
        {"nha_thau_id": "nt-01", "loai_nha_thau": "Độc lập", "ten_nha_thau": "Snapshot"},
        {"nha_thau_id": "nt-00", "loai_nha_thau": "Liên danh", "ten_nha_thau": "Liên danh A - B"},
    ]

    enrich_bids_with_contractor_fields(cursor, bids)

    assert bids[0]["ten_nha_thau"] == "Nhà thầu A"
    assert bids[0]["ten_viet_tat"] == "A00"
    assert bids[1]["ten_nha_thau"] == "Nhà thầu A phiên bản mới"
    assert bids[1]["ten_viet_tat"] == "A01"
    assert bids[2]["ten_nha_thau"] == "Liên danh A - B"
