from types import SimpleNamespace

import pytest

from backend.shared import access_policy


class HierarchyCursor:
    """Serve tenant-scoped authority rows without a database connection."""

    def __init__(self, owner_id="owner", memberships=None, owner_row_exists=True, stored_assignments=None):
        self.owner_id = owner_id
        self.owner_row_exists = owner_row_exists
        self.memberships = memberships if memberships is not None else {
            ("org", "owner"): ("manager", "active"),
            ("org", "appointed"): ("manager", "active"),
            ("org", "peer"): ("manager", "active"),
            ("org", "employee"): ("employee", "active"),
        }
        self.statements = []
        self.rows = []
        self.stored_assignments = stored_assignments or {}
        self.rowcount = 0

    def execute(self, statement, params=()):
        sql = " ".join(statement.split())
        self.statements.append((sql, params))
        if "SELECT lower(trim(vai_tro_trong_to_chuc))" in sql:
            user_id, organization_id = params
            membership = self.memberships.get((organization_id, user_id))
            self.rows = (
                [(membership[0].strip().lower(),)]
                if membership and membership[1] in {None, "active"}
                else []
            )
        elif "SELECT owner_user_id FROM to_chuc" in sql:
            self.rows = (
                [(self.owner_id,)]
                if self.owner_row_exists and params == ("org",)
                else []
            )
        elif "SELECT user_id FROM thanh_vien_to_chuc" in sql:
            organization_id, *user_ids = params
            self.rows = [
                (user_id,)
                for user_id in user_ids
                if (membership := self.memberships.get((organization_id, user_id)))
                and membership[0].strip().lower() == "manager"
                and membership[1] in {None, "active"}
            ]
        elif "FROM hop_dong" in sql:
            self.rows = [("contract",)] if "contract" in params[1:] else []
        elif "FROM ma_tran_phan_quyen" in sql:
            self.rows = [("edit",)]
        elif "SELECT id_nhan_vien FROM phan_cong_nhan_su" in sql:
            organization_id, assignment_id = params
            record = self.stored_assignments.get(assignment_id)
            self.rows = (
                [(record["id_nhan_vien"],)]
                if record and record["organization_id"] == organization_id
                else []
            )
        elif "SELECT id, id_nhan_vien FROM phan_cong_nhan_su" in sql:
            organization_id, *assignment_ids = params
            self.rows = [
                (assignment_id, record["id_nhan_vien"])
                for assignment_id in assignment_ids
                if (record := self.stored_assignments.get(assignment_id))
                and record["organization_id"] == organization_id
            ]
        elif "SELECT * FROM phan_cong_nhan_su" in sql:
            organization_id, *assignment_ids = params
            self.rows = [
                record.copy()
                for assignment_id in assignment_ids
                if (record := self.stored_assignments.get(assignment_id))
                and record["organization_id"] == organization_id
            ]
        elif sql.startswith("DELETE FROM phan_cong_nhan_su"):
            organization_id, assignment_id, version = params
            record = self.stored_assignments.get(assignment_id)
            self.rowcount = int(bool(
                record and record["organization_id"] == organization_id
                and record["row_version"] == version
            ))
            if self.rowcount:
                self.stored_assignments.pop(assignment_id)
            self.rows = []
        elif sql.startswith(("SAVEPOINT", "RELEASE SAVEPOINT", "INSERT INTO deleted_records", "UPDATE deleted_records")):
            self.rows = []
        elif "FROM phan_cong_nhan_su" in sql:
            self.rows = []
        elif "SELECT min_available_version FROM sync_metadata" in sql:
            self.rows = []
        else:
            raise AssertionError(f"Unexpected authority query: {sql}")
        return self

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return self.rows


def _assignment(employee_id):
    return {
        "id": f"assignment-{employee_id}",
        "empId": employee_id,
        "targetId": "contract",
        "type": "hopdong",
    }


def test_appointed_manager_cannot_assign_peer_in_single_or_sync_batch():
    item = _assignment("peer")
    cursor = HierarchyCursor()
    single = access_policy.authorize_record_write(
        cursor, "user", "appointed", "org", "assignments", "phan_cong_nhan_su", item,
    )
    context = access_policy.build_batch_write_authorization_context(
        cursor, "user", "appointed", "org", {"phan_cong_nhan_su": [item]},
    )
    batch = access_policy.authorize_record_write_from_context(
        context, "assignments", "phan_cong_nhan_su", item,
    )

    assert not single.allowed
    assert not batch.allowed
    assert batch == single


@pytest.mark.parametrize("change", [{"targetId": "other-contract"}, {"empId": "employee"}, {}])
def test_persisted_manager_assignment_cannot_be_edited_retargeted_or_deleted_by_appointed(change):
    item = {"id": "stored-manager-assignment", **change}
    cursor = HierarchyCursor(stored_assignments={
        item["id"]: {
            "id": item["id"],
            "id_nhan_vien": "peer",
            "organization_id": "org",
        },
    })
    single = access_policy.authorize_record_write(
        cursor, "user", "appointed", "org", "assignments", "phan_cong_nhan_su", item,
    )
    context = access_policy.build_batch_write_authorization_context(
        cursor, "user", "appointed", "org", {"phan_cong_nhan_su": [item]},
    )

    assert not single.allowed
    assert not access_policy.authorize_record_write_from_context(
        context, "assignments", "phan_cong_nhan_su", item,
    ).allowed


@pytest.mark.parametrize("actor_id,role", [("owner", "user"), ("platform-admin", "super_admin")])
@pytest.mark.parametrize("new_recipient", [None, "employee", "peer"])
def test_owner_and_super_admin_can_change_persisted_manager_assignment(actor_id, role, new_recipient):
    item = {"id": "stored-manager-assignment"}
    if new_recipient:
        item["empId"] = new_recipient
    cursor = HierarchyCursor(stored_assignments={
        item["id"]: {"id": item["id"], "id_nhan_vien": "peer", "organization_id": "org"},
    })
    single = access_policy.authorize_record_write(
        cursor, role, actor_id, "org", "assignments", "phan_cong_nhan_su", item,
    )
    context = access_policy.build_batch_write_authorization_context(
        cursor, role, actor_id, "org", {"phan_cong_nhan_su": [item]},
    )

    assert single.allowed
    assert access_policy.authorize_record_write_from_context(
        context, "assignments", "phan_cong_nhan_su", item,
    ) == single


def test_employee_self_create_cannot_reuse_persisted_manager_assignment_id():
    from backend.sync.ownership import validate_owner_scoped_references

    item = {
        "id": "stored-manager-assignment",
        "empId": "employee",
        "targetId": "new-contract",
        "type": "hopdong",
    }
    cursor = HierarchyCursor(stored_assignments={
        item["id"]: {"id": item["id"], "id_nhan_vien": "peer", "organization_id": "org"},
    })
    reference_context = SimpleNamespace(
        organization_member_ids={"employee"},
        platform_admin_ids=set(),
        active_ids_by_table={"tai_khoan": {"employee"}},
    )
    assert validate_owner_scoped_references(
        cursor,
        "org",
        "phan_cong_nhan_su",
        item,
        {"hop_dong": {"new-contract"}},
        reference_context=reference_context,
    ) == []
    single = access_policy.authorize_record_write(
        cursor, "employee", "employee", "org", "assignments", "phan_cong_nhan_su", item,
    )
    context = access_policy.build_batch_write_authorization_context(
        cursor,
        "employee",
        "employee",
        "org",
        {"phan_cong_nhan_su": [item], "hop_dong": [{"id": "new-contract"}]},
        {"hop_dong": {}},
    )

    batch = access_policy.authorize_record_write_from_context(
        context, "assignments", "phan_cong_nhan_su", item,
    )
    assert (single.allowed, batch.allowed) == (False, False)


@pytest.mark.parametrize("appointed_employee_persona", [False, True])
def test_server_generated_creator_default_still_allows_genuinely_new_assignment(appointed_employee_persona):
    from backend.sync.assignment_augmentation import augment_default_assignments

    class EmployeePersona(str):
        active_role = "employee"

    cursor = HierarchyCursor()
    actor_id = "appointed" if appointed_employee_persona else "employee"
    role = EmployeePersona("user") if appointed_employee_persona else "employee"
    transaction = SimpleNamespace(
        owner_type="organization",
        actor=SimpleNamespace(role=role, user_id=actor_id, organization_id="org"),
    )
    payload = {"hopdong": [{"id": "new-contract"}], "assignments": []}
    assert augment_default_assignments(cursor, transaction, payload, batch_limit=100) == 1
    item = payload["assignments"][0]
    single = access_policy.authorize_record_write(
        cursor, role, actor_id, "org", "assignments", "phan_cong_nhan_su", item,
    )
    context = access_policy.build_batch_write_authorization_context(
        cursor,
        role,
        actor_id,
        "org",
        {"phan_cong_nhan_su": [item], "hop_dong": payload["hopdong"]},
        {"hop_dong": {}, "phan_cong_nhan_su": {}},
    )

    assert single.allowed
    assert access_policy.authorize_record_write_from_context(
        context, "assignments", "phan_cong_nhan_su", item,
    ).allowed


@pytest.mark.parametrize(
    ("actor_id", "recipient_id", "allowed"),
    [
        ("appointed", "peer", False),
        ("appointed", "owner", False),
        ("appointed", "appointed", False),
        ("appointed", "employee", True),
        ("owner", "peer", True),
        ("owner", "appointed", True),
        ("owner", "employee", True),
    ],
)
@pytest.mark.parametrize("database_field_names", [False, True])
def test_direct_assignment_hierarchy_matches_single_and_batch(
    actor_id, recipient_id, allowed, database_field_names,
):
    cursor = HierarchyCursor()
    item = _assignment(recipient_id)
    if database_field_names:
        item = {
            "id": item["id"],
            "id_nhan_vien": item["empId"],
            "id_muc_tieu": item["targetId"],
            "loai_doi_tuong": item["type"],
        }
    single = access_policy.authorize_record_write(
        cursor, "user", actor_id, "org", "assignments", "phan_cong_nhan_su", item,
    )
    context = access_policy.build_batch_write_authorization_context(
        cursor, "user", actor_id, "org", {"phan_cong_nhan_su": [item]},
    )
    query_count = len(cursor.statements)
    batch = access_policy.authorize_record_write_from_context(
        context, "assignments", "phan_cong_nhan_su", item,
    )

    assert single.allowed is allowed
    assert batch == single
    assert len(cursor.statements) == query_count


@pytest.mark.parametrize(
    ("recipient_memberships", "allowed"),
    [
        ({("org", "recipient"): (" Manager ", None)}, False),
        ({("org", "recipient"): ("manager", "inactive")}, True),
        ({("other-org", "recipient"): ("manager", "active")}, True),
    ],
)
def test_recipient_manager_status_is_tenant_scoped_active_and_normalized(
    recipient_memberships, allowed,
):
    # Reference validity stays with the existing owner-scoped validator. Here
    # only active manager memberships in the actor's tenant affect hierarchy.
    memberships = {("org", "appointed"): ("manager", "active")}
    memberships.update(recipient_memberships)
    cursor = HierarchyCursor(memberships=memberships)
    item = _assignment("recipient")
    single = access_policy.authorize_record_write(
        cursor, "user", "appointed", "org", "assignments", "phan_cong_nhan_su", item,
    )
    context = access_policy.build_batch_write_authorization_context(
        cursor, "user", "appointed", "org", {"phan_cong_nhan_su": [item]},
    )
    batch = access_policy.authorize_record_write_from_context(
        context, "assignments", "phan_cong_nhan_su", item,
    )

    assert single.allowed is allowed
    assert batch == single


@pytest.mark.parametrize("owner_id", [None, ""])
def test_legacy_null_or_empty_owner_keeps_existing_single_record_decision(owner_id):
    cursor = HierarchyCursor(owner_id=owner_id)
    item = _assignment("peer")
    single = access_policy.authorize_record_write(
        cursor, "user", "appointed", "org", "assignments", "phan_cong_nhan_su", item,
    )
    context = access_policy.build_batch_write_authorization_context(
        cursor, "user", "appointed", "org", {"phan_cong_nhan_su": [item]},
    )

    assert not single.allowed
    assert access_policy.authorize_record_write_from_context(
        context, "assignments", "phan_cong_nhan_su", item,
    ) == single


def test_missing_organization_owner_row_blocks_manager_assignment_until_owner_is_identified():
    cursor = HierarchyCursor(owner_row_exists=False)
    item = _assignment("peer")
    single = access_policy.authorize_record_write(
        cursor, "user", "appointed", "org", "assignments", "phan_cong_nhan_su", item,
    )
    context = access_policy.build_batch_write_authorization_context(
        cursor, "user", "appointed", "org", {"phan_cong_nhan_su": [item]},
    )

    assert not single.allowed
    assert access_policy.authorize_record_write_from_context(
        context, "assignments", "phan_cong_nhan_su", item,
    ) == single


def test_super_admin_keeps_existing_direct_assignment_exception():
    cursor = HierarchyCursor()
    item = _assignment("peer")
    single = access_policy.authorize_record_write(
        cursor, "super_admin", "platform-admin", "org", "assignments", "phan_cong_nhan_su", item,
    )
    context = access_policy.build_batch_write_authorization_context(
        cursor, "super_admin", "platform-admin", "org", {"phan_cong_nhan_su": [item]},
    )

    assert single.allowed
    assert access_policy.authorize_record_write_from_context(
        context, "assignments", "phan_cong_nhan_su", item,
    ) == single


def test_server_inherited_assignment_preserves_version_cloning_for_appointed_manager():
    cursor = HierarchyCursor()
    inherited = _assignment("owner")
    direct = _assignment("peer")
    context = access_policy.build_batch_write_authorization_context(
        cursor,
        "user",
        "appointed",
        "org",
        {"phan_cong_nhan_su": [inherited, direct]},
        server_inherited_assignment_ids={inherited["id"]},
    )

    assert access_policy.authorize_record_write_from_context(
        context, "assignments", "phan_cong_nhan_su", inherited,
    ).allowed
    assert not access_policy.authorize_record_write_from_context(
        context, "assignments", "phan_cong_nhan_su", direct,
    ).allowed


@pytest.mark.parametrize("recipient_count", [1, 50, 501])
def test_batch_preloads_unique_recipient_manager_memberships_in_bounded_chunks(recipient_count):
    memberships = {("org", "appointed"): ("manager", "active")}
    memberships.update({
        ("org", f"manager-{index}"): ("manager", "active")
        for index in range(recipient_count)
    })
    cursor = HierarchyCursor(memberships=memberships)
    items = [_assignment(f"manager-{index}") for index in range(recipient_count)]
    context = access_policy.build_batch_write_authorization_context(
        cursor, "user", "appointed", "org", {"phan_cong_nhan_su": items + items},
    )
    owner_queries = [sql for sql, _params in cursor.statements if "SELECT owner_user_id" in sql]
    recipient_queries = [
        (sql, params)
        for sql, params in cursor.statements
        if "SELECT user_id FROM thanh_vien_to_chuc" in sql
    ]
    query_count = len(cursor.statements)

    assert len(owner_queries) == 1
    assert len(recipient_queries) == (recipient_count + 499) // 500
    assert all(params[0] == "org" and len(params) <= 501 for _sql, params in recipient_queries)
    assert sum(len(params) - 1 for _sql, params in recipient_queries) == recipient_count
    assert len(context.manager_assignment_recipient_ids) == recipient_count
    assert all(
        not access_policy.authorize_record_write_from_context(
            context, "assignments", "phan_cong_nhan_su", item,
        ).allowed
        for item in items
    )
    assert len(cursor.statements) == query_count


@pytest.mark.parametrize("assignment_count", [1, 50, 501])
@pytest.mark.parametrize("records_already_loaded", [False, True])
def test_persisted_assignment_recipients_are_batched_and_reuse_prefetched_records(
    assignment_count, records_already_loaded,
):
    items = [{"id": f"stored-{index}"} for index in range(assignment_count)]
    stored = {
        item["id"]: {"id": item["id"], "organization_id": "org", "id_nhan_vien": "peer"}
        for item in items
    }
    cursor = HierarchyCursor(stored_assignments=stored)
    context = access_policy.build_batch_write_authorization_context(
        cursor,
        "user",
        "appointed",
        "org",
        {"phan_cong_nhan_su": items},
        {"phan_cong_nhan_su": stored} if records_already_loaded else {},
    )
    stored_queries = [
        params for sql, params in cursor.statements
        if "SELECT id, id_nhan_vien FROM phan_cong_nhan_su" in sql
    ]
    expected_queries = 0 if records_already_loaded else (assignment_count + 499) // 500
    assert len(stored_queries) == expected_queries
    assert all(params[0] == "org" and len(params) <= 501 for params in stored_queries)
    assert len(context.assignment_recipient_by_id) == assignment_count
    query_count = len(cursor.statements)
    assert all(
        not access_policy.authorize_record_write_from_context(
            context, "assignments", "phan_cong_nhan_su", item,
        ).allowed for item in items
    )
    assert len(cursor.statements) == query_count


@pytest.mark.parametrize("recipient_id", ["peer", "owner"])
def test_sync_record_validator_rejects_direct_assignment_to_manager(monkeypatch, recipient_id):
    from backend.sync import record_validator

    cursor = HierarchyCursor()
    item = _assignment(recipient_id)
    payload = {"assignments": [item]}
    payload_index = SimpleNamespace(
        incoming_records_by_table={"phan_cong_nhan_su": {item["id"]: item}},
        incoming_ids_by_table={"phan_cong_nhan_su": {item["id"]}},
        allowed_contract_status_names=lambda *_args: [],
    )
    validator = record_validator.SyncRecordValidator(
        SimpleNamespace(
            cursor=cursor,
            actor=SimpleNamespace(role="user", user_id="appointed", organization_id="org"),
        ),
        payload,
        payload_index,
        SimpleNamespace(),
        clean_record_id=lambda _table, value: value,
        schema_definition={},
        iter_payloads=lambda _payload: [("assignments", "phan_cong_nhan_su", [item])],
        canonicalize_item=lambda _table, value: value,
    )
    monkeypatch.setattr(validator, "_load_current_records", lambda *_args: {})
    monkeypatch.setattr(validator, "_load_evaluation_methods_by_package", lambda *_args: {})
    monkeypatch.setattr(validator, "_load_tombstones", lambda *_args: {})
    for name in (
        "build_domain_uniqueness_context",
        "build_aggregate_mutability_context",
        "build_owner_reference_context",
    ):
        monkeypatch.setattr(record_validator, name, lambda *_args: SimpleNamespace())

    assert validator.validate_payload() == [{
        "table": "phan_cong_nhan_su",
        "id": item["id"],
        "field": "$record",
        "code": "RECORD_ACCESS_DENIED",
        "message": "Không có quyền thực hiện thay đổi này.",
    }]


@pytest.mark.parametrize(
    ("actor_id", "role", "recipient_id", "allowed", "owner_id"),
    [
        ("appointed", "user", "peer", False, "owner"),
        ("appointed", "user", "owner", False, "owner"),
        ("owner", "user", "peer", True, "owner"),
        ("platform-admin", "super_admin", "peer", True, "owner"),
        ("appointed", "user", "employee", True, "owner"),
        ("appointed", "user", "peer", False, None),
        ("platform-admin", "super_admin", "peer", True, None),
    ],
)
def test_sync_id_only_assignment_deletion_uses_persisted_recipient(
    monkeypatch, actor_id, role, recipient_id, allowed, owner_id,
):
    from backend.sync import deletion_service

    assignment_id = "stored-assignment"
    cursor = HierarchyCursor(owner_id=owner_id, stored_assignments={
        assignment_id: {
            "id": assignment_id,
            "id_nhan_vien": recipient_id,
            "organization_id": "org",
            "row_version": 1,
            "id_muc_tieu": "contract",
            "loai_doi_tuong": "hopdong",
        },
    })
    monkeypatch.setattr(
        deletion_service, "build_delete_impacts_by_record_ids",
        lambda *_args: {assignment_id: {"rootCount": 1, "assignmentCount": 0, "dependents": []}},
    )
    monkeypatch.setattr(
        deletion_service, "find_blocking_delete_references_by_record_ids",
        lambda *_args: {assignment_id: []},
    )
    monkeypatch.setattr(deletion_service, "build_aggregate_mutability_context", lambda *_args: SimpleNamespace())
    monkeypatch.setattr(deletion_service, "historical_parent_mutation_error", lambda *_args: None)
    monkeypatch.setattr(deletion_service, "insert_delete_audit", lambda *_args, **_kwargs: None)
    result = deletion_service.apply_sync_deletions(
        cursor,
        [{"table": "assignments", "id": assignment_id, "expectedVersion": 1}],
        organization_id="org",
        actor_role=role,
        actor_user_id=actor_id,
        current_time="2026-10-03 12:00:00",
        sync_version=2,
        clean_record_id=lambda _table, value: value,
        ip_address="127.0.0.1",
    )

    if allowed:
        assert result["errors"] == []
        assert len(result["impacts"]) == 1
        assert assignment_id not in cursor.stored_assignments
    else:
        assert result["errors"] == [{
            "table": "phan_cong_nhan_su",
            "id": assignment_id,
            "field": "$record",
            "code": "RECORD_ACCESS_DENIED",
            "message": "Không có quyền thực hiện thay đổi này.",
        }]
        assert result["impacts"] == []
        assert assignment_id in cursor.stored_assignments
        assert not any(sql.startswith("DELETE FROM") for sql, _params in cursor.statements)
    assert not any(
        "SELECT id, id_nhan_vien FROM phan_cong_nhan_su" in sql
        for sql, _params in cursor.statements
    )
