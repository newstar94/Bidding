from __future__ import annotations

import asyncio
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

from scripts.process_utils import popen_group_options, terminate_process_tree


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
            "ALLOWED_WS_ORIGINS": ",".join(
                f"http://127.0.0.1:{port}" for port in PORTS
            ),
        }
    )
    processes = [
        subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "backend.app:app",
                "--host",
                "127.0.0.1",
                "--port",
                str(port),
                "--workers",
                "2",
                "--no-access-log",
            ],
            cwd=ROOT,
            env=environment,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            **popen_group_options(),
        )
        for port in PORTS
    ]
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
