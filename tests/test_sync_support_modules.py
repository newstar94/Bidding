from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest
from starlette.responses import JSONResponse

from backend.auth.session_utils import OrgPermissionError
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError
from backend.sync import api
from backend.sync import evaluation_metadata
from backend.sync import queries
from backend.sync import request_contract
from backend.sync import response
from backend.sync import serializer
from backend.sync import version_api


class _Cursor:
    def __init__(self, rows=()):
        self.rows = list(rows)
        self.calls = []

    def execute(self, sql, params=()):
        self.calls.append((" ".join(str(sql).split()), tuple(params)))
        return self

    def fetchall(self):
        return list(self.rows)


class _Connection:
    def __init__(self, cursor=None):
        self._cursor = cursor or _Cursor()
        self.commits = 0
        self.rollbacks = 0
        self.closed = 0

    def cursor(self):
        return self._cursor

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def close(self):
        self.closed += 1


def _request():
    return SimpleNamespace(
        cookies={},
        headers={},
        state=SimpleNamespace(),
        method="GET",
        url=SimpleNamespace(path="/api/sync/version"),
    )


def test_sync_api_current_version_adapter(monkeypatch):
    marker = object()

    async def read_version(request):
        assert request == "request"
        return marker

    monkeypatch.setattr(version_api, "current_sync_version_api", read_version)
    assert asyncio.run(api.current_sync_version_api("request")) is marker


def test_evaluation_metadata_contract_covers_invalid_and_bounded_values(monkeypatch):
    assert evaluation_metadata.parse_evaluation_metadata(None) == {"schemaVersion": 1}
    assert evaluation_metadata.parse_evaluation_metadata("") == {"schemaVersion": 1}
    assert evaluation_metadata.parse_evaluation_metadata(
        '{"schemaVersion":1,"score":5}'
    )["score"] == 5
    with pytest.raises(ValueError, match="valid JSON"):
        evaluation_metadata.parse_evaluation_metadata("{")
    with pytest.raises(ValueError, match="JSON object"):
        evaluation_metadata.parse_evaluation_metadata([])
    with pytest.raises(ValueError, match="schemaVersion"):
        evaluation_metadata.parse_evaluation_metadata({"schemaVersion": 2})
    monkeypatch.setattr(evaluation_metadata, "MAX_EVALUATION_METADATA_BYTES", 10)
    with pytest.raises(ValueError, match="64 KiB"):
        evaluation_metadata.parse_evaluation_metadata({"schemaVersion": 1, "x": "long"})
    monkeypatch.setattr(evaluation_metadata, "MAX_EVALUATION_METADATA_BYTES", 64 * 1024)
    assert json.loads(evaluation_metadata.dump_evaluation_metadata({"score": 1})) == {
        "schemaVersion": 1,
        "score": 1,
    }


def test_query_helpers_cover_search_relations_and_contract_packages():
    assert queries.build_fts_match_query(None) == ""
    assert queries.build_fts_match_query("  !!!  ") == ""
    assert queries.build_fts_match_query("một hai") == "một* hai*"
    assert len(queries.build_fts_match_query("1 2 3 4 5 6 7 8 9").split()) == 8

    assert queries.get_expert_relations_for_packages(_Cursor(), [], "org") == {}
    cursor = _Cursor([
        ("gt-1", "cg-1", "chuyen_gia", None, None),
        ("gt-1", "cg-2", "tham_dinh", "Trưởng nhóm", "Rà soát"),
    ])
    relations = queries.get_expert_relations_for_packages(cursor, ["gt-1"], "org-1")
    assert relations["gt-1"]["cg_ids"] == ["cg-1"]
    assert relations["gt-1"]["to_cg"][0]["chucVu"] == "Tổ viên"
    assert relations["gt-1"]["to_td"][0]["congViec"] == "Rà soát"
    assert cursor.calls[0][1] == ("gt-1", "org-1")
    cursor_without_org = _Cursor([])
    queries.get_expert_relations_for_packages(cursor_without_org, ["gt-2"])
    assert cursor_without_org.calls[0][1] == ("gt-2",)

    assert queries.get_contract_package_ids(_Cursor(), []) == {}
    contract_cursor = _Cursor([
        ("hd-1", "gt-1"),
        ("hd-1", "gt-2"),
        ("hd-2", None),
    ])
    assert queries.get_contract_package_ids(
        contract_cursor, ["hd-1", "hd-2"], "org-1"
    ) == {"hd-1": ["gt-1", "gt-2"]}
    assert contract_cursor.calls[0][1] == ("hd-1", "hd-2", "org-1")


def test_sync_request_contract_limits_batches_and_read_windows(monkeypatch):
    monkeypatch.setenv("SYNC_MAX_BATCH_ITEMS", "bad")
    assert request_contract.sync_batch_limit() == 2000
    monkeypatch.setenv("SYNC_MAX_BATCH_ITEMS", "1")
    assert request_contract.sync_batch_limit() == 100
    monkeypatch.setenv("SYNC_MAX_BATCH_ITEMS", "999999")
    assert request_contract.sync_batch_limit() == 10_000
    assert request_contract.sync_batch_size(None) == 0
    assert request_contract.sync_batch_size({
        "kehoach": [{}, {}],
        "deletions": [{}],
        "goithau": "not-a-list",
    }) == 3

    initial = request_contract.parse_sync_read_window({})
    assert initial.is_full_initial_fetch and initial.after_version is None
    timestamp = request_contract.parse_sync_read_window({"since": "1"})
    assert timestamp.since.startswith("1970-01-01") and not timestamp.is_full_initial_fetch
    incremental = request_contract.parse_sync_read_window({
        "since": "2026-07-19 00:00:00",
        "after_version": "12",
    })
    assert incremental.after_version == 12 and incremental.since.startswith("2026")
    invalid_version = request_contract.parse_sync_read_window({
        "since": "custom",
        "after_version": "invalid",
    })
    assert invalid_version.after_version is None


def test_commit_and_rollback_sync_responses_cover_optional_contract(monkeypatch):
    connection = _Connection()
    cursor = connection.cursor()
    monkeypatch.setattr(response, "get_current_sync_version", lambda *_args: 8)
    monkeypatch.setattr(response, "build_dashboard_summary", lambda *_args: {"count": 1})
    payload = response.commit_sync_response(
        connection,
        cursor,
        organization_id="org-1",
        actor_user_id="user-1",
        actor_role="employee",
        current_time="now",
        client_mutation_id="mutation-1",
        include_dashboard_summary=True,
        updated_row_versions={"row": 2},
        delete_impacts=[{"id": "x"}],
        orphaned_ids={"goithau": ["gt-1"]},
    )
    assert payload["syncVersion"] == 8
    assert payload["dashboardSummary"] == {"count": 1}
    assert payload["rowVersions"] == {"row": 2}
    assert payload["deleteImpacts"] and payload["orphanedIds"]
    assert connection.commits == 1 and cursor.calls

    minimal_connection = _Connection()
    minimal = response.commit_sync_response(
        minimal_connection,
        minimal_connection.cursor(),
        organization_id="org-1",
        actor_user_id="user-1",
        actor_role="employee",
        current_time="now",
        client_mutation_id=None,
        include_dashboard_summary=False,
        updated_row_versions={},
        delete_impacts=[],
        orphaned_ids={},
    )
    assert set(minimal) == {"status", "timestamp", "syncVersion"}

    assert list(serializer.iter_sync_table_payloads({
        "kehoach": [{"id": "kh-1"}],
        "goithau": None,
    })) == [("kehoach", "ke_hoach_lcnt", [{"id": "kh-1"}])]
    rollback_connection = _Connection()
    rolled_back = serializer.rollback_sync_response(
        rollback_connection,
        [{"field": "bad"}],
        "invalid",
        status_code=422,
    )
    assert rollback_connection.rollbacks == 1
    assert rolled_back.status_code == 422


def test_current_sync_version_endpoint_success_and_fail_closed(monkeypatch):
    monkeypatch.setattr(
        version_api,
        "error_response",
        lambda _request, code, message, status_code: JSONResponse(
            {"code": code, "message": message}, status_code=status_code
        ),
    )

    async def raise_busy(*_args, **_kwargs):
        raise BlockingIOBusyError("busy")

    monkeypatch.setattr(version_api, "run_database_read", raise_busy)
    busy = asyncio.run(version_api.current_sync_version_api(_request()))
    assert busy.status_code == 503 and busy.headers["retry-after"] == "1"

    async def raise_timeout(*_args, **_kwargs):
        raise BlockingIOTimeoutError("timeout")

    monkeypatch.setattr(version_api, "run_database_read", raise_timeout)
    timed_out = asyncio.run(version_api.current_sync_version_api(_request()))
    assert timed_out.status_code == 503

    marker = object()
    monkeypatch.setattr(version_api, "log_and_error", lambda *_args: marker)

    async def raise_unknown(*_args, **_kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(version_api, "run_database_read", raise_unknown)
    assert asyncio.run(version_api.current_sync_version_api(_request())) is marker

    monkeypatch.setattr(version_api, "verify_session", lambda _request: (False, "expired"))
    assert version_api._read_current_sync_version(_request()).status_code == 403

    role = SimpleNamespace(user_id="user-1")
    monkeypatch.setattr(version_api, "verify_session", lambda _request: (True, role))
    monkeypatch.setattr(
        version_api,
        "get_active_org",
        lambda *_args: (_ for _ in ()).throw(OrgPermissionError()),
    )
    assert version_api._read_current_sync_version(_request()).status_code == 403

    cursor = _Cursor()
    connection = _Connection(cursor)
    monkeypatch.setattr(version_api, "get_active_org", lambda *_args: "org-1")
    monkeypatch.setattr(
        version_api.database,
        "get_connection",
        lambda: connection,
    )
    monkeypatch.setattr(version_api, "get_current_sync_version", lambda *_args: 17)
    phases = []
    monkeypatch.setattr(version_api, "record_database_phase", lambda *args, **kwargs: phases.append(args))
    success = version_api._read_current_sync_version(_request())
    assert success.status_code == 200
    assert json.loads(success.body) == {"syncVersion": 17}
    assert success.headers["cache-control"] == "private, no-store"
    assert connection.closed == 1 and phases
