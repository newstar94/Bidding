from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.integrations.muasamcong_browser.canonical import (
    ImportParserRegistry,
    normalize_notice_complete_bundle,
    normalize_notice_revision,
    normalize_opening_bundle,
    normalize_plan_revision,
    normalize_result_bundle,
)
from backend.integrations.muasamcong_browser.code_mapping import (
    map_contract_type,
    map_domestic_scope,
    map_evaluation_method,
    map_online_mode,
    map_optional_boolean,
    map_package_field,
    map_selection_form,
    map_selection_mode,
)
from backend.integrations.muasamcong_browser.classifier import (
    UpstreamClassification,
    classify_upstream_error,
)
from backend.integrations.muasamcong_browser.procurement_source import (
    MuaSamCongProcurementSource,
)
from backend.integrations.muasamcong_browser.diagnostics import (
    DiagnosticRecorder,
    sanitized_shape,
)
from backend.procurement_import.draft_mapping import (
    map_package_canonical_to_draft,
)
from backend.procurement_import.source import ProcurementSourceError


FIXTURES = Path(__file__).parent / "fixtures" / "muasamcong"


def fixture(*parts):
    return json.loads((FIXTURES.joinpath(*parts)).read_text(encoding="utf-8"))


@pytest.mark.parametrize(
    ("method", "bid_field", "expected"),
    [
        ("1", "HH", "Giá thấp nhất"),
        ("1", "TV", "Giá thấp nhất"),
        ("2", "TV", "Giá cố định"),
        ("2", "HH", "Giá đánh giá"),
        ("2", "XL", "Giá đánh giá"),
        ("2", "PTV", "Giá đánh giá"),
        ("3", "TV", "Kết hợp giữa kỹ thuật và giá"),
        ("3", "HH", "Kết hợp giữa kỹ thuật và giá"),
        ("4", "TV", "Dựa trên kỹ thuật"),
        ("4", "HH", "Dựa trên kỹ thuật"),
        (None, "HH", None),
        ("5", "HH", None),
        ("2", None, None),
    ],
)
def test_evaluation_method_mapping_depends_on_method_and_raw_package_field(
    method, bid_field, expected
):
    assert map_evaluation_method(method, bid_field) == expected


def test_ib2600271825_evaluation_method_comes_from_ehsmt_form():
    revision = normalize_notice_revision(
        {
            "notifyNo": "IB2600271825",
            "notifyId": "notice-00",
            "bidName": "Goi thau so 35",
            "bidField": "HH",
            "evalMethod": None,
            "bidoInvBiddingDTO": [{
                "formCode": "BD.CG.02.0104",
                "formValue": json.dumps({"evalTechnical": "1"}),
            }, {
                "formCode": "BD.CG.02.0113",
                "formValue": json.dumps({"method": "1", "cost": None}),
            }],
        },
        notice_no="IB2600271825",
        revision_id="notice-00",
        revision_number="00",
    )

    assert revision["field"] == "Hàng hóa"
    assert revision["evaluationMethod"] == "Giá thấp nhất"


def test_complete_notice_uses_plan_package_lot_rows_when_goods_form_is_absent():
    bundle = {
        "schemaVersion": "biddingflow-muasamcong-raw-bundle-v2",
        "entity": {"kind": "NOTICE", "canonicalCode": "IB2600212155"},
        "revisions": {
            "00": {
                "revisionId": "notice-00",
                "sources": {
                    "noticeDetail": {
                        "success": True,
                        "operation": "NOTICE_LDT_DETAIL",
                        "response": {
                            "notifyNo": "IB2600212155",
                            "notifyId": "notice-00",
                            "planNo": "PL2600122143",
                            "bidNo": "BP2600291019",
                            "bidName": "Goi thuoc",
                            "isMultiLot": 1,
                        },
                    },
                    "planDetail": {
                        "success": True,
                        "operation": "PLAN_DETAIL",
                        "response": {
                            "planNo": "PL2600122143",
                            "bidpPlanDetailToProjectList": [{
                                "id": "detail-1",
                                "bidNo": "BP2600291019",
                                "bidName": "Goi thuoc",
                            }],
                        },
                    },
                    "planPackageDetail": {
                        "success": True,
                        "operation": "PLAN_PACKAGE_DETAIL",
                        "response": {
                            "bidpBidLotList": [{
                                "id": "item-1",
                                "lotNo": "PP2600198304",
                                "lotName": "Atropin sulfat",
                                "medicineCode": "GE01",
                                "tenThuoc": "Atropin sulfat",
                                "uom": "Unit",
                                "quantity": 200,
                            }],
                        },
                    },
                },
            },
        },
    }

    canonical = normalize_notice_complete_bundle(bundle)

    assert canonical["revisions"][0]["goodsItems"] == [{
        "sourceItemId": "item-1",
        "sourceIndex": "1",
        "lotNo": "PP2600198304",
        "lotName": "Atropin sulfat",
        "code": "GE01",
        "name": "Atropin sulfat",
        "unit": "Unit",
        "quantity": 200,
        "technicalRequirement": None,
        "referenceCode": None,
        "requiredOrigin": None,
        "deliveryLocation": None,
        "deliveryTime": None,
        "note": None,
    }]


def test_evaluation_method_form_returns_none_for_invalid_json():
    revision = normalize_notice_revision(
        {
            "notifyNo": "IB2600000099",
            "notifyId": "notice-00",
            "bidName": "Invalid evaluation form",
            "bidField": "HH",
            "bidoInvBiddingDTO": [{
                "formCode": "BD.CG.02.0113",
                "formValue": "{invalid-json",
            }],
        },
        notice_no="IB2600000099",
        revision_id="notice-00",
        revision_number="00",
    )

    assert revision["evaluationMethod"] is None


def test_ib2600079201_consulting_method_three_uses_ehsmt_form():
    revision = normalize_notice_revision(
        {
            "notifyNo": "IB2600079201",
            "notifyId": "notice-00",
            "bidName": "Consulting package",
            "bidField": "TV",
            "bidoInvBiddingDTO": [{
                "formCode": "BD.CG.02.0113",
                "formValue": json.dumps({"method": "3", "cost": None}),
            }],
        },
        notice_no="IB2600079201",
        revision_id="notice-00",
        revision_number="00",
    )

    assert revision["field"] == "Tư vấn"
    assert revision["evaluationMethod"] == "Kết hợp giữa kỹ thuật và giá"


def test_method_two_uses_nested_plan_detail_field_when_notice_field_is_missing():
    revision = normalize_notice_revision(
        {
            "notice": {
                "notifyNo": "IB2600000098",
                "notifyId": "notice-00",
                "bidName": "Consulting package",
            },
            "bidpPlanDetailDTO": {"bidField": "TV"},
            "forms": [{
                "formCode": "BD.CG.02.0113",
                "formValue": json.dumps({"method": "2", "cost": None}),
            }],
        },
        notice_no="IB2600000098",
        revision_id="notice-00",
        revision_number="00",
    )

    assert revision["field"] == "Tư vấn"
    assert revision["evaluationMethod"] == "Giá cố định"


def test_method_two_uses_top_level_source_field_when_notice_field_is_missing():
    revision = normalize_notice_revision(
        {
            "bidField": "HH",
            "notice": {
                "notifyNo": "IB2600000097",
                "notifyId": "notice-00",
                "bidName": "Goods package",
            },
            "forms": [{
                "formCode": "BD.CG.02.0113",
                "formValue": json.dumps({"method": "2", "cost": None}),
            }],
        },
        notice_no="IB2600000097",
        revision_id="notice-00",
        revision_number="00",
    )

    assert revision["field"] == "Hàng hóa"
    assert revision["evaluationMethod"] == "Giá đánh giá"


def test_non_lot_notice_normalization_drops_single_package_summary_lot():
    revision = normalize_notice_revision(
        {
            "notifyNo": "IB2600082707",
            "notifyId": "notice-00",
            "bidNo": "BP2600113130",
            "bidName": "Mua may giat cong nghiep va may phan tich huyet hoc",
            "isMultiLot": 0,
            "bidpBidLotList": [{
                "lotNo": "BP2600113130",
                "lotName": (
                    "Mua may giat cong nghiep va may phan tich huyet hoc"
                ),
                "lotPrice": 898_000_000,
            }],
        },
        notice_no="IB2600082707",
        revision_id="notice-00",
        revision_number="00",
    )

    assert revision["isMultiLot"] is False
    assert revision["lots"] == []


def test_goods_form_1281_maps_parent_linked_items_to_their_source_lots():
    revision = normalize_notice_revision(
        {
            "notifyNo": "IB2600291864",
            "notifyId": "notice-00",
            "bidName": "Goods package with multiple lots",
            "bidField": "HH",
            "isMultiLot": 1,
            "bidpBidLotList": [{
                "lotNo": "PP2600239575",
                "lotName": "Lot one",
            }, {
                "lotNo": "PP2600239576",
                "lotName": "Lot two",
            }],
            "bidoInvBiddingDTO": [{
                "formCode": "BD.MT.02.1281",
                "formValue": json.dumps({"Table": [{
                    "id": "source-lot-1",
                    "lotNo": "PP2600239575",
                    "lotName": "Lot one",
                    "name": None,
                    "uom": None,
                    "qty": None,
                }, {
                    "id": "source-lot-2",
                    "lotNo": "PP2600239576",
                    "lotName": "Lot two",
                    "name": None,
                    "uom": None,
                    "qty": None,
                }, {
                    "id": "source-goods-1",
                    "parent": "source-lot-1",
                    "tempParent": "source-lot-1",
                    "currentItemIndex": "1.1",
                    "name": "Digital x-ray film",
                    "uom": "Sheet",
                    "qty": 20_000,
                    "description": "According to Chapter V",
                }, {
                    "id": "source-goods-2",
                    "parent": "source-lot-2",
                    "tempParent": "source-lot-2",
                    "currentItemIndex": "2.1",
                    "name": "Test chemical",
                    "uom": "Box",
                    "qty": 12,
                }, {
                    "id": "source-goods-3",
                    "parent": "source-lot-1",
                    "tempParent": "source-lot-1",
                    "currentItemIndex": "1.2",
                    "name": "Medical film printer cartridge",
                    "uom": "Cartridge",
                    "qty": 4,
                }]}, ensure_ascii=False),
            }],
        },
        notice_no="IB2600291864",
        revision_id="notice-00",
        revision_number="00",
    )

    assert [(item["code"], item["lotNo"]) for item in revision["goodsItems"]] == [
        ("1.1", "PP2600239575"),
        ("2.1", "PP2600239576"),
        ("1.2", "PP2600239575"),
    ]
    assert revision["goodsItems"][0]["technicalRequirement"] == (
        "According to Chapter V"
    )
    draft = map_package_canonical_to_draft(
        "MUASAMCONG", "IB2600291864", revision, revision
    )
    assert draft["phanLo"] is True
    assert [item["maPhanLo"] for item in draft["danhSachHangHoa"]] == [
        "PP2600239575",
        "PP2600239576",
        "PP2600239575",
    ]


def test_goods_form_1281_keeps_non_lot_items_at_package_scope():
    revision = normalize_notice_revision(
        {
            "notifyNo": "IB2600320117",
            "notifyId": "notice-00",
            "bidName": "Goods package without lots",
            "bidField": "HH",
            "isMultiLot": 0,
            "bidoInvBiddingDTO": [{
                "formCode": "BD.MT.02.1281",
                "formValue": json.dumps({"Table": [{
                    "id": "source-goods-1",
                    "pos": "1",
                    "lotNo": "BP2600320117",
                    "lotName": "Goods package without lots",
                    "name": "Industrial washing machine",
                    "uom": "Unit",
                    "qty": 1,
                }]}, ensure_ascii=False),
            }],
        },
        notice_no="IB2600320117",
        revision_id="notice-00",
        revision_number="00",
    )

    assert revision["isMultiLot"] is False
    assert revision["lots"] == []
    assert [(item["code"], item["lotNo"]) for item in revision["goodsItems"]] == [
        ("1", None),
    ]
    draft = map_package_canonical_to_draft(
        "MUASAMCONG", "IB2600320117", revision, revision
    )
    assert draft["phanLo"] is False
    assert draft["danhSachPhanLo"] == []
    assert draft["danhSachHangHoa"][0]["maPhanLo"] == ""


def test_goods_form_1281_maps_one_item_per_lot_using_pos_index():
    revision = normalize_notice_revision(
        {
            "notifyNo": "IB2600271822",
            "notifyId": "notice-00",
            "bidName": "One goods item per lot",
            "bidField": "HH",
            "isMultiLot": 1,
            "bidpBidLotList": [{
                "lotNo": "PP2600210001",
                "lotName": "Lot one",
            }, {
                "lotNo": "PP2600210002",
                "lotName": "Lot two",
            }],
            "bidoInvBiddingDTO": [{
                "formCode": "BD.MT.02.1281",
                "formValue": json.dumps({"Table": [{
                    "id": 2600210001,
                    "pos": "1",
                    "lotNo": "PP2600210001",
                    "lotName": "Lot one",
                    "name": "Medical supply one",
                    "uom": "Box",
                    "qty": 10,
                    "parent": 0,
                }, {
                    "id": 2600210002,
                    "pos": "2",
                    "lotNo": "PP2600210002",
                    "lotName": "Lot two",
                    "name": "Medical supply two",
                    "uom": "Bottle",
                    "qty": 5,
                    "parent": 0,
                }]}, ensure_ascii=False),
            }],
        },
        notice_no="IB2600271822",
        revision_id="notice-00",
        revision_number="00",
    )

    assert [(item["code"], item["lotNo"]) for item in revision["goodsItems"]] == [
        ("1", "PP2600210001"),
        ("2", "PP2600210002"),
    ]


def test_ib2600082707_goods_form_0812_maps_non_lot_group_children():
    revision = normalize_notice_revision(
        {
            "notifyNo": "IB2600082707",
            "notifyId": "notice-00",
            "bidName": "Industrial washing machine and blood analyzer",
            "bidField": "HH",
            "isMultiLot": 0,
            "bidoInvBiddingDTO": [{
                "formCode": "BD.MT.02.0812",
                "formValue": json.dumps({"Table": [{
                    "id": 81001,
                    "parent": 81000,
                    "currentItemIndex": "1",
                    "pos": "1",
                    "name": "Industrial washing machine",
                    "uom": "Unit",
                    "qty": 1,
                    "description": "Technical requirements one",
                    "place": "Delivery location one",
                    "fromDate": "2026-08-01",
                    "toDate": "2026-09-01",
                }, {
                    "id": 81002,
                    "parent": 81000,
                    "currentItemIndex": "2",
                    "pos": "2",
                    "name": "Blood analyzer",
                    "uom": "Unit",
                    "qty": 1,
                    "description": "Technical requirements two",
                }]}, ensure_ascii=False),
            }],
        },
        notice_no="IB2600082707",
        revision_id="notice-00",
        revision_number="00",
    )

    assert [(item["code"], item["lotNo"]) for item in revision["goodsItems"]] == [
        ("1", None),
        ("2", None),
    ]
    assert revision["goodsItems"][0]["technicalRequirement"] == (
        "Technical requirements one"
    )
    draft = map_package_canonical_to_draft(
        "MUASAMCONG", "IB2600082707", revision, revision
    )
    assert draft["phanLo"] is False
    assert len(draft["danhSachHangHoa"]) == 2
    assert all(not item["maPhanLo"] for item in draft["danhSachHangHoa"])


def test_plan_fixture_maps_packages_without_conflating_plan_symbol_and_tbmt():
    raw = fixture("plan", "plan_revision_v1.json")
    assert classify_upstream_error() is UpstreamClassification.FOUND_SUPPORTED
    revision = ImportParserRegistry().parse(
        "plan:v1:fixture",
        raw,
        family_no="PL2600000001",
        revision_id="sanitized-plan-01",
        revision_number="01",
    )

    assert revision["revisionNumber"] == "01"
    assert revision["totalAmountVnd"] == 300_000_000
    assert [row["symbol"] for row in revision["packages"]] == ["A", "B"]
    assert revision["packages"][0]["noticeLink"]["state"] == "UNLINKED"
    assert revision["packages"][1]["noticeLink"] == {
        "state": "LINKED",
        "noticeNo": "IB2600000002",
        "kind": "TBMT",
        "noticeRevisionId": "notice-01",
        "noticeVersion": "01",
    }
    assert revision["packages"][1]["symbol"] != (
        revision["packages"][1]["noticeLink"]["noticeNo"]
    )


def test_plan_canonical_revision_keeps_total_investment_provenance():
    raw = fixture("plan", "plan_revision_v1.json")
    revision = normalize_plan_revision(
        raw,
        family_no="PL2600000001",
        revision_id="plan-01",
        revision_number="01",
    )

    assert revision["totalAmountVnd"] == 300_000_000


def test_plan_package_normalizes_bid_validity_and_additional_purchase_items():
    raw = fixture("plan", "plan_revision_v1.json")
    package = raw["bidpPlanDetailToProjectList"][0]
    package.update({
        "additionalChoise": 1,
        "bidValidity": 90,
        "formValue": json.dumps([
            {
                "id": "option-1",
                "category": "Phim X-Quang kỹ thuật số",
                "unit": "tấm",
                "qty": 6000,
                "percentage": 0.3,
                "estimateValue": 123_360_000,
            },
        ], ensure_ascii=False),
    })

    revision = normalize_plan_revision(
        raw,
        family_no="PL2600000001",
        revision_id="plan-01",
        revision_number="01",
    )
    canonical_package = revision["packages"][0]
    draft = map_package_canonical_to_draft(
        "MUASAMCONG", "PL2600000001", revision, canonical_package,
    )

    assert canonical_package["bidValidityDays"] == 90
    assert canonical_package["additionalPurchaseItems"] == [{
        "sourceItemId": "option-1",
        "name": "Phim X-Quang kỹ thuật số",
        "unit": "tấm",
        "quantity": 6000,
        "percentage": 0.3,
        "estimateValueVnd": 123_360_000,
    }]
    assert draft["hieuLucHsdt"] == 90
    assert draft["tuyChonMuaThemList"] == [{
        "sourceItemId": "option-1",
        "hangMuc": "Phim X-Quang kỹ thuật số",
        "donVi": "tấm",
        "soLuong": 6000,
        "tyLe": 0.3,
        "giaTriUocTinh": 123_360_000,
    }]


def test_plan_creator_is_the_investor_code_without_revision_suffix():
    raw = fixture("plan", "plan_revision_v1.json")
    revision = normalize_plan_revision(
        raw,
        family_no="PL2600000001",
        revision_id="plan-01",
        revision_number="01",
    )

    assert revision["investorCode"] == "INV-CREATOR"


@pytest.mark.parametrize(
    ("source_plan_type", "bidding_plan_type"),
    (
        ("DTPT", "Dự án"),
        ("DTMS", "Dự án"),
        ("TX", "Dự toán mua sắm"),
        ("KHAC", "Dự toán mua sắm"),
    ),
)
def test_plan_canonical_revision_maps_source_classification_to_bidding_type(
    source_plan_type,
    bidding_plan_type,
):
    raw = fixture("plan", "plan_revision_v1.json")
    raw["bidPoBidpPlanProjectDetailView"]["planType"] = source_plan_type

    revision = normalize_plan_revision(
        raw,
        family_no="PL2600000001",
        revision_id="plan-01",
        revision_number="01",
    )

    assert revision["sourcePlanType"] == source_plan_type
    assert revision["planType"] == bidding_plan_type


def test_notice_fixture_maps_revision_and_package_relationship():
    raw = fixture("notice", "ldt", "notice_revision_v1.json")
    assert classify_upstream_error() is UpstreamClassification.FOUND_SUPPORTED
    revision = ImportParserRegistry().parse(
        "package-notice:v1:fixture",
        raw,
        notice_no="IB2600000002",
        revision_id="notice-01",
        revision_number="01",
    )

    assert revision["planNo"] == "PL2600000001"
    assert revision["stablePackageId"] == "B"
    assert revision["selectionMode"] == "Một giai đoạn hai túi hồ sơ"
    assert revision["selectionForm"] == "Đấu thầu rộng rãi"
    assert revision["field"] == "Hàng hóa"
    assert revision["contractType"] == "Trọn gói"
    assert revision["bidGuaranteeVnd"] == 28_000_000
    assert revision["bidOpeningAt"] == "2026-03-01T09:15:00"


def test_notice_price_prefers_package_estimate_and_falls_back_to_bid_price():
    raw = fixture("notice", "ldt", "notice_revision_v1.json")
    raw["bidoNotifyContractorM"].update({
        "bidPrice": 100_000_000,
        "bidEstimatePrice": 120_000_000,
    })

    with_estimate = ImportParserRegistry().parse(
        "package-notice:v1:fixture",
        raw,
        notice_no="IB2600000002",
        revision_id="notice-01",
        revision_number="01",
    )
    del raw["bidoNotifyContractorM"]["bidEstimatePrice"]
    without_estimate = ImportParserRegistry().parse(
        "package-notice:v1:fixture",
        raw,
        notice_no="IB2600000002",
        revision_id="notice-01",
        revision_number="01",
    )

    assert with_estimate["priceVnd"] == 120_000_000
    assert with_estimate["sourceBidPriceVnd"] == 100_000_000
    assert with_estimate["estimatePriceVnd"] == 120_000_000
    assert without_estimate["priceVnd"] == 100_000_000
    assert without_estimate["sourceBidPriceVnd"] == 100_000_000
    assert without_estimate["estimatePriceVnd"] is None


def test_notice_normalizes_single_value_search_arrays():
    raw = {
        "notifyNo": "IB2600433562",
        "notifyId": "notice-00",
        "notifyVersion": "00",
        "planNo": "PL2600248518",
        "bidName": ["Gói chào hàng cạnh tranh"],
        "investField": ["PTV"],
        "bidPrice": [4_484_923_803],
        "bidForm": "CHCT",
        "bidMode": "1_MTHS",
        "processApply": "KHAC",
    }

    revision = ImportParserRegistry().parse(
        "package-notice:v1:search-fallback",
        raw,
        notice_no="IB2600433562",
        revision_id="notice-00",
        revision_number="00",
    )

    assert revision["name"] == "Gói chào hàng cạnh tranh"
    assert revision["field"] == "Phi tư vấn"
    assert revision["priceVnd"] == 4_484_923_803


def test_package_lookup_maps_complete_notice_fields_into_preview():
    source = MuaSamCongProcurementSource(FakeRuntime())

    result = source.lookup("IB2600000002", "PACKAGE")

    assert result["data"] == {
        "notifyNo": "IB2600000002",
        "notifyId": "notice-01",
        "planNo": "PL2600000001",
        "bidName": "Gói B",
        "bidPrice": 1_400_000_000,
        "bidGuarantee": 28_000_000,
        "implementationPeriod": "30 ngày",
        "capitalDetail": "Ngân sách nhà nước",
        "bidField": "Hàng hóa",
        "bidForm": "Đấu thầu rộng rãi",
        "bidMode": "Một giai đoạn hai túi hồ sơ",
        "processApply": "LDT",
        "contractType": "Trọn gói",
        "bidCloseDate": "2026-03-01T09:00:00",
        "bidOpenDate": "2026-03-01T09:15:00",
        "bidOpenId": "opening-01",
        "inputResultId": None,
    }


@pytest.mark.parametrize(
    ("mapper", "source", "expected"),
    [
        (map_package_field, "HH", "Hàng hóa"),
        (map_package_field, "XL", "Xây lắp"),
        (map_package_field, "TV", "Tư vấn"),
        (map_package_field, "PTV", "Phi tư vấn"),
        (map_package_field, "HON_HOP", "Hỗn hợp"),
        (map_selection_form, "DTRR", "Đấu thầu rộng rãi"),
        (map_selection_form, "DTHC", "Đấu thầu hạn chế"),
        (map_selection_form, "CDT", "Chỉ định thầu"),
        (map_selection_form, "CDTRG", "Chỉ định thầu rút gọn"),
        (map_selection_form, "CHCT", "Chào hàng cạnh tranh"),
        (map_selection_form, "LCNT_DB", "Lựa chọn nhà thầu trong trường hợp đặc biệt"),
        (map_selection_mode, "1_MTHS", "Một giai đoạn một túi hồ sơ"),
        (map_selection_mode, "1_HTHS", "Một giai đoạn hai túi hồ sơ"),
        (map_selection_mode, "2_MTHS", "Hai giai đoạn một túi hồ sơ"),
        (map_selection_mode, "2_HTHS", "Hai giai đoạn hai túi hồ sơ"),
        (map_selection_mode, "NONE", "Không có"),
        (map_contract_type, "TG", "Trọn gói"),
        (map_contract_type, "TRON_GOI", "Trọn gói"),
        (map_contract_type, "DGCD", "Theo đơn giá cố định"),
        (map_contract_type, "DON_GIA_CO_DINH", "Theo đơn giá cố định"),
        (map_contract_type, "DGDC", "Theo đơn giá điều chỉnh"),
        (map_contract_type, "DON_GIA_DIEU_CHINH", "Theo đơn giá điều chỉnh"),
        (map_contract_type, "TTG", "Theo thời gian"),
        (map_contract_type, "THEO_THOI_GIAN", "Theo thời gian"),
        (map_contract_type, "HON_HOP", "Hỗn hợp"),
        (map_online_mode, 1, "Qua mạng"),
        (map_online_mode, 0, "Không qua mạng"),
        (map_domestic_scope, 1, "Trong nước"),
        (map_domestic_scope, 0, "Quốc tế"),
    ],
)
def test_muasamcong_codes_map_to_bidding_domain_values(mapper, source, expected):
    assert mapper(source) == expected


def test_mapping_accepts_bidding_labels_and_preserves_unknown_open_code():
    assert map_package_field("hàng hóa") == "Hàng hóa"
    assert map_selection_form("Đấu thầu rộng rãi") == "Đấu thầu rộng rãi"
    assert map_selection_mode("Một giai đoạn một túi hồ sơ") == (
        "Một giai đoạn một túi hồ sơ"
    )
    assert map_contract_type("Trọn gói") == "Trọn gói"
    assert map_selection_form("FUTURE_FORM_2027") == "FUTURE_FORM_2027"
    assert map_online_mode("FUTURE_FLAG") is None
    assert map_optional_boolean(1) is True
    assert map_optional_boolean(0) is False
    assert map_optional_boolean("FUTURE_FLAG") is None


def test_plan_and_notice_use_the_same_business_code_mapping():
    plan_raw = fixture("plan", "plan_revision_v1.json")
    plan_raw["bidpPlanDetailToProjectList"][0].update({
        "bidField": "HH",
        "bidForm": "DTRR",
        "bidMode": "1_MTHS",
    })
    plan = normalize_plan_revision(
        plan_raw,
        family_no="PL2600000001",
        revision_id="plan-01",
        revision_number="01",
    )
    notice_raw = fixture("notice", "ldt", "notice_revision_v1.json")
    notice_raw["bidoNotifyContractorM"].update({
        "isInternet": 1,
        "isDomestic": 1,
    })
    notice = ImportParserRegistry().parse(
        "package-notice:v1:fixture",
        notice_raw,
        notice_no="IB2600000002",
        revision_id="notice-01",
        revision_number="01",
    )

    assert plan["packages"][0]["field"] == notice["field"] == "Hàng hóa"
    assert plan["packages"][0]["selectionForm"] == notice["selectionForm"]
    assert plan["packages"][0]["selectionMode"] == (
        "Một giai đoạn một túi hồ sơ"
    )
    assert notice["onlineMode"] == "Qua mạng"
    assert notice["domesticOrInternational"] == "Trong nước"


def test_opening_fixtures_cover_normal_lots_and_two_envelope_phases():
    registry = ImportParserRegistry()
    assert classify_upstream_error() is UpstreamClassification.FOUND_SUPPORTED
    normal = registry.parse(
        "opening:v1:normal-fixture",
        fixture("opening", "normal", "opening_v1.json"),
        notice_no="IB2600000002",
        revision_id="notice-01",
    )
    lots = registry.parse(
        "opening:v1:lots-fixture",
        fixture("opening", "lots", "opening_lots_v1.json"),
        notice_no="IB2600000002",
        revision_id="notice-01",
    )
    two_envelope = registry.parse(
        "opening:v1:1g2t-fixture",
        fixture("opening", "1g2t", "opening_1g2t_v1.json"),
        notice_no="IB2600000002",
        revision_id="notice-01",
    )

    assert len(normal["bidders"]) == 2
    normal_by_code = {
        row["contractorCode"]: row for row in normal["bidders"]
    }
    assert normal_by_code["0100000001"]["bidPrice"] == 95_000_000
    assert normal_by_code["0100000001"]["priceAfterDiscount"] == 90_250_000
    assert normal_by_code["0100000001"]["bidGuarantee"] == 1_000_000
    assert normal_by_code["0100000001"]["bidGuaranteeValidityDays"] == 120
    assert normal_by_code["0100000005"]["bidPrice"] == 0
    assert [row["lotNo"] for row in lots["lots"]] == ["01", "02"]
    assert lots["bidders"][0]["lotNo"] == "01"
    assert {row["phase"] for row in two_envelope["bidders"]} == {
        "TECHNICAL",
        "FINANCIAL",
    }
    technical = next(
        row for row in two_envelope["bidders"] if row["phase"] == "TECHNICAL"
    )
    assert len(technical["jointVentureMembers"]) == 2


def test_opening_uses_completion_time_and_detects_venture_from_real_shape():
    opening = normalize_opening_bundle(
        {
            # The notification payload is commonly returned before the round
            # payload and contains only the scheduled opening time.
            "opening_notify_0": {
                "bidNoContractorResponse": {
                    "bidNotification": {
                        "bidOpenDate": "2026-03-19T08:00:00",
                    },
                },
            },
            "opening_round_0": {
                "bidoBidroundMngViewDTO": {
                    "bidOpenDate": "2026-03-19T08:00:00",
                    "successBidOpenDate": "2026-03-19T08:23:35",
                },
            },
            "opening_bid_0": {
                "bidSubmissionByContractorViewResponse": {
                    "bidSubmissionDTOList": [{
                        "contractorCode": "vn0107713765",
                        "contractorName": "CÔNG TY TNHH THIẾT BỊ Y TẾ BÌNH MAI",
                        "ventureCode": "PC2600005356",
                        "ventureName": "Liên danh nhà thầu Bình Mai - SMC.",
                        "createdDateBidOpen": "2026-03-19T08:23:33.893",
                    }, {
                        "contractorCode": "vn0107434539",
                        "contractorName": "CÔNG TY TNHH THIẾT BỊ Y TẾ PHAN NGUYỄN",
                        "ventureCode": None,
                        "ventureName": None,
                        "createdDateBidOpen": "2026-03-19T08:23:34.509",
                    }],
                },
            },
        },
        notice_no="IB2600082707",
        revision_id="notice-00",
    )

    assert opening["openingAt"] == "2026-03-19T08:23:35"
    assert opening["completedOpeningAt"] == "2026-03-19T08:23:35"
    assert opening["scheduledOpeningAt"] == "2026-03-19T08:00:00"
    bidders = {row["contractorCode"]: row for row in opening["bidders"]}
    assert bidders["vn0107713765"]["contractorType"] == "JOINT_VENTURE"
    assert bidders["vn0107713765"]["jointVentureCode"] == "PC2600005356"
    assert bidders["vn0107713765"]["jointVentureName"] == (
        "Liên danh nhà thầu Bình Mai - SMC."
    )
    assert bidders["vn0107434539"]["contractorType"] == "INDEPENDENT"


def test_opening_merges_late_venture_evidence_for_the_same_representative():
    opening = normalize_opening_bundle(
        {
            "opening_submission_0": [{
                "contractorCode": "vn-pt",
                "contractorName": "Công ty TNHH dịch vụ thương mại P&T",
            }],
            "opening_bid_0": [{
                "contractorCode": "vn-pt",
                "contractorName": "Công ty TNHH dịch vụ thương mại P&T",
                "ventureCode": "PC2600320117",
                "ventureName": "Liên danh P&T - KN",
            }],
        },
        notice_no="IB2600320117",
        revision_id="notice-00",
    )

    assert len(opening["bidders"]) == 1
    bidder = opening["bidders"][0]
    assert bidder["contractorType"] == "JOINT_VENTURE"
    assert bidder["jointVentureCode"] == "PC2600320117"
    assert bidder["jointVentureName"] == "Liên danh P&T - KN"


def test_opening_excludes_package_bid_number_from_lots_and_lot_scopes():
    opening = normalize_opening_bundle(
        {
            "opening_lot_0": [{
                "bidNo": "BP2600291019",
                "lotNo": "BP2600291019",
                "lotName": "Số hiệu gói thầu",
                "contractorCode": "vn0100000001",
                "contractorName": "Nhà thầu A",
                "bidOpenView": [
                    {
                        "lotNo": "PP2600198304",
                        "lotName": "Atropin sulfat",
                        "lotPrice": 1_014_000,
                    },
                    {
                        "lotNo": "PP2600198307",
                        "lotName": "Propofol",
                        "lotPrice": 2_100_000,
                    },
                ],
            }],
        },
        notice_no="IB2600212155",
        revision_id="notice-01",
    )

    assert [lot["lotNo"] for lot in opening["lots"]] == [
        "PP2600198304",
        "PP2600198307",
    ]
    assert opening["bidders"][0]["lotNo"] is None


def test_ib2600212155_opening_keeps_only_lot_bids_and_attaches_lot_names():
    contractors = [{
        "contractorCode": f"vn010000000{index}",
        "contractorName": f"Nhà thầu {index}",
        "bidPrice": index * 1_000_000,
    } for index in range(1, 9)]
    lot_rows = [{
        "lotNo": f"PP26001983{index:02d}",
        "lotName": f"Thuốc {index}",
        "bidOpenView": [{
            **contractors[(index - 1) % len(contractors)],
            "lotNo": f"PP26001983{index:02d}",
        }],
    } for index in range(1, 13)]

    opening = normalize_opening_bundle(
        {
            "opening_bid_0": {
                "bidSubmissionDTOList": contractors,
            },
            "opening_lot_0": {
                "lotNoValueDTOList": lot_rows,
            },
        },
        notice_no="IB2600212155",
        revision_id="notice-01",
    )

    assert len(opening["lots"]) == 12
    assert len(opening["bidders"]) == 12
    assert all(row["lotNo"] for row in opening["bidders"])
    assert opening["bidders"][0]["lotName"] == "Thuốc 1"


def test_lot_opening_bid_guarantee_comes_from_bid_open_not_lot_open_detail():
    lot_detail = [{
        "contractorCode": "vn0100000001",
        "contractorName": "Nhà thầu A",
        "lotNo": "PP01",
        "lotName": "Lô 1",
        "lotFinalPrice": 900_000_000,
        "bidGuarantee": None,
    }]
    bid_open = {
        "bidSubmissionDTOList": [{
            "contractorCode": "vn0100000001",
            "contractorName": "Nhà thầu A",
            "bidGuarantee": 12_000_000,
            "bidGuaranteeValidity": 120,
        }],
    }

    for raw in (
        # These upstream calls run concurrently; either response can arrive first.
        {"opening_lot_detail_0": lot_detail, "opening_bid_0": bid_open},
        {"opening_bid_0": bid_open, "opening_lot_detail_0": lot_detail},
    ):
        opening = normalize_opening_bundle(
            raw,
            notice_no="IB2600212155",
            revision_id="notice-01",
        )

        assert len(opening["bidders"]) == 1
        assert opening["bidders"][0]["lotNo"] == "PP01"
        assert opening["bidders"][0]["bidGuarantee"] == 12_000_000
        assert opening["bidders"][0]["bidGuaranteeValidityDays"] == 120


def test_opening_parser_preserves_zero_and_missing_optional_prices():
    opening = normalize_opening_bundle(
        {
            "opening_bid_1": {
                "bidOpenView": [
                    {"contractorCode": "0100000001", "contractorName": "A"},
                    {
                        "contractorCode": "0100000002",
                        "contractorName": "B",
                        "bidPrice": 0,
                    },
                ]
            }
        },
        notice_no="IB2600000002",
        revision_id="notice-01",
    )

    assert [row["bidPrice"] for row in opening["bidders"]] == [None, 0]


def test_result_fixture_flows_through_fingerprint_registry_to_canonical_dto():
    raw = fixture("results", "result_v1.json")
    registry = ImportParserRegistry()

    assert classify_upstream_error() is UpstreamClassification.FOUND_SUPPORTED
    assert registry.resolve("result:v1:fixture") is normalize_result_bundle
    result = registry.parse(
        "result:v1:fixture",
        raw,
        notice_no="IB2600000002",
        revision_id="notice-01",
    )

    assert result == {
        "noticeNo": "IB2600000002",
        "revisionId": "notice-01",
        "status": "APPROVED",
        "approvalDecisionNo": "123/QD-CDT",
        "approvalDecisionDate": "2026-04-15",
        "contractors": [
            {
                "contractorCode": "0100000002",
                "contractorName": "Cong ty Xep hang hai",
                "lotNo": "01",
                "phase": "SELECTION",
                "rank": 2,
                "isWinner": False,
                "technicalStatus": None,
                "bidPrice": 97_000_000,
                "evaluatedPrice": 96_000_000,
            },
            {
                "contractorCode": "0100000001",
                "contractorName": "Cong ty Trung thau",
                "lotNo": "01",
                "phase": "SELECTION",
                "rank": 1,
                "isWinner": True,
                "technicalStatus": None,
                "bidPrice": 95_000_000,
                "evaluatedPrice": 92_500_000,
            },
            {
                "contractorCode": "0100000002",
                "contractorName": "Cong ty Xep hang hai",
                "lotNo": "01",
                "phase": "TECHNICAL",
                "rank": None,
                "isWinner": None,
                "technicalStatus": "PASS",
                "bidPrice": None,
                "evaluatedPrice": None,
            },
            {
                "contractorCode": "0100000001",
                "contractorName": "Cong ty Trung thau",
                "lotNo": "01",
                "phase": "TECHNICAL",
                "rank": None,
                "isWinner": None,
                "technicalStatus": "PASS",
                "bidPrice": None,
                "evaluatedPrice": None,
            },
        ],
        "hasSelectionResult": True,
        "hasTechnicalResult": True,
    }


def test_parser_registry_fails_loudly_for_unknown_schema():
    registry = ImportParserRegistry()

    assert registry.resolve("plan:v1:abc") is normalize_plan_revision
    with pytest.raises(ProcurementSourceError, match="PROCUREMENT_SCHEMA_CHANGED"):
        registry.resolve("plan:v2:unknown")


def test_upstream_error_taxonomy_distinguishes_every_required_classification():
    assert classify_upstream_error() is UpstreamClassification.FOUND_SUPPORTED
    assert classify_upstream_error(
        "PROCUREMENT_SCHEMA_CHANGED"
    ) is UpstreamClassification.FOUND_SCHEMA_CHANGED
    assert classify_upstream_error(
        "PROCUREMENT_NOT_FOUND"
    ) is UpstreamClassification.NOT_FOUND
    assert classify_upstream_error(
        "PROCUREMENT_SESSION_FAILED"
    ) is UpstreamClassification.SESSION_FAILED
    assert classify_upstream_error(
        "PROCUREMENT_ENDPOINT_CHANGED"
    ) is UpstreamClassification.ENDPOINT_CHANGED
    assert classify_upstream_error(
        "PROCUREMENT_UPSTREAM_UNAVAILABLE"
    ) is UpstreamClassification.UPSTREAM_CHANGED
    assert classify_upstream_error(
        partial=True
    ) is UpstreamClassification.PARTIAL_DATA


def test_shadow_parser_reports_diff_without_replacing_active_result():
    registry = ImportParserRegistry(shadow_enabled=True)
    events = []

    def shadow(raw, **kwargs):
        canonical = normalize_plan_revision(raw, **kwargs)
        return {**canonical, "name": "Untrusted shadow value"}

    registry.register_shadow(
        "plan", "v1", shadow, parser_version="2026.09-candidate"
    )
    canonical = registry.parse(
        "plan:v1:fixture",
        fixture("plan", "plan_revision_v1.json"),
        family_no="PL2600000001",
        revision_id="sanitized-plan-01",
        revision_number="01",
        shadow_observer=events.append,
    )

    assert canonical["name"] != "Untrusted shadow value"
    assert events == [{
        "status": "DIFF",
        "fingerprint": "plan:v1:fixture",
        "activeParserVersion": "2026.08.2",
        "shadowParserVersion": "2026.09-candidate",
    }]


def test_diagnostic_shape_removes_token_cookie_and_values(tmp_path):
    raw = {
        "token": "top-secret-token",
        "Cookie": "top-secret-cookie",
        "authorization": "Bearer secret",
        "payload": {"notifyNo": "IB2600000002", "bidPrice": 100},
    }
    shape = sanitized_shape(raw)

    assert shape["token"] == "<redacted>"
    assert shape["Cookie"] == "<redacted>"
    assert shape["authorization"] == "<redacted>"
    assert shape["payload"] == {"notifyNo": "string", "bidPrice": "number"}

    recorder = DiagnosticRecorder(tmp_path, enabled=True)
    path = recorder.record(
        kind="PACKAGE",
        code="IB2600000002",
        operation="NOTICE_DETAIL",
        fingerprint="package-notice:v2:unknown",
        strategy="protected-api",
        error_code="PROCUREMENT_SCHEMA_CHANGED",
        raw=raw,
    )
    persisted = path.read_text(encoding="utf-8")
    assert "top-secret" not in persisted
    assert "PROCUREMENT_SCHEMA_CHANGED" in persisted


class FakeRuntime:
    def list_plan_revisions(self, plan_no):
        return {
            "revisions": [
                {"revisionId": "sanitized-plan-01", "revisionNumber": "01"},
                {"revisionId": "sanitized-plan-00", "revisionNumber": "00"},
            ]
        }

    def get_plan_revision(self, plan_no, revision_id):
        return {
            "raw": fixture("plan", "plan_revision_v1.json"),
            "fingerprint": "plan:v1:fixture",
            "retrievedAt": "2026-08-11T00:00:00Z",
            "metadata": {"profile": "2026.08", "operation": "PLAN_DETAIL"},
        }

    def list_notice_revisions(self, notice_no):
        return {
            "revisions": [
                {"revisionId": "notice-00", "revisionNumber": "00"},
                {"revisionId": "notice-01", "revisionNumber": "01"},
            ]
        }

    def get_notice_revision(self, notice_no, revision_id):
        return {
            "raw": fixture("notice", "ldt", "notice_revision_v1.json"),
            "fingerprint": "package-notice:v1:fixture",
            "retrievedAt": "2026-08-11T00:00:00Z",
            "metadata": {"profile": "2026.08", "operation": "NOTICE_LDT_DETAIL"},
        }

    def get_opening_bundle(self, notice_no, revision_id):
        return {
            "raw": fixture("opening", "normal", "opening_v1.json"),
            "fingerprint": "opening:v1:fixture",
            "retrievedAt": "2026-08-11T00:00:00Z",
            "processApply": "LDT",
            "bidMode": "1_MTHS",
            "failures": [],
            "metadata": {"profile": "2026.08", "operation": "OPENING_BID"},
        }

    def get_result_bundle(self, notice_no, revision_id):
        return {
            "raw": fixture("results", "result_v1.json"),
            "fingerprint": "result:v1:fixture",
            "retrievedAt": "2026-08-11T00:00:00Z",
            "failures": [],
            "metadata": {"profile": "2026.08", "operation": "SELECTION_RESULT"},
        }

    def collect_complete_bundle(self, record):
        return {
            "type": record["type"],
            "fetchedAt": "2026-08-11T00:00:00Z",
            "fingerprint": "complete-bundle:v1:fixture",
            "sources": {"searchRecord": record, "primaryDetail": {}},
        }

    def integration_health(self):
        return {"status": "UP"}

    def close(self):
        return None


def test_unified_source_exposes_all_revisions_opening_and_lookup_contracts():
    source = MuaSamCongProcurementSource(FakeRuntime())

    assert [
        row["revisionNumber"]
        for row in source.list_plan_revisions("PL2600000001")
    ] == ["01", "00"]
    plan = source.get_plan_revision("PL2600000001", "sanitized-plan-01")
    notice = source.get_notice_revision("IB2600000002", "notice-01")
    opening = source.get_opening_bundle("IB2600000002", "notice-01")
    result = source.get_result_bundle("IB2600000002", "notice-01")
    complete = source.collect_complete_bundle(
        {"type": "es-shopping-result", "id": "result-1"}
    )
    lookup = source.lookup("PL2600000001", "PLAN")

    assert plan["source"]["schemaFingerprint"] == "plan:v1:fixture"
    assert plan["totalAmountVnd"] == 300_000_000
    assert notice["source"]["semanticOperation"] == "NOTICE_LDT_DETAIL"
    assert opening["schemaVersion"] == "biddingflow-opening-bundle-v1"
    assert opening["rawBundle"]["entity"] == {
        "kind": "NOTICE",
        "canonicalCode": "IB2600000002",
        "noticeNo": "IB2600000002",
    }
    assert opening["rawBundle"]["revisions"]["01"]["revisionId"] == (
        "notice-01"
    )
    assert result["schemaVersion"] == "biddingflow-result-bundle-v1"
    assert result["hasSelectionResult"] is True
    assert result["hasTechnicalResult"] is True
    assert "raw" not in result
    assert complete["schemaFingerprint"] == "complete-bundle:v1:fixture"
    assert lookup["source"]["provider"] == "MUASAMCONG"
    assert lookup["data"]["totalInvestment"] == 300_000_000
    assert lookup["metrics"]["listMs"] >= 0
    assert lookup["metrics"]["detailMs"] >= 0
    assert lookup["metrics"]["totalMs"] >= (
        lookup["metrics"]["listMs"] + lookup["metrics"]["detailMs"]
    )
    assert "raw" not in lookup


def test_complete_lookup_maps_from_raw_bundle_and_can_reprocess_without_refetch():
    raw_revision = fixture("plan", "plan_revision_v1.json")
    raw_revision["bidpPlanDetailToProjectList"][0][
        "unknownFutureField2027"
    ] = {"abc": 123}

    class CompleteRuntime(FakeRuntime):
        def __init__(self):
            self.calls = []

        def search(self, code, kind):
            self.calls.append(("search", code, kind))
            return {
                "record": {
                    "type": "es-plan-project-p",
                    "id": "sanitized-plan-01",
                    "planNo": code,
                    "planVersion": "01",
                },
                "raw": {"page": {"content": [{"planNo": code}]}},
                "request": [{"query": [{"keyWord": code}]}],
                "fingerprint": "search:v1:fixture",
                "metadata": {"operation": "SEARCH"},
            }

        def collect_complete_bundle(self, record, **options):
            self.calls.append(("complete", record["planNo"], options))
            return {
                "schemaVersion": "biddingflow-muasamcong-raw-bundle-v2",
                "provider": "MUASAMCONG",
                "entity": {"kind": "PLAN", "planNo": record["planNo"]},
                "status": "FOUND_COMPLETE",
                "complete": True,
                "sources": {"search": {"success": True}},
                "revisions": {
                    "00": {
                        "revisionId": "sanitized-plan-00",
                        "sources": {"planDetail": {
                            "success": True,
                            "response": raw_revision,
                            "schemaFingerprint": "plan:v1:fixture",
                            "retrievedAt": "2026-08-11T00:00:00Z",
                        }},
                        "packages": {},
                    },
                    "01": {
                        "revisionId": "sanitized-plan-01",
                        "sources": {"planDetail": {
                            "success": True,
                            "response": raw_revision,
                            "schemaFingerprint": "plan:v1:fixture",
                            "retrievedAt": "2026-08-11T00:00:00Z",
                        }},
                        "packages": {},
                    },
                },
                "failures": [],
                "manifest": {
                    "sourceCount": 3,
                    "successCount": 3,
                    "failedCount": 0,
                    "revisions": ["00", "01"],
                    "packages": 2,
                    "operations": ["SEARCH", "PLAN_DETAIL"],
                },
                "metrics": {"upstream": {"requestCount": 3}},
            }

    runtime = CompleteRuntime()
    source = MuaSamCongProcurementSource(runtime)

    result = source.lookup_with_options(
        "PL2600000001",
        "PLAN",
        detail_level="COMPLETE",
        revision_mode="ALL",
    )
    canonical_again = source.map_plan_raw_bundle(result["rawBundle"])
    projected = source.lookup_from_raw_bundle(
        "PL2600000001", result["rawBundle"], revision_mode="ALL"
    )

    assert [
        row["revisionNumber"] for row in result["canonical"]["revisions"]
    ] == ["00", "01"]
    assert result["rawBundle"]["revisions"]["00"]["sources"][
        "planDetail"
    ]["response"]["bidpPlanDetailToProjectList"][0][
        "unknownFutureField2027"
    ] == {"abc": 123}
    assert canonical_again == result["canonical"]
    assert projected["canonical"] == result["canonical"]
    assert projected["data"]["totalInvestment"] == 300_000_000
    assert projected["metrics"]["upstream"] == {
        "requestCount": 0, "networkMs": 0,
    }
    assert projected["source"]["extractionStrategy"] == (
        "stored-raw-projection"
    )
    assert runtime.calls[0] == ("search", "PL2600000001", "PLAN")
    assert len(runtime.calls) == 2


def test_plan_complete_bundle_maps_package_detail_sidecar_fields():
    raw_revision = fixture("plan", "plan_revision_v1.json")
    bundle = {
        "schemaVersion": "biddingflow-muasamcong-raw-bundle-v2",
        "provider": "MUASAMCONG",
        "entity": {"kind": "PLAN", "planNo": "PL2600000001"},
        "revisions": {
            "01": {
                "revisionId": "sanitized-plan-01",
                "sources": {
                    "planDetail": {
                        "success": True,
                        "response": raw_revision,
                        "schemaFingerprint": "plan:v1:fixture",
                        "retrievedAt": "2026-08-12T00:00:00Z",
                    }
                },
                "packages": {
                    "detail-a-01": {
                        "identifiers": {
                            "id": "detail-a-01",
                            "idDetail": "detail-a-01",
                            "bidNo": "A",
                        },
                        "sources": {
                            "planPackageDetail": {
                                "success": True,
                                "response": {"bidpPlanDetailDTO": {
                                    "idDetail": "detail-a-01",
                                    "bidField": "HH",
                                    "bidForm": "LCNT_DB",
                                    "bidMode": "1_HTHS",
                                    "ctype": "DGCD",
                                    "isInternet": 0,
                                    "isDomestic": 0,
                                    "isMultiLot": 1,
                                    "additionalChoise": 1,
                                    "formValue": json.dumps([{
                                        "id": "option-plan-1",
                                        "category": "Vật tư mua thêm",
                                        "unit": "Hộp",
                                        "qty": 12,
                                        "percentage": 30,
                                        "estimateValue": 6_000_000,
                                    }], ensure_ascii=False),
                                    "bidpBidLotList": [
                                        {
                                            "lotNo": "PP2600305188",
                                            "lotName": "Lô thiết bị xét nghiệm",
                                            "lotEstimatePrice": 5_365_000_000,
                                            "cperiod": 120,
                                            "cperiodUnit": "D",
                                        },
                                        {
                                            "lotNo": "PP2600305189",
                                            "lotName": "Lô thiết bị nội soi",
                                            "lotEstimatePrice": 2_950_000_000,
                                            "cperiod": 4,
                                            "cperiodUnit": "M",
                                        },
                                    ],
                                }},
                                "schemaFingerprint": "plan-package:v1:fixture",
                            }
                        },
                    },
                    "detail-b-01": {
                        "identifiers": {
                            "id": "detail-b-01",
                            "idDetail": "detail-b-01",
                            "bidNo": "B",
                        },
                        "sources": {
                            "planPackageDetail": {
                                "success": True,
                                "response": {
                                    "idDetail": "detail-b-01",
                                    "isMultiLot": 0,
                                    "bidpBidLotList": [{
                                        "lotNo": "DEFAULT",
                                        "lotName": "Dòng mặc định của nguồn",
                                        "lotEstimatePrice": 2_000_000_000,
                                    }],
                                },
                                "schemaFingerprint": "plan-package:v1:fixture",
                            }
                        },
                    },
                },
            },
        },
    }

    canonical = MuaSamCongProcurementSource(FakeRuntime()).map_plan_raw_bundle(
        bundle
    )
    package = canonical["revisions"][0]["packages"][0]

    assert package["field"] == "Hàng hóa"
    assert package["selectionForm"] == (
        "Lựa chọn nhà thầu trong trường hợp đặc biệt"
    )
    assert package["selectionMode"] == "Một giai đoạn hai túi hồ sơ"
    assert package["contractType"] == "Theo đơn giá cố định"
    assert package["onlineMode"] == "Không qua mạng"
    assert package["domesticOrInternational"] == "Quốc tế"
    assert package["isMultiLot"] is True
    assert package["additionalPurchaseOption"] is True
    assert package["additionalPurchaseItems"] == [{
        "sourceItemId": "option-plan-1",
        "name": "Vật tư mua thêm",
        "unit": "Hộp",
        "quantity": 12,
        "percentage": 30,
        "estimateValueVnd": 6_000_000,
    }]
    assert package["lots"] == [
        {
            "lotNo": "PP2600305188",
            "lotName": "Lô thiết bị xét nghiệm",
            "lotPrice": 5_365_000_000,
            "bidGuarantee": None,
            "executionPeriod": "120 ngày",
        },
        {
            "lotNo": "PP2600305189",
            "lotName": "Lô thiết bị nội soi",
            "lotPrice": 2_950_000_000,
            "bidGuarantee": None,
            "executionPeriod": "4 tháng",
        },
    ]
    assert canonical["fieldSources"][
        "revisions.01.packages.detail-a-01.field"
    ]["operation"] == "PLAN_PACKAGE_DETAIL"
    assert canonical["fieldSources"][
        "revisions.01.packages.detail-a-01.lots"
    ]["operation"] == "PLAN_PACKAGE_DETAIL"
    assert canonical["fieldSources"][
        "revisions.01.packages.detail-a-01.additionalPurchaseItems"
    ]["sourcePath"] == "formValue"
    draft = map_package_canonical_to_draft(
        "MUASAMCONG", "PL2600000001", canonical["revisions"][0], package
    )
    assert draft["phanLo"] is True
    assert draft["danhSachPhanLo"] == package["lots"]
    assert draft["tuyChonMuaThem"] is True
    assert draft["tuyChonMuaThemList"][0]["hangMuc"] == "Vật tư mua thêm"
    non_multi_lot = canonical["revisions"][0]["packages"][1]
    assert non_multi_lot["isMultiLot"] is False
    assert non_multi_lot["lots"] is None


def test_complete_notice_bundle_maps_opening_result_and_contract_sources():
    raw_notice = fixture("notice", "ldt", "notice_revision_v1.json")
    bundle = {
        "schemaVersion": "biddingflow-muasamcong-raw-bundle-v2",
        "provider": "MUASAMCONG",
        "entity": {
            "kind": "NOTICE",
            "canonicalCode": "IB2600000002",
            "noticeNo": "IB2600000002",
        },
        "status": "FOUND_COMPLETE",
        "complete": True,
        "retrievedAt": "2026-08-12T00:00:00Z",
        "sources": {
            "contractList": {
                "operation": "NOTICE_CONTRACT_LIST",
                "success": True,
                "response": [{
                    "id": "contract-1",
                    "contractCode": "HD2600000001",
                    "contractDate": "2026-04-10",
                    "contractValue": 123456789,
                    "contractorCode": "vn0100000001",
                    "contractorName": "Nhà thầu A",
                }],
            }
        },
        "revisions": {
            "01": {
                "revisionId": "notice-01",
                "sourceStatus": "OPEN_DXKT",
                "statusForNotify": "DXT",
                "sources": {
                    "noticeDetail": {
                        "operation": "NOTICE_LDT_DETAIL",
                        "success": True,
                        "response": {
                            **raw_notice,
                            "bidInvContractorOfflineDTO": {
                                "decisionNo": "123/QĐ-E-HSMT",
                                "decisionDate": "2026-02-01T07:30:00",
                            },
                        },
                        "schemaFingerprint": "package-notice:v1:fixture",
                        "retrievedAt": "2026-08-12T00:00:00Z",
                    },
                    "tenderInfo": {
                        "operation": "NOTICE_TENDER_INFO",
                        "success": True,
                        "response": {
                            "bidNoContractorResponse": {
                                "bidNotification": {
                                    "notifyNo": "IB2600000002",
                                    "bidPrice": 987654321,
                                    "bidEstimatePrice": 900000000,
                                    "capitalDetail": "Nguồn vốn sidecar",
                                    "cPeriod": 5,
                                    "cPeriodUnit": "M",
                                    "isInternet": 0,
                                    "bidGuaranteeValue": 45_000_000,
                                    "isMedicine": 1,
                                    "isMultiLot": None,
                                    "lotDTOList": [
                                        {
                                            "lotNo": "PP2600000001",
                                            "lotName": "Thuốc A",
                                            "lotEstimatePrice": 400000000,
                                            "lotGuaranteeValue": None,
                                        },
                                        {
                                            "lotNo": "PP2600000002",
                                            "lotName": "Thuốc B",
                                            "lotEstimatePrice": 587654321,
                                            "lotGuaranteeValue": None,
                                        },
                                    ],
                                }
                            },
                        },
                    },
                    "hsmt": {
                        "operation": "NOTICE_HSMT",
                        "success": True,
                        "response": {
                            "bidaInvChapterConfList": [{"isMultiLot": 1}],
                            "bidoInvBiddingDTO": [
                                {
                                    "formCode": "BD_DATA_TABLE",
                                    "formValue": json.dumps({
                                        "effectTimeHSDT": 90,
                                        "lotDTOList": [{
                                            "lotNo": "PP2600000001",
                                            "lotName": "Thuốc A",
                                            "lotEstimatePrice": 400000000,
                                            "lotGuaranteeValue": 4000000,
                                        }, {
                                            "lotNo": "PP2600000002",
                                            "lotName": "Thuốc B",
                                            "lotEstimatePrice": 587654321,
                                            "lotGuaranteeValue": 5000000,
                                        }],
                                    }),
                                },
                                {
                                    "formCode": "BD.CG.02.0113",
                                    "formValue": json.dumps({
                                        "method": "2",
                                        "cost": None,
                                    }),
                                },
                                {
                                    "formCode": "BD.MT.02.1224",
                                    "formValue": json.dumps({"Table": [
                                        {
                                            "lotNo": "PP2600000001",
                                            "lotName": "Thuốc A",
                                        },
                                        {
                                            "id": "source-goods-1",
                                            "currentItemIndex": "1.1",
                                            "name": "Hóa chất xét nghiệm A",
                                            "uom": "Hộp",
                                            "qty": 12,
                                            "description": "Quy cách kỹ thuật A",
                                        },
                                        {
                                            "lotNo": "PP2600000002",
                                            "lotName": "Thuốc B",
                                        },
                                        {
                                            "id": "source-goods-2",
                                            "currentItemIndex": "2.1",
                                            "name": "Sinh phẩm xét nghiệm B",
                                            "uom": "Chai",
                                            "qty": "2,5",
                                            "description": "Quy cách kỹ thuật B",
                                        },
                                    ]}, ensure_ascii=False),
                                },
                            ],
                            "resultDecision": {
                                "decisionNo": "KHÔNG-ĐƯỢC-LẤY",
                                "decisionDate": "2026-04-01T07:30:00",
                            },
                        },
                    },
                    "planDetail": {
                        "operation": "PLAN_DETAIL",
                        "success": True,
                        "response": {
                            "plan": {
                                "id": "plan-revision-00",
                                "planNo": "PL2600000001",
                                "planVersion": "00",
                            },
                            "bidpPlanDetailToProjectList": [
                                {
                                    "idDetail": "other-package",
                                    "planNo": "PL2600000001",
                                    "bidNo": "A",
                                    "bidName": "Gói khác",
                                    "additionalChoise": 0,
                                    "bidTime": "15 ngày",
                                    "bidStartQuarter": "I",
                                    "bidStartYear": 2026,
                                },
                                {
                                    "idDetail": "notice-package",
                                    "planNo": "PL2600000001",
                                    "bidNo": "B",
                                    "bidName": "Gói B",
                                    "additionalChoise": 1,
                                    "bidTime": "45 ngày",
                                    "bidStartQuarter": "II",
                                    "bidStartYear": 2026,
                                },
                            ],
                        },
                    },
                    "planPackageDetail": {
                        "operation": "PLAN_PACKAGE_DETAIL",
                        "success": True,
                        "response": {
                            "formValue": json.dumps([{
                                "id": "option-1",
                                "category": "Phim X-Quang kỹ thuật số",
                                "unit": "tấm",
                                "qty": 6000,
                                "percentage": 0.3,
                                "estimateValue": 123_360_000,
                            }], ensure_ascii=False),
                        },
                    },
                    "opening_bid_0": {
                        "operation": "OPENING_BID",
                        "success": True,
                        "response": {
                            "bidoBidroundMngViewDTO": {
                                "successBidOpenDate": "2026-03-01T09:22:35",
                            },
                            "bidSubmissionByContractorViewResponse": {
                                "bidSubmissionDTOList": [{
                                    "contractorCode": "vn0100000001",
                                    "contractorName": "Nhà thầu A",
                                    "bidPrice": 900000000,
                                    "bidValidity": 90,
                                }]
                            }
                        },
                    },
                    "opening_lot_detail_0": {
                        "operation": "OPENING_LOT_DETAIL",
                        "success": True,
                        "response": [{
                            "contractorCode": "vn0100000001",
                            "contractorName": "Nhà thầu A",
                            "lotNo": "PP01",
                            "lotName": "Lô 1",
                            "lotFinalPrice": 900000000,
                        }],
                    },
                    "opening_bid_2": {
                        "operation": "OPENING_BID",
                        "success": True,
                        "response": {
                            "bidoBidroundMngViewDTO": {
                                "successBidOpenDateTc": "2026-03-02T10:05:12",
                            },
                        },
                    },
                    "technicalResult": {
                        "operation": "TECHNICAL_RESULT",
                        "success": True,
                        "response": {
                            "contractors": [{
                                "contractorCode": "vn0100000001",
                                "contractorName": "Nhà thầu A",
                                "technicalStatus": "Đạt",
                            }]
                        },
                    },
                    "selectionResult": {
                        "operation": "SELECTION_RESULT",
                        "success": True,
                        "response": {
                            "decisionNo": "QD-01",
                            "contractors": [{
                                "contractorCode": "vn0100000001",
                                "contractorName": "Nhà thầu A",
                                "isWinner": True,
                                "winningPrice": 880000000,
                            }]
                        },
                    },
                },
            }
        },
        "failures": [],
        "manifest": {"revisions": ["01"]},
        "metrics": {"upstream": {"requestCount": 10}},
    }
    source = MuaSamCongProcurementSource(FakeRuntime())

    canonical = source.map_notice_raw_bundle(bundle)
    projected = source.lookup_from_raw_bundle(
        "IB2600000002", bundle, revision_mode="ALL"
    )

    revision = canonical["revisions"][0]
    assert revision["priceVnd"] == 900000000
    assert revision["sourceBidPriceVnd"] == 987654321
    assert revision["estimatePriceVnd"] == 900000000
    assert revision["capitalDetail"] == "Nguồn vốn sidecar"
    assert revision["onlineMode"] == "Không qua mạng"
    assert revision["bidGuaranteeVnd"] == 45_000_000
    assert revision["status"] == "OPEN_DXKT"
    assert revision["statusForNotify"] == "DXT"
    assert revision["approvalDecisionNo"] == "123/QĐ-E-HSMT"
    assert revision["approvalDecisionDate"] == "2026-02-01T07:30:00"
    assert revision["actualOpeningAt"] == "2026-03-01T09:22:35"
    assert revision["financialActualOpeningAt"] == "2026-03-02T10:05:12"
    assert revision["bidOpeningAt"] == "2026-03-01T09:15:00"
    assert revision["isMedicinePackage"] is True
    assert revision["evaluationMethod"] == "Giá đánh giá"
    assert revision["isMultiLot"] is True
    assert revision["additionalPurchaseOption"] is True
    assert revision["additionalPurchaseItems"] == [{
        "sourceItemId": "option-1",
        "name": "Phim X-Quang kỹ thuật số",
        "unit": "tấm",
        "quantity": 6000,
        "percentage": 0.3,
        "estimateValueVnd": 123_360_000,
    }]
    assert revision["bidValidityDays"] == 90
    assert revision["selectionDuration"] == "45 ngày"
    assert revision["selectionStart"] == "Quý II/2026"
    assert revision["linkedPlanRevisionId"] == "plan-revision-00"
    assert revision["linkedPlanVersion"] == "00"
    assert revision["lots"] == [
        {
            "lotNo": "PP2600000001",
            "lotName": "Thuốc A",
            "lotPrice": 400000000,
            "bidGuarantee": 4000000,
            "executionPeriod": None,
        },
        {
            "lotNo": "PP2600000002",
            "lotName": "Thuốc B",
            "lotPrice": 587654321,
            "bidGuarantee": 5000000,
            "executionPeriod": None,
        },
    ]
    assert revision["goodsItems"] == [
        {
            "sourceItemId": "source-goods-1",
            "sourceIndex": "1.1",
            "lotNo": "PP2600000001",
            "lotName": "Thuốc A",
            "code": "1.1",
            "name": "Hóa chất xét nghiệm A",
            "unit": "Hộp",
            "quantity": 12,
            "technicalRequirement": "Quy cách kỹ thuật A",
            "referenceCode": None,
            "requiredOrigin": None,
            "deliveryLocation": None,
            "deliveryTime": None,
            "note": None,
        },
        {
            "sourceItemId": "source-goods-2",
            "sourceIndex": "2.1",
            "lotNo": "PP2600000002",
            "lotName": "Thuốc B",
            "code": "2.1",
            "name": "Sinh phẩm xét nghiệm B",
            "unit": "Chai",
            "quantity": 2.5,
            "technicalRequirement": "Quy cách kỹ thuật B",
            "referenceCode": None,
            "requiredOrigin": None,
            "deliveryLocation": None,
            "deliveryTime": None,
            "note": None,
        },
    ]
    assert len(revision["opening"]["bidders"]) == 1
    assert revision["opening"]["bidders"][0]["contractorCode"] == (
        "vn0100000001"
    )
    assert revision["opening"]["bidders"][0]["lotNo"] == "PP01"
    assert revision["opening"]["bidders"][0]["lotName"] == "Lô 1"
    assert revision["result"]["hasSelectionResult"] is True
    assert revision["result"]["hasTechnicalResult"] is True
    assert canonical["contracts"][0]["contractCode"] == "HD2600000001"
    assert canonical["contracts"][0]["contractValue"] == 123456789
    assert projected["kind"] == "PACKAGE"
    assert projected["data"]["bidPrice"] == 900000000
    assert projected["data"]["sourceBidPrice"] == 987654321
    assert projected["data"]["bidEstimatePrice"] == 900000000
    assert projected["data"]["onlineMode"] == "Không qua mạng"
    assert projected["data"]["bidGuarantee"] == 45_000_000
    assert projected["data"]["isMedicinePackage"] is True
    assert projected["data"]["evaluationMethod"] == "Giá đánh giá"
    assert projected["data"]["isMultiLot"] is True
    assert projected["data"]["additionalPurchaseOption"] is True
    assert projected["data"]["additionalPurchaseItems"] == (
        revision["additionalPurchaseItems"]
    )
    assert projected["data"]["bidValidityDays"] == 90
    assert projected["data"]["selectionDuration"] == "45 ngày"
    assert projected["data"]["selectionStart"] == "Quý II/2026"
    assert projected["data"]["linkedPlanRevisionId"] == "plan-revision-00"
    assert projected["data"]["linkedPlanVersion"] == "00"
    assert len(projected["data"]["lots"]) == 2
    assert projected["data"]["contracts"][0]["contractCode"] == (
        "HD2600000001"
    )
    assert projected["metrics"]["upstream"] == {
        "requestCount": 0,
        "networkMs": 0,
    }
    assert canonical["fieldSources"][
        "revisions.01.evaluationMethod"
    ]["operation"] == "NOTICE_HSMT"
    assert canonical["fieldSources"][
        "revisions.01.evaluationMethod"
    ]["sourcePath"] == (
        "bidoInvBiddingDTO[formCode=BD.CG.02.0113].formValue.method"
    )


def test_unified_lookup_falls_back_to_browser_extractors_when_api_is_unavailable():
    class FailedApiRuntime(FakeRuntime):
        def list_plan_revisions(self, _plan_no):
            raise RuntimeError("PROCUREMENT_SESSION_FAILED")

    class BrowserFallback:
        def lookup(self, code, kind):
            assert (code, kind) == ("PL2600000001", "PLAN")
            return {
                "schemaVersion": "biddingflow-procurement-preview-v1",
                "found": True,
                "kind": "PLAN",
                "inputCode": code,
                "canonicalCode": code,
                "source": {
                    "provider": "MUASAMCONG_BROWSER",
                    "driver": "generic",
                    "extractionStrategy": "semantic-dom",
                },
                "data": {"planNo": code, "packages": []},
                "metrics": {"totalMs": 25},
            }

    source = MuaSamCongProcurementSource(
        FailedApiRuntime(), browser_fallback=BrowserFallback()
    )

    result = source.lookup("PL2600000001", "PLAN")

    assert result["source"]["provider"] == "MUASAMCONG"
    assert result["source"]["extractionStrategy"] == "semantic-dom"


def test_plan_summary_lookup_exposes_total_investment_alias():
    class SummaryRuntime(FakeRuntime):
        def search(self, code, kind):
            assert (code, kind) == ("PL2600000001", "PLAN")
            return {
                "record": {
                    "planNo": code,
                    "name": "Kế hoạch mẫu",
                    "investTotal": 3_000_000_000,
                    "planType": "DTPT",
                },
                "metadata": {},
            }

    result = MuaSamCongProcurementSource(SummaryRuntime()).lookup_with_options(
        "PL2600000001",
        "PLAN",
        detail_level="SUMMARY",
        revision_mode="LATEST",
    )

    assert result["data"]["totalInvestment"] == 3_000_000_000
    assert result["data"]["sourcePlanType"] == "DTPT"
    assert result["data"]["planType"] == "Dự án"


def test_protected_lookup_recovers_after_two_transient_session_bootstrap_failures():
    class FlakySessionRuntime(FakeRuntime):
        def __init__(self):
            self.search_calls = 0

        def search(self, code, kind):
            self.search_calls += 1
            if self.search_calls <= 2:
                raise RuntimeError("PROCUREMENT_SESSION_FAILED")
            return {
                "record": {
                    "planNo": code,
                    "name": "Kế hoạch sau khi làm mới phiên",
                    "investTotal": 3_000_000_000,
                    "planType": "DTPT",
                },
                "metadata": {},
            }

    runtime = FlakySessionRuntime()
    result = MuaSamCongProcurementSource(runtime).lookup_with_options(
        "PL2600000001",
        "PLAN",
        detail_level="SUMMARY",
        revision_mode="LATEST",
    )

    assert runtime.search_calls == 3
    assert result["data"]["planName"] == "Kế hoạch sau khi làm mới phiên"


def test_import_source_observer_emits_complete_secret_free_dimensions():
    events = []
    source = MuaSamCongProcurementSource(FakeRuntime(), observer=events.append)

    with source.lookup_request_context("lookup-request-1"):
        source.get_plan_revision("PL2600000001", "sanitized-plan-01")

    assert len(events) == 1
    event = events[0]
    assert set(event) == {
        "provider",
        "lookupRequestId",
        "kind",
        "semanticOperation",
        "totalMs",
        "browserStartupMs",
        "sessionAcquireMs",
        "sessionCacheHit",
        "navigationMs",
        "networkWaitMs",
        "extractMs",
        "normalizeMs",
        "parserVersion",
        "schemaFingerprint",
        "extractionStrategy",
        "retries",
        "sessionRefreshCount",
        "classification",
    }
    assert event["provider"] == "MUASAMCONG"
    assert event["lookupRequestId"] == "lookup-request-1"
    assert event["sessionCacheHit"] is False
    assert event["semanticOperation"] == "PLAN_DETAIL"
    assert event["schemaFingerprint"] == "plan:v1:fixture"
    assert event["classification"] == "FOUND_SUPPORTED"
    assert "token" not in json.dumps(event).casefold()
    assert "cookie" not in json.dumps(event).casefold()
