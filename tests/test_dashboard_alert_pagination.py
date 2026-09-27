"""Dashboard alert drilldowns must use the summary's official package status."""

import json
import os
from types import SimpleNamespace
import uuid

import psycopg
import pytest

from backend.sync import pagination
from backend.sync.dashboard_summary import _effective_package_rows_sql, package_alert_conditions
from backend.sync.visibility_scope import SqlPredicate


class RecordingCursor:
    def __init__(self):
        self.queries = []

    def execute(self, sql, params=()):
        self.queries.append((sql, tuple(params)))
        return self

    def fetchone(self):
        return (0,)

    def fetchall(self):
        return []


@pytest.mark.parametrize("alert_key", tuple(package_alert_conditions()))
def test_dashboard_alert_list_uses_summary_projection(monkeypatch, alert_key):
    cursor = RecordingCursor()
    connection = SimpleNamespace(cursor=lambda: cursor, close=lambda: None)
    monkeypatch.setattr(pagination, "verify_session", lambda _request: (True, SimpleNamespace(user_id="user-1")))
    monkeypatch.setattr(pagination, "get_active_org", lambda *_args, **_kwargs: "org-1")
    monkeypatch.setattr(pagination, "can_read_table", lambda *_args: True)
    monkeypatch.setattr(pagination, "resolve_sensitive_read_policy", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(pagination, "serialize_sensitive_read_items", lambda _table, items, _policy: items)
    monkeypatch.setattr(pagination, "database", SimpleNamespace(get_connection=lambda: connection))
    monkeypatch.setattr(
        pagination.VisibilityScope,
        "resolve",
        classmethod(lambda cls, *_args: SimpleNamespace(
            live_predicate=lambda _table, _alias: SqlPredicate("goi_thau.organization_id = ?", ("org-1",)),
        )),
    )
    request = SimpleNamespace(
        query_params={"table": "goithau", "alertKey": alert_key, "page": "1"},
        cookies={"session_token": "test"},
    )

    response = pagination._paginate_records_blocking(request)

    assert response.status_code == 200
    assert json.loads(response.body)["totalItems"] == 0
    assert len(cursor.queries) == 2
    for sql, parameters in cursor.queries:
        assert "effective_status" in sql
        assert package_alert_conditions("goi_thau")[alert_key] in sql
        assert "goi_thau.organization_id = ?" in sql
        assert parameters[:2] == ("org-1", "org-1")


def test_official_result_removes_raw_opened_package_from_delayed_alert():
    url = str(os.environ.get("TEST_DATABASE_URL") or "").strip()
    if not url:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL alert test")
    organization_id = f"dashboard-{uuid.uuid4().hex}"
    plan_id = f"plan-{organization_id}"
    investor_id = f"investor-{organization_id}"
    with psycopg.connect(url, connect_timeout=5) as connection:
        try:
            connection.execute(
                "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (%s, %s)",
                (organization_id, "Dashboard test"),
            )
            connection.execute(
                """INSERT INTO chu_dau_tu (id, organization_id, ten_chu_dau_tu)
                   VALUES (%s, %s, %s)""",
                (investor_id, organization_id, "Investor"),
            )
            connection.execute(
                """INSERT INTO ke_hoach_lcnt
                       (id, organization_id, chu_dau_tu_id, loai_hinh_mua_sam,
                        ngay_phe_duyet, quyet_dinh_phe_duyet, ten_ke_hoach, ma_ke_hoach)
                   VALUES (%s, %s, %s, %s, CURRENT_DATE, %s, %s, %s)""",
                (plan_id, organization_id, investor_id, "Mua sắm", "QD", "Plan", "PL"),
            )
            for suffix, has_official_result in (("official", True), ("pending", False)):
                connection.execute(
                    """INSERT INTO goi_thau
                           (id, organization_id, ke_hoach_id, gia_goi_thau,
                            nguon_von, ten_goi_thau, thoi_gian_bat_dau_to_chuc,
                            thoi_gian_thuc_hien, thoi_gian_to_chuc, trang_thai,
                            thoi_gian_mo_thau, thoi_gian_dong_thau,
                            so_quyet_dinh_ket_qua, ngay_quyet_dinh_ket_qua,
                            gia_trung_thau, phan_lo)
                       VALUES (%s, %s, %s, 100, 'Nguồn', 'Gói', '2026',
                               '1 ngày', '2026', 'OPENED',
                               CURRENT_TIMESTAMP - INTERVAL '10 days',
                               CURRENT_TIMESTAMP - INTERVAL '10 days',
                               %s, %s, %s, %s)""",
                    (
                        f"{suffix}-{organization_id}", organization_id, plan_id,
                        "QĐ" if has_official_result else None,
                        "2026-01-01" if has_official_result else None,
                        90 if has_official_result else None,
                        "Có" if has_official_result else "Không",
                    ),
                )
            projected = _effective_package_rows_sql(
                "SELECT * FROM goi_thau WHERE organization_id = %s"
            )
            condition = package_alert_conditions("vp")["delayedEvaluation"]
            rows = connection.execute(
                "SELECT id FROM (" + projected + ") vp WHERE " + condition,  # noqa: S608 - fixed projection and condition
                (organization_id,),
            ).fetchall()
            assert rows == [(f"pending-{organization_id}",)]
        finally:
            connection.rollback()
