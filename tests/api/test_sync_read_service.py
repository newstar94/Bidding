import json
import sqlite3
from datetime import date, timedelta

import pytest

from backend.app import app  # noqa: F401 - initializes backend import paths
import backend.sync.read_service as read_service
import backend.sync.dashboard_summary as dashboard_summary


class _Request:
    def __init__(self, query_params=None):
        self.query_params = query_params or {}


class _Role:
    user_id = "user-1"

    def __str__(self):
        return "super_admin"


class _Cursor:
    def execute(self, *_args, **_kwargs):
        return self

    def fetchall(self):
        return []

    def fetchone(self):
        return None


class _Connection:
    def cursor(self):
        return _Cursor()

    def close(self):
        return None

    def rollback(self):
        return None


@pytest.mark.anyio
async def test_sync_read_rejects_invalid_session_without_raising(monkeypatch):
    monkeypatch.setattr(read_service, "verify_session", lambda _request: (False, "Phiên hết hạn"))

    response = await read_service.read_sync_data(_Request())

    assert response.status_code == 403
    assert json.loads(response.body)["error"] == "Phiên hết hạn"


@pytest.mark.anyio
async def test_delta_sync_read_returns_response_and_server_timing(monkeypatch):
    monkeypatch.setattr(read_service, "verify_session", lambda _request: (True, _Role()))
    monkeypatch.setattr(read_service.database, "get_connection", lambda: _Connection())
    monkeypatch.setattr(read_service, "get_active_org", lambda _request, _user_id: "org-1")
    monkeypatch.setattr(read_service, "attach_child_rows_to_items", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(read_service, "_get_expert_relations_for_packages", lambda *_args: {})
    monkeypatch.setattr(read_service, "_get_contract_package_ids", lambda *_args: {})
    monkeypatch.setattr(read_service, "filter_items_for_read", lambda *_args: _args[-1])
    monkeypatch.setattr(read_service, "get_current_sync_version", lambda *_args: 0)

    response = await read_service.read_sync_data(_Request({"after_version": "0"}))
    payload = json.loads(response.body)

    assert response.status_code == 200
    assert payload["syncVersion"] == 0
    assert "giaGoiThau" in payload["domainContract"]["packageFieldPolicy"]["lockedAfterInvitation"]
    assert response.headers["Server-Timing"].startswith("sync-read;dur=")


def test_sync_read_reference_mapper_is_available():
    assert read_service.json_key_for_column("nha_thau", "ma_nha_thau") == "maNhaThau"


def test_dashboard_summary_maps_recent_packages(monkeypatch):
    class _DashboardCursor:
        def __init__(self):
            self.sql = ""

        def execute(self, sql, _params=()):
            self.sql = sql
            return self

        def fetchone(self):
            return (1,)

        def fetchall(self):
            if "LIMIT 4" in self.sql:
                return [{"id": "gt-1", "organization_id": "org-1"}]
            if "GROUP BY" in self.sql:
                return [("Đang mời thầu", 1)]
            return []

    monkeypatch.setattr(
        dashboard_summary,
        "can_read_table",
        lambda _cursor, _role, _user, _owner, _payload, table: table == "goi_thau",
    )
    monkeypatch.setattr(
        dashboard_summary,
        "is_organization_manager",
        lambda _cursor, _role, _user, _owner: True,
    )
    monkeypatch.setattr(
        dashboard_summary,
        "map_db_to_json",
        lambda table, row: {"table": table, "id": row["id"]},
    )

    result = dashboard_summary.build_dashboard_summary(
        _DashboardCursor(),
        "org-1",
        "super_admin",
        "user-1",
    )

    assert result["counts"]["goithau"] == 1
    assert result["recentPackages"] == [{"table": "goi_thau", "id": "gt-1"}]


def test_dashboard_includes_completed_contracts_but_excludes_cancelled_and_not_effective(monkeypatch):
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    cursor = connection.cursor()
    cursor.execute("""CREATE TABLE hop_dong (
        id TEXT, organization_id TEXT, id_goc TEXT, phien_ban INTEGER,
        updated_at TEXT, created_at TEXT, archived_at TEXT, is_latest INTEGER,
        gia_tri INTEGER, trang_thai_hop_dong TEXT, so_hop_dong TEXT,
        ten_hop_dong TEXT, ngay_ky TEXT, thoi_gian_thuc_hien TEXT,
        ngay_thanh_ly TEXT, trang_thai_ho_so TEXT
    )""")
    cursor.execute("""CREATE TABLE phan_cong_nhan_su (
        organization_id TEXT, id_nhan_vien TEXT, id_muc_tieu TEXT, loai_doi_tuong TEXT
    )""")
    signed_at = (date.today() - timedelta(days=80)).isoformat()
    cursor.executemany(
        """INSERT INTO hop_dong (
            id, organization_id, id_goc, phien_ban, updated_at, created_at,
            archived_at, is_latest, gia_tri, trang_thai_hop_dong, so_hop_dong,
            ten_hop_dong, ngay_ky, thoi_gian_thuc_hien, ngay_thanh_ly, trang_thai_ho_so
        ) VALUES (?, 'org-1', ?, 0, '', '', NULL, 1, ?, ?, ?, ?, ?, ?, '', '')""",
        [
            ("hd-active", "hd-active", 100, "ACTIVE", "01/HĐ", "Hợp đồng sắp hết hạn", signed_at, "90 ngày"),
            ("hd-complete", "hd-complete", 200, "COMPLETED", "02/HĐ", "Hợp đồng hoàn thành", "", ""),
            ("hd-liquidated", "hd-liquidated", 300, "LIQUIDATED", "03/HĐ", "Hợp đồng thanh lý", "", ""),
            ("hd-cancelled", "hd-cancelled", 400, "CANCELLED", "04/HĐ", "Hợp đồng hủy", "", ""),
            ("hd-future", "hd-future", 500, "NOT_EFFECTIVE", "05/HĐ", "Hợp đồng chưa hiệu lực", "", ""),
        ],
    )
    cursor.executemany(
        "INSERT INTO phan_cong_nhan_su VALUES ('org-1', 'user-1', ?, 'hopdong')",
        [("hd-active",), ("hd-complete",), ("hd-liquidated",), ("hd-cancelled",), ("hd-future",)],
    )
    monkeypatch.setattr(dashboard_summary, "is_organization_manager", lambda *_args: True)
    monkeypatch.setattr(
        dashboard_summary,
        "can_read_table",
        lambda _cursor, _role, _user, _owner, _payload, table: table == "hop_dong",
    )

    result = dashboard_summary.build_dashboard_summary(cursor, "org-1", "super_admin", "user-1")

    assert result["counts"]["hopdong"] == 3
    assert result["counts"]["assignedHopdong"] == 3
    assert result["counts"]["activeAssignedHopdong"] == 1
    assert result["totalContractValue"] == "600"
    assert result["contractTotalCount"] == 5
    assert result["totalContractValueAll"] == "1500"
    assert result["contractStatusCounts"] == {
        "Đang thực hiện": 1,
        "Đã hoàn thành": 1,
        "Đã thanh lý": 1,
        "Đã hủy": 1,
        "Chưa hiệu lực": 1,
    }
    assert result["contractValueByStatus"]["Đang thực hiện"] == "100"
    assert result["contractValueByStatus"]["Đã hủy"] == "400"
    assert result["alertCounts"]["contractExpiring"] == 1
    assert result["alertItems"][0]["targetType"] == "contract"
    assert result["alertItems"][0]["alertDetail"] == "Chưa xuất hóa đơn · Chưa thanh lý"


def test_dashboard_business_day_counter_excludes_weekends():
    approval = dashboard_summary._parse_iso_date("2026-07-13")

    assert dashboard_summary._business_days_elapsed(approval, dashboard_summary._parse_iso_date("2026-07-16")) == 3
    assert dashboard_summary._business_days_elapsed(approval, dashboard_summary._parse_iso_date("2026-07-20")) == 5
    assert dashboard_summary._business_days_elapsed(approval, dashboard_summary._parse_iso_date("2026-07-21")) == 6
    assert dashboard_summary._add_business_days(approval, 5).isoformat() == "2026-07-20"

    holiday_window = {"2026": {"holidays": ["2026-04-27", "2026-04-30"], "working_weekends": []}}
    holiday_approval = dashboard_summary._parse_iso_date("2026-04-24")
    holiday_end = dashboard_summary._parse_iso_date("2026-04-30")
    assert dashboard_summary._business_days_elapsed(holiday_approval, holiday_end, holiday_window) == 2


def test_dashboard_contract_duration_supports_days_months_and_years():
    signed_at = date(2026, 1, 31)

    assert dashboard_summary._contract_expiry_date(signed_at, "90 ngày") == date(2026, 5, 1)
    assert dashboard_summary._contract_expiry_date(signed_at, "1 tháng") == date(2026, 2, 28)
    assert dashboard_summary._contract_expiry_date(date(2024, 2, 29), "1 năm") == date(2025, 2, 28)
    assert dashboard_summary._contract_has_invoice("Đã xuất hóa đơn") is True
