import json
import os
import shutil

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
)
from backend.db.db_helper import PostgresDatabase


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
    job_id = enqueue_document_export(
        "export_excel",
        {"function": "create_phanlo_excel", "args": [[]]},
        organization_id="org-a",
        user_id="user-a",
        package_id="package-a",
        filename="export.xlsx",
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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
    with pytest.raises(RuntimeError, match="audit unavailable"):
        enqueue_document_export(
            "export_excel",
            {"function": "create_phanlo_excel", "args": [[]]},
            organization_id="org-a",
            user_id="user-a",
            package_id="package-a",
            filename="export.xlsx",
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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
    try:
        job_id = enqueue_document_export(
            "export_excel",
            {"function": "create_phanlo_excel", "args": [[]]},
            organization_id="org-export-test",
            user_id="user-export-test",
            package_id="package-export-test",
            filename="export.xlsx",
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            database=database,
        )
        job_ids.append(job_id)

        assert process_next_durable_document_job(database)
        job, result = read_document_export_result(
            database,
            job_id,
            "org-export-test",
            "user-export-test",
        )

        assert job["status"] == "completed"
        assert bytes(result).startswith(b"PK")
        assert get_document_export_job(
            database, job_id, "org-export-test", "another-user"
        ) is None
    finally:
        connection = database.get_connection()
        try:
            for job_id in job_ids:
                connection.execute("DELETE FROM document_jobs WHERE id = ?", (job_id,))
            connection.commit()
        finally:
            connection.close()
        for job_id in job_ids:
            shutil.rmtree(_document_job_dir(job_id), ignore_errors=True)
        database.close()
