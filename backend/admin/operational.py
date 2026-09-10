"""Sanitized, read-only operational APIs for platform administrators."""

from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re

from starlette.responses import JSONResponse

from backend.auth.auth_helper import verify_session
from backend.db.db_helper import database
from backend.db.db_utils import (
    DB_RUNTIME_MAX_SCHEMA_VERSION,
    DB_RUNTIME_MIN_SCHEMA_VERSION,
    DB_SCHEMA_VERSION,
)
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError
from backend.shared.database_io import run_database_read
from backend.shared.logging_utils import log_error
from backend.observability.metrics import operational_status_snapshot
from backend.observability.recording import snapshot_recorded_metrics


_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_SAFE_RELEASE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
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
            name: {"configured": bool(str(environ.get(name, "")).strip())}
            for name in _SECRET_STATUS_NAMES
        },
    }


def _read_database_status() -> dict:
    connection = database.get_connection()
    try:
        row = connection.execute(
            "SELECT schema_version FROM database_metadata WHERE id = 1"
        ).fetchone()
        if row is None:
            return {"status": "unavailable", "schemaVersion": None}
        version = int(row[0])
        compatible = DB_RUNTIME_MIN_SCHEMA_VERSION <= version <= DB_RUNTIME_MAX_SCHEMA_VERSION
        return {
            "status": "available" if compatible else "incompatible",
            "schemaVersion": version,
        }
    finally:
        connection.close()


def _safe_read_database_status() -> dict:
    try:
        return _read_database_status()
    except Exception as exc:  # noqa: BLE001 - details must not cross the API boundary.
        log_error(exc, "admin_operational_database", level="WARN")
        return {"status": "unavailable", "schemaVersion": None}


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
        Route("/api/admin/system/version", admin_system_version_api, methods=["GET"]),
    ]
