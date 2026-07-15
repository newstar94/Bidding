import json
import sqlite3

import pytest

from backend.app import app  # noqa: F401 - initializes backend import paths
import backend.sync.pagination as pagination


class _Request:
    query_params = {
        "table": "goithau",
        "page": "1",
        "pageSize": "10",
    }


class _Role:
    user_id = "user-1"

    def __str__(self):
        return "super_admin"


def _snapshot_connection():
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.execute("""
        CREATE TABLE ke_hoach_lcnt (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            is_latest INTEGER NOT NULL,
            archived_at TEXT
        )
    """)
    connection.execute("""
        CREATE TABLE goi_thau (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            id_goc TEXT,
            phien_ban TEXT,
            is_latest INTEGER NOT NULL,
            archived_at TEXT,
            ke_hoach_id TEXT,
            ma_goi_thau TEXT
        )
    """)
    for version in range(4):
        plan_id = f"kh-0{version}"
        connection.execute(
            "INSERT INTO ke_hoach_lcnt VALUES (?, ?, ?, NULL)",
            (plan_id, "org-1", 1 if version == 3 else 0),
        )
        connection.execute(
            "INSERT INTO goi_thau VALUES (?, ?, ?, ?, ?, NULL, ?, ?)",
            (f"gt-snapshot-{version}", "org-1", "gt-root", "00", 1, plan_id, "IB-1"),
        )
    connection.execute(
        "INSERT INTO goi_thau VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (
            "gt-archived", "org-1", "gt-archived", "00", 1,
            "2026-07-14 12:00:00", "kh-03", "IB-ARCHIVED",
        ),
    )
    connection.commit()
    return connection


@pytest.mark.anyio
async def test_main_package_page_only_returns_the_latest_plan_snapshot(monkeypatch):
    connection = _snapshot_connection()
    monkeypatch.setattr(pagination, "verify_session", lambda _request: (True, _Role()))
    monkeypatch.setattr(pagination, "get_active_org", lambda _request, _user_id: "org-1")
    monkeypatch.setattr(
        pagination,
        "is_organization_manager",
        lambda _cursor, _role, _user, _owner: True,
    )
    monkeypatch.setattr(pagination, "can_read_table", lambda *_args: True)
    monkeypatch.setattr(pagination.database, "get_connection", lambda: connection)
    monkeypatch.setattr(pagination, "_get_expert_relations_for_packages", lambda *_args: {})
    monkeypatch.setattr(pagination, "attach_child_rows_to_items", lambda *_args, **_kwargs: None)

    response = await pagination.paginate_records(_Request())
    payload = json.loads(response.body)

    assert response.status_code == 200
    assert payload["totalItems"] == 1
    assert [item["id"] for item in payload["items"]] == ["gt-snapshot-3"]


@pytest.mark.anyio
async def test_cursor_pagination_returns_each_record_once(monkeypatch):
    connections = [_snapshot_connection(), _snapshot_connection()]
    for connection in connections:
        connection.executemany(
            "INSERT INTO goi_thau VALUES (?, ?, ?, ?, ?, NULL, ?, ?)",
            [
                ("gt-a", "org-1", "gt-a", "00", 1, "kh-03", "IB-1"),
                ("gt-z", "org-1", "gt-z", "00", 1, "kh-03", "IB-2"),
            ],
        )
        connection.commit()
    monkeypatch.setattr(pagination, "verify_session", lambda _request: (True, _Role()))
    monkeypatch.setattr(pagination, "get_active_org", lambda _request, _user_id: "org-1")
    monkeypatch.setattr(pagination, "is_organization_manager", lambda *_args: True)
    monkeypatch.setattr(pagination, "can_read_table", lambda *_args: True)
    monkeypatch.setattr(pagination.database, "get_connection", lambda: connections.pop(0))
    monkeypatch.setattr(pagination, "_get_expert_relations_for_packages", lambda *_args: {})
    monkeypatch.setattr(pagination, "attach_child_rows_to_items", lambda *_args, **_kwargs: None)

    class FirstRequest:
        query_params = {
            "table": "goithau",
            "pagination": "cursor",
            "pageSize": "2",
        }

    first_response = await pagination.paginate_records(FirstRequest())
    first = json.loads(first_response.body)
    assert first["hasMore"] is True
    assert first["nextCursor"]

    class SecondRequest:
        query_params = {
            "table": "goithau",
            "pagination": "cursor",
            "pageSize": "2",
            "cursor": first["nextCursor"],
        }

    second_response = await pagination.paginate_records(SecondRequest())
    second = json.loads(second_response.body)
    ids = [item["id"] for item in first["items"] + second["items"]]
    assert ids == ["gt-a", "gt-snapshot-3", "gt-z"]
    assert len(ids) == len(set(ids))
    assert second["hasMore"] is False
    assert second["nextCursor"] is None


def test_keyset_cursor_rejects_another_sort_context():
    token = pagination._encode_keyset_cursor("goi_thau", "ma_goi_thau", "ASC", "IB-1", "gt-1")
    assert pagination._decode_keyset_cursor(token, "goi_thau", "ma_goi_thau", "ASC") == ("IB-1", "gt-1")
    assert pagination._decode_keyset_cursor(token, "goi_thau", "ma_goi_thau", "DESC") is None
    assert pagination._decode_keyset_cursor("not-base64", "goi_thau", "ma_goi_thau", "ASC") is None
