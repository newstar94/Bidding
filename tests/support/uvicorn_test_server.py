"""Run a single Uvicorn test server with graceful Windows process-group exit.

The normal Uvicorn CLI does not handle ``SIGBREAK``.  Test processes use a
dedicated Windows process group so their parent can target them without
interrupting the developer's terminal.  Translating ``SIGBREAK`` into
``Server.should_exit`` lets application shutdown hooks and coverage writers
finish before the process exits.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import signal
import sys

import uvicorn


ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _flush_subprocess_coverage() -> None:
    """Persist coverage before a POSIX test server process exits.

    Uvicorn handles SIGTERM gracefully, but coverage's atexit hook is not a
    reliable synchronization boundary on every Linux runner.  The parent
    pytest process can only combine this server's parallel data after the
    server has stopped, so save the active measurement explicitly.
    """

    try:
        import coverage
    except ImportError:
        return
    active_coverage = coverage.Coverage.current()
    if active_coverage is None:
        return
    active_coverage.stop()
    active_coverage.save()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("application")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--no-access-log", action="store_true")
    arguments = parser.parse_args()

    config = uvicorn.Config(
        arguments.application,
        host=arguments.host,
        port=arguments.port,
        access_log=not arguments.no_access_log,
    )
    server = uvicorn.Server(config)

    if os.name == "nt" and hasattr(signal, "SIGBREAK"):
        signal.signal(
            signal.SIGBREAK,
            lambda _signum, _frame: setattr(server, "should_exit", True),
        )

    try:
        server.run()
    finally:
        _flush_subprocess_coverage()
    return 0 if server.started else 3


if __name__ == "__main__":
    raise SystemExit(main())
