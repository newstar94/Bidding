"""Durable linked-notice enrichment recovery and lease fencing.

These tests intentionally use the local PostgreSQL test database.  An in-memory
fake cannot reproduce the cross-worker claim race or timestamp fencing that
caused the original daemon-loss bug.
"""

from datetime import datetime, timedelta, timezone
import os
from uuid import uuid4

from psycopg.errors import SerializationFailure
import pytest

from backend.db.db_helper import PostgresDatabase
from backend.procurement_import.domain import canonical_digest
from backend.procurement_import.repository import (
    ProcurementImportRepository,
    ProcurementImportSessionRepository,
)
import backend.procurement_import.routes as routes


def _database_url():
    return str(os.environ.get("TEST_DATABASE_URL") or "").strip()


def _seed(url):
    database = PostgresDatabase(url)
    organization = f"enrichment-recovery-{uuid4().hex}"
    session_id = f"session-{uuid4().hex}"
    operation_id = f"operation-{uuid4().hex}"
    bundle = {
        "schemaVersion": "biddingflow-procurement-import-preview-v2",
        "provider": "MUASAMCONG",
        "revisionMode": "LATEST",
        "plan": {
            "familyNo": "PL-RECOVERY",
            "preview": {"revisionNumber": "01"},
        },
        "revisions": [{
            "revisionId": "revision-1",
            "revisionNumber": "01",
            "packages": [{
                "noticeLink": {"state": "LINKED", "noticeNo": "IB-RECOVERY"},
            }],
        }],
    }
    now = datetime.now(timezone.utc)
    connection = database.get_connection()
    try:
        session_repository = ProcurementImportSessionRepository(connection.cursor())
        session_repository.create({
            "id": session_id,
            "organizationId": organization,
            "userId": "recovery-user",
            "workspaceLease": "recovery-lease",
            "provider": "MUASAMCONG",
            "kind": "PLAN",
            "familyNo": "PL-RECOVERY",
            "bundleDigest": canonical_digest(bundle),
            "revisions": bundle["revisions"],
            "canonicalBundle": bundle,
            "currentIndex": 0,
            "status": "READY",
            "expiresAt": now + timedelta(hours=1),
            "createdAt": now,
            "updatedAt": now,
        })
        ProcurementImportRepository(connection.cursor()).create_operation({
            "id": operation_id,
            "organizationId": organization,
            "provider": "MUASAMCONG",
            "familyNo": "PL-RECOVERY",
            "totalRevisions": 1,
            "bundleDigest": canonical_digest(bundle),
            "revisionResults": [{"noticeNo": "IB-RECOVERY", "status": "PENDING"}],
            "idempotencyKey": f"enrichment:{session_id}",
            "requestHash": "a" * 64,
            "actorUserId": "recovery-user",
        })
        connection.commit()
        connection.execute(
            """UPDATE procurement_import_operation
                  SET status = 'RUNNING',
                      updated_at = CURRENT_TIMESTAMP - INTERVAL '1 hour'
                WHERE organization_id = %s AND id = %s""",
            (organization, operation_id),
        )
        connection.commit()
    finally:
        connection.close()
    return database, organization, session_id, operation_id, bundle


def test_two_workers_only_one_claims_and_stale_owner_is_fenced(monkeypatch):
    url = _database_url()
    if not url:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL recovery tests")
    database, organization, _session_id, operation_id, _bundle = _seed(url)
    try:
        import threading

        barriers = [threading.Barrier(2)]
        claims = []

        def worker():
            connection = database.get_connection()
            try:
                connection.execute("BEGIN ISOLATION LEVEL SERIALIZABLE")
                repository = ProcurementImportRepository(connection.cursor())
                barriers[0].wait(timeout=5)
                claim = repository.claim_background_operation(
                    organization, operation_id, stale_after_seconds=1,
                )
                connection.commit()
                claims.append(claim)
            except SerializationFailure:
                connection.rollback()
                claims.append(None)
            finally:
                connection.close()

        threads = [threading.Thread(target=worker) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
        assert all(not thread.is_alive() for thread in threads)
        assert sum(value is not None for value in claims) == 1

        connection = database.get_connection()
        try:
            repository = ProcurementImportRepository(connection.cursor())
            stale_update = repository.update_operation(
                organization,
                operation_id,
                cursor=1,
                results=[{"noticeNo": "IB-RECOVERY", "status": "SUCCEEDED"}],
                status="COMPLETED",
                expected_lease=0,
            )
            assert stale_update is None
            current = repository.get_operation(organization, operation_id)
            assert current["status"] == "RUNNING"
            assert current["nextRevisionIndex"] == 0
        finally:
            connection.rollback()
            connection.close()
    finally:
        with database.get_connection() as connection:
            connection.execute(
                "DELETE FROM procurement_import_operation WHERE organization_id = %s",
                (organization,),
            )
            connection.execute(
                "DELETE FROM procurement_import_session WHERE organization_id = %s",
                (organization,),
            )
        database.close()


def test_restart_scanner_recovers_stale_operation_with_durable_scope(monkeypatch):
    url = _database_url()
    if not url:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL recovery tests")
    database, organization, session_id, operation_id, bundle = _seed(url)
    captured = []
    try:
        monkeypatch.setattr(routes, "database", database)

        class ImmediateThread:
            def __init__(self, *, target, args, **_kwargs):
                self.target, self.args = target, args

            def start(self):
                captured.append(self.args[0])

        monkeypatch.setattr(routes.threading, "Thread", ImmediateThread)
        monkeypatch.setattr(routes, "_run_plan_enrichment", lambda *_args: None)
        assert routes.recover_stale_plan_enrichments(limit=4) == 1
        assert captured == [{
            "sessionId": session_id,
            "familyNo": "PL-RECOVERY",
            "revisionMode": "LATEST",
            "selectedRevision": "01",
            "workspaceLease": "recovery-lease",
            "organizationId": organization,
            "userId": "recovery-user",
            "provider": "MUASAMCONG",
            "linkedNoticeCount": 1,
        }]
    finally:
        with database.get_connection() as connection:
            connection.execute(
                "DELETE FROM procurement_import_operation WHERE organization_id = %s",
                (organization,),
            )
            connection.execute(
                "DELETE FROM procurement_import_session WHERE organization_id = %s",
                (organization,),
            )
        database.close()


def test_failed_recovery_after_progress_keeps_cursor_and_commits_terminal_state(
    monkeypatch,
):
    url = _database_url()
    if not url:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL recovery tests")
    database, organization, _session_id, operation_id, _bundle = _seed(url)
    try:
        monkeypatch.setattr(routes, "database", database)
        context = {"organizationId": organization}
        connection = database.get_connection()
        try:
            connection.execute("BEGIN ISOLATION LEVEL SERIALIZABLE")
            lease = ProcurementImportRepository(
                connection.cursor()
            ).claim_background_operation(
                organization, operation_id, stale_after_seconds=1,
            )
            connection.commit()
            assert lease is not None
        finally:
            connection.close()
        connection = database.get_connection()
        try:
            connection.execute("BEGIN ISOLATION LEVEL SERIALIZABLE")
            repository = ProcurementImportRepository(connection.cursor())
            renewed = repository.update_operation(
                organization,
                operation_id,
                cursor=1,
                results=[{"noticeNo": "IB-RECOVERY", "status": "SUCCEEDED"}],
                status="RUNNING",
                expected_lease=lease,
            )
            connection.commit()
            assert renewed is not None
        finally:
            connection.close()
        context["_operationLease"] = renewed
        assert routes._finish_enrichment_operation(
            context,
            operation_id,
            status="FAILED",
            results=[{"noticeNo": "IB-RECOVERY", "status": "FAILED"}],
            error_code="source-crashed",
        )
        connection = database.get_connection()
        try:
            operation = ProcurementImportRepository(
                connection.cursor()
            ).get_operation(organization, operation_id)
            assert operation["status"] == "FAILED"
            assert operation["nextRevisionIndex"] == 1
        finally:
            connection.close()
    finally:
        with database.get_connection() as connection:
            connection.execute(
                "DELETE FROM procurement_import_operation WHERE organization_id = %s",
                (organization,),
            )
            connection.execute(
                "DELETE FROM procurement_import_session WHERE organization_id = %s",
                (organization,),
            )
        database.close()


def test_recovery_scan_does_not_starve_valid_rows_behind_missing_session(monkeypatch):
    url = _database_url()
    if not url:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL recovery tests")
    database, organization, _session_id, operation_id, bundle = _seed(url)
    captured = []
    missing_operation_id = f"operation-missing-{uuid4().hex}"
    expired_session_id = f"session-expired-{uuid4().hex}"
    expired_operation_id = f"operation-expired-{uuid4().hex}"
    try:
        connection = database.get_connection()
        try:
            expired_at = datetime.now(timezone.utc) - timedelta(hours=1)
            ProcurementImportSessionRepository(connection.cursor()).create({
                "id": expired_session_id,
                "organizationId": organization,
                "userId": "expired-user",
                "workspaceLease": "expired-lease",
                "provider": "MUASAMCONG",
                "kind": "PLAN",
                "familyNo": "PL-EXPIRED",
                "bundleDigest": canonical_digest(bundle),
                "revisions": bundle["revisions"],
                "canonicalBundle": bundle,
                "currentIndex": 0,
                "status": "READY",
                "expiresAt": expired_at,
                "createdAt": expired_at,
                "updatedAt": expired_at,
            })
            connection.execute(
                """INSERT INTO procurement_import_operation (
                         id, organization_id, provider, family_key, mode, status,
                         total_revisions, bundle_digest, idempotency_key,
                         request_hash, actor_user_id, updated_at)
                     VALUES (%s, %s, 'MUASAMCONG', 'PL-EXPIRED', 'ALL', 'RUNNING',
                             1, %s, %s, %s, 'expired-user',
                             CURRENT_TIMESTAMP - INTERVAL '2 hours')""",
                (
                    expired_operation_id,
                    organization,
                    canonical_digest(bundle),
                    f"enrichment:{expired_session_id}",
                    "c" * 64,
                ),
            )
            connection.execute(
                """INSERT INTO procurement_import_operation (
                         id, organization_id, provider, family_key, mode, status,
                         total_revisions, bundle_digest, idempotency_key,
                         request_hash, actor_user_id, updated_at)
                     VALUES (%s, %s, 'MUASAMCONG', 'PL-MISSING', 'ALL', 'RUNNING',
                             1, %s, %s, %s, 'missing-user',
                             CURRENT_TIMESTAMP - INTERVAL '2 hours')""",
                (
                    missing_operation_id,
                    organization,
                    canonical_digest(bundle),
                    f"enrichment:missing-session-{uuid4().hex}",
                    "b" * 64,
                ),
            )
            connection.commit()
        finally:
            connection.close()
        monkeypatch.setattr(routes, "database", database)

        class ImmediateThread:
            def __init__(self, *, target, args, **_kwargs):
                self.args = args

            def start(self):
                captured.append(self.args[0])

        monkeypatch.setattr(routes.threading, "Thread", ImmediateThread)
        monkeypatch.setattr(routes, "_run_plan_enrichment", lambda *_args: None)
        # The valid row must be found even though an invalid older row exists;
        # a pre-fix LIMIT query returned zero and retried the invalid row forever.
        assert routes.recover_stale_plan_enrichments(limit=1) == 1
        assert captured and captured[0]["organizationId"] == organization
        assert captured[0]["familyNo"] == "PL-RECOVERY"
    finally:
        with database.get_connection() as connection:
            connection.execute(
                "DELETE FROM procurement_import_operation WHERE organization_id = %s",
                (organization,),
            )
            connection.execute(
                "DELETE FROM procurement_import_session WHERE organization_id = %s",
                (organization,),
            )
        database.close()


def test_stale_owner_rollback_keeps_session_bundle_unchanged():
    url = _database_url()
    if not url:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL recovery tests")
    database, organization, session_id, operation_id, bundle = _seed(url)
    try:
        connection = database.get_connection()
        try:
            connection.execute("BEGIN ISOLATION LEVEL SERIALIZABLE")
            lease = ProcurementImportRepository(
                connection.cursor()
            ).claim_background_operation(
                organization, operation_id, stale_after_seconds=1,
            )
            connection.commit()
        finally:
            connection.close()
        # Simulate a restart worker taking the stale lease before the old
        # worker reaches its final session/operation transaction.
        connection = database.get_connection()
        try:
            connection.execute(
                """UPDATE procurement_import_operation
                      SET updated_at = CURRENT_TIMESTAMP - INTERVAL '1 hour'
                    WHERE organization_id = %s AND id = %s""",
                (organization, operation_id),
            )
            connection.commit()
            connection.execute("BEGIN ISOLATION LEVEL SERIALIZABLE")
            replacement = ProcurementImportRepository(
                connection.cursor()
            ).claim_background_operation(
                organization, operation_id, stale_after_seconds=1,
            )
            connection.commit()
            assert replacement is not None and replacement != lease
        finally:
            connection.close()

        changed_bundle = {**bundle, "enrichmentStatus": "COMPLETED"}
        connection = database.get_connection()
        try:
            connection.execute("BEGIN ISOLATION LEVEL SERIALIZABLE")
            session_updated = ProcurementImportSessionRepository(
                connection.cursor()
            ).update_canonical_bundle(
                session_id,
                organization_id=organization,
                user_id="recovery-user",
                workspace_lease="recovery-lease",
                bundle=changed_bundle,
                bundle_digest=canonical_digest(changed_bundle),
            )
            fenced = ProcurementImportRepository(connection.cursor()).update_operation(
                organization,
                operation_id,
                cursor=1,
                results=[{"noticeNo": "IB-RECOVERY", "status": "SUCCEEDED"}],
                status="COMPLETED",
                expected_lease=lease,
            )
            assert session_updated is True
            assert fenced is None
            connection.rollback()
        finally:
            connection.close()

        connection = database.get_connection()
        try:
            stored = ProcurementImportSessionRepository(
                connection.cursor()
            ).get_for_background_recovery(
                session_id, organization_id=organization,
            )
            assert stored["canonicalBundle"] == bundle
            assert stored["bundleDigest"] == canonical_digest(bundle)
        finally:
            connection.close()
    finally:
        with database.get_connection() as connection:
            connection.execute(
                "DELETE FROM procurement_import_operation WHERE organization_id = %s",
                (organization,),
            )
            connection.execute(
                "DELETE FROM procurement_import_session WHERE organization_id = %s",
                (organization,),
            )
        database.close()
