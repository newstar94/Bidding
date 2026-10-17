"""Business boundaries for the twice-daily procurement monitor."""

from datetime import datetime, timezone

import pytest

from backend.procurement_monitor.domain import changes, due_slot, eligible, notice_code, petition_rows, snapshots
from backend.procurement_monitor.worker import monitor_enabled
from backend.shared.date_utils import VIETNAM_TIMEZONE
from tests.test_muasamcong_clarifications import NOTICE_NO, clarification_row, clarification_source


def moment(text):
    return datetime.fromisoformat(text).replace(tzinfo=VIETNAM_TIMEZONE)


@pytest.mark.parametrize(("clock", "expected"), [
    ("08:29:59", None), ("08:30:00", "08:30:00"),
    ("14:29:59", "08:30:00"), ("14:30:00", "14:30:00"), ("23:59:59", "14:30:00"),
    ("00:00:00", None),
])
def test_vietnam_schedule_and_same_day_catch_up(clock, expected):
    now = moment(f"2026-10-17T{clock}")
    expected = int(moment(f"2026-10-17T{expected}").timestamp()) if expected else None
    assert due_slot(now) == due_slot(now.astimezone(timezone.utc)) == expected


@pytest.mark.parametrize(("status", "date", "allowed"), [
    ("PREPARING", None, False), ("UNKNOWN", None, False), ("CANCELLED", None, False),
    ("INVITED", None, True), ("OPENED", None, True), ("EVALUATING", None, True),
    ("PARTIALLY_AWARDED", "2026-09-01", True),
    ("AWARDED", "2026-10-07", True), ("AWARDED", "2026-10-06", False),
    ("AWARDED", "07/10/2026", True), ("AWARDED", None, True),
])
def test_status_and_ten_day_result_boundary(status, date, allowed):
    assert eligible({"trang_thai": status, "ngay_quyet_dinh_ket_qua": date,
                     "ma_goi_thau": NOTICE_NO}, moment("2026-10-17T14:30:00")) is allowed


def test_codes_and_rollback_switch():
    assert notice_code(" ib2600271825-01 ") == NOTICE_NO
    assert notice_code("PL2600271825") is None
    assert monitor_enabled({})
    assert not monitor_enabled({"PROCUREMENT_MONITOR_ENABLED": "false"})
    assert not monitor_enabled({"PROCUREMENT_LOOKUP_ENABLED": "false"})


def test_first_success_is_silent_then_only_new_content_is_notified():
    first = {"clarification": [{"id": "q", "content": "question"}], "petition": []}
    baseline, counts, errors = changes({}, first)
    assert counts == {} and errors == []
    assert changes(baseline, first)[1] == {}
    next_rows = {"clarification": [*first["clarification"], {"id": "a", "content": "answer"}],
                 "petition": [{"id": "petition"}]}
    updated, counts, errors = changes(baseline, next_rows)
    assert counts == {"clarification": 1, "petition": 1} and not errors
    assert changes(updated, next_rows)[1] == {}
    assert "question" not in str(updated)  # State persists hashes, not source content.


def test_reordering_removal_reappearance_do_not_send_again():
    a, b = {"id": "a", "files": ["one", "two"]}, {"id": "b"}
    baseline = changes({}, {"petition": [a, b]})[0]
    reordered = {"id": "a", "files": ["two", "one"]}
    assert changes(baseline, {"petition": [b, reordered]})[1] == {}
    absent = changes(baseline, {"petition": []})[0]
    assert changes(absent, {"petition": [a, b]})[1] == {}


def test_failed_category_does_not_initialize_or_erase_baseline():
    baseline, counts, errors = changes({}, {"petition": None, "clarification": []})
    assert baseline == {"clarification": []} and not counts and errors == ["petition"]
    baseline, counts, _ = changes(baseline, {"petition": [{"id": "old"}], "clarification": [{"id": "new"}]})
    assert counts == {"clarification": 1}
    assert changes(baseline, {"petition": None})[0] == baseline


@pytest.mark.parametrize("response", [None, {}, {"error": "unavailable"}, {"data": None},
                                         {"success": False, "data": []}, [None], {"data": ["invalid"]}])
def test_unknown_petition_schemas_are_not_authoritative_empty(response):
    assert petition_rows({"success": True, "response": response}) is None


@pytest.mark.parametrize("response", [[], {"data": []}, {"data": {"content": []}},
                                        [{"id": "petition"}], {"items": [{"id": "petition"}]}])
def test_explicit_petition_row_arrays(response):
    assert petition_rows({"success": True, "response": response}) is not None


def test_observed_live_petition_envelope_tracks_requests_and_resolutions():
    raw = {"biduPetitionContractorVersionDTOList": [], "biduPetitionResolutionList": []}
    source = {"success": True, "response": raw}
    assert petition_rows(source) == []
    baseline = changes({}, {"petition": petition_rows(source)})[0]
    raw["biduPetitionContractorVersionDTOList"].append({"id": "version", "content": "new"})
    raw["biduPetitionResolutionList"].append({"id": "resolution", "content": "new"})
    assert changes(baseline, {"petition": petition_rows(source)})[1] == {"petition": 2}
    del raw["biduPetitionResolutionList"]
    assert petition_rows(source) is None


def test_clarification_empty_baseline_and_answer_to_old_revision():
    bundle = {"noticeNo": NOTICE_NO, "revisionNumber": "01", "revisionId": "v1", "sources": {
        "clarification": clarification_source([], version="00"),
        "petition": {"success": True, "response": []},
    }}
    baseline = changes({}, snapshots(bundle, NOTICE_NO))[0]
    bundle["sources"]["clarification"] = clarification_source([clarification_row()], version="00")
    assert changes(baseline, snapshots(bundle, NOTICE_NO))[1] == {"clarification": 2}
    bundle["sources"]["clarification"]["response"]["biduClarifyReqInvAndContentViewVersionDTOList"] = []
    assert snapshots(bundle, NOTICE_NO)["clarification"] == []


def test_snapshot_rejects_notice_mismatch_and_preserves_failure():
    with pytest.raises(ValueError, match="MISMATCH"):
        snapshots({"noticeNo": "IB0000000000", "revisionNumber": "00"}, NOTICE_NO)
    assert snapshots({"noticeNo": NOTICE_NO, "revisionNumber": "00", "sources": {}}, NOTICE_NO) == {
        "clarification": None, "petition": None,
    }
