from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import subprocess
import sys
import time
from uuid import uuid4

import httpx
import psycopg
import pytest
import websockets

from backend.auth.auth_helper import hash_password
from scripts.process_utils import (
    coverage_python_prefix,
    popen_group_options,
    terminate_process_tree,
)


ROOT = Path(__file__).resolve().parents[1]
PORTS = (18081, 18082)


def _wait_ready(processes: list[subprocess.Popen[bytes]]) -> None:
    deadline = time.monotonic() + 40
    pending = set(PORTS)
    while pending and time.monotonic() < deadline:
        for process in processes:
            if process.poll() is not None:
                raise RuntimeError(f"worker exited with {process.returncode}")
        for port in tuple(pending):
            try:
                if httpx.get(f"http://127.0.0.1:{port}/health/ready", timeout=1).status_code == 200:
                    pending.remove(port)
            except httpx.HTTPError:
                pass
        time.sleep(0.1)
    if pending:
        raise RuntimeError(f"workers did not become ready: {sorted(pending)}")


@pytest.fixture(scope="module")
def multiworker_cluster():
    database_url = os.environ.get("MULTIWORKER_TEST_DATABASE_URL", "").strip()
    if not database_url:
        pytest.skip("MULTIWORKER_TEST_DATABASE_URL is not configured")
    with psycopg.connect(database_url, autocommit=True) as connection:
        connection.execute("DROP SCHEMA IF EXISTS public CASCADE")
        connection.execute("CREATE SCHEMA public")
    environment = os.environ.copy()
    environment.update(
        {
            "DATABASE_URL": database_url,
            "APP_ENV": "test",
            "APP_DEBUG": "False",
            "APP_SECURE_COOKIES": "False",
            "DATABASE_AUTO_MIGRATE": "true",
            "ENABLE_IMAGE_CACHE_PREWARM": "false",
            "ENABLE_PARTNER_LOOKUP_WORKER": "false",
            "BACKGROUND_STARTUP_DELAY_SECONDS": "0",
            "AUDIT_CHECKPOINT_DIR": "",
            "TRUSTED_PROXY_CIDRS": "127.0.0.1/32,::1/128",
            "ALLOWED_WS_ORIGINS": ",".join(
                f"http://127.0.0.1:{port}" for port in PORTS
            ),
        }
    )
    processes = []
    for port in PORTS:
        worker_environment = environment.copy()
        processes.append(
            subprocess.Popen(
                coverage_python_prefix(worker_environment)
                + [
                    "-m",
                    "uvicorn",
                    "backend.app:app",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(port),
                    "--workers",
                    "1",
                    "--no-access-log",
                ],
                cwd=ROOT,
                env=worker_environment,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                **popen_group_options(),
            )
        )
    try:
        _wait_ready(processes)
        yield database_url
    finally:
        for process in processes:
            terminate_process_tree(process, timeout=15)


def _authenticated_clients():
    first = httpx.Client(base_url=f"http://127.0.0.1:{PORTS[0]}", timeout=30)
    second = httpx.Client(base_url=f"http://127.0.0.1:{PORTS[1]}", timeout=30)
    first.get("/")
    response = first.post(
        "/api/auth/login",
        json={
            "username": os.environ.get("ADMIN_USERNAME", "admin"),
            "password": os.environ["ADMIN_PASSWORD"],
            "remember": False,
        },
        headers={"X-CSRF-Token": first.cookies["csrf_token"]},
    )
    assert response.status_code == 200, response.text
    session_token = first.cookies["session_token"]
    second.cookies.set("session_token", session_token, domain="127.0.0.1", path="/")
    second.get("/")
    return first, second, response.json(), session_token


def test_two_workers_share_sessions_and_database(multiworker_cluster) -> None:
    first, second, login, _token = _authenticated_clients()
    try:
        response = second.post(
            "/api/auth/check-session",
            headers={"X-CSRF-Token": second.cookies["csrf_token"]},
        )
        assert response.status_code == 200
        assert response.json()["valid"] is True
        assert response.json()["user"]["id"] == login["id"]
    finally:
        first.close()
        second.close()


def test_new_login_revokes_previous_device_across_workers(
    multiworker_cluster,
) -> None:
    first = httpx.Client(base_url=f"http://127.0.0.1:{PORTS[0]}", timeout=30)
    second = httpx.Client(base_url=f"http://127.0.0.1:{PORTS[1]}", timeout=30)
    try:
        first.get("/")
        first_login = first.post(
            "/api/auth/login",
            json={
                "username": os.environ.get("ADMIN_USERNAME", "admin"),
                "password": os.environ["ADMIN_PASSWORD"],
                "remember": False,
            },
            headers={"X-CSRF-Token": first.cookies["csrf_token"]},
        )
        assert first_login.status_code == 200, first_login.text

        second.get("/")
        second_login = second.post(
            "/api/auth/login",
            json={
                "username": os.environ.get("ADMIN_USERNAME", "admin"),
                "password": os.environ["ADMIN_PASSWORD"],
                "remember": False,
            },
            headers={"X-CSRF-Token": second.cookies["csrf_token"]},
        )
        assert second_login.status_code == 200, second_login.text

        first_check = first.post(
            "/api/auth/check-session",
            headers={"X-CSRF-Token": first.cookies["csrf_token"]},
        )
        second_check = second.post(
            "/api/auth/check-session",
            headers={"X-CSRF-Token": second.cookies["csrf_token"]},
        )
        assert first_check.status_code == 200
        assert first_check.json()["valid"] is False
        assert second_check.status_code == 200
        assert second_check.json()["valid"] is True
    finally:
        first.close()
        second.close()


def test_postgres_broker_delivers_between_workers(multiworker_cluster) -> None:
    first, second, login, session_token = _authenticated_clients()
    organization_id = login["active_org_id"]

    async def scenario() -> dict:
        async with websockets.connect(
            f"ws://127.0.0.1:{PORTS[0]}/ws/sync",
            origin=f"http://127.0.0.1:{PORTS[0]}",
            additional_headers={"Cookie": f"session_token={session_token}"},
            open_timeout=10,
        ) as websocket:
            await websocket.send(
                '{"action":"auth","organizationId":"' + organization_id + '"}'
            )
            response = await asyncio.to_thread(
                second.post,
                "/api/sync",
                json={
                    "clientMutationId": uuid4().hex,
                    "chudautu": [
                        {
                            "id": "cdt-" + uuid4().hex,
                            "tenChuDauTu": "Cross-worker broker",
                            "ngayApDung": "2026-07-19",
                        }
                    ],
                },
                headers={
                    "X-CSRF-Token": second.cookies["csrf_token"],
                    "X-Active-Org": organization_id,
                },
            )
            assert response.status_code == 200, response.text
            while True:
                message = await asyncio.wait_for(websocket.recv(), timeout=10)
                if '"type":"ping"' in message.replace(" ", ""):
                    await websocket.send('{"type":"pong"}')
                    continue
                import json

                return json.loads(message)

    try:
        event = asyncio.run(scenario())
        assert event.get("event") == "db_changed"
    finally:
        first.close()
        second.close()


def test_membership_revocation_is_immediate_across_workers(
    multiworker_cluster,
) -> None:
    database_url = multiworker_cluster
    user_id = "user-" + uuid4().hex
    username = "revoked_" + uuid4().hex[:10]
    password = "Cross-Worker-Revocation-2026!"
    email = f"{username}@example.test"
    with psycopg.connect(database_url) as connection:
        connection.execute(
            """INSERT INTO tai_khoan
               (id, ten_dang_nhap, username_norm, mat_khau, ho_ten,
                vai_tro, email, email_norm, da_xac_minh)
               VALUES (%s, %s, %s, %s, %s, 'user', %s, %s, 1)""",
            (
                user_id,
                username,
                username,
                hash_password(password),
                "Revoked Worker User",
                email,
                email,
            ),
        )

    admin = httpx.Client(base_url=f"http://127.0.0.1:{PORTS[1]}", timeout=30)
    member = httpx.Client(base_url=f"http://127.0.0.1:{PORTS[0]}", timeout=30)
    try:
        admin.get("/")
        admin_login = admin.post(
            "/api/auth/login",
            json={
                "username": os.environ.get("ADMIN_USERNAME", "admin"),
                "password": os.environ["ADMIN_PASSWORD"],
                "remember": False,
            },
            headers={"X-CSRF-Token": admin.cookies["csrf_token"]},
        )
        assert admin_login.status_code == 200, admin_login.text
        organization_id = admin_login.json()["active_org_id"]
        admin_headers = {
            "X-CSRF-Token": admin.cookies["csrf_token"],
            "X-Active-Org": organization_id,
        }
        added = admin.post(
            "/api/auth/users/add-to-org",
            json={
                "user_id": user_id,
                "employee_name": "Revoked Worker User",
                "phone": "0900000000",
            },
            headers=admin_headers,
        )
        assert added.status_code == 200, added.text

        member.get("/")
        member_login = member.post(
            "/api/auth/login",
            json={
                "username": username,
                "password": password,
                "remember": False,
            },
            headers={"X-CSRF-Token": member.cookies["csrf_token"]},
        )
        assert member_login.status_code == 200, member_login.text
        member_headers = {"X-Active-Org": organization_id}
        warmed = member.get("/api/sync-version", headers=member_headers)
        assert warmed.status_code == 200, warmed.text

        removed = admin.post(
            "/api/auth/users/remove-from-org",
            json={"user_id": user_id},
            headers=admin_headers,
        )
        assert removed.status_code == 200, removed.text

        denied = member.get("/api/sync-version", headers=member_headers)
        assert denied.status_code == 403, denied.text
    finally:
        admin.close()
        member.close()


def test_login_rate_limit_is_atomic_across_workers(multiworker_cluster) -> None:
    del multiworker_cluster

    def invalid_login(index: int) -> int:
        port = PORTS[index % len(PORTS)]
        with httpx.Client(
            base_url=f"http://127.0.0.1:{port}",
            timeout=30,
        ) as client:
            response = client.post(
                "/api/auth/login",
                json={
                    "username": "missing-rate-limited-user",
                    "password": "Invalid-Password-2026!",
                    "remember": False,
                },
            )
            return response.status_code

    with ThreadPoolExecutor(max_workers=10) as executor:
        statuses = list(executor.map(invalid_login, range(10)))

    assert statuses.count(400) == 5
    assert statuses.count(429) == 5


def test_login_rate_limit_covers_ip_and_account_distribution(
    multiworker_cluster,
) -> None:
    del multiworker_cluster

    def invalid_login(index: int, *, username: str, client_ip: str) -> int:
        port = PORTS[index % len(PORTS)]
        with httpx.Client(
            base_url=f"http://127.0.0.1:{port}",
            timeout=30,
        ) as client:
            return client.post(
                "/api/auth/login",
                json={
                    "username": username,
                    "password": "Invalid-Password-2026!",
                    "remember": False,
                },
                headers={"X-Forwarded-For": client_ip},
            ).status_code

    with ThreadPoolExecutor(max_workers=10) as executor:
        same_ip = list(
            executor.map(
                lambda index: invalid_login(
                    index,
                    username=f"missing-ip-spread-{index}",
                    client_ip="198.51.100.10",
                ),
                range(10),
            )
        )
    assert same_ip.count(400) == 5
    assert same_ip.count(429) == 5

    with ThreadPoolExecutor(max_workers=10) as executor:
        same_account = list(
            executor.map(
                lambda index: invalid_login(
                    index,
                    username="missing-account-spread",
                    client_ip=f"203.0.113.{index + 1}",
                ),
                range(10),
            )
        )
    assert same_account.count(400) == 5
    assert same_account.count(429) == 5
