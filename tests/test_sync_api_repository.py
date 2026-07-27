from __future__ import annotations

import asyncio

from backend.sync import api, pagination, read_service, repository, service, version_api


def test_sync_http_adapters_delegate_to_domain_services(monkeypatch):
    request = object()
    calls = []

    async def process_sync(candidate, broadcaster):
        calls.append(("sync", candidate, broadcaster))
        return "sync-result"

    async def read_all(candidate):
        calls.append(("all", candidate))
        return "all-result"

    async def read_one(candidate):
        calls.append(("one", candidate))
        return "one-result"

    async def paginate(candidate):
        calls.append(("page", candidate))
        return "page-result"

    async def read_version(candidate):
        calls.append(("version", candidate))
        return "version-result"

    monkeypatch.setattr(service, "process_sync_request", process_sync)
    monkeypatch.setattr(read_service, "read_sync_data", read_all)
    monkeypatch.setattr(read_service, "read_single_record", read_one)
    monkeypatch.setattr(pagination, "paginate_records", paginate)
    monkeypatch.setattr(version_api, "current_sync_version_api", read_version)

    assert asyncio.run(api.sync_api(request)) == "sync-result"
    assert asyncio.run(api.get_all_data_api(request)) == "all-result"
    assert asyncio.run(api.record_api(request)) == "one-result"
    assert asyncio.run(api.paginate_api(request)) == "page-result"
    assert asyncio.run(api.current_sync_version_api(request)) == "version-result"
    assert calls == [
        ("sync", request, api.broadcast_websocket_event),
        ("all", request),
        ("one", request),
        ("page", request),
        ("version", request),
    ]


class _Cursor:
    def __init__(self, rows):
        self.rows = iter(rows)
        self.executed = []

    def execute(self, sql, parameters):
        self.executed.append((" ".join(sql.split()), parameters))
        return self

    def fetchone(self):
        return next(self.rows)


def test_sync_repository_version_helpers_cover_versioned_and_unversioned_rows():
    versioned = {"id": "package-1", "is_latest": 1}
    assert repository.defer_version_latest_flag("goi_thau", versioned) is versioned
    assert versioned["is_latest"] == 0

    unversioned = {"id": "opening-1", "is_latest": 1}
    assert repository.defer_version_latest_flag("thong_tin_mo_thau", unversioned) is unversioned
    assert unversioned["is_latest"] == 1


def test_sync_repository_reads_and_increments_versions():
    increment_cursor = _Cursor([(7,)])
    assert repository.next_sync_version(increment_cursor, "org-1") == 7
    assert len(increment_cursor.executed) == 2
    assert increment_cursor.executed[0][1] == ("org-1",)
    assert increment_cursor.executed[1][1] == ("org-1",)

    missing_increment_cursor = _Cursor([None])
    assert repository.next_sync_version(missing_increment_cursor, "org-2") == 0

    current_cursor = _Cursor([(11,)])
    assert repository.get_current_sync_version(current_cursor, "org-1") == 11
    assert current_cursor.executed[0][1] == ("org-1",)

    missing_current_cursor = _Cursor([None])
    assert repository.get_current_sync_version(missing_current_cursor, "org-2") == 0
