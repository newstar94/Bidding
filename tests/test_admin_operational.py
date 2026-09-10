import asyncio
import json
from types import SimpleNamespace

import pytest

from backend.admin import operational


def _payload(response):
    return json.loads(response.body)


def _request(*, startup_complete=True, ready=True, lag=4.25):
    state = SimpleNamespace(
        startup_complete=startup_complete,
        ready=ready,
        event_loop_lag_ms=lag,
    )
    return SimpleNamespace(app=SimpleNamespace(state=state))


def _install_database_runner(monkeypatch, database_status=None):
    calls = []
    status = database_status or {"status": "available", "schemaVersion": 90}

    async def database_read(function, *args, **kwargs):
        calls.append((function, args, kwargs))
        if function is operational.verify_session:
            return True, SimpleNamespace(user_id="admin-1")
        if function is operational._safe_read_database_status:
            return status
        return function(*args)

    monkeypatch.setattr(operational, "run_database_read", database_read)
    return calls


@pytest.mark.parametrize(
    "endpoint",
    (
        operational.admin_health_api,
        operational.admin_environment_api,
        operational.admin_system_version_api,
    ),
)
def test_operational_endpoints_deny_non_super_admin_before_reading_data(
    monkeypatch, endpoint
):
    calls = []

    async def database_read(function, *args, **kwargs):
        calls.append(function)
        if function is operational.verify_session:
            return False, "Bạn không có quyền thực hiện thao tác này!"
        raise AssertionError("Operational data must not be read before authorization")

    monkeypatch.setattr(operational, "run_database_read", database_read)
    response = asyncio.run(endpoint(_request()))

    assert response.status_code == 403
    assert _payload(response)["code"] == "SUPER_ADMIN_REQUIRED"
    assert response.headers["cache-control"] == "private, no-store"
    assert calls == [operational.verify_session]


def test_environment_payload_exposes_only_allowlisted_values_and_secret_presence(
    monkeypatch,
):
    _install_database_runner(monkeypatch)
    secret = "postgresql://admin:never-return-this@private/db"
    environment = {
        "APP_ENV": "production",
        "FRONTEND_ASSET_MODE": "bundle",
        "APP_DEBUG": "false",
        "APP_SECURE_COOKIES": "true",
        "AI_ENABLED": "true",
        "DATABASE_URL": secret,
        "OTP_HMAC_KEY": "otp-never-return-this",
        "UNLISTED_PRIVATE_PATH": "D:/private/files",
    }
    build_payload = operational.build_environment_payload
    monkeypatch.setattr(
        operational,
        "build_environment_payload",
        lambda: build_payload(environment),
    )

    response = asyncio.run(operational.admin_environment_api(_request()))
    payload = _payload(response)
    serialized = response.body.decode("utf-8")

    assert response.status_code == 200
    assert response.headers["cache-control"] == "private, no-store"
    assert payload["runtime"] == {
        "environment": "production",
        "frontendAssetMode": "bundle",
        "debugEnabled": False,
        "secureCookies": True,
    }
    assert payload["features"]["aiEnabled"] is True
    assert payload["secretStatus"]["DATABASE_URL"] == {"configured": True}
    assert payload["secretStatus"]["TURNSTILE_SECRET_KEY"] == {"configured": False}
    assert secret not in serialized
    assert "otp-never-return-this" not in serialized
    assert "D:/private/files" not in serialized
    assert "UNLISTED_PRIVATE_PATH" not in serialized


def test_environment_normalizes_untrusted_public_labels():
    payload = operational.build_environment_payload(
        {
            "APP_ENV": "production<script>",
            "FRONTEND_ASSET_MODE": "C:/private/build",
        }
    )

    assert payload["runtime"]["environment"] == "unknown"
    assert payload["runtime"]["frontendAssetMode"] == "bundle"


def test_health_reports_real_application_and_database_state(monkeypatch):
    _install_database_runner(monkeypatch)
    response = asyncio.run(operational.admin_health_api(_request()))
    payload = _payload(response)

    assert response.status_code == 200
    assert response.headers["cache-control"] == "private, no-store"
    assert payload["status"] == "ready"
    assert payload["application"] == {
        "startupComplete": True,
        "ready": True,
        "eventLoopLagMs": 4.2,
    }
    assert payload["database"] == {"status": "available", "schemaVersion": 90}


def test_health_is_degraded_without_leaking_database_failure(monkeypatch):
    _install_database_runner(
        monkeypatch, {"status": "unavailable", "schemaVersion": None}
    )
    response = asyncio.run(operational.admin_health_api(_request()))

    assert _payload(response)["status"] == "degraded"
    assert set(_payload(response)["database"]) == {"status", "schemaVersion"}


def test_system_version_uses_sanitized_release_and_installed_schema(monkeypatch):
    _install_database_runner(monkeypatch)
    monkeypatch.setattr(
        operational,
        "_release_id",
        lambda: "c0d8ebfc699258c28662f7d03e7bbadd507a9305",
    )
    monkeypatch.setattr(operational, "_app_version", lambda: "2.0.0")

    response = asyncio.run(operational.admin_system_version_api(_request()))
    payload = _payload(response)

    assert response.status_code == 200
    assert response.headers["cache-control"] == "private, no-store"
    assert payload["applicationVersion"] == "2.0.0"
    assert payload["releaseId"] == "c0d8ebfc699258c28662f7d03e7bbadd507a9305"
    assert payload["frontendBundleVersion"] == payload["releaseId"]
    assert payload["schemaVersion"] == 90
    assert payload["expectedSchemaVersion"] == operational.DB_SCHEMA_VERSION
    assert payload["schemaStatus"] == "available"


def test_release_id_rejects_arbitrary_or_path_values():
    assert operational._release_id({"APP_RELEASE_ID": "../../private/release"}) is None
    assert operational._release_id({"APP_RELEASE_ID": "release id with spaces"}) is None
    assert operational._release_id({"APP_RELEASE_ID": "release-2026.09"}) == "release-2026.09"


def test_operational_routes_are_get_only():
    class _Route:
        def __init__(self, path, endpoint, methods):
            self.path = path
            self.endpoint = endpoint
            self.methods = methods

    routes = operational.operational_routes(_Route)

    assert [route.path for route in routes] == [
        "/api/admin/health",
        "/api/admin/environment",
        "/api/admin/system/version",
    ]
    assert all(route.methods == ["GET"] for route in routes)
