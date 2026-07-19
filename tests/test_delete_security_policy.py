from __future__ import annotations

from dataclasses import dataclass
import time

import pytest

from backend.db.db_helper import IntegrityError
from backend.sync import delete_policy, deletion_service
from backend.shared.access_policy import AccessDecision


class _Result:
    def __init__(self, row=None, rowcount=0):
        self._row = row
        self.rowcount = rowcount

    def fetchone(self):
        return self._row


class _Cursor:
    def __init__(self, rows=(), rowcount=0):
        self.rows = list(rows)
        self.rowcount = rowcount
        self.calls = []

    def execute(self, sql, parameters=()):
        self.calls.append((sql, parameters))
        row = self.rows.pop(0) if self.rows else None
        return _Result(row=row, rowcount=self.rowcount)


def test_reference_lookup_and_assignment_cleanup_are_owner_scoped() -> None:
    rules = (
        delete_policy.DeleteReferenceRule("child_a", "parent_id", "A"),
        delete_policy.DeleteReferenceRule("child_b", "parent_id", "B"),
    )
    cursor = _Cursor(rows=[(2,), (0,)], rowcount=3)
    references = delete_policy.find_blocking_delete_references(
        cursor, "org-1", "parent", "record-1", rules=rules
    )
    assert references == [
        {"table": "child_a", "column": "parent_id", "label": "A", "count": 2}
    ]
    assert all(call[1] == ("org-1", "record-1") for call in cursor.calls[:2])

    assert (
        delete_policy.delete_assignment_dependents(
            cursor, "org-1", "ke_hoach_lcnt", "record-1"
        )
        == 3
    )
    assert (
        delete_policy.delete_assignment_dependents(
            cursor, "org-1", "nha_thau", "record-1"
        )
        == 0
    )


def test_delete_impact_counts_cascades_and_assignments(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        delete_policy,
        "find_blocking_delete_references",
        lambda *_args, **_kwargs: [{"label": "child", "count": 4}],
    )
    cursor = _Cursor(rows=[(2,)])
    impact = delete_policy.build_delete_impact(
        cursor, "org-1", "goi_thau", "record-1"
    )
    assert impact == {
        "rootCount": 1,
        "dependentCount": 6,
        "totalCount": 7,
        "dependents": [{"label": "child", "count": 4}],
        "assignmentCount": 2,
    }

    no_assignments = delete_policy.build_delete_impact(
        _Cursor(), "org-1", "nha_thau", "record-1"
    )
    assert no_assignments["assignmentCount"] == 0


@pytest.mark.parametrize(
    ("row", "ttl", "expected"),
    [
        (None, 300, False),
        (("invalid",), 300, False),
        ((0,), 300, False),
        ((int(time.time()) - 1_000,), 300, False),
        ((int(time.time()),), 300, True),
    ],
)
def test_privileged_reauthentication_requires_recent_live_session(
    row, ttl: int, expected: bool
) -> None:
    assert (
        delete_policy.has_recent_password_reauthentication(
            _Cursor(rows=[row]), "user-1", ttl, "session-1"
        )
        is expected
    )


def test_archive_record_updates_only_supported_owner_row() -> None:
    cursor = _Cursor(rowcount=1)
    assert (
        delete_policy.archive_versioned_record(
            cursor, "org-1", "goi_thau", "record-1", 10, 11
        )
        == 1
    )
    sql, parameters = cursor.calls[0]
    assert "is_latest = 0" in sql
    assert parameters == (10, 10, 11, "org-1", "record-1")

    nonversioned = _Cursor(rowcount=1)
    delete_policy.archive_versioned_record(
        nonversioned, "org-1", "thong_tin_mo_thau", "record-1", 10, 11
    )
    assert "is_latest = 0" not in nonversioned.calls[0][0]
    with pytest.raises(ValueError):
        delete_policy.archive_versioned_record(
            _Cursor(), "org-1", "phan_cong_nhan_su", "record-1", 10, 11
        )


def test_delete_audit_serializes_impact(monkeypatch: pytest.MonkeyPatch) -> None:
    captured = {}
    monkeypatch.setattr(
        delete_policy,
        "insert_audit_row",
        lambda _cursor, **kwargs: captured.update(kwargs),
    )
    delete_policy.insert_delete_audit(
        _Cursor(),
        actor_user_id="user-1",
        organization_id="org-1",
        table_name="goi_thau",
        record_id="record-1",
        action="sync.record_deleted",
        impact={"totalCount": 2},
        ip_address="127.0.0.1",
    )
    assert captured["target_type"] == "goi_thau"
    assert captured["target_id"] == "record-1"
    assert '"totalCount": 2' in captured["metadata_json"]


@dataclass
class _DeletionHarness:
    monkeypatch: pytest.MonkeyPatch
    record: dict
    allowed: bool = True
    manager: bool = True
    reauthenticated: bool = True
    references: list | None = None
    archive_count: int = 1

    def install(self):
        self.audits = []
        self.monkeypatch.setattr(
            deletion_service,
            "authorize_record_write",
            lambda *_args, **_kwargs: AccessDecision(
                self.allowed, "" if self.allowed else "denied"
            ),
        )
        self.monkeypatch.setattr(
            deletion_service,
            "is_organization_manager",
            lambda *_args, **_kwargs: self.manager,
        )
        self.monkeypatch.setattr(
            deletion_service,
            "has_recent_password_reauthentication",
            lambda *_args, **_kwargs: self.reauthenticated,
        )
        self.monkeypatch.setattr(
            deletion_service,
            "build_delete_impact",
            lambda *_args, **_kwargs: {
                "rootCount": 1,
                "dependentCount": 0,
                "totalCount": 1,
                "dependents": [],
                "assignmentCount": 0,
            },
        )
        self.monkeypatch.setattr(
            deletion_service,
            "find_blocking_delete_references",
            lambda *_args, **_kwargs: list(self.references or []),
        )
        self.monkeypatch.setattr(
            deletion_service, "delete_assignment_dependents", lambda *_args: 0
        )
        self.monkeypatch.setattr(
            deletion_service,
            "archive_versioned_record",
            lambda *_args: self.archive_count,
        )
        self.monkeypatch.setattr(
            deletion_service,
            "insert_delete_audit",
            lambda _cursor, **kwargs: self.audits.append(kwargs),
        )
        self.monkeypatch.setattr(
            deletion_service,
            "normalize_managed_image_path",
            lambda value: value if str(value or "").startswith("data/media/") else None,
        )
        self.monkeypatch.setattr(
            deletion_service, "map_db_to_json", lambda _table, row: dict(row)
        )
        return self


class _DeletionCursor:
    def __init__(self, record: dict, *, integrity_error: bool = False):
        self.record = record
        self.integrity_error = integrity_error
        self.calls = []

    def execute(self, sql, parameters=()):
        self.calls.append((sql, parameters))
        if sql.lstrip().startswith("SELECT *"):
            return _Result(self.record)
        if self.integrity_error and sql.lstrip().startswith("DELETE FROM"):
            raise IntegrityError("referenced")
        return _Result(rowcount=1)


def _apply(cursor, deletions, **overrides):
    arguments = {
        "organization_id": "org-1",
        "actor_role": "manager",
        "actor_user_id": "user-1",
        "session_id": "session-1",
        "current_time": 100,
        "sync_version": 101,
        "clean_record_id": lambda _table, value: str(value or "").strip(),
        "privileged_reauth_ttl_seconds": 300,
        "privileged_reauth_error_message": "reauth",
        "ip_address": "127.0.0.1",
    }
    arguments.update(overrides)
    return deletion_service.apply_sync_deletions(cursor, deletions, **arguments)


def test_deletion_ignores_invalid_entries_and_missing_records() -> None:
    record = {"id": "record-1", "row_version": 1}
    assert _apply(_DeletionCursor(record), None)["impacts"] == []
    result = _apply(
        _DeletionCursor(None),
        [None, "bad", {}, {"table": "unknown", "id": "x"}, {"table": "goithau"}],
    )
    assert result["errors"] == []
    assert result["impacts"] == []


def test_deletion_rejects_version_conflict_and_archived_record(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    harness = _DeletionHarness(
        monkeypatch, {"id": "record-1", "row_version": 3}
    ).install()
    conflict = _apply(
        _DeletionCursor(harness.record),
        [{"table": "goithau", "id": "record-1", "expectedVersion": 2}],
    )
    assert conflict["errors"][0]["code"] == "ROW_VERSION_CONFLICT"
    assert conflict["errors"][0]["currentVersion"] == 3

    archived_record = {**harness.record, "row_version": 1, "archived_at": 99}
    archived = _apply(
        _DeletionCursor(archived_record),
        [{"table": "goithau", "id": "record-1", "expectedVersion": 1}],
    )
    assert archived["impacts"] == []


def test_deletion_enforces_record_and_elevated_permissions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    record = {"id": "record-1", "row_version": 1}
    denied = _DeletionHarness(monkeypatch, record, allowed=False).install()
    result = _apply(
        _DeletionCursor(record),
        [{"table": "goithau", "id": "record-1", "expectedVersion": 1}],
    )
    assert result["errors"][0]["message"] == "denied"

    manager_denied = _DeletionHarness(monkeypatch, record, manager=False).install()
    result = _apply(
        _DeletionCursor(record),
        [{"table": "goithau", "id": "record-1", "expectedVersion": 1}],
    )
    assert result["errors"][0]["code"] == "DELETE_ELEVATED_PERMISSION_REQUIRED"

    needs_reauth = _DeletionHarness(
        monkeypatch, record, reauthenticated=False
    ).install()
    result = _apply(
        _DeletionCursor(record),
        [{"table": "goithau", "id": "record-1", "expectedVersion": 1}],
    )
    assert result["privilegedError"]["code"] == "PRIVILEGED_REAUTH_REQUIRED"


def test_personal_owner_can_delete_own_high_impact_aggregate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    record = {"id": "record-1", "row_version": 1}
    harness = _DeletionHarness(
        monkeypatch,
        record,
        manager=False,
        reauthenticated=False,
    ).install()
    result = _apply(
        _DeletionCursor(record),
        [{"table": "goithau", "id": "record-1", "expectedVersion": 1}],
        organization_id="personal:user-1",
        actor_role="employee",
    )
    assert result["errors"] == []
    assert result["privilegedError"] is None
    assert result["impacts"][0]["action"] == "deleted"


def test_personal_scope_must_belong_to_actor_for_elevated_bypass(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    record = {"id": "record-1", "row_version": 1}
    _DeletionHarness(monkeypatch, record, manager=False).install()
    result = _apply(
        _DeletionCursor(record),
        [{"table": "goithau", "id": "record-1", "expectedVersion": 1}],
        organization_id="personal:another-user",
        actor_role="employee",
    )
    assert result["errors"][0]["code"] == "DELETE_ELEVATED_PERMISSION_REQUIRED"


def test_deletion_archives_referenced_record_and_tracks_version_family(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    record = {
        "id": "record-1",
        "id_goc": "family-1",
        "ke_hoach_id": "plan-1",
        "row_version": 1,
    }
    harness = _DeletionHarness(
        monkeypatch, record, references=[{"label": "child", "count": 1}]
    ).install()
    result = _apply(
        _DeletionCursor(record),
        [{"table": "goithau", "id": "record-1", "expectedVersion": 1}],
    )
    assert result["impacts"][0]["action"] == "archived"
    assert result["affectedVersionFamilies"]["goi_thau"] == {
        ("family-1", "plan-1")
    }
    assert result["affectedPlanIds"] == {"plan-1"}
    assert harness.audits[0]["action"] == "sync.record_archived"


def test_deletion_hard_deletes_and_collects_managed_images(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    record = {
        "id": "expert-1",
        "row_version": 1,
        "anh_chung_chi": "data/media/certificate.png",
        "anh_chu_ky": "https://not-managed.example/signature.png",
    }
    harness = _DeletionHarness(monkeypatch, record).install()
    result = _apply(
        _DeletionCursor(record),
        [{"table": "chuyengia", "id": "expert-1", "expectedVersion": 1}],
    )
    assert result["impacts"][0]["action"] == "deleted"
    assert result["imageCleanupCandidates"] == {"data/media/certificate.png"}
    assert result["affectedVersionFamilies"]["chuyen_gia"] == {"expert-1"}
    assert harness.audits[0]["action"] == "sync.record_deleted"


def test_deletion_reports_database_reference_race(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    record = {"id": "expert-1", "row_version": 1}
    _DeletionHarness(monkeypatch, record).install()
    result = _apply(
        _DeletionCursor(record, integrity_error=True),
        [{"table": "chuyengia", "id": "expert-1", "expectedVersion": 1}],
    )
    assert result["errors"][0]["code"] == "DELETE_REFERENCED"
    assert result["impacts"] == []


def test_nonarchivable_reference_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    record = {"id": "expert-1", "row_version": 1}
    _DeletionHarness(
        monkeypatch, record, references=[{"label": "assignment", "count": 2}]
    ).install()
    monkeypatch.setattr(deletion_service, "ARCHIVABLE_TABLES", frozenset())
    result = _apply(
        _DeletionCursor(record),
        [{"table": "chuyengia", "id": "expert-1", "expectedVersion": 1}],
    )
    assert result["errors"][0]["code"] == "DELETE_REFERENCED"
    assert result["errors"][0]["references"][0]["count"] == 2
