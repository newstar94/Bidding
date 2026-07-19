"""OS-level command isolation for one document worker process."""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import sys

from backend.documents.seccomp_policy import seccomp_library_name
from backend.shared.paths import PROJECT_ROOT


def configured_sandbox_mode(environ=None) -> str:
    environment = os.environ if environ is None else environ
    default = "windows_job" if os.name == "nt" else "process"
    return str(environment.get("DOCUMENT_WORKER_SANDBOX", default)).strip().casefold()


def _directory_creation_args(paths: list[Path]) -> list[str]:
    created = {Path("/")}
    arguments: list[str] = []
    for path in sorted(paths, key=lambda value: (len(value.parts), str(value))):
        current = Path("/")
        for part in path.parts[1:]:
            current /= part
            if current not in created:
                arguments.extend(["--dir", str(current)])
                created.add(current)
    return arguments


def _sandbox_identity(environment: dict[str, str]) -> tuple[str, str]:
    values = []
    for name in ("DOCUMENT_WORKER_SANDBOX_UID", "DOCUMENT_WORKER_SANDBOX_GID"):
        raw_value = str(environment.get(name, "65534")).strip()
        try:
            value = int(raw_value)
        except ValueError as exc:
            raise RuntimeError(f"{name} must be an integer.") from exc
        if not 1 <= value <= 2_147_483_647:
            raise RuntimeError(f"{name} must be a non-root numeric identity.")
        values.append(str(value))
    return values[0], values[1]


def _validate_distinct_sandbox_identity(
    environment: dict[str, str],
    *,
    parent_uid: int,
    parent_gid: int,
) -> tuple[str, str]:
    """Require a document identity distinct from the web service identity."""

    sandbox_uid, sandbox_gid = _sandbox_identity(environment)
    if int(sandbox_uid) == int(parent_uid):
        raise RuntimeError(
            "DOCUMENT_WORKER_SANDBOX_UID must differ from the web service UID."
        )
    if int(sandbox_gid) == int(parent_gid):
        raise RuntimeError(
            "DOCUMENT_WORKER_SANDBOX_GID must differ from the web service GID."
        )
    return sandbox_uid, sandbox_gid


def build_bwrap_command(
    command: list[str],
    job_dir: Path,
    environment: dict[str, str],
    *,
    executable: str,
) -> list[str]:
    """Build an empty-root Bubblewrap sandbox without mounting project secrets."""

    job_dir = job_dir.resolve()
    backend_source = (PROJECT_ROOT / "backend").resolve()
    read_only_roots: list[Path] = []
    for candidate in (
        Path("/usr"),
        Path("/lib"),
        Path("/lib64"),
        Path(sys.prefix).resolve(),
        Path(sys.base_prefix).resolve(),
    ):
        if candidate.exists() and not any(candidate == root or root in candidate.parents for root in read_only_roots):
            read_only_roots.append(candidate)
    if not backend_source.is_dir():
        raise RuntimeError("Document worker backend source is missing.")
    sandbox_uid, sandbox_gid = _sandbox_identity(environment)

    mount_destinations = [root for root in read_only_roots] + [backend_source, job_dir]
    arguments = [
        executable,
        "--die-with-parent",
        "--new-session",
        "--unshare-user",
        "--unshare-ipc",
        "--unshare-pid",
        "--unshare-net",
        "--unshare-uts",
        "--unshare-cgroup-try",
        "--disable-userns",
        "--uid",
        sandbox_uid,
        "--gid",
        sandbox_gid,
        "--cap-drop",
        "ALL",
        "--clearenv",
    ]
    arguments.extend(_directory_creation_args(mount_destinations))
    for root in read_only_roots:
        arguments.extend(["--ro-bind", str(root), str(root)])
    arguments.extend(["--ro-bind", str(backend_source), str(backend_source)])
    arguments.extend(["--bind", str(job_dir), str(job_dir)])
    arguments.extend(["--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp"])
    for key, value in sorted(environment.items()):
        arguments.extend(["--setenv", key, value])
    arguments.extend(["--chdir", str(job_dir), "--"])
    arguments.extend(command)
    return arguments


def sandbox_worker_command(command: list[str], job_dir: Path, environment: dict[str, str]) -> list[str]:
    mode = configured_sandbox_mode()
    if mode == "bwrap":
        executable = os.environ.get("DOCUMENT_WORKER_SANDBOX_EXECUTABLE", "").strip() or shutil.which("bwrap")
        if not executable:
            raise RuntimeError("Bubblewrap is required for the configured document worker sandbox.")
        return build_bwrap_command(command, job_dir, environment, executable=executable)
    if mode in {"process", "windows_job"}:
        return command
    raise RuntimeError("Unsupported document worker sandbox mode.")


def validate_document_sandbox_configuration(environ=None) -> None:
    environment = os.environ if environ is None else environ
    production = str(environment.get("APP_ENV", "development")).strip().casefold() in {"prod", "production"}
    if not production:
        return
    mode = configured_sandbox_mode(environment)
    if os.name == "posix":
        if mode != "bwrap":
            raise RuntimeError("Production document workers require DOCUMENT_WORKER_SANDBOX=bwrap.")
        executable = str(environment.get("DOCUMENT_WORKER_SANDBOX_EXECUTABLE", "")).strip() or shutil.which("bwrap")
        if not executable or not Path(executable).is_file():
            raise RuntimeError("Production document workers require an installed Bubblewrap executable.")
        _validate_distinct_sandbox_identity(
            dict(environment),
            parent_uid=os.geteuid(),
            parent_gid=os.getegid(),
        )
        if not seccomp_library_name():
            raise RuntimeError("Production document workers require libseccomp.")
    elif os.name == "nt":
        if mode != "windows_job":
            raise RuntimeError("Production Windows document workers require DOCUMENT_WORKER_SANDBOX=windows_job.")
        required = (
            "DOCUMENT_WORKER_SERVICE_ACCOUNT_CONFIRMED",
            "DOCUMENT_WORKER_NETWORK_ISOLATION_CONFIRMED",
        )
        missing = [name for name in required if str(environment.get(name, "")).strip().casefold() != "true"]
        if missing:
            raise RuntimeError("Missing production document-worker isolation attestation: " + ", ".join(missing))
