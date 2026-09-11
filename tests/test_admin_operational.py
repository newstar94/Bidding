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
    status = database_status or {
        "status": "available", "schemaVersion": 90, "latencyMs": 1.2,
    }

    async def database_read(function, *args, **kwargs):
        calls.append((function, args, kwargs))
        if function is operational.verify_session:
            return True, SimpleNamespace(user_id="admin-1")
        if function is operational._safe_read_database_status:
            return status
        if function is operational._safe_read_operational_status:
            return {
                "databaseBytes": 4096,
                "waitingLocks": 0,
                "walBytes": 1024,
                "databasePool": {
                    "pool_size": 5, "pool_available": 3,
                    "requests_waiting": 0,
                },
                "storage": {"data": {"freeBytes": 100, "totalBytes": 200}},
                "backup": {"lastVerifiedAt": 123, "ageSeconds": 10},
                "documentWorker": {
                    "active": 1, "waiting": 2, "completed": 3,
                    "failed": 0, "rejected": 0,
                },
                "websocket": {
                    "activeConnections": 4, "pendingEvents": 5,
                    "oldestPendingSeconds": 6.5,
                },
                "backgroundJobs": [
                    {
                        "queue": "document", "status": "pending",
                        "count": 2, "oldestSeconds": 8.0,
                    }
                ],
            }
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
    assert payload["secretStatus"]["DATABASE_URL"] == {
        "configured": True, "writable": False, "restartRequired": True,
        "source": "deployment_environment", "lastUpdated": None,
    }
    assert payload["secretStatus"]["TURNSTILE_SECRET_KEY"] == {
        "configured": False, "writable": False, "restartRequired": True,
        "source": "deployment_environment", "lastUpdated": None,
    }
    assert payload["configuration"] == {
        "writable": False,
        "restartRequired": True,
        "source": "deployment_environment",
    }
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
    assert payload["database"] == {
        "status": "available", "schemaVersion": 90, "latencyMs": 1.2,
    }
    assert payload["operations"]["databaseBytes"] == 4096
    assert payload["operations"]["storage"]["data"]["totalBytes"] == 200
    assert payload["operations"]["documentWorker"]["waiting"] == 2
    assert payload["operations"]["websocket"]["activeConnections"] == 4
    assert payload["operations"]["backgroundJobs"][0]["queue"] == "document"


def test_operational_projection_includes_bounded_worker_sync_and_job_health(monkeypatch):
    monkeypatch.setattr(
        operational,
        "operational_status_snapshot",
        lambda: {
            "websocket_cluster_active_connections": 7,
            "websocket_outbox_rows": 8,
            "websocket_outbox_oldest_seconds": 9.5,
            "background_jobs": {
                ("document", "pending"): {"count": 3, "oldest_seconds": 12.0},
            },
            "postgres_pool": {
                "pool_min": 2, "pool_max": 12, "pool_size": 4,
                "pool_available": 3, "requests_waiting": 1,
                "private_stat": 999,
            },
            "private_path": "D:/must-not-leak",
        },
    )
    monkeypatch.setattr(
        operational,
        "snapshot_recorded_metrics",
        lambda: SimpleNamespace(document_worker={
            "active": 1, "waiting": 2, "success": 4, "error": 1, "rejected": 1,
        }),
    )

    payload = operational._safe_read_operational_status()

    assert payload["documentWorker"] == {
        "active": 1, "waiting": 2, "completed": 4, "failed": 1, "rejected": 1,
    }
    assert payload["websocket"] == {
        "activeConnections": 7, "pendingEvents": 8, "oldestPendingSeconds": 9.5,
    }
    assert payload["backgroundJobs"] == [
        {"queue": "document", "status": "pending", "count": 3, "oldestSeconds": 12.0}
    ]
    assert payload["databasePool"] == {
        "pool_min": 2, "pool_max": 12, "pool_size": 4,
        "pool_available": 3, "requests_waiting": 1,
    }
    assert "private_path" not in payload


def test_health_is_degraded_without_leaking_database_failure(monkeypatch):
    _install_database_runner(
        monkeypatch, {"status": "unavailable", "schemaVersion": None, "latencyMs": None}
    )
    response = asyncio.run(operational.admin_health_api(_request()))

    assert _payload(response)["status"] == "degraded"
    assert set(_payload(response)["database"]) == {"status", "schemaVersion", "latencyMs"}


def test_system_version_uses_sanitized_release_and_installed_schema(monkeypatch):
    _install_database_runner(monkeypatch)
    monkeypatch.setattr(
        operational,
        "_release_id",
        lambda: "c0d8ebfc699258c28662f7d03e7bbadd507a9305",
    )
    monkeypatch.setattr(operational, "_app_version", lambda: "2.0.0")
    monkeypatch.setattr(operational, "_build_sha", lambda: "c0d8ebfc699258c2")
    monkeypatch.setattr(operational, "_build_time", lambda: "2026-09-11T01:02:03Z")
    monkeypatch.setenv("APP_ENV", "production")

    response = asyncio.run(operational.admin_system_version_api(_request()))
    payload = _payload(response)

    assert response.status_code == 200
    assert response.headers["cache-control"] == "private, no-store"
    assert payload["applicationVersion"] == "2.0.0"
    assert payload["releaseId"] == "c0d8ebfc699258c28662f7d03e7bbadd507a9305"
    assert payload["buildSha"] == "c0d8ebfc699258c2"
    assert payload["buildTime"] == "2026-09-11T01:02:03Z"
    assert payload["environment"] == "production"
    assert payload["frontendBundleVersion"] == payload["releaseId"]
    assert payload["schemaVersion"] == 90
    assert payload["expectedSchemaVersion"] == operational.DB_SCHEMA_VERSION
    assert payload["schemaStatus"] == "available"


def test_release_id_rejects_arbitrary_or_path_values():
    assert operational._release_id({"APP_RELEASE_ID": "../../private/release"}) is None
    assert operational._release_id({"APP_RELEASE_ID": "release id with spaces"}) is None
    assert operational._release_id({"APP_RELEASE_ID": "release-2026.09"}) == "release-2026.09"


def test_build_metadata_is_allowlisted_and_normalized():
    assert operational._build_sha({"GITHUB_SHA": "ABCDEF1234567"}) == "abcdef1234567"
    assert operational._build_sha({"GITHUB_SHA": "../../private"}) is None
    assert operational._build_time({"APP_BUILD_TIME": "2026-09-11T08:02:03+07:00"}) == (
        "2026-09-11T01:02:03Z"
    )
    assert operational._build_time({"SOURCE_DATE_EPOCH": "1789088523"}) == (
        "2026-09-11T01:02:03Z"
    )
    assert operational._build_time({"APP_BUILD_TIME": "not-a-date"}) is None


def test_environment_update_validation_rejects_unknown_and_malformed_values():
    with pytest.raises(ValueError):
        operational._validated_environment_updates({"arbitrary": True})
    with pytest.raises(ValueError):
        operational._validated_environment_updates({"features": {"unknown": True}})
    with pytest.raises(ValueError):
        operational._validated_environment_updates({"features": {"aiEnabled": "true"}})
    with pytest.raises(ValueError):
        operational._validated_environment_updates({"secrets": {"OTP_HMAC_KEY": "short"}})
    with pytest.raises(ValueError):
        operational._validated_environment_updates({"secrets": {"OTP_HMAC_KEY": "x" * 32 + "\n"}})


def test_local_environment_update_is_atomic_and_allowlisted(monkeypatch, tmp_path):
    env_path = tmp_path / ".env"
    env_path.write_text("# retained\nAI_ENABLED=false\nPRIVATE_SETTING=retained\n", encoding="utf-8")
    monkeypatch.setattr(operational, "_PROJECT_ROOT", tmp_path)

    original = operational._replace_local_env({
        "AI_ENABLED": "true",
        "OTP_HMAC_KEY": "x" * 32,
    })

    assert original == "# retained\nAI_ENABLED=false\nPRIVATE_SETTING=retained\n"
    assert env_path.read_text(encoding="utf-8") == (
        "# retained\nAI_ENABLED=true\nPRIVATE_SETTING=retained\n\nOTP_HMAC_KEY="
        + "x" * 32 + "\n"
    )


@pytest.mark.parametrize("app_environment", [None, "", "invalid", "staging", "production"])
def test_environment_update_is_read_only_outside_local_environments(
    monkeypatch, app_environment,
):
    if app_environment is None:
        monkeypatch.delenv("APP_ENV", raising=False)
    else:
        monkeypatch.setenv("APP_ENV", app_environment)
    monkeypatch.setattr(
        operational.database,
        "get_connection",
        lambda: (_ for _ in ()).throw(AssertionError("database must not be opened")),
    )

    response = operational._update_environment_sync(
        _request(), {"features": {"aiEnabled": True}},
    )

    assert response.status_code == 409
    assert _payload(response)["code"] == "DEPLOYMENT_CONFIG_READ_ONLY"


def test_environment_update_rechecks_authority_and_audits_only_key_names(monkeypatch, tmp_path):
    class Cursor:
        def execute(self, _statement, _params=()):
            return self

    class Connection:
        def __init__(self):
            self.cursor_value = Cursor()
            self.committed = False
            self.closed = False

        def cursor(self):
            return self.cursor_value

        def commit(self):
            self.committed = True

        def rollback(self):
            pass

        def close(self):
            self.closed = True

    connection = Connection()
    audits = []
    secret = "s" * 32
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.delenv("AI_ENABLED", raising=False)
    monkeypatch.delenv("OTP_HMAC_KEY", raising=False)
    monkeypatch.setattr(operational, "_PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(operational.database, "get_connection", lambda: connection)
    monkeypatch.setattr(
        operational,
        "verify_session_in_transaction",
        lambda cursor, request, required_role: (
            True, SimpleNamespace(user_id="admin-1")
        ),
    )
    monkeypatch.setattr(
        operational,
        "log_audit",
        lambda action, **kwargs: audits.append((action, kwargs)),
    )

    response = operational._update_environment_sync(
        _request(),
        {"features": {"aiEnabled": True}, "secrets": {"OTP_HMAC_KEY": secret}},
    )
    serialized_audit = json.dumps(audits[0][1]["metadata"])

    assert response.status_code == 200
    assert _payload(response) == {
        "success": True,
        "restartRequired": True,
        "updatedKeys": ["AI_ENABLED", "OTP_HMAC_KEY"],
    }
    assert connection.committed is True
    assert connection.closed is True
    assert audits[0][0] == "admin.environment_configuration_updated"
    assert audits[0][1]["metadata"] == {
        "updated_fields": ["AI_ENABLED", "OTP_HMAC_KEY"],
        "changes": [
            {
                "key": "AI_ENABLED", "action": "update",
                "old_state": "disabled", "new_state": "enabled",
            },
            {
                "key": "OTP_HMAC_KEY", "action": "configure",
                "old_state": "missing", "new_state": "configured",
            },
        ],
        "restartRequired": True,
    }
    assert secret not in serialized_audit


def test_environment_update_stops_before_file_write_when_authority_is_revoked(
    monkeypatch, tmp_path,
):
    class Cursor:
        def execute(self, _statement, _params=()):
            return self

    class Connection:
        def cursor(self):
            return Cursor()

        def rollback(self):
            pass

        def close(self):
            pass

    env_path = tmp_path / ".env"
    env_path.write_text("AI_ENABLED=false\n", encoding="utf-8")
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setattr(operational, "_PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(operational.database, "get_connection", Connection)
    monkeypatch.setattr(
        operational,
        "verify_session_in_transaction",
        lambda *_args, **_kwargs: (False, "Cần xác thực lại mật khẩu"),
    )

    response = operational._update_environment_sync(
        _request(), {"features": {"aiEnabled": True}},
    )

    assert response.status_code == 403
    assert env_path.read_text(encoding="utf-8") == "AI_ENABLED=false\n"


def test_operational_routes_include_bounded_environment_write():
    class _Route:
        def __init__(self, path, endpoint, methods):
            self.path = path
            self.endpoint = endpoint
            self.methods = methods

    routes = operational.operational_routes(_Route)

    assert [route.path for route in routes] == [
        "/api/admin/health",
        "/api/admin/environment",
        "/api/admin/environment",
        "/api/admin/system/version",
    ]
    assert [route.methods for route in routes] == [["GET"], ["GET"], ["POST"], ["GET"]]
