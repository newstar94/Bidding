import asyncio
import concurrent.futures
import json
import os
import shutil
import time

import pytest

from backend.documents import document_worker
from backend.documents.document_job_routes import document_job_routes
from backend.documents.document_worker import (
    _document_job_dir,
    cancel_document_export,
    enqueue_document_export,
    get_document_export_job,
    process_next_durable_document_job,
    read_document_export_result,
    retry_failed_durable_document_job,
    run_document_job_async,
)
from backend.documents.document_job_policy import (
    DocumentJobAuthorizationError,
    build_document_job_policy,
)
from backend.auth.auth_helper import SessionRole
from backend.db.db_helper import PostgresDatabase
from tests.test_sync_conflict_authorization import _seed_denied_package


class Result:
    rowcount = 1


class Connection:
    def __init__(self):
        self.calls = []
        self.committed = False
        self.rolled_back = False

    def execute(self, statement, params=()):
        self.calls.append((" ".join(statement.split()), tuple(params)))
        return Result()

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def close(self):
        pass


class Database:
    def __init__(self):
        self.connection = Connection()

    def get_connection(self):
        return self.connection


def _policy_snapshot(*, organization_id="org-a", user_id="user-a", revision=1, format="xlsx"):
    role = SessionRole(
        "employee",
        user_id,
        platform_role="user",
        active_role="employee",
        active_role_organization_id=organization_id,
    )
    return build_document_job_policy(
        role, package_revision=revision, document_format=format
    )


def _seed_export_job_scope(connection):
    cursor = connection.cursor()
    organization_id, user_id, package_id = _seed_denied_package(cursor)
    cursor.execute(
        """UPDATE thanh_vien_to_chuc
              SET vai_tro_trong_to_chuc = 'manager'
            WHERE organization_id = ? AND user_id = ?""",
        (organization_id, user_id),
    )
    now = int(time.time())
    cursor.execute(
        """INSERT INTO organization_subscriptions
              (organization_id, package_id, status, starts_at, expires_at, member_quota)
            VALUES (?, 'diamond', 'active', ?, ?, 10)""",
        (organization_id, now - 60, now + 3600),
    )
    package = cursor.execute(
        "SELECT row_version FROM goi_thau WHERE organization_id = ? AND id = ?",
        (organization_id, package_id),
    ).fetchone()
    connection.commit()
    role = SessionRole(
        "manager",
        user_id,
        platform_role="user",
        active_role="manager",
        active_role_organization_id=organization_id,
    )
    policy, fingerprint = build_document_job_policy(
        role,
        package_revision=int(package[0]),
        document_format="xlsx",
    )
    return organization_id, user_id, package_id, policy, fingerprint


def _cleanup_export_job_scope(connection, organization_id):
    user_rows = connection.execute(
        "SELECT user_id FROM thanh_vien_to_chuc WHERE organization_id = ?",
        (organization_id,),
    ).fetchall()
    user_ids = [str(row[0]) for row in user_rows]
    for table in (
        "document_jobs",
        "document_export_capabilities",
        "organization_subscriptions",
        "phan_cong_nhan_su",
        "ma_tran_phan_quyen",
        "goi_thau",
        "ke_hoach_lcnt",
        "chu_dau_tu",
        "thanh_vien_to_chuc",
    ):
        connection.execute(
            f"DELETE FROM {table} WHERE organization_id = ?",  # noqa: S608 - fixed test table list
            (organization_id,),
        )
    connection.execute("DELETE FROM to_chuc WHERE id = ?", (organization_id,))
    for user_id in user_ids:
        connection.execute("DELETE FROM tai_khoan WHERE id = ?", (user_id,))
    connection.commit()


def test_async_export_routes_cover_create_status_download_retry_and_cancel():
    class Route:
        def __init__(self, path, endpoint, methods):
            self.path = path
            self.endpoint = endpoint
            self.methods = methods

    routes = document_job_routes(Route)
    methods = {(route.path, tuple(route.methods)) for route in routes}
    assert ("/api/document-jobs/package-report/{package_id}", ("POST",)) in methods
    assert ("/api/document-jobs/{job_id}", ("GET",)) in methods
    assert ("/api/document-jobs/{job_id}/download", ("GET",)) in methods
    assert ("/api/document-jobs/{job_id}/retry", ("POST",)) in methods
    assert ("/api/document-jobs/{job_id}", ("DELETE",)) in methods


def test_cancel_is_owner_scoped_and_only_affects_pending_jobs():
    database = Database()

    assert cancel_document_export(database, "job-1", "org-a", "user-a")

    statement, params = database.connection.calls[0]
    assert "status IN ('pending', 'retry')" in statement
    assert params[-3:] == ("job-1", "org-a", "user-a")
    assert database.connection.committed


def test_export_job_and_required_audit_share_one_transaction(tmp_path, monkeypatch):
    database = Database()
    observed = {}
    monkeypatch.setenv("DOCUMENT_WORKER_TEMP_DIR", str(tmp_path))

    def record_audit(cursor, **event):
        observed["cursor"] = cursor
        observed["event"] = event

    monkeypatch.setattr(document_worker, "insert_audit_row", record_audit)
    policy, fingerprint = _policy_snapshot()
    job_id = enqueue_document_export(
        "export_excel",
        {"function": "create_phanlo_excel", "args": [[]]},
        organization_id="org-a",
        user_id="user-a",
        package_id="package-a",
        filename="export.xlsx",
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        policy=policy,
        policy_hash=fingerprint,
        database=database,
        audit_event={
            "actor_user_id": "user-a",
            "organization_id": "org-a",
            "action": "document.export_job_created",
            "target_type": "goi_thau",
            "target_id": "package-a",
            "metadata": {"document_type": "evaluation"},
        },
    )

    assert observed["cursor"] is database.connection
    assert observed["event"]["action"] == "document.export_job_created"
    assert json.loads(observed["event"]["metadata_json"])["job_id"] == job_id
    assert database.connection.committed
    shutil.rmtree(_document_job_dir(job_id), ignore_errors=True)


def test_export_job_rolls_back_and_removes_payload_when_required_audit_fails(
    tmp_path, monkeypatch,
):
    database = Database()
    monkeypatch.setenv("DOCUMENT_WORKER_TEMP_DIR", str(tmp_path))

    def fail_audit(_cursor, **_event):
        raise RuntimeError("audit unavailable")

    monkeypatch.setattr(document_worker, "insert_audit_row", fail_audit)
    policy, fingerprint = _policy_snapshot()
    with pytest.raises(RuntimeError, match="audit unavailable"):
        enqueue_document_export(
            "export_excel",
            {"function": "create_phanlo_excel", "args": [[]]},
            organization_id="org-a",
            user_id="user-a",
            package_id="package-a",
            filename="export.xlsx",
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            policy=policy,
            policy_hash=fingerprint,
            database=database,
            audit_event={
                "actor_user_id": "user-a",
                "organization_id": "org-a",
                "action": "document.export_job_created",
            },
        )

    assert database.connection.rolled_back
    assert list(tmp_path.glob("job-*")) == []


def test_durable_export_job_completes_and_isolated_owner_can_download(tmp_path, monkeypatch):
    database_url = str(os.environ.get("TEST_DATABASE_URL") or "").strip()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is required for document job integration")
    monkeypatch.setenv("DOCUMENT_WORKER_TEMP_DIR", str(tmp_path))
    database = PostgresDatabase(database_url)
    job_ids = []
    organization_id = None
    try:
        connection = database.get_connection()
        try:
            (
                organization_id,
                user_id,
                package_id,
                policy,
                fingerprint,
            ) = _seed_export_job_scope(connection)
        finally:
            connection.close()
        job_id = enqueue_document_export(
            "export_excel",
            {"function": "create_phanlo_excel", "args": [[]]},
            organization_id=organization_id,
            user_id=user_id,
            package_id=package_id,
            filename="export.xlsx",
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            policy=policy,
            policy_hash=fingerprint,
            database=database,
        )
        job_ids.append(job_id)

        assert process_next_durable_document_job(database, job_id=job_id)
        job, result = read_document_export_result(
            database,
            job_id,
            organization_id,
            user_id,
        )

        assert job["status"] == "completed"
        assert bytes(result).startswith(b"PK")
        assert get_document_export_job(
            database, job_id, organization_id, "another-user"
        ) is None
    finally:
        connection = database.get_connection()
        try:
            for job_id in job_ids:
                connection.execute("DELETE FROM document_jobs WHERE id = ?", (job_id,))
            if organization_id:
                _cleanup_export_job_scope(connection, organization_id)
        finally:
            connection.close()
        for job_id in job_ids:
            shutil.rmtree(_document_job_dir(job_id), ignore_errors=True)
        database.close()


def test_revoked_job_fails_before_worker_publishes_artifact(tmp_path, monkeypatch):
    database_url = str(os.environ.get("TEST_DATABASE_URL") or "").strip()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is required for document job integration")
    monkeypatch.setenv("DOCUMENT_WORKER_TEMP_DIR", str(tmp_path))
    database = PostgresDatabase(database_url)
    connection = database.get_connection()
    job_id = None
    organization_id = None
    try:
        (
            organization_id,
            user_id,
            package_id,
            policy,
            fingerprint,
        ) = _seed_export_job_scope(connection)
        job_id = enqueue_document_export(
            "export_excel",
            {"function": "create_phanlo_excel", "args": [[]]},
            organization_id=organization_id,
            user_id=user_id,
            package_id=package_id,
            filename="export.xlsx",
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            policy=policy,
            policy_hash=fingerprint,
            database=database,
        )
        connection.execute(
            "UPDATE thanh_vien_to_chuc SET trang_thai_thanh_vien = 'left' WHERE organization_id = ? AND user_id = ?",
            (organization_id, user_id),
        )
        connection.commit()

        assert process_next_durable_document_job(database, job_id=job_id)
        job = get_document_export_job(database, job_id, organization_id, user_id)
        assert job["status"] == "failed"
        assert job["last_error_code"] == "DocumentJobAuthorizationError"
        assert not (_document_job_dir(job_id) / "result.json").exists()
    finally:
        connection.rollback()
        if job_id:
            connection.execute("DELETE FROM document_jobs WHERE id = ?", (job_id,))
            shutil.rmtree(_document_job_dir(job_id), ignore_errors=True)
        if organization_id:
            _cleanup_export_job_scope(connection, organization_id)
        connection.close()
        database.close()


def test_permission_revoked_during_render_prevents_artifact_publication(
    tmp_path, monkeypatch,
):
    database_url = str(os.environ.get("TEST_DATABASE_URL") or "").strip()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is required for document job integration")
    monkeypatch.setenv("DOCUMENT_WORKER_TEMP_DIR", str(tmp_path))
    database = PostgresDatabase(database_url)
    connection = database.get_connection()
    job_id = None
    organization_id = None
    try:
        (
            organization_id,
            user_id,
            package_id,
            policy,
            fingerprint,
        ) = _seed_export_job_scope(connection)
        job_id = enqueue_document_export(
            "export_excel",
            {"function": "create_phanlo_excel", "args": [[]]},
            organization_id=organization_id,
            user_id=user_id,
            package_id=package_id,
            filename="export.xlsx",
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            policy=policy,
            policy_hash=fingerprint,
            database=database,
        )

        def render_then_revoke(*_args, **_kwargs):
            revoke_connection = database.get_connection()
            try:
                revoke_connection.execute(
                    """UPDATE thanh_vien_to_chuc
                          SET trang_thai_thanh_vien = 'left'
                        WHERE organization_id = ? AND user_id = ?""",
                    (organization_id, user_id),
                )
                revoke_connection.commit()
            finally:
                revoke_connection.close()
            return b"rendered-but-not-authorized"

        monkeypatch.setattr(document_worker, "run_document_job", render_then_revoke)

        assert process_next_durable_document_job(database, job_id=job_id)
        job = get_document_export_job(database, job_id, organization_id, user_id)
        assert job["status"] == "failed"
        assert job["last_error_code"] == "DocumentJobAuthorizationError"
        assert not (_document_job_dir(job_id) / "result.json").exists()
    finally:
        connection.rollback()
        if job_id:
            connection.execute("DELETE FROM document_jobs WHERE id = ?", (job_id,))
            shutil.rmtree(_document_job_dir(job_id), ignore_errors=True)
        if organization_id:
            _cleanup_export_job_scope(connection, organization_id)
        connection.close()
        database.close()


def test_platform_demotion_during_render_prevents_artifact_publication(
    tmp_path, monkeypatch,
):
    database_url = str(os.environ.get("TEST_DATABASE_URL") or "").strip()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is required for document job integration")
    monkeypatch.setenv("DOCUMENT_WORKER_TEMP_DIR", str(tmp_path))
    database = PostgresDatabase(database_url)
    connection = database.get_connection()
    job_id = None
    organization_id = None
    try:
        (
            organization_id,
            user_id,
            package_id,
            _policy,
            _fingerprint,
        ) = _seed_export_job_scope(connection)
        connection.execute(
            "UPDATE tai_khoan SET vai_tro = 'super_admin' WHERE id = ?",
            (user_id,),
        )
        connection.execute(
            """UPDATE thanh_vien_to_chuc
                  SET trang_thai_thanh_vien = 'left'
                WHERE organization_id = ? AND user_id = ?""",
            (organization_id, user_id),
        )
        package_revision = connection.execute(
            "SELECT row_version FROM goi_thau WHERE organization_id = ? AND id = ?",
            (organization_id, package_id),
        ).fetchone()[0]
        connection.commit()
        policy, fingerprint = build_document_job_policy(
            SessionRole(
                "super_admin",
                user_id,
                platform_role="super_admin",
                active_role="super_admin",
            ),
            package_revision=int(package_revision),
            document_format="xlsx",
        )
        job_id = enqueue_document_export(
            "export_excel",
            {"function": "create_phanlo_excel", "args": [[]]},
            organization_id=organization_id,
            user_id=user_id,
            package_id=package_id,
            filename="export.xlsx",
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            policy=policy,
            policy_hash=fingerprint,
            database=database,
        )

        def render_then_demote(*_args, **_kwargs):
            demotion_connection = database.get_connection()
            try:
                demotion_connection.execute(
                    "UPDATE tai_khoan SET vai_tro = 'user' WHERE id = ?",
                    (user_id,),
                )
                demotion_connection.commit()
            finally:
                demotion_connection.close()
            return b"rendered-with-revoked-platform-role"

        monkeypatch.setattr(document_worker, "run_document_job", render_then_demote)

        assert process_next_durable_document_job(database, job_id=job_id)
        job = get_document_export_job(database, job_id, organization_id, user_id)
        assert job["status"] == "failed"
        assert job["last_error_code"] == "DocumentJobAuthorizationError"
        assert not (_document_job_dir(job_id) / "result.json").exists()
    finally:
        connection.rollback()
        if job_id:
            connection.execute("DELETE FROM document_jobs WHERE id = ?", (job_id,))
            shutil.rmtree(_document_job_dir(job_id), ignore_errors=True)
        if organization_id:
            _cleanup_export_job_scope(connection, organization_id)
        connection.close()
        database.close()


def test_completed_export_is_not_downloadable_after_permission_revocation(
    tmp_path, monkeypatch,
):
    database_url = str(os.environ.get("TEST_DATABASE_URL") or "").strip()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is required for document job integration")
    monkeypatch.setenv("DOCUMENT_WORKER_TEMP_DIR", str(tmp_path))
    database = PostgresDatabase(database_url)
    connection = database.get_connection()
    job_id = None
    organization_id = None
    try:
        (
            organization_id,
            user_id,
            package_id,
            policy,
            fingerprint,
        ) = _seed_export_job_scope(connection)
        job_id = enqueue_document_export(
            "export_excel",
            {"function": "create_phanlo_excel", "args": [[]]},
            organization_id=organization_id,
            user_id=user_id,
            package_id=package_id,
            filename="export.xlsx",
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            policy=policy,
            policy_hash=fingerprint,
            database=database,
        )
        assert process_next_durable_document_job(database, job_id=job_id)
        connection.execute(
            """UPDATE thanh_vien_to_chuc
                  SET trang_thai_thanh_vien = 'left'
                WHERE organization_id = ? AND user_id = ?""",
            (organization_id, user_id),
        )
        connection.commit()

        with pytest.raises(DocumentJobAuthorizationError):
            read_document_export_result(
                database, job_id, organization_id, user_id
            )
    finally:
        connection.rollback()
        if job_id:
            connection.execute("DELETE FROM document_jobs WHERE id = ?", (job_id,))
            shutil.rmtree(_document_job_dir(job_id), ignore_errors=True)
        if organization_id:
            _cleanup_export_job_scope(connection, organization_id)
        connection.close()
        database.close()


def test_retry_reauthorizes_and_only_one_concurrent_request_wins(
    tmp_path, monkeypatch,
):
    database_url = str(os.environ.get("TEST_DATABASE_URL") or "").strip()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is required for document job integration")
    monkeypatch.setenv("DOCUMENT_WORKER_TEMP_DIR", str(tmp_path))
    database = PostgresDatabase(database_url)
    connection = database.get_connection()
    job_id = None
    organization_id = None
    try:
        (
            organization_id,
            user_id,
            package_id,
            policy,
            fingerprint,
        ) = _seed_export_job_scope(connection)
        job_id = enqueue_document_export(
            "export_excel",
            {"function": "create_phanlo_excel", "args": [[]]},
            organization_id=organization_id,
            user_id=user_id,
            package_id=package_id,
            filename="export.xlsx",
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            policy=policy,
            policy_hash=fingerprint,
            database=database,
        )
        connection.execute(
            "UPDATE document_jobs SET status = 'failed' WHERE id = ?",
            (job_id,),
        )
        connection.commit()

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            results = list(
                executor.map(
                    lambda _index: retry_failed_durable_document_job(database, job_id),
                    range(2),
                )
            )
        assert sorted(results) == [False, True]

        connection.execute(
            """UPDATE document_jobs SET status = 'failed' WHERE id = ?""",
            (job_id,),
        )
        connection.execute(
            """UPDATE thanh_vien_to_chuc
                  SET trang_thai_thanh_vien = 'left'
                WHERE organization_id = ? AND user_id = ?""",
            (organization_id, user_id),
        )
        connection.commit()
        with pytest.raises(DocumentJobAuthorizationError):
            retry_failed_durable_document_job(database, job_id)
        assert get_document_export_job(
            database, job_id, organization_id, user_id
        )["status"] == "failed"
    finally:
        connection.rollback()
        if job_id:
            connection.execute("DELETE FROM document_jobs WHERE id = ?", (job_id,))
            shutil.rmtree(_document_job_dir(job_id), ignore_errors=True)
        if organization_id:
            _cleanup_export_job_scope(connection, organization_id)
        connection.close()
        database.close()


def test_internal_isolated_async_job_runs_through_durable_queue(
    tmp_path, monkeypatch,
):
    database_url = str(os.environ.get("TEST_DATABASE_URL") or "").strip()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is required for document job integration")
    monkeypatch.setenv("DOCUMENT_WORKER_TEMP_DIR", str(tmp_path))
    monkeypatch.setenv("DOCUMENT_WORKER_EXECUTION_MODE", "embedded")
    database = PostgresDatabase(database_url)
    monkeypatch.setattr(document_worker, "_document_queue_database", lambda: database)
    try:
        result = asyncio.run(
            run_document_job_async(
                "export_excel",
                {"function": "create_phanlo_excel", "args": [[]]},
            )
        )
        assert bytes(result).startswith(b"PK")
    finally:
        database.close()
