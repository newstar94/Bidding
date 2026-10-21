"""ADR 0091 boundaries that do not need a database: parity, scope, hashes and copy."""

import json
from pathlib import Path

import pytest

from backend.procurement_monitor.clarification_merge import (
    NoticeTargetError,
    format_for_datetime_local,
    local_row_id,
    normalized_content,
    plan_append,
    resolve_notice_target,
    rows_in_scope,
)
from backend.procurement_monitor.clarification_writer import (
    ALREADY_PRESENT, BUSY, NEWER_REVISION, NOT_ENTITLED, TARGET_INVALID, WRITTEN,
    WriteOutcome, auto_write_enabled,
)
from backend.procurement_monitor.domain import CLARIFICATION_VERSIONS, clarification_versions, digest, snapshots
from backend.procurement_monitor.worker import write_result_message


ROOT = Path(__file__).resolve().parent
PARITY = json.loads((ROOT / "fixtures" / "clarification_auto_write_parity.json").read_text(encoding="utf-8"))
REAL_NOTICE = "IB2600493339"
REAL_CLARIFICATIONS = json.loads(
    (ROOT / "fixtures" / "muasamcong" / "notice" / "clarifications_IB2600493339.json").read_text(encoding="utf-8")
)
# Hashes of the monitor baseline before ADR 0091. Changing them would make every
# stored baseline treat old content as new and email every recipient again.
REAL_CLARIFICATION_HASHES = sorted([
    "029296d41941101453695b293c8a53fe2f68dde1d4e84117e8a9fea4b8bbc7db",
    "aeaf3b9b7ea92cb10e803847b0ee54c77ae65d78b71875c74d3bd721cd1c4eec",
    "b9b5bea5ca6daf9f2956a517a058b207fbc00496c73e36286b7c5b847c93d838",
    "cae10cf26e93639036acd463ced28f1ebe1a29c63b212f685ce15d412d055c4d",
    "edc7d92f8bd9c5c9f4319f6e9ad1d62f8b76fbf478f361cb4e949a603e5618a1",
    "f8b71d4125a43a7eb111ef590a4df5881e809c5e2decb75d70c379a3affaf3d5",
])


def stored_package(pkg):
    return {"id": pkg["id"], "ma_goi_thau": pkg["maGoiThau"], "phien_ban": pkg["phienBan"]}


def versions_of(case):
    return {
        revision["revisionNumber"]: {
            "requests": revision["clarificationRequests"],
            "responses": revision["clarificationResponses"],
        }
        for revision in case["revisions"]
    }


def resolve_id(value, package_id):
    if isinstance(value, str):
        return value
    source = value["idFrom"]
    return local_row_id(package_id, PARITY["noticeNo"], source["version"], source["kind"], source["identity"])


def stored_rows(case):
    package_id = case["package"]["id"]
    return [
        {"id": resolve_id(row["id"], package_id), "loai": loai, "thoi_gian": row["thoi_gian"], "noi_dung": row["noi_dung"]}
        for loai, rows in (("yeu_cau", case["current"]["requests"]), ("tra_loi", case["current"]["responses"]))
        for row in rows
    ]


def test_pinned_row_id_matches_frontend_formula():
    for pinned in PARITY["pinnedIds"]:
        assert local_row_id(
            pinned["packageId"], pinned["noticeNo"], pinned["version"], pinned["kind"], pinned["identity"],
        ) == pinned["id"]


@pytest.mark.parametrize("target", PARITY["targets"], ids=lambda target: target["package"]["id"] or "no-id")
def test_notice_target_resolution_matches_frontend(target):
    package = stored_package(target["package"])
    if "error" in target:
        with pytest.raises(NoticeTargetError) as raised:
            resolve_notice_target(package)
        assert raised.value.code == target["error"]
    else:
        assert resolve_notice_target(package) == (PARITY["noticeNo"], target["revision"])


@pytest.mark.parametrize("case", PARITY["cases"], ids=lambda case: case["name"])
def test_append_only_merge_matches_manual_update(case):
    package_id = case["package"]["id"]
    notice_no, target_version = resolve_notice_target(stored_package(case["package"]))
    assert target_version == case["expected"]["revision"]
    planned = plan_append(
        package_id=package_id, notice_no=notice_no, target_version=target_version,
        current_rows=stored_rows(case), rows_by_version=versions_of(case),
        generate_id=lambda kind: f"lr-generated-{kind}",
    )
    for loai, expected_rows in (("yeu_cau", case["expected"]["requests"]), ("tra_loi", case["expected"]["responses"])):
        actual = planned[loai]
        assert [row["display_time"] for row in actual] == [row["time"] for row in expected_rows]
        assert [row["noi_dung"] for row in actual] == [row["content"] for row in expected_rows]
        for row, expected in zip(actual, expected_rows):
            if expected["id"] == "random":
                assert row["id"].startswith("lr-generated-")
            else:
                assert row["id"] == resolve_id(expected["id"], package_id)
            assert row["loai"] == loai


def test_existing_rows_are_never_relinked_or_returned():
    case = PARITY["cases"][0]
    current = stored_rows(case)
    planned = plan_append(
        package_id=case["package"]["id"], notice_no=PARITY["noticeNo"], target_version="01",
        current_rows=current, rows_by_version=versions_of(case),
    )
    appended = {row["id"] for row in (*planned["yeu_cau"], *planned["tra_loi"])}
    assert not appended & {row["id"] for row in current}
    assert "lr-5d1c0a8e-7b9f-4c2e-9a41-3f6b2d8e1c07" in {row["id"] for row in current}


def test_persisted_rows_use_the_server_datetime_format():
    case = PARITY["cases"][0]
    planned = plan_append(
        package_id=case["package"]["id"], notice_no=PARITY["noticeNo"], target_version="01",
        current_rows=[], rows_by_version=versions_of(case),
    )
    assert planned["yeu_cau"][0]["thoi_gian"] == "2026-08-03 09:00:00"


def test_rows_from_newer_notice_versions_are_reported_not_written():
    case = PARITY["cases"][0]
    planned = plan_append(
        package_id="gt-x", notice_no=PARITY["noticeNo"], target_version="00",
        current_rows=[], rows_by_version={"02": versions_of(case)["02"]},
    )
    assert planned["yeu_cau"] == [] and planned["tra_loi"] == []
    assert planned["newer_revision_rows"] is True


def test_duplicate_versions_after_normalization_are_rejected():
    with pytest.raises(NoticeTargetError):
        rows_in_scope({"0": {}, "00": {}}, "00")


@pytest.mark.parametrize(("value", "expected"), [
    ("2026-09-13T11:16:44", "13/09/2026 11:16"),
    ("2026-09-13 11:16:44", "13/09/2026 11:16"),
    ("2026-09-13", "13/09/2026 00:00"),
    ("13/09/2026 11:16", "13/09/2026 11:16"),
    # The date-only prefix matches first in formatForDatetimeLocal as well.
    ("13/09/2026 - 11:16", "13/09/2026 00:00"),
    ("2026-09-13T11:16:44+00:00", "13/09/2026 11:16"),
    ("", ""),
    (None, ""),
    ("not a date", ""),
])
def test_datetime_format_matches_frontend_literal_digits(value, expected):
    assert format_for_datetime_local(value) == expected


def test_content_normalization_matches_javascript_trim():
    assert normalized_content("\ufeff Dòng 1\r\nDòng 2\r ") == "Dòng 1\nDòng 2"
    assert normalized_content(None) == ""


def test_monitor_hashes_are_unchanged_on_real_source_data():
    bundle = {"noticeNo": REAL_NOTICE, "revisionNumber": "02", "sources": {
        "clarification": {"success": True, "response": REAL_CLARIFICATIONS},
        "petition": {"success": True, "response": []},
    }}
    observed = snapshots(bundle, REAL_NOTICE)
    assert set(observed) == {"clarification", "petition"}
    assert sorted(digest(row) for row in observed["clarification"]) == REAL_CLARIFICATION_HASHES
    versions = clarification_versions(bundle["sources"]["clarification"], REAL_NOTICE)
    assert {version: (len(rows["requests"]), len(rows["responses"])) for version, rows in versions.items()} == {
        "00": (2, 2), "01": (1, 1),
    }
    assert CLARIFICATION_VERSIONS not in observed


def test_unparsed_clarifications_never_become_empty_versions():
    assert clarification_versions(None, REAL_NOTICE) is None
    assert clarification_versions({"success": False, "response": REAL_CLARIFICATIONS}, REAL_NOTICE) is None
    broken = {"biduClarifyReqInvAndContentViewVersionDTOList": [{"notifyVersion": "x"}]}
    assert clarification_versions({"success": True, "response": broken}, REAL_NOTICE) is None


def test_rollback_switch_defaults_on():
    assert auto_write_enabled({})
    assert auto_write_enabled({"PROCUREMENT_MONITOR_AUTO_WRITE_ENABLED": "TRUE"})
    assert not auto_write_enabled({"PROCUREMENT_MONITOR_AUTO_WRITE_ENABLED": "false"})


@pytest.mark.parametrize(("outcome", "fragment"), [
    (WriteOutcome(WRITTEN, 2, 1), "Đã tự cập nhật 2 yêu cầu và 1 trả lời làm rõ"),
    (WriteOutcome(ALREADY_PRESENT), "đã có đủ"),
    (WriteOutcome(NEWER_REVISION), "phiên bản TBMT mới hơn"),
    (WriteOutcome(NOT_ENTITLED), "không có lấy dữ liệu tự động"),
    (WriteOutcome(TARGET_INVALID), "chưa xác định được phiên bản TBMT"),
    (WriteOutcome(BUSY), "đang thay đổi"),
])
def test_write_outcome_copy(outcome, fragment):
    message = write_result_message(outcome)
    assert fragment in message
    assert "Mua Sắm Công" not in message and "http" not in message


def test_no_write_outcome_keeps_original_message():
    assert write_result_message(None) == ""
