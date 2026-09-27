"""A preview saved by one process remains scoped and readable by another."""

import os
from pathlib import Path
import subprocess
import sys
import uuid

import psycopg
import pytest


ROOT = Path(__file__).resolve().parents[1]
WORKER = r'''
import os
import sys
from datetime import datetime, timedelta, timezone
from backend.db.db_helper import PostgresDatabase
from backend.procurement_import.domain import canonical_digest
from backend.procurement_import.repository import ProcurementImportSessionRepository
from backend.procurement_import.service import PreviewStore
import backend.procurement_import.routes as routes

mode, organization_id, preview_id = sys.argv[1:4]
database = PostgresDatabase(os.environ["TEST_DATABASE_URL"])
try:
    if mode == "prepare":
        now = datetime.now(timezone.utc)
        preview = {"provider": "MUASAMCONG", "notice": {"noticeNo": "IB2600000001"}}
        session = {
            "id": "session-" + preview_id,
            "organizationId": organization_id,
            "userId": "user-1",
            "workspaceLease": "lease-1",
            "provider": "MUASAMCONG",
            "kind": "PACKAGE",
            "familyNo": "IB2600000001",
            "bundleDigest": canonical_digest(preview),
            "revisions": [],
            "canonicalBundle": preview,
            "currentIndex": 0,
            "status": "READY",
            "expiresAt": now + timedelta(days=1),
            "createdAt": now,
            "updatedAt": now,
            "previewId": preview_id,
            "previewBundle": preview,
            "previewBundleDigest": canonical_digest(preview),
            "previewExpiresAt": now + timedelta(minutes=5),
        }
        connection = database.get_connection()
        try:
            ProcurementImportSessionRepository(connection.cursor()).create(session)
            connection.commit()
        finally:
            connection.close()
        print("prepared")
    else:
        routes.database = database
        routes.PREVIEW_STORE = PreviewStore(ttl_seconds=300)
        try:
            loaded = routes._load_preview(
                None, preview_id,
                organization_id=organization_id,
                user_id="wrong-user" if mode == "wrong-user" else "user-1",
                workspace_lease="lease-1",
            )
        except PermissionError:
            print("scope-denied")
        except LookupError:
            print("expired")
        else:
            assert loaded.canonical_bundle["notice"]["noticeNo"] == "IB2600000001"
            print("loaded")
finally:
    database.close()
'''


def test_preview_survives_prepare_process_exit_and_rejects_wrong_scope_and_expiry():
    url = str(os.environ.get("TEST_DATABASE_URL") or "").strip()
    if not url:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL process test")
    organization_id = f"preview-process-{uuid.uuid4().hex}"
    preview_id = f"preview-{uuid.uuid4().hex}"
    environment = {**os.environ, "TEST_DATABASE_URL": url}

    def run_worker(mode):
        result = subprocess.run(
            [sys.executable, "-c", WORKER, mode, organization_id, preview_id],
            cwd=ROOT, env=environment, capture_output=True, text=True,
            timeout=20, check=False,
        )
        assert result.returncode == 0, result.stderr
        return result.stdout.strip()

    try:
        assert run_worker("prepare") == "prepared"
        assert run_worker("apply") == "loaded"
        assert run_worker("wrong-user") == "scope-denied"
        with psycopg.connect(url, connect_timeout=5) as connection:
            connection.execute(
                """UPDATE procurement_import_session
                      SET preview_expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second'
                    WHERE organization_id = %s AND preview_id = %s""",
                (organization_id, preview_id),
            )
        assert run_worker("apply") == "expired"
    finally:
        with psycopg.connect(url, connect_timeout=5) as connection:
            connection.execute(
                "DELETE FROM procurement_import_session WHERE organization_id = %s",
                (organization_id,),
            )
