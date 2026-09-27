"""Bounded expiry cleanup against an isolated PostgreSQL test transaction."""

import os
import uuid

import psycopg
import pytest

from backend.procurement_import.repository import ProcurementImportSessionRepository


def test_expired_preview_cleanup_releases_bundles_without_losing_expiry_marker():
    url = str(os.environ.get("TEST_DATABASE_URL") or "").strip()
    if not url:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL cleanup test")
    organization_id = f"preview-cleanup-{uuid.uuid4().hex}"
    digest = "sha256:" + "0" * 64
    with psycopg.connect(url, connect_timeout=5) as connection:
        try:
            with connection.cursor() as cursor:
                cursor.execute(
                    """INSERT INTO procurement_import_session (
                           id, organization_id, user_id, workspace_lease,
                           provider, entity_kind, family_key, bundle_digest,
                           revisions_json, canonical_bundle_json, status,
                           expires_at, preview_id, preview_bundle_json,
                           preview_bundle_digest, preview_expires_at)
                       SELECT 'session-' || n, %s, 'user-1', 'lease-1',
                              'MUASAMCONG', 'PLAN', 'family-1', %s,
                              '[]', '{}', 'READY',
                              CURRENT_TIMESTAMP + INTERVAL '1 day',
                              'preview-' || n, '{}', %s,
                              CURRENT_TIMESTAMP - INTERVAL '1 minute'
                         FROM generate_series(1, 101) AS n""",
                    (organization_id, digest, digest),
                )
                repository = ProcurementImportSessionRepository(cursor)
                repository.cleanup_expired()
                cursor.execute(
                    """SELECT COUNT(*), COUNT(preview_bundle_json),
                              COUNT(preview_id), COUNT(preview_expires_at)
                         FROM procurement_import_session
                        WHERE organization_id = %s""",
                    (organization_id,),
                )
                total, remaining, ids, expiry_markers = cursor.fetchone()
                assert total == ids == expiry_markers == 101
                assert 1 <= remaining <= 101  # one call clears at most 100
                for _ in range(3):
                    repository.cleanup_expired()
                cursor.execute(
                    """SELECT COUNT(preview_bundle_json)
                         FROM procurement_import_session
                        WHERE organization_id = %s""",
                    (organization_id,),
                )
                assert cursor.fetchone()[0] == 0
        finally:
            connection.rollback()
