"""Run the real Linux Bubblewrap/seccomp isolation probe before deployment."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

# Direct execution sets ``sys.path[0]`` to ``scripts/`` on Linux. Add the
# immutable repository root before importing the worker modules so the same
# command used by systemd/CI behaves consistently across platforms.
REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))

from backend.documents.document_sandbox import (
    build_bwrap_command,
    validate_document_sandbox_configuration,
)
from backend.documents.seccomp_policy import seccomp_library_name
from backend.shared.paths import PROJECT_ROOT


def main() -> int:
    if os.name != "posix":
        print("Document sandbox probe requires Linux/POSIX.", file=sys.stderr)
        return 2
    environment = os.environ.copy()
    environment["APP_ENV"] = "production"
    environment["DOCUMENT_WORKER_SANDBOX"] = "bwrap"
    environment["DOCUMENT_WORKER_REQUIRE_PRIVILEGE_DROP"] = "true"
    environment.setdefault("DOCUMENT_WORKER_SANDBOX_UID", "65534")
    environment.setdefault("DOCUMENT_WORKER_SANDBOX_GID", "65534")
    validate_document_sandbox_configuration(environment)

    executable = (
        environment.get("DOCUMENT_WORKER_SANDBOX_EXECUTABLE", "").strip()
        or shutil.which("bwrap")
    )
    if not executable:
        print("Bubblewrap is not installed.", file=sys.stderr)
        return 2
    library_name = seccomp_library_name()
    if not library_name:
        print("libseccomp is not installed.", file=sys.stderr)
        return 2

    temp_root = Path(
        environment.get("DOCUMENT_WORKER_TEMP_DIR", "/var/tmp/biddingflow-document-worker")
    )
    temp_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.TemporaryDirectory(prefix="probe-", dir=temp_root) as raw_job_dir:
        job_dir = Path(raw_job_dir).resolve()
        job_dir.chmod(0o700)
        result_path = job_dir / "probe-result.json"
        worker_environment = {
            "APP_ENV": "production",
            "DOCUMENT_WORKER_CPU_SECONDS": "10",
            "DOCUMENT_WORKER_JOB_DIR": str(job_dir),
            "DOCUMENT_WORKER_MAX_MEMORY_MB": "256",
            "DOCUMENT_WORKER_MAX_OUTPUT_MB": "8",
            "DOCUMENT_WORKER_PARENT_GID": str(os.getegid()),
            "DOCUMENT_WORKER_PARENT_UID": str(os.geteuid()),
            "DOCUMENT_WORKER_REQUIRE_PRIVILEGE_DROP": "true",
            "DOCUMENT_WORKER_SECCOMP_LIBRARY": library_name,
            "DOCUMENT_WORKER_SANDBOX_UID": environment["DOCUMENT_WORKER_SANDBOX_UID"],
            "DOCUMENT_WORKER_SANDBOX_GID": environment["DOCUMENT_WORKER_SANDBOX_GID"],
            "PATH": environment.get("PATH", "/usr/bin:/bin"),
            "PYTHONIOENCODING": "utf-8",
            "PYTHONPATH": str(PROJECT_ROOT),
            "PYTHONUNBUFFERED": "1",
        }
        command = build_bwrap_command(
            [
                sys.executable,
                "-m",
                "backend.documents.document_sandbox_probe",
                str(result_path),
            ],
            job_dir,
            worker_environment,
            executable=executable,
        )
        completed = subprocess.run(
            command,
            cwd=job_dir,
            env=worker_environment,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=20,
            check=False,
        )
        if completed.returncode != 0 or not result_path.is_file():
            print(
                "Document sandbox probe failed: "
                + completed.stderr.decode("utf-8", errors="replace")[:1000],
                file=sys.stderr,
            )
            return 1
        checks = json.loads(result_path.read_text(encoding="utf-8"))
        if not isinstance(checks, dict) or not checks or not all(checks.values()):
            print(f"Document sandbox checks failed: {checks}", file=sys.stderr)
            return 1
        print("Document sandbox probe passed: " + ", ".join(sorted(checks)))
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
