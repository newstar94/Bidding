from types import SimpleNamespace
import asyncio
import json
from cryptography.fernet import Fernet

from backend.activity.service import (
    build_assignment_activity_events,
    build_record_activity_event,
    sanitize_metadata,
)
from backend.api.org_routes import _assignments_requiring_successor
from backend.notifications.service import (
    find_unreplaced_assignment_removals,
    queue_assignment_state_changes,
    snapshot_assignment_state,
)
from backend.sync.record_writer import SyncRecordWriter
from backend.sync.assignment_augmentation import augment_default_assignments
from backend.activity import routes as activity_routes
from backend.db.db_utils import recalculate_is_latest


class _AnswerCursor:
    def __init__(self, rows=()):
        self.rows = list(rows)
        self.calls = []

    def execute(self, sql, params=()):
        self.calls.append((" ".join(str(sql).split()), tuple(params)))
        return self

    def fetchall(self):
        return list(self.rows)

    def executemany(self, sql, params):
        self.calls.append((" ".join(str(sql).split()), list(params)))
        return self


def _assignment(
    assignment_id,
    user_id,
    target_id,
    target_type="goithau",
):
    return {
        "assignment_id": assignment_id,
        "user_id": user_id,
        "target_id": target_id,
        "target_type": target_type,
        "target_root_id": target_id,
        "user_name": user_id,
        "assigned_at": "2026-01-01 00:00:00",
    }


def test_snapshot_keeps_each_assignment_membership_without_collapsing():
    cursor = _AnswerCursor([
        ("a-1", "user-a", "package-1", "goithau", "GT-1", "Gói 1", "root-1", "A", "2026-01-01"),
        ("a-2", "user-b", "package-1", "goithau", "GT-1", "Gói 1", "root-1", "B", "2026-01-02"),
    ])

    snapshot = snapshot_assignment_state(cursor, "org-1")

    assert set(snapshot) == {
        ("goithau", "package-1", "user-a"),
        ("goithau", "package-1", "user-b"),
    }
    assert snapshot[("goithau", "package-1", "user-a")]["assignment_id"] == "a-1"
    assert len(cursor.calls) == 1


def _measure_assignment_snapshot_queries(assignee_count):
    cursor = _AnswerCursor([
        (
            f"assignment-{index}", f"user-{index}", "package-1", "goithau",
            "GT-1", "Gói 1", "root-1", f"User {index}", "2026-01-01",
        )
        for index in range(assignee_count)
    ])
    assert len(snapshot_assignment_state(cursor, "org-1")) == assignee_count
    return len(cursor.calls)


def test_assignment_snapshot_query_count_is_constant_for_one_and_fifty_assignees():
    assert _measure_assignment_snapshot_queries(1) == 1
    assert _measure_assignment_snapshot_queries(50) == 1


def test_removing_one_of_two_assignees_does_not_require_replacement():
    before = {
        ("goithau", "package-1", "user-a"): _assignment("a-1", "user-a", "package-1"),
        ("goithau", "package-1", "user-b"): _assignment("a-2", "user-b", "package-1"),
    }
    after = {
        ("goithau", "package-1", "user-b"): before[("goithau", "package-1", "user-b")],
    }
    cursor = _AnswerCursor([("package-1",)])

    assert find_unreplaced_assignment_removals(
        cursor,
        organization_id="org-1",
        before=before,
        after=after,
    ) == []


def test_organization_removal_only_requires_successor_for_last_assignee():
    rows = [
        {"id": "a-1", "id_muc_tieu": "package-shared", "loai_doi_tuong": "goithau"},
        {"id": "a-2", "id_muc_tieu": "contract-single", "loai_doi_tuong": "hopdong"},
    ]
    cursor = _AnswerCursor([("goithau", "package-shared")])

    requiring = _assignments_requiring_successor(
        cursor,
        "org-1",
        "removed-user",
        rows,
    )

    assert [row["id"] for row in requiring] == ["a-2"]
    assert len(cursor.calls) == 1
    assert "assignment.id_nhan_vien != ?" in cursor.calls[0][0]


def test_assignment_delta_activity_only_contains_changed_memberships():
    before = {
        ("goithau", "package-1", "a"): _assignment("row-a", "a", "package-1"),
        ("goithau", "package-1", "b"): _assignment("row-b", "b", "package-1"),
    }
    after = {
        ("goithau", "package-1", "b"): before[("goithau", "package-1", "b")],
        ("goithau", "package-1", "c"): _assignment("row-c", "c", "package-1"),
    }

    events = build_assignment_activity_events(
        before,
        after,
        client_mutation_id="mutation-1",
    )

    assert [(event.action, event.metadata["assigneeId"]) for event in events] == [
        ("assignment.removed", "a"),
        ("assignment.added", "c"),
    ]


def test_record_activity_ignores_normalized_noop_and_sanitizes_secrets():
    previous = {"id": "package-1", "id_goc": "root-1", "ten_goi_thau": "Gói A", "row_version": 1}
    current = {"id": "package-1", "id_goc": "root-1", "ten_goi_thau": " Gói A ", "row_version": 2}

    assert build_record_activity_event(
        "goi_thau", previous, current, client_mutation_id="mutation-1"
    ) is None
    encoded = sanitize_metadata({"token": "secret", "changedFields": ["name"]})
    assert "secret" not in encoded
    assert "changedFields" in encoded


def test_assignment_writer_no_longer_deletes_sibling_memberships():
    cursor = _AnswerCursor()
    writer = SyncRecordWriter(
        SimpleNamespace(cursor=cursor),
        sync_version=1,
        mutation_tracker=SimpleNamespace(),
        clean_record_id=lambda _table, value: value,
        ownership_scoped_tables=set(),
        defer_latest_flag=lambda *_args: None,
        map_database_record=lambda *_args: None,
        save_children=lambda *_args: None,
    )

    writer._replace_singleton_rows("phan_cong_nhan_su", {
        "organization_id": "org-1",
        "id_muc_tieu": "package-1",
        "loai_doi_tuong": "goithau",
        "id": "assignment-2",
    })

    assert cursor.calls == []


def test_latest_version_recalculation_demotes_before_promoting_winner():
    cursor = _AnswerCursor()
    cursor.rowcount = 1

    recalculate_is_latest(
        cursor,
        "goi_thau",
        "org-1",
        affected_families={("root-1", "plan-1")},
    )

    assert len(cursor.calls) == 2
    assert "SET is_latest = 0" in cursor.calls[0][0]
    assert "SET is_latest = 1" in cursor.calls[1][0]


class _AugmentationCursor(_AnswerCursor):
    def execute(self, sql, params=()):
        normalized = " ".join(str(sql).split())
        self.calls.append((normalized, tuple(params)))
        if normalized.startswith("SELECT id FROM"):
            self.rows = []
        elif "JOIN phan_cong_nhan_su AS assignment" in normalized:
            self.rows = [
                ("root-1", "user-a"),
                ("root-1", "user-b"),
                ("root-1", "user-c"),
            ]
        else:
            self.rows = []
        return self


def _organization_transaction():
    return SimpleNamespace(
        owner_type="organization",
        actor=SimpleNamespace(user_id="creator", organization_id="org-1"),
    )


def test_explicit_multi_assignee_create_does_not_add_creator():
    cursor = _AugmentationCursor()
    payload = {
        "goithau": [{"id": "package-1"}],
        "assignments": [
            {"id": "a-1", "empId": "user-a", "targetId": "package-1", "type": "goithau"},
            {"id": "a-2", "empId": "user-b", "targetId": "package-1", "type": "goithau"},
        ],
    }

    added = augment_default_assignments(
        cursor,
        _organization_transaction(),
        payload,
        batch_limit=100,
        measure_batch=lambda value: sum(len(items) for items in value.values()),
    )

    assert added == 0
    assert [item["empId"] for item in payload["assignments"]] == ["user-a", "user-b"]


def test_new_version_inherits_complete_assignee_set():
    cursor = _AugmentationCursor()
    payload = {
        "goithau": [{"id": "package-v2", "rootId": "root-1"}],
        "assignments": [],
    }

    added = augment_default_assignments(
        cursor,
        _organization_transaction(),
        payload,
        batch_limit=100,
        measure_batch=lambda value: sum(len(items) for items in value.values()),
    )

    assert added == 3
    assert {item["empId"] for item in payload["assignments"]} == {
        "user-a", "user-b", "user-c",
    }
    assert all(item["targetId"] == "package-v2" for item in payload["assignments"])
    assert any("record.is_latest = 1" in sql for sql, _params in cursor.calls)


def _measure_version_inheritance_queries(assignee_count):
    class InheritanceCursor(_AnswerCursor):
        def execute(self, sql, params=()):
            normalized = " ".join(str(sql).split())
            self.calls.append((normalized, tuple(params)))
            if normalized.startswith("SELECT id FROM"):
                self.rows = []
            elif "JOIN phan_cong_nhan_su AS assignment" in normalized:
                self.rows = [
                    ("root-1", f"user-{index}")
                    for index in range(assignee_count)
                ]
            else:
                self.rows = []
            return self

    cursor = InheritanceCursor()
    payload = {
        "goithau": [{"id": "package-v2", "rootId": "root-1"}],
        "assignments": [],
    }
    augment_default_assignments(
        cursor,
        _organization_transaction(),
        payload,
        batch_limit=100,
        measure_batch=lambda value: sum(len(items) for items in value.values()),
    )
    assert len(payload["assignments"]) == assignee_count
    return len(cursor.calls)


def test_version_inheritance_query_count_is_constant_for_one_and_fifty_assignees():
    assert _measure_version_inheritance_queries(1) == 2
    assert _measure_version_inheritance_queries(50) == 2


class _NotificationCursor(_AnswerCursor):
    def execute(self, sql, params=()):
        normalized = " ".join(str(sql).split())
        self.calls.append((normalized, tuple(params)))
        if normalized.startswith("SELECT ten_to_chuc"):
            self.rows = [("Organization",)]
        elif normalized.startswith("SELECT id, email"):
            self.rows = [
                (user_id, f"{user_id}@example.test", user_id)
                for user_id in params
            ]
        else:
            self.rows = []
        return self

    def fetchone(self):
        return self.rows[0] if self.rows else None


def _measure_assignment_notification_operations(monkeypatch, assignee_count):
    monkeypatch.setenv(
        "EMAIL_OUTBOX_ENCRYPTION_KEY",
        Fernet.generate_key().decode("ascii"),
    )
    cursor = _NotificationCursor()
    after = {
        ("goithau", f"package-{index}", f"user-{index}"): _assignment(
            f"assignment-{index}",
            f"user-{index}",
            f"package-{index}",
        )
        for index in range(assignee_count)
    }
    assert queue_assignment_state_changes(
        cursor,
        organization_id="org-1",
        before={},
        after=after,
    ) == assignee_count
    return len(cursor.calls)


def test_assignment_notification_query_count_is_constant_for_one_and_fifty_memberships(monkeypatch):
    assert _measure_assignment_notification_operations(monkeypatch, 1) == 4
    assert _measure_assignment_notification_operations(monkeypatch, 50) == 4


class _TimelineCursor(_AnswerCursor):
    def __init__(self, activity_count):
        super().__init__()
        self.activity_count = activity_count

    def execute(self, sql, params=()):
        normalized = " ".join(str(sql).split())
        self.calls.append((normalized, tuple(params)))
        if normalized.startswith("SELECT id, COALESCE"):
            self.rows = [("package-v1", "root-1")]
            self.one = self.rows[0]
        elif "FROM nhat_ky_thuc_hien" in normalized:
            self.rows = [
                (
                    f"activity-{index}", "goithau", "package-v1", "root-1",
                    "goithau.updated", "actor-1", "Actor", "2026-07-29 08:00:00",
                    None, None, '{"changedFields":["ten_goi_thau"]}',
                )
                for index in range(self.activity_count)
            ]
        else:
            self.rows = []
        return self

    def fetchone(self):
        return getattr(self, "one", None)


class _TimelineConnection:
    def __init__(self, cursor):
        self._cursor = cursor

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def cursor(self):
        return self._cursor


def _measure_timeline_queries(monkeypatch, activity_count):
    cursor = _TimelineCursor(activity_count)
    request = SimpleNamespace(
        path_params={"target_type": "goithau", "target_id": "package-v1"},
        query_params={"limit": "100"},
    )
    session = SimpleNamespace(user_id="actor-1")
    monkeypatch.setattr(activity_routes, "verify_session", lambda _request: (True, session))
    monkeypatch.setattr(activity_routes, "get_active_org", lambda *_args: "org-1")
    monkeypatch.setattr(activity_routes, "can_read_record", lambda *_args: True)
    monkeypatch.setattr(
        activity_routes.database,
        "get_connection",
        lambda: _TimelineConnection(cursor),
    )

    response = asyncio.run(activity_routes.list_activity_timeline_api(request))
    assert response.status_code == 200
    assert len(json.loads(response.body)["items"]) == activity_count
    return len(cursor.calls)


def test_timeline_query_count_is_constant_for_one_and_fifty_items(monkeypatch):
    count_for_one = _measure_timeline_queries(monkeypatch, 1)
    count_for_fifty = _measure_timeline_queries(monkeypatch, 50)

    assert count_for_one == 2
    assert count_for_fifty == 2
