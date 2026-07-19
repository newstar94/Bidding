from __future__ import annotations

from contextlib import contextmanager
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from uuid import uuid4

import httpx
import psycopg
import pytest

from backend.auth.auth_helper import hash_password
from scripts.process_utils import popen_group_options, terminate_process_tree


ROOT = Path(__file__).resolve().parents[1]
API_PORT = 18080
BASE_URL = f"http://127.0.0.1:{API_PORT}"
API_ADMIN_PASSWORD = "API admin password 2026!"


def _wait_for_server(process: subprocess.Popen[bytes]) -> None:
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"API test server exited with {process.returncode}")
        try:
            response = httpx.get(f"{BASE_URL}/health/ready", timeout=1)
            if response.status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.1)
    raise RuntimeError("API test server did not become ready")


@pytest.fixture(scope="module")
def api_database_url() -> str:
    database_url = os.environ.get("API_TEST_DATABASE_URL", "").strip()
    if not database_url:
        pytest.skip("API_TEST_DATABASE_URL is not configured")
    with psycopg.connect(database_url, autocommit=True) as connection:
        connection.execute("DROP SCHEMA IF EXISTS public CASCADE")
        connection.execute("CREATE SCHEMA public")
    return database_url


@pytest.fixture(scope="module")
def api_server(api_database_url: str):
    environment = os.environ.copy()
    environment.update(
        {
            "DATABASE_URL": api_database_url,
            "APP_ENV": "test",
            "APP_DEBUG": "False",
            "APP_SECURE_COOKIES": "False",
            "ENABLE_IMAGE_CACHE_PREWARM": "false",
            "ENABLE_PARTNER_LOOKUP_WORKER": "false",
            "BACKGROUND_STARTUP_DELAY_SECONDS": "0",
            "AUDIT_CHECKPOINT_DIR": "",
            "ADMIN_PASSWORD": API_ADMIN_PASSWORD,
        }
    )
    with tempfile.TemporaryFile(mode="w+b") as server_log:
        process = subprocess.Popen(
            [
                sys.executable,
                str(ROOT / "tests" / "support" / "uvicorn_test_server.py"),
                "backend.app:app",
                "--host",
                "127.0.0.1",
                "--port",
                str(API_PORT),
                "--no-access-log",
            ],
            cwd=ROOT,
            env=environment,
            stdout=server_log,
            stderr=subprocess.STDOUT,
            **popen_group_options(),
        )
        try:
            try:
                _wait_for_server(process)
            except RuntimeError as error:
                server_log.seek(0)
                diagnostic = server_log.read().decode("utf-8", errors="replace")
                raise RuntimeError(f"{error}\n{diagnostic}") from error
            yield
        finally:
            terminate_process_tree(process, timeout=15)


@contextmanager
def _client():
    with httpx.Client(base_url=BASE_URL, timeout=30) as client:
        response = client.get("/")
        assert response.status_code == 200
        assert client.cookies.get("csrf_token")
        yield client


def _headers(client: httpx.Client, organization_id: str | None = None) -> dict[str, str]:
    headers = {"X-CSRF-Token": client.cookies["csrf_token"]}
    if organization_id:
        headers["X-Active-Org"] = organization_id
    return headers


def _login(client: httpx.Client, username: str, password: str, active_org: str | None = None):
    response = client.post(
        "/api/auth/login",
        json={"username": username, "password": password, "remember": False},
        headers=_headers(client, active_org),
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    return payload


def test_health_and_authentication_contract(api_server) -> None:
    assert httpx.get(f"{BASE_URL}/health/live").status_code == 200
    assert httpx.get(f"{BASE_URL}/health/ready").json() == {"status": "ready"}
    invalid_host = httpx.get(
        f"{BASE_URL}/",
        headers={"Host": "attacker.example"},
        timeout=10,
    )
    assert invalid_host.status_code == 400
    with _client() as client:
        assert client.get("/api/get-all-data").status_code == 403
        lookup_without_session = client.get(
            "/api/lookup-tax-code?code=0100109106"
        )
        assert lookup_without_session.status_code == 401
        assert lookup_without_session.json()["code"] == "AUTHENTICATION_REQUIRED"
        login = _login(
            client,
            os.environ.get("ADMIN_USERNAME", "admin"),
            API_ADMIN_PASSWORD,
        )
        assert login["platform_role"] == "super_admin"
        assert login["active_org_id"]
        assert all(
            not str(item.get("id", "")).startswith("personal:")
            for item in login["organizations"]
        )
        invalid_lookup_responses = [
            client.get(
                "/api/lookup-tax-code?code=0100109106&role=INVALID",
                headers=_headers(client, login["active_org_id"]),
            )
            for _ in range(8)
        ]
        assert all(response.status_code == 400 for response in invalid_lookup_responses)
        user_limited_lookup = client.get(
            "/api/lookup-tax-code?code=0100109106&role=INVALID",
            headers=_headers(client, login["active_org_id"]),
        )
        assert user_limited_lookup.status_code == 429
        initial_data = client.get(
            "/api/get-all-data?include_summary=1",
            headers=_headers(client, login["active_org_id"]),
        )
        assert initial_data.status_code == 200, initial_data.text
        assert isinstance(initial_data.json().get("dashboardSummary"), dict)
        assert client.post(
            "/api/auth/check-session", headers=_headers(client)
        ).json()["valid"] is True


def test_personal_and_organization_membership_lifecycle(
    api_server, api_database_url: str
) -> None:
    user_id = "user-" + uuid4().hex
    username = "member_" + uuid4().hex[:10]
    password = "Member-Test-Password-2026!"
    email = f"{username}@example.test"
    with psycopg.connect(api_database_url) as connection:
        connection.execute(
            """INSERT INTO tai_khoan
               (id, ten_dang_nhap, username_norm, mat_khau, ho_ten,
                vai_tro, email, email_norm, da_xac_minh)
               VALUES (%s, %s, %s, %s, %s, 'user', %s, %s, 1)""",
            (user_id, username, username, hash_password(password), "API Member", email, email),
        )

    personal_scope = f"personal:{user_id}"
    with _client() as user_client:
        personal_login = _login(user_client, username, password)
        assert personal_login["active_org_id"] == personal_scope
        assert personal_login["package_id"] is None
        record_id = "cdt-" + uuid4().hex
        create_response = user_client.post(
            "/api/sync",
            json={
                "clientMutationId": uuid4().hex,
                "chudautu": [
                    {
                        "id": record_id,
                        "tenChuDauTu": "Personal API test",
                        "ngayApDung": "2026-07-19",
                    }
                ],
            },
            headers=_headers(user_client, personal_scope),
        )
        assert create_response.status_code == 200, create_response.text
        assert create_response.json()["status"] == "success"
        export_response = user_client.get(
            "/api/export-report/nonexistent",
            headers=_headers(user_client, personal_scope),
        )
        assert export_response.status_code == 403

        with _client() as admin_client:
            admin = _login(
                admin_client,
                os.environ.get("ADMIN_USERNAME", "admin"),
                API_ADMIN_PASSWORD,
            )
            organization_id = admin["active_org_id"]
            cross_tenant_read = admin_client.get(
                "/api/record",
                params={"table": "chudautu", "id": record_id},
                headers=_headers(admin_client, organization_id),
            )
            assert cross_tenant_read.status_code == 404
            cross_tenant_page = admin_client.get(
                "/api/paginate",
                params={"table": "chudautu", "page": 1, "pageSize": 200},
                headers=_headers(admin_client, organization_id),
            )
            assert cross_tenant_page.status_code == 200, cross_tenant_page.text
            assert record_id not in {
                str(item.get("id") or "")
                for item in cross_tenant_page.json().get("items", [])
            }
            collision_create = admin_client.post(
                "/api/sync",
                json={
                    "clientMutationId": uuid4().hex,
                    "chudautu": [
                        {
                            "id": record_id,
                            "tenChuDauTu": "Organization-scoped collision",
                            "ngayApDung": "2026-07-19",
                        }
                    ],
                },
                headers=_headers(admin_client, organization_id),
            )
            assert collision_create.status_code == 200, collision_create.text
            personal_record_after_collision = user_client.get(
                "/api/record",
                params={"table": "chudautu", "id": record_id},
                headers=_headers(user_client, personal_scope),
            )
            assert personal_record_after_collision.status_code == 200
            assert (
                personal_record_after_collision.json()["item"]["tenChuDauTu"]
                == "Personal API test"
            )
            add_response = admin_client.post(
                "/api/auth/users/add-to-org",
                json={
                    "user_id": user_id,
                    "employee_name": "API Member",
                    "phone": "0900000000",
                },
                headers=_headers(admin_client, organization_id),
            )
            assert add_response.status_code == 200, add_response.text

            organization_session = user_client.post(
                "/api/auth/check-session",
                headers=_headers(user_client, organization_id),
            ).json()["user"]
            assert organization_session["active_org_id"] == organization_id
            assert organization_session["package_id"] == "diamond"
            personal_session = user_client.post(
                "/api/auth/check-session",
                headers=_headers(user_client, personal_scope),
            ).json()["user"]
            assert personal_session["active_org_id"] == personal_scope
            assert personal_session["package_id"] is None

            remove_response = admin_client.post(
                "/api/auth/users/remove-from-org",
                json={"user_id": user_id},
                headers=_headers(admin_client, organization_id),
            )
            assert remove_response.status_code == 200, remove_response.text
            former = admin_client.get(
                "/api/organizations/former-members",
                headers=_headers(admin_client, organization_id),
            )
            assert former.status_code == 200
            assert any(row.get("id") == user_id for row in former.json())

        fallback = user_client.post(
            "/api/auth/check-session",
            headers=_headers(user_client, organization_id),
        ).json()["user"]
        assert fallback["active_org_id"] == personal_scope
        assert [item["id"] for item in fallback["organizations"]] == [personal_scope]

    with psycopg.connect(api_database_url) as connection:
        assert connection.execute(
            "SELECT 1 FROM to_chuc WHERE id = %s", (personal_scope,)
        ).fetchone() is None
        membership = connection.execute(
            """SELECT trang_thai_thanh_vien FROM thanh_vien_to_chuc
               WHERE user_id = %s""",
            (user_id,),
        ).fetchone()
        assert membership[0] == "left"
        tenant_rows = connection.execute(
            """SELECT organization_id, ten_chu_dau_tu
               FROM chu_dau_tu
               WHERE id = %s
               ORDER BY organization_id""",
            (record_id,),
        ).fetchall()
        assert sorted(row[1] for row in tenant_rows) == [
            "Organization-scoped collision",
            "Personal API test",
        ]


def test_csrf_and_payload_limits_fail_closed(api_server) -> None:
    with _client() as client:
        login = _login(
            client,
            os.environ.get("ADMIN_USERNAME", "admin"),
            API_ADMIN_PASSWORD,
        )
        missing_csrf = client.post(
            "/api/sync", json={"clientMutationId": uuid4().hex}
        )
        assert missing_csrf.status_code == 403
        malformed = client.post(
            "/api/auth/login",
            content=b"{not-json",
            headers={**_headers(client), "Content-Type": "application/json"},
        )
        assert malformed.status_code == 400
