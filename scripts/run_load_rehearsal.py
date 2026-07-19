"""Start an isolated multi-worker stack and run the mixed load benchmark."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys
import time

import httpx
import psycopg


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.load_test import _load_env, run_benchmark
from scripts.process_utils import popen_group_options, terminate_process_tree


def _wait_ready(process: subprocess.Popen, url: str) -> None:
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Load-test stack exited with {process.returncode}")
        try:
            if httpx.get(f"{url}/health/ready", timeout=1).status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.1)
    raise RuntimeError("Load-test stack did not become ready")


def main() -> int:
    _load_env()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=18083)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--concurrency", type=int, default=32)
    parser.add_argument("--duration", type=float, default=30)
    args = parser.parse_args()
    database_url = os.environ.get("LOAD_TEST_DATABASE_URL", "").strip()
    if not database_url:
        raise RuntimeError("LOAD_TEST_DATABASE_URL is required")
    with psycopg.connect(database_url, autocommit=True) as connection:
        connection.execute("DROP SCHEMA IF EXISTS public CASCADE")
        connection.execute("CREATE SCHEMA public")

    base_url = f"http://127.0.0.1:{args.port}"
    environment = os.environ.copy()
    environment.update(
        {
            "DATABASE_URL": database_url,
            "APP_ENV": "test",
            "APP_DEBUG": "False",
            "APP_SECURE_COOKIES": "False",
            "DATABASE_AUTO_MIGRATE": "true",
            "ENABLE_IMAGE_CACHE_PREWARM": "false",
            "ENABLE_PARTNER_LOOKUP_WORKER": "false",
            "BACKGROUND_STARTUP_DELAY_SECONDS": "0",
            "AUDIT_CHECKPOINT_DIR": "",
            "DATABASE_POOL_MIN_SIZE": "2",
            "DATABASE_POOL_MAX_SIZE": "8",
            "DATABASE_READ_WORKERS": "8",
            "DATABASE_READ_QUEUE": "64",
            "DATABASE_WRITE_WORKERS": "4",
            "DATABASE_WRITE_QUEUE": "64",
        }
    )
    log_directory = ROOT / "data" / "logs"
    log_directory.mkdir(parents=True, exist_ok=True)
    stdout_path = log_directory / "load-rehearsal.stdout.log"
    stderr_path = log_directory / "load-rehearsal.stderr.log"
    with stdout_path.open("w", encoding="utf-8") as stdout, stderr_path.open(
        "w", encoding="utf-8"
    ) as stderr:
        process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "backend.app:app",
                "--host",
                "127.0.0.1",
                "--port",
                str(args.port),
                "--workers",
                str(max(1, min(16, args.workers))),
                "--no-access-log",
            ],
            cwd=ROOT,
            env=environment,
            stdout=stdout,
            stderr=stderr,
            **popen_group_options(),
        )
        try:
            _wait_ready(process, base_url)
            result = asyncio.run(
                run_benchmark(base_url, args.concurrency, args.duration)
            )
            result["workers"] = args.workers
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 1 if result["errors"] else 0
        finally:
            terminate_process_tree(process, timeout=20)


if __name__ == "__main__":
    raise SystemExit(main())
