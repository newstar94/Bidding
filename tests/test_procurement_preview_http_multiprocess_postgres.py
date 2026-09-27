"""Exercise opening prepare/apply over HTTP in separate operating-system workers."""

import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from uuid import uuid4

import httpx
import psycopg
import pytest


ROOT = Path(__file__).resolve().parents[1]
WORKER = r'''
import os
import sys
from types import SimpleNamespace
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.responses import JSONResponse
from backend.db.db_helper import PostgresDatabase
import backend.procurement_import.routes as routes
from backend.procurement_import.routes import procurement_import_routes

class Cursor:
    def __init__(self, inner):
        self.inner = inner
        self.fake = None

    def execute(self, sql, parameters=()):
        if "FROM goi_thau" in sql:
            self.fake = ("package-1", "package-1", 3, "IB2600000002", "Gói kiểm thử") if "SELECT id" in sql else (3,)
        elif "FROM procurement_source_binding" in sql:
            self.fake = None
        else:
            self.fake = ...
            self.inner.execute(sql, parameters)
        return self

    def fetchone(self):
        return self.inner.fetchone() if self.fake is ... else self.fake

    def __getattr__(self, name):
        return getattr(self.inner, name)

class Connection:
    def __init__(self, inner):
        self.inner = inner

    def cursor(self):
        return Cursor(self.inner.cursor())

    def __getattr__(self, name):
        return getattr(self.inner, name)

class Database:
    def __init__(self, url):
        self.inner = PostgresDatabase(url)

    def get_connection(self):
        return Connection(self.inner.get_connection())

class Source:
    name = "MUASAMCONG"

    def list_notice_revisions(self, notice_no):
        assert notice_no == "IB2600000002"
        return [{"revisionId": "notice-01", "revisionNumber": "01"}]

    def get_opening_bundle(self, notice_no, revision_id):
        assert (notice_no, revision_id) == ("IB2600000002", "notice-01")
        return {"schemaVersion": "biddingflow-opening-bundle-v1", "bidders": [{"contractorName": "Nhà thầu A", "bidPrice": 100}], "lots": [], "partial": False}

routes.database = Database(os.environ["TEST_DATABASE_URL"])
routes._request_context = lambda request, lease: (
    SimpleNamespace(user_id=request.headers.get("x-test-user", "user-1")),
    request.headers.get("x-test-org", os.environ["TEST_ORG"]),
    lease,
)
routes._enforce_rate_limit = lambda *_args: None
routes.has_module_permission = lambda *_args: True
routes.build_procurement_source = Source
routes._load_opening_from_raw_snapshot = lambda *_args, **_kwargs: None

import uvicorn
uvicorn.run(Starlette(routes=[Route("/__test_health", lambda _request: JSONResponse({"ok": True}))] + procurement_import_routes(Route)), host="127.0.0.1", port=int(sys.argv[1]), log_level="critical", access_log=False)
'''


def _free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def _post(port, path, payload, *, user="user-1", organization=None):
    headers = {"Content-Type": "application/json", "X-Test-User": user}
    if organization:
        headers["X-Test-Org"] = organization
    for attempt in range(5):
        try:
            response = httpx.post(
                f"http://127.0.0.1:{port}{path}", json=payload,
                headers=headers, timeout=10, trust_env=False,
            )
            return response.status_code, response.json()
        except httpx.TransportError:
            if attempt == 4:
                raise
            time.sleep(.05)


def test_opening_preview_prepare_and_apply_cross_http_workers():
    url = str(os.environ.get("TEST_DATABASE_URL") or "").strip()
    if not url:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL worker test")
    organization = f"preview-http-{uuid4().hex}"
    environment = {**os.environ, "DATABASE_URL": url, "TEST_DATABASE_URL": url, "TEST_ORG": organization}
    ports = [_free_port(), _free_port()]
    workers = []
    def start_worker(port):
        worker = subprocess.Popen(
            [sys.executable, "-u", "-c", WORKER, str(port)], cwd=ROOT,
            env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        )
        workers.append(worker)
        for _ in range(100):
            if worker.poll() is not None:
                raise AssertionError(worker.stderr.read().decode("utf-8", errors="replace"))
            try:
                response = httpx.get(f"http://127.0.0.1:{port}/__test_health", timeout=.2, trust_env=False)
                if response.status_code == 200:
                    return
            except httpx.TransportError:
                time.sleep(.05)
        raise AssertionError("HTTP worker did not start")

    try:
        for port in ports:
            start_worker(port)

        status, prepared = _post(ports[0], "/api/procurement/imports/opening/prepare", {
            "packageId": "package-1", "workspaceLease": "lease-1",
        })
        assert status == 200, prepared
        payload = {
            "previewId": prepared["previewId"],
            "expectedPackageRowVersion": 3,
            "workspaceLease": "lease-1",
        }
        status, applied = _post(ports[1], "/api/procurement/imports/opening/apply", payload)
        assert status == 200, applied
        assert applied["opening"]["bidders"][0]["contractorName"] == "Nhà thầu A"
        assert _post(ports[1], "/api/procurement/imports/opening/apply", payload) == (status, applied)

        recycled = workers.pop()
        recycled.terminate()
        recycled.communicate(timeout=5)
        ports[1] = _free_port()
        start_worker(ports[1])
        assert _post(ports[1], "/api/procurement/imports/opening/apply", payload) == (status, applied)

        wrong_user, _ = _post(ports[1], "/api/procurement/imports/opening/apply", payload, user="other-user")
        wrong_org, _ = _post(ports[1], "/api/procurement/imports/opening/apply", payload, organization="other-org")
        wrong_lease, _ = _post(ports[1], "/api/procurement/imports/opening/apply", {**payload, "workspaceLease": "other-lease"})
        assert wrong_user == wrong_lease == 403
        assert wrong_org in {403, 404, 410}

        with psycopg.connect(url, connect_timeout=5) as connection:
            connection.execute(
                """UPDATE procurement_import_session
                      SET preview_expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second'
                    WHERE organization_id = %s AND preview_id = %s""",
                (organization, prepared["previewId"]),
            )
        expired, _ = _post(ports[1], "/api/procurement/imports/opening/apply", payload)
        assert expired == 410
    finally:
        for worker in workers:
            worker.terminate()
            try:
                _stdout, errors = worker.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                worker.kill()
                _stdout, errors = worker.communicate(timeout=5)
        with psycopg.connect(url, connect_timeout=5) as connection:
            connection.execute(
                "DELETE FROM procurement_import_session WHERE organization_id = %s",
                (organization,),
            )
