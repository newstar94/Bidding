"""Sanitized operational APIs for platform administrators."""

from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import tempfile
import threading
import time

from starlette.responses import JSONResponse

from backend.auth.auth_helper import verify_session, verify_session_in_transaction
from backend.db.db_helper import database
from backend.db.db_utils import (
    DB_RUNTIME_MAX_SCHEMA_VERSION,
    DB_RUNTIME_MIN_SCHEMA_VERSION,
    DB_SCHEMA_VERSION,
)
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError
from backend.shared.database_io import run_database_read, run_database_write
from backend.shared.logging_utils import log_audit, log_error
from backend.shared.request_validation import read_json_object
from backend.observability.metrics import operational_status_snapshot
from backend.observability.recording import snapshot_recorded_metrics


_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_SAFE_RELEASE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_SAFE_BUILD_SHA = re.compile(r"^[0-9a-fA-F]{7,64}$")
_SAFE_APP_VERSION = re.compile(r"^[0-9]+(?:\.[0-9]+){1,3}(?:[-+][A-Za-z0-9.-]+)?$")
_ENVIRONMENT_NAMES = frozenset({"development", "test", "staging", "production"})
_ASSET_MODES = frozenset({"source", "bundle"})
_SECRET_STATUS_NAMES = (
    "DATABASE_URL",
    "OTP_HMAC_KEY",
    "EMAIL_OUTBOX_ENCRYPTION_KEY",
    "CONFLICT_DRAFT_ENCRYPTION_KEY",
    "AUDIT_CHECKPOINT_HMAC_KEY",
    "ANALYTICS_HMAC_KEY",
    "TURNSTILE_SECRET_KEY",
    "PAYOS_CLIENT_ID",
    "PAYOS_API_KEY",
    "PAYOS_CHECKSUM_KEY",
)
_ENV_WRITE_LOCK = threading.Lock()
_FEATURE_SETTING_KEYS = {
    "aiEnabled": "AI_ENABLED",
    "legalVersioningEnabled": "LEGAL_VERSIONING_ENABLED",
    "versionComparisonEnabled": "VERSION_COMPARISON_ENABLED",
    "paymentCheckoutEnabled": "PAYMENT_CHECKOUT_ENABLED",
}
_SECRET_MINIMUM_LENGTHS = {
    "DATABASE_URL": 12,
    "OTP_HMAC_KEY": 32,
    "EMAIL_OUTBOX_ENCRYPTION_KEY": 32,
    "CONFLICT_DRAFT_ENCRYPTION_KEY": 32,
    "AUDIT_CHECKPOINT_HMAC_KEY": 32,
    "ANALYTICS_HMAC_KEY": 32,
    "TURNSTILE_SECRET_KEY": 8,
    "PAYOS_CLIENT_ID": 4,
    "PAYOS_API_KEY": 8,
    "PAYOS_CHECKSUM_KEY": 8,
}


def _error(message: str, code: str, status_code: int) -> JSONResponse:
    return JSONResponse(
        {"error": message, "code": code},
        status_code=status_code,
        headers={"Cache-Control": "private, no-store"},
    )


async def _authorize(request):
    try:
        valid, session = await run_database_read(
            verify_session,
            request,
            "super_admin",
            timeout_seconds=5,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _error(
            "Không thể xác thực quyền quản trị lúc này.",
            "ADMIN_AUTH_UNAVAILABLE",
            503,
        )
    if not valid:
        return _error(str(session), "SUPER_ADMIN_REQUIRED", 403)
    return None


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _normalized_choice(value, allowed, default):
    candidate = str(value or "").strip().lower()
    return candidate if candidate in allowed else default


def _enabled(environment, name, default="false"):
    return str(environment.get(name, default)).strip().lower() == "true"


def build_environment_payload(environment=None) -> dict:
    """Return an allowlisted configuration projection without raw values."""

    environ = os.environ if environment is None else environment
    app_environment = _normalized_choice(
        environ.get("APP_ENV"), _ENVIRONMENT_NAMES, "unknown"
    )
    asset_mode = _normalized_choice(
        environ.get("FRONTEND_ASSET_MODE"), _ASSET_MODES, "bundle"
    )
    writable = app_environment in {"development", "test"} and environment is None
    configuration_source = "local_env" if writable else "deployment_environment"
    return {
        "generatedAt": _utc_now(),
        "runtime": {
            "environment": app_environment,
            "frontendAssetMode": asset_mode,
            "debugEnabled": _enabled(environ, "APP_DEBUG"),
            "secureCookies": _enabled(environ, "APP_SECURE_COOKIES"),
        },
        "features": {
            "aiEnabled": _enabled(environ, "AI_ENABLED"),
            "legalVersioningEnabled": _enabled(environ, "LEGAL_VERSIONING_ENABLED"),
            "versionComparisonEnabled": _enabled(
                environ, "VERSION_COMPARISON_ENABLED"
            ),
            "paymentCheckoutEnabled": _enabled(
                environ, "PAYMENT_CHECKOUT_ENABLED"
            ),
        },
        "secretStatus": {
            name: {
                "configured": bool(str(environ.get(name, "")).strip()),
                "writable": writable,
                "restartRequired": True,
                "source": configuration_source,
                "lastUpdated": None,
            }
            for name in _SECRET_STATUS_NAMES
        },
        "configuration": {
            "writable": writable,
            "restartRequired": True,
            "source": configuration_source,
        },
    }


def _validated_environment_updates(payload):
    if not isinstance(payload, dict) or set(payload) - {"features", "secrets"}:
        raise ValueError("Yêu cầu cấu hình không hợp lệ.")
    updates = {}
    features = payload.get("features", {})
    secrets = payload.get("secrets", {})
    if not isinstance(features, dict) or set(features) - set(_FEATURE_SETTING_KEYS):
        raise ValueError("Tính năng cấu hình không hợp lệ.")
    if not isinstance(secrets, dict) or set(secrets) - set(_SECRET_MINIMUM_LENGTHS):
        raise ValueError("Bí mật cấu hình không hợp lệ.")
    for key, value in features.items():
        if not isinstance(value, bool):
            raise ValueError("Trạng thái tính năng phải là bật hoặc tắt.")
        updates[_FEATURE_SETTING_KEYS[key]] = "true" if value else "false"
    for key, value in secrets.items():
        if not isinstance(value, str) or "\n" in value or "\r" in value:
            raise ValueError(f"Giá trị thay thế cho {key} không hợp lệ.")
        normalized = value.strip()
        if len(normalized) < _SECRET_MINIMUM_LENGTHS[key] or len(normalized) > 8192:
            raise ValueError(f"Giá trị thay thế cho {key} không hợp lệ.")
        updates[key] = normalized
    if not updates:
        raise ValueError("Chưa có thay đổi cấu hình.")
    return updates


def _environment_audit_changes(updates):
    changes = []
    feature_keys = set(_FEATURE_SETTING_KEYS.values())
    for key in sorted(updates):
        if key in feature_keys:
            changes.append({
                "key": key,
                "action": "update",
                "old_state": "enabled" if _enabled(os.environ, key) else "disabled",
                "new_state": "enabled" if updates[key] == "true" else "disabled",
            })
        else:
            was_configured = bool(str(os.environ.get(key, "")).strip())
            changes.append({
                "key": key,
                "action": "replace" if was_configured else "configure",
                "old_state": "configured" if was_configured else "missing",
                "new_state": "configured",
            })
    return changes


def _replace_local_env(updates, *, env_path=None):
    path = Path(env_path or (_PROJECT_ROOT / ".env")).resolve()
    if path.parent != _PROJECT_ROOT.resolve():
        raise ValueError("Đường dẫn cấu hình không hợp lệ.")
    original_exists = path.exists()
    existing = path.read_text(encoding="utf-8") if original_exists else ""
    pending = dict(updates)
    lines = []
    for line in existing.splitlines():
        if not line.strip() or line.lstrip().startswith("#") or "=" not in line:
            lines.append(line)
            continue
        key = line.split("=", 1)[0].strip()
        if key in pending:
            lines.append(f"{key}={pending.pop(key)}")
        else:
            lines.append(line)
    if pending and lines and lines[-1] != "":
        lines.append("")
    lines.extend(f"{key}={value}" for key, value in pending.items())
    content = "\n".join(lines).rstrip("\n") + "\n"
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", newline="\n", dir=path.parent, delete=False,
    ) as temporary:
        temporary.write(content)
        temporary_path = Path(temporary.name)
    try:
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)
    return existing if original_exists else None


def _restore_local_env(original, *, env_path=None):
    path = Path(env_path or (_PROJECT_ROOT / ".env")).resolve()
    if path.parent != _PROJECT_ROOT.resolve():
        raise ValueError("Đường dẫn cấu hình không hợp lệ.")
    if original is None:
        path.unlink(missing_ok=True)
        return
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", newline="\n", dir=path.parent, delete=False,
    ) as temporary:
        temporary.write(original)
        temporary_path = Path(temporary.name)
    try:
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


def _update_environment_sync(request, payload):
    app_environment = _normalized_choice(
        os.environ.get("APP_ENV"), _ENVIRONMENT_NAMES, "unknown"
    )
    if app_environment not in {"development", "test"}:
        return _error("Môi trường này dùng cấu hình triển khai chỉ đọc.", "DEPLOYMENT_CONFIG_READ_ONLY", 409)
    try:
        updates = _validated_environment_updates(payload)
    except ValueError as exc:
        return _error(str(exc), "INVALID_ADMIN_CONFIGURATION", 400)
    audit_changes = _environment_audit_changes(updates)
    connection = database.get_connection()
    original_environment = None
    environment_replaced = False
    environment_lock_acquired = False
    try:
        cursor = connection.cursor()
        cursor.execute("BEGIN")
        valid, actor = verify_session_in_transaction(cursor, request, required_role="super_admin")
        if not valid:
            connection.rollback()
            return _error(str(actor), "SUPER_ADMIN_REQUIRED", 403)
        _ENV_WRITE_LOCK.acquire()
        environment_lock_acquired = True
        original_environment = _replace_local_env(updates)
        environment_replaced = True
        log_audit(
            "admin.environment_configuration_updated",
            actor_user_id=actor.user_id,
            target_type="deployment_configuration",
            target_id="local_env",
            request=request,
            metadata={
                "updated_fields": sorted(updates),
                "changes": audit_changes,
                "restartRequired": True,
            },
            cursor=cursor,
            required=True,
        )
        connection.commit()
        return JSONResponse(
            {"success": True, "restartRequired": True, "updatedKeys": sorted(updates)},
            headers={"Cache-Control": "private, no-store"},
        )
    except Exception as exc:  # noqa: BLE001 - never return paths or values.
        connection.rollback()
        if environment_replaced:
            try:
                _restore_local_env(original_environment)
            except Exception as restore_exc:  # noqa: BLE001 - report without values.
                log_error(restore_exc, "admin_environment_restore")
        log_error(exc, "admin_environment_update")
        return _error("Không thể lưu cấu hình môi trường.", "ADMIN_CONFIGURATION_FAILED", 500)
    finally:
        if environment_lock_acquired:
            _ENV_WRITE_LOCK.release()
        connection.close()


def _read_database_status() -> dict:
    started_at = time.perf_counter()
    connection = database.get_connection()
    try:
        row = connection.execute(
            "SELECT schema_version FROM database_metadata WHERE id = 1"
        ).fetchone()
        if row is None:
            return {
                "status": "unavailable", "schemaVersion": None,
                "latencyMs": round((time.perf_counter() - started_at) * 1000, 1),
            }
        version = int(row[0])
        compatible = DB_RUNTIME_MIN_SCHEMA_VERSION <= version <= DB_RUNTIME_MAX_SCHEMA_VERSION
        return {
            "status": "available" if compatible else "incompatible",
            "schemaVersion": version,
            "latencyMs": round((time.perf_counter() - started_at) * 1000, 1),
        }
    finally:
        connection.close()


def _safe_read_database_status() -> dict:
    try:
        return _read_database_status()
    except Exception as exc:  # noqa: BLE001 - details must not cross the API boundary.
        log_error(exc, "admin_operational_database", level="WARN")
        return {"status": "unavailable", "schemaVersion": None, "latencyMs": None}


def _safe_read_operational_status() -> dict:
    try:
        snapshot = operational_status_snapshot()
    except Exception as exc:  # noqa: BLE001 - details must not cross the API boundary.
        log_error(exc, "admin_operational_snapshot", level="WARN")
        return {}
    disk = snapshot.get("disk") if isinstance(snapshot.get("disk"), dict) else {}
    recorded = snapshot_recorded_metrics()
    worker = recorded.document_worker
    background_jobs = snapshot.get("background_jobs")
    if not isinstance(background_jobs, dict):
        background_jobs = {}
    return {
        "databaseBytes": int(snapshot.get("postgres_database_bytes") or 0),
        "waitingLocks": int(snapshot.get("postgres_waiting_locks") or 0),
        "walBytes": int(snapshot.get("postgres_wal_bytes") or 0),
        "databasePool": {
            key: int(value)
            for key, value in (snapshot.get("postgres_pool") or {}).items()
            if key in {
                "pool_min", "pool_max", "pool_size", "pool_available",
                "requests_waiting", "requests_errors",
            }
            and isinstance(value, (int, float))
        },
        "storage": {
            volume: {
                "freeBytes": int(values.get("free") or 0),
                "totalBytes": int(values.get("total") or 0),
            }
            for volume, values in disk.items()
            if volume in {"data", "backup"} and isinstance(values, dict)
        },
        "backup": {
            "lastVerifiedAt": snapshot.get("backup_timestamp"),
            "ageSeconds": snapshot.get("backup_age"),
            "lastRestoreDrillAt": snapshot.get("restore_timestamp"),
            "restoreDrillAgeSeconds": snapshot.get("restore_age"),
            "checkedAt": snapshot.get("artifact_checked_at"),
        },
        "documentWorker": {
            "active": int(worker.get("active", 0)),
            "waiting": int(worker.get("waiting", 0)),
            "completed": int(worker.get("success", 0)),
            "failed": int(worker.get("error", 0)),
            "rejected": int(worker.get("rejected", 0)),
        },
        "websocket": {
            "activeConnections": int(
                snapshot.get("websocket_cluster_active_connections") or 0
            ),
            "pendingEvents": int(snapshot.get("websocket_outbox_rows") or 0),
            "oldestPendingSeconds": float(
                snapshot.get("websocket_outbox_oldest_seconds") or 0
            ),
        },
        "backgroundJobs": [
            {
                "queue": str(queue),
                "status": str(status),
                "count": int(values.get("count") or 0),
                "oldestSeconds": float(values.get("oldest_seconds") or 0),
            }
            for (queue, status), values in sorted(background_jobs.items())
            if isinstance(queue, str)
            and isinstance(status, str)
            and isinstance(values, dict)
        ],
    }


def _app_version() -> str | None:
    try:
        payload = json.loads((_PROJECT_ROOT / "package.json").read_text(encoding="utf-8"))
        version = str(payload.get("version") or "").strip()
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, AttributeError):
        return None
    return version if _SAFE_APP_VERSION.fullmatch(version) else None


def _release_id(environment=None) -> str | None:
    environ = os.environ if environment is None else environment
    value = str(environ.get("APP_RELEASE_ID") or "").strip()
    return value if _SAFE_RELEASE_ID.fullmatch(value) else None


def _build_sha(environment=None) -> str | None:
    environ = os.environ if environment is None else environment
    value = str(environ.get("GITHUB_SHA") or "").strip()
    return value.lower() if _SAFE_BUILD_SHA.fullmatch(value) else None


def _build_time(environment=None) -> str | None:
    environ = os.environ if environment is None else environment
    value = str(environ.get("APP_BUILD_TIME") or "").strip()
    if value:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        if parsed.tzinfo is None:
            return None
        return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    epoch = str(environ.get("SOURCE_DATE_EPOCH") or "").strip()
    if not epoch.isdigit():
        return None
    try:
        return datetime.fromtimestamp(int(epoch), timezone.utc).isoformat().replace(
            "+00:00", "Z"
        )
    except (OverflowError, OSError, ValueError):
        return None


async def admin_health_api(request):
    authorization_error = await _authorize(request)
    if authorization_error:
        return authorization_error
    try:
        database_status = await run_database_read(
            _safe_read_database_status,
            timeout_seconds=5,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        database_status = {"status": "unavailable", "schemaVersion": None}
    try:
        operations = await run_database_read(
            _safe_read_operational_status,
            timeout_seconds=5,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        operations = {}
    startup_complete = bool(getattr(request.app.state, "startup_complete", False))
    ready = bool(getattr(request.app.state, "ready", False))
    lag = getattr(request.app.state, "event_loop_lag_ms", None)
    event_loop_lag_ms = round(float(lag), 1) if isinstance(lag, (int, float)) else None
    overall_ready = startup_complete and ready and database_status["status"] == "available"
    return JSONResponse(
        {
            "generatedAt": _utc_now(),
            "status": "ready" if overall_ready else "degraded",
            "application": {
                "startupComplete": startup_complete,
                "ready": ready,
                "eventLoopLagMs": event_loop_lag_ms,
            },
            "database": database_status,
            "operations": operations,
        },
        headers={"Cache-Control": "private, no-store"},
    )


async def admin_environment_api(request):
    authorization_error = await _authorize(request)
    if authorization_error:
        return authorization_error
    return JSONResponse(
        build_environment_payload(),
        headers={"Cache-Control": "private, no-store"},
    )


async def update_admin_environment_api(request):
    authorization_error = await _authorize(request)
    if authorization_error:
        return authorization_error
    payload, json_error = await read_json_object(request)
    if json_error:
        return json_error
    try:
        return await run_database_write(_update_environment_sync, request, payload)
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _error("Hệ thống đang bận lưu cấu hình.", "ADMIN_CONFIGURATION_UNAVAILABLE", 503)


async def admin_system_version_api(request):
    authorization_error = await _authorize(request)
    if authorization_error:
        return authorization_error
    try:
        database_status = await run_database_read(
            _safe_read_database_status,
            timeout_seconds=5,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        database_status = {"status": "unavailable", "schemaVersion": None}
    release_id = _release_id()
    return JSONResponse(
        {
            "generatedAt": _utc_now(),
            "applicationVersion": _app_version(),
            "releaseId": release_id,
            "buildSha": _build_sha(),
            "buildTime": _build_time(),
            "environment": _normalized_choice(
                os.environ.get("APP_ENV"), _ENVIRONMENT_NAMES, "unknown"
            ),
            "frontendBundleVersion": release_id,
            "schemaVersion": database_status["schemaVersion"],
            "expectedSchemaVersion": DB_SCHEMA_VERSION,
            "schemaStatus": database_status["status"],
        },
        headers={"Cache-Control": "private, no-store"},
    )


def operational_routes(Route):
    return [
        Route("/api/admin/health", admin_health_api, methods=["GET"]),
        Route("/api/admin/environment", admin_environment_api, methods=["GET"]),
        Route("/api/admin/environment", update_admin_environment_api, methods=["POST"]),
        Route("/api/admin/system/version", admin_system_version_api, methods=["GET"]),
    ]
