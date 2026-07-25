from __future__ import annotations

import math

import pytest

from backend.shared.domain_enums import (
    CONTRACT_STATUS_LABELS,
    PACKAGE_STATUS_LABELS,
)
from backend.sync import payload_validation as validation


def _codes(errors):
    return {error["code"] for error in errors if isinstance(error, dict)}


def test_package_policy_is_stable_and_presentation_neutral() -> None:
    policy = validation.get_package_field_policy()
    assert policy["statusCodes"] == PACKAGE_STATUS_LABELS
    assert policy["statusOrder"] == list(PACKAGE_STATUS_LABELS.values())
    assert policy["lockedAfterInvitation"] == sorted(
        validation.PACKAGE_LOCKED_FIELDS_AFTER_INVITATION
    )


def test_payload_shape_rejects_non_object_and_invalid_top_level_fields() -> None:
    assert _codes(validation.validate_sync_payload_shape([])) == {
        "TYPE_OBJECT_REQUIRED"
    }
    errors = validation.validate_sync_payload_shape(
        {
            "unknown": True,
            "clientMutationId": "",
            "baseSyncVersion": True,
            "includeDashboardSummary": "yes",
            "deletions": {},
            "goithau": {},
        }
    )
    assert {
        "UNKNOWN_FIELD",
        "INVALID_MUTATION_ID",
        "INVALID_INTEGER",
        "INVALID_BOOLEAN",
        "TYPE_ARRAY_REQUIRED",
    }.issubset(_codes(errors))


def test_deletion_shape_is_fail_closed() -> None:
    errors = validation.validate_sync_payload_shape(
        {
            "deletions": [
                "bad",
                {
                    "table": "unknown",
                    "id": "",
                    "expectedVersion": True,
                    "extra": 1,
                },
                {
                    "table": "goithau",
                    "id": "record-1",
                    "expectedVersion": 0,
                },
            ]
        }
    )
    assert {
        "TYPE_OBJECT_REQUIRED",
        "UNKNOWN_FIELD",
        "INVALID_TABLE",
        "INVALID_ID",
        "INVALID_ROW_VERSION",
    }.issubset(_codes(errors))
    assert (
        validation.validate_sync_payload_shape(
            {
                "clientMutationId": "mutation-1",
                "baseSyncVersion": "0",
                "includeDashboardSummary": True,
                "deletions": [
                    {
                        "table": "goithau",
                        "id": "record-1",
                        "expectedVersion": 1,
                    }
                ],
            }
        )
        == []
    )


def test_json_complexity_limits_depth_size_keys_and_text() -> None:
    assert validation._validate_json_depth({"valid": [1, "text"]})
    assert not validation._validate_json_depth({1: "non-string-key"})
    assert not validation._validate_json_depth(
        {str(index): index for index in range(501)}
    )
    assert not validation._validate_json_depth(
        list(range(validation.MAX_SYNC_CHILD_ITEMS + 1))
    )
    assert not validation._validate_json_depth(
        "x" * (validation.MAX_SYNC_TEXT_LENGTH + 1)
    )
    value = "leaf"
    for _ in range(10):
        value = {"next": value}
    assert not validation._validate_json_depth(value)


def test_record_shape_rejects_unknown_complex_and_row_version() -> None:
    deep = "leaf"
    for _ in range(10):
        deep = {"next": deep}
    errors = validation.validate_sync_payload_shape(
        {
            "goithau": [
                "not-object",
                {
                    "unknown": True,
                    "expectedVersion": False,
                    "danhGiaHsdtMetadata": {"deep": deep},
                },
            ]
        }
    )
    assert {
        "TYPE_OBJECT_REQUIRED",
        "UNKNOWN_FIELD",
        "INVALID_ROW_VERSION",
        "INVALID_EVALUATION_METADATA",
        "PAYLOAD_TOO_COMPLEX",
    }.issubset(_codes(errors))


def test_virtual_evaluation_fields_validate_number_string_and_length() -> None:
    errors = validation.validate_sync_payload_shape(
        {
            "thongtinmothau": [
                {
                    "diemDanhGia": True,
                    "danhGiaHopLe": 123,
                    "lyDoTruot": "x" * (validation.MAX_SYNC_TEXT_LENGTH + 1),
                },
                {"diemDanhGia": -1},
                {"diemDanhGia": math.inf},
            ]
        }
    )
    assert "INVALID_NUMBER" in _codes(errors)
    assert "INVALID_STRING" in _codes(errors)
    assert "STRING_TOO_LONG" in _codes(errors)


def test_child_lists_validate_type_size_ids_and_objects(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(validation, "MAX_SYNC_CHILD_ITEMS", 1)
    errors = validation.validate_sync_payload_shape(
        {
                "hopdong": [
                    {"goiThauIds": "not-list"},
                    {"goiThauIds": [""]},
                    {"goiThauIds": ["one", "two"]},
            ],
            "goithau": [
                {"phanLoList": ["not-object"]},
            ],
        }
    )
    assert {
        "TYPE_ARRAY_REQUIRED",
        "INVALID_ID_LIST",
        "INVALID_CHILD_LIST",
        "TYPE_OBJECT_REQUIRED",
    }.issubset(_codes(errors))


def test_detailed_evaluation_reports_are_validated_as_child_arrays() -> None:
    errors = validation.validate_sync_payload_shape(
        {
            "thongtinmothau": [
                {"baoCaoDanhGiaChiTietList": "not-an-array"},
                {
                    "baoCaoDanhGiaChiTietList": [
                        "not-an-object",
                        {"chiTietList": "not-an-array"},
                    ]
                },
            ]
        }
    )
    paths = {error["field"] for error in errors if isinstance(error, dict)}
    codes = _codes(errors)
    assert "thongtinmothau[0].baoCaoDanhGiaChiTietList" in paths
    assert "thongtinmothau[1].baoCaoDanhGiaChiTietList[0]" in paths
    assert "thongtinmothau[1].baoCaoDanhGiaChiTietList[1].chiTietList" in paths
    assert "TYPE_ARRAY_REQUIRED" in codes
    assert "TYPE_OBJECT_REQUIRED" in codes


def test_child_numeric_fields_reject_invalid_money_numbers_and_ranges() -> None:
    errors = validation.validate_sync_payload_shape(
        {
            "goithau": [
                {
                    "phanLoList": [
                        {
                            "giaTri": -1,
                            "soLuong": True,
                            "tyLe": 101,
                            "so_luong": -1,
                            "name": "x" * (validation.MAX_SYNC_TEXT_LENGTH + 1),
                            "ignoredNone": None,
                        }
                    ]
                }
            ]
        }
    )
    assert {
        "INVALID_MONEY",
        "INVALID_NUMBER",
        "VALUE_OUT_OF_RANGE",
        "STRING_TOO_LONG",
    }.issubset(_codes(errors))


def test_timeline_shape_rejects_every_untrusted_field_class() -> None:
    timeline = {
        "unknown": "field",
        "maNhom": "VI",
        "tenNhom": 123,
        "maMoc": "invalid",
        "congViec": "",
        "ngayDuKien": "2026-02-30",
        "ngayThucTe": 123,
        "sourceMode": "REMOTE",
        "trangThai": "INVALID",
        "isOptional": "yes",
        "sortOrder": True,
        "templateVersion": 0,
    }
    duplicate = {
        "maNhom": "I",
        "tenNhom": "Group",
        "maMoc": "1.1",
        "congViec": "Task",
    }
    errors = validation.validate_sync_payload_shape(
        {
            "goithau": [
                {
                    "timelineItems": [
                        "not-object",
                        timeline,
                        duplicate,
                        duplicate,
                    ]
                }
            ]
        }
    )
    assert {
        "TYPE_OBJECT_REQUIRED",
        "UNKNOWN_FIELD",
        "REQUIRED",
        "INVALID_STRING",
        "INVALID_TIMELINE_GROUP",
        "INVALID_TIMELINE_CODE",
        "DUPLICATE_TIMELINE_CODE",
        "INVALID_DATE",
        "INVALID_SOURCE_MODE",
        "INVALID_TIMELINE_STATUS",
        "INVALID_BOOLEAN",
        "INVALID_SORT_ORDER",
        "INVALID_TEMPLATE_VERSION",
    }.issubset(_codes(errors))


def test_scalar_schema_fields_reject_null_wrong_type_precision_and_length() -> None:
    errors = validation.validate_sync_payload_shape(
        {
            "goithau": [
                {
                    "organizationId": None,
                    "giaGoiThau": -1,
                    "phienBan": "1",
                    "isLatest": 2,
                    "tyLeBaoDamHopDong": 1.23456,
                    "tenGoiThau": 123,
                    "maGoiThau": "x"
                    * (validation.MAX_SYNC_TEXT_LENGTH + 1),
                }
            ]
        }
    )
    assert {
        "NULL_NOT_ALLOWED",
        "INVALID_MONEY",
        "INVALID_INTEGER",
        "INVALID_BOOLEAN",
        "DECIMAL_PRECISION_EXCEEDED",
        "INVALID_STRING",
        "STRING_TOO_LONG",
    }.issubset(_codes(errors))
    errors = validation.validate_sync_payload_shape(
        {"goithau": [{"tyLeBaoDamHopDong": math.nan}]}
    )
    assert "INVALID_NUMBER" in _codes(errors)


def test_status_transition_and_locked_field_policies() -> None:
    preparing = PACKAGE_STATUS_LABELS["PREPARING"]
    invited = PACKAGE_STATUS_LABELS["INVITED"]
    opened = PACKAGE_STATUS_LABELS["OPENED"]
    evaluating = PACKAGE_STATUS_LABELS["EVALUATING"]
    partially_awarded = PACKAGE_STATUS_LABELS["PARTIALLY_AWARDED"]
    awarded = PACKAGE_STATUS_LABELS["AWARDED"]
    cancelled = PACKAGE_STATUS_LABELS["CANCELLED"]
    assert validation.validate_package_status_transition(
        "", {"trangThai": preparing}
    ) == []
    assert validation.validate_package_status_transition(
        preparing, {"trangThai": preparing}
    ) == []
    assert validation.validate_package_status_transition(
        preparing, {"trangThai": invited}
    ) == []
    assert validation.validate_package_status_transition(
        preparing,
        {
            "trangThai": awarded,
            "hinhThucLuaChon": "Chỉ định thầu rút gọn",
        },
    ) == []
    assert validation.validate_package_status_transition(
        invited, {"trangThai": awarded}
    )
    assert validation.validate_package_status_transition(
        evaluating, {"trangThai": partially_awarded}
    ) == []
    assert validation.validate_package_status_transition(
        partially_awarded, {"trangThai": awarded}
    ) == []
    assert validation.validate_package_status_transition(
        cancelled, {"trangThai": preparing}
    ) == []

    assert validation.validate_package_locked_fields(
        {"trang_thai": "PREPARING"}, {"tenGoiThau": "changed"}
    ) == []
    assert validation.validate_package_locked_fields(
        {"trang_thai": "INVITED", "ten_goi_thau": "same"},
        {"tenGoiThau": "same"},
    ) == []
    locked = validation.validate_package_locked_fields(
        {"trang_thai": "INVITED", "ten_goi_thau": "before"},
        {"tenGoiThau": "after"},
    )
    assert _codes(locked) == {"PACKAGE_FIELD_LOCKED"}
    assert validation.validate_package_locked_fields(
        {"trang_thai": "INVITED"}, {"unrelated": "value"}
    ) == []

    active = CONTRACT_STATUS_LABELS["ACTIVE"]
    suspended = CONTRACT_STATUS_LABELS["SUSPENDED"]
    liquidated = CONTRACT_STATUS_LABELS["LIQUIDATED"]
    assert validation.validate_contract_status_transition(
        active, {"trangThaiHopDong": active}
    ) == []
    assert validation.validate_contract_status_transition(
        active, {"trangThaiHopDong": suspended}
    ) == []
    assert validation.validate_contract_status_transition(
        liquidated, {"trangThaiHopDong": active}
    ) == []


def test_internal_numeric_and_list_helpers_are_strict() -> None:
    assert validation._is_blank(None)
    assert validation._is_blank(" ")
    assert not validation._is_blank(0)
    assert validation._as_list([1]) == [1]
    assert validation._as_list("[1]") == [1]
    assert validation._as_list('{"not": "list"}') == []
    assert validation._as_list("invalid") == []
    assert validation._as_list(None) == []
    assert validation._is_strict_integer(1)
    assert not validation._is_strict_integer(True)
    assert validation._has_supported_decimal_precision("1.2345")
    assert not validation._has_supported_decimal_precision("1.23456")
    assert not validation._has_supported_decimal_precision("invalid")


def test_team_leader_requires_exactly_one_leader() -> None:
    errors = []
    validation._validate_single_team_leader(
        {"team": [{"chucVu": "Member"}]}, "team", "Team", errors
    )
    assert errors
    errors.clear()
    validation._validate_single_team_leader(
        {"team": [{"chucVu": "Tổ trưởng"}]}, "team", "Team", errors
    )
    assert errors == []


def test_date_helpers_accept_supported_formats_and_reject_invalid() -> None:
    assert validation.is_valid_date_format("")
    assert validation.is_valid_date_format("2026-07-19")
    assert not validation.is_valid_date_format("19/07/not-a-year")
    assert validation.parse_date("2026-07-19") is not None
    assert validation.parse_date("invalid") is None


def test_investor_and_expert_item_validation_defaults_dates() -> None:
    investor = {"createdAt": "2026-07-19T10:00:00"}
    normalized, errors, extra = validation.validate_sync_item(
        "chu_dau_tu", investor
    )
    assert normalized["ngayApDung"] == "2026-07-19"
    assert errors
    assert extra == set()

    investor = {"tenChuDauTu": "Investor", "createdAt": "invalid"}
    normalized, errors, _ = validation.validate_sync_item(
        "chu_dau_tu", investor
    )
    assert normalized["ngayApDung"]
    assert errors == []

    _, errors, _ = validation.validate_sync_item(
        "chuyen_gia", {"hoTen": "", "soCCCD": "123"}
    )
    assert len(errors) == 2
    _, errors, _ = validation.validate_sync_item(
        "chuyen_gia", {"hoTen": "Expert", "soCCCD": "123456789012"}
    )
    assert errors == []


def test_plan_item_validation_covers_required_money_project_and_date_order() -> None:
    item = {
        "loaiHinhMuaSam": "Dự án",
        "pheDuyet": "Kế hoạch",
        "tongMucDauTu": -1,
        "isTongMucTuDong": "true",
        "ngayTrinhDuToan": "2026-07-20",
        "ngayPheDuyetDuToan": "2026-07-19",
        "ngayTrinhKeHoach": "2026-07-20",
        "ngayPheDuyet": "2026-07-19",
    }
    normalized, errors, _ = validation.validate_sync_item(
        "ke_hoach_lcnt", item
    )
    assert normalized["isTongMucTuDong"] == 1
    assert len(errors) >= 10

    valid = {
        "tenKeHoach": "Plan",
        "tenDuAnDuToan": "Project",
        "loaiHinhMuaSam": "Khác",
        "chuDauTuId": "investor",
        "ngayPheDuyet": "2026-07-20",
        "quyetDinhPheDuyet": "Decision",
        "tongMucDauTu": "1000",
        "isTongMucTuDong": False,
    }
    normalized, errors, _ = validation.validate_sync_item(
        "ke_hoach_lcnt", valid
    )
    assert normalized["isTongMucTuDong"] == 0
    assert errors == []


def test_plan_submission_numbers_follow_the_selected_approval_flow() -> None:
    plan = {
        "tenKeHoach": "Kế hoạch mua sắm",
        "tenDuAnDuToan": "Dự toán thiết bị",
        "loaiHinhMuaSam": "Dự toán mua sắm",
        "chuDauTuId": "investor",
        "ngayPheDuyet": "2026-07-22",
        "quyetDinhPheDuyet": "01/QĐ-CĐT",
        "pheDuyet": "Kế hoạch",
        "ngayTrinhDuToan": "2026-07-19",
        "ngayPheDuyetDuToan": "2026-07-20",
        "soQdPheDuyetDuToan": "02/QĐ-CĐT",
        "ngayTrinhKeHoach": "2026-07-21",
    }
    _, errors, _ = validation.validate_sync_item("ke_hoach_lcnt", plan)
    assert any("Số tờ trình dự toán" in error for error in errors)
    assert any("Số tờ trình kế hoạch" in error for error in errors)

    plan.update({
        "soToTrinhDuToan": "01/TTr-CĐT",
        "soToTrinhKeHoach": "02/TTr-CĐT",
    })
    _, errors, _ = validation.validate_sync_item("ke_hoach_lcnt", plan)
    assert errors == []

    combined = {
        **plan,
        "pheDuyet": "Dự toán và kế hoạch",
        "soToTrinhDuToan": "",
        "soToTrinhKeHoach": "",
    }
    _, errors, _ = validation.validate_sync_item("ke_hoach_lcnt", combined)
    assert any("Số tờ trình dự toán và kế hoạch" in error for error in errors)
    combined["soToTrinhDuToanKeHoach"] = "03/TTr-CĐT"
    _, errors, _ = validation.validate_sync_item("ke_hoach_lcnt", combined)
    assert errors == []


def test_json_email_phone_tax_and_date_fields_are_validated() -> None:
    item = {
        "tenKeHoach": "Plan",
        "tenDuAnDuToan": "Project",
        "loaiHinhMuaSam": "Khác",
        "chuDauTuId": "investor",
        "ngayPheDuyet": "not-a-date",
        "quyetDinhPheDuyet": "Decision",
        "email": "invalid",
        "soDienThoai": "bad",
        "maSoThue": "bad",
    }
    _, errors, _ = validation.validate_sync_item("ke_hoach_lcnt", item)
    assert len(errors) == 4

    item["email"] = "user@example.com"
    item["soDienThoai"] = "+84 912-345-678"
    item["maSoThue"] = "0123456789"
    item["ngayPheDuyet"] = "2026-07-19"
    _, errors, _ = validation.validate_sync_item("ke_hoach_lcnt", item)
    assert errors == []


@pytest.mark.parametrize("value", ["not-json", '"scalar"', 123])
def test_declared_json_columns_reject_invalid_representations(
    monkeypatch: pytest.MonkeyPatch, value
) -> None:
    columns = validation.SCHEMA_DINH_NGHIA["ke_hoach_lcnt"]["columns"]
    monkeypatch.setitem(columns, "cv_custom_list", "TEXT")
    _, errors, _ = validation.validate_sync_item(
        "ke_hoach_lcnt",
        {
            "tenKeHoach": "Plan",
            "tenDuAnDuToan": "Project",
            "loaiHinhMuaSam": "Khác",
            "chuDauTuId": "investor",
            "ngayPheDuyet": "2026-07-19",
            "quyetDinhPheDuyet": "Decision",
            "cvCustomList": value,
        },
    )
    assert any("JSON" in error for error in errors)


def test_contractor_joint_venture_validation_rejects_invalid_members() -> None:
    item = {
        "tenNhaThau": "Joint venture",
        "loaiNhaThau": "Liên danh",
        "maSoThue": "0123456789",
        "thanhVienLienDanh": [
            "invalid",
            {"thanhVienNhaThauId": "", "vaiTro": "Unknown"},
            {
                "thanhVienNhaThauId": "member-1",
                "vaiTro": "Đứng đầu liên danh",
            },
            {
                "thanhVienNhaThauId": "member-1",
                "vaiTro": "Đứng đầu liên danh",
            },
        ],
    }
    _, errors, _ = validation.validate_sync_item("nha_thau", item)
    assert len(errors) >= 6

    independent = {
        "tenNhaThau": "Independent",
        "loaiNhaThau": "Độc lập",
        "thanhVienLienDanh": [{"thanhVienNhaThauId": "member"}],
    }
    _, errors, _ = validation.validate_sync_item("nha_thau", independent)
    assert errors

    auto_created = {
        "tenNhaThau": "Auto",
        "maSoThue": "external-id",
        "maNhaThau": "external-id",
    }
    _, errors, _ = validation.validate_sync_item("nha_thau", auto_created)
    assert errors == []


def _minimal_package(**overrides):
    item = {
        "id": "package-1",
        "keHoachId": "plan-1",
        "tenGoiThau": "Package",
        "giaGoiThau": "100",
        "thoiGianThucHien": "30 days",
        "nguonVon": "Budget",
        "thoiGianToChuc": "Q3",
        "thoiGianBatDauToChuc": "July",
        "trangThai": PACKAGE_STATUS_LABELS["PREPARING"],
        "phanLo": "Không",
        "tuyChonMuaThem": "Không",
    }
    item.update(overrides)
    return item


def test_investor_head_position_is_derived_from_representative_position() -> None:
    deputy = {
        "tenChuDauTu": "Trường Demo",
        "chucVuDaiDien": "Hiệu phó",
        "chucVuNguoiDungDau": "Dữ liệu không hợp lệ",
    }
    normalized, errors, _ = validation.validate_sync_item("chu_dau_tu", deputy)
    assert normalized["chucVuNguoiDungDau"] == "Hiệu trưởng"
    assert errors == []

    head = {
        "tenChuDauTu": "Đơn vị Demo",
        "chucVuDaiDien": "Chủ tịch",
    }
    normalized, errors, _ = validation.validate_sync_item("chu_dau_tu", head)
    assert normalized["chucVuNguoiDungDau"] == "Chủ tịch"
    assert errors == []


def test_package_rebid_status_schedule_and_numeric_rules() -> None:
    item = _minimal_package(
        isRebid=True,
        rebidFromPackageId="package-1",
        trangThai="INVALID",
        thoiGianDangTai="2026-07-20T10:00:00",
        thoiGianDongThau="2026-07-20T09:00:00",
        thoiGianMoThau="2026-07-20T08:00:00",
        phuongPhapDanhGia="Kết hợp giữa kỹ thuật và giá",
        trongSoKyThuat=101,
        giaGoiThau=-1,
        toChuyenGia=[{"chucVu": "Member"}],
        toThamDinh=[
            {"chucVu": "Tổ trưởng"},
            {"chucVu": "Tổ trưởng"},
        ],
    )
    normalized, errors, _ = validation.validate_sync_item("goi_thau", item)
    assert normalized["isRebid"] == 1
    assert len(errors) >= 7

    inconsistent = _minimal_package(
        isRebid=False, rebidFromPackageId="package-old"
    )
    _, errors, _ = validation.validate_sync_item("goi_thau", inconsistent)
    assert errors


def test_package_technical_weight_only_applies_to_combined_method() -> None:
    lowest_price = _minimal_package(
        phuongPhapDanhGia="Giá thấp nhất",
        trongSoKyThuat=70,
    )
    normalized, errors, _ = validation.validate_sync_item("goi_thau", lowest_price)
    assert normalized["trongSoKyThuat"] is None
    assert errors == []

    combined = _minimal_package(
        phuongPhapDanhGia="Kết hợp giữa kỹ thuật và giá",
        trongSoKyThuat=70,
    )
    normalized, errors, _ = validation.validate_sync_item("goi_thau", combined)
    assert normalized["trongSoKyThuat"] == 70
    assert errors == []


@pytest.mark.parametrize(
    "status_code",
    ["INVITED", "OPENED", "AWARDED"],
)
def test_package_status_levels_require_server_business_fields(
    status_code: str,
) -> None:
    item = _minimal_package(trangThai=PACKAGE_STATUS_LABELS[status_code])
    _, errors, _ = validation.validate_sync_item("goi_thau", item)
    assert errors

    direct = _minimal_package(
        trangThai=PACKAGE_STATUS_LABELS[status_code],
        hinhThucLuaChon="Chỉ định thầu rút gọn",
    )
    _, direct_errors, _ = validation.validate_sync_item("goi_thau", direct)
    if status_code != "AWARDED":
        assert direct_errors == []


def test_partial_result_status_only_applies_to_lotted_packages() -> None:
    item = _minimal_package(
        trangThai=PACKAGE_STATUS_LABELS["PARTIALLY_AWARDED"],
        phanLo="Không",
    )
    _, errors, _ = validation.validate_sync_item("goi_thau", item)
    assert any("chỉ áp dụng cho gói thầu có phần lô" in error for error in errors)


def test_package_lot_and_purchase_option_invariants() -> None:
    no_lots = _minimal_package(phanLo="Có", phanLoList=[])
    _, errors, _ = validation.validate_sync_item("goi_thau", no_lots)
    assert errors

    lots = _minimal_package(
        phanLo="Có",
        phanLoList=[
            {"maPhanLo": "", "giaTriPhanLo": "40"},
            {"maPhanLo": "A", "giaTriPhanLo": "40"},
            {"maPhanLo": "a", "giaTriPhanLo": "40"},
        ],
    )
    _, errors, _ = validation.validate_sync_item("goi_thau", lots)
    assert len(errors) >= 2

    unexpected_lots = _minimal_package(
        phanLo="Không", phanLoList=[{"maPhanLo": "A", "giaTriPhanLo": "100"}]
    )
    _, errors, _ = validation.validate_sync_item("goi_thau", unexpected_lots)
    assert errors

    missing_options = _minimal_package(tuyChonMuaThem="Có")
    _, errors, _ = validation.validate_sync_item("goi_thau", missing_options)
    assert errors
    unexpected_options = _minimal_package(
        tuyChonMuaThem="Không", tuyChonMuaThemList=[{"name": "Option"}]
    )
    _, errors, _ = validation.validate_sync_item("goi_thau", unexpected_options)
    assert errors


def test_lotted_package_derives_package_price_from_its_lots() -> None:
    item = _minimal_package(
        phanLo="Có",
        giaGoiThau="999",
        phanLoList=[
            {"maPhanLo": "A", "giaTriPhanLo": "40"},
            {"maPhanLo": "B", "giaTriPhanLo": "60"},
        ],
    )

    normalized, errors, _ = validation.validate_sync_item("goi_thau", item)

    assert errors == []
    assert normalized["giaGoiThau"] == "100"

    missing_price = _minimal_package(
        phanLo="Có",
        giaGoiThau="",
        phanLoList=[{"maPhanLo": "A", "giaTriPhanLo": "75"}],
    )
    normalized, errors, _ = validation.validate_sync_item("goi_thau", missing_price)

    assert errors == []
    assert normalized["giaGoiThau"] == "75"


def test_awarded_lots_validate_membership_winner_value_and_derive_total() -> None:
    item = _minimal_package(
        trangThai=PACKAGE_STATUS_LABELS["AWARDED"],
        hinhThucLuaChon="Chỉ định thầu rút gọn",
        phanLo="Có",
        phanLoList=[
            {"maPhanLo": "A", "giaTriPhanLo": "40"},
            {
                "maPhanLo": "B",
                "giaTriPhanLo": "60",
                "nhaThauTrungThauId": "winner",
            },
        ],
        nhaThauTrungThauId="winner",
        awardedPhanLoList=[
            {"maPhanLo": "unknown", "giaTrungThau": "bad"},
            {
                "maPhanLo": "A",
                "nhaThauTrungThauId": "other",
                "giaTrungThau": "40",
            },
            {
                "maPhanLo": "A",
                "nhaThauTrungThauId": "winner",
                "giaTrungThau": "50",
            },
        ],
    )
    normalized, errors, _ = validation.validate_sync_item("goi_thau", item)
    assert len(errors) >= 4
    assert normalized["giaTrungThau"] == "90"

    no_award = _minimal_package(
        trangThai=PACKAGE_STATUS_LABELS["AWARDED"],
        hinhThucLuaChon="Chỉ định thầu rút gọn",
        phanLo="Có",
        phanLoList=[{"maPhanLo": "A", "giaTriPhanLo": "100"}],
    )
    _, errors, _ = validation.validate_sync_item("goi_thau", no_award)
    assert errors


def test_lotted_package_allows_different_winners_and_derives_package_projection() -> None:
    item = _minimal_package(
        trangThai=PACKAGE_STATUS_LABELS["AWARDED"],
        hinhThucLuaChon="Chỉ định thầu rút gọn",
        phanLo="Có",
        soQuyetDinhKetQua="QĐ-01",
        ngayQuyetDinhKetQua="2026-07-22",
        giaTrungThau="1",
        phanLoList=[
            {"maPhanLo": "A", "giaTriPhanLo": "40"},
            {"maPhanLo": "B", "giaTriPhanLo": "60"},
        ],
        nhaThauTrungThauId="legacy-winner",
        awardedPhanLoList=[
            {
                "maPhanLo": "A",
                "nhaThauTrungThauId": "winner-a",
                "giaTrungThau": "35",
            },
            {
                "maPhanLo": "B",
                "nhaThauTrungThauId": "winner-b",
                "giaTrungThau": "55",
            },
        ],
    )

    normalized, errors, _ = validation.validate_sync_item("goi_thau", item)

    assert errors == []
    assert normalized.get("nhaThauTrungThauId") is None
    assert normalized["giaTrungThau"] == "90"


def test_lotted_package_allows_official_result_with_no_winning_lot() -> None:
    item = _minimal_package(
        trangThai=PACKAGE_STATUS_LABELS["AWARDED"],
        hinhThucLuaChon="Chỉ định thầu rút gọn",
        phanLo="Có",
        soQuyetDinhKetQua="QĐ-03",
        ngayQuyetDinhKetQua="2026-07-24",
        giaTrungThau="0",
        phanLoList=[
            {"maPhanLo": "A", "giaTriPhanLo": "40"},
            {"maPhanLo": "B", "giaTriPhanLo": "60"},
        ],
        awardedPhanLoList=[],
    )

    normalized, errors, _ = validation.validate_sync_item("goi_thau", item)

    assert errors == []
    assert normalized.get("nhaThauTrungThauId") is None
    assert normalized["giaTrungThau"] == "0"


def test_lotted_package_projects_single_common_winner_for_legacy_consumers() -> None:
    item = _minimal_package(
        trangThai=PACKAGE_STATUS_LABELS["AWARDED"],
        hinhThucLuaChon="Chỉ định thầu rút gọn",
        phanLo="Có",
        soQuyetDinhKetQua="QĐ-02",
        ngayQuyetDinhKetQua="2026-07-22",
        giaTrungThau="1",
        phanLoList=[
            {"maPhanLo": "A", "giaTriPhanLo": "40"},
            {"maPhanLo": "B", "giaTriPhanLo": "60"},
        ],
        awardedPhanLoList=[
            {
                "maPhanLo": "A",
                "nhaThauTrungThauId": "winner",
                "giaTrungThau": "35",
            },
            {
                "maPhanLo": "B",
                "nhaThauTrungThauId": "winner",
                "giaTrungThau": "55",
            },
        ],
    )

    normalized, errors, _ = validation.validate_sync_item("goi_thau", item)

    assert errors == []
    assert normalized["nhaThauTrungThauId"] == "winner"
    assert normalized["giaTrungThau"] == "90"


def _minimal_contract(**overrides):
    item = {
        "tenHopDong": "Contract",
        "soHopDong": "01",
        "ngayKy": "2026-07-20",
        "chuDauTuId": "investor",
        "nhaThauId": "contractor",
        "keHoachId": "plan",
        "giaTri": "100",
        "loaiHopDong": "Fixed",
        "soNgayThucHien": "30",
        "trangThaiHopDong": CONTRACT_STATUS_LABELS["ACTIVE"],
        "goiThauIds": ["package"],
    }
    item.update(overrides)
    return item


def test_contract_validation_covers_dates_direct_award_status_and_catalog() -> None:
    item = _minimal_contract(
        giaTri=-1,
        ngayThanhLy="2026-07-19",
        coQdChiDinh=True,
        ngayQdChiDinh="2026-07-21",
        trangThaiHopDong="INVALID",
    )
    _, errors, _ = validation.validate_sync_item(
        "hop_dong", item, allowed_contract_status_names={CONTRACT_STATUS_LABELS["ACTIVE"]}
    )
    assert len(errors) >= 4

    inconsistent = _minimal_contract(
        coQdChiDinh=False,
        soQdChiDinh="must-be-empty",
        ngayThanhLy="2026-07-21",
    )
    _, errors, _ = validation.validate_sync_item(
        "hop_dong", inconsistent, allowed_contract_status_names={CONTRACT_STATUS_LABELS["ACTIVE"]}
    )
    assert errors

    liquidated = _minimal_contract(
        trangThaiHopDong=CONTRACT_STATUS_LABELS["LIQUIDATED"],
        ngayThanhLy=None,
    )
    _, errors, _ = validation.validate_sync_item(
        "hop_dong", liquidated, allowed_contract_status_names={CONTRACT_STATUS_LABELS["LIQUIDATED"]}
    )
    assert errors == []

    valid = _minimal_contract()
    _, errors, _ = validation.validate_sync_item(
        "hop_dong", valid, allowed_contract_status_names={CONTRACT_STATUS_LABELS["ACTIVE"]}
    )
    assert errors == []


def test_contract_status_catalog_and_opening_discount_validation() -> None:
    _, errors, _ = validation.validate_sync_item(
        "danh_muc_trang_thai_hop_dong", {"name": "", "color": "red"}
    )
    assert len(errors) == 2
    _, errors, _ = validation.validate_sync_item(
        "danh_muc_trang_thai_hop_dong", {"name": "Complete", "color": "#00AA11"}
    )
    assert errors == []

    item = {"giaDuThau": "1000", "tyLeGiamGia": "10"}
    normalized, errors, _ = validation.validate_sync_item(
        "thong_tin_mo_thau", item
    )
    assert normalized["giaSauGiamGia"] == "900"
    assert errors == []
    item = {"giaDuThau": "1000", "tyLeGiamGia": "invalid"}
    _, errors, _ = validation.validate_sync_item("thong_tin_mo_thau", item)
    assert errors
    item = {"giaDuThau": "1000"}
    normalized, errors, _ = validation.validate_sync_item(
        "thong_tin_mo_thau", item
    )
    assert normalized["giaSauGiamGia"] == "1000"
    assert errors == []
