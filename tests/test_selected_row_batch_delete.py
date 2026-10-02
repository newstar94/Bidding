"""Selected-row deletion uses one atomic, idempotent sync transaction.

All business rows live in an isolated SQLite fixture. PostgreSQL-independent
delete/transaction/recalculation code runs unchanged; external authorization,
media and notification boundaries are supplied by controlled fixture seams.
"""

import asyncio
from copy import deepcopy
import json
import sqlite3
from types import SimpleNamespace

import pytest
from starlette.responses import JSONResponse

from backend.db.db_helper import DatabaseError, IntegrityError
from backend.sync import deletion_service, response as sync_response, service
from backend.sync.delete_policy import CASCADE_IMPACT_RULES, PROTECTED_DELETE_REFERENCES


ROOT_TABLES = {"kehoach": "ke_hoach_lcnt", "goithau": "goi_thau", "hopdong": "hop_dong"}
ROOT_FIXTURE_INSERTS = {
    "kehoach": """INSERT INTO ke_hoach_lcnt
        (id, organization_id, id_goc, is_latest, row_version, ke_hoach_id, phien_ban)
        VALUES (?, 'org-1', ?, ?, ?, ?, ?)""",
    "goithau": """INSERT INTO goi_thau
        (id, organization_id, id_goc, is_latest, row_version, ke_hoach_id, phien_ban)
        VALUES (?, 'org-1', ?, ?, ?, ?, ?)""",
    "hopdong": """INSERT INTO hop_dong
        (id, organization_id, id_goc, is_latest, row_version, ke_hoach_id, phien_ban)
        VALUES (?, 'org-1', ?, ?, ?, ?, ?)""",
}
ROOT_MEMBER_INSERTS = {
    "kehoach": "INSERT INTO ke_hoach_lcnt (id, organization_id, id_goc) VALUES (?, 'org-1', ?)",
    "goithau": "INSERT INTO goi_thau (id, organization_id, id_goc) VALUES (?, 'org-1', ?)",
    "hopdong": "INSERT INTO hop_dong (id, organization_id, id_goc) VALUES (?, 'org-1', ?)",
}


class FixtureCursor:
    def __init__(self, fixture):
        self.fixture = fixture
        self.raw = fixture.raw.cursor()

    def execute(self, sql, parameters=()):
        normalized = " ".join(sql.split())
        parameters = tuple(parameters)
        self.fixture.commands.append((normalized, parameters))
        if normalized.startswith("DELETE FROM ") and len(parameters) == 3:
            if parameters[1] == self.fixture.referenced_id:
                raise IntegrityError("fixture concurrent foreign key reference")
            if parameters[1] == self.fixture.concurrent_id:
                raise self.fixture.concurrent_error
        # SQLite models the isolated transaction; PostgreSQL owns row locking.
        portable_sql = sql.removesuffix(" FOR UPDATE")
        self.raw.execute(portable_sql, parameters)
        return self

    def fetchone(self):
        return self.raw.fetchone()

    def fetchall(self):
        return self.raw.fetchall()

    @property
    def rowcount(self):
        return self.raw.rowcount


class FixtureConnection:
    def __init__(self):
        self.raw = sqlite3.connect(":memory:")
        self.raw.row_factory = sqlite3.Row
        self.raw.create_function("GREATEST", -1, max)
        self.denied_id = None
        self.referenced_id = None
        self.concurrent_id = None
        self.concurrent_error = None
        self.rollbacks = 0
        self.commits = 0
        self.commands = []

    def cursor(self):
        return FixtureCursor(self)

    def execute(self, sql, parameters=()):
        return self.cursor().execute(sql, parameters)

    def commit(self):
        self.commits += 1
        self.raw.commit()

    def rollback(self):
        self.rollbacks += 1
        self.raw.rollback()

    def close(self):
        # The sync actor reader and writer share this in-memory test database.
        pass


@pytest.fixture
def selected_delete_api(monkeypatch):
    fixture = FixtureConnection()
    tables = set(ROOT_TABLES.values()) | {"thong_tin_mo_thau", "phan_cong_nhan_su"}
    for parent in (*ROOT_TABLES.values(), "thong_tin_mo_thau"):
        tables.update(rule.table for rule in PROTECTED_DELETE_REFERENCES.get(parent, ()))
        tables.update(rule.table for rule in CASCADE_IMPACT_RULES.get(parent, ()))
    tables.add("nha_thau_tham_du_mo_thau")
    columns = """
        id TEXT PRIMARY KEY, organization_id TEXT, owner_type TEXT,
        id_goc TEXT, row_version INTEGER DEFAULT 3, is_latest INTEGER DEFAULT 1,
        archived_at TEXT, updated_at TEXT DEFAULT '2026-10-02 12:00:00',
        sync_version INTEGER DEFAULT 0, phien_ban INTEGER DEFAULT 1,
        ke_hoach_id TEXT, goi_thau_id TEXT, hop_dong_id TEXT,
        thong_tin_mo_thau_id TEXT, id_muc_tieu TEXT, loai_doi_tuong TEXT,
        id_nhan_vien TEXT, gia_goi_thau INTEGER DEFAULT 100,
        is_rebid INTEGER DEFAULT 0, loai_hinh_mua_sam TEXT DEFAULT 'Dự toán mua sắm',
        is_tong_muc_tu_dong INTEGER DEFAULT 1, tong_muc_dau_tu INTEGER DEFAULT 0,
        loai TEXT, gia_tri INTEGER DEFAULT 0
    """
    for table in sorted(tables):
        fixture.raw.execute(f"CREATE TABLE {table} ({columns})")  # noqa: S608 - fixed registry fixture schema
    fixture.raw.executescript("""
        CREATE TABLE sync_metadata (
            organization_id TEXT PRIMARY KEY, current_version INTEGER,
            min_available_version INTEGER DEFAULT 0, updated_at TEXT
        );
        CREATE TABLE deleted_records (
            table_name TEXT, record_id TEXT, organization_id TEXT,
            deleted_at TEXT, delete_version INTEGER, record_snapshot_json TEXT,
            delete_actor_user_id TEXT, delete_mutation_id TEXT,
            PRIMARY KEY (organization_id, table_name, record_id)
        );
        CREATE TABLE sync_mutations (
            organization_id TEXT, actor_user_id TEXT, client_mutation_id TEXT,
            request_hash TEXT, response_json TEXT,
            PRIMARY KEY (organization_id, actor_user_id, client_mutation_id)
        );
        CREATE TABLE fixture_audits (table_name TEXT, record_id TEXT);
        CREATE TABLE fixture_events (payload TEXT);
    """)
    fixture.raw.execute("INSERT INTO sync_metadata VALUES ('org-1', 10, 0, NULL)")
    fixture.raw.execute("""
        INSERT INTO ke_hoach_lcnt (id, organization_id, id_goc, tong_muc_dau_tu)
        VALUES ('owner-plan', 'org-1', 'owner-plan', 200)
    """)
    for key in ROOT_TABLES:
        for suffix, latest, version in (("first", 1, 3), ("second", 1, 3), ("history", 0, 2)):
            record_id = f"{key}-{suffix}"
            root_id = f"{key}-first" if suffix == "history" else record_id
            fixture.raw.execute(
                ROOT_FIXTURE_INSERTS[key],
                (record_id, root_id, latest, version, "owner-plan" if key == "goithau" else None,
                 0 if suffix == "history" else 1),
            )
            fixture.raw.execute("""
                INSERT INTO phan_cong_nhan_su
                    (id, organization_id, id_muc_tieu, loai_doi_tuong, id_nhan_vien)
                VALUES (?, 'org-1', ?, ?, 'manager-1')
            """, (f"assignment-{record_id}", record_id, key))
    fixture.raw.commit()

    role = SimpleNamespace(user_id="manager-1")
    monkeypatch.setattr(service, "database", SimpleNamespace(get_connection=lambda: fixture))
    monkeypatch.setattr(service, "verify_session", lambda _request: (True, role))
    monkeypatch.setattr(service, "get_active_org", lambda *_args, **_kwargs: "org-1")
    monkeypatch.setattr(service, "get_owner_type", lambda *_args: "organization")
    monkeypatch.setattr(service, "can_upload_workspace_assets", lambda *_args: True)
    monkeypatch.setattr(service, "acquire_idempotency_lock", lambda *_args: None)
    monkeypatch.setattr(service, "log_error", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(service, "validate_import_session_mutation", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(service, "persist_import_session_provenance", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(service.SyncRecordValidator, "validate_payload", lambda _self: [])
    for name in (
        "resolve_pending_imported_investor", "register_staged_assets",
        "augment_default_assignments", "insert_assignment_removal_history",
        "queue_assignment_state_changes", "insert_mutation_audit_events", "insert_activity_events",
    ):
        monkeypatch.setattr(service, name, lambda *_args, **_kwargs: None)
    monkeypatch.setattr(service, "snapshot_assignment_state", lambda *_args: {})
    monkeypatch.setattr(service, "build_assignment_activity_events", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(service, "_run_post_commit_side_effects", lambda context, **_kwargs: JSONResponse(context.response_data))
    monkeypatch.setattr(deletion_service, "build_batch_write_authorization_context",
                        lambda *_args, **_kwargs: SimpleNamespace(organization_manager=True))
    monkeypatch.setattr(deletion_service, "authorize_record_write_from_context",
                        lambda _context, _key, _table, item: SimpleNamespace(allowed=item["id"] != fixture.denied_id))
    monkeypatch.setattr(deletion_service, "can_read_record", lambda *_args: True)
    monkeypatch.setattr(deletion_service, "insert_delete_audit", lambda cursor, **kwargs: cursor.execute(
        "INSERT INTO fixture_audits VALUES (?, ?)", (kwargs["table_name"], kwargs["record_id"]),
    ))
    monkeypatch.setattr(sync_response, "enqueue_websocket_event", lambda cursor, _kind, **kwargs: cursor.execute(
        "INSERT INTO fixture_events VALUES (?)", (json.dumps(kwargs["payload"]),),
    ))

    async def run_database_write(function, *args, **kwargs):
        return function(*args, **kwargs)

    monkeypatch.setattr(service, "run_database_write", run_database_write)
    request = SimpleNamespace(headers={}, state=SimpleNamespace(), client=SimpleNamespace(host="127.0.0.1"), method="POST")

    def submit(payload):
        async def read_json_object(_request):
            return deepcopy(payload), None

        monkeypatch.setattr(service, "read_json_object", read_json_object)
        return asyncio.run(service.process_sync_request(request))

    fixture.submit = submit
    fixture.request = request
    fixture.tables = tables | {"sync_metadata", "deleted_records", "sync_mutations", "fixture_audits", "fixture_events"}
    yield fixture
    fixture.raw.close()


def delete_payload(table_key, *, mutation_id="selected-delete-1"):
    return {
        "clientMutationId": mutation_id,
        "baseSyncVersion": "10",
        "deletions": [
            {"table": table_key, "id": f"{table_key}-first", "expectedVersion": 3},
            {"table": table_key, "id": f"{table_key}-second", "expectedVersion": 3},
        ],
    }


def snapshot(fixture):
    return {
        table: sorted(tuple(row) for row in fixture.raw.execute(f"SELECT * FROM {table}"))  # noqa: S608 - fixed fixture tables
        for table in sorted(fixture.tables)
    }


@pytest.mark.parametrize("table_key", ROOT_TABLES)
@pytest.mark.parametrize("failure,code,status", [
    ("denied", "RECORD_ACCESS_DENIED", 400),
    ("conflict", "ROW_VERSION_CONFLICT", 409),
    ("referenced", "DELETE_REFERENCED", 400),
])
def test_one_rejected_selection_rolls_back_all_rows_assignments_tombstones_and_receipts(
    selected_delete_api, table_key, failure, code, status,
):
    fixture = selected_delete_api
    payload = delete_payload(table_key)
    if failure == "denied":
        fixture.denied_id = f"{table_key}-second"
    elif failure == "conflict":
        payload["deletions"][1]["expectedVersion"] = 2
    else:
        fixture.referenced_id = f"{table_key}-second"
    before = snapshot(fixture)
    response = fixture.submit(payload)
    body = json.loads(response.body)
    assert response.status_code == status, body
    assert body["status"] == "error"
    assert [error["code"] for error in body["errors"]] == [code]
    if failure == "conflict":
        assert body["errors"][0]["expectedVersion"] == 2
        assert body["errors"][0]["currentVersion"] == 3
    assert snapshot(fixture) == before
    assert fixture.rollbacks == 1
    assert fixture.commits == 0


@pytest.mark.parametrize("table_key", ROOT_TABLES)
def test_committed_batch_retry_replays_identical_receipt_and_never_expands_historical_ids(
    selected_delete_api, table_key,
):
    fixture = selected_delete_api
    payload = delete_payload(table_key)
    frozen_payload = deepcopy(payload)
    first = fixture.submit(payload)
    receipt = json.loads(first.body)
    assert first.status_code == 200, receipt
    assert receipt["status"] == "success"
    assert receipt["syncVersion"] == 11
    assert {(impact["table"], impact["id"]) for impact in receipt["deleteImpacts"]} == {
        (table_key, f"{table_key}-first"), (table_key, f"{table_key}-second"),
    }
    assert {impact["action"] for impact in receipt["deleteImpacts"]} == {"deleted"}
    table = ROOT_TABLES[table_key]
    assert fixture.raw.execute(f"SELECT COUNT(*) FROM {table} WHERE id = ?", (f"{table_key}-history",)).fetchone()[0] == 1  # noqa: S608
    committed = snapshot(fixture)
    retry = fixture.submit(frozen_payload)
    assert retry.status_code == 200
    assert json.loads(retry.body) == receipt
    assert snapshot(fixture) == committed
    assert fixture.commits == 1
    assert payload == frozen_payload
    altered = deepcopy(frozen_payload)
    altered["deletions"][0]["expectedVersion"] = 1
    rejected = fixture.submit(altered)
    assert rejected.status_code == 409
    assert json.loads(rejected.body)["code"] == "IDEMPOTENCY_KEY_REUSED"
    assert snapshot(fixture) == committed


def test_delete_only_package_batch_recalculates_plan_total_without_plan_upsert(selected_delete_api):
    fixture = selected_delete_api
    response = fixture.submit(delete_payload("goithau"))
    assert response.status_code == 200, json.loads(response.body)
    plan = fixture.raw.execute("SELECT tong_muc_dau_tu FROM ke_hoach_lcnt WHERE id = 'owner-plan'").fetchone()
    # The untouched historical package is promoted within its existing family.
    assert plan[0] == 100


def test_opening_first_then_package_preserves_existing_archive_reference_semantics(selected_delete_api):
    fixture = selected_delete_api
    fixture.raw.execute("""
        INSERT INTO thong_tin_mo_thau (id, organization_id, goi_thau_id)
        VALUES ('opening-1', 'org-1', 'goithau-first')
    """)
    fixture.raw.commit()
    payload = delete_payload("goithau")
    payload["deletions"].insert(0, {"table": "thongtinmothau", "id": "opening-1", "expectedVersion": 3})
    response = fixture.submit(payload)
    body = json.loads(response.body)
    assert response.status_code == 200, body
    assert [(impact["id"], impact["action"]) for impact in body["deleteImpacts"]] == [
        ("opening-1", "archived"), ("goithau-first", "archived"), ("goithau-second", "deleted"),
    ]
    for table, record_id in (("thong_tin_mo_thau", "opening-1"), ("goi_thau", "goithau-first")):
        row = fixture.raw.execute(f"SELECT archived_at FROM {table} WHERE id = ?", (record_id,)).fetchone()  # noqa: S608 - fixed fixture tables
        assert row[0]


def test_oversize_selected_batch_is_rejected_whole_before_any_transaction(selected_delete_api, monkeypatch):
    fixture = selected_delete_api
    monkeypatch.setenv("SYNC_MAX_BATCH_ITEMS", "100")
    payload = delete_payload("hopdong")
    payload["deletions"] = [dict(payload["deletions"][0], id=f"selection-{index}") for index in range(101)]
    before = snapshot(fixture)
    response = fixture.submit(payload)
    body = json.loads(response.body)
    assert response.status_code == 413
    assert body["code"] == "SYNC_BATCH_TOO_LARGE"
    assert body["fields"] == {"maxItems": 100, "receivedItems": 101}
    assert snapshot(fixture) == before
    assert fixture.rollbacks == fixture.commits == 0


@pytest.mark.parametrize("value", [None, "", True, False, -1, "-1", 1.5, "1.5", [], {}])
def test_opt_in_snapshot_version_rejects_invalid_values_before_any_transaction(selected_delete_api, value):
    fixture = selected_delete_api
    payload = delete_payload("kehoach")
    payload["expectedSyncVersion"] = value
    response = fixture.submit(payload)
    body = json.loads(response.body)
    assert response.status_code == 400
    assert body["code"] == "SYNC_VALIDATION_FAILED"
    assert any(error["field"] == "expectedSyncVersion" and error["code"] == "INVALID_INTEGER"
               for error in body["fields"]["errors"])
    assert not fixture.commands


@pytest.mark.parametrize("table_key", ROOT_TABLES)
def test_confirmed_family_membership_drift_rejects_whole_command_under_sync_row_lock(
    selected_delete_api, table_key,
):
    fixture = selected_delete_api
    payload = delete_payload(table_key)
    payload["expectedSyncVersion"] = "10"
    # A concurrent version command added a member after preview. Existing rows
    # retain the same versions, so expectedVersion alone cannot detect it.
    fixture.raw.execute(
        ROOT_MEMBER_INSERTS[table_key],
        (f"{table_key}-new-member", f"{table_key}-first"),
    )
    fixture.raw.execute("UPDATE sync_metadata SET current_version = 11 WHERE organization_id = 'org-1'")
    fixture.raw.commit()
    before = snapshot(fixture)
    response = fixture.submit(payload)
    body = json.loads(response.body)
    assert response.status_code == 409, body
    assert body["code"] == "SYNC_SNAPSHOT_CHANGED"
    assert body["fields"] == {"expectedSyncVersion": 10, "currentSyncVersion": 11}
    assert snapshot(fixture) == before
    assert ("SELECT current_version FROM sync_metadata WHERE organization_id = ? FOR UPDATE", ("org-1",)) in fixture.commands
    assert not any(sql.startswith("DELETE FROM") for sql, _parameters in fixture.commands)
    assert fixture.rollbacks == 1
    assert fixture.commits == 0


def test_ordinary_sync_preserves_stale_base_version_compatibility(selected_delete_api):
    fixture = selected_delete_api
    payload = delete_payload("hopdong")
    payload["baseSyncVersion"] = "1"
    response = fixture.submit(payload)
    assert response.status_code == 200, json.loads(response.body)
    assert not any(sql.endswith("FOR UPDATE") for sql, _parameters in fixture.commands)


@pytest.mark.parametrize("value", [10, "10"])
def test_snapshot_guard_idempotent_receipt_replays_before_advanced_workspace_check(
    selected_delete_api, value,
):
    fixture = selected_delete_api
    payload = delete_payload("goithau")
    payload["expectedSyncVersion"] = value
    first = fixture.submit(payload)
    receipt = json.loads(first.body)
    assert first.status_code == 200, receipt
    fixture.raw.execute("UPDATE sync_metadata SET current_version = 12 WHERE organization_id = 'org-1'")
    fixture.raw.commit()
    committed = snapshot(fixture)
    fixture.commands.clear()
    replay = fixture.submit(deepcopy(payload))
    assert replay.status_code == 200
    assert json.loads(replay.body) == receipt
    assert snapshot(fixture) == committed
    assert not any(sql.endswith("FOR UPDATE") for sql, _parameters in fixture.commands)
    # Callers with a transaction completion callback deliberately bypass the
    # early replay lane. Their transaction replay must still precede the guard.
    transactional_replay = service.execute_sync_mutation(
        fixture.request,
        deepcopy(payload),
        transaction_completion=lambda *_args: None,
    )
    assert transactional_replay.status_code == 200
    assert json.loads(transactional_replay.body) == receipt
    assert snapshot(fixture) == committed
    assert not any(sql.endswith("FOR UPDATE") for sql, _parameters in fixture.commands)


@pytest.mark.parametrize("value", [0, "0"])
def test_snapshot_guard_accepts_zero_for_a_new_sync_metadata_row(selected_delete_api, value):
    fixture = selected_delete_api
    fixture.raw.execute("DELETE FROM sync_metadata")
    fixture.raw.commit()
    payload = delete_payload("hopdong")
    payload["expectedSyncVersion"] = value
    response = fixture.submit(payload)
    body = json.loads(response.body)
    assert response.status_code == 200, body
    assert body["syncVersion"] == 1


@pytest.mark.parametrize("sqlstate", ["40001", "40P01", "55P03"])
def test_guarded_delete_concurrency_error_rolls_back_entire_batch_and_requests_reconfirmation(
    selected_delete_api, sqlstate,
):
    fixture = selected_delete_api
    payload = delete_payload("hopdong")
    payload["expectedSyncVersion"] = "10"
    fixture.concurrent_id = "hopdong-second"
    fixture.concurrent_error = type("FixtureConcurrencyError", (DatabaseError,), {"sqlstate": sqlstate})("fixture concurrency")
    before = snapshot(fixture)
    response = fixture.submit(payload)
    body = json.loads(response.body)
    assert response.status_code == 409, body
    assert body["code"] == "SYNC_SNAPSHOT_CHANGED"
    assert "xác nhận" in body["message"]
    assert snapshot(fixture) == before
    assert fixture.rollbacks == 1
    assert fixture.commits == 0


def test_ordinary_sync_keeps_existing_concurrency_error_contract(selected_delete_api):
    fixture = selected_delete_api
    fixture.concurrent_id = "hopdong-second"
    fixture.concurrent_error = type("FixtureDeadlock", (DatabaseError,), {"sqlstate": "40P01"})("fixture deadlock")
    before = snapshot(fixture)
    response = fixture.submit(delete_payload("hopdong"))
    assert response.status_code == 500
    assert snapshot(fixture) == before
