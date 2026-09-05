"""Verify the deployed document-worker boundary and emit release evidence.

Run this command as root on a Linux staging/production-equivalent host after
the web and document-worker units are active.  The evidence intentionally
contains no environment values, database URL, credentials or process command
line.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
try:
    import grp
    import pwd
except ImportError:  # pragma: no cover - the deployment verifier is Linux-only.
    grp = None  # type: ignore[assignment]
    pwd = None  # type: ignore[assignment]
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
import stat
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.db.db_helper import PostgresDatabase
from scripts.run_document_worker import (
    _validate_database_boundary,
    _validate_document_worker_database_url,
    _validate_worker_secret_boundary,
)


WORKER_PROPERTIES = (
    "ActiveState",
    "SubState",
    "MainPID",
    "User",
    "Group",
    "FragmentPath",
    "EnvironmentFiles",
    "NoNewPrivileges",
    "CapabilityBoundingSet",
    "AmbientCapabilities",
    "PrivateDevices",
    "PrivateTmp",
    "ProtectHome",
    "ProtectSystem",
    "ProtectProc",
    "ProcSubset",
    "KillMode",
    "RestrictAddressFamilies",
    "IPAddressDeny",
    "IPAddressAllow",
    "ReadWritePaths",
    "CPUQuotaPerSecUSec",
    "MemoryMax",
    "TasksMax",
    "LimitNOFILE",
    "LimitFSIZE",
)
WEB_PROPERTIES = (
    "ActiveState",
    "SubState",
    "MainPID",
    "User",
    "Group",
    "SupplementaryGroups",
    "BindsTo",
)
REQUIRED_WORKER_ENVIRONMENT = {
    "APP_ENV": "production",
    "DOCUMENT_WORKER_EXECUTION_MODE": "external",
    "DOCUMENT_WORKER_SERVICE_USER": "biddingflow-document-worker",
    "DOCUMENT_WORKER_SERVICE_GROUP": "biddingflow-documents",
    "DATABASE_DOCUMENT_WORKER_ROLE": "biddingflow_document_worker",
    "DOCUMENT_WORKER_SERVICE_ACCOUNT_CONFIRMED": "true",
    "DOCUMENT_WORKER_SHARED_STORAGE_CONFIRMED": "true",
    "DOCUMENT_WORKER_SANDBOX": "bwrap",
    "DOCUMENT_WORKER_REQUIRE_PRIVILEGE_DROP": "true",
}
FORBIDDEN_WORKER_ENVIRONMENT_NAMES = {
    "DATABASE_URL",
    "RUNTIME_DATABASE_URL",
    "MIGRATOR_DATABASE_URL",
    "DATABASE_ADMIN_URL",
    "BACKUP_DATABASE_URL",
    "DATABASE_RUNTIME_PASSWORD",
    "DATABASE_MIGRATOR_PASSWORD",
    "DATABASE_ADMIN_PASSWORD",
    "DATABASE_BACKUP_PASSWORD",
    "DATABASE_DOCUMENT_WORKER_PASSWORD",
    "SMTP_PASSWORD",
    "GOOGLE_CLIENT_SECRET",
    "AUDIT_CHECKPOINT_HMAC_KEY",
    "EMAIL_OUTBOX_ENCRYPTION_KEY",
    "BIDDING_RESTORE_DRILL_PRIVATE_KEY",
}
_ENVIRONMENT_NAME = re.compile(r"^[A-Z][A-Z0-9_]*$")


class VerificationError(RuntimeError):
    """Raised when a deployment boundary is missing or weaker than required."""


def _posix_accounts():
    if grp is None or pwd is None:
        raise VerificationError("POSIX account APIs are required on the staging host.")
    return grp, pwd


def _run(command: list[str], *, timeout: int = 30) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise VerificationError(f"Cannot execute required verifier command: {command[0]}") from exc


def _systemd_properties(unit: str, names: tuple[str, ...]) -> dict[str, str]:
    completed = _run(["systemctl", "show", unit, *[f"--property={name}" for name in names]])
    if completed.returncode != 0:
        raise VerificationError(f"Cannot inspect systemd unit {unit}.")
    properties: dict[str, str] = {}
    for line in completed.stdout.splitlines():
        if "=" not in line:
            continue
        name, value = line.split("=", 1)
        properties[name] = value.strip()
    missing = sorted(set(names) - properties.keys())
    if missing:
        raise VerificationError(f"Systemd did not return required properties for {unit}: {missing}")
    return properties


def _require_equal(properties: dict[str, str], expected: dict[str, str]) -> None:
    mismatches = {
        name: {"expected": value, "actual": properties.get(name, "")}
        for name, value in expected.items()
        if properties.get(name, "").casefold() != value.casefold()
    }
    if mismatches:
        raise VerificationError(f"Systemd hardening mismatch: {json.dumps(mismatches, sort_keys=True)}")


def _systemd_number(value: str, property_name: str) -> int:
    normalized = value.strip()
    if normalized.casefold() in {"", "infinity", "infinite", "max"}:
        raise VerificationError(f"{property_name} must have a finite limit.")
    duration_match = re.fullmatch(r"([0-9]+(?:\.[0-9]+)?)(us|ms|s|min|h)?", normalized)
    if not duration_match:
        raise VerificationError(f"Cannot parse systemd value for {property_name}.")
    amount = float(duration_match.group(1))
    unit = duration_match.group(2)
    if property_name == "CPUQuotaPerSecUSec":
        multiplier = {None: 1, "us": 1, "ms": 1_000, "s": 1_000_000, "min": 60_000_000, "h": 3_600_000_000}[unit]
        return int(amount * multiplier)
    if unit is not None:
        raise VerificationError(f"Unexpected unit for {property_name}.")
    return int(amount)


def validate_worker_unit_properties(
    worker: dict[str, str],
    web: dict[str, str],
    *,
    exchange_root: Path,
    environment_file: Path,
    database_environment_file: Path,
) -> tuple[int, int]:
    _require_equal(
        worker,
        {
            "ActiveState": "active",
            "SubState": "running",
            "User": "biddingflow-document-worker",
            "Group": "biddingflow-documents",
            "NoNewPrivileges": "yes",
            "PrivateDevices": "yes",
            "PrivateTmp": "yes",
            "ProtectHome": "yes",
            "ProtectSystem": "strict",
            "ProtectProc": "invisible",
            "ProcSubset": "pid",
            "KillMode": "control-group",
        },
    )
    if worker["CapabilityBoundingSet"] or worker["AmbientCapabilities"]:
        raise VerificationError("Document worker must have an empty capability set.")
    address_families = set(worker["RestrictAddressFamilies"].split())
    if address_families != {"AF_UNIX", "AF_INET", "AF_INET6"}:
        raise VerificationError("Document worker address families are not restricted as required.")
    if "any" not in worker["IPAddressDeny"].casefold().split():
        raise VerificationError("Document worker must deny all IP addresses by default.")
    allowed_networks = worker["IPAddressAllow"].casefold()
    for required in ("localhost", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fd00::/8"):
        if required not in allowed_networks:
            raise VerificationError(f"Document worker is missing private IP allow rule: {required}")
    writable_paths = worker["ReadWritePaths"].split()
    expected_root = str(exchange_root.resolve())
    normalized_paths = {item.lstrip("-+") for item in writable_paths}
    if normalized_paths != {expected_root}:
        raise VerificationError("Document worker may write outside the exchange root.")
    environment_files = worker["EnvironmentFiles"]
    for required_file in (environment_file, database_environment_file):
        if str(required_file.resolve()) not in environment_files:
            raise VerificationError("Document worker is not using every verified environment file.")
    if _systemd_number(worker["CPUQuotaPerSecUSec"], "CPUQuotaPerSecUSec") > 2_000_000:
        raise VerificationError("Document worker CPUQuota exceeds 200%.")
    limits = {
        "MemoryMax": 2 * 1024 * 1024 * 1024,
        "TasksMax": 64,
        "LimitNOFILE": 512,
        "LimitFSIZE": 128 * 1024 * 1024,
    }
    for name, maximum in limits.items():
        value = _systemd_number(worker[name], name)
        if value <= 0 or value > maximum:
            raise VerificationError(f"{name} is absent or weaker than the release limit.")
    _require_equal(web, {"ActiveState": "active", "SubState": "running", "User": "biddingflow"})
    if worker["User"] == web["User"] or worker["Group"] == web["Group"]:
        raise VerificationError("Web and document worker must not share their primary identity.")
    if "biddingflow-documents" not in web["SupplementaryGroups"].split():
        raise VerificationError("Web service is missing the document exchange supplementary group.")
    if "biddingflow-document-worker.service" not in web["BindsTo"].split():
        raise VerificationError("Web service must fail closed when document worker stops.")
    try:
        worker_pid = int(worker["MainPID"])
        web_pid = int(web["MainPID"])
    except ValueError as exc:
        raise VerificationError("Systemd returned an invalid service PID.") from exc
    if worker_pid <= 1 or web_pid <= 1 or worker_pid == web_pid:
        raise VerificationError("Web and document worker require distinct active processes.")
    return worker_pid, web_pid


def _secure_regular_file(path: Path, *, mode: int, owner_uid: int, owner_gid: int) -> os.stat_result:
    try:
        details = path.lstat()
    except OSError as exc:
        raise VerificationError(f"Required protected file is unavailable: {path}") from exc
    if stat.S_ISLNK(details.st_mode) or not stat.S_ISREG(details.st_mode):
        raise VerificationError(f"Protected path must be a regular non-symlink file: {path}")
    if stat.S_IMODE(details.st_mode) != mode or details.st_uid != owner_uid or details.st_gid != owner_gid:
        raise VerificationError(f"Protected file ownership or mode is unsafe: {path}")
    return details


def parse_environment_file(path: Path) -> dict[str, str]:
    _secure_regular_file(path, mode=0o600, owner_uid=0, owner_gid=0)
    try:
        content = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise VerificationError("Cannot read the document-worker environment file.") from exc
    environment: dict[str, str] = {}
    for number, raw_line in enumerate(content.splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export ") or "=" not in line:
            raise VerificationError(f"Unsupported environment syntax at line {number}.")
        name, raw_value = line.split("=", 1)
        name = name.strip()
        value = raw_value.strip()
        if not _ENVIRONMENT_NAME.fullmatch(name) or name in environment:
            raise VerificationError(f"Invalid or duplicate environment name at line {number}.")
        if value[:1] in {"'", '"'}:
            if len(value) < 2 or value[-1] != value[0]:
                raise VerificationError(f"Unterminated environment value at line {number}.")
            value = value[1:-1]
        if "\x00" in value or "\n" in value or "\r" in value:
            raise VerificationError(f"Unsafe environment value at line {number}.")
        environment[name] = value
    return environment


def validate_worker_environment(environment: dict[str, str]) -> None:
    missing = {
        name: expected
        for name, expected in REQUIRED_WORKER_ENVIRONMENT.items()
        if environment.get(name, "").casefold() != expected.casefold()
    }
    if missing:
        raise VerificationError(f"Worker environment is missing required production settings: {sorted(missing)}")
    forbidden = sorted(FORBIDDEN_WORKER_ENVIRONMENT_NAMES.intersection(environment))
    if forbidden:
        raise VerificationError(f"Worker environment contains forbidden application secrets: {forbidden}")
    _validate_worker_secret_boundary(environment)
    database_url = environment.get("DOCUMENT_WORKER_DATABASE_URL", "")
    if not database_url:
        raise VerificationError("DOCUMENT_WORKER_DATABASE_URL is required.")
    try:
        _validate_document_worker_database_url(database_url, environment)
    except RuntimeError as exc:
        raise VerificationError(str(exc)) from exc
    try:
        shared_gid = int(environment.get("DOCUMENT_WORKER_SHARED_GID", "0"))
    except ValueError as exc:
        raise VerificationError("DOCUMENT_WORKER_SHARED_GID must be numeric.") from exc
    group_api, account_api = _posix_accounts()
    expected_gid = group_api.getgrnam(environment["DOCUMENT_WORKER_SERVICE_GROUP"]).gr_gid
    if shared_gid <= 0 or shared_gid != expected_gid:
        raise VerificationError("DOCUMENT_WORKER_SHARED_GID does not match the service group.")
    sandbox_uid = int(environment.get("DOCUMENT_WORKER_SANDBOX_UID", "0") or 0)
    sandbox_gid = int(environment.get("DOCUMENT_WORKER_SANDBOX_GID", "0") or 0)
    service_uid = account_api.getpwnam(environment["DOCUMENT_WORKER_SERVICE_USER"]).pw_uid
    if sandbox_uid <= 0 or sandbox_gid <= 0 or sandbox_uid == service_uid or sandbox_gid == shared_gid:
        raise VerificationError("Parser sandbox identity is not isolated from the daemon identity.")


def _proc_environment(pid: int) -> dict[str, str]:
    try:
        payload = Path(f"/proc/{pid}/environ").read_bytes()
    except OSError as exc:
        raise VerificationError(f"Cannot inspect environment for PID {pid}.") from exc
    result: dict[str, str] = {}
    for item in payload.split(b"\0"):
        if not item or b"=" not in item:
            continue
        name, value = item.split(b"=", 1)
        result[name.decode("utf-8", errors="replace")] = value.decode("utf-8", errors="replace")
    return result


def _proc_identity(pid: int) -> tuple[set[int], set[int], set[int]]:
    try:
        lines = Path(f"/proc/{pid}/status").read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise VerificationError(f"Cannot inspect identity for PID {pid}.") from exc
    fields = {line.split(":", 1)[0]: line.split(":", 1)[1].strip() for line in lines if ":" in line}
    try:
        uids = {int(value) for value in fields["Uid"].split()}
        gids = {int(value) for value in fields["Gid"].split()}
        groups = {int(value) for value in fields.get("Groups", "").split()}
    except (KeyError, ValueError) as exc:
        raise VerificationError(f"Invalid process identity data for PID {pid}.") from exc
    return uids, gids, groups


def validate_process_boundaries(worker_pid: int, web_pid: int, environment: dict[str, str]) -> None:
    group_api, account_api = _posix_accounts()
    worker_uid = account_api.getpwnam(environment["DOCUMENT_WORKER_SERVICE_USER"]).pw_uid
    worker_gid = group_api.getgrnam(environment["DOCUMENT_WORKER_SERVICE_GROUP"]).gr_gid
    web_uid = account_api.getpwnam("biddingflow").pw_uid
    web_gid = group_api.getgrnam("biddingflow").gr_gid
    worker_uids, worker_gids, worker_groups = _proc_identity(worker_pid)
    web_uids, web_gids, web_groups = _proc_identity(web_pid)
    if worker_uids != {worker_uid} or worker_gids != {worker_gid}:
        raise VerificationError("Running document worker has the wrong OS identity.")
    if web_uids != {web_uid} or web_gids != {web_gid}:
        raise VerificationError("Running web service has the wrong OS identity.")
    if web_gid in worker_groups or worker_uid == web_uid:
        raise VerificationError("Document worker inherited the web-service identity.")
    if worker_gid not in web_groups:
        raise VerificationError("Web process cannot access the document exchange group.")
    worker_environment = _proc_environment(worker_pid)
    web_environment = _proc_environment(web_pid)
    forbidden = sorted(FORBIDDEN_WORKER_ENVIRONMENT_NAMES.intersection(worker_environment))
    if forbidden:
        raise VerificationError(f"Running document worker received forbidden secrets: {forbidden}")
    if "DOCUMENT_WORKER_DATABASE_URL" not in worker_environment:
        raise VerificationError("Running document worker is missing its scoped database URL.")
    if "DOCUMENT_WORKER_DATABASE_URL" in web_environment:
        raise VerificationError("Web process received the document-worker database credential.")


def validate_exchange_root(path: Path, environment: dict[str, str]) -> None:
    try:
        details = path.lstat()
    except OSError as exc:
        raise VerificationError("Document exchange root is unavailable.") from exc
    if stat.S_ISLNK(details.st_mode) or not stat.S_ISDIR(details.st_mode):
        raise VerificationError("Document exchange root must be a non-symlink directory.")
    group_api, account_api = _posix_accounts()
    expected_owner = account_api.getpwnam("biddingflow").pw_uid
    expected_group = group_api.getgrnam(environment["DOCUMENT_WORKER_SERVICE_GROUP"]).gr_gid
    if details.st_uid != expected_owner or details.st_gid != expected_group:
        raise VerificationError("Document exchange root has incorrect ownership.")
    if stat.S_IMODE(details.st_mode) != 0o770:
        raise VerificationError("Document exchange root must have mode 0770.")


def validate_apparmor_profile() -> None:
    enabled_path = Path("/sys/module/apparmor/parameters/enabled")
    profiles_path = Path("/sys/kernel/security/apparmor/profiles")
    try:
        enabled = enabled_path.read_text(encoding="ascii").strip().casefold()
        profiles = profiles_path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        raise VerificationError("AppArmor status cannot be verified.") from exc
    if enabled not in {"y", "yes", "1"}:
        raise VerificationError("AppArmor is not enabled.")
    if "/usr/bin/bwrap" not in profiles or "enforce" not in profiles:
        raise VerificationError("The enforced Bubblewrap AppArmor profile is not loaded.")


def validate_database_host_is_private(database_url: str) -> None:
    hostname = urlsplit(database_url).hostname
    if not hostname:
        raise VerificationError("Document-worker database hostname is missing.")
    try:
        addresses = {entry[4][0] for entry in socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)}
    except OSError as exc:
        raise VerificationError("Document-worker database hostname cannot be resolved.") from exc
    if not addresses:
        raise VerificationError("Document-worker database hostname resolved to no address.")
    for address in addresses:
        parsed = ipaddress.ip_address(address.split("%", 1)[0])
        if not (parsed.is_private or parsed.is_loopback):
            raise VerificationError("Document-worker database must resolve only to private addresses.")


def validate_database_role(database_url: str) -> str:
    database = PostgresDatabase(database_url)
    database.open(wait=True)
    try:
        return _validate_database_boundary(database)
    finally:
        database.close()


def run_sandbox_probe_as_service_user(
    environment: dict[str, str],
    *,
    python_executable: Path,
    release_root: Path,
) -> None:
    if not python_executable.is_file():
        raise VerificationError("Production Python interpreter is unavailable.")
    forwarded_names = (
        "DOCUMENT_WORKER_TEMP_DIR",
        "DOCUMENT_WORKER_SANDBOX",
        "DOCUMENT_WORKER_SANDBOX_EXECUTABLE",
        "DOCUMENT_WORKER_REQUIRE_PRIVILEGE_DROP",
        "DOCUMENT_WORKER_SANDBOX_UID",
        "DOCUMENT_WORKER_SANDBOX_GID",
        "DOCUMENT_WORKER_CPU_SECONDS",
        "DOCUMENT_WORKER_MAX_MEMORY_MB",
        "DOCUMENT_WORKER_MAX_OUTPUT_MB",
    )
    clean_environment = ["APP_ENV=production", "PATH=/usr/sbin:/usr/bin:/sbin:/bin"]
    clean_environment.extend(
        f"{name}={environment[name]}" for name in forwarded_names if environment.get(name)
    )
    completed = _run(
        [
            "runuser",
            "--user",
            environment["DOCUMENT_WORKER_SERVICE_USER"],
            "--group",
            environment["DOCUMENT_WORKER_SERVICE_GROUP"],
            "--",
            "/usr/bin/env",
            "-i",
            *clean_environment,
            str(python_executable),
            str(release_root / "scripts" / "verify_document_sandbox.py"),
        ],
        timeout=45,
    )
    if completed.returncode != 0 or "Document sandbox probe passed:" not in completed.stdout:
        raise VerificationError("Sandbox probe failed under the deployed service identity.")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_evidence(path: Path, evidence: dict[str, object]) -> None:
    path = path.resolve()
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    payload = (json.dumps(evidence, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary_path = Path(temporary_name)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "wb") as target:
            target.write(payload)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary_path, path)
        path.chmod(0o600)
    finally:
        temporary_path.unlink(missing_ok=True)


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worker-unit", default="biddingflow-document-worker.service")
    parser.add_argument("--web-unit", default="biddingflow.service")
    parser.add_argument("--environment-file", type=Path, default=Path("/etc/biddingflow/document-worker.env"))
    parser.add_argument(
        "--database-environment-file",
        type=Path,
        default=Path("/etc/biddingflow/database-document-worker.env"),
    )
    parser.add_argument("--release-root", type=Path, default=Path("/opt/biddingflow"))
    parser.add_argument("--exchange-root", type=Path, default=Path("/var/lib/biddingflow-document-jobs"))
    parser.add_argument("--python", type=Path, default=Path("/opt/biddingflow/.venv/bin/python"))
    parser.add_argument("--evidence", type=Path, required=True)
    return parser.parse_args()


def main() -> int:
    arguments = _arguments()
    if sys.platform != "linux" or not hasattr(os, "geteuid"):
        print("Document-worker deployment verification requires Linux.", file=sys.stderr)
        return 2
    if os.geteuid() != 0:
        print("Document-worker deployment verification must run as root.", file=sys.stderr)
        return 2
    release_root = arguments.release_root.resolve()
    environment_file = arguments.environment_file.resolve()
    database_environment_file = arguments.database_environment_file.resolve()
    exchange_root = arguments.exchange_root.resolve()
    if (release_root / ".env").exists():
        print("Release root must not contain .env.", file=sys.stderr)
        return 1
    try:
        environment = parse_environment_file(environment_file)
        database_environment = parse_environment_file(database_environment_file)
        duplicates = sorted(environment.keys() & database_environment.keys())
        if duplicates:
            raise VerificationError(
                f"Document-worker environment files contain duplicate settings: {duplicates}"
            )
        environment.update(database_environment)
        validate_worker_environment(environment)
        worker = _systemd_properties(arguments.worker_unit, WORKER_PROPERTIES)
        web = _systemd_properties(arguments.web_unit, WEB_PROPERTIES)
        worker_pid, web_pid = validate_worker_unit_properties(
            worker,
            web,
            exchange_root=exchange_root,
            environment_file=environment_file,
            database_environment_file=database_environment_file,
        )
        validate_process_boundaries(worker_pid, web_pid, environment)
        validate_exchange_root(exchange_root, environment)
        validate_apparmor_profile()
        validate_database_host_is_private(environment["DOCUMENT_WORKER_DATABASE_URL"])
        role = validate_database_role(environment["DOCUMENT_WORKER_DATABASE_URL"])
        run_sandbox_probe_as_service_user(
            environment,
            python_executable=arguments.python.resolve(),
            release_root=release_root,
        )
        worker_fragment = Path(worker["FragmentPath"]).resolve()
        _secure_regular_file(worker_fragment, mode=0o644, owner_uid=0, owner_gid=0)
        evidence = {
            "formatVersion": 1,
            "result": "passed",
            "verifiedAtUtc": datetime.now(timezone.utc).isoformat(),
            "host": socket.gethostname(),
            "kernel": os.uname().release,
            "releaseRoot": str(release_root),
            "workerUnit": arguments.worker_unit,
            "webUnit": arguments.web_unit,
            "workerPid": worker_pid,
            "webPid": web_pid,
            "workerUser": worker["User"],
            "workerGroup": worker["Group"],
            "databaseRole": role,
            "workerUnitSha256": _sha256(worker_fragment),
            "checks": [
                "systemd-hardening",
                "dedicated-process-identities",
                "secret-separation",
                "protected-environment-file",
                "exchange-root-permissions",
                "apparmor-enforced",
                "private-postgresql-tls",
                "postgresql-least-privilege",
                "sandbox-runtime-probe",
            ],
        }
        _write_evidence(arguments.evidence, evidence)
    except (KeyError, ValueError, OSError, VerificationError, RuntimeError) as exc:
        print(f"Document-worker deployment verification failed: {exc}", file=sys.stderr)
        return 1
    print(f"Document-worker deployment verification passed. Evidence: {arguments.evidence.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
