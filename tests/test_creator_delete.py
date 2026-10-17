"""Creator deletion uses persisted evidence, never client claims (ADR 0089)."""
import json
import sqlite3
from contextlib import closing
from types import SimpleNamespace

import pytest

from backend.sync import deletion_service
from backend.shared.record_delete_access import attach_delete_ownership, load_creator_delete_ids
from tests.test_selected_row_batch_delete import (
    selected_delete_api, delete_payload, snapshot, ROOT_TABLES,
)


@pytest.fixture
def creator_api(monkeypatch):
    yield from selected_delete_api.__wrapped__(monkeypatch)


def creator_fixture(fixture, monkeypatch, table_key, other_second=False):
    monkeypatch.setattr(deletion_service, "build_batch_write_authorization_context",
                        lambda *_args, **_kwargs: SimpleNamespace(organization_manager=False))
    fixture.raw.execute("""CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY, organization_id TEXT, target_type TEXT,
        target_id TEXT, actor_user_id TEXT, action TEXT, metadata_json TEXT)""")
    for suffix in ("first", "second"):
        fixture.raw.execute("INSERT INTO audit_log VALUES (NULL, ?, ?, ?, ?, ?, '{}')", (
            "org-1", ROOT_TABLES[table_key], f"{table_key}-{suffix}",
            "other" if other_second and suffix == "second" else "manager-1",
            "sync.record_created",
        ))
    fixture.raw.commit()


@pytest.mark.parametrize("table_key", ROOT_TABLES)
def test_member_can_delete_own_records(creator_api, monkeypatch, table_key):
    fixture = creator_api
    creator_fixture(fixture, monkeypatch, table_key)
    response = fixture.submit(delete_payload(table_key))
    assert response.status_code == 200, json.loads(response.body)
    assert len(json.loads(response.body)["deleteImpacts"]) == 2


@pytest.mark.parametrize("table_key", ROOT_TABLES)
def test_mixed_ownership_rolls_back_whole_batch(creator_api, monkeypatch, table_key):
    fixture = creator_api
    creator_fixture(fixture, monkeypatch, table_key, other_second=True)
    before = snapshot(fixture)
    payload = delete_payload(table_key)
    response = fixture.submit(payload)
    assert response.status_code == 400
    assert snapshot(fixture) == before


def test_creator_still_requires_existing_record_write_access(creator_api, monkeypatch):
    fixture = creator_api
    creator_fixture(fixture, monkeypatch, "kehoach")
    fixture.denied_id = "kehoach-first"
    before = snapshot(fixture)
    response = fixture.submit(delete_payload("kehoach"))
    assert response.status_code == 400
    assert "RECORD_ACCESS_DENIED" in response.body.decode()
    assert snapshot(fixture) == before


def test_creator_version_conflict_rolls_back_whole_batch(creator_api, monkeypatch):
    fixture = creator_api
    creator_fixture(fixture, monkeypatch, "hopdong")
    before = snapshot(fixture)
    payload = delete_payload("hopdong")
    payload["deletions"][1]["expectedVersion"] = 2
    response = fixture.submit(payload)
    assert response.status_code == 409
    assert "ROW_VERSION_CONFLICT" in response.body.decode()
    assert snapshot(fixture) == before


def test_personal_employee_can_delete_without_creation_audit(creator_api, monkeypatch):
    fixture = creator_api
    monkeypatch.setattr(deletion_service, "build_batch_write_authorization_context",
                        lambda *_args, **_kwargs: SimpleNamespace(organization_manager=False))
    fixture.raw.execute("UPDATE hop_dong SET organization_id = 'personal:manager-1'")
    result = deletion_service.apply_sync_deletions(
        fixture.cursor(), delete_payload("hopdong")["deletions"],
        organization_id="personal:manager-1", actor_role="employee", actor_user_id="manager-1",
        current_time="2026-10-17 12:00:00", sync_version=11,
        clean_record_id=lambda _table, value: value, ip_address="127.0.0.1",
    )
    assert result["errors"] == []
    assert len(result["impacts"]) == 2


def test_creation_evidence_is_tenant_scoped_first_event_and_original_lineage():
    with closing(sqlite3.connect(":memory:")) as conn:
        conn.execute("""CREATE TABLE audit_log (
            id INTEGER PRIMARY KEY, organization_id TEXT, target_type TEXT,
            target_id TEXT, actor_user_id TEXT, action TEXT, metadata_json TEXT)""")
        conn.executemany("INSERT INTO audit_log VALUES (?, ?, ?, ?, ?, ?, '{}')", [
            (1, "foreign", "goi_thau", "root", "alice", "sync.record_created"),
            (2, "org", "goi_thau", "root", "bob", "sync.record_created"),
            (3, "org", "goi_thau", "root", "alice", "sync.record_created"),
            (4, "org", "goi_thau", "later", "alice", "sync.record_created"),
            (5, "org", "goi_thau", "own", "alice", "sync.record_created"),
            (6, "org", "goi_thau", "updated-only", "alice", "sync.record_updated"),
        ])
        rows = [{"id": "later", "rootId": "root"}, {"id": "own"},
                {"id": "unknown", "deleteOwnerUserId": "alice"}, {"id": "updated-only"}]
        assert load_creator_delete_ids(conn.cursor(), "org", "alice", "goi_thau", rows) == {"own"}
        attach_delete_ownership(conn.cursor(), "org", "alice", "goi_thau", rows)
        assert [row["deleteOwnerUserId"] for row in rows] == [None, "alice", None, None]
        attach_delete_ownership(None, "personal:alice", "alice", "goi_thau", rows)
        assert all(row["deleteOwnerUserId"] == "alice" for row in rows)


def test_audit_creator_queries_are_bounded_and_restricted_to_business_records():
    class Cursor:
        def __init__(self):
            self.calls = []

        def execute(self, _sql, params):
            self.calls.append(params)
            return self

        def fetchall(self):
            return [(root, "alice", "{}") for root in self.calls[-1][2:]]

    cursor = Cursor()
    records = [{"id": f"r-{index}"} for index in range(1001)]
    assert len(load_creator_delete_ids(cursor, "org", "alice", "ke_hoach_lcnt", records)) == 1001
    assert [len(params) - 2 for params in cursor.calls] == [500, 500, 1]
    assert load_creator_delete_ids(cursor, "org", "alice", "phan_cong_nhan_su", records) == set()
    assert len(cursor.calls) == 3


def test_delta_hints_only_attach_to_authorized_upserts(monkeypatch):
    from backend.sync import delta_paging
    import backend.shared.record_delete_access as access

    calls = []
    monkeypatch.setattr(access, "load_creator_delete_ids", lambda _cursor, _org, _user, _table, rows:
                        calls.append([row["id"] for row in rows]) or {"own"})
    own, denied = {"id": "own"}, {"id": "denied"}
    delta_paging._attach_upsert_delete_ownership(
        None, {("goi_thau", "own"): own, ("goi_thau", "denied"): denied},
        SimpleNamespace(allows=lambda _table, _key, item: item["id"] != "denied"), "org", "alice",
    )
    assert calls == [["own"]]
    assert own["deleteOwnerUserId"] == "alice"
    assert "deleteOwnerUserId" not in denied
