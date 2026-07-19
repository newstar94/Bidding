from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys
import time

import httpx
import psycopg
import pytest

from backend.db.db_helper import PostgresDatabase
from backend.startup import verify_database_runtime_role
from scripts.process_utils import popen_group_options, terminate_process_tree


ROOT = Path(__file__).resolve().parents[1]
PORT = 18084
BASE_URL = f"http://127.0.0.1:{PORT}"


def _wait_ready(process: subprocess.Popen[bytes]) -> None:
    deadline = time.monotonic() + 35
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"runtime-role server exited with {process.returncode}")
        try:
            if httpx.get(f"{BASE_URL}/health/ready", timeout=1).status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.1)
    raise RuntimeError("runtime-role server did not become ready")


def test_runtime_role_starts_without_ddl_and_serves_authenticated_reads() -> None:
    database_url = os.environ.get("RUNTIME_DATABASE_URL", "").strip()
    if not database_url:
        pytest.skip("RUNTIME_DATABASE_URL is not configured")
    runtime_database = PostgresDatabase(database_url)
    try:
        verify_database_runtime_role(
            runtime_database,
            expected_role=os.environ.get(
                "DATABASE_RUNTIME_ROLE", "biddingflow_app"
            ),
        )
    finally:
        runtime_database.close()
    with psycopg.connect(database_url, autocommit=True) as connection:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute("CREATE TABLE runtime_role_escape_probe(id integer)")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute("CREATE TEMP TABLE runtime_temp_escape_probe(id integer)")
    environment = os.environ.copy()
    environment.update(
        {
            "DATABASE_URL": database_url,
            "DATABASE_AUTO_MIGRATE": "false",
            "APP_ENV": "test",
            "APP_DEBUG": "False",
            "APP_SECURE_COOKIES": "False",
            "ENABLE_IMAGE_CACHE_PREWARM": "false",
            "ENABLE_PARTNER_LOOKUP_WORKER": "false",
            "BACKGROUND_STARTUP_DELAY_SECONDS": "0",
            "AUDIT_CHECKPOINT_DIR": "",
        }
    )
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "backend.app:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(PORT),
            "--no-access-log",
        ],
        cwd=ROOT,
        env=environment,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        **popen_group_options(),
    )
    try:
        _wait_ready(process)
        with httpx.Client(base_url=BASE_URL, timeout=20) as client:
            assert client.get("/").status_code == 200
            response = client.post(
                "/api/auth/login",
                json={
                    "username": os.environ.get("ADMIN_USERNAME", "admin"),
                    "password": os.environ["ADMIN_PASSWORD"],
                    "remember": False,
                },
                headers={"X-CSRF-Token": client.cookies["csrf_token"]},
            )
            assert response.status_code == 200, response.text
            organization_id = response.json()["active_org_id"]
            data = client.get(
                "/api/get-all-data?include_summary=1",
                headers={"X-Active-Org": organization_id},
            )
            assert data.status_code == 200, data.text
            assert isinstance(data.json().get("dashboardSummary"), dict)
    finally:
        terminate_process_tree(process, timeout=15)


def test_runtime_startup_fails_closed_when_schema_is_missing() -> None:
    database_url = os.environ.get("RESTORE_DRILL_DATABASE_URL", "").strip()
    if not database_url:
        pytest.skip("RESTORE_DRILL_DATABASE_URL is not configured")
    with psycopg.connect(database_url, autocommit=True) as connection:
        connection.execute("DROP SCHEMA IF EXISTS public CASCADE")
        connection.execute("CREATE SCHEMA public")

    environment = os.environ.copy()
    environment.update(
        {
            "DATABASE_URL": database_url,
            "DATABASE_AUTO_MIGRATE": "false",
            "APP_ENV": "test",
            "APP_DEBUG": "False",
            "APP_SECURE_COOKIES": "False",
            "ENABLE_IMAGE_CACHE_PREWARM": "false",
            "ENABLE_PARTNER_LOOKUP_WORKER": "false",
            "BACKGROUND_STARTUP_DELAY_SECONDS": "0",
            "AUDIT_CHECKPOINT_DIR": "",
        }
    )
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "backend.app:app",
            "--host",
            "127.0.0.1",
            "--port",
            "18085",
            "--no-access-log",
        ],
        cwd=ROOT,
        env=environment,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        **popen_group_options(),
    )
    try:
        assert process.wait(timeout=20) != 0
    finally:
        terminate_process_tree(process, timeout=5)
