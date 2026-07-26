import asyncio
import json
from types import SimpleNamespace

import pytest
from starlette.responses import JSONResponse

from backend.db.db_helper import DatabaseError, IntegrityError
from backend.shared.async_io import BlockingIOBusyError
from backend.shared.helpers import OrgPermissionError
from backend.sync import command
from backend.sync import record_serializer
from backend.sync import record_validator
from backend.sync import service


def _body(response):
    return json.loads(response.body.decode("utf-8"))


class _Role(str):
    def __new__(cls, value="employee", user_id="user-1", session_id="session-1"):
        instance = super().__new__(cls, value)
        instance.user_id = user_id
        instance.session_id = session_id
        return instance


class _Request:
    def __init__(self):
        self.headers = {"X-Active-Org": "org-1"}
        self.cookies = {"session_token": "session-token"}
        self.query_params = {}
        self.path_params = {}
        self.state = SimpleNamespace()
        self.method = "POST"
        self.url = SimpleNamespace(path="/api/sync")


class _Answer:
    def __init__(self, one=None, all_rows=None, rowcount=1, error=None):
        self.one = one
        self.all_rows = [] if all_rows is None else all_rows
        self.rowcount = rowcount
        self.error = error


class _Cursor:
    def __init__(self, handler=None):
        self.handler = handler or (lambda _sql, _params: _Answer())
        self.answer = _Answer()
        self.rowcount = 1
        self.calls = []

    def execute(self, sql, params=()):
        normalized = " ".join(str(sql).split())
        self.calls.append((normalized, tuple(params)))
        self.answer = self.handler(normalized, tuple(params)) or _Answer()
        self.rowcount = self.answer.rowcount
        if self.answer.error:
            raise self.answer.error
        return self

    def fetchone(self):
        return self.answer.one

    def fetchall(self):
        return self.answer.all_rows


class _Connection:
    def __init__(self, cursor, *, rollback_error=False, close_error=False):
        self._cursor = cursor
        self.commits = 0
        self.rollbacks = 0
        self.closed = 0
        self.rollback_error = rollback_error
        self.close_error = close_error

    def cursor(self):
        return self._cursor

    def execute(self, sql, params=()):
        return self._cursor.execute(sql, params)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1
        if self.rollback_error:
            raise DatabaseError("rollback failed")

    def close(self):
        self.closed += 1
        if self.close_error:
            raise DatabaseError("close failed")


def _empty_deletion_result(**overrides):
    result = {
        "errors": [],
        "impacts": [],
        "affectedVersionFamilies": {},
        "affectedPlanIds": set(),
        "imageCleanupCandidates": set(),
    }
    result.update(overrides)
    return result


def _install_core_defaults(monkeypatch, connections, *, owner_type="personal"):
    role = _Role()
    monkeypatch.setattr(service, "verify_session", lambda _request: (True, role))
    connection_iter = iter(connections)
    monkeypatch.setattr(service.database, "get_connection", lambda: next(connection_iter))
    monkeypatch.setattr(service, "get_active_org", lambda *_args, **_kwargs: "personal:user-1" if owner_type == "personal" else "org-1")
    monkeypatch.setattr(service, "get_owner_type", lambda *_args: owner_type)
    monkeypatch.setattr(service, "is_personal_scope_for_user", lambda org, user: org == f"personal:{user}")
    monkeypatch.setattr(service, "_sync_batch_limit", lambda: 1000)
    monkeypatch.setattr(service, "next_sync_version", lambda *_args: 7)
    monkeypatch.setattr(service, "vietnam_now_sql", lambda: "2026-07-19 12:00:00")
    monkeypatch.setattr(record_validator, "authorize_record_write", lambda *_args: SimpleNamespace(allowed=True, message=""))
    monkeypatch.setattr(record_validator, "validate_sync_item", lambda _table, item, _statuses: (item, [], set()))
    monkeypatch.setattr(record_validator, "validate_package_status_transition", lambda *_args: [])
    monkeypatch.setattr(record_validator, "validate_package_locked_fields", lambda *_args: [])
    monkeypatch.setattr(record_validator, "validate_owner_scoped_references", lambda *_args: [])
    monkeypatch.setattr(record_validator, "validate_opening_participant_uniqueness", lambda *_args: [])
    monkeypatch.setattr(service, "save_child_payloads", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(service, "defer_version_latest_flag", lambda *_args: None)
    monkeypatch.setattr(service, "apply_sync_deletions", lambda *_args, **_kwargs: _empty_deletion_result())
    monkeypatch.setattr(service, "recalculate_is_latest", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(service, "recalculate_tong_muc_dau_tu", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        service,
        "commit_sync_response",
        lambda *args, **kwargs: {
            "status": "success",
            "syncVersion": 7,
            "updatedRowVersions": kwargs["updated_row_versions"],
            "orphanedIds": kwargs["orphaned_ids"],
        },
    )
    monkeypatch.setattr(service, "find_unreferenced_image_paths", lambda *_args: [])
    monkeypatch.setattr(service, "delete_managed_image_files", lambda *_args: None)
    monkeypatch.setattr(service, "get_client_ip", lambda _request: "203.0.113.1")
    monkeypatch.setattr(service, "record_database_phase", lambda *_args: None)
    monkeypatch.setattr(service, "log_error", lambda *_args, **_kwargs: None)
    return role


def test_process_sync_request_validates_json_shape_batch_and_database_backpressure(monkeypatch):
    request = _Request()
    marker = JSONResponse({"error": "json"}, status_code=422)

    async def bad_json(_request):
        return None, marker

    monkeypatch.setattr(service, "read_json_object", bad_json)
    assert asyncio.run(service.process_sync_request(request)) is marker

    async def read(_request):
        return {"bad": True}, None

    monkeypatch.setattr(service, "read_json_object", read)
    monkeypatch.setattr(service, "validate_sync_payload_shape", lambda _data: [{"field": "bad", "code": "INVALID", "secret": "omit"}])
    monkeypatch.setattr(service, "log_error", lambda *_args, **_kwargs: None)
    response = asyncio.run(service.process_sync_request(request))
    assert response.status_code == 400
    assert _body(response)["code"] == "SYNC_VALIDATION_FAILED"

    monkeypatch.setattr(service, "validate_sync_payload_shape", lambda _data: [])
    monkeypatch.setattr(service, "_sync_batch_size", lambda _data: 11)
    monkeypatch.setattr(service, "_sync_batch_limit", lambda: 10)
    response = asyncio.run(service.process_sync_request(request))
    assert response.status_code == 413
    assert _body(response)["code"] == "SYNC_BATCH_TOO_LARGE"

    monkeypatch.setattr(service, "_sync_batch_size", lambda _data: 1)

    async def busy(*_args, **_kwargs):
        raise BlockingIOBusyError("busy")

    monkeypatch.setattr(service, "run_database_write", busy)
    response = asyncio.run(service.process_sync_request(request))
    assert response.status_code == 503
    assert response.headers["Retry-After"] == "1"


def test_process_sync_request_dispatches_valid_payload(monkeypatch):
    request = _Request()
    payload = {"chudautu": []}

    async def read(_request):
        return payload, None

    async def write(function, passed_request, data, callback):
        assert function is service.execute_sync_mutation
        assert passed_request is request
        assert data is payload
        assert callback == "callback"
        return JSONResponse({"status": "success"})

    monkeypatch.setattr(service, "read_json_object", read)
    monkeypatch.setattr(service, "validate_sync_payload_shape", lambda _data: [])
    monkeypatch.setattr(service, "_sync_batch_size", lambda _data: 0)
    monkeypatch.setattr(service, "_sync_batch_limit", lambda: 10)
    monkeypatch.setattr(service, "run_database_write", write)
    assert asyncio.run(service.process_sync_request(request, "callback")).status_code == 200


def test_persist_incoming_images_only_decodes_supported_dict_payloads(monkeypatch):
    payload = {
        "chuyengia": [
            None,
            {"id": "cg-1", "anh_chung_chi": "data:image/png;base64,AAA", "anh_chu_ky": "existing.png"},
        ],
        "nhathau": [{"id": "nt-1", "anh_dau": "data:image/png;base64,BBB"}],
        "goithau": [{"id": "gt-1", "image": "data:image/png;base64,CCC"}],
    }
    monkeypatch.setattr(service, "canonicalize_payload_item", lambda _table, item: dict(item))
    monkeypatch.setattr(service, "json_key_for_column", lambda _table, column: column)
    monkeypatch.setattr(service, "get_payload_value", lambda _table, item, column: item.get(column))
    monkeypatch.setattr(service, "clean_id", lambda value: str(value or ""))
    monkeypatch.setattr(
        service,
        "save_base64_image",
        lambda value, folder, name, *, tenant_id: f"images/{folder}/{name}.png",
    )
    written = set()
    service._persist_incoming_images(payload, written, "org-1")
    assert payload["chuyengia"][1]["anh_chung_chi"] == "images/chuyen_gia/cg-1_cert.png"
    assert payload["chuyengia"][1]["anh_chu_ky"] == "existing.png"
    assert payload["nhathau"][0]["anh_dau"] == "images/nha_thau/nt-1_stamp.png"
    assert len(written) == 2


def test_sync_rejects_invalid_session_and_workspace_ownership(monkeypatch):
    monkeypatch.setattr(service, "log_error", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(service, "verify_session", lambda _request: (False, "denied"))
    assert service.execute_sync_mutation(_Request(), {}).status_code == 403

    for owner_type, personal_match, expected in [
        ("personal", False, 403),
        ("unknown", True, 403),
    ]:
        auth = _Connection(_Cursor())
        _install_core_defaults(monkeypatch, [auth], owner_type=owner_type)
        monkeypatch.setattr(service, "is_personal_scope_for_user", lambda *_args, value=personal_match: value)
        response = service.execute_sync_mutation(_Request(), {})
        assert response.status_code == expected
        assert auth.closed == 1


@pytest.mark.parametrize("stored", ['{"status":"cached"}', '{broken', None])
def test_sync_idempotency_returns_cached_authorization_result(monkeypatch, stored):
    def handler(sql, _params):
        if "FROM sync_mutations" in sql:
            return _Answer(one=(stored,) if stored is not None else None)
        return _Answer()

    auth = _Connection(_Cursor(handler))
    tx = _Connection(_Cursor(handler))
    connections = [auth] if stored is not None else [auth, tx]
    _install_core_defaults(monkeypatch, connections)
    data = {"clientMutationId": "x" * 200}
    if stored is None:
        monkeypatch.setattr(service, "commit_sync_response", lambda *args, **kwargs: {"status": "success"})
    response = service.execute_sync_mutation(_Request(), data)
    payload = _body(response)
    assert response.status_code == 200
    assert payload["status"] == ("cached" if stored and stored.startswith("{") and "cached" in stored else "success")
    assert auth.closed == 1


def test_sync_rejects_reused_mutation_id_with_different_payload(monkeypatch):
    def handler(sql, _params):
        if "FROM sync_mutations" in sql:
            return _Answer(one=('{"status":"cached"}', "stored-request-hash"))
        return _Answer()

    auth = _Connection(_Cursor(handler))
    _install_core_defaults(monkeypatch, [auth])
    monkeypatch.setattr(
        command,
        "sync_request_hash",
        lambda _data: "different-request-hash",
    )

    response = service.execute_sync_mutation(
        _Request(),
        {
            "clientMutationId": "mutation-1",
            "kehoach": [{"id": "plan-different"}],
        },
    )

    assert response.status_code == 409
    assert _body(response)["code"] == "IDEMPOTENCY_KEY_REUSED"


def test_sync_detects_scope_change_between_authorization_and_transaction(monkeypatch):
    auth = _Connection(_Cursor())
    tx = _Connection(_Cursor())
    _install_core_defaults(monkeypatch, [auth, tx], owner_type="organization")
    calls = 0

    def active_org(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        return "org-1" if calls == 1 else "org-2"

    monkeypatch.setattr(service, "get_active_org", active_org)
    response = service.execute_sync_mutation(_Request(), {})
    assert response.status_code == 403
    assert tx.rollbacks == 1
    assert tx.closed == 1


def test_sync_transaction_revalidates_personal_and_unknown_scope(monkeypatch):
    for scenario, expected_code in [("personal-mismatch", "PERSONAL_WORKSPACE_OWNER_MISMATCH"), ("unknown", "WORKSPACE_NOT_FOUND")]:
        auth = _Connection(_Cursor())
        tx = _Connection(_Cursor())
        owner_calls = 0

        def owner(*_args):
            nonlocal owner_calls
            owner_calls += 1
            if scenario == "personal-mismatch":
                return "personal"
            return "organization" if owner_calls == 1 else "unknown"

        _install_core_defaults(monkeypatch, [auth, tx], owner_type="personal" if scenario == "personal-mismatch" else "organization")
        monkeypatch.setattr(service, "get_owner_type", owner)
        personal_calls = 0

        def personal(*_args):
            nonlocal personal_calls
            personal_calls += 1
            return personal_calls == 1

        monkeypatch.setattr(service, "is_personal_scope_for_user", personal)
        response = service.execute_sync_mutation(_Request(), {})
        assert response.status_code in {400, 403}
        assert _body(response)["code"] == expected_code
        assert tx.closed == 1


def _all_table_payload():
    return {
        "chudautu": [{"id": "cdt-1", "maChuDauTu": "CDT", "maSoThue": "010", "daiDienCdt": " nguyen van a "}],
        "kehoach": [{"id": "kh-1", "rootId": "kh-root", "maKeHoach": "KH"}],
        "goithau": [{"id": "gt-1", "rootId": "gt-root", "keHoachId": "kh-1", "maGoiThau": "GT"}],
        "chuyengia": [{"id": "cg-1", "soCCCD": "001"}],
        "nhathau": [{"id": "nt-1", "maNhaThau": "NT", "maSoThue": "020", "nguoiDaiDien": " tran van b "}],
        "customcontractstatuses": [{"id": "status-1", "name": "Đang thực hiện"}],
        "hopdong": [{"id": "hd-1", "rootId": "hd-root", "soHopDong": "HD", "goiThauIds": []}],
        "assignments": [
            {"id": "a-1", "empId": "user-1", "targetId": "kh-1", "type": "kehoach"},
            {"id": "a-2", "empId": "user-1", "targetId": "gt-1", "type": "goithau"},
            {"id": "a-3", "empId": "user-1", "targetId": "hd-1", "type": "hopdong"},
        ],
        "thongtinmothau": [{"id": "open-1"}],
        "permissionmatrix": [{"id": "perm-1", "empId": "user-1"}],
        "deletions": [],
        "includeDashboardSummary": True,
    }


def test_sync_success_inserts_all_table_types_tracks_versions_and_broadcasts(monkeypatch):
    auth = _Connection(_Cursor())
    tx_cursor = _Cursor()
    tx = _Connection(tx_cursor)
    _install_core_defaults(monkeypatch, [auth, tx], owner_type="organization")
    monkeypatch.setattr(service, "canonicalize_payload_item", lambda _table, item: dict(item))
    broadcasts = []
    response = service.execute_sync_mutation(
        _Request(),
        _all_table_payload(),
        lambda org, event: broadcasts.append((org, event)),
    )
    payload = _body(response)
    assert response.status_code == 200
    assert payload["status"] == "success"
    assert len(payload["updatedRowVersions"]) >= 10
    assert broadcasts == [("org-1", {"event": "db_changed"})]
    assert tx.closed == 1
    assert tx.commits == 1
    sql_text = "\n".join(sql for sql, _ in tx_cursor.calls)
    assert "INSERT INTO record_edit_ownership" not in sql_text
    assert "DELETE FROM phan_cong_nhan_su" in sql_text
    assert "DELETE FROM ma_tran_phan_quyen" in sql_text


def test_sync_organization_auto_assigns_new_business_records_and_rechecks_batch(monkeypatch):
    def handler(sql, _params):
        if sql.startswith("SELECT 1 FROM ke_hoach_lcnt"):
            return _Answer(one=None)
        if sql.startswith("SELECT 1 FROM goi_thau"):
            return _Answer(one=(1,))
        if sql.startswith("SELECT 1 FROM phan_cong_nhan_su"):
            return _Answer(one=(1,))
        return _Answer()

    auth = _Connection(_Cursor())
    tx = _Connection(_Cursor(handler))
    _install_core_defaults(monkeypatch, [auth, tx], owner_type="organization")
    data = {
        "kehoach": [{"id": "kh-new"}, {"id": ""}],
        "goithau": [{"id": "gt-existing"}],
        "assignments": [],
    }
    response = service.execute_sync_mutation(_Request(), data)
    assert response.status_code == 200
    assert len(data["assignments"]) == 1
    assert data["assignments"][0]["targetId"] == "kh-new"

    auth2 = _Connection(_Cursor())
    tx2 = _Connection(_Cursor())
    _install_core_defaults(monkeypatch, [auth2, tx2], owner_type="organization")
    monkeypatch.setattr(service, "_sync_batch_size", lambda _data: 1001)
    response = service.execute_sync_mutation(_Request(), {"kehoach": [{"id": "kh"}]})
    assert response.status_code == 413
    assert tx2.rollbacks == 1
    assert tx2.closed == 1


def test_sync_validation_collects_access_version_archive_domain_and_reference_errors(monkeypatch):
    current = {"id": "gt-1", "row_version": 3, "trang_thai": "Đã đóng thầu", "archived_at": None}

    def handler(sql, _params):
        if sql.startswith("SELECT * FROM goi_thau"):
            return _Answer(one=current)
        if sql.startswith("SELECT archived_at FROM goi_thau"):
            return _Answer(one=("2026-01-01",))
        if "lower(trim(ma_goi_thau))" in sql:
            return _Answer(one=(1,))
        if sql.startswith("SELECT name FROM trang_thai"):
            return _Answer(all_rows=[("Hiện có",), ("",)])
        return _Answer()

    auth = _Connection(_Cursor())
    tx = _Connection(_Cursor(handler))
    _install_core_defaults(monkeypatch, [auth, tx], owner_type="personal")
    monkeypatch.setattr(record_validator, "authorize_record_write", lambda *_args: SimpleNamespace(allowed=False, message="denied"))
    monkeypatch.setattr(record_validator, "validate_sync_item", lambda _table, item, _statuses: (item, ["pure error"], {"status"}))
    monkeypatch.setattr(record_validator, "validate_package_status_transition", lambda *_args: ["transition"])
    monkeypatch.setattr(record_validator, "validate_package_locked_fields", lambda *_args: ["locked"])
    monkeypatch.setattr(record_validator, "validate_owner_scoped_references", lambda *_args: ["reference"])
    response = service.execute_sync_mutation(
        _Request(), {"goithau": [{"id": "gt-1", "rootId": "root", "expectedVersion": 2, "maGoiThau": "GT"}]}
    )
    payload = _body(response)
    assert response.status_code == 409
    assert payload["code"] == "ROW_VERSION_CONFLICT"
    codes = {error["code"] for error in payload["errors"]}
    assert "ROW_VERSION_CONFLICT" in codes
    assert tx.rollbacks == 1
    assert tx.closed == 1


@pytest.mark.parametrize(
    "payload_key, item, conflict_sql",
    [
        ("chudautu", {"id": "cdt", "rootId": "r", "maChuDauTu": "CDT", "maSoThue": "010"}, "FROM chu_dau_tu"),
        ("kehoach", {"id": "kh", "rootId": "r", "maKeHoach": "KH"}, "FROM ke_hoach_lcnt"),
        ("goithau", {"id": "gt", "rootId": "r", "maGoiThau": "GT"}, "FROM goi_thau"),
        ("nhathau", {"id": "nt", "rootId": "r", "maNhaThau": "NT", "maSoThue": "020"}, "FROM nha_thau"),
        ("chuyengia", {"id": "cg", "rootId": "r", "soCCCD": "001"}, "FROM chuyen_gia"),
        ("hopdong", {"id": "hd", "rootId": "r", "soHopDong": "HD"}, "FROM hop_dong"),
        ("customcontractstatuses", {"id": "s", "name": "Status"}, "FROM danh_muc_trang_thai_hop_dong"),
    ],
)
def test_sync_rejects_domain_uniqueness_conflicts(monkeypatch, payload_key, item, conflict_sql):
    def handler(sql, _params):
        if conflict_sql in sql and ("lower(trim" in sql or "trim(so_cccd)" in sql):
            return _Answer(one=("conflict-id",))
        return _Answer()

    auth = _Connection(_Cursor())
    tx = _Connection(_Cursor(handler))
    _install_core_defaults(monkeypatch, [auth, tx])
    response = service.execute_sync_mutation(_Request(), {payload_key: [item]})
    assert response.status_code == 400
    assert _body(response)["errors"]


def test_sync_skips_orphan_assignment_reference_and_reports_it(monkeypatch):
    auth = _Connection(_Cursor())
    tx = _Connection(_Cursor())
    _install_core_defaults(monkeypatch, [auth, tx])
    monkeypatch.setattr(record_validator, "validate_owner_scoped_references", lambda *_args: ["missing target"])
    response = service.execute_sync_mutation(
        _Request(), {"assignments": [{"id": "a-1", "targetId": "missing", "type": "goithau"}]}
    )
    payload = _body(response)
    assert response.status_code == 200
    assert payload["orphanedIds"] == [{"table": "phan_cong_nhan_su", "id": "a-1"}]


def test_sync_updates_existing_row_and_handles_write_time_optimistic_conflict(monkeypatch):
    current = {"id": "cdt-1", "row_version": 1, "id_goc": "root-1"}
    update_calls = 0

    def handler(sql, _params):
        nonlocal update_calls
        if sql.startswith("SELECT * FROM chu_dau_tu"):
            return _Answer(one=current)
        if sql.startswith("SELECT archived_at FROM chu_dau_tu"):
            return _Answer(one=(None,))
        if sql.startswith("SELECT row_version FROM chu_dau_tu"):
            return _Answer(one=(1,))
        if sql.startswith("UPDATE chu_dau_tu"):
            update_calls += 1
            return _Answer(rowcount=1)
        return _Answer()

    auth = _Connection(_Cursor())
    tx = _Connection(_Cursor(handler))
    _install_core_defaults(monkeypatch, [auth, tx])
    response = service.execute_sync_mutation(
        _Request(), {"chudautu": [{"id": "cdt-1", "expectedVersion": 1}]}
    )
    assert response.status_code == 200
    assert _body(response)["updatedRowVersions"][0]["rowVersion"] == 2
    assert update_calls == 1

    def conflict_handler(sql, _params):
        if sql.startswith("SELECT * FROM chu_dau_tu"):
            return _Answer(one=current)
        if sql.startswith("SELECT archived_at FROM chu_dau_tu"):
            return _Answer(one=(None,))
        if sql.startswith("SELECT row_version FROM chu_dau_tu"):
            return _Answer(one=(1,))
        if sql.startswith("UPDATE chu_dau_tu"):
            return _Answer(rowcount=0)
        return _Answer()

    auth2 = _Connection(_Cursor())
    tx2 = _Connection(_Cursor(conflict_handler))
    _install_core_defaults(monkeypatch, [auth2, tx2])
    monkeypatch.setattr(
        service,
        "rollback_sync_response",
        lambda conn, errors, message, status_code: JSONResponse({"errors": errors}, status_code=status_code),
    )
    response = service.execute_sync_mutation(
        _Request(), {"chudautu": [{"id": "cdt-1", "expectedVersion": 1}]}
    )
    assert response.status_code == 409


def test_sync_item_errors_roll_back(monkeypatch):
    class ForeignKeyError(Exception):
        sqlstate = "23503"

    monkeypatch.setattr(service, "IntegrityError", ForeignKeyError)

    def handler(sql, _params):
        if sql.startswith("INSERT INTO goi_thau"):
            return _Answer(error=ForeignKeyError("missing parent"))
        return _Answer()

    auth2 = _Connection(_Cursor())
    tx2 = _Connection(_Cursor(handler))
    _install_core_defaults(monkeypatch, [auth2, tx2])
    response = service.execute_sync_mutation(_Request(), {"goithau": [{"id": "gt-orphan"}]})
    assert response.status_code == 200
    assert _body(response)["orphanedIds"] == [{"table": "goi_thau", "id": "gt-orphan"}]
    orphan_sql = [sql for sql, _params in tx2._cursor.calls]
    assert "ROLLBACK TO SAVEPOINT sync_item" in orphan_sql
    assert "SAVEPOINT sync_orphan_cleanup" in orphan_sql
    assert "RELEASE SAVEPOINT sync_orphan_cleanup" in orphan_sql

    def cleanup_failure(sql, _params):
        if sql.startswith("INSERT INTO goi_thau"):
            return _Answer(error=ForeignKeyError("missing parent"))
        if sql.startswith("INSERT INTO deleted_records"):
            return _Answer(error=DatabaseError("cleanup failed"))
        return _Answer()

    auth3 = _Connection(_Cursor())
    tx3 = _Connection(_Cursor(cleanup_failure))
    _install_core_defaults(monkeypatch, [auth3, tx3])
    response = service.execute_sync_mutation(
        _Request(), {"goithau": [{"id": "gt-orphan-2"}]}
    )
    assert response.status_code == 200
    assert _body(response)["orphanedIds"] == []
    cleanup_sql = [sql for sql, _params in tx3._cursor.calls]
    assert "ROLLBACK TO SAVEPOINT sync_orphan_cleanup" in cleanup_sql


def test_sync_contract_reference_violation_becomes_item_error(monkeypatch):
    def handler(sql, _params):
        if sql.startswith("SELECT 1 FROM goi_thau") and "id = ? LIMIT 1" in sql:
            return _Answer(one=None)
        return _Answer()

    auth = _Connection(_Cursor())
    tx = _Connection(_Cursor(handler))
    _install_core_defaults(monkeypatch, [auth, tx])
    monkeypatch.setattr(
        service,
        "rollback_sync_response",
        lambda conn, errors, message, status_code: JSONResponse({"errors": errors}, status_code=status_code),
    )
    response = service.execute_sync_mutation(
        _Request(), {"hopdong": [{"id": "hd-1", "goiThauIds": ["gt-missing"]}]}
    )
    assert response.status_code == 400
    assert "khong thuoc owner" in _body(response)["errors"][0]["message"]


def test_sync_applies_recalculations_cleanup_broadcast_and_enrichment_fail_closed(monkeypatch):
    auth = _Connection(_Cursor())
    tx = _Connection(_Cursor())
    _install_core_defaults(monkeypatch, [auth, tx], owner_type="organization")
    recalculated = []
    deleted = []
    logs = []
    monkeypatch.setattr(
        service,
        "apply_sync_deletions",
        lambda *_args, **_kwargs: _empty_deletion_result(
            impacts=[{"count": 1}],
            affectedVersionFamilies={"goi_thau": {("root", "kh")}},
            affectedPlanIds={"kh"},
            imageCleanupCandidates={"images/nha_thau/old.png"},
        ),
    )
    monkeypatch.setattr(service, "recalculate_is_latest", lambda *args, **kwargs: recalculated.append(("latest", args, kwargs)))
    monkeypatch.setattr(service, "recalculate_tong_muc_dau_tu", lambda *args, **kwargs: recalculated.append(("total", args, kwargs)))
    monkeypatch.setattr(service, "find_unreferenced_image_paths", lambda *_args: ["images/nha_thau/old.png"])
    monkeypatch.setattr(service, "delete_managed_image_files", lambda paths: deleted.extend(paths))
    monkeypatch.setattr(service, "log_error", lambda message, *_args, **_kwargs: logs.append(str(message)))
    response = service.execute_sync_mutation(
        _Request(), {"deletions": [{"table": "goithau", "id": "gt"}], "nhathau": [{"id": "nt-1"}]},
        lambda *_args: (_ for _ in ()).throw(RuntimeError("broadcast failed")),
    )
    # Broadcast callback is intentionally inside the outer safety boundary.
    assert response.status_code == 500
    assert {item[0] for item in recalculated} == {"latest", "total"}
    assert deleted == ["images/nha_thau/old.png"]


def test_sync_masks_org_and_unexpected_errors_and_cleans_new_images_after_rollback(monkeypatch):
    auth = _Connection(_Cursor())
    _install_core_defaults(monkeypatch, [auth], owner_type="organization")
    monkeypatch.setattr(
        service,
        "get_active_org",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(OrgPermissionError("denied")),
    )
    assert service.execute_sync_mutation(_Request(), {}).status_code == 403

    auth2 = _Connection(_Cursor())
    tx2 = _Connection(_Cursor(lambda *_args: _Answer(error=RuntimeError("secret"))))
    cleanup = _Connection(_Cursor())
    _install_core_defaults(monkeypatch, [auth2, tx2, cleanup])
    monkeypatch.setattr(service, "_persist_incoming_images", lambda data, written, _org: written.add("images/nha_thau/new.png"))
    deleted = []
    monkeypatch.setattr(service, "find_unreferenced_image_paths", lambda *_args: ["images/nha_thau/new.png"])
    monkeypatch.setattr(service, "delete_managed_image_files", lambda paths: deleted.extend(paths))
    response = service.execute_sync_mutation(_Request(), {})
    assert response.status_code == 500
    assert deleted == ["images/nha_thau/new.png"]
    assert cleanup.closed == 1


def test_sync_rollback_image_cleanup_failures_are_nonfatal(monkeypatch):
    auth = _Connection(_Cursor())
    tx = _Connection(_Cursor(lambda *_args: _Answer(error=RuntimeError("boom"))))
    cleanup = _Connection(_Cursor(), close_error=False)
    _install_core_defaults(monkeypatch, [auth, tx, cleanup])
    monkeypatch.setattr(service, "_persist_incoming_images", lambda data, written, _org: written.add("images/nha_thau/new.png"))
    monkeypatch.setattr(service, "find_unreferenced_image_paths", lambda *_args: (_ for _ in ()).throw(RuntimeError("cleanup query")))
    monkeypatch.setattr(service, "delete_managed_image_files", lambda _paths: (_ for _ in ()).throw(RuntimeError("delete failed")))
    assert service.execute_sync_mutation(_Request(), {}).status_code == 500
    assert cleanup.closed == 1


@pytest.mark.parametrize("stored", ['{"status":"tx-cached"}', '{broken'])
def test_sync_idempotency_rechecks_inside_write_transaction(monkeypatch, stored):
    auth = _Connection(_Cursor(lambda _sql, _params: _Answer(one=None)))

    def tx_handler(sql, _params):
        if "FROM sync_mutations" in sql:
            return _Answer(one=(stored,))
        return _Answer()

    tx = _Connection(_Cursor(tx_handler))
    _install_core_defaults(monkeypatch, [auth, tx])
    response = service.execute_sync_mutation(
        _Request(), {"clientMutationId": "mutation-1"}
    )
    assert response.status_code == 200
    assert _body(response)["status"] == ("tx-cached" if "tx-cached" in stored else "success")
    assert tx.commits == 1
    assert tx.closed == 1
    statements = [sql for sql, _params in tx._cursor.calls]
    lock_index = next(
        index
        for index, sql in enumerate(statements)
        if "pg_advisory_xact_lock" in sql
    )
    replay_index = next(
        index
        for index, sql in enumerate(statements)
        if "FROM sync_mutations" in sql
    )
    assert lock_index < replay_index


def test_sync_serializes_typed_values_and_owns_managed_images(monkeypatch):
    schema = {
        "columns": {
            "id": "TEXT NOT NULL",
            "organization_id": "TEXT NOT NULL",
            "owner_type": "TEXT NOT NULL",
            "updated_at": "TEXT",
            "sync_version": "INTEGER",
            "id_goc": "TEXT",
            "json_col": "TEXT",
            "list_col": "TEXT",
            "cv_test": "TEXT",
            "name": "TEXT",
            "ngay_test": "TEXT",
            "happened_at": "TIMESTAMP",
            "money_col": "NUMERIC",
            "real_col": "REAL",
            "int_col": "INTEGER",
            "default_col": "TEXT DEFAULT 'FALLBACK'",
            "required_col": "TEXT NOT NULL",
            "anh_chung_chi": "TEXT",
        },
        "json_fields": ["json_col"],
    }
    auth = _Connection(_Cursor())

    def handler(sql, _params):
        if sql.startswith("SELECT anh_chung_chi FROM chuyen_gia"):
            return _Answer(one=("images/chuyen_gia/old.png",))
        return _Answer()

    tx = _Connection(_Cursor(handler))
    _install_core_defaults(monkeypatch, [auth, tx])
    monkeypatch.setattr(service, "SCHEMA_DINH_NGHIA", {"chuyen_gia": schema})
    monkeypatch.setattr(service, "MONEY_COLUMNS", {("chuyen_gia", "money_col")})
    monkeypatch.setattr(
        service,
        "iter_sync_table_payloads",
        lambda data: [("chuyengia", "chuyen_gia", data.get("chuyengia", []))],
    )
    monkeypatch.setattr(service, "canonicalize_payload_item", lambda _table, item: item)
    monkeypatch.setattr(service, "json_key_for_column", lambda _table, column: column)
    monkeypatch.setattr(service, "get_payload_value", lambda _table, item, column: item.get(column))
    monkeypatch.setattr(record_serializer, "is_datetime_column", lambda column: column == "happened_at")
    monkeypatch.setattr(record_serializer, "normalize_date_value", lambda value: f"date:{value}")
    monkeypatch.setattr(record_serializer, "normalize_datetime_value", lambda value: f"datetime:{value}")
    monkeypatch.setattr(record_serializer, "parse_vnd_amount", lambda value: 1234)
    monkeypatch.setattr(record_serializer, "safe_float", lambda value: 1.5)
    monkeypatch.setattr(record_serializer, "safe_int", lambda value: 9)
    monkeypatch.setattr(record_serializer, "normalize_managed_image_path", lambda value: str(value or ""))

    def persist(_data, written, _org):
        written.add("images/chuyen_gia/new.png")

    monkeypatch.setattr(service, "_persist_incoming_images", persist)
    captured = {}

    def commit(*args, **kwargs):
        insert = next(call for call in tx._cursor.calls if call[0].startswith("INSERT INTO chuyen_gia"))
        captured["insert"] = insert
        return {"status": "success"}

    monkeypatch.setattr(service, "commit_sync_response", commit)
    item = {
        "id": "cg-1",
        "json_col": {"a": 1},
        "list_col": None,
        "cv_test": [1, 2],
        "name": "  Name  ",
        "ngay_test": "19/07/2026",
        "happened_at": "19/07/2026 10:00",
        "money_col": "1.234",
        "real_col": "1,5",
        "int_col": "9",
        "default_col": None,
        "required_col": None,
        "anh_chung_chi": "images/chuyen_gia/new.png",
    }
    response = service.execute_sync_mutation(_Request(), {"chuyengia": [item]})
    assert response.status_code == 200
    sql, params = captured["insert"]
    assert "required_col" not in sql
    assert json.dumps({"a": 1}) in params
    assert json.dumps([1, 2]) in params
    assert "FALLBACK" in params
    assert "images/chuyen_gia/new.png" in params


def test_sync_binds_blank_optional_date_as_database_null(monkeypatch):
    schema = {
        "columns": {
            "id": "TEXT NOT NULL",
            "organization_id": "TEXT NOT NULL",
            "owner_type": "TEXT NOT NULL",
            "id_goc": "TEXT",
            "ngay_tuy_chon": "TEXT",
            "row_version": "INTEGER",
            "sync_version": "INTEGER",
            "updated_at": "TEXT",
        }
    }
    auth = _Connection(_Cursor())
    tx = _Connection(_Cursor())
    _install_core_defaults(monkeypatch, [auth, tx])
    monkeypatch.setattr(service, "SCHEMA_DINH_NGHIA", {"ke_hoach_lcnt": schema})
    monkeypatch.setattr(
        service,
        "iter_sync_table_payloads",
        lambda data: [("kehoach", "ke_hoach_lcnt", data.get("kehoach", []))],
    )
    monkeypatch.setattr(service, "canonicalize_payload_item", lambda _table, item: item)
    monkeypatch.setattr(service, "json_key_for_column", lambda _table, column: column)
    monkeypatch.setattr(service, "get_payload_value", lambda _table, item, column: item.get(column))

    response = service.execute_sync_mutation(
        _Request(),
        {"kehoach": [{"id": "kh-1", "ngay_tuy_chon": "   "}]},
    )

    assert response.status_code == 200
    insert_sql, insert_params = next(
        call for call in tx._cursor.calls if call[0].startswith("INSERT INTO ke_hoach_lcnt")
    )
    inserted_columns = [
        column.strip()
        for column in insert_sql.split("(", 1)[1].split(")", 1)[0].split(",")
    ]
    assert insert_params[inserted_columns.index("ngay_tuy_chon")] is None


@pytest.mark.parametrize("image_value", ["data:image/png;base64,AAA", "images/chuyen_gia/unowned.png"])
def test_sync_rejects_unprocessed_or_unowned_image_paths(monkeypatch, image_value):
    schema = {
        "columns": {
            "id": "TEXT NOT NULL",
            "organization_id": "TEXT NOT NULL",
            "owner_type": "TEXT NOT NULL",
            "anh_chung_chi": "TEXT",
            "row_version": "INTEGER",
        }
    }
    auth = _Connection(_Cursor())
    tx = _Connection(_Cursor())
    _install_core_defaults(monkeypatch, [auth, tx])
    monkeypatch.setattr(service, "SCHEMA_DINH_NGHIA", {"chuyen_gia": schema})
    monkeypatch.setattr(
        service,
        "iter_sync_table_payloads",
        lambda data: [("chuyengia", "chuyen_gia", data.get("chuyengia", []))],
    )
    monkeypatch.setattr(service, "canonicalize_payload_item", lambda _table, item: item)
    monkeypatch.setattr(service, "json_key_for_column", lambda _table, column: column)
    monkeypatch.setattr(service, "get_payload_value", lambda _table, item, column: item.get(column))
    monkeypatch.setattr(record_serializer, "normalize_managed_image_path", lambda value: str(value or ""))
    monkeypatch.setattr(service, "_persist_incoming_images", lambda *_args: None)
    monkeypatch.setattr(
        service,
        "rollback_sync_response",
        lambda conn, errors, message, status_code: JSONResponse({"errors": errors}, status_code=status_code),
    )
    response = service.execute_sync_mutation(
        _Request(), {"chuyengia": [{"id": "cg-1", "anh_chung_chi": image_value}]}
    )
    assert response.status_code == 400
    assert "Ảnh" in _body(response)["errors"][0]["message"]


def test_sync_contract_links_existing_packages_and_replaces_opening_children(monkeypatch):
    def handler(sql, _params):
        if sql.startswith("SELECT 1 FROM goi_thau"):
            return _Answer(one=(1,))
        return _Answer()

    auth = _Connection(_Cursor())
    tx = _Connection(_Cursor(handler))
    _install_core_defaults(monkeypatch, [auth, tx])

    def save_children(cursor, table_name, item, organization_id, *_args):
        if table_name == "thong_tin_mo_thau":
            cursor.execute(
                "DELETE FROM nha_thau_tham_du_mo_thau "
                "WHERE organization_id = ? AND thong_tin_mo_thau_id = ?",
                (organization_id, item["id"]),
            )

    monkeypatch.setattr(service, "save_child_payloads", save_children)
    response = service.execute_sync_mutation(
        _Request(),
        {
            "hopdong": [{"id": "hd-1", "goiThauIds": ["gt-1", ""]}],
            "thongtinmothau": [{"id": "opening-1"}],
        },
    )
    assert response.status_code == 200
    statements = [sql for sql, _ in tx._cursor.calls]
    sql_text = "\n".join(statements)
    assert "DELETE FROM nha_thau_tham_du_mo_thau" in sql_text
    assert "INSERT INTO hop_dong_goi_thau" in sql_text
    registry_delete_indexes = [
        index
        for index, sql in enumerate(statements)
        if sql.startswith("DELETE FROM nha_thau_tham_du_mo_thau")
    ]
    assert len(registry_delete_indexes) == 1
    savepoint_index = max(
        index
        for index, sql in enumerate(statements[: registry_delete_indexes[0]])
        if sql == "SAVEPOINT sync_item"
    )
    release_index = next(
        index
        for index, sql in enumerate(statements[registry_delete_indexes[0] :], registry_delete_indexes[0])
        if sql == "RELEASE SAVEPOINT sync_item"
    )
    assert savepoint_index < registry_delete_indexes[0] < release_index


def test_sync_post_commit_image_cleanup_failure_does_not_change_success(monkeypatch):
    auth = _Connection(_Cursor())
    tx = _Connection(_Cursor())
    _install_core_defaults(monkeypatch, [auth, tx])
    monkeypatch.setattr(
        service,
        "find_unreferenced_image_paths",
        lambda *_args: (_ for _ in ()).throw(RuntimeError("cleanup failed")),
    )
    response = service.execute_sync_mutation(_Request(), {})
    assert response.status_code == 200


def test_sync_rollback_and_close_database_errors_are_contained(monkeypatch):
    auth = _Connection(_Cursor())
    tx = _Connection(
        _Cursor(lambda *_args: _Answer(error=OrgPermissionError("denied"))),
        rollback_error=True,
        close_error=True,
    )
    _install_core_defaults(monkeypatch, [auth, tx])
    response = service.execute_sync_mutation(_Request(), {})
    assert response.status_code == 403
    assert tx.rollbacks == 1
    assert tx.closed == 1

    auth2 = _Connection(_Cursor())
    tx2 = _Connection(
        _Cursor(lambda *_args: _Answer(error=RuntimeError("boom"))),
        rollback_error=True,
        close_error=True,
    )
    _install_core_defaults(monkeypatch, [auth2, tx2])
    response = service.execute_sync_mutation(_Request(), {})
    assert response.status_code == 500
