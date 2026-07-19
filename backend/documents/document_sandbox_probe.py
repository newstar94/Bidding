"""Executable production probe for the Linux document sandbox boundary."""

from __future__ import annotations

import json
import os
from pathlib import Path
import socket
import subprocess
import sys

from backend.documents.document_worker_entry import (
    _apply_resource_limits,
    _drop_privileges,
)
from backend.documents.seccomp_policy import apply_document_seccomp
from backend.shared.paths import PROJECT_ROOT


def _blocked(action) -> bool:
    try:
        action()
    except (OSError, PermissionError, RuntimeError):
        return True
    return False


def _effective_capabilities_are_empty() -> bool:
    try:
        for line in Path("/proc/self/status").read_text(
            encoding="utf-8", errors="replace"
        ).splitlines():
            if line.startswith("CapEff:"):
                return int(line.split(":", 1)[1].strip(), 16) == 0
    except (OSError, ValueError):
        return False
    return False


def main() -> int:
    if len(sys.argv) != 2:
        return 2
    result_path = Path(sys.argv[1]).resolve()
    job_dir = Path(os.environ["DOCUMENT_WORKER_JOB_DIR"]).resolve()
    if result_path.parent != job_dir:
        return 3

    _apply_resource_limits()
    _drop_privileges()
    apply_document_seccomp(required=True)

    checks = {
        "network_socket_blocked": _blocked(
            lambda: socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        ),
        "unix_socket_blocked": _blocked(
            lambda: socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        ),
        "child_process_blocked": _blocked(
            lambda: subprocess.run(
                [sys.executable, "-c", "pass"],
                check=False,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        ),
        "project_env_hidden": _blocked(
            lambda: (PROJECT_ROOT / ".env").read_bytes()
        ),
        "database_secret_absent": not os.environ.get("DATABASE_URL"),
        "capabilities_empty": _effective_capabilities_are_empty(),
        "sandbox_uid_isolated": (
            not hasattr(os, "geteuid")
            or os.geteuid()
            == int(os.environ.get("DOCUMENT_WORKER_SANDBOX_UID", "65534"))
        ),
    }
    result_path.write_text(
        json.dumps(checks, separators=(",", ":"), sort_keys=True),
        encoding="utf-8",
    )
    return 0 if all(checks.values()) else 5


if __name__ == "__main__":
    raise SystemExit(main())
