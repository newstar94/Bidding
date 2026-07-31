import sqlite3
from types import SimpleNamespace

from backend.db.schema import MONEY_COLUMNS, ROW_VERSION_TABLES, SCHEMA_DINH_NGHIA
from backend.db.upgrades import DB_SCHEMA_VERSION, UPGRADES
from backend.shared.access_policy import (
    BatchWriteAuthorizationContext,
    authorize_record_write_from_context,
)
from backend.sync.bidder_goods import validate_bidder_goods_batch
from backend.sync.payload_validation import validate_sync_item, validate_sync_payload_shape
from backend.sync.queries import TABLE_KEYS


def test_bidder_goods_schema_and_sync_contract():
    columns = SCHEMA_DINH_NGHIA["hang_hoa_du_thau_nha_thau"]["columns"]
    assert TABLE_KEYS["hanghoaduthaunhathau"] == "hang_hoa_du_thau_nha_thau"
    assert "hang_hoa_du_thau_nha_thau" in ROW_VERSION_TABLES
    assert ("hang_hoa_du_thau_nha_thau", "don_gia_du_thau") in MONEY_COLUMNS
    assert ("hang_hoa_du_thau_nha_thau", "thanh_tien_du_thau") in MONEY_COLUMNS
    assert {"mat_hang_du_thau", "ma_hang_hoa", "phan_nhom"}.isdisjoint(columns)
    assert DB_SCHEMA_VERSION >= 27
    assert {"ma_uu_dai", "gia_tri_cong_uu_dai", "thanh_tien_sau_uu_dai", "trang_thai_uu_dai"} <= set(columns)


def test_sync_payload_accepts_bidder_goods_manual_override_as_boolean():
    errors = validate_sync_payload_shape({
        "hanghoaduthaunhathau": [{"uuDaiManualOverride": True}],
        "clientMutationId": "bidder-goods-shape-test",
    })

    assert not any(
        error["field"] == "hanghoaduthaunhathau[0].uuDaiManualOverride"
        for error in errors
    )


def test_v27_migration_is_idempotent_and_backfills_legacy_preference_code():
    statements = []

    class Cursor:
        def execute(self, statement, params=None):
            statements.append((" ".join(statement.split()), params))
            return self

    context = SimpleNamespace(
        create_foreign_keys=lambda *_args, **_kwargs: None,
        create_indexes_and_triggers=lambda *_args, **_kwargs: None,
        assert_foreign_key_integrity=lambda *_args, **_kwargs: None,
    )
    upgrade = next(item for item in UPGRADES if item.version == 27)
    upgrade.apply(Cursor(), context)
    sql = "\n".join(statement for statement, _params in statements)
    assert "ADD COLUMN IF NOT EXISTS ma_uu_dai" in sql
    assert "CHECK(ma_uu_dai BETWEEN 0 AND 5)" in sql
    assert "SET ma_uu_dai = 0 WHERE ma_uu_dai IS NULL" in sql
    assert "ADD COLUMN IF NOT EXISTS gia_so_sanh_sau_uu_dai" in sql


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


def test_backend_rejects_negative_bidder_goods_unit_price():
    _item, errors, _ = validate_sync_item(
        "hang_hoa_du_thau_nha_thau",
        {
            "goiThauId": "package-1",
            "thongTinMoThauId": "opening-1",
            "danhMucHangHoa": "Hàng A",
            "donGiaDuThau": "-1",
            "isDraft": True,
        },
    )
    assert any("Đơn giá dự thầu" in error and "không âm" in error for error in errors)


def _connection():
    connection = sqlite3.connect(":memory:")
    connection.executescript(
        """
        CREATE TABLE goi_thau (id TEXT, organization_id TEXT, linh_vuc TEXT, phan_lo TEXT, trang_thai TEXT, phuong_thuc_lua_chon TEXT, phuong_phap_danh_gia TEXT);
        CREATE TABLE thong_tin_mo_thau (id TEXT, organization_id TEXT, goi_thau_id TEXT, ma_phan_lo TEXT, gia_du_thau INTEGER, archived_at TEXT, ty_le_giam_gia REAL, gia_sau_giam_gia INTEGER);
        CREATE TABLE ket_qua_danh_gia_nha_thau (thong_tin_mo_thau_id TEXT, organization_id TEXT, danh_gia_ky_thuat TEXT);
        CREATE TABLE vong_danh_gia (id TEXT, organization_id TEXT, goi_thau_id TEXT, loai_vong TEXT);
        CREATE TABLE bao_cao_danh_gia_nha_thau (thong_tin_mo_thau_id TEXT, organization_id TEXT, vong_danh_gia_id TEXT, extension_json TEXT);
        CREATE TABLE goi_thau_phan_lo (id TEXT, organization_id TEXT, goi_thau_id TEXT, ma_phan_lo TEXT, archived_at TEXT);
        CREATE TABLE goi_thau_hang_hoa (id TEXT, organization_id TEXT, goi_thau_id TEXT, phan_lo_id TEXT);
        CREATE TABLE hang_hoa_du_thau_nha_thau (id TEXT, organization_id TEXT, thong_tin_mo_thau_id TEXT, phan_lo_id TEXT, goi_thau_hang_hoa_id TEXT, thanh_tien_du_thau INTEGER, is_draft INTEGER);
        INSERT INTO goi_thau VALUES ('package-1', 'org-1', 'Hàng hóa', 'Không', 'Đang chấm thầu', 'Một giai đoạn một túi hồ sơ', 'Giá thấp nhất');
        INSERT INTO goi_thau VALUES ('package-2', 'org-1', 'Hàng hóa', 'Không', 'Đang chấm thầu', 'Một giai đoạn một túi hồ sơ', 'Giá thấp nhất');
        INSERT INTO thong_tin_mo_thau VALUES ('opening-1', 'org-1', 'package-1', '', 100, NULL, 0, 100);
        INSERT INTO ket_qua_danh_gia_nha_thau VALUES ('opening-1', 'org-1', 'Đạt');
        INSERT INTO vong_danh_gia VALUES ('round-1', 'org-1', 'package-1', 'single');
        INSERT INTO bao_cao_danh_gia_nha_thau VALUES (
            'opening-1', 'org-1', 'round-1',
            '{"workflowVersion":2,"completedGroups":["validity","capacity","technical"],"groupResults":{"validity":"Đạt","capacity":"Đạt","technical":"Đạt"}}'
        );
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
        "maUuDai": 0,
        "giaTriCongUuDai": "999999",
        "thanhTienSauUuDai": "999999",
        "isDraft": False,
    }
    assert validate_bidder_goods_batch(connection.cursor(), "org-1", [valid]) == []
    assert valid["giaTriCongUuDai"] == 0
    assert valid["thanhTienSauUuDai"] == 100
    errors = validate_bidder_goods_batch(
        connection.cursor(),
        "org-1",
        [{**valid, "goiThauHangHoaId": "required-other"}],
    )
    assert any(error["code"] == "BIDDER_GOODS_REQUIREMENT_INVALID" for error in errors)
    connection.close()


def test_backend_accepts_mixed_package_and_rejects_non_goods_field():
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
        "maUuDai": 0,
        "isDraft": False,
    }
    connection.execute(
        "UPDATE goi_thau SET linh_vuc = ' Hỗn hợp ' WHERE id = 'package-1'"
    )
    assert validate_bidder_goods_batch(connection.cursor(), "org-1", [valid]) == []
    connection.execute(
        "UPDATE goi_thau SET linh_vuc = 'Xây lắp' WHERE id = 'package-1'"
    )
    errors = validate_bidder_goods_batch(connection.cursor(), "org-1", [valid])
    assert any(error["code"] == "BIDDER_GOODS_PACKAGE_INVALID" for error in errors)
    assert any("Hàng hóa hoặc Hỗn hợp" in error["message"] for error in errors)
    connection.close()


def test_backend_rejects_wrong_lot_duplicates_incomplete_rows_and_bad_totals():
    connection = _connection()
    connection.executescript(
        """
        INSERT INTO goi_thau VALUES ('package-lot', 'org-1', 'Hỗn hợp', 'Có', 'EVALUATING', 'Một giai đoạn một túi hồ sơ', 'Giá thấp nhất');
        INSERT INTO thong_tin_mo_thau VALUES ('opening-lot', 'org-1', 'package-lot', 'L01', 100, NULL, 0, 100);
        INSERT INTO ket_qua_danh_gia_nha_thau VALUES ('opening-lot', 'org-1', 'Đạt');
        INSERT INTO vong_danh_gia VALUES ('round-lot', 'org-1', 'package-lot', 'single');
        INSERT INTO bao_cao_danh_gia_nha_thau VALUES (
            'opening-lot', 'org-1', 'round-lot',
            '{"workflowVersion":2,"completedGroups":["validity","capacity","technical"],"groupResults":{"validity":"Đạt","capacity":"Đạt","technical":"Đạt"}}'
        );
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

    connection.execute(
        "INSERT INTO hang_hoa_du_thau_nha_thau VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("stored-scope-row", "org-1", "opening-lot", "lot-1", "required-lot-1", 40, 0),
    )
    partial_scope = validate_bidder_goods_batch(
        connection.cursor(), "org-1", [second],
    )
    assert any(
        error["code"] == "BIDDER_GOODS_SCOPE_RECOMPUTE_REQUIRED"
        for error in partial_scope
    )
    connection.close()


def test_backend_allows_manual_preference_override_without_reason():
    connection = _connection()
    item = {
        "id": "offered-1",
        "goiThauId": "package-1",
        "thongTinMoThauId": "opening-1",
        "goiThauHangHoaId": "required-1",
        "khoiLuong": 2,
        "donGiaDuThau": "50",
        "thanhTienDuThau": "100",
        "mappingStatus": "matched",
        "uuDaiMatchStatus": "matched",
        "uuDaiManualOverride": True,
        "isDraft": False,
    }
    errors = validate_bidder_goods_batch(connection.cursor(), "org-1", [item])
    assert not any(
        error["code"] == "BIDDER_GOODS_PREFERENCE_OVERRIDE_REASON_REQUIRED"
        for error in errors
    )
    connection.close()


def test_backend_rejects_goods_ready_when_persisted_technical_progress_is_stale():
    connection = _connection()
    connection.execute(
        """UPDATE bao_cao_danh_gia_nha_thau
              SET extension_json =
                  '{"workflowVersion":2,"completedGroups":["validity","capacity"],"groupResults":{"validity":"Đạt","capacity":"Đạt"}}'
            WHERE thong_tin_mo_thau_id = 'opening-1'"""
    )
    item = {
        "id": "offered-1",
        "goiThauId": "package-1",
        "thongTinMoThauId": "opening-1",
        "goiThauHangHoaId": "required-1",
        "khoiLuong": 2,
        "donGiaDuThau": "50",
        "thanhTienDuThau": "100",
        "mappingStatus": "matched",
        "uuDaiMatchStatus": "matched",
        "isDraft": False,
    }
    errors = validate_bidder_goods_batch(connection.cursor(), "org-1", [item])
    assert any(
        error["code"] == "BIDDER_GOODS_TECHNICAL_PREREQUISITE"
        for error in errors
    )
    connection.close()


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
