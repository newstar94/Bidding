"""Validation and redacted execution plans for BiddingFlow load profiles."""

from __future__ import annotations

import json
from pathlib import Path


PROFILE_SCHEMA_VERSION = 1
REQUIRED_SCENARIOS = {
    "login",
    "pagination",
    "sync",
    "upload",
    "export",
    "websocket",
    "recovery",
}
REQUIRED_PHASES = ("warmupSeconds", "steadySeconds", "burstSeconds", "recoverySeconds")
REQUIRED_THRESHOLDS = {
    "server5xxRate",
    "throttled429Rate",
    "unexpectedFailureRate",
    "recoveryFailureRate",
    "snapshotConflictRate",
    "readP95Ms",
    "readP99Ms",
    "syncP95Ms",
    "syncP99Ms",
    "exportP95Ms",
    "exportP99Ms",
    "recoveryP95Ms",
    "recoveryP99Ms",
}


class LoadProfileError(ValueError):
    """Raised when a profile or its runtime inputs are unsafe or incomplete."""


def _error(path, message):
    raise LoadProfileError(f"{path}: {message}")


def _mapping(value, path):
    if not isinstance(value, dict):
        _error(path, "must be an object")
    return value


def _positive_int(value, path, *, maximum=None):
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        _error(path, "must be a positive integer")
    if maximum is not None and value > maximum:
        _error(path, f"must be at most {maximum}")
    return value


def _rate(value, path):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        _error(path, "must be a number")
    number = float(value)
    if number < 0 or number >= 1:
        _error(path, "must be greater than or equal to 0 and less than 1")
    return number


def _latency(value, path):
    return _positive_int(value, path, maximum=300_000)


def validate_profile(profile):
    """Validate a load profile without needing k6, a server, or credentials."""
    root = _mapping(profile, "$profile")
    if root.get("schemaVersion") != PROFILE_SCHEMA_VERSION:
        _error("schemaVersion", f"must equal {PROFILE_SCHEMA_VERSION}")
    name = root.get("name")
    if not isinstance(name, str) or not name.strip() or len(name) > 80:
        _error("name", "must be a non-empty string of at most 80 characters")

    target = _mapping(root.get("target"), "target")
    active_users = _positive_int(
        target.get("concurrentActiveUsers"),
        "target.concurrentActiveUsers",
        maximum=100_000,
    )
    min_sessions = _positive_int(
        target.get("minDistinctSessions"),
        "target.minDistinctSessions",
        maximum=100_000,
    )
    if min_sessions > active_users:
        _error(
            "target.minDistinctSessions",
            "cannot exceed target.concurrentActiveUsers",
        )
    _positive_int(
        target.get("minDistinctLoginUsers"),
        "target.minDistinctLoginUsers",
        maximum=active_users,
    )

    phases = _mapping(root.get("phases"), "phases")
    for key in REQUIRED_PHASES:
        _positive_int(phases.get(key), f"phases.{key}", maximum=86_400)

    thresholds = _mapping(root.get("thresholds"), "thresholds")
    missing_thresholds = sorted(REQUIRED_THRESHOLDS - set(thresholds))
    if missing_thresholds:
        _error("thresholds", f"missing keys: {', '.join(missing_thresholds)}")
    for key in (
        "server5xxRate",
        "throttled429Rate",
        "unexpectedFailureRate",
        "recoveryFailureRate",
        "snapshotConflictRate",
    ):
        _rate(thresholds.get(key), f"thresholds.{key}")
    for key in REQUIRED_THRESHOLDS - {
        "server5xxRate",
        "throttled429Rate",
        "unexpectedFailureRate",
        "recoveryFailureRate",
        "snapshotConflictRate",
    }:
        _latency(thresholds.get(key), f"thresholds.{key}")
    for prefix in ("read", "sync", "export", "recovery"):
        if thresholds[f"{prefix}P99Ms"] < thresholds[f"{prefix}P95Ms"]:
            _error(
                f"thresholds.{prefix}P99Ms",
                f"cannot be lower than {prefix}P95Ms",
            )

    scenarios = _mapping(root.get("scenarios"), "scenarios")
    missing_scenarios = sorted(REQUIRED_SCENARIOS - set(scenarios))
    if missing_scenarios:
        _error("scenarios", f"missing keys: {', '.join(missing_scenarios)}")
    unknown_scenarios = sorted(set(scenarios) - REQUIRED_SCENARIOS)
    if unknown_scenarios:
        _error("scenarios", f"unknown keys: {', '.join(unknown_scenarios)}")

    for name, scenario in scenarios.items():
        item = _mapping(scenario, f"scenarios.{name}")
        if not isinstance(item.get("enabled"), bool):
            _error(f"scenarios.{name}.enabled", "must be a boolean")
        if name == "websocket":
            base = _positive_int(item.get("baseVUs"), f"scenarios.{name}.baseVUs")
            burst = _positive_int(item.get("burstVUs"), f"scenarios.{name}.burstVUs")
            if burst < base:
                _error(f"scenarios.{name}.burstVUs", "cannot be lower than baseVUs")
            _positive_int(item.get("maxVUs"), f"scenarios.{name}.maxVUs")
            if item["maxVUs"] < burst:
                _error(f"scenarios.{name}.maxVUs", "cannot be lower than burstVUs")
            continue
        base_rate = _positive_int(
            item.get("ratePerMinute"),
            f"scenarios.{name}.ratePerMinute",
        )
        burst_rate = _positive_int(
            item.get("burstRatePerMinute"),
            f"scenarios.{name}.burstRatePerMinute",
        )
        if burst_rate < base_rate:
            _error(
                f"scenarios.{name}.burstRatePerMinute",
                "cannot be lower than ratePerMinute",
            )
        preallocated = _positive_int(
            item.get("preAllocatedVUs"),
            f"scenarios.{name}.preAllocatedVUs",
        )
        maximum = _positive_int(item.get("maxVUs"), f"scenarios.{name}.maxVUs")
        if maximum < preallocated:
            _error(f"scenarios.{name}.maxVUs", "cannot be lower than preAllocatedVUs")

    runtime = _mapping(root.get("runtime"), "runtime")
    if runtime.get("pageTable") not in {
        "chudautu",
        "kehoach",
        "goithau",
        "nhathau",
        "chuyengia",
        "hopdong",
    }:
        _error("runtime.pageTable", "is not an allowed pagination table")
    _positive_int(runtime.get("pageSize"), "runtime.pageSize", maximum=200)
    if runtime.get("exportType") not in {"evaluation", "appraisal", "timeline", "plan"}:
        _error("runtime.exportType", "is not an allowed export type")
    sync_payload = runtime.get("safeSyncPayload")
    if not isinstance(sync_payload, dict):
        _error("runtime.safeSyncPayload", "must be a JSON object")

    return root


def load_profile(path):
    profile_path = Path(path)
    try:
        payload = json.loads(profile_path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise LoadProfileError(f"Cannot read profile: {profile_path}") from exc
    except json.JSONDecodeError as exc:
        raise LoadProfileError(
            f"Invalid JSON in {profile_path}:{exc.lineno}:{exc.colno}"
        ) from exc
    return validate_profile(payload)


def _load_secret_array(path, root_key, label):
    source = Path(path)
    try:
        payload = json.loads(source.read_text(encoding="utf-8"))
    except OSError as exc:
        raise LoadProfileError(f"Cannot read {label} file: {source}") from exc
    except json.JSONDecodeError as exc:
        raise LoadProfileError(f"Invalid JSON in {label} file") from exc
    if isinstance(payload, dict):
        payload = payload.get(root_key)
    if not isinstance(payload, list) or not payload:
        raise LoadProfileError(f"{label} file must contain a non-empty '{root_key}' array")
    return payload


def validate_runtime_inputs(
    profile,
    *,
    sessions_path=None,
    login_users_path=None,
    upload_fixture_path=None,
    sync_fixture_path=None,
):
    """Validate staging inputs and return counts only, never credentials or IDs."""
    validate_profile(profile)
    scenarios = profile["scenarios"]
    requires_session = any(
        scenarios[name]["enabled"]
        for name in ("pagination", "sync", "upload", "export", "websocket")
    )
    sessions = []
    if requires_session:
        if not sessions_path:
            raise LoadProfileError("Runtime validation requires --sessions-file")
        sessions = _load_secret_array(sessions_path, "sessions", "sessions")
        required_count = profile["target"]["minDistinctSessions"]
        if len(sessions) < required_count:
            raise LoadProfileError(
                f"sessions file has {len(sessions)} entries; at least {required_count} are required"
            )
        unique_cookies = {
            str(session.get("cookie") or "").strip()
            for session in sessions
            if isinstance(session, dict)
        }
        if len(unique_cookies) < required_count:
            raise LoadProfileError(
                f"sessions file has fewer than {required_count} distinct cookie values"
            )
        for index, session in enumerate(sessions):
            if not isinstance(session, dict) or not str(session.get("cookie") or "").strip():
                raise LoadProfileError(f"sessions[{index}].cookie is required")
            if scenarios["websocket"]["enabled"] and not str(
                session.get("organizationId") or ""
            ).strip():
                raise LoadProfileError(
                    f"sessions[{index}].organizationId is required for WebSocket load"
                )
            if scenarios["export"]["enabled"]:
                export_type = profile["runtime"]["exportType"]
                required_id = "planId" if export_type == "plan" else "packageId"
                if not str(session.get(required_id) or "").strip():
                    raise LoadProfileError(
                        f"sessions[{index}].{required_id} is required for {export_type} export load"
                    )

    login_users = []
    if scenarios["login"]["enabled"]:
        if not login_users_path:
            raise LoadProfileError("Runtime validation requires --login-users-file")
        login_users = _load_secret_array(login_users_path, "users", "login users")
        required_count = profile["target"]["minDistinctLoginUsers"]
        if len(login_users) < required_count:
            raise LoadProfileError(
                f"login users file has {len(login_users)} entries; at least {required_count} are required"
            )
        unique_usernames = {
            str(user.get("username") or "").strip().casefold()
            for user in login_users
            if isinstance(user, dict)
        }
        if len(unique_usernames) < required_count:
            raise LoadProfileError(
                f"login users file has fewer than {required_count} distinct usernames"
            )
        for index, user in enumerate(login_users):
            if not isinstance(user, dict):
                raise LoadProfileError(f"users[{index}] must be an object")
            if not str(user.get("username") or "").strip() or not isinstance(
                user.get("password"), str
            ):
                raise LoadProfileError(
                    f"users[{index}] requires non-empty username and a password string"
                )

    upload_size = None
    if scenarios["upload"]["enabled"]:
        if not upload_fixture_path:
            raise LoadProfileError("Runtime validation requires --upload-fixture")
        upload_path = Path(upload_fixture_path)
        if not upload_path.is_file():
            raise LoadProfileError("Upload fixture does not exist or is not a file")
        upload_size = upload_path.stat().st_size
        if upload_size <= 0 or upload_size > 64 * 1024 * 1024:
            raise LoadProfileError("Upload fixture must be between 1 byte and 64 MiB")

    sync_items = None
    if sync_fixture_path:
        sync_path = Path(sync_fixture_path)
        try:
            sync_payload = json.loads(sync_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise LoadProfileError("Sync fixture must be a readable JSON file") from exc
        if not isinstance(sync_payload, dict):
            raise LoadProfileError("Sync fixture root must be a JSON object")
        sync_items = sum(
            len(value) for value in sync_payload.values() if isinstance(value, list)
        )

    return {
        "validated": True,
        "distinctSessions": len(sessions),
        "distinctLoginUsers": len(login_users),
        "uploadFixtureBytes": upload_size,
        "syncFixtureItems": sync_items,
    }


def build_execution_plan(profile, *, runtime=None):
    """Build a stable, machine-readable and credential-free execution plan."""
    validate_profile(profile)
    phases = profile["phases"]
    plan = {
        "schemaVersion": PROFILE_SCHEMA_VERSION,
        "valid": True,
        "profile": profile["name"],
        "targetConcurrentActiveUsers": profile["target"]["concurrentActiveUsers"],
        "totalDurationSeconds": sum(phases[key] for key in REQUIRED_PHASES),
        "phases": dict(phases),
        "thresholds": dict(profile["thresholds"]),
        "scenarios": {},
    }
    for name, scenario in profile["scenarios"].items():
        public_scenario = {key: value for key, value in scenario.items()}
        plan["scenarios"][name] = public_scenario
    if runtime is not None:
        plan["runtimeInputs"] = dict(runtime)
    return plan
