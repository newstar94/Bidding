"""ADR 0103: bid-validity and overdue-milestone dashboard alerts."""

from datetime import date, datetime
from pathlib import Path
import re

import pytest

from backend.documents import timeline_context_service
from backend.sync import dashboard_summary
from backend.sync.deadline_alerts import (
    BID_VALIDITY_WARNING_DAYS,
    bid_validity_alert,
    bid_validity_deadline,
    bid_validity_detail,
    latest_closing_datetime,
    milestone_overdue_detail,
    overdue_milestones,
    timeline_row_is_overdue,
    validity_last_day,
)

ROOT = Path(__file__).resolve().parents[1]
TODAY = date(2026, 11, 14)


def test_closing_day_counts_as_day_one():
    assert validity_last_day("2026-03-01 09:00", 90) == date(2026, 5, 29)
    assert validity_last_day("01/03/2026 09:00", 1) == date(2026, 3, 1)


@pytest.mark.parametrize("days", [None, "", 0, -5, "abc"])
def test_missing_or_invalid_validity_has_no_deadline(days):
    assert validity_last_day("2026-03-01 09:00", days) is None


def test_missing_closing_time_has_no_deadline():
    assert validity_last_day(None, 90) is None


def test_deadline_is_the_earlier_of_bid_and_security_validity():
    assert bid_validity_deadline("2026-03-01 09:00", 90, 120) == date(2026, 5, 29)
    assert bid_validity_deadline("2026-03-01 09:00", 0, 30) == date(2026, 3, 30)
    assert bid_validity_deadline("2026-03-01 09:00", None, None) is None


def test_latest_extension_moves_the_closing_time():
    closing = latest_closing_datetime("2026-03-01 09:00", ("2026-03-10 09:00", None, ""))
    assert closing == datetime(2026, 3, 10, 9, 0)
    assert latest_closing_datetime(None, ()) is None


def test_timezone_aware_closing_time_uses_vietnam_calendar_day():
    # 2026-03-01 18:00 UTC is already 2 March in Vietnam.
    assert validity_last_day("2026-03-01T18:00:00+00:00", 1) == date(2026, 3, 2)


@pytest.mark.parametrize("status", ["OPENED", "EVALUATING", "PARTIALLY_AWARDED"])
def test_alert_applies_while_bids_are_evaluated(status):
    closing = "2026-08-23 09:00"  # 90 days -> last valid day 2026-11-20
    assert bid_validity_alert(status, closing, 90, None, TODAY) == (date(2026, 11, 20), 6)


@pytest.mark.parametrize("status", ["PREPARING", "INVITED", "AWARDED", "CANCELLED", "", None])
def test_alert_ignores_packages_outside_evaluation(status):
    assert bid_validity_alert(status, "2026-08-23 09:00", 90, None, TODAY) is None


def test_alert_window_boundary_and_expired_bids():
    window_end = "2026-08-25 09:00"  # last valid day 2026-11-22 = today + 8
    assert bid_validity_alert("OPENED", window_end, 90, None, TODAY) is None
    on_boundary = "2026-08-24 09:00"  # last valid day 2026-11-21 = today + 7
    assert bid_validity_alert("OPENED", on_boundary, 90, None, TODAY) == (date(2026, 11, 21), BID_VALIDITY_WARNING_DAYS)
    expired = "2026-08-01 09:00"
    assert bid_validity_alert("OPENED", expired, 90, None, TODAY)[1] < 0


def test_validity_detail_text():
    assert bid_validity_detail(3) == "Còn 3 ngày hiệu lực"
    assert bid_validity_detail(0) == "Hết hiệu lực trong hôm nay"
    assert bid_validity_detail(-2) == "Đã hết hiệu lực 2 ngày"


def _row(**overrides):
    row = {
        "applicability": "APPLICABLE",
        "ngay_du_kien": "2026-11-10",
        "ngay_thuc_te": "",
        "trang_thai": "PENDING",
        "title": "Báo cáo đánh giá E-HSDT",
    }
    row.update(overrides)
    return row


def test_overdue_rule_matches_word_timeline_rule():
    assert timeline_row_is_overdue(_row(), TODAY) is True
    assert timeline_row_is_overdue(_row(ngay_du_kien="2026-11-14"), TODAY) is False
    assert timeline_row_is_overdue(_row(ngay_thuc_te="2026-11-12"), TODAY) is False
    assert timeline_row_is_overdue(_row(trang_thai="DONE"), TODAY) is False
    assert timeline_row_is_overdue(_row(applicability="CONDITIONAL"), TODAY) is False
    assert timeline_row_is_overdue(_row(ngay_du_kien=""), TODAY) is False


def test_word_timeline_projection_uses_the_shared_rule(monkeypatch):
    monkeypatch.setattr(timeline_context_service, "vietnam_today", lambda: TODAY)
    assert timeline_context_service._project_item(_row())["is_overdue"] is True
    assert timeline_context_service._project_item(_row(trang_thai="DONE"))["is_overdue"] is False


def test_overdue_milestones_are_sorted_and_summarized():
    rows = [
        _row(title="B", ngay_du_kien="2026-11-12"),
        _row(title="A", ngay_du_kien="2026-11-01"),
        _row(title="Done", trang_thai="DONE"),
    ]
    overdue = overdue_milestones(rows, TODAY)
    assert [row["title"] for row in overdue] == ["A", "B"]
    assert milestone_overdue_detail(overdue) == "A và 1 mốc khác"
    assert milestone_overdue_detail(overdue[:1]) == "A"
    assert milestone_overdue_detail([]) == ""


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows
        self.queries = []

    def execute(self, sql, params=()):
        self.queries.append((sql, tuple(params)))
        return self

    def fetchall(self):
        return list(self.rows)


def test_validity_items_use_latest_extension_and_visible_scope():
    cursor = FakeCursor([
        ("pkg-1", "TBMT-1", "Gói 1", "EVALUATING", "2026-08-01 09:00", 90, 0, "2026-08-20 09:00"),
        ("pkg-2", "TBMT-2", "Gói 2", "EVALUATING", "2026-10-01 09:00", 90, 0, None),
    ])
    items = dashboard_summary._bid_validity_alert_items(cursor, "SELECT 1", ["org-1", "user-1"], TODAY)
    assert cursor.queries[0][1] == ("org-1", "user-1")
    assert "visible_packages" in cursor.queries[0][0]
    assert items == [{
        "targetType": "package",
        "id": "pkg-1",
        "maGoiThau": "TBMT-1",
        "tenGoiThau": "Gói 1",
        "deadline": "2026-11-17",
        "alertKey": "bidValidityExpiring",
        "alertDetail": "Còn 3 ngày hiệu lực",
    }]


def test_milestone_items_confirm_candidates_with_effective_timeline(monkeypatch):
    cursor = FakeCursor([("pkg-1", "TBMT-1", "Gói 1"), ("pkg-2", "TBMT-2", "Gói 2")])
    effective = {
        "pkg-1": [_row(title="QĐ phê duyệt E-HSMT", ngay_du_kien="2026-11-03")],
        # Stored row looked overdue, but the automatic source filled the date.
        "pkg-2": [_row(ngay_thuc_te="2026-11-05", trang_thai="DONE")],
    }
    monkeypatch.setattr(
        timeline_context_service,
        "load_effective_timeline_rows",
        lambda _cursor, organization_id, package_id: effective[package_id],
    )
    items, partial = dashboard_summary._milestone_overdue_alert_items(
        cursor, "org-1", "SELECT 1", ["org-1"], TODAY
    )
    assert partial is False
    assert cursor.queries[0][1] == ("org-1", dashboard_summary.MILESTONE_ALERT_CANDIDATE_LIMIT + 1)
    assert "CANCELLED" in cursor.queries[0][0]
    assert items == [{
        "targetType": "package",
        "id": "pkg-1",
        "maGoiThau": "TBMT-1",
        "tenGoiThau": "Gói 1",
        "deadline": "2026-11-03",
        "alertKey": "milestoneOverdue",
        "alertDetail": "QĐ phê duyệt E-HSMT",
    }]


def test_milestone_candidates_beyond_the_cap_are_reported_partial(monkeypatch):
    monkeypatch.setattr(dashboard_summary, "MILESTONE_ALERT_CANDIDATE_LIMIT", 1)
    monkeypatch.setattr(
        timeline_context_service,
        "load_effective_timeline_rows",
        lambda *_args: [_row()],
    )
    cursor = FakeCursor([("pkg-1", "A", "A"), ("pkg-2", "B", "B")])
    items, partial = dashboard_summary._milestone_overdue_alert_items(cursor, "org-1", "SELECT 1", ["org-1"], TODAY)
    assert partial is True
    assert [item["id"] for item in items] == ["pkg-1"]


def test_new_alerts_rank_between_existing_alerts():
    priority = dashboard_summary.ALERT_PRIORITY
    assert priority["planPublishingOverdue"] < priority["bidValidityExpiring"] < priority["closingToday"]
    assert priority["delayedEvaluation"] < priority["milestoneOverdue"] < priority["contractExpiring"]
    assert set(priority) == set(dashboard_summary.ALERT_COUNT_KEYS)


def test_browser_rules_cover_every_server_alert_and_share_the_window():
    source = (ROOT / "frontend" / "app" / "dashboardAlertRules.js").read_text(encoding="utf-8")
    meta_block = source.split("export const ALERT_META = {", 1)[1].split("\n};", 1)[0]
    browser_keys = set(re.findall(r"^\s+(\w+): \{ label:", meta_block, flags=re.MULTILINE))
    assert browser_keys == set(dashboard_summary.ALERT_COUNT_KEYS)
    browser_priority = re.search(r"const ALERT_PRIORITY = \[([^\]]+)\]", source).group(1)
    ordered = re.findall(r'"(\w+)"', browser_priority)
    assert ordered == sorted(dashboard_summary.ALERT_PRIORITY, key=dashboard_summary.ALERT_PRIORITY.get)
    window = re.search(r"export const BID_VALIDITY_WARNING_DAYS = (\d+);", source).group(1)
    assert int(window) == BID_VALIDITY_WARNING_DAYS
