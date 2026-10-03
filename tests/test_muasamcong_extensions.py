"""Selected-notice extensions from the observed IB2600493339 detail responses."""

from copy import deepcopy
import json
from pathlib import Path

import pytest

from backend.integrations.muasamcong_browser.canonical import (
    normalize_notice_complete_bundle,
    normalize_notice_extensions,
)
from backend.integrations.muasamcong_browser.procurement_source import (
    MuaSamCongProcurementSource,
)


NOTICE_NO = "IB2600493339"
REVISION_IDS = {
    "00": "3a8a45a8-adb2-474d-bc57-e38cb8959cf3",
    "01": "bb78355e-90b4-416a-97a7-929cd64acaca",
    "02": "217db3f1-9b19-4c93-a9e8-be3acc456da9",
}
OBSERVED_ROWS = {
    "00": [{
        "id": "b0d28818-c8b5-4624-b347-df1b5bc94474",
        "notifyNo": NOTICE_NO,
        "notifyVersion": "00",
        "notifyType": "TBMT",
        "createdDate": "2026-09-17T15:21:32.535",
        "bidCloseDate": "2026-09-18T10:00:00",
        "bidCloseDelayDate": "2026-09-28T10:00:00",
        "reason": "Gia hạn thời gian đóng, mở thầu để điều chỉnh E-HSMT",
    }],
    "01": [{
        "id": "97e9b307-3e08-4de0-8c2d-f2272a53e3f0",
        "notifyNo": NOTICE_NO,
        "notifyVersion": "01",
        "notifyType": "TBMT",
        "createdDate": "2026-09-27T13:02:05.194",
        "bidCloseDate": "2026-09-28T10:00:00",
        "bidCloseDelayDate": "2026-10-01T10:00:00",
        "reason": "Gia hạn thời điểm đóng mở thầu để trả lời yêu cầu làm rõ E-HSMT đảm bảo đúng thời gian quy định",
    }, {
        "id": "e87ff07d-6e1d-4ed6-a839-d5e034967162",
        "notifyNo": NOTICE_NO,
        "notifyVersion": "01",
        "notifyType": "TBMT",
        "createdDate": "2026-09-29T17:00:25.708",
        "bidCloseDate": "2026-10-01T10:00:00",
        "bidCloseDelayDate": "2026-10-12T09:00:00",
        "reason": "Gia hạn thời điểm đóng thầu để sửa đổi E-HSMT",
    }],
    "02": None,
}


def extension_source(version="00"):
    parent = {
        "id": REVISION_IDS[version],
        "notifyNo": NOTICE_NO,
        "notifyVersion": version,
        "delayDTOList": deepcopy(OBSERVED_ROWS[version]),
    }
    root = {
        **parent, "delayDTOList": None, "bidName": "Gói thầu kiểm thử",
        "processApply": "LDT",
    }
    return {
        "success": True,
        "operation": "NOTICE_LDT_DETAIL",
        "response": {
            "bidoNotifyContractorM": root,
            "bidNoContractorResponse": {"bidNotification": parent},
        },
    }


def normalize(source, *, version="00"):
    return normalize_notice_extensions(
        source, notice_no=NOTICE_NO, revision_number=version,
        revision_id=REVISION_IDS[version],
    )


def notice_bundle(version="00", *, detail_level="COMPLETE"):
    return {
        "schemaVersion": "biddingflow-muasamcong-raw-bundle-v2",
        "detailLevel": detail_level,
        "entity": {"kind": "NOTICE", "noticeNo": NOTICE_NO},
        "revisions": {version: {
            "revisionId": REVISION_IDS[version],
            "sources": {"noticeDetail": extension_source(version)},
        }},
    }


def tender_info_bundle(version="00", *, detail_level="COMPLETE"):
    bundle = notice_bundle(version, detail_level=detail_level)
    sources = bundle["revisions"][version]["sources"]
    sources["tenderInfo"] = deepcopy(sources["noticeDetail"])
    sources["tenderInfo"]["operation"] = "NOTICE_TENDER_INFO"
    del sources["noticeDetail"]["response"]["bidNoContractorResponse"]
    return bundle


def test_observed_version_00_nested_extension_maps_the_new_closing_time():
    source = extension_source()
    assert source["response"]["bidoNotifyContractorM"]["delayDTOList"] is None
    result = normalize(source)
    assert result == {
        "extensionAvailable": True,
        "extensionStatus": "AVAILABLE",
        "extensions": [{
            "sourceExtensionId": "b0d28818-c8b5-4624-b347-df1b5bc94474",
            "extendedAt": "2026-09-17T15:21:32.535",
            "previousClosingAt": "2026-09-18T10:00:00",
            "newClosingAt": "2026-09-28T10:00:00",
            "reason": "Gia hạn thời gian đóng, mở thầu để điều chỉnh E-HSMT",
        }],
    }


def test_observed_version_01_maps_both_extensions_in_created_date_order():
    source = extension_source("01")
    parent = source["response"]["bidNoContractorResponse"]["bidNotification"]
    parent["delayDTOList"].reverse()
    result = normalize(source, version="01")
    assert result["extensionAvailable"] is True
    assert [row["sourceExtensionId"] for row in result["extensions"]] == [
        row["id"] for row in OBSERVED_ROWS["01"]
    ]
    assert [row["newClosingAt"] for row in result["extensions"]] == [
        "2026-10-01T10:00:00", "2026-10-12T09:00:00",
    ]
    assert [row["reason"] for row in result["extensions"]] == [
        row["reason"] for row in OBSERVED_ROWS["01"]
    ]


def test_observed_version_02_null_is_not_an_authoritative_empty_list():
    assert normalize(extension_source("02"), version="02") == {
        "extensionAvailable": False,
        "extensionStatus": "SOURCE_UNAVAILABLE",
        "extensions": [],
    }


@pytest.mark.parametrize("source,status", [
    (None, "SOURCE_UNAVAILABLE"),
    ({"success": False, "response": {}}, "SOURCE_UNAVAILABLE"),
    ({"success": True, "response": None}, "SCHEMA_UNRECOGNIZED"),
    ({"success": True, "response": {}}, "SOURCE_UNAVAILABLE"),
    ({"success": True, "response": {"bidNoContractorResponse": []}}, "SCHEMA_UNRECOGNIZED"),
])
def test_failed_or_unrecognized_source_is_not_authoritative(source, status):
    assert normalize(source) == {
        "extensionAvailable": False, "extensionStatus": status, "extensions": [],
    }


@pytest.mark.parametrize("rows", [{}, [None], "[]"])
def test_malformed_nested_list_is_not_authoritative(rows):
    source = extension_source()
    source["response"]["bidNoContractorResponse"]["bidNotification"]["delayDTOList"] = rows
    assert normalize(source) == {
        "extensionAvailable": False,
        "extensionStatus": "SCHEMA_UNRECOGNIZED",
        "extensions": [],
    }


def test_explicit_empty_nested_list_is_recognized_but_never_synthesizes_rows():
    source = extension_source()
    source["response"]["bidNoContractorResponse"]["bidNotification"]["delayDTOList"] = []
    source["response"]["bidoNotifyContractorM"]["bidCloseDate"] = "2026-10-12T09:00:00"
    source["response"]["reOffer"] = {"delayDTOList": OBSERVED_ROWS["00"]}
    assert normalize(source) == {
        "extensionAvailable": True, "extensionStatus": "AVAILABLE", "extensions": [],
    }


@pytest.mark.parametrize("path,change,status", [
    ("parent", {"notifyNo": "IB2600000001"}, "NOTICE_MISMATCH"),
    ("parent", {"notifyVersion": "01"}, "REVISION_MISMATCH"),
    ("parent", {"id": REVISION_IDS["01"]}, "REVISION_MISMATCH"),
    ("root", {"notifyVersion": "01"}, "REVISION_MISMATCH"),
    ("row", {"notifyNo": "IB2600000001"}, "NOTICE_MISMATCH"),
    ("row", {"notifyVersion": "01"}, "REVISION_MISMATCH"),
    ("row", {"notifyType": "REOFFER"}, "INVALID_CONTENT"),
])
def test_matching_parent_and_each_tbmt_row_are_required(path, change, status):
    source = extension_source()
    root = source["response"]["bidoNotifyContractorM"]
    parent = source["response"]["bidNoContractorResponse"]["bidNotification"]
    {"root": root, "parent": parent, "row": parent["delayDTOList"][0]}[path].update(change)
    result = normalize(source)
    assert result["extensionAvailable"] is False
    assert result["extensionStatus"] == status
    assert result["extensions"] == []


def test_duplicate_ids_are_deduplicated_only_when_the_normalized_content_agrees():
    source = extension_source()
    rows = source["response"]["bidNoContractorResponse"]["bidNotification"]["delayDTOList"]
    rows.append(deepcopy(rows[0]))
    assert len(normalize(source)["extensions"]) == 1
    rows[1]["reason"] = "Conflicting source reason"
    assert normalize(source) == {
        "extensionAvailable": False,
        "extensionStatus": "AMBIGUOUS_SOURCE",
        "extensions": [],
    }


def test_reason_preserves_full_multiline_text():
    source = extension_source()
    reason = "Dòng đầu\n\n  Dòng sau giữ khoảng trắng  \n"
    source["response"]["bidNoContractorResponse"]["bidNotification"]["delayDTOList"][0]["reason"] = reason
    assert normalize(source)["extensions"][0]["reason"] == reason


@pytest.mark.parametrize("change", [
    {"id": None}, {"id": 7}, {"reason": None}, {"reason": " "},
    {"createdDate": "2026-09-17"},
    {"createdDate": "2026-02-30T15:21:32"},
    {"bidCloseDate": None}, {"bidCloseDelayDate": 42},
    {"bidCloseDelayDate": "2026-09-18T10:00:00"},
    {"bidCloseDelayDate": "2026-09-17T10:00:00"},
    {"createdDate": "2026-09-17T15:21:32Z"},
])
def test_malformed_row_does_not_publish_a_partial_extension_list(change):
    source = extension_source("01")
    source["response"]["bidNoContractorResponse"]["bidNotification"]["delayDTOList"][1].update(change)
    assert normalize(source, version="01") == {
        "extensionAvailable": False,
        "extensionStatus": "INVALID_CONTENT",
        "extensions": [],
    }


@pytest.mark.parametrize("parent", [None, {}, {"delayDTOList": None}])
def test_missing_parent_identity_or_list_does_not_claim_an_empty_result(parent):
    source = extension_source()
    source["response"]["bidNoContractorResponse"]["bidNotification"] = parent
    assert normalize(source)["extensionAvailable"] is False


def test_other_delay_lists_are_not_scanned_when_observed_parent_list_is_absent():
    source = extension_source("02")
    source["response"]["bidoNotifyContractorM"]["delayDTOList"] = OBSERVED_ROWS["01"]
    source["response"]["reOffer"] = {"delayDTOList": OBSERVED_ROWS["01"]}
    result = normalize(source, version="02")
    assert result["extensionAvailable"] is False
    assert result["extensions"] == []


def test_complete_bundle_and_lookup_data_expose_independent_extension_copies():
    bundle = notice_bundle("01")
    canonical = normalize_notice_complete_bundle(bundle)
    revision = canonical["revisions"][0]
    assert revision["extensionAvailable"] is True
    assert canonical["fieldSources"]["revisions.01.extensions"] == {
        "operation": "NOTICE_LDT_DETAIL",
        "revision": "01",
        "sourcePath": "bidNoContractorResponse.bidNotification.delayDTOList",
    }
    preview = MuaSamCongProcurementSource(runtime=object()).lookup_from_raw_bundle(
        NOTICE_NO, bundle, detail_level="COMPLETE", revision_mode="SELECTED",
    )
    assert preview["source"]["parserVersion"] == "2026.10.03.5"
    assert preview["data"]["extensions"] == revision["extensions"]
    preview["data"]["extensions"][0]["reason"] = "Edited preview"
    assert preview["canonical"]["revisions"][0]["extensions"][0]["reason"] != "Edited preview"


@pytest.mark.parametrize("version,count", [("00", 1), ("01", 2), ("02", 0)])
def test_observed_ttc_ldt_sidecar_is_the_primary_extension_source(version, count):
    bundle = tender_info_bundle(version)
    sources = bundle["revisions"][version]["sources"]
    assert "bidNoContractorResponse" not in sources["noticeDetail"]["response"]
    canonical = normalize_notice_complete_bundle(bundle)
    revision = canonical["revisions"][0]
    assert len(revision["extensions"]) == count
    assert revision["extensionAvailable"] is (version != "02")
    if count:
        assert canonical["fieldSources"][f"revisions.{version}.extensions"] == {
            "operation": "NOTICE_TENDER_INFO",
            "revision": version,
            "sourcePath": "bidNoContractorResponse.bidNotification.delayDTOList",
        }


@pytest.mark.parametrize("change,status", [
    ("failed", "SOURCE_UNAVAILABLE"),
    ("null_response", "SCHEMA_UNRECOGNIZED"),
    ("null_list", "SOURCE_UNAVAILABLE"),
    ("malformed_list", "SCHEMA_UNRECOGNIZED"),
    ("wrong_version", "REVISION_MISMATCH"),
    ("wrong_id", "REVISION_MISMATCH"),
    ("wrong_notice", "NOTICE_MISMATCH"),
    ("malformed_envelope", "SOURCE_UNAVAILABLE"),
    ("null_envelope", "SOURCE_UNAVAILABLE"),
])
def test_present_primary_source_failure_never_falls_back_to_positive_legacy_detail(change, status):
    bundle = notice_bundle()
    sources = bundle["revisions"]["00"]["sources"]
    primary = deepcopy(sources["noticeDetail"])
    primary["operation"] = "NOTICE_TENDER_INFO"
    sources["tenderInfo"] = primary
    parent = primary["response"]["bidNoContractorResponse"]["bidNotification"]
    if change == "failed":
        primary["success"] = False
    elif change == "null_response":
        primary["response"] = None
    elif change == "null_list":
        parent["delayDTOList"] = None
    elif change == "malformed_list":
        parent["delayDTOList"] = [None]
    elif change == "wrong_version":
        parent["notifyVersion"] = "01"
    elif change == "wrong_id":
        parent["id"] = REVISION_IDS["01"]
    elif change == "wrong_notice":
        parent["notifyNo"] = "IB2600000001"
    elif change == "malformed_envelope":
        sources["tenderInfo"] = ["invalid"]
    elif change == "null_envelope":
        sources["tenderInfo"] = None
    canonical = normalize_notice_complete_bundle(bundle)
    revision = canonical["revisions"][0]
    assert revision["extensionAvailable"] is False
    assert revision["extensionStatus"] == status
    assert revision["extensions"] == []
    assert "revisions.00.extensions" not in canonical["fieldSources"]


def test_other_tender_operation_keeps_legacy_detail_extension_projection():
    bundle = notice_bundle()
    sources = bundle["revisions"]["00"]["sources"]
    sources["tenderInfo"] = {
        "operation": "NOTICE_TENDER_INFO_OTHER", "success": False,
    }
    canonical = normalize_notice_complete_bundle(bundle)
    assert len(canonical["revisions"][0]["extensions"]) == 1
    assert canonical["fieldSources"]["revisions.00.extensions"]["operation"] == (
        "NOTICE_LDT_DETAIL"
    )


@pytest.mark.parametrize("foreign_parent", [True, False])
def test_mismatched_primary_never_enriches_foreign_prices_or_hijacks_notice_identity(foreign_parent):
    bundle = notice_bundle()
    sources = bundle["revisions"]["00"]["sources"]
    sources["noticeDetail"]["response"]["bidoNotifyContractorM"]["bidPrice"] = 123
    foreign = {
        "id": REVISION_IDS["01"], "notifyId": REVISION_IDS["01"],
        "notifyNo": NOTICE_NO, "notifyVersion": "01", "bidPrice": 999999,
        "bidName": "Foreign version01", "planNo": "PL2600275637",
        "bidMode": "1_MTHS", "processApply": "LDT", "delayDTOList": [],
    }
    response = {
        "bidNoContractorResponse": {"bidNotification": foreign},
    }
    if not foreign_parent:
        response["bidoNotifyContractorM"] = deepcopy(foreign)
    sources["tenderInfo"] = {
        "operation": "NOTICE_TENDER_INFO", "success": True, "response": response,
    }
    canonical = normalize_notice_complete_bundle(bundle)
    revision = canonical["revisions"][0]
    assert revision["revisionNumber"] == "00"
    assert revision["notifyId"] == REVISION_IDS["00"]
    assert revision["name"] == "Gói thầu kiểm thử"
    assert revision["priceVnd"] == revision["sourceBidPriceVnd"] == 123
    assert revision["extensionStatus"] == "REVISION_MISMATCH"
    assert revision["extensions"] == []
    assert "tenderInfo" not in revision["availableSources"]


def test_tender_wrapper_non_notice_id_keeps_existing_scalar_enrichment():
    bundle = notice_bundle()
    sources = bundle["revisions"]["00"]["sources"]
    sources["tenderInfo"] = {
        "operation": "NOTICE_TENDER_INFO", "success": True,
        "response": {"id": "unrelated-wrapper-id", "bidPrice": 456},
    }
    revision = normalize_notice_complete_bundle(bundle)["revisions"][0]
    assert revision["priceVnd"] == 456
    assert revision["extensionStatus"] == "SOURCE_UNAVAILABLE"


@pytest.mark.parametrize("path", ["root", "parent"])
def test_optional_foreign_notify_id_cannot_publish_extensions_when_primary_id_matches(path):
    bundle = tender_info_bundle()
    sources = bundle["revisions"]["00"]["sources"]
    response = sources["tenderInfo"]["response"]
    candidate = (
        response["bidoNotifyContractorM"] if path == "root"
        else response["bidNoContractorResponse"]["bidNotification"]
    )
    candidate["notifyId"] = REVISION_IDS["01"]
    assert candidate["id"] == REVISION_IDS["00"]
    assert normalize(sources["tenderInfo"])["extensionStatus"] == "REVISION_MISMATCH"
    canonical = normalize_notice_complete_bundle(bundle)
    revision = canonical["revisions"][0]
    assert revision["extensionAvailable"] is False
    assert revision["extensionStatus"] == "REVISION_MISMATCH"
    assert revision["extensions"] == []
    assert "tenderInfo" not in revision["availableSources"]
    assert "revisions.00.extensions" not in canonical["fieldSources"]


def test_plan_invitation_notice_enrichment_does_not_expose_extensions():
    bundle = tender_info_bundle("01", detail_level="INVITATION")
    canonical = normalize_notice_complete_bundle(bundle)
    revision = canonical["revisions"][0]
    assert all(key not in revision for key in (
        "extensionAvailable", "extensionStatus", "extensions",
    ))
    assert "revisions.01.extensions" not in canonical["fieldSources"]
    preview = MuaSamCongProcurementSource(runtime=object()).lookup_from_raw_bundle(
        NOTICE_NO, bundle, detail_level="INVITATION", revision_mode="SELECTED",
    )
    assert "extensions" not in preview["data"]


def test_complete_all_retains_histories_per_source_version_and_keeps_latest_data_semantics():
    bundle = tender_info_bundle("02")
    fixture = Path(__file__).parent / "fixtures" / "muasamcong" / "notice" / (
        "clarifications_IB2600493339.json"
    )
    grouped = json.loads(fixture.read_text(encoding="utf-8"))
    for version in ("00", "01"):
        bundle["revisions"].update(tender_info_bundle(version)["revisions"])
    for node in bundle["revisions"].values():
        node["sources"]["clarification"] = {
            "success": True, "operation": "NOTICE_CLARIFICATION",
            "response": deepcopy(grouped),
        }
    bundle["revisionMode"] = "ALL"
    preview = MuaSamCongProcurementSource(runtime=object()).lookup_from_raw_bundle(
        NOTICE_NO, bundle, detail_level="COMPLETE", revision_mode="ALL",
    )
    revisions = preview["canonical"]["revisions"]
    assert [row["revisionNumber"] for row in revisions] == ["00", "01", "02"]
    assert [len(row["extensions"]) for row in revisions] == [1, 2, 0]
    assert [len(row["clarificationRequests"]) for row in revisions] == [2, 1, 0]
    assert [len(row["clarificationResponses"]) for row in revisions] == [2, 1, 0]
    assert [row["extensionStatus"] for row in revisions] == [
        "AVAILABLE", "AVAILABLE", "SOURCE_UNAVAILABLE",
    ]
    assert [row["clarificationStatus"] for row in revisions] == [
        "AVAILABLE", "AVAILABLE", "REVISION_UNAVAILABLE",
    ]
    assert preview["data"]["notifyId"] == REVISION_IDS["02"]
    assert preview["data"]["extensions"] == []
    assert preview["data"]["clarificationRequests"] == []
    assert preview["canonical"]["fieldSources"]["revisions.00.extensions"]["operation"] == (
        "NOTICE_TENDER_INFO"
    )
    assert preview["canonical"]["fieldSources"]["revisions.01.extensions"]["operation"] == (
        "NOTICE_TENDER_INFO"
    )
