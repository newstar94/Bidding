import asyncio
import json
from types import SimpleNamespace

from backend.sync import read_service


class _VersionedRecordCursor:
    def __init__(self):
        self._query = ""

    def execute(self, sql, _params=()):
        self._query = sql
        return self

    def fetchone(self):
        return {
            "id": "plan-v01",
            "id_goc": "plan-root",
            "organization_id": "org-1",
            "ma_ke_hoach": "KH-01",
            "phien_ban": "01",
            "is_latest": 1,
            "archived_at": None,
        }

    def fetchall(self):
        if "SELECT id, phien_ban" not in self._query:
            return []
        return [
            ("plan-v01", "01"),
            ("plan-v00", "00"),
        ]


class _Connection:
    def __init__(self, cursor):
        self._cursor = cursor

    def cursor(self):
        return self._cursor

    def close(self):
        pass


def test_single_record_lookup_includes_version_family_metadata(monkeypatch):
    cursor = _VersionedRecordCursor()
    monkeypatch.setattr(
        read_service,
        "verify_session",
        lambda _request: (True, SimpleNamespace(user_id="user-1")),
    )
    monkeypatch.setattr(read_service, "get_active_org", lambda *_args: "org-1")
    monkeypatch.setattr(
        read_service.database,
        "get_connection",
        lambda: _Connection(cursor),
    )
    monkeypatch.setattr(read_service, "can_read_table", lambda *_args: True)
    monkeypatch.setattr(read_service, "can_read_record", lambda *_args: True)
    monkeypatch.setattr(
        read_service,
        "map_db_to_json",
        lambda _table, row: {
            "id": row["id"],
            "rootId": row["id_goc"],
            "phienBan": row["phien_ban"],
        },
    )
    monkeypatch.setattr(read_service, "attach_child_rows_to_items", lambda *_args, **_kwargs: None)
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
        query_params={"table": "kehoach", "lookup": "plan-v01"},
        cookies={},
        headers={},
        state=SimpleNamespace(),
    )

    response = asyncio.run(read_service.read_single_record(request))
    payload = json.loads(response.body.decode("utf-8"))

    assert response.status_code == 200
    assert payload["item"]["allVersions"] == [
        {"id": "plan-v01", "phienBan": "01"},
        {"id": "plan-v00", "phienBan": "00"},
    ]


def test_single_record_lookup_supports_historical_expert(monkeypatch):
    cursor = _VersionedRecordCursor()
    cursor.fetchone = lambda: {
        "id": "expert-v00",
        "id_goc": "expert-root",
        "organization_id": "org-1",
        "ho_ten": "Chuyên gia lịch sử",
        "so_chung_chi": "CC-00",
        "phien_ban": "00",
        "is_latest": 0,
        "anh_chung_chi": "cert.png",
        "anh_chu_ky": "signature.png",
        "archived_at": None,
    }
    monkeypatch.setattr(
        read_service,
        "verify_session",
        lambda _request: (True, SimpleNamespace(user_id="user-1")),
    )
    monkeypatch.setattr(read_service, "get_active_org", lambda *_args: "org-1")
    monkeypatch.setattr(
        read_service.database,
        "get_connection",
        lambda: _Connection(cursor),
    )
    monkeypatch.setattr(read_service, "can_read_table", lambda *_args: True)
    monkeypatch.setattr(read_service, "can_read_record", lambda *_args: True)
    monkeypatch.setattr(
        read_service,
        "map_db_to_json",
        lambda _table, row: {
            "id": row["id"],
            "rootId": row["id_goc"],
            "hoTen": row["ho_ten"],
            "phienBan": row["phien_ban"],
            "anhChungChi": row["anh_chung_chi"],
            "anhChuKy": row["anh_chu_ky"],
        },
    )
    monkeypatch.setattr(
        read_service,
        "public_image_path",
        lambda value, **_kwargs: f"/protected/{value}",
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
        query_params={"table": "chuyengia", "lookup": "expert-v00"},
        cookies={"session_token": "session"},
        headers={},
        state=SimpleNamespace(),
    )

    response = asyncio.run(read_service.read_single_record(request))
    payload = json.loads(response.body.decode("utf-8"))

    assert response.status_code == 200
    assert payload["item"]["id"] == "expert-v00"
    assert payload["item"]["anhChungChi"] == "/protected/cert.png"
    assert payload["item"]["anhChuKy"] == "/protected/signature.png"
