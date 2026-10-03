"""Selected-package clarification mapping from MSC's observed JSON contract."""

from copy import deepcopy
import json
from pathlib import Path

import pytest

from backend.integrations.muasamcong_browser.canonical import (
    normalize_notice_clarifications,
    normalize_notice_complete_bundle,
)
from backend.integrations.muasamcong_browser.procurement_source import (
    MuaSamCongProcurementSource,
)


NOTICE_NO = "IB2600271825"
VERSION_KEY = "biduClarifyReqInvAndContentViewVersionDTOList"
CONTENT_KEY = "biduClarifyReqInvAndContentViewList"


def clarification_row(*, request_no="CID2600007585"):
    content = [{
        "id": "topic-source-id",
        "subjectName": "Yêu cầu về kỹ thuật",
        "question": "Nội dung yêu cầu làm rõ trong file đính kèm",
        "response": "Kính gửi: Các nhà thầu quan tâm\nISO 13485:2016\nTrân trọng./.",
    }]
    return {
        "id": "source-request-id",
        "reqNo": request_no,
        "notyfyNo": NOTICE_NO,
        "reqDate": "2026-06-15T17:56:48",
        "signReqDate": "2026-06-15T17:56:51",
        "signResDate": "2026-06-16T14:12:05",
        "clarifyReqContent": json.dumps(content, ensure_ascii=False),
        "clarifyResContent": json.dumps(content, ensure_ascii=False),
        "replyAdditional": None,
    }


def clarification_source(rows=None, *, version="00"):
    return {
        "success": True,
        "operation": "NOTICE_CLARIFICATION",
        "response": {VERSION_KEY: [{
            "notifyVersion": version,
            CONTENT_KEY: [clarification_row()] if rows is None else rows,
        }]},
    }


def normalize(source, *, version="00"):
    return normalize_notice_clarifications(
        source, notice_no=NOTICE_NO, revision_number=version,
    )


def notice_bundle(source):
    return {
        "schemaVersion": "biddingflow-muasamcong-raw-bundle-v2",
        "detailLevel": "COMPLETE",
        "entity": {"kind": "NOTICE", "noticeNo": NOTICE_NO},
        "revisions": {"00": {
            "revisionId": "notice-source-00",
            "sources": {
                "noticeDetail": {
                    "success": True,
                    "operation": "NOTICE_DETAIL_LDT",
                    "response": {"bidoNotifyContractorM": {
                        "id": "notice-source-00",
                        "notifyNo": NOTICE_NO,
                        "notifyVersion": "00",
                        "bidName": "Gói thầu kiểm thử làm rõ",
                        "processApply": "LDT",
                    }},
                },
                "clarification": source,
            },
        }},
    }


def test_observed_json_string_arrays_map_questions_and_signed_answers():
    source = clarification_source()
    source["response"][VERSION_KEY][0][CONTENT_KEY].append(
        clarification_row(request_no="CID2600007421")
    )

    result = normalize(source)

    assert result["clarificationAvailable"] is True
    assert result["clarificationStatus"] == "AVAILABLE"
    assert len(result["clarificationRequests"]) == 2
    assert len(result["clarificationResponses"]) == 2
    assert result["clarificationRequests"][0] == {
        "sourceRequestId": "source-request-id",
        "sourceRequestNo": "CID2600007585",
        "requestedAt": "2026-06-15T17:56:51",
        "content": "Yêu cầu về kỹ thuật\nNội dung yêu cầu làm rõ trong file đính kèm",
    }
    assert result["clarificationResponses"][0] == {
        "sourceRequestId": "source-request-id",
        "sourceRequestNo": "CID2600007585",
        "respondedAt": "2026-06-16T14:12:05",
        "content": "Yêu cầu về kỹ thuật\nKính gửi: Các nhà thầu quan tâm\nISO 13485:2016\nTrân trọng./.",
    }
    assert "id" not in result["clarificationRequests"][0]


def test_request_date_fallback_and_unsigned_answer_is_not_imported():
    row = clarification_row()
    row["signReqDate"] = None
    row["signResDate"] = None

    result = normalize(clarification_source([row]))

    assert result["clarificationAvailable"] is True
    assert result["clarificationRequests"][0]["requestedAt"] == row["reqDate"]
    assert result["clarificationResponses"] == []


def test_multiple_topics_preserve_full_multiline_text_without_json_syntax():
    row = clarification_row()
    question = "Dòng đầu\n\n  Dòng sau giữ khoảng trắng  \n"
    answer = "Trả lời dòng đầu\n\n  Nội dung cuối  \n"
    row["clarifyReqContent"] = json.dumps([
        {"subjectName": "Chủ đề 1", "question": question},
        {"subjectName": "Chủ đề 2", "question": "Câu hỏi 2"},
    ])
    row["clarifyResContent"] = json.dumps([
        {"subjectName": "Chủ đề 1", "response": answer},
        {"subjectName": "Chủ đề 2", "response": "Trả lời 2"},
    ])

    result = normalize(clarification_source([row]))

    assert result["clarificationRequests"][0]["content"] == (
        f"Chủ đề 1\n{question}\n\nChủ đề 2\nCâu hỏi 2"
    )
    assert result["clarificationResponses"][0]["content"] == (
        f"Chủ đề 1\n{answer}\n\nChủ đề 2\nTrả lời 2"
    )


@pytest.mark.parametrize("missing_field", ["clarifyReqContent", "clarifyResContent"])
def test_either_content_array_can_supply_both_question_and_response(missing_field):
    row = clarification_row()
    row[missing_field] = None

    result = normalize(clarification_source([row]))

    assert result["clarificationAvailable"] is True
    assert len(result["clarificationRequests"]) == 1
    assert len(result["clarificationResponses"]) == 1


def test_matching_version_is_required_and_foreign_notices_are_excluded():
    foreign = clarification_row(request_no="FOREIGN")
    foreign["notyfyNo"] = "IB2600000001"
    source = clarification_source([foreign, clarification_row()])
    source["response"][VERSION_KEY].append({
        "notifyVersion": "01",
        CONTENT_KEY: [clarification_row(request_no="OTHER-VERSION")],
    })

    result = normalize(source)

    assert [item["sourceRequestNo"] for item in result["clarificationRequests"]] == [
        "CID2600007585"
    ]
    assert normalize(source, version="02")["clarificationStatus"] == "REVISION_UNAVAILABLE"
    assert normalize(clarification_source([foreign]))["clarificationStatus"] == "NOTICE_MISMATCH"


def test_empty_matching_group_is_authoritative_empty_and_duplicates_are_not_repeated():
    empty = normalize(clarification_source([]))
    assert empty == {
        "clarificationAvailable": True,
        "clarificationStatus": "AVAILABLE",
        "clarificationRequests": [],
        "clarificationResponses": [],
    }
    row = clarification_row()
    result = normalize(clarification_source([row, deepcopy(row)]))
    assert len(result["clarificationRequests"]) == 1
    assert len(result["clarificationResponses"]) == 1


@pytest.mark.parametrize("source,status", [
    (None, "SOURCE_UNAVAILABLE"),
    ({"success": False, "response": {}}, "SOURCE_UNAVAILABLE"),
    ({"success": True, "response": None}, "SCHEMA_UNRECOGNIZED"),
    ({"success": True, "response": {}}, "SCHEMA_UNRECOGNIZED"),
    ({"success": True, "response": {VERSION_KEY: []}}, "REVISION_UNAVAILABLE"),
    ({"success": True, "response": {VERSION_KEY: [None]}}, "SCHEMA_UNRECOGNIZED"),
    ({"success": True, "response": {VERSION_KEY: [{"notifyVersion": "00"}]}}, "SCHEMA_UNRECOGNIZED"),
])
def test_optional_source_failure_is_distinct_from_empty(source, status):
    result = normalize(source)
    assert result["clarificationAvailable"] is False
    assert result["clarificationStatus"] == status
    assert result["clarificationRequests"] == []
    assert result["clarificationResponses"] == []


@pytest.mark.parametrize("change", [
    {"clarifyReqContent": "not-json"},
    {"clarifyResContent": "not-json"},
    {"clarifyReqContent": json.dumps({"question": "Wrong shape"})},
    {"clarifyReqContent": json.dumps([None])},
    {"clarifyReqContent": json.dumps([{"question": 7}])},
    {"id": None, "reqNo": None},
    {"signReqDate": None, "reqDate": None},
    {"clarifyReqContent": "[]", "clarifyResContent": "[]"},
    {"signResDate": 123},
    {"clarifyReqContent": '[{"question":"Question"}]', "clarifyResContent": None},
])
def test_invalid_content_does_not_claim_an_authoritative_partial_result(change):
    invalid = clarification_row(request_no="INVALID")
    invalid.update(change)
    result = normalize(clarification_source([clarification_row(), invalid]))
    assert result == {
        "clarificationAvailable": False,
        "clarificationStatus": "INVALID_CONTENT",
        "clarificationRequests": [],
        "clarificationResponses": [],
    }


def test_complete_bundle_and_existing_lookup_expose_selected_clarification_contract():
    bundle = notice_bundle(clarification_source())
    canonical = normalize_notice_complete_bundle(bundle)
    revision = canonical["revisions"][0]
    assert revision["revisionNumber"] == "00"
    assert revision["clarificationAvailable"] is True
    assert canonical["fieldSources"]["revisions.00.clarificationRequests"] == {
        "operation": "NOTICE_CLARIFICATION",
        "revision": "00",
        "sourcePath": VERSION_KEY,
    }

    preview = MuaSamCongProcurementSource(runtime=object()).lookup_from_raw_bundle(
        NOTICE_NO, bundle, detail_level="COMPLETE", revision_mode="SELECTED",
    )
    assert preview["data"]["clarificationAvailable"] is True
    assert preview["data"]["clarificationRequests"] == revision["clarificationRequests"]
    assert preview["data"]["clarificationResponses"] == revision["clarificationResponses"]
    preview["data"]["clarificationRequests"][0]["content"] = "Edited preview"
    assert preview["canonical"]["revisions"][0]["clarificationRequests"][0]["content"] != "Edited preview"


def test_invitation_bundle_without_clarification_has_no_authoritative_empty_list():
    bundle = notice_bundle(None)
    bundle["detailLevel"] = "INVITATION"
    del bundle["revisions"]["00"]["sources"]["clarification"]
    revision = normalize_notice_complete_bundle(bundle)["revisions"][0]
    assert revision["clarificationAvailable"] is False
    assert revision["clarificationStatus"] == "SOURCE_UNAVAILABLE"


def observed_ib2600493339_source():
    path = Path(__file__).parent / "fixtures" / "muasamcong" / "notice" / (
        "clarifications_IB2600493339.json"
    )
    return {
        "success": True,
        "operation": "NOTICE_CLARIFICATION",
        "response": json.loads(path.read_text(encoding="utf-8")),
    }


@pytest.mark.parametrize("version,revision_id,request_numbers,request_dates,response_dates", [
    (
        "00", "3a8a45a8-adb2-474d-bc57-e38cb8959cf3",
        ["CID2600012277", "CID2600012195"],
        ["2026-09-14T17:37:09", "2026-09-13T11:16:44"],
        ["2026-09-19T09:34:21", "2026-09-15T16:48:06"],
    ),
    (
        "01", "bb78355e-90b4-416a-97a7-929cd64acaca",
        ["CID2600012555"], ["2026-09-19T11:55:01"], ["2026-09-28T19:58:58"],
    ),
])
def test_observed_all_version_clarifications_keep_exact_identity_signed_dates_and_titles(
    version, revision_id, request_numbers, request_dates, response_dates,
):
    source = observed_ib2600493339_source()
    result = normalize_notice_clarifications(
        source, notice_no="IB2600493339", revision_number=version,
        revision_id=revision_id,
    )
    assert result["clarificationAvailable"] is True
    requests = result["clarificationRequests"]
    replies = result["clarificationResponses"]
    assert [row["sourceRequestNo"] for row in requests] == request_numbers
    assert [row["requestedAt"] for row in requests] == request_dates
    assert [row["respondedAt"] for row in replies] == response_dates
    group = next(group for group in source["response"][VERSION_KEY]
                 if group["notifyVersion"] == version)
    for request, reply, raw in zip(requests, replies, group[CONTENT_KEY], strict=True):
        assert request["sourceRequestId"] == reply["sourceRequestId"] == raw["id"]
        assert request["sourceRequestTitle"] == reply["sourceRequestTitle"] == raw["reqName"]
        subject = json.loads(raw["clarifyReqContent"])[0]
        assert request["content"] == (
            f"{raw['reqName']}\n\n{subject['subjectName']}\n{subject['question']}"
        )
        assert reply["content"] == f"{subject['subjectName']}\n{subject['response']}"


def test_absent_02_group_is_not_replaced_by_older_requests_or_empty_success():
    result = normalize_notice_clarifications(
        observed_ib2600493339_source(), notice_no="IB2600493339",
        revision_number="02", revision_id="217db3f1-9b19-4c93-a9e8-be3acc456da9",
    )
    assert result == {
        "clarificationAvailable": False,
        "clarificationStatus": "REVISION_UNAVAILABLE",
        "clarificationRequests": [],
        "clarificationResponses": [],
    }


def test_explicit_source_revision_id_cannot_mix_a_request_into_the_wrong_version():
    source = observed_ib2600493339_source()
    source["response"][VERSION_KEY][0][CONTENT_KEY][0]["notyfyId"] = (
        "3a8a45a8-adb2-474d-bc57-e38cb8959cf3"
    )
    result = normalize_notice_clarifications(
        source, notice_no="IB2600493339", revision_number="01",
        revision_id="bb78355e-90b4-416a-97a7-929cd64acaca",
    )
    assert result["clarificationAvailable"] is False
    assert result["clarificationStatus"] == "REVISION_MISMATCH"
    assert result["clarificationRequests"] == result["clarificationResponses"] == []


def test_duplicate_request_number_with_conflicting_content_is_non_authoritative():
    row = clarification_row()
    conflict = {**row, "reqName": "Different title"}
    result = normalize(clarification_source([row, conflict]))
    assert result["clarificationAvailable"] is False
    assert result["clarificationStatus"] == "AMBIGUOUS_SOURCE"
    assert result["clarificationRequests"] == result["clarificationResponses"] == []
