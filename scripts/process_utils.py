"""Cross-platform helpers for shutting down test server process trees."""

from __future__ import annotations

import os
from pathlib import Path
import signal
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]


def coverage_python_prefix(environment: dict[str, str]) -> list[str]:
    """Return a Python command that records parallel subprocess coverage.

    Coverage's implicit subprocess patch is platform-dependent at interpreter
    startup.  When pytest exports a serialized child configuration, consume
    that marker and launch coverage explicitly so Linux and Windows produce
    the same integration-test evidence.
    """

    serialized_config = environment.pop("COVERAGE_PROCESS_CONFIG", None)
    if not serialized_config:
        return [sys.executable]
    return [
        sys.executable,
        "-m",
        "coverage",
        "run",
        "--parallel-mode",
        "--rcfile",
        str(ROOT / "pyproject.toml"),
    ]


def popen_group_options() -> dict[str, object]:
    """Return Popen options that isolate a disposable server process group."""

    if os.name == "nt":
        # Inherit the current console so CTRL_BREAK_EVENT can trigger Uvicorn's
        # graceful shutdown hooks, while isolating the child in its own process
        # group so the signal never targets the test runner.
        return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
    return {"start_new_session": True}


def terminate_process_tree(process: subprocess.Popen[object], timeout: float = 20) -> None:
    """Stop a disposable server and every worker it created.

    Uvicorn's multi-worker supervisor creates independent child processes on
    Windows. Terminating only the supervisor leaks workers and their database
    connections, so test and rehearsal callers must always tear down the full
    process tree.
    """

    if process.poll() is not None:
        return
    if os.name == "nt":
        try:
            process.send_signal(signal.CTRL_BREAK_EVENT)
            process.wait(timeout=min(timeout, 10))
            return
        except (OSError, subprocess.TimeoutExpired):
            # Fall back to a forced tree kill only when the console process
            # does not honor the graceful shutdown signal.
            pass
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
        return

    try:
        os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=timeout)
    except (ProcessLookupError, subprocess.TimeoutExpired):
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=5)
