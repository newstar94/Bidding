import sqlite3

import pytest

from backend.db.schema import SCHEMA_DINH_NGHIA
from backend.db.upgrades import (
    DB_SCHEMA_VERSION,
    UPGRADES,
    _upgrade_to_v63_scope_procurement_operation_idempotency,
)
from backend.procurement_import.domain import ImportConflict
from backend.procurement_import.repository import ProcurementImportRepository
import backend.procurement_import.repository as procurement_repository


def _operation(*, operation_id, family, request_hash="a" * 64):
    return {
        "id": operation_id,
        "organizationId": "org-1",
        "provider": "VNEPS",
        "familyNo": family,
        "totalRevisions": 1,
        "bundleDigest": "sha256:" + "b" * 64,
        "revisionResults": [],
        "idempotencyKey": "shared-client-key",
        "requestHash": request_hash,
        "actorUserId": "user-1",
    }


def _repository(*, uniqueness=None):
    connection = sqlite3.connect(":memory:")
    uniqueness = uniqueness or SCHEMA_DINH_NGHIA[
        "procurement_import_operation"
    ]["unique_constraints"][0]
    connection.execute(
        f"""CREATE TABLE procurement_import_operation (
               id TEXT NOT NULL,
               organization_id TEXT NOT NULL,
               provider TEXT NOT NULL,
               family_key TEXT NOT NULL,
               mode TEXT NOT NULL,
               status TEXT NOT NULL,
               next_revision_index INTEGER NOT NULL,
               total_revisions INTEGER NOT NULL,
               bundle_digest TEXT NOT NULL,
               revision_results_json TEXT NOT NULL,
               idempotency_key TEXT NOT NULL,
               request_hash TEXT NOT NULL,
               actor_user_id TEXT NOT NULL,
               error_code TEXT,
               created_at TEXT DEFAULT CURRENT_TIMESTAMP,
               updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
               PRIMARY KEY (organization_id, id),
               {uniqueness}
           )"""
    )
    return connection, ProcurementImportRepository(connection.cursor())


def test_same_idempotency_key_is_independent_between_procurement_families():
    connection, repository = _repository()
    try:
        first = repository.create_operation(
            _operation(operation_id="operation-family-a", family="PLAN-A")
        )
        second = repository.create_operation(
            _operation(operation_id="operation-family-b", family="PLAN-B")
        )

        assert first["familyNo"] == "PLAN-A"
        assert second["familyNo"] == "PLAN-B"
        assert connection.execute(
            "SELECT COUNT(*) FROM procurement_import_operation"
        ).fetchone()[0] == 2
    finally:
        connection.close()


def test_replay_within_one_procurement_family_remains_idempotent():
    connection, repository = _repository()
    try:
        operation = _operation(operation_id="operation-family-a", family="PLAN-A")
        assert repository.create_operation(operation) == repository.create_operation(
            operation
        )

        with pytest.raises(
            ImportConflict, match="PROCUREMENT_IDEMPOTENCY_CONFLICT"
        ):
            repository.create_operation({**operation, "requestHash": "c" * 64})
    finally:
        connection.close()


def test_new_repository_binary_can_run_before_v63_schema_migration():
    legacy_uniqueness = "UNIQUE(organization_id, provider, idempotency_key)"
    connection, repository = _repository(uniqueness=legacy_uniqueness)
    try:
        operation = _operation(operation_id="operation-family-a", family="PLAN-A")
        assert repository.create_operation(operation) == repository.create_operation(
            operation
        )
    finally:
        connection.close()


class _MigrationCursor:
    def __init__(self, duplicate_groups):
        self.duplicate_groups = duplicate_groups
        self.statements = []

    def execute(self, statement, params=None):
        self.statements.append((" ".join(statement.split()), params))
        return self

    def fetchone(self):
        return (self.duplicate_groups,)


def test_v63_migration_checks_duplicates_before_replacing_constraint():
    cursor = _MigrationCursor(0)

    _upgrade_to_v63_scope_procurement_operation_idempotency(cursor, None)

    assert DB_SCHEMA_VERSION >= 63
    assert any(
        upgrade.version == 63
        and upgrade.name == "scope_procurement_operation_idempotency"
        for upgrade in UPGRADES
    )
    assert "GROUP BY organization_id, provider, family_key" in cursor.statements[0][0]
    assert "DROP CONSTRAINT IF EXISTS" in cursor.statements[1][0]
    assert "family_idempotency_unique" in cursor.statements[2][0]


def test_v63_migration_refuses_ambiguous_existing_rows_before_ddl():
    cursor = _MigrationCursor(2)

    with pytest.raises(RuntimeError, match="2 duplicate family-scoped groups"):
        _upgrade_to_v63_scope_procurement_operation_idempotency(cursor, None)

    assert len(cursor.statements) == 1


class _PersistenceCursor:
    def __init__(self):
        self.statements = []

    def execute(self, statement, params=()):
        self.statements.append((" ".join(statement.split()), tuple(params)))
        return self


def _normal_reconciliation_result():
    return {
        "provenance": {
            "organizationId": "org-1",
            "provider": "VNEPS",
            "kind": "PLAN",
            "familyNo": "PLAN-A",
            "revisionId": "revision-1",
            "revisionNumber": "01",
            "normalizedSnapshot": {"planNo": "PLAN-A"},
            "digest": "sha256:" + "d" * 64,
            "schemaVersion": "1",
            "disposition": "APPLIED",
            "idempotencyKey": "apply:PLAN-A:01",
            "actorUserId": "user-1",
            "localEntityType": "kehoach",
            "localRootId": "plan-root-1",
            "localSnapshotId": "plan-snapshot-1",
            "matchMethod": "SOURCE_EXACT",
        },
        "createdPlans": [],
        "createdPackages": [],
        "bindings": [],
    }


def test_normal_procurement_reconciliation_requires_transactional_audit(monkeypatch):
    cursor = _PersistenceCursor()
    repository = ProcurementImportRepository(cursor)
    monkeypatch.setattr(repository, "_ensure_sync_version", lambda _org: 7)
    monkeypatch.setattr(
        procurement_repository, "enqueue_websocket_event", lambda *_args, **_kwargs: None
    )
    audit_calls = []
    monkeypatch.setattr(
        procurement_repository,
        "log_audit",
        lambda action, **kwargs: audit_calls.append((action, kwargs)),
    )

    repository.persist_revision(_normal_reconciliation_result())

    assert audit_calls[0][0] == "procurement.source_revision_reconciled"
    assert audit_calls[0][1]["cursor"] is cursor
    assert audit_calls[0][1]["required"] is True


def test_normal_procurement_reconciliation_propagates_required_audit_failure(
    monkeypatch,
):
    cursor = _PersistenceCursor()
    repository = ProcurementImportRepository(cursor)
    monkeypatch.setattr(repository, "_ensure_sync_version", lambda _org: 7)
    monkeypatch.setattr(
        procurement_repository, "enqueue_websocket_event", lambda *_args, **_kwargs: None
    )
    monkeypatch.setattr(
        procurement_repository,
        "log_audit",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("audit failed")),
    )

    with pytest.raises(RuntimeError, match="audit failed"):
        repository.persist_revision(_normal_reconciliation_result())
