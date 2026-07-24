import asyncio
import json
import re
from types import SimpleNamespace

import pytest
from starlette.responses import JSONResponse

from backend.db.db_helper import DatabaseError
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError
from backend.shared.helpers import OrgPermissionError
from backend.sync import read_service


def _body(response):
    return json.loads(response.body.decode("utf-8"))


class _Role(str):
    def __new__(cls, value="employee", user_id="user-1"):
        instance = super().__new__(cls, value)
        instance.user_id = user_id
        return instance


class _Request:
    def __init__(self, query=None):
        self.query_params = query or {}
        self.cookies = {"session_token": "session-token"}
        self.headers = {"X-Active-Org": "org-1"}
        self.path_params = {}
        self.state = SimpleNamespace()
        self.method = "GET"
        self.url = SimpleNamespace(path="/api/get-all-data")


def _table_row(table):
    rows = {
        "chu_dau_tu": {"id": "cdt-1", "anh_dau": "stamp.png"},
        "ke_hoach_lcnt": {
            "id": "kh-1", "cvDaThucHienList": None,
            "cvKhongApDungList": None, "cvChuaDuDieuKienList": None,
        },
        "goi_thau": {
            "id": "gt-1", "phanLoList": None, "tuyChonMuaThemList": None,
            "awardedPhanLoList": None, "giaHanList": None,
            "yeuCauLamRoList": None, "traLoiLamRoList": None,
        },
        "chuyen_gia": {"id": "cg-1", "anh_chung_chi": "cert.png", "anh_chu_ky": "sig.png"},
        "nha_thau": {"id": "nt-1", "anh_dau": "stamp.png"},
        "danh_muc_trang_thai_hop_dong": {"id": "status-1"},
        "hop_dong": {"id": "hd-1"},
        "phan_cong_nhan_su": {"id": "assignment-1"},
        "thong_tin_mo_thau": {"id": "ttmt-1"},
        "ma_tran_phan_quyen": {"id": "perm-1"},
    }
    return dict(rows[table])


class _SyncCursor:
    def __init__(self, *, metadata=(10, 0), record_row=None, permission_error=False):
        self.metadata = metadata
        self.record_row = record_row
        self.permission_error = permission_error
        self.last_sql = ""
        self.last_params = ()
        self.calls = []

    def execute(self, sql, params=()):
        self.last_sql = " ".join(str(sql).split())
        self.last_params = tuple(params)
        self.calls.append((self.last_sql, self.last_params))
        if self.permission_error and "FROM ma_tran_phan_quyen" in self.last_sql:
            raise DatabaseError("permission table unavailable")
        return self

    def fetchone(self):
        if "FROM sync_metadata" in self.last_sql:
            return self.metadata
        if "LIMIT 1" in self.last_sql and "organization_id" in self.last_sql:
            return self.record_row
        return None

    def fetchall(self):
        sql = self.last_sql
        if sql.startswith("SELECT table_name, record_id FROM deleted_records"):
            return [("goi_thau", "deleted-1"), ("unknown_table", "ignored")]
        match = re.search(r"SELECT \* FROM ([a-z_]+)", sql)
        if match:
            return [_table_row(match.group(1))]
        match = re.match(r"SELECT id FROM ([a-z_]+) WHERE", sql)
        if match:
            return [(f"{match.group(1)}-manifest",)]
        if sql.startswith("SELECT ") and " FROM " in sql and "organization_id" in sql:
            columns_text, table = sql[7:].split(" FROM ", 1)
            table = table.split(" ", 1)[0]
            if table in {
                "chu_dau_tu", "ke_hoach_lcnt", "goi_thau", "nha_thau", "chuyen_gia"
            }:
                return [{column.strip(): f"{column.strip()}-value" for column in columns_text.split(",")}]
        return []


class _Connection:
    def __init__(self, cursor, *, close_error=False):
        self._cursor = cursor
        self.closed = 0
        self.rollbacks = 0
        self.close_error = close_error

    def cursor(self):
        return self._cursor

    def rollback(self):
        self.rollbacks += 1

    def close(self):
        self.closed += 1
        if self.close_error:
            raise DatabaseError("close failed")


def _install_read_defaults(monkeypatch, connection):
    monkeypatch.setattr(read_service, "verify_session", lambda _request: (True, _Role()))
    monkeypatch.setattr(read_service.database, "get_connection", lambda: connection)
    monkeypatch.setattr(read_service, "get_active_org", lambda *_args, **_kwargs: "org-1")
    monkeypatch.setattr(read_service, "vietnam_now_sql", lambda: "2026-07-19 12:00:00")
    monkeypatch.setattr(read_service, "resolve_sensitive_read_policy", lambda *_args, **_kwargs: {"allowed": True})
    monkeypatch.setattr(read_service, "serialize_sensitive_read_item", lambda _table, item, _policy: item)
    monkeypatch.setattr(read_service, "serialize_sensitive_read_items", lambda _table, items, _policy: items)
    monkeypatch.setattr(read_service, "public_image_path", lambda value, **_kwargs: f"/media/{value}" if value else "")
    monkeypatch.setattr(read_service, "map_db_to_json", lambda _table, row: dict(row))
    monkeypatch.setattr(read_service, "attach_child_rows_to_items", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(read_service, "filter_items_for_read", lambda *_args: _args[-1])
    monkeypatch.setattr(read_service, "_get_expert_relations_for_packages", lambda *_args: {
        "gt-1": {"to_cg": [{"id": "cg-1"}], "to_td": [], "cg_ids": ["cg-1"]}
    })
    monkeypatch.setattr(read_service, "_get_contract_package_ids", lambda *_args: {"hd-1": ["gt-1"]})
    monkeypatch.setattr(read_service, "is_organization_manager", lambda *_args: True)
    monkeypatch.setattr(read_service, "can_read_table", lambda *_args: True)
    monkeypatch.setattr(read_service, "get_current_sync_version", lambda *_args: 10)
    monkeypatch.setattr(read_service, "build_dashboard_summary", lambda *_args: {"count": 1})
    monkeypatch.setattr(read_service, "get_package_field_policy", lambda: {"policy": "v1"})
    monkeypatch.setattr(read_service, "json_key_for_column", lambda _table, column: column)
    monkeypatch.setattr(read_service, "enum_label", lambda _table, _column, value: value)
    monkeypatch.setattr(read_service, "record_database_phase", lambda *_args: None)


def test_read_sync_full_bootstrap_returns_manifests_references_and_closes_once(monkeypatch):
    cursor = _SyncCursor()
    connection = _Connection(cursor)
    _install_read_defaults(monkeypatch, connection)
    response = read_service._read_sync_data_blocking(
        _Request({"include_summary": "true"})
    )
    payload = _body(response)
    assert response.status_code == 200
    assert payload["useServerSidePagination"] is True
    assert set(payload["recordManifest"]) == {
        "chudautu", "kehoach", "goithau", "chuyengia", "nhathau", "hopdong"
    }
    assert payload["referenceData"]["goithau"][0]["referenceOnly"] is True
    assert payload["dashboardSummary"] == {"count": 1}
    assert payload["syncVersion"] == 10
    assert response.headers["Server-Timing"].startswith("sync-read;dur=")
    assert connection.closed == 1


def test_read_sync_pins_every_response_to_one_repeatable_read_snapshot(monkeypatch):
    cursor = _SyncCursor()
    connection = _Connection(cursor)
    _install_read_defaults(monkeypatch, connection)

    response = read_service._read_sync_data_blocking(_Request())

    assert response.status_code == 200
    assert cursor.calls[0][0] == "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"


@pytest.mark.parametrize(
    "query, expected_partial",
    [
        ({"after_version": "2"}, False),
        ({"since": "1000"}, False),
        ({"after_version": "2", "tables": "goithau,assignments,invalid"}, True),
    ],
)
def test_read_sync_delta_maps_records_deletions_and_partial_tables(
    monkeypatch, query, expected_partial
):
    cursor = _SyncCursor(permission_error=query.get("since") == "1000")
    connection = _Connection(cursor)
    _install_read_defaults(monkeypatch, connection)
    monkeypatch.setattr(read_service, "is_organization_manager", lambda *_args: False)
    response = read_service._read_sync_data_blocking(_Request(query))
    payload = _body(response)
    assert response.status_code == 200
    assert payload["partial"] is expected_partial
    if expected_partial:
        assert "goithau" in payload
        assert "chudautu" not in payload
        assert payload["deletions"] == [{"table": "goithau", "id": "deleted-1"}]
    else:
        assert payload["goithau"][0]["chuyenGiaIds"] == ["cg-1"]
        assert payload["hopdong"][0]["goiThauIds"] == ["gt-1"]
        assert payload["chuyengia"][0]["anhChungChi"] == "/media/cert.png"
        assert payload["nhathau"][0]["anh_dau"] == "/media/stamp.png"
    assert connection.closed == 1


def test_read_sync_requires_full_refresh_for_compacted_cursor(monkeypatch):
    connection = _Connection(_SyncCursor(metadata=(10, 5)))
    _install_read_defaults(monkeypatch, connection)
    response = read_service._read_sync_data_blocking(_Request({"after_version": "2"}))
    payload = _body(response)
    assert response.status_code == 409
    assert payload["requiresFullSync"] is True
    assert payload["minAvailableSyncVersion"] == 5
    assert connection.closed == 1


def test_read_sync_rejects_auth_org_access_and_masks_failure(monkeypatch):
    monkeypatch.setattr(read_service, "verify_session", lambda _request: (False, "denied"))
    assert read_service._read_sync_data_blocking(_Request()).status_code == 403

    connection = _Connection(_SyncCursor())
    _install_read_defaults(monkeypatch, connection)
    monkeypatch.setattr(
        read_service,
        "get_active_org",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(OrgPermissionError("denied")),
    )
    response = read_service._read_sync_data_blocking(_Request())
    assert response.status_code == 403
    assert connection.rollbacks == 1
    assert connection.closed == 1

    monkeypatch.setattr(
        read_service.database,
        "get_connection",
        lambda: (_ for _ in ()).throw(RuntimeError("secret")),
    )
    monkeypatch.setattr(
        read_service,
        "log_and_error",
        lambda request, exc, *_args: JSONResponse({"error": "masked"}, status_code=500),
    )
    assert read_service._read_sync_data_blocking(_Request()).status_code == 500


@pytest.mark.parametrize("error_type, code", [
    (BlockingIOBusyError, "DATABASE_READ_QUEUE_FULL"),
    (BlockingIOTimeoutError, "DATABASE_READ_TIMEOUT"),
])
@pytest.mark.parametrize("route", [read_service.read_sync_data, read_service.read_single_record])
def test_read_async_wrappers_report_backpressure(monkeypatch, error_type, code, route):
    async def unavailable(*_args, **_kwargs):
        raise error_type("busy")

    monkeypatch.setattr(read_service, "run_database_read", unavailable)
    response = asyncio.run(route(_Request()))
    assert response.status_code == 503
    assert _body(response)["code"] == code
    assert response.headers["Retry-After"] == "1"


def test_read_async_wrappers_dispatch_with_bounded_timeout(monkeypatch):
    calls = []

    async def read(function, request, **kwargs):
        calls.append((function, kwargs["timeout_seconds"]))
        return JSONResponse({"success": True})

    monkeypatch.setattr(read_service, "run_database_read", read)
    assert asyncio.run(read_service.read_sync_data(_Request())).status_code == 200
    assert asyncio.run(read_service.read_single_record(_Request())).status_code == 200
    assert calls == [
        (read_service._read_sync_data_blocking, 30.0),
        (read_service._read_single_record_blocking, 15.0),
    ]


def test_read_single_record_validates_lookup_table_and_access(monkeypatch):
    monkeypatch.setattr(read_service, "verify_session", lambda _request: (False, "denied"))
    assert read_service._read_single_record_blocking(_Request()).status_code == 403

    monkeypatch.setattr(read_service, "verify_session", lambda _request: (True, _Role()))
    assert read_service._read_single_record_blocking(_Request({"table": "invalid", "id": "x"})).status_code == 400
    assert read_service._read_single_record_blocking(_Request({"table": "assignments", "id": "x"})).status_code == 400

    connection = _Connection(_SyncCursor(record_row={"id": "gt-1"}))
    _install_read_defaults(monkeypatch, connection)
    monkeypatch.setattr(read_service, "can_read_table", lambda *_args: False)
    assert read_service._read_single_record_blocking(
        _Request({"table": "goithau", "id": "gt-1"})
    ).status_code == 403
    assert connection.closed == 1


@pytest.mark.parametrize(
    "table_key, table_name, lookup, row",
    [
        ("goithau", "goi_thau", "GT_2", _table_row("goi_thau")),
        ("kehoach", "ke_hoach_lcnt", "KH_2", _table_row("ke_hoach_lcnt")),
        ("hopdong", "hop_dong", "HD-01", _table_row("hop_dong")),
        ("chudautu", "chu_dau_tu", "CDT_2", _table_row("chu_dau_tu")),
        ("nhathau", "nha_thau", "NT_2", _table_row("nha_thau")),
    ],
)
def test_read_single_record_maps_supported_domain_records(
    monkeypatch, table_key, table_name, lookup, row
):
    connection = _Connection(_SyncCursor(record_row=row))
    _install_read_defaults(monkeypatch, connection)
    monkeypatch.setattr(read_service, "can_read_record", lambda *_args: True)
    response = read_service._read_single_record_blocking(
        _Request({"table": table_key, "lookup": lookup})
    )
    item = _body(response)["item"]
    assert response.status_code == 200
    assert item["id"] == row["id"]
    if table_name == "goi_thau":
        assert item["chuyenGiaIds"] == ["cg-1"]
        assert item["phanLoList"] == []
    if table_name == "hop_dong":
        assert item["goiThauIds"] == ["gt-1"]
    if table_name == "nha_thau":
        assert item["anh_dau"] == "/media/stamp.png"
    assert connection.closed == 1


def test_read_single_record_handles_missing_record_record_denial_and_errors(monkeypatch):
    connection = _Connection(_SyncCursor(record_row=None))
    _install_read_defaults(monkeypatch, connection)
    response = read_service._read_single_record_blocking(
        _Request({"table": "goithau", "id": "missing"})
    )
    assert response.status_code == 404
    assert _body(response)["item"] is None

    denied_connection = _Connection(_SyncCursor(record_row=_table_row("goi_thau")))
    _install_read_defaults(monkeypatch, denied_connection)
    monkeypatch.setattr(read_service, "can_read_record", lambda *_args: False)
    assert read_service._read_single_record_blocking(
        _Request({"table": "goithau", "id": "gt-1"})
    ).status_code == 403

    _install_read_defaults(monkeypatch, _Connection(_SyncCursor()))
    monkeypatch.setattr(
        read_service,
        "get_active_org",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(OrgPermissionError("denied")),
    )
    assert read_service._read_single_record_blocking(
        _Request({"table": "goithau", "id": "gt-1"})
    ).status_code == 403

    monkeypatch.setattr(
        read_service,
        "get_active_org",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("secret")),
    )
    monkeypatch.setattr(
        read_service,
        "log_and_error",
        lambda request, exc, *_args: JSONResponse({"error": "masked"}, status_code=500),
    )
    assert read_service._read_single_record_blocking(
        _Request({"table": "goithau", "id": "gt-1"})
    ).status_code == 500
