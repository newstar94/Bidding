import sqlite3

from backend.db.schema import MONEY_COLUMNS, ROW_VERSION_TABLES, SCHEMA_DINH_NGHIA
from backend.db.upgrades import DB_SCHEMA_VERSION
from backend.shared.access_policy import (
    BatchWriteAuthorizationContext,
    authorize_record_write_from_context,
)
from backend.sync.bidder_goods import validate_bidder_goods_batch
from backend.sync.payload_validation import validate_sync_item
from backend.sync.queries import TABLE_KEYS


def test_bidder_goods_schema_and_sync_contract():
    columns = SCHEMA_DINH_NGHIA["hang_hoa_du_thau_nha_thau"]["columns"]
    assert TABLE_KEYS["hanghoaduthaunhathau"] == "hang_hoa_du_thau_nha_thau"
    assert "hang_hoa_du_thau_nha_thau" in ROW_VERSION_TABLES
    assert ("hang_hoa_du_thau_nha_thau", "don_gia_du_thau") in MONEY_COLUMNS
    assert ("hang_hoa_du_thau_nha_thau", "thanh_tien_du_thau") in MONEY_COLUMNS
    assert {"mat_hang_du_thau", "ma_hang_hoa", "phan_nhom"}.isdisjoint(columns)
    assert DB_SCHEMA_VERSION == 26


def test_bidder_goods_payload_allows_draft_but_requires_official_mapping():
    draft, errors, _ = validate_sync_item(
        "hang_hoa_du_thau_nha_thau",
        {
            "goiThauId": "package-1",
            "thongTinMoThauId": "opening-1",
            "danhMucHangHoa": "Hàng A",
            "isDraft": True,
        },
    )
    assert not errors
    assert draft["isDraft"] is True

    _official, errors, _ = validate_sync_item(
        "hang_hoa_du_thau_nha_thau",
        {
            "goiThauId": "package-1",
            "thongTinMoThauId": "opening-1",
            "danhMucHangHoa": "Hàng A",
            "isDraft": False,
            "mappingStatus": "unmatched",
        },
    )
    assert any("ghép" in error.lower() for error in errors)


def _connection():
    connection = sqlite3.connect(":memory:")
    connection.executescript(
        """
        CREATE TABLE goi_thau (id TEXT, organization_id TEXT, linh_vuc TEXT, phan_lo TEXT, trang_thai TEXT);
        CREATE TABLE thong_tin_mo_thau (id TEXT, organization_id TEXT, goi_thau_id TEXT, ma_phan_lo TEXT, gia_du_thau INTEGER, archived_at TEXT);
        CREATE TABLE goi_thau_phan_lo (id TEXT, organization_id TEXT, goi_thau_id TEXT, ma_phan_lo TEXT, archived_at TEXT);
        CREATE TABLE goi_thau_hang_hoa (id TEXT, organization_id TEXT, goi_thau_id TEXT, phan_lo_id TEXT);
        CREATE TABLE hang_hoa_du_thau_nha_thau (id TEXT, organization_id TEXT, thong_tin_mo_thau_id TEXT, phan_lo_id TEXT, goi_thau_hang_hoa_id TEXT, thanh_tien_du_thau INTEGER, is_draft INTEGER);
        INSERT INTO goi_thau VALUES ('package-1', 'org-1', 'Hàng hóa', 'Không', 'Đang chấm thầu');
        INSERT INTO goi_thau VALUES ('package-2', 'org-1', 'Hàng hóa', 'Không', 'Đang chấm thầu');
        INSERT INTO thong_tin_mo_thau VALUES ('opening-1', 'org-1', 'package-1', '', 100, NULL);
        INSERT INTO goi_thau_hang_hoa VALUES ('required-1', 'org-1', 'package-1', NULL);
        INSERT INTO goi_thau_hang_hoa VALUES ('required-other', 'org-1', 'package-2', NULL);
        """
    )
    return connection


def test_backend_accepts_consistent_official_batch_and_rejects_cross_package_mapping():
    connection = _connection()
    valid = {
        "id": "offered-1",
        "goiThauId": "package-1",
        "thongTinMoThauId": "opening-1",
        "goiThauHangHoaId": "required-1",
        "phanLoId": None,
        "khoiLuong": 2,
        "donGiaDuThau": "50",
        "thanhTienDuThau": "100",
        "mappingStatus": "matched",
        "isDraft": False,
    }
    assert validate_bidder_goods_batch(connection.cursor(), "org-1", [valid]) == []
    errors = validate_bidder_goods_batch(
        connection.cursor(),
        "org-1",
        [{**valid, "goiThauHangHoaId": "required-other"}],
    )
    assert any(error["code"] == "BIDDER_GOODS_REQUIREMENT_INVALID" for error in errors)


def test_backend_rejects_wrong_lot_duplicates_incomplete_rows_and_bad_totals():
    connection = _connection()
    connection.executescript(
        """
        INSERT INTO goi_thau VALUES ('package-lot', 'org-1', 'Hàng hóa', 'Có', 'EVALUATING');
        INSERT INTO thong_tin_mo_thau VALUES ('opening-lot', 'org-1', 'package-lot', 'L01', 100, NULL);
        INSERT INTO goi_thau_phan_lo VALUES ('lot-1', 'org-1', 'package-lot', 'L01', NULL);
        INSERT INTO goi_thau_phan_lo VALUES ('lot-2', 'org-1', 'package-lot', 'L02', NULL);
        INSERT INTO goi_thau_hang_hoa VALUES ('required-lot-1', 'org-1', 'package-lot', 'lot-1');
        INSERT INTO goi_thau_hang_hoa VALUES ('required-lot-2', 'org-1', 'package-lot', 'lot-1');
        """
    )
    base = {
        "id": "offered-lot-1",
        "goiThauId": "package-lot",
        "thongTinMoThauId": "opening-lot",
        "phanLoId": "lot-1",
        "goiThauHangHoaId": "required-lot-1",
        "khoiLuong": 1,
        "donGiaDuThau": "40",
        "thanhTienDuThau": "40",
        "mappingStatus": "matched",
        "isDraft": False,
    }
    second = {
        **base,
        "id": "offered-lot-2",
        "goiThauHangHoaId": "required-lot-2",
        "donGiaDuThau": "60",
        "thanhTienDuThau": "60",
    }
    assert validate_bidder_goods_batch(connection.cursor(), "org-1", [base, second]) == []

    wrong_lot = validate_bidder_goods_batch(
        connection.cursor(), "org-1", [{**base, "phanLoId": "lot-2"}],
    )
    assert any(error["code"] == "BIDDER_GOODS_OPENING_LOT_MISMATCH" for error in wrong_lot)

    duplicate = validate_bidder_goods_batch(
        connection.cursor(), "org-1", [base, {**base, "id": "duplicate"}],
    )
    assert any(error["code"] == "DUPLICATE_BIDDER_GOODS_MAPPING" for error in duplicate)

    incomplete = validate_bidder_goods_batch(connection.cursor(), "org-1", [base])
    assert any(error["code"] == "BIDDER_GOODS_INCOMPLETE" for error in incomplete)
    assert any(error["code"] == "BIDDER_GOODS_BID_TOTAL_MISMATCH" for error in incomplete)

    bad_line = validate_bidder_goods_batch(
        connection.cursor(), "org-1", [{**base, "thanhTienDuThau": "42"}, second],
    )
    assert any(error["code"] == "BIDDER_GOODS_LINE_TOTAL_MISMATCH" for error in bad_line)


def test_manager_cannot_edit_bidder_goods_after_evaluation_closes():
    context = BatchWriteAuthorizationContext(
        role_str="user",
        user_id="manager-1",
        organization_id="org-1",
        organization_manager=True,
        personal_workspace_owner=False,
        active_membership=True,
        inherited_specialist_access=False,
        membership_role="manager",
        package_status_by_id={"package-1": "RESULT_AVAILABLE"},
    )
    decision = authorize_record_write_from_context(
        context,
        "hanghoaduthaunhathau",
        "hang_hoa_du_thau_nha_thau",
        {"id": "offered-1", "goiThauId": "package-1"},
    )
    assert not decision.allowed


def test_employee_write_inherits_package_assignment_and_evaluation_status():
    context = BatchWriteAuthorizationContext(
        role_str="employee",
        user_id="employee-1",
        organization_id="org-1",
        organization_manager=False,
        personal_workspace_owner=False,
        active_membership=True,
        inherited_specialist_access=False,
        membership_role="employee",
        permissions={"goithau": "edit"},
        assigned_targets={("goithau", "package-1")},
        bidder_goods_parent_by_id={"offered-1": "package-1"},
        package_status_by_id={"package-1": "Đang chấm thầu"},
    )
    decision = authorize_record_write_from_context(
        context,
        "hanghoaduthaunhathau",
        "hang_hoa_du_thau_nha_thau",
        {"id": "offered-1", "goiThauId": "package-1"},
    )
    assert decision.allowed
    context.package_status_by_id["package-1"] = "Đã có kết quả"
    assert not authorize_record_write_from_context(
        context,
        "hanghoaduthaunhathau",
        "hang_hoa_du_thau_nha_thau",
        {"id": "offered-1", "goiThauId": "package-1"},
    ).allowed


def test_employee_write_accepts_persisted_evaluating_status_code():
    context = BatchWriteAuthorizationContext(
        role_str="employee",
        user_id="employee-1",
        organization_id="org-1",
        organization_manager=False,
        personal_workspace_owner=False,
        active_membership=True,
        inherited_specialist_access=False,
        membership_role="employee",
        permissions={"goithau": "edit"},
        assigned_targets={("goithau", "package-1")},
        package_status_by_id={"package-1": "EVALUATING"},
    )
    decision = authorize_record_write_from_context(
        context,
        "hanghoaduthaunhathau",
        "hang_hoa_du_thau_nha_thau",
        {"id": "offered-1", "goiThauId": "package-1"},
    )
    assert decision.allowed
