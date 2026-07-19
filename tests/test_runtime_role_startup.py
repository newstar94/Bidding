from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys
import time

import httpx
import psycopg
import pytest

from backend.auth.auth_helper import hash_password
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
    admin_database_url = os.environ.get("DATABASE_ADMIN_URL", "").strip()
    if not database_url:
        pytest.skip("RUNTIME_DATABASE_URL is not configured")
    if not admin_database_url:
        pytest.skip("DATABASE_ADMIN_URL is not configured")
    runtime_test_password = "Runtime role test password 2026!"
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
    with psycopg.connect(admin_database_url, autocommit=True) as connection:
        original_password_row = connection.execute(
            "SELECT mat_khau FROM tai_khoan WHERE ten_dang_nhap = %s",
            (os.environ.get("ADMIN_USERNAME", "admin"),),
        ).fetchone()
        assert original_password_row is not None
        original_password_hash = original_password_row[0]
        connection.execute(
            "UPDATE tai_khoan SET mat_khau = %s WHERE ten_dang_nhap = %s",
            (
                hash_password(runtime_test_password),
                os.environ.get("ADMIN_USERNAME", "admin"),
            ),
        )
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
            "ADMIN_PASSWORD": runtime_test_password,
        }
    )
    process = None
    try:
        process = subprocess.Popen(
            [
                sys.executable,
                str(ROOT / "tests" / "support" / "uvicorn_test_server.py"),
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
        _wait_ready(process)
        with httpx.Client(base_url=BASE_URL, timeout=20) as client:
            assert client.get("/").status_code == 200
            response = client.post(
                "/api/auth/login",
                json={
                    "username": os.environ.get("ADMIN_USERNAME", "admin"),
                    "password": runtime_test_password,
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
        if process is not None:
            terminate_process_tree(process, timeout=15)
        with psycopg.connect(admin_database_url, autocommit=True) as connection:
            connection.execute(
                "UPDATE tai_khoan SET mat_khau = %s WHERE ten_dang_nhap = %s",
                (
                    original_password_hash,
                    os.environ.get("ADMIN_USERNAME", "admin"),
                ),
            )


def test_backup_role_is_read_only_and_cannot_create_objects() -> None:
    database_url = os.environ.get("BACKUP_DATABASE_URL", "").strip()
    if not database_url:
        pytest.skip("BACKUP_DATABASE_URL is not configured")

    with psycopg.connect(database_url, autocommit=True) as connection:
        assert connection.execute(
            "SELECT count(*) FROM database_metadata"
        ).fetchone()[0] >= 1
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute(
                "UPDATE database_metadata SET updated_at = updated_at WHERE false"
            )
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute("CREATE TABLE backup_role_escape_probe(id integer)")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute(
                "CREATE TEMP TABLE backup_temp_escape_probe(id integer)"
            )


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
            str(ROOT / "tests" / "support" / "uvicorn_test_server.py"),
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
