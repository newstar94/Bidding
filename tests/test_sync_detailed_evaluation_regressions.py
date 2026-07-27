import asyncio
import json
from types import SimpleNamespace

import pytest

from backend.sync import mapper, read_service


class _ValidationCursor:
    def __init__(self, rows):
        self.rows = rows

    def execute(self, _sql, _params=()):
        return self

    def fetchall(self):
        return list(self.rows)


def test_independent_bid_ignores_joint_venture_only_required_criterion():
    cursor = _ValidationCursor([{
        "ma_tieu_chi": "MSC_VALIDITY_2",
        "ten_tieu_chi": "",
        "ket_qua": "pending",
        "loai_nha_thau": "Độc lập",
    }])

    mapper._validate_completed_detailed_evaluation_report(
        cursor,
        "org-1",
        "round-1",
        "report-1",
    )


def test_joint_venture_bid_still_requires_joint_venture_criterion():
    cursor = _ValidationCursor([{
        "ma_tieu_chi": "MSC_VALIDITY_2",
        "ten_tieu_chi": "Thỏa thuận liên danh (đối với nhà thầu liên danh)",
        "ket_qua": "pending",
        "loai_nha_thau": "Liên danh",
    }])

    with pytest.raises(ValueError, match="Tieu chi bat buoc"):
        mapper._validate_completed_detailed_evaluation_report(
            cursor,
            "org-1",
            "round-1",
            "report-1",
        )


class _RecordCursor:
    def __init__(self):
        self.row = {
            "id": "mt-1",
            "organization_id": "org-1",
            "goi_thau_id": "gt-1",
            "archived_at": None,
        }

    def execute(self, _sql, _params=()):
        return self

    def fetchone(self):
        return self.row


class _RecordConnection:
    def __init__(self, cursor):
        self.cursor_value = cursor

    def cursor(self):
        return self.cursor_value

    def close(self):
        pass


def test_single_record_lookup_restores_opening_bid(monkeypatch):
    cursor = _RecordCursor()
    attached = []
    monkeypatch.setattr(
        read_service,
        "verify_session",
        lambda _request: (True, SimpleNamespace(user_id="user-1")),
    )
    monkeypatch.setattr(read_service, "get_active_org", lambda *_args: "org-1")
    monkeypatch.setattr(
        read_service.database,
        "get_connection",
        lambda: _RecordConnection(cursor),
    )
    monkeypatch.setattr(read_service, "can_read_table", lambda *_args: True)
    monkeypatch.setattr(read_service, "can_read_record", lambda *_args: True)
    monkeypatch.setattr(
        read_service,
        "map_db_to_json",
        lambda _table, row: {"id": row["id"], "goiThauId": row["goi_thau_id"]},
    )
    monkeypatch.setattr(
        read_service,
        "attach_child_rows_to_items",
        lambda _cursor, table, items, **_kwargs: attached.append((table, items)),
    )
    monkeypatch.setattr(
        read_service,
        "resolve_sensitive_read_policy",
        lambda *_args, **_kwargs: SimpleNamespace(),
    )
    monkeypatch.setattr(
        read_service,
        "serialize_sensitive_read_item",
        lambda _table, item, _policy: item,
    )
    request = SimpleNamespace(
        query_params={"table": "thongtinmothau", "lookup": "mt-1"},
        cookies={},
        headers={},
        state=SimpleNamespace(),
    )

    response = asyncio.run(read_service.read_single_record(request))
    payload = json.loads(response.body.decode("utf-8"))

    assert response.status_code == 200
    assert payload["item"]["id"] == "mt-1"
    assert attached == [("thong_tin_mo_thau", [payload["item"]])]
