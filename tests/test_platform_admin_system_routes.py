import sqlite3

from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from backend.admin import operational, platform_system_routes
from backend.auth.auth_helper import SessionRole


JOB_PENDING = "a" * 32
JOB_FAILED = "b" * 32


class _Connection:
    def __init__(self, connection): self.connection = connection
    def cursor(self): return self.connection.cursor()
    def close(self): pass
    def __getattr__(self, name): return getattr(self.connection, name)


class _Database:
    def __init__(self, connection): self.connection = connection
    def get_connection(self): return _Connection(self.connection)


def _database():
    db = sqlite3.connect(":memory:", check_same_thread=False)
    db.row_factory = sqlite3.Row
    db.executescript("""
        CREATE TABLE document_jobs (
          id TEXT, organization_id TEXT, operation TEXT, record_type TEXT,
          status TEXT, attempt_count INTEGER, available_at INTEGER, created_at INTEGER,
          updated_at INTEGER, completed_at INTEGER, cancelled_at INTEGER, expires_at INTEGER,
          progress_phase TEXT, progress_completed_items INTEGER,
          progress_total_items INTEGER, last_error_code TEXT,
          filename TEXT, locked_by TEXT, last_error_message TEXT, policy_json TEXT,
          user_id TEXT, package_id TEXT, record_id TEXT, policy_hash TEXT
        );
        CREATE TABLE websocket_events (
          id INTEGER, organization_id TEXT, user_id TEXT, event_type TEXT, status TEXT,
          attempt_count INTEGER, available_at INTEGER, created_at TEXT,
          dispatched_at INTEGER, delivered_at INTEGER, last_error_code TEXT, payload_json TEXT
        );
        CREATE TABLE websocket_connection_leases (
          id TEXT, user_id TEXT, organization_id TEXT, worker_id TEXT,
          client_ip_hash TEXT, expires_at INTEGER
        );
        CREATE TABLE sync_mutations (
          organization_id TEXT, actor_user_id TEXT, client_mutation_id TEXT,
          request_hash TEXT, response_json TEXT, created_at TEXT
        );
    """)
    db.executemany(
        "INSERT INTO document_jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
          (JOB_PENDING, "org-a", "render", "goi_thau", "pending", 0, 20, 10, 10, None, None, 1000, "queued", 0, 1, None, "private.docx", "C:/secret/worker", None, '{"secret":"x"}', "user-a", "package-a", "record-a", "hash-a"),
          (JOB_FAILED, "org-b", "render", "ke_hoach_lcnt", "failed", 2, 30, 20, 30, None, None, 1000, "failed", 0, 1, "RENDER_FAILED", "other.docx", "worker-2", "Failed at C:/secret/worker/input.docx password=hunter2", '{}', "user-b", None, "record-b", "hash-b"),
        ),
    )
    db.executemany(
        "INSERT INTO websocket_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
          (1, "org-a", "user-a", "broadcast", "pending", 0, 10, "2026-01-01", None, None, None, '{"private":1}'),
          (2, "org-b", "user-b", "revoke_user", "dispatched", 1, 20, "2026-01-02", 21, 22, None, '{"private":2}'),
        ),
    )
    db.execute("INSERT INTO websocket_connection_leases VALUES ('lease', 'user-a', 'org-a', 'secret-worker', 'hash', 4102444800)")
    db.execute("INSERT INTO sync_mutations VALUES ('org-a', 'user-a', 'client-1', 'hash', '{""private"":1}', '2026-01-01')")
    db.commit()
    return db


def _client(monkeypatch, db, allowed=True):
    role = SessionRole("super_admin", "admin", platform_role="super_admin")
    calls = []
    async def run_database_read(function, *args, **kwargs):
        kwargs.pop("timeout_seconds", None)
        return function(*args, **kwargs)
    def verify(_request, required_role=None):
        calls.append(required_role)
        return (True, role) if allowed else (False, "denied")
    monkeypatch.setattr(operational, "verify_session", verify)
    monkeypatch.setattr(operational, "run_database_read", run_database_read)
    monkeypatch.setattr(platform_system_routes, "run_database_read", run_database_read)
    monkeypatch.setattr(platform_system_routes, "database", _Database(db))
    return TestClient(Starlette(routes=platform_system_routes.platform_admin_system_routes(Route))), calls


def test_jobs_are_aggregated_paginated_and_sanitized(monkeypatch):
    db = _database()
    try:
        client, calls = _client(monkeypatch, db)
        with client:
            response = client.get("/api/admin/system/jobs?status=failed&sortBy=attempt_count")
        assert response.status_code == 200
        assert response.headers["cache-control"] == "private, no-store"
        assert calls == ["super_admin"]
        payload = response.json()
        assert payload["summary"] == {"total": 2, "byStatus": {"failed": 1, "pending": 1}}
        assert payload["pagination"]["totalRows"] == 1
        assert payload["items"][0]["lastErrorCode"] == "RENDER_FAILED"
        serialized = response.text
        for private in ("private.docx", "C:/secret/worker", "private path", "policy_json"):
            assert private not in serialized
    finally: db.close()


def test_sync_uses_real_event_lease_and_mutation_aggregates_without_payloads(monkeypatch):
    db = _database()
    try:
        client, _calls = _client(monkeypatch, db)
        with client:
            response = client.get("/api/admin/system/sync?eventType=broadcast")
        assert response.status_code == 200
        payload = response.json()
        assert payload["summary"] == {
          "eventsTotal": 2,
          "eventsByStatus": {"dispatched": 1, "pending": 1},
          "activeConnections": 1,
          "recordedMutations": 1,
          "rowVersionConflicts": None,
          "visibilityResets": None,
          "fullSyncs": None,
          "outboxFailures": None,
        }
        assert payload["pagination"]["totalRows"] == 1
        assert payload["items"][0]["eventType"] == "broadcast"
        assert "private" not in response.text
        assert "secret-worker" not in response.text
        assert "user-a" not in response.text
    finally: db.close()


def test_job_detail_is_bounded_and_sanitizes_worker_error(monkeypatch):
    db = _database()
    try:
        client, calls = _client(monkeypatch, db)
        with client:
            response = client.get(f"/api/admin/system/jobs/{JOB_FAILED}")
        assert response.status_code == 200
        assert response.headers["cache-control"] == "private, no-store"
        assert calls == ["super_admin"]
        job = response.json()["job"]
        assert job["id"] == JOB_FAILED
        assert job["retryAllowed"] is True
        assert job["error"]["code"] == "RENDER_FAILED"
        assert "[REDACTED_PATH]" in job["error"]["message"]
        for private in (
            "hunter2", "input.docx", "other.docx", "worker-2", "policy_json"
        ):
            assert private not in response.text
        with client:
            assert client.get("/api/admin/system/jobs/not-a-job").status_code == 400
    finally:
        db.close()


def test_job_retry_rechecks_admin_policy_and_audits(monkeypatch):
    db = _database()
    audit = []
    worker_calls = []
    role = SessionRole("super_admin", "admin", platform_role="super_admin")
    try:
        client, calls = _client(monkeypatch, db)
        monkeypatch.setattr(
            platform_system_routes,
            "verify_session_in_transaction",
            lambda _cursor, _request, required_role=None: (True, role),
        )
        monkeypatch.setattr(
            platform_system_routes,
            "log_audit",
            lambda action, **kwargs: audit.append((action, kwargs)),
        )
        def retry_job(target_database, job_id, *, authorize_retry, audit_retry):
            worker_calls.append(job_id)
            connection = target_database.get_connection()
            cursor = connection.cursor()
            actor = authorize_retry(cursor)
            job = dict(cursor.execute(
                """SELECT id, organization_id, operation, record_type,
                          last_error_code FROM document_jobs WHERE id = ?""",
                (job_id,),
            ).fetchone())
            audit_retry(cursor, job, actor)
            return True
        monkeypatch.setattr(
            platform_system_routes,
            "retry_failed_durable_document_job",
            retry_job,
        )
        async def run_database_write(function, *args, **kwargs):
            kwargs.pop("timeout_seconds", None)
            return function(*args, **kwargs)
        monkeypatch.setattr(platform_system_routes, "run_database_write", run_database_write)

        with client:
            response = client.post(f"/api/admin/system/jobs/{JOB_FAILED}/retry", json={})
        assert response.status_code == 202
        assert response.json() == {"jobId": JOB_FAILED, "status": "retry"}
        assert calls == ["super_admin"]
        assert worker_calls == [JOB_FAILED]
        assert audit[0][0] == "admin.document_job_retried"
        assert audit[0][1]["target_id"] == JOB_FAILED
        assert audit[0][1]["required"] is True
        assert audit[0][1]["cursor"] is not None
    finally:
        db.close()


def test_system_routes_require_super_admin_and_reject_unbounded_queries(monkeypatch):
    db = _database()
    try:
        denied, calls = _client(monkeypatch, db, allowed=False)
        with denied:
            assert denied.get("/api/admin/system/jobs").status_code == 403
            assert denied.get("/api/admin/system/sync").status_code == 403
            assert denied.get(f"/api/admin/system/jobs/{JOB_FAILED}").status_code == 403
            assert denied.post(f"/api/admin/system/jobs/{JOB_FAILED}/retry", json={}).status_code == 403
        assert calls == ["super_admin", "super_admin", "super_admin", "super_admin"]
        allowed, _calls = _client(monkeypatch, db)
        with allowed:
            assert allowed.get("/api/admin/system/jobs?pageSize=500").status_code == 400
            assert allowed.get("/api/admin/system/sync?sortBy=payload_json").status_code == 400
    finally: db.close()
