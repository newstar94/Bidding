import json
import time
import asyncio
from types import SimpleNamespace

from starlette.responses import JSONResponse

from backend.auth import admin_user_routes
from backend.shared import access_policy
from backend.shared.access_policy import AccessDecision
from backend.sync import deletion_service
from backend.sync import record_validator
from backend.sync.payload_index import SyncPayloadIndex
from backend.sync.record_validator import SyncRecordValidator
from backend.api import org_routes
from backend.shared.subscription_policy import get_account_subscriptions_by_user_ids
from backend.sync import delete_policy
from backend.sync import uniqueness
from backend.sync import ownership


class _Answer:
    def __init__(self, *, one=None, rows=None):
        self.one = one
        self.rows = [] if rows is None else rows


class _Cursor:
    def __init__(self, handler):
        self.handler = handler
        self.answer = _Answer()
        self.calls = []

    def execute(self, sql, params=()):
        normalized = " ".join(str(sql).split())
        parameters = tuple(params)
        self.calls.append((normalized, parameters))
        self.answer = self.handler(normalized, parameters) or _Answer()
        return self

    def fetchone(self):
        return self.answer.one

    def fetchall(self):
        return list(self.answer.rows)


class _Connection:
    def __init__(self, cursor):
        self._cursor = cursor

    def cursor(self):
        return self._cursor

    def close(self):
        pass


def _subscription_row(user_id):
    return {
        "user_id": user_id,
        "package_id": "personal",
        "status": "active",
        "starts_at": 100,
        "expires_at": int(time.time()) + 3600,
        "revision": 2,
        "package_status": "active",
    }


def _measure_admin_user_queries(monkeypatch, user_count):
    users = [
        {
            "id": f"user-{index}",
            "username": f"user-{index}",
            "name": f"User {index}",
            "role": "user",
            "platform_role": "user",
            "email": f"user-{index}@example.test",
            "avatar": "",
        }
        for index in range(user_count)
    ]
    subscriptions = {row["id"]: _subscription_row(row["id"]) for row in users}

    def handler(sql, params):
        if sql.startswith("SELECT vai_tro FROM tai_khoan"):
            return _Answer(one={"vai_tro": "super_admin"})
        if sql.startswith("SELECT id, ten_dang_nhap"):
            return _Answer(rows=users)
        if "FROM account_subscriptions AS subscription" in sql:
            if " IN (" in sql:
                return _Answer(
                    rows=[subscriptions[user_id] for user_id in params if user_id in subscriptions]
                )
            row = subscriptions.get(params[0])
            return _Answer(one=row)
        return _Answer()

    cursor = _Cursor(handler)
    monkeypatch.setattr(
        admin_user_routes,
        "verify_session",
        lambda _request, required_role=None: (True, SimpleNamespace(user_id="admin")),
    )
    monkeypatch.setattr(
        admin_user_routes,
        "get_effective_roles",
        lambda _role: {"super_admin"},
    )
    monkeypatch.setattr(
        admin_user_routes.database,
        "get_connection",
        lambda: _Connection(cursor),
    )

    response = admin_user_routes._list_users_sync(SimpleNamespace(query_params={}))
    payload = json.loads(response.body.decode("utf-8"))
    assert response.status_code == 200
    assert len(payload) == user_count
    assert all(item["account_subscription"]["status"] == "active" for item in payload)
    return len(cursor.calls)


def test_admin_user_subscriptions_do_not_add_one_query_per_user(monkeypatch):
    count_for_one = _measure_admin_user_queries(monkeypatch, 1)
    count_for_many = _measure_admin_user_queries(monkeypatch, 50)

    assert count_for_many - count_for_one <= 1


def _measure_lineage_assignment_queries(version_count):
    versions = [(f"version-{index}",) for index in range(version_count)]

    def handler(sql, _params):
        if sql.startswith("SELECT id FROM goi_thau"):
            return _Answer(rows=versions)
        if "SELECT EXISTS" in sql:
            return _Answer(one=(False,))
        return _Answer()

    cursor = _Cursor(handler)
    assigned = access_policy._assigned_for_lineage(
        cursor,
        "organization-1",
        "employee-1",
        "goi_thau",
        "lineage-1",
    )
    assert assigned is False
    return len(cursor.calls)


def test_lineage_assignment_query_count_is_independent_of_version_count():
    count_for_one = _measure_lineage_assignment_queries(1)
    count_for_many = _measure_lineage_assignment_queries(50)

    assert count_for_many - count_for_one <= 1


class _DeletionCursor:
    rowcount = 1

    def __init__(self, record_count):
        self.records = {
            f"record-{index}": {
                "id": f"record-{index}",
                "id_goc": f"record-{index}",
                "row_version": 1,
                "archived_at": None,
            }
            for index in range(record_count)
        }
        self.calls = []
        self.answer = _Answer()

    def execute(self, sql, params=()):
        normalized = " ".join(str(sql).split())
        parameters = tuple(params)
        self.calls.append((normalized, parameters))
        if normalized.startswith("SELECT * FROM chu_dau_tu"):
            if " IN (" in normalized:
                rows = [self.records[value] for value in parameters[1:] if value in self.records]
                self.answer = _Answer(rows=rows)
            else:
                self.answer = _Answer(one=self.records.get(parameters[1]))
        elif normalized.startswith("SELECT COUNT(*)"):
            self.answer = _Answer(one=(0,))
        elif "GROUP BY" in normalized:
            self.answer = _Answer(rows=[])
        else:
            self.answer = _Answer()
        return self

    def fetchone(self):
        return self.answer.one

    def fetchall(self):
        return list(self.answer.rows)


def _measure_delete_reference_queries(monkeypatch, record_count):
    cursor = _DeletionCursor(record_count)
    monkeypatch.setattr(
        deletion_service,
        "authorize_record_write_from_context",
        lambda *_args: AccessDecision(True),
    )
    monkeypatch.setattr(
        deletion_service,
        "build_batch_write_authorization_context",
        lambda *_args: SimpleNamespace(organization_manager=True),
    )
    monkeypatch.setattr(
        deletion_service,
        "insert_delete_audit",
        lambda *_args, **_kwargs: None,
    )
    result = deletion_service.apply_sync_deletions(
        cursor,
        [
            {
                "table": "chudautu",
                "id": f"record-{index}",
                "expectedVersion": 1,
            }
            for index in range(record_count)
        ],
        organization_id="organization-1",
        actor_role="manager",
        actor_user_id="manager-1",
        current_time="2026-07-27 12:00:00",
        sync_version=2,
        clean_record_id=lambda _table, value: str(value) if value else None,
        ip_address="127.0.0.1",
    )
    assert result["errors"] == []
    assert len(result["impacts"]) == record_count
    return sum(
        sql.startswith("SELECT COUNT(*)") or " GROUP BY " in sql
        for sql, _params in cursor.calls
    )


def test_delete_reference_queries_scale_by_rule_not_record(monkeypatch):
    count_for_one = _measure_delete_reference_queries(monkeypatch, 1)
    count_for_many = _measure_delete_reference_queries(monkeypatch, 50)

    assert count_for_many - count_for_one <= 1


def _measure_sync_authorization_queries(monkeypatch, record_count):
    items = [
        {
            "id": f"package-{index}",
            "rootId": f"package-{index}",
            "expectedVersion": 1,
        }
        for index in range(record_count)
    ]

    def handler(sql, params):
        if sql.startswith("SELECT name FROM danh_muc_trang_thai_hop_dong"):
            return _Answer(rows=[])
        if sql.startswith("SELECT * FROM goi_thau"):
            return _Answer(
                rows=[
                    {
                        "id": record_id,
                        "id_goc": record_id,
                        "row_version": 1,
                        "archived_at": None,
                        "organization_id": "organization-1",
                    }
                    for record_id in params[1:]
                ]
            )
        if sql.startswith("SELECT lower(trim(vai_tro_trong_to_chuc))"):
            return _Answer(one=("employee",))
        if sql.startswith("SELECT goithau FROM ma_tran_phan_quyen"):
            return _Answer(one=("edit",))
        if sql.startswith("SELECT id, COALESCE(NULLIF(id_goc"):
            candidate_count = (len(params) - 1) // 2
            return _Answer(
                rows=[
                    {"id": record_id, "lineage_root": record_id}
                    for record_id in params[1:1 + candidate_count]
                ]
            )
        if sql.startswith("SELECT DISTINCT COALESCE(NULLIF(record.id_goc"):
            return _Answer(
                rows=[{"lineage_root": record_id} for record_id in params[3:]]
            )
        if sql.startswith("SELECT id_muc_tieu, loai_doi_tuong"):
            return _Answer(rows=[(record_id, "goithau") for record_id in params[1:]])
        if sql.startswith("SELECT 1 FROM phan_cong_nhan_su"):
            return _Answer(one=(1,))
        if sql.startswith("SELECT COALESCE(NULLIF(id_goc"):
            return _Answer(one=(params[1],))
        if sql.startswith("SELECT EXISTS"):
            return _Answer(one=(True,))
        return _Answer()

    cursor = _Cursor(handler)
    payload = {"goithau": items}
    clean_record_id = lambda _table, value: str(value) if value else None
    payload_index = SyncPayloadIndex.build(payload, clean_record_id)
    transaction = SimpleNamespace(
        cursor=cursor,
        actor=SimpleNamespace(
            organization_id="organization-1",
            user_id="employee-1",
            role="employee",
        ),
        owner_type="organization",
    )
    monkeypatch.setattr(
        record_validator,
        "validate_opening_participant_uniqueness",
        lambda *_args: [],
    )
    monkeypatch.setattr(
        record_validator,
        "validate_sync_item",
        lambda _table, item, _statuses: (item, [], set()),
    )
    monkeypatch.setattr(
        record_validator,
        "build_owner_reference_context",
        lambda *_args: SimpleNamespace(),
    )
    monkeypatch.setattr(
        record_validator,
        "validate_owner_scoped_references",
        lambda *_args: [],
    )
    monkeypatch.setattr(
        record_validator,
        "build_domain_uniqueness_context",
        lambda *_args: SimpleNamespace(candidates={}),
    )
    monkeypatch.setattr(
        record_validator,
        "validate_domain_uniqueness_from_context",
        lambda *_args: [],
    )
    validator = SyncRecordValidator(
        transaction,
        payload,
        payload_index,
        SimpleNamespace(record_orphan=lambda *_args: None),
        clean_record_id=clean_record_id,
        schema_definition={
            "goi_thau": {
                "columns": {
                    "row_version": "INTEGER",
                    "archived_at": "TEXT",
                }
            }
        },
        iter_payloads=lambda value: [("goithau", "goi_thau", value["goithau"])],
        canonicalize_item=lambda _table, item: item,
    )

    assert validator.validate_payload() == []
    return len(cursor.calls)


def test_sync_authorization_queries_do_not_scale_with_record_count(monkeypatch):
    count_for_one = _measure_sync_authorization_queries(monkeypatch, 1)
    count_for_many = _measure_sync_authorization_queries(monkeypatch, 50)

    assert count_for_many - count_for_one <= 1


class _OrganizationRemovalCursor:
    rowcount = 1

    def __init__(self, item_count):
        self.calls = []
        self.answer = _Answer()
        self.assignments = [
            {
                "id": f"assignment-{index}",
                "id_nhan_vien": "removed-user",
                "id_muc_tieu": f"plan-{index}",
                "loai_doi_tuong": "kehoach",
                "created_at": "2026-01-01 00:00:00",
            }
            for index in range(item_count)
        ]
        self.permissions = [{"id": f"permission-{index}"} for index in range(item_count)]

    def execute(self, sql, params=()):
        normalized = " ".join(str(sql).split())
        parameters = tuple(params)
        self.calls.append((normalized, parameters))
        if normalized.startswith("SELECT vai_tro_trong_to_chuc"):
            self.answer = _Answer(one=("employee",))
        elif normalized.startswith("SELECT pc.*"):
            self.answer = _Answer(rows=self.assignments)
        elif normalized.startswith("SELECT id FROM ma_tran_phan_quyen"):
            self.answer = _Answer(rows=self.permissions)
        elif "RETURNING" in normalized:
            self.answer = _Answer(rows=self.permissions)
        else:
            self.answer = _Answer()
        return self

    def executemany(self, sql, params):
        normalized = " ".join(str(sql).split())
        self.calls.append((normalized, tuple(tuple(row) for row in params)))
        self.answer = _Answer()
        return self

    def fetchone(self):
        return self.answer.one

    def fetchall(self):
        return list(self.answer.rows)


class _OrganizationRemovalConnection(_Connection):
    def __init__(self, cursor):
        super().__init__(cursor)
        self.commits = 0
        self.rollbacks = 0

    def execute(self, sql, params=()):
        return self._cursor.execute(sql, params)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


def _measure_organization_removal_queries(monkeypatch, item_count):
    cursor = _OrganizationRemovalCursor(item_count)
    connection = _OrganizationRemovalConnection(cursor)
    session = SimpleNamespace(user_id="manager-1")

    async def read_payload(_request):
        return {"user_id": "removed-user"}, None

    monkeypatch.setattr(org_routes, "read_json_object", read_payload)
    monkeypatch.setattr(org_routes, "verify_session", lambda _request: (True, session))
    monkeypatch.setattr(org_routes, "get_active_org", lambda *_args: "organization-1")
    monkeypatch.setattr(org_routes.database, "get_connection", lambda: connection)
    monkeypatch.setattr(org_routes, "is_business_organization", lambda *_args: True)
    monkeypatch.setattr(org_routes, "is_organization_manager", lambda *_args: True)
    monkeypatch.setattr(org_routes, "next_sync_version", lambda *_args: 2)
    monkeypatch.setattr(org_routes, "vietnam_now_sql", lambda: "2026-07-27 12:00:00")
    monkeypatch.setattr(org_routes, "snapshot_assignment_state", lambda *_args: {})
    monkeypatch.setattr(org_routes, "queue_assignment_state_changes", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(org_routes, "queue_membership_notification", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(org_routes, "log_audit", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(org_routes, "disconnect_user_websockets", lambda *_args: None)
    monkeypatch.setattr(org_routes, "broadcast_websocket_event", lambda *_args: None)

    response = asyncio.run(
        org_routes.remove_user_from_org_api(SimpleNamespace())
    )
    payload = json.loads(response.body.decode("utf-8"))
    assert response.status_code == 200
    assert payload["deleteImpact"]["assignments"] == item_count
    assert payload["deleteImpact"]["permissionRows"] == item_count
    mutation_prefixes = (
        "INSERT INTO phan_cong_nhan_su_lich_su",
        "DELETE FROM phan_cong_nhan_su",
        "UPDATE phan_cong_nhan_su",
        "DELETE FROM ma_tran_phan_quyen",
        "INSERT INTO deleted_records",
        "WITH deleted_permissions AS",
    )
    return sum(sql.startswith(mutation_prefixes) for sql, _params in cursor.calls)


def test_organization_member_cleanup_queries_do_not_scale_per_row(monkeypatch):
    count_for_one = _measure_organization_removal_queries(monkeypatch, 1)
    count_for_many = _measure_organization_removal_queries(monkeypatch, 50)

    assert count_for_many - count_for_one <= 2


def test_account_subscription_batch_handles_empty_missing_and_statuses():
    now = int(time.time())
    rows = {
        "active": {
            **_subscription_row("active"),
            "expires_at": now + 3600,
        },
        "expired": {
            **_subscription_row("expired"),
            "expires_at": now - 1,
        },
        "inactive-package": {
            **_subscription_row("inactive-package"),
            "package_status": "disabled",
        },
    }
    cursor = _Cursor(
        lambda sql, params: _Answer(
            rows=[rows[user_id] for user_id in params if user_id in rows]
        ) if "FROM account_subscriptions AS subscription" in sql else _Answer()
    )

    assert get_account_subscriptions_by_user_ids(cursor, []) == {}
    assert cursor.calls == []
    subscriptions = get_account_subscriptions_by_user_ids(
        cursor,
        ["active", "missing", "expired", "inactive-package"],
    )

    assert subscriptions["active"]["status"] == "active"
    assert "missing" not in subscriptions
    assert subscriptions["expired"]["status"] == "expired"
    assert subscriptions["inactive-package"]["status"] == "package_inactive"
    assert len(cursor.calls) == 1


def test_account_subscription_batch_is_chunked_and_deduplicated():
    cursor = _Cursor(lambda _sql, _params: _Answer(rows=[]))
    user_ids = [f"user-{index}" for index in range(501)] + ["user-0"]

    assert get_account_subscriptions_by_user_ids(cursor, user_ids) == {}
    assert len(cursor.calls) == 2
    assert len(cursor.calls[0][1]) == 500
    assert len(cursor.calls[1][1]) == 1


def test_lineage_assignment_query_keeps_tenant_and_employee_filters():
    cursor = _Cursor(lambda _sql, _params: _Answer(one=(True,)))

    assert access_policy._assigned_for_lineage(
        cursor,
        "organization-1",
        "employee-1",
        "goi_thau",
        "root-1",
    )
    sql, params = cursor.calls[0]
    assert "record.organization_id = ?" in sql
    assert "assignment.organization_id = record.organization_id" in sql
    assert "assignment.id_nhan_vien = ?" in sql
    assert params == ("goithau", "organization-1", "root-1", "employee-1")


def test_delete_reference_batch_preserves_rule_order_and_tenant_scope():
    rules = (
        delete_policy.DeleteReferenceRule("child_a", "parent_id", "A"),
        delete_policy.DeleteReferenceRule("child_b", "owner_id", "B"),
    )

    def handler(sql, _params):
        if "FROM child_a" in sql:
            return _Answer(rows=[("record-1", 2)])
        if "FROM child_b" in sql:
            return _Answer(rows=[("record-1", 1), ("record-2", 3)])
        return _Answer()

    cursor = _Cursor(handler)
    references = delete_policy.find_blocking_delete_references_by_record_ids(
        cursor,
        "organization-1",
        "parent",
        ["record-1", "record-2"],
        rules=rules,
    )

    assert references["record-1"] == [
        {"table": "child_a", "column": "parent_id", "label": "A", "count": 2},
        {"table": "child_b", "column": "owner_id", "label": "B", "count": 1},
    ]
    assert references["record-2"] == [
        {"table": "child_b", "column": "owner_id", "label": "B", "count": 3}
    ]
    assert all(params[0] == "organization-1" for _sql, params in cursor.calls)


def test_assignment_departure_helpers_preserve_successors_and_chunking():
    cursor = _OrganizationRemovalCursor(0)
    assignments = [
        {
            "id": "delete-me",
            "id_muc_tieu": "plan-1",
            "loai_doi_tuong": "kehoach",
            "created_at": "2026-01-01 00:00:00",
        },
        {
            "id": "transfer-me",
            "id_muc_tieu": "package-1",
            "loai_doi_tuong": "goithau",
            "created_at": "2026-01-02 00:00:00",
        },
    ]
    changes = [
        (assignments[0], None, True),
        (assignments[1], "successor-1", False),
    ]

    org_routes._insert_assignment_departure_history(
        cursor,
        "organization-1",
        "removed-user",
        changes,
        "2026-07-27 12:00:00",
        "manager-1",
    )
    org_routes._apply_assignment_departures(
        cursor,
        "organization-1",
        changes,
        7,
        "2026-07-27 12:00:00",
    )

    assert len(cursor.calls) == 3
    assert cursor.calls[0][0].startswith("INSERT INTO phan_cong_nhan_su_lich_su")
    assert cursor.calls[1][0].startswith("DELETE FROM phan_cong_nhan_su")
    assert cursor.calls[2][0].startswith("UPDATE phan_cong_nhan_su AS assignment")
    assert "successor-1" in cursor.calls[0][1]
    assert "successor-1" in cursor.calls[2][1]


def test_assignment_departure_history_chunks_large_batches():
    cursor = _OrganizationRemovalCursor(0)
    changes = [
        (
            {
                "id": f"assignment-{index}",
                "id_muc_tieu": f"plan-{index}",
                "loai_doi_tuong": "kehoach",
                "created_at": "2026-01-01 00:00:00",
            },
            None,
            True,
        )
        for index in range(501)
    ]

    org_routes._insert_assignment_departure_history(
        cursor,
        "organization-1",
        "removed-user",
        changes,
        "2026-07-27 12:00:00",
        "manager-1",
    )
    org_routes._apply_assignment_departures(
        cursor,
        "organization-1",
        changes,
        7,
        "2026-07-27 12:00:00",
    )

    history_calls = [sql for sql, _params in cursor.calls if sql.startswith("INSERT INTO phan_cong_nhan_su_lich_su")]
    delete_calls = [sql for sql, _params in cursor.calls if sql.startswith("DELETE FROM phan_cong_nhan_su")]
    assert len(history_calls) == 2
    assert len(delete_calls) == 2


def _measure_sync_uniqueness_queries(monkeypatch, record_count):
    items = [
        {
            "id": f"status-{index}",
            "name": f"Status {index}",
        }
        for index in range(record_count)
    ]

    def handler(sql, _params):
        if sql.startswith("SELECT name FROM danh_muc_trang_thai_hop_dong"):
            return _Answer(rows=[])
        if sql.startswith("SELECT lower(trim(vai_tro_trong_to_chuc))"):
            return _Answer(one=("employee",))
        if sql.startswith("SELECT hopdong FROM ma_tran_phan_quyen"):
            return _Answer(one=("edit",))
        return _Answer()

    cursor = _Cursor(handler)
    payload = {"customcontractstatuses": items}
    clean_record_id = lambda _table, value: str(value) if value else None
    payload_index = SyncPayloadIndex.build(payload, clean_record_id)
    monkeypatch.setattr(
        record_validator,
        "validate_opening_participant_uniqueness",
        lambda *_args: [],
    )
    monkeypatch.setattr(
        record_validator,
        "validate_sync_item",
        lambda _table, item, _statuses: (item, [], set()),
    )
    monkeypatch.setattr(
        record_validator,
        "build_owner_reference_context",
        lambda *_args: SimpleNamespace(),
    )
    monkeypatch.setattr(
        record_validator,
        "validate_owner_scoped_references",
        lambda *_args: [],
    )
    validator = SyncRecordValidator(
        SimpleNamespace(
            cursor=cursor,
            actor=SimpleNamespace(
                organization_id="organization-1",
                user_id="employee-1",
                role="super_admin",
            ),
            owner_type="organization",
        ),
        payload,
        payload_index,
        SimpleNamespace(record_orphan=lambda *_args: None),
        clean_record_id=clean_record_id,
        schema_definition={
            "danh_muc_trang_thai_hop_dong": {"columns": {"name": "TEXT"}}
        },
        iter_payloads=lambda value: [
            (
                "customcontractstatuses",
                "danh_muc_trang_thai_hop_dong",
                value["customcontractstatuses"],
            )
        ],
        canonicalize_item=lambda _table, item: item,
    )

    assert validator.validate_payload() == []
    return len(cursor.calls)


def test_sync_domain_uniqueness_queries_do_not_scale_per_record(monkeypatch):
    count_for_one = _measure_sync_uniqueness_queries(monkeypatch, 1)
    count_for_many = _measure_sync_uniqueness_queries(monkeypatch, 50)

    assert count_for_many - count_for_one <= 1


def test_batched_uniqueness_preserves_lineage_and_conflicting_id_behavior():
    context = uniqueness.DomainUniquenessContext(candidates={
        ("chu_dau_tu", "code", "investor-code"): [
            ("same-lineage-version", "root-1"),
            ("other-lineage", "root-2"),
        ],
    })

    errors = uniqueness.validate_domain_uniqueness_from_context(
        context,
        "chu_dau_tu",
        {"maChuDauTu": " Investor-Code "},
        "current-version",
        "root-1",
    )

    assert errors == [{
        "message": "Mã chủ đầu tư 'Investor-Code' đã tồn tại.",
        "conflictingId": "other-lineage",
    }]
    assert uniqueness.validate_domain_uniqueness_from_context(
        context,
        "chu_dau_tu",
        {"maChuDauTu": "Investor-Code"},
        None,
        None,
    ) == []


def test_uniqueness_prefetch_is_tenant_scoped_and_chunked():
    cursor = _Cursor(lambda _sql, _params: _Answer(rows=[]))
    records = {
        "danh_muc_trang_thai_hop_dong": [
            {"id": f"status-{index}", "name": f"Status {index}"}
            for index in range(501)
        ]
    }

    context = uniqueness.build_domain_uniqueness_context(
        cursor,
        "organization-1",
        records,
    )

    assert context.candidates == {}
    assert len(cursor.calls) == 2
    assert all(params[0] == "organization-1" for _sql, params in cursor.calls)
    assert all("organization_id = ?" in sql for sql, _params in cursor.calls)


def _measure_owner_reference_queries(record_count):
    records = {
        "goi_thau": [
            {"id": f"package-{index}", "keHoachId": f"plan-{index}"}
            for index in range(record_count)
        ]
    }

    def handler(sql, params):
        if "FROM ke_hoach_lcnt" in sql:
            return _Answer(
                rows=[(plan_id, plan_id) for plan_id in params[1:]]
            )
        return _Answer(rows=[])

    cursor = _Cursor(handler)
    context = ownership.build_owner_reference_context(
        cursor,
        "organization-1",
        records,
        {},
    )
    for item in records["goi_thau"]:
        assert ownership.validate_owner_scoped_references(
            cursor,
            "organization-1",
            "goi_thau",
            item,
            {},
            records,
            context,
        ) == []
    return len(cursor.calls)


def test_owner_reference_queries_do_not_scale_per_record():
    count_for_one = _measure_owner_reference_queries(1)
    count_for_many = _measure_owner_reference_queries(50)

    assert count_for_many - count_for_one <= 1


def test_owner_reference_context_rejects_cross_tenant_or_archived_ids():
    cursor = _Cursor(lambda _sql, _params: _Answer(rows=[]))
    item = {"id": "package-1", "keHoachId": "foreign-plan"}
    records = {"goi_thau": [item]}
    context = ownership.build_owner_reference_context(
        cursor,
        "organization-1",
        records,
        {},
    )

    errors = ownership.validate_owner_scoped_references(
        cursor,
        "organization-1",
        "goi_thau",
        item,
        {},
        records,
        context,
    )

    assert errors == [
        "Tham chieu ke_hoach_id=foreign-plan khong thuoc owner hien tai."
    ]
    assert cursor.calls[0][1][0] == "organization-1"


def _measure_rebid_and_winner_reference_queries(record_count, *, cycle=False):
    records = {
        "goi_thau": [
            {
                "id": f"package-{index}",
                "rebidFromPackageId": f"source-{index}",
                "nhaThauTrungThauId": f"winner-{index}",
            }
            for index in range(record_count)
        ]
    }

    def handler(sql, params):
        if "FROM goi_thau" in sql and "source_chain" not in sql:
            return _Answer(
                rows=[
                    {
                        "id": record_id,
                        "lineage_root": record_id,
                        "ke_hoach_id": None,
                        "phan_lo": "Không",
                        "trang_thai": "Hủy thầu",
                    }
                    for record_id in params[1:]
                ]
            )
        if "FROM nha_thau" in sql and "requested" not in sql:
            return _Answer(rows=[(record_id, record_id) for record_id in params[1:]])
        if "source_chain" in sql:
            return _Answer(rows=[("package-0",)] if cycle else [])
        if "thong_tin_mo_thau AS opening" in sql:
            request_values = params[:-1]
            return _Answer(rows=[
                (
                    request_values[index],
                    request_values[index + 1],
                    f"opening-{index // 3}",
                    "Đạt",
                )
                for index in range(0, len(request_values), 3)
            ])
        return _Answer(rows=[])

    cursor = _Cursor(handler)
    context = ownership.build_owner_reference_context(
        cursor,
        "organization-1",
        records,
        {},
    )
    errors = []
    for item in records["goi_thau"]:
        errors.extend(ownership.validate_owner_scoped_references(
            cursor,
            "organization-1",
            "goi_thau",
            item,
            {},
            records,
            context,
        ))
    return len(cursor.calls), errors


def test_rebid_and_winner_queries_are_batched_and_keep_cycle_validation():
    count_for_one, one_errors = _measure_rebid_and_winner_reference_queries(1)
    count_for_many, many_errors = _measure_rebid_and_winner_reference_queries(50)
    _cycle_count, cycle_errors = _measure_rebid_and_winner_reference_queries(
        2,
        cycle=True,
    )

    assert one_errors == []
    assert many_errors == []
    assert count_for_many - count_for_one <= 1
    assert any("vòng tham chiếu" in error for error in cycle_errors)


def test_batch_authorization_decisions_preserve_assignment_and_membership_rules():
    context = access_policy.BatchWriteAuthorizationContext(
        role_str="employee",
        user_id="employee-1",
        organization_id="organization-1",
        organization_manager=False,
        personal_workspace_owner=False,
        active_membership=True,
        inherited_specialist_access=False,
        membership_role="employee",
        permissions={"goithau": "edit"},
        lineage_root_by_item={("goi_thau", "package-1"): "root-1"},
        assigned_lineages={("goi_thau", "root-1")},
    )

    assert access_policy.authorize_record_write_from_context(
        context,
        "goithau",
        "goi_thau",
        {"id": "package-1"},
    ).allowed
    context.assigned_lineages.clear()
    denied = access_policy.authorize_record_write_from_context(
        context,
        "goithau",
        "goi_thau",
        {"id": "package-1"},
    )
    assert not denied.allowed
    assert denied.message == "Không có quyền sửa bản ghi chưa được phân công."

    context.active_membership = False
    shared_denied = access_policy.authorize_record_write_from_context(
        context,
        "chudautu",
        "chu_dau_tu",
        {"id": "investor-1"},
    )
    assert not shared_denied.allowed
    assert shared_denied.message == "Tài khoản không còn thuộc tổ chức này."


def test_mixed_table_deletions_preserve_child_before_parent_order(monkeypatch):
    class MixedCursor:
        rowcount = 1

        def __init__(self):
            self.calls = []
            self.answer = _Answer()

        def execute(self, sql, params=()):
            normalized = " ".join(str(sql).split())
            parameters = tuple(params)
            self.calls.append((normalized, parameters))
            if normalized.startswith("SELECT * FROM goi_thau"):
                self.answer = _Answer(rows=[{
                    "id": "package-1",
                    "id_goc": "package-1",
                    "ke_hoach_id": "plan-1",
                    "row_version": 1,
                    "archived_at": None,
                }])
            elif normalized.startswith("SELECT * FROM ke_hoach_lcnt"):
                self.answer = _Answer(rows=[{
                    "id": "plan-1",
                    "id_goc": "plan-1",
                    "row_version": 1,
                    "archived_at": None,
                }])
            elif normalized.startswith(
                "SELECT ke_hoach_id, COUNT(*) FROM goi_thau"
            ):
                self.answer = _Answer(rows=[("plan-1", 1)])
            elif "GROUP BY" in normalized:
                self.answer = _Answer(rows=[])
            else:
                self.answer = _Answer()
            return self

        def fetchone(self):
            return self.answer.one

        def fetchall(self):
            return list(self.answer.rows)

    cursor = MixedCursor()
    monkeypatch.setattr(
        deletion_service,
        "build_batch_write_authorization_context",
        lambda *_args: SimpleNamespace(organization_manager=True),
    )
    monkeypatch.setattr(
        deletion_service,
        "authorize_record_write_from_context",
        lambda *_args: AccessDecision(True),
    )
    monkeypatch.setattr(
        deletion_service,
        "insert_delete_audit",
        lambda *_args, **_kwargs: None,
    )

    result = deletion_service.apply_sync_deletions(
        cursor,
        [
            {"table": "goithau", "id": "package-1", "expectedVersion": 1},
            {"table": "kehoach", "id": "plan-1", "expectedVersion": 1},
        ],
        organization_id="organization-1",
        actor_role="manager",
        actor_user_id="manager-1",
        current_time="2026-07-27 12:00:00",
        sync_version=2,
        clean_record_id=lambda _table, value: str(value) if value else None,
        ip_address="127.0.0.1",
    )

    assert result["errors"] == []
    assert [impact["action"] for impact in result["impacts"]] == [
        "deleted",
        "deleted",
    ]
    select_calls = [sql for sql, _params in cursor.calls if sql.startswith("SELECT * FROM")]
    assert len(select_calls) == 2
    assert all(" IN (" in sql and " LIMIT 1" not in sql for sql in select_calls)


def test_organization_member_bulk_failure_rolls_back_transaction(monkeypatch):
    class FailingCursor(_OrganizationRemovalCursor):
        def execute(self, sql, params=()):
            if "INSERT INTO phan_cong_nhan_su_lich_su" in str(sql):
                raise RuntimeError("bulk history failed")
            return super().execute(sql, params)

    cursor = FailingCursor(1)
    connection = _OrganizationRemovalConnection(cursor)
    session = SimpleNamespace(user_id="manager-1")

    async def read_payload(_request):
        return {"user_id": "removed-user"}, None

    monkeypatch.setattr(org_routes, "read_json_object", read_payload)
    monkeypatch.setattr(org_routes, "verify_session", lambda _request: (True, session))
    monkeypatch.setattr(org_routes, "get_active_org", lambda *_args: "organization-1")
    monkeypatch.setattr(org_routes.database, "get_connection", lambda: connection)
    monkeypatch.setattr(org_routes, "is_business_organization", lambda *_args: True)
    monkeypatch.setattr(org_routes, "is_organization_manager", lambda *_args: True)
    monkeypatch.setattr(org_routes, "next_sync_version", lambda *_args: 2)
    monkeypatch.setattr(org_routes, "vietnam_now_sql", lambda: "2026-07-27 12:00:00")
    monkeypatch.setattr(org_routes, "snapshot_assignment_state", lambda *_args: {})
    monkeypatch.setattr(org_routes, "log_and_error", lambda *_args, **_kwargs: JSONResponse(
        {"error": "failed"},
        status_code=500,
    ))

    response = asyncio.run(org_routes.remove_user_from_org_api(SimpleNamespace()))

    assert response.status_code == 500
    assert connection.rollbacks == 1
    assert connection.commits == 0


def _measure_mixed_table_record_queries(monkeypatch, pair_count):
    class MixedCountingCursor:
        rowcount = 1

        def __init__(self):
            self.calls = []
            self.answer = _Answer()

        def execute(self, sql, params=()):
            normalized = " ".join(str(sql).split())
            parameters = tuple(params)
            self.calls.append((normalized, parameters))
            if normalized.startswith("SELECT * FROM"):
                if " IN (" in normalized:
                    self.answer = _Answer(rows=[
                        {
                            "id": record_id,
                            "id_goc": record_id,
                            "row_version": 1,
                            "archived_at": None,
                        }
                        for record_id in parameters[1:]
                    ])
                else:
                    self.answer = _Answer(one={
                        "id": parameters[1],
                        "id_goc": parameters[1],
                        "row_version": 1,
                        "archived_at": None,
                    })
            else:
                self.answer = _Answer(rows=[])
            return self

        def fetchone(self):
            return self.answer.one

        def fetchall(self):
            return list(self.answer.rows)

    cursor = MixedCountingCursor()
    monkeypatch.setattr(
        deletion_service,
        "build_batch_write_authorization_context",
        lambda *_args: SimpleNamespace(organization_manager=True),
    )
    monkeypatch.setattr(
        deletion_service,
        "authorize_record_write_from_context",
        lambda *_args: AccessDecision(True),
    )
    monkeypatch.setattr(
        deletion_service,
        "insert_delete_audit",
        lambda *_args, **_kwargs: None,
    )
    deletions = []
    for index in range(pair_count):
        deletions.extend((
            {"table": "chudautu", "id": f"investor-{index}", "expectedVersion": 1},
            {"table": "nhathau", "id": f"contractor-{index}", "expectedVersion": 1},
        ))

    result = deletion_service.apply_sync_deletions(
        cursor,
        deletions,
        organization_id="organization-1",
        actor_role="manager",
        actor_user_id="manager-1",
        current_time="2026-07-27 12:00:00",
        sync_version=2,
        clean_record_id=lambda _table, value: str(value) if value else None,
        ip_address="127.0.0.1",
    )

    assert result["errors"] == []
    assert len(result["impacts"]) == pair_count * 2
    return sum(sql.startswith("SELECT * FROM") for sql, _params in cursor.calls)


def test_mixed_table_record_queries_scale_by_table_not_record(monkeypatch):
    count_for_one_pair = _measure_mixed_table_record_queries(monkeypatch, 1)
    count_for_many_pairs = _measure_mixed_table_record_queries(monkeypatch, 50)
    count_across_chunk_boundary = _measure_mixed_table_record_queries(
        monkeypatch,
        501,
    )

    assert count_for_many_pairs == count_for_one_pair
    assert count_across_chunk_boundary - count_for_one_pair == 2
