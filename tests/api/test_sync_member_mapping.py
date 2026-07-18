import sqlite3

from backend.app import app  # noqa: F401 - initializes backend import paths
from backend.sync.mapper import _format_member_child, _save_member_children, map_db_to_json, save_child_payloads
from backend.shared.date_utils import is_datetime_column
from backend.sync.ownership import validate_owner_scoped_references
from backend.sync.payload_validation import DATE_KEYS_BY_TABLE, validate_sync_item


def test_joint_venture_member_keeps_org_code_separate_from_tax_code():
    connection = sqlite3.connect(":memory:")
    cursor = connection.cursor()
    cursor.execute(
        """
        CREATE TABLE member_rows (
            id TEXT PRIMARY KEY,
            organization_id TEXT,
            owner_type TEXT,
            parent_id TEXT,
            thanh_vien_nha_thau_id TEXT,
            ten_nha_thau TEXT,
            ma_nha_thau TEXT,
            ma_so_thue TEXT,
            vai_tro TEXT,
            nguoi_dai_dien TEXT,
            danh_xung TEXT,
            so_dien_thoai TEXT,
            email TEXT,
            dia_chi TEXT,
            dia_chi_goc TEXT,
            so_tai_khoan TEXT,
            noi_mo_tai_khoan TEXT,
            ma_ngan_hang TEXT,
            sort_order INTEGER,
            sync_version INTEGER,
            updated_at TEXT
        )
        """
    )

    _save_member_children(
        cursor,
        "member_rows",
        "parent_id",
        "parent-1",
        {
            "thanhVienLienDanh": [
                {
                    "thanhVienNhaThauId": "nt-version-00",
                    "tenNhaThau": "Don vi khong co MST",
                    "maNhaThau": "vnz000050923",
                    "maSoThue": "",
                }
            ]
        },
        "owner-1",
        "organization",
        1,
        "2026-07-11 12:00:00",
    )

    row = cursor.execute(
        "SELECT thanh_vien_nha_thau_id, ma_nha_thau, ma_so_thue FROM member_rows"
    ).fetchone()
    assert row == ("nt-version-00", "vnz000050923", "")

    formatted = _format_member_child(
        {"thanh_vien_nha_thau_id": row[0], "ma_nha_thau": row[1], "ma_so_thue": row[2]},
        "camel",
    )
    assert formatted["thanhVienNhaThauId"] == "nt-version-00"
    assert formatted["maNhaThau"] == "vnz000050923"
    assert formatted["maSoThue"] == ""


def test_contractor_stamp_fields_are_mapped_to_frontend_contract():
    mapped = map_db_to_json(
        "nha_thau",
        {
            "anh_dau": "images/nha_thau/nt-1_stamp.png",
            "ten_anh_dau": "DAU_NT-1.png",
        },
    )

    assert mapped["anhDau"] == "images/nha_thau/nt-1_stamp.png"
    assert mapped["tenAnhDau"] == "DAU_NT-1.png"


def test_package_start_period_is_plain_text_not_datetime():
    assert is_datetime_column("thoi_gian_bat_dau_to_chuc") is False
    assert "thoiGianBatDauToChuc" not in DATE_KEYS_BY_TABLE["goi_thau"]
    _, errors, _ = validate_sync_item(
        "goi_thau",
        {
            "tenGoiThau": "Goi thau IDS IPS",
            "keHoachId": "kh-1",
            "giaGoiThau": 0,
            "thoiGianThucHien": "30 ngày",
            "nguonVon": "Ngân sách",
            "thoiGianToChuc": "30 ngày",
            "thoiGianBatDauToChuc": "Quý II, 2026",
        },
    )
    assert errors == []


def test_same_batch_plan_reference_is_allowed_but_foreign_assignment_is_rejected():
    connection = sqlite3.connect(":memory:")
    cursor = connection.cursor()
    cursor.execute("CREATE TABLE to_chuc (id TEXT PRIMARY KEY)")
    cursor.execute("CREATE TABLE thanh_vien_to_chuc (organization_id TEXT, user_id TEXT)")
    cursor.execute("CREATE TABLE ke_hoach_lcnt (id TEXT, organization_id TEXT)")
    cursor.execute("CREATE TABLE goi_thau (id TEXT, organization_id TEXT)")
    cursor.execute("CREATE TABLE hop_dong (id TEXT, organization_id TEXT)")
    cursor.execute("CREATE TABLE chu_dau_tu (id TEXT, organization_id TEXT)")
    cursor.execute("CREATE TABLE nha_thau (id TEXT, organization_id TEXT)")

    package_errors = validate_owner_scoped_references(
        cursor,
        "org-1",
        "goi_thau",
        {"keHoachId": "kh-new"},
        {"ke_hoach_lcnt": {"kh-new"}},
    )
    assignment_errors = validate_owner_scoped_references(
        cursor,
        "org-1",
        "phan_cong_nhan_su",
        {"empId": "mgr-1", "targetId": "kh-new", "type": "kehoach"},
        {"ke_hoach_lcnt": {"kh-new"}},
    )

    assert package_errors == []
    assert assignment_errors == ["Nhan su mgr-1 khong thuoc owner hien tai."]


def test_joint_venture_member_version_must_belong_to_current_owner():
    connection = sqlite3.connect(":memory:")
    cursor = connection.cursor()
    cursor.execute("CREATE TABLE nha_thau (id TEXT, organization_id TEXT, archived_at TEXT, id_goc TEXT)")
    cursor.execute("CREATE TABLE goi_thau (id TEXT, organization_id TEXT, archived_at TEXT)")
    cursor.execute("CREATE TABLE thong_tin_mo_thau (id TEXT, organization_id TEXT)")
    cursor.execute("INSERT INTO nha_thau (id, organization_id) VALUES ('nt-foreign', 'org-2')")

    errors = validate_owner_scoped_references(
        cursor,
        "org-1",
        "thong_tin_mo_thau",
        {
            "thanhVienLienDanh": [
                {"thanhVienNhaThauId": "nt-foreign"}
            ]
        },
    )

    assert errors == [
        "Thanh vien lien danh nha_thau_id=nt-foreign khong thuoc owner hien tai."
    ]


def test_joint_venture_cannot_use_two_versions_of_one_contractor():
    connection = sqlite3.connect(":memory:")
    cursor = connection.cursor()
    cursor.execute("CREATE TABLE nha_thau (id TEXT, organization_id TEXT, archived_at TEXT, id_goc TEXT)")
    cursor.execute("CREATE TABLE goi_thau (id TEXT, organization_id TEXT, archived_at TEXT, phan_lo TEXT)")
    cursor.execute("CREATE TABLE goi_thau_phan_lo (organization_id TEXT, goi_thau_id TEXT, ma_phan_lo TEXT)")
    cursor.executemany(
        "INSERT INTO nha_thau VALUES (?, 'org-1', NULL, 'nt-root')",
        [("nt-v0",), ("nt-v1",)],
    )

    errors = validate_owner_scoped_references(
        cursor,
        "org-1",
        "thong_tin_mo_thau",
        {
            "thanhVienLienDanh": [
                {"thanhVienNhaThauId": "nt-v0"},
                {"thanhVienNhaThauId": "nt-v1"},
            ]
        },
    )

    assert "Một nhà thầu logic không được xuất hiện bằng nhiều phiên bản trong cùng liên danh." in errors


def test_partial_parent_update_does_not_delete_absent_child_lists():
    class RecordingCursor:
        def __init__(self):
            self.statements = []

        def execute(self, sql, _params=()):
            self.statements.append(" ".join(sql.split()))
            return self

        def executemany(self, sql, _rows):
            self.statements.append(" ".join(sql.split()))
            return self

    cursor = RecordingCursor()
    save_child_payloads(
        cursor, "goi_thau", {"id": "package-1", "tenGoiThau": "Only parent changed"},
        "org-1", "organization", 2, "2026-07-15 00:00:00",
    )
    assert cursor.statements == []
