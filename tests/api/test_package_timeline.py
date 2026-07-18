import sqlite3

import pytest

from backend.db.migrations import m0003_package_timeline
from backend.sync.payload_validation import validate_sync_payload_shape


class _Context:
    @staticmethod
    def assert_foreign_key_integrity(cursor):
        assert cursor.execute("PRAGMA foreign_key_check").fetchall() == []


def _timeline_item(**overrides):
    item = {
        "maNhom": "I",
        "tenNhom": "KHLCNT + DỰ TOÁN",
        "maMoc": "1.1",
        "congViec": "Chứng thư thẩm định giá, Báo giá",
        "donViBanHanh": "Đơn vị thẩm định",
        "soVanBan": "12/BC-TĐ",
        "ngayDuKien": "2026-07-20",
        "ngayThucTe": "",
        "ghiChu": "",
        "sourceKey": "",
        "sourceMode": "MANUAL",
        "isOptional": False,
        "trangThai": "IN_PROGRESS",
        "sortOrder": 0,
        "templateVersion": 1,
    }
    item.update(overrides)
    return item


def test_timeline_migration_enforces_tenant_fk_and_cascade():
    connection = sqlite3.connect(":memory:")
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute(
        """CREATE TABLE goi_thau (
               id TEXT PRIMARY KEY,
               organization_id TEXT NOT NULL,
               UNIQUE(organization_id, id)
           )"""
    )
    cursor = connection.cursor()
    m0003_package_timeline.apply(cursor, _Context())
    cursor.execute("INSERT INTO goi_thau (id, organization_id) VALUES ('gt-1', 'org-1')")
    values = (
        "tl-1", "org-1", "organization", "gt-1", "I", "KHLCNT + DỰ TOÁN",
        "1.1", "Báo giá", "Chủ đầu tư", "", "2026-07-20", None, "", "",
        "MANUAL", 0, "PENDING", 0, 1, 0,
    )
    cursor.execute(
        """INSERT INTO goi_thau_moc_tien_do (
               id, organization_id, owner_type, goi_thau_id, ma_nhom, ten_nhom,
               ma_moc, cong_viec, don_vi_ban_hanh, so_van_ban, ngay_du_kien,
               ngay_thuc_te, ghi_chu, source_key, source_mode, is_optional,
               trang_thai, sort_order, template_version, sync_version
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        values,
    )
    with pytest.raises(sqlite3.IntegrityError):
        cursor.execute(
            """INSERT INTO goi_thau_moc_tien_do (
                   id, organization_id, owner_type, goi_thau_id, ma_nhom, ten_nhom,
                   ma_moc, cong_viec, source_mode, is_optional, trang_thai,
                   sort_order, template_version, sync_version
               ) VALUES ('tl-cross', 'org-2', 'organization', 'gt-1', 'I',
                         'KHLCNT', '1.2', 'QĐ thành lập tổ', 'MANUAL', 0,
                         'PENDING', 1, 1, 0)"""
        )
    cursor.execute("DELETE FROM goi_thau WHERE organization_id = 'org-1' AND id = 'gt-1'")
    assert cursor.execute("SELECT count(*) FROM goi_thau_moc_tien_do").fetchone()[0] == 0
    connection.close()


def test_timeline_payload_is_strict_and_accepts_unicode():
    payload = {"goithau": [{"id": "gt-1", "timelineItems": [_timeline_item()]}]}
    assert validate_sync_payload_shape(payload) == []

    invalid = _timeline_item(ngayDuKien="20/07/2026", trangThai="OVERDUE", html="<b>x</b>")
    errors = validate_sync_payload_shape({"goithau": [{"id": "gt-1", "timelineItems": [invalid]}]})
    codes = {error["code"] for error in errors}
    assert {"INVALID_DATE", "INVALID_TIMELINE_STATUS", "UNKNOWN_FIELD"} <= codes


def test_timeline_payload_rejects_duplicate_codes_and_more_than_500_rows():
    duplicate = [_timeline_item(), _timeline_item(congViec="Mốc trùng")]
    errors = validate_sync_payload_shape({"goithau": [{"id": "gt-1", "timelineItems": duplicate}]})
    assert any(error["code"] == "DUPLICATE_TIMELINE_CODE" for error in errors)

    too_many = [_timeline_item(maMoc=f"1.{index}") for index in range(501)]
    errors = validate_sync_payload_shape({"goithau": [{"id": "gt-1", "timelineItems": too_many}]})
    assert any(error["code"] == "INVALID_CHILD_LIST" for error in errors)
