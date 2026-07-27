from types import SimpleNamespace

from backend.notifications.service import find_unreplaced_assignment_removals
from backend.sync.assignment_augmentation import augment_default_assignments
from backend.sync import record_validator
from backend.sync.record_validator import SyncRecordValidator
from backend.sync.record_writer import SyncRecordWriter


class _CountingCursor:
    def __init__(self, existing_ids=()):
        self.existing_ids = {str(value) for value in existing_ids}
        self.calls = []
        self._rows = []

    def execute(self, sql, params=()):
        normalized = " ".join(str(sql).split())
        params = tuple(params)
        self.calls.append((normalized, params))
        candidate_ids = [str(value) for value in params[1:]]
        self._rows = [
            (value,) for value in candidate_ids if value in self.existing_ids
        ]
        return self

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return list(self._rows)


class _WriterCursor(_CountingCursor):
    rowcount = 1

    def executemany(self, sql, params):
        for item in params:
            self.calls.append((" ".join(str(sql).split()), tuple(item)))
        return self


def test_default_assignment_existence_queries_are_batched_by_target_type():
    cursor = _CountingCursor({"plan-existing", "package-existing"})
    context = SimpleNamespace(
        owner_type="organization",
        actor=SimpleNamespace(organization_id="org-1", user_id="user-1"),
    )
    payload = {
        "kehoach": [
            {"id": "plan-existing"},
            *({"id": f"plan-{index}"} for index in range(40)),
        ],
        "goithau": [
            {"id": "package-existing"},
            *({"id": f"package-{index}"} for index in range(40)),
        ],
        "hopdong": [{"id": f"contract-{index}"} for index in range(40)],
    }

    added = augment_default_assignments(
        cursor,
        context,
        payload,
        batch_limit=1000,
    )

    assert added == 120
    assert len(cursor.calls) == 3
    assert len(payload["assignments"]) == 120


def test_unreplaced_assignment_target_queries_are_batched_by_table():
    before = {}
    existing_ids = set()
    for index in range(40):
        package_id = f"package-{index}"
        contract_id = f"contract-{index}"
        before[("goithau", package_id)] = {
            "target_type": "goithau",
            "target_id": package_id,
        }
        before[("hopdong", contract_id)] = {
            "target_type": "hopdong",
            "target_id": contract_id,
        }
        existing_ids.update((package_id, contract_id))
    cursor = _CountingCursor(existing_ids)

    missing = find_unreplaced_assignment_removals(
        cursor,
        organization_id="org-1",
        before=before,
        after={},
    )

    assert len(missing) == 80
    assert len(cursor.calls) == 2


def test_contract_package_existence_is_loaded_in_one_query():
    package_ids = [f"package-{index}" for index in range(40)]
    cursor = _WriterCursor(package_ids)
    transaction = SimpleNamespace(
        cursor=cursor,
        actor=SimpleNamespace(organization_id="org-1", user_id="user-1"),
        owner_type="organization",
    )
    writer = SyncRecordWriter(
        transaction,
        sync_version=1,
        mutation_tracker=SimpleNamespace(),
        clean_record_id=lambda _table, value: str(value) if value else None,
        ownership_scoped_tables=set(),
        defer_latest_flag=lambda *_args: None,
        map_database_record=lambda *_args: None,
        save_children=lambda *_args: None,
    )

    writer._replace_contract_packages(
        "hop_dong",
        {"id": "contract-1", "goiThauIds": package_ids},
    )

    select_calls = [sql for sql, _ in cursor.calls if sql.startswith("SELECT")]
    assert len(select_calls) == 1


def test_sync_validation_loads_current_rows_by_table(monkeypatch):
    class _VersionCursor:
        def __init__(self):
            self.calls = []
            self._rows = []

        def execute(self, sql, params=()):
            normalized = " ".join(str(sql).split())
            params = tuple(params)
            self.calls.append((normalized, params))
            self._rows = [
                {
                    "id": str(record_id),
                    "row_version": 1,
                    "organization_id": "org-1",
                }
                for record_id in params[1:]
            ]
            return self

        def fetchone(self):
            return self._rows[0] if self._rows else None

        def fetchall(self):
            return list(self._rows)

    monkeypatch.setattr(
        record_validator,
        "authorize_record_write",
        lambda *_args: SimpleNamespace(allowed=True, message=""),
    )
    monkeypatch.setattr(
        record_validator,
        "validate_sync_item",
        lambda _table, item, _statuses: (item, [], set()),
    )
    monkeypatch.setattr(
        record_validator,
        "validate_owner_scoped_references",
        lambda *_args: [],
    )
    monkeypatch.setattr(
        record_validator,
        "validate_domain_uniqueness",
        lambda *_args: [],
    )
    monkeypatch.setattr(
        record_validator,
        "validate_opening_participant_uniqueness",
        lambda *_args: [],
    )
    cursor = _VersionCursor()
    remembered = {}
    payload = {
        "custom": [
            {"id": f"row-{index}", "expectedVersion": 1}
            for index in range(40)
        ]
    }
    payload_index = SimpleNamespace(
        incoming_ids_by_table={},
        incoming_records_by_table={},
        allowed_contract_status_names=lambda *_args: set(),
        remember_stored_record=lambda table, record_id, row: remembered.__setitem__(
            (table, record_id), row
        ),
    )
    validator = SyncRecordValidator(
        SimpleNamespace(
            cursor=cursor,
            actor=SimpleNamespace(
                organization_id="org-1",
                user_id="user-1",
                role="employee",
            ),
            owner_type="personal",
        ),
        payload,
        payload_index,
        SimpleNamespace(),
        clean_record_id=lambda _table, value: str(value) if value else None,
        schema_definition={"custom_table": {"columns": {"row_version": "INTEGER"}}},
        iter_payloads=lambda value: [("custom", "custom_table", value["custom"])],
        canonicalize_item=lambda _table, item: item,
    )

    assert validator.validate_payload() == []
    assert len(cursor.calls) == 1
    assert len(remembered) == 40
