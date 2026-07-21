from __future__ import annotations

from datetime import date, timedelta

import pytest

from backend.sync import dashboard_summary


class _DashboardCursor:
    def __init__(self):
        self.sql = ""
        self.params = ()
        self.rows = []
        self.calls = []

    def execute(self, sql, params=()):
        self.sql = " ".join(str(sql).split())
        self.params = tuple(params)
        self.calls.append((self.sql, self.params))
        if self.sql.startswith("SELECT (SELECT COUNT(*)"):
            self.rows = [tuple(range(1, len(self.params) + 1))]
        elif "SELECT COUNT(*) FROM (" in self.sql and "pc_plan" not in self.sql:
            self.rows = [(2,)]
        elif "SELECT kh.id, kh.ma_ke_hoach" in self.sql:
            self.rows = [
                ("kh-1", "KH-1", "Chưa triển khai", "2026-07-01", "", 0, 0, 0),
                ("kh-2", "KH-2", "Đang thực hiện", "2026-07-15", "", 2, 1, 1),
                ("kh-3", "KH-3", "Hoàn thành", None, "published", 1, 1, 0),
            ]
        elif "status_name, COUNT(*) AS total" in self.sql:
            self.rows = [("INVITED", 2), ("AWARDED", 1)]
        elif "ORDER BY COALESCE(updated_at, created_at) DESC" in self.sql:
            self.rows = [{"id": "gt-recent", "trang_thai": "INVITED"}]
        elif "alert_packages AS" in self.sql:
            self.rows = [
                {
                    "id": "gt-delay",
                    "alert_key": "delayedEvaluation",
                    "thoi_gian_mo_thau": "2026-07-01",
                    "thoi_gian_dong_thau": "2026-06-30",
                },
                {
                    "id": "gt-soon",
                    "alert_key": "closingSoon",
                    "thoi_gian_dong_thau": "2026-07-20",
                },
            ]
        elif "UNION ALL" in self.sql and "visible_packages" in self.sql:
            self.rows = [
                ("closingToday", 1),
                ("closingSoon", 2),
                ("overdueOpening", 3),
                ("delayedEvaluation", 4),
            ]
        elif "SELECT id, gia_tri, trang_thai_hop_dong" in self.sql or (
            "SELECT hd.id, hd.gia_tri" in self.sql
        ):
            self.rows = [
                ("hd-1", 100, "ACTIVE"),
                ("hd-2", 50, "SUSPENDED"),
                ("hd-3", 20, "CANCELLED"),
                ("hd-4", 30, "NOT_EFFECTIVE"),
            ]
        elif "SELECT hd.id, hd.so_hop_dong" in self.sql:
            self.rows = [
                ("hd-expired", "HD-1", "Hết hạn", "2026-07-01", "10 ngày", "ACTIVE", "", ""),
                ("hd-soon", "HD-2", "Sắp hết hạn", "2026-07-18", "2 ngày", "ACTIVE", "", "Đã xuất hóa đơn"),
                ("hd-future", "HD-3", "Còn hạn", "2026-07-18", "30 ngày", "ACTIVE", "", ""),
                ("hd-no-date", "HD-4", "Không ngày", "", "10 ngày", "ACTIVE", "", ""),
                ("hd-done", "HD-5", "Đủ hồ sơ", "2026-07-01", "10 ngày", "COMPLETED", "2026-07-10", "Hóa đơn đã xuất"),
            ]
        elif "SELECT COUNT(*), COUNT(*)" in self.sql:
            self.rows = [(2, 2)]
        else:
            self.rows = []
        return self

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return list(self.rows)


def test_dashboard_date_contract_and_alert_helpers_cover_edge_cases():
    assert dashboard_summary._parse_iso_date(None) is None
    assert dashboard_summary._parse_iso_date("2026-07-19T10:00:00") == date(2026, 7, 19)
    assert dashboard_summary._parse_iso_date("19/07/2026") == date(2026, 7, 19)
    assert dashboard_summary._parse_iso_date("invalid") is None

    start = date(2026, 7, 17)
    end = date(2026, 7, 20)
    holidays = {"weekends": [5, 6], "holidays": []}
    assert dashboard_summary._business_days_elapsed(None, end, holidays) == 0
    assert dashboard_summary._business_days_elapsed(end, start, holidays) == 0
    assert dashboard_summary._business_days_elapsed(start, end, holidays) == 1
    assert dashboard_summary._add_business_days(start, 1, holidays) == date(2026, 7, 20)
    assert dashboard_summary._normalize_search_text("Đã LẬP hóa đơn") == "da lap hoa don"

    assert dashboard_summary._contract_expiry_date(None, "1 ngày") is None
    assert dashboard_summary._contract_expiry_date(start, "không rõ") is None
    assert dashboard_summary._contract_expiry_date(start, "0 ngày") is None
    assert dashboard_summary._contract_expiry_date(date(2024, 1, 31), "1 tháng") == date(2024, 2, 29)
    assert dashboard_summary._contract_expiry_date(date(2024, 2, 29), "1 năm") == date(2025, 2, 28)
    assert dashboard_summary._contract_expiry_date(start, "2 tuần") == start + timedelta(days=14)
    assert dashboard_summary._contract_expiry_date(start, "2,9 ngày") == start + timedelta(days=2)

    items = [
        {"targetType": "package", "alertKey": "closingSoon", "deadline": "3", "id": "p"},
        {"targetType": "plan", "alertKey": "planPublishingOverdue", "deadline": "2", "id": "kh"},
        {"targetType": "contract", "alertKey": "contractExpired", "deadline": "1", "id": "hd"},
        {"targetType": "other", "alertKey": "unknown", "deadline": "4", "id": "x"},
    ]
    selected = dashboard_summary._select_alert_items(items, limit=4)
    assert {item["id"] for item in selected} == {"p", "kh", "hd", "x"}
    assert dashboard_summary._select_alert_items([], limit=1) == []


@pytest.mark.parametrize("manager", [True, False])
def test_dashboard_summary_projects_manager_and_employee_paths(monkeypatch, manager):
    cursor = _DashboardCursor()
    monkeypatch.setattr(dashboard_summary, "is_organization_manager", lambda *_args: manager)
    monkeypatch.setattr(dashboard_summary, "can_read_table", lambda *_args: True)
    monkeypatch.setattr(dashboard_summary, "vietnam_today", lambda: date(2026, 7, 19))
    monkeypatch.setattr(
        dashboard_summary,
        "_business_days_elapsed",
        lambda approval, _today: 6 if approval and approval.day == 1 else 4,
    )
    monkeypatch.setattr(
        dashboard_summary,
        "_add_business_days",
        lambda approval, days: approval + timedelta(days=days),
    )
    monkeypatch.setattr(
        dashboard_summary,
        "enum_label",
        lambda table, column, value: {
            "INVITED": "Đang mời thầu",
            "AWARDED": "Đã trao thầu",
            "ACTIVE": "Đang thực hiện",
            "SUSPENDED": "Tạm dừng",
            "CANCELLED": "Đã hủy",
            "NOT_EFFECTIVE": "Chưa hiệu lực",
        }.get(value, value),
    )
    monkeypatch.setattr(
        dashboard_summary,
        "map_db_to_json",
        lambda _table, row: {
            "id": row.get("id"),
            "thoiGianMoThau": row.get("thoi_gian_mo_thau"),
            "thoiGianDongThau": row.get("thoi_gian_dong_thau"),
        },
    )

    result = dashboard_summary.build_dashboard_summary(
        cursor,
        "org-1",
        "manager" if manager else "employee",
        "user-1",
    )
    assert result["counts"]["kehoach"] == 3
    assert result["planStatusCounts"] == {
        "Chưa triển khai": 1,
        "Đang thực hiện": 1,
        "Hoàn thành": 1,
    }
    assert result["counts"]["goithau"] == 3
    assert result["counts"]["activeGoithau"] == 2
    assert result["counts"]["hopdong"] == 4
    assert result["totalContractValue"] == "200"
    assert result["totalContractValueAll"] == "200"
    assert result["counts"]["assignedHopdong"] == 2
    assert result["counts"]["activeAssignedHopdong"] == 2
    assert result["alertCounts"]["planPublishingOverdue"] == 1
    assert result["alertCounts"]["planPublishingWarning"] == 1
    assert result["alertCounts"]["contractExpired"] == 1
    assert result["alertCounts"]["contractExpiring"] == 1
    assert result["recentPackages"][0]["id"] == "gt-recent"
    assert any(item.get("id") == "gt-delay" for item in result["alertItems"])
    if not manager:
        assert any("pc_plan" in sql for sql, _params in cursor.calls)
        assert any(params and "user-1" in params for _sql, params in cursor.calls)


def test_dashboard_summary_returns_zero_projection_when_access_is_denied(monkeypatch):
    cursor = _DashboardCursor()
    monkeypatch.setattr(dashboard_summary, "is_organization_manager", lambda *_args: False)
    monkeypatch.setattr(dashboard_summary, "can_read_table", lambda *_args: False)
    result = dashboard_summary.build_dashboard_summary(
        cursor,
        "org-1",
        "employee",
        "user-1",
    )
    assert not cursor.calls
    assert all(value == 0 for value in result["counts"].values())
    assert result["recentPackages"] == []
    assert result["alertItems"] == []
