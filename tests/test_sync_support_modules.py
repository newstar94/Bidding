from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest
from starlette.responses import JSONResponse

from backend.auth.session_utils import OrgPermissionError
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError
from backend.sync import api
from backend.sync.command import SyncActorContext, SyncMutationEnvelope
from backend.sync import evaluation_metadata
from backend.sync import queries
from backend.sync import request_contract
from backend.sync import response
from backend.sync.idempotency import request_hash_matches, sync_request_hash
from backend.sync.mutation_tracker import (
    SyncMutationTracker,
    clean_sync_record_id,
)
from backend.sync.payload_index import SyncPayloadIndex
from backend.sync.record_serializer import SyncRecordSerializer
from backend.sync.record_writer import SyncRecordWriter
from backend.sync import record_validator
from backend.sync.record_validator import SyncRecordValidator
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


def test_sync_command_types_normalize_envelope_and_actor_context():
    payload = {
        "clientMutationId": f"  {'x' * 140}  ",
        "kehoach": [{"id": "plan-1"}],
    }
    envelope = SyncMutationEnvelope.from_payload(payload)
    assert envelope.payload is payload
    assert envelope.client_mutation_id == "x" * 128
    assert envelope.request_hash == sync_request_hash(payload)

    request = object()
    context = SyncActorContext(
        request=request,
        role="employee",
        user_id="user-1",
        organization_id="org-1",
        owner_type="organization",
    )
    assert context.request is request
    assert context.organization_id == "org-1"


def test_sync_mutation_tracker_hides_version_recalculation_bookkeeping():
    tracker = SyncMutationTracker(clean_sync_record_id)
    tracker.track_record(
        "goi_thau",
        {"id": "package-1", "rootId": "package-root", "keHoachId": "plan-1"},
    )
    tracker.record_row_version("goithau", "package-1", 3)
    tracker.record_orphan("phan_cong_nhan_su", "assignment-1")
    tracker.record_image_cleanup("images/nha_thau/old.png")
    tracker.merge_deletion_result({
        "impacts": [{"table": "goithau", "id": "package-2"}],
        "affectedVersionFamilies": {"goi_thau": {("other-root", "plan-2")}},
        "affectedPlanIds": {"plan-2"},
        "imageCleanupCandidates": {"images/nha_thau/deleted.png"},
    })
    latest_calls = []
    plan_calls = []
    tracker.apply_recalculations(
        "cursor",
        "org-1",
        recalculate_latest=lambda *args, **kwargs: latest_calls.append((args, kwargs)),
        recalculate_plan_total=lambda *args, **kwargs: plan_calls.append((args, kwargs)),
    )

    outcome = tracker.outcome()
    assert outcome.updated_row_versions == ({
        "table": "goithau",
        "id": "package-1",
        "rowVersion": 3,
    },)
    assert outcome.orphaned_ids == ({
        "table": "phan_cong_nhan_su",
        "id": "assignment-1",
    },)
    assert outcome.delete_impacts == ({"table": "goithau", "id": "package-2"},)
    assert outcome.image_cleanup_candidates == {
        "images/nha_thau/old.png",
        "images/nha_thau/deleted.png",
    }
    assert len(latest_calls) == 1
    assert latest_calls[0][1]["affected_families"] == {
        ("package-root", "plan-1"),
        ("other-root", "plan-2"),
    }
    assert plan_calls[0][1]["plan_ids"] == {"plan-1", "plan-2"}


def test_sync_payload_index_canonicalizes_shared_validation_state():
    payload = {
        "kehoach": [{"id": "plan-1", "maKeHoach": "KH-01"}],
        "customcontractstatuses": [{"id": "status-1", "name": "Mới"}],
    }
    index = SyncPayloadIndex.build(payload, clean_sync_record_id)
    assert index.incoming_ids_by_table["ke_hoach_lcnt"] == {"plan-1"}
    assert index.incoming_records_by_table["ke_hoach_lcnt"]["plan-1"][
        "maKeHoach"
    ] == "KH-01"
    assert index.allowed_contract_status_names(_Cursor([("Đang thực hiện",)]), "org-1") == {
        "Mới",
        "Đang thực hiện",
    }

    index.remember_stored_record("ke_hoach_lcnt", "plan-1", {"row_version": 2})
    assert index.stored_record("ke_hoach_lcnt", "plan-1") == {"row_version": 2}
    index.skip("phan_cong_nhan_su", "assignment-1")
    assert index.should_skip("phan_cong_nhan_su", "assignment-1")


def test_sync_record_serializer_exposes_one_normalized_row_interface():
    transaction = SimpleNamespace(
        actor=SimpleNamespace(organization_id="org-1"),
        owner_type="organization",
        current_time="2026-07-26 12:00:00",
        cursor=object(),
    )
    tracker = SyncMutationTracker(clean_sync_record_id)
    serializer = SyncRecordSerializer(
        transaction,
        sync_version=9,
        newly_written_images=set(),
        mutation_tracker=tracker,
        clean_record_id=clean_sync_record_id,
        schema_definition={
            "ke_hoach_lcnt": {
                "columns": {
                    "id": "TEXT NOT NULL",
                    "organization_id": "TEXT NOT NULL",
                    "owner_type": "TEXT NOT NULL",
                    "id_goc": "TEXT",
                    "metadata_json": "TEXT",
                    "ngay_tuy_chon": "TEXT",
                    "gia_tri": "REAL",
                    "thu_tu": "INTEGER",
                    "mac_dinh": "TEXT DEFAULT 'FALLBACK'",
                    "bat_buoc": "TEXT NOT NULL",
                    "sync_version": "INTEGER",
                    "updated_at": "TEXT",
                },
                "json_fields": ["metadata_json"],
            }
        },
        money_columns=set(),
        field_name_for_column=lambda _table, column: column,
        payload_value_for_column=lambda _table, item, column: item.get(column),
    )

    row = serializer.serialize(
        "ke_hoach_lcnt",
        {
            "id": "plan-1",
            "metadata_json": {"source": "test"},
            "ngay_tuy_chon": "   ",
            "gia_tri": "1,5",
            "thu_tu": "2",
            "mac_dinh": None,
            "bat_buoc": None,
        },
    )

    assert row["organization_id"] == "org-1"
    assert row["owner_type"] == "organization"
    assert row["id_goc"] == "plan-1"
    assert json.loads(row["metadata_json"]) == {"source": "test"}
    assert row["ngay_tuy_chon"] is None
    assert row["gia_tri"] == 1.5
    assert row["thu_tu"] == 2
    assert row["mac_dinh"] == "FALLBACK"
    assert "bat_buoc" not in row
    assert row["sync_version"] == 9


def test_sync_record_writer_owns_insert_version_and_child_write():
    class WriterCursor:
        def __init__(self):
            self.calls = []
            self.current = None
            self.rowcount = 1

        def execute(self, sql, params=()):
            normalized = " ".join(str(sql).split())
            self.calls.append((normalized, tuple(params)))
            self.current = None
            return self

        def fetchone(self):
            return self.current

    cursor = WriterCursor()
    transaction = SimpleNamespace(
        actor=SimpleNamespace(organization_id="org-1", user_id="user-1"),
        owner_type="organization",
        current_time="2026-07-26 12:00:00",
        cursor=cursor,
    )
    tracker = SyncMutationTracker(clean_sync_record_id)
    child_calls = []
    writer = SyncRecordWriter(
        transaction,
        sync_version=9,
        mutation_tracker=tracker,
        clean_record_id=clean_sync_record_id,
        ownership_scoped_tables=set(),
        defer_latest_flag=lambda *_args: None,
        map_database_record=lambda _table, row: row,
        save_children=lambda *args: child_calls.append(args),
    )
    row = {
        "id": "plan-1",
        "organization_id": "org-1",
        "owner_type": "organization",
    }

    result = writer.write(
        payload_key="kehoach",
        table_name="ke_hoach_lcnt",
        item={"id": "plan-1"},
        db_row_data=row,
        previous_record=None,
    )

    assert result.conflict_error is None
    assert row["row_version"] == 1
    assert any(sql.startswith("INSERT INTO ke_hoach_lcnt") for sql, _ in cursor.calls)
    assert child_calls
    assert tracker.outcome().updated_row_versions == ({
        "table": "kehoach",
        "id": "plan-1",
        "rowVersion": 1,
    },)


def test_sync_record_validator_returns_formatted_errors_through_its_interface(
    monkeypatch,
):
    monkeypatch.setattr(
        record_validator,
        "authorize_record_write",
        lambda *_args: SimpleNamespace(allowed=False, message="denied"),
    )
    monkeypatch.setattr(
        record_validator,
        "validate_sync_item",
        lambda _table, item, _statuses: (item, ["invalid"], set()),
    )
    monkeypatch.setattr(
        record_validator,
        "validate_owner_scoped_references",
        lambda *_args: [],
    )
    monkeypatch.setattr(
        record_validator,
        "validate_opening_participant_uniqueness",
        lambda *_args: [],
    )
    cursor = _Cursor()
    transaction = SimpleNamespace(
        actor=SimpleNamespace(
            organization_id="org-1",
            user_id="user-1",
            role="employee",
        ),
        owner_type="personal",
        cursor=cursor,
    )
    tracker = SyncMutationTracker(clean_sync_record_id)
    validator = SyncRecordValidator(
        transaction,
        {"custom": [{"id": "row-1", "name": "Row"}]},
        SyncPayloadIndex(),
        tracker,
        clean_record_id=clean_sync_record_id,
        schema_definition={"custom_table": {"columns": {"id": "TEXT"}}},
        iter_payloads=lambda payload: [
            ("custom", "custom_table", payload["custom"])
        ],
        canonicalize_item=lambda _table, item: item,
    )

    errors = validator.validate_payload()

    assert [error["message"] for error in errors] == [
        "[row-1]: denied",
        "[row-1]: invalid",
    ]
    assert all(error["code"] == "SYNC_ITEM_INVALID" for error in errors)


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
        request_hash="a" * 64,
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
        request_hash=None,
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


def test_sync_request_hash_is_canonical_and_excludes_only_the_idempotency_key():
    first = {
        "clientMutationId": "mutation-a",
        "baseSyncVersion": "4",
        "kehoach": [{"id": "plan-1", "name": "A"}],
    }
    reordered = {
        "kehoach": [{"name": "A", "id": "plan-1"}],
        "baseSyncVersion": "4",
        "clientMutationId": "mutation-b",
    }
    changed = {
        **first,
        "kehoach": [{"id": "plan-1", "name": "B"}],
    }

    assert sync_request_hash(first) == sync_request_hash(reordered)
    assert sync_request_hash(first) != sync_request_hash(changed)
    assert request_hash_matches(None, sync_request_hash(first))
    assert request_hash_matches(sync_request_hash(first), sync_request_hash(first))
    assert not request_hash_matches(sync_request_hash(first), sync_request_hash(changed))


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
