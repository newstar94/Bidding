"""Start an isolated multi-worker stack and run the mixed load benchmark."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import threading
import time

import httpx
import psycopg


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.env_utils import load_env
from scripts.load_test import run_benchmark
from scripts.process_utils import popen_group_options, terminate_process_tree


_SAMPLE_RE = re.compile(
    r'^(?P<name>[a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(?P<labels>[^}]*)\})?\s+(?P<value>\S+)$'
)
_LABEL_RE = re.compile(r'([a-zA-Z_][a-zA-Z0-9_]*)="([^"]*)"')
_DATABASE_COUNTER_FIELDS = (
    "xact_commit",
    "xact_rollback",
    "blks_read",
    "blks_hit",
    "tup_returned",
    "tup_fetched",
    "tup_inserted",
    "tup_updated",
    "tup_deleted",
    "temp_files",
    "temp_bytes",
    "deadlocks",
    "blk_read_time",
    "blk_write_time",
    "session_time",
    "active_time",
    "idle_in_transaction_time",
    "sessions",
    "sessions_abandoned",
    "sessions_fatal",
    "sessions_killed",
)
_DISPOSABLE_DATABASE_NAME_RE = re.compile(
    r"(?:^|[_-])(load|test|bench|benchmark|rehearsal)(?:$|[_-])",
    re.IGNORECASE,
)


def _assert_port_available(host: str, port: int) -> None:
    """Fail before database mutation when the rehearsal port is already owned."""

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.bind((host, int(port)))
    except OSError as exc:
        raise RuntimeError(
            f"Load-test port {host}:{port} is already in use."
        ) from exc


def _database_identity(database_url: str) -> tuple[str, str, int]:
    with psycopg.connect(database_url, autocommit=True) as connection:
        row = connection.execute(
            """
            SELECT current_database(),
                   COALESCE(inet_server_addr()::text, 'local'),
                   current_setting('port')::integer
            """
        ).fetchone()
    return str(row[0]), str(row[1]), int(row[2])


def _validate_rehearsal_database_identity(
    load_identity: tuple[str, str, int],
    runtime_identity: tuple[str, str, int] | None,
) -> None:
    database_name = str(load_identity[0] or "")
    if runtime_identity is not None and load_identity == runtime_identity:
        raise RuntimeError(
            "LOAD_TEST_DATABASE_URL resolves to the runtime database."
        )
    if not _DISPOSABLE_DATABASE_NAME_RE.search(database_name):
        raise RuntimeError(
            "LOAD_TEST_DATABASE_URL must resolve to a disposable database "
            "whose name contains load, test, bench, benchmark, or rehearsal."
        )


def _resolve_application_root(value: str | Path | None) -> Path:
    application_root = Path(value or ROOT).expanduser().resolve()
    required_paths = (
        application_root / "backend" / "app.py",
        application_root / "dist" / "secure-build.json",
        application_root / "views",
    )
    missing = [
        path.relative_to(application_root).as_posix()
        for path in required_paths
        if not path.exists()
    ]
    if missing:
        raise RuntimeError(
            "Load-test application root is not a runnable production tree "
            f"(missing={missing})."
        )
    return application_root


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


def _parse_samples(payload: str) -> dict[tuple[str, tuple[tuple[str, str], ...]], float]:
    samples: dict[tuple[str, tuple[tuple[str, str], ...]], float] = {}
    for line in payload.splitlines():
        if not line or line.startswith("#"):
            continue
        match = _SAMPLE_RE.match(line)
        if match is None:
            continue
        labels = tuple(sorted(_LABEL_RE.findall(match.group("labels") or "")))
        try:
            value = float(match.group("value"))
        except ValueError:
            continue
        samples[(match.group("name"), labels)] = value
    return samples


async def _collect_worker_metrics(base_url: str, expected_workers: int) -> list[dict]:
    """Sample each process at least once without requiring multiprocess Prometheus."""

    snapshots: dict[str, dict] = {}
    async with httpx.AsyncClient(
        timeout=5,
        limits=httpx.Limits(
            max_connections=max(8, expected_workers * 8),
            max_keepalive_connections=0,
        ),
    ) as client:
        for _ in range(4):
            responses = await asyncio.gather(*[
                client.get(
                    f"{base_url}/metrics",
                    headers={"Connection": "close"},
                )
                for _ in range(max(8, expected_workers * 8))
            ], return_exceptions=True)
            for response in responses:
                if isinstance(response, BaseException):
                    continue
                try:
                    response.raise_for_status()
                except httpx.HTTPError:
                    continue
                samples = _parse_samples(response.text)
                process_id = samples.get(("biddingflow_process_id", ()))
                process_start = samples.get(
                    ("biddingflow_process_start_time_seconds", ())
                )
                identity = process_id if process_id is not None else process_start
                if identity is not None:
                    snapshots.setdefault(str(identity), samples)
            if len(snapshots) >= expected_workers:
                break
    return list(snapshots.values())


def _summarize_database_phases(snapshots: list[dict]) -> dict[str, dict]:
    aggregates: dict[tuple[str, str, str], dict[str, float]] = {}
    prefix = "biddingflow_database_phase_duration_seconds_"
    for samples in snapshots:
        for (name, raw_labels), value in samples.items():
            if name not in {f"{prefix}count", f"{prefix}sum"}:
                continue
            labels = dict(raw_labels)
            key = (
                labels.get("scope", "unknown"),
                labels.get("phase", "unknown"),
                labels.get("outcome", "unknown"),
            )
            field = "count" if name.endswith("_count") else "sum"
            aggregates.setdefault(key, {"count": 0.0, "sum": 0.0})[field] += value
        for (name, raw_labels), value in samples.items():
            if name != f"{prefix}max":
                continue
            labels = dict(raw_labels)
            key = (
                labels.get("scope", "unknown"),
                labels.get("phase", "unknown"),
                labels.get("outcome", "unknown"),
            )
            aggregate = aggregates.setdefault(
                key,
                {"count": 0.0, "sum": 0.0},
            )
            aggregate["max"] = max(aggregate.get("max", 0.0), value)

    result: dict[str, dict] = {}
    for (scope, phase, outcome), values in sorted(aggregates.items()):
        count = values["count"]
        result[f"{scope}.{phase}.{outcome}"] = {
            "count": int(count),
            "meanMs": round(values["sum"] * 1000 / count, 3) if count else 0.0,
            "maxMs": round(values.get("max", 0.0) * 1000, 3),
            "totalSeconds": round(values["sum"], 3),
        }
    return result


def _database_counter_snapshot(database_url: str) -> dict[str, float]:
    columns = ", ".join(_DATABASE_COUNTER_FIELDS)
    with psycopg.connect(database_url, autocommit=True) as connection:
        row = connection.execute(
            f"""
            SELECT {columns}
            FROM pg_stat_database
            WHERE datname = current_database()
            """
        ).fetchone()
    return {
        field: float(row[index] or 0)
        for index, field in enumerate(_DATABASE_COUNTER_FIELDS)
    }


def _install_statement_statistics(database_url: str) -> dict[str, object]:
    try:
        with psycopg.connect(database_url, autocommit=True) as connection:
            connection.execute("CREATE EXTENSION IF NOT EXISTS pg_stat_statements")
        return {"enabled": True}
    except psycopg.Error as exc:
        return {
            "enabled": False,
            "reason": exc.__class__.__name__,
            "sqlstate": exc.sqlstate,
        }


def _reset_statement_statistics(database_url: str, enabled: bool) -> None:
    if not enabled:
        return
    with psycopg.connect(database_url, autocommit=True) as connection:
        database_oid = connection.execute(
            "SELECT oid FROM pg_database WHERE datname = current_database()"
        ).fetchone()[0]
        connection.execute(
            "SELECT pg_stat_statements_reset(0, %s, 0)",
            (database_oid,),
        )


def _database_observability_start(database_url: str) -> dict[str, str]:
    with psycopg.connect(database_url, autocommit=True) as connection:
        wal_lsn = connection.execute(
            "SELECT pg_current_wal_lsn()::text"
        ).fetchone()[0]
    return {"walLsn": str(wal_lsn)}


def _is_observability_statement(query: str) -> bool:
    normalized = " ".join(str(query or "").casefold().split())
    return any(token in normalized for token in (
        "pg_stat_activity",
        "pg_stat_database",
        "pg_stat_statements",
        "pg_locks",
        "from pg_database",
        "pg_current_wal_lsn",
        "pg_wal_lsn_diff",
    ))


def _summarize_statement_rows(rows) -> dict[str, object]:
    statements = []
    for row in rows:
        query = " ".join(str(row[10] or "").split())[:600]
        statements.append({
            "queryId": str(row[0]),
            "calls": int(row[1] or 0),
            "totalExecMs": round(float(row[2] or 0), 3),
            "meanExecMs": round(float(row[3] or 0), 3),
            "rows": int(row[4] or 0),
            "sharedBlocksHit": int(row[5] or 0),
            "sharedBlocksRead": int(row[6] or 0),
            "tempBlocks": int(row[7] or 0),
            "walRecords": int(row[8] or 0),
            "walBytes": int(row[9] or 0),
            "query": query,
            "observability": _is_observability_statement(query),
        })
    application = [item for item in statements if not item["observability"]]
    return {
        "applicationStatementCount": len(application),
        "applicationCalls": sum(item["calls"] for item in application),
        "applicationTotalExecMs": round(
            sum(item["totalExecMs"] for item in application),
            3,
        ),
        "applicationWalBytes": sum(item["walBytes"] for item in application),
        "applicationTempBlocks": sum(item["tempBlocks"] for item in application),
        "topApplicationStatements": application[:15],
        "topWalStatements": sorted(
            application,
            key=lambda item: (item["walBytes"], item["totalExecMs"]),
            reverse=True,
        )[:15],
        "observabilityStatementCount": len(statements) - len(application),
    }


def _database_observability_finish(
    database_url: str,
    start: dict[str, str],
    statement_stats_enabled: bool,
) -> dict[str, object]:
    with psycopg.connect(database_url, autocommit=True) as connection:
        wal_bytes = connection.execute(
            "SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), %s::pg_lsn)",
            (start["walLsn"],),
        ).fetchone()[0]
        statement_summary = None
        if statement_stats_enabled:
            rows = connection.execute(
                """
                SELECT queryid::text,
                       calls,
                       total_exec_time,
                       mean_exec_time,
                       rows,
                       shared_blks_hit,
                       shared_blks_read,
                       temp_blks_read + temp_blks_written,
                       wal_records,
                       wal_bytes,
                       query
                FROM pg_stat_statements
                WHERE dbid = (
                    SELECT oid FROM pg_database
                    WHERE datname = current_database()
                )
                ORDER BY total_exec_time DESC
                """
            ).fetchall()
            statement_summary = _summarize_statement_rows(rows)
    return {
        "clusterWalBytesUpperBound": int(wal_bytes or 0),
        "statementStats": statement_summary,
    }


class _PostgresSampler:
    def __init__(self, database_url: str):
        self.database_url = database_url
        self.stop_event = threading.Event()
        self.thread = threading.Thread(
            target=self._run,
            name="load-postgres-sampler",
            daemon=True,
        )
        self.samples = 0
        self.max_connections = 0
        self.max_active = 0
        self.max_lock_waiting = 0
        self.max_locks = 0
        self.max_ungranted_locks = 0
        self.error: str | None = None

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> dict[str, int | str | None]:
        self.stop_event.set()
        self.thread.join(timeout=5)
        return {
            "samples": self.samples,
            "maxConnections": self.max_connections,
            "maxActiveConnections": self.max_active,
            "maxLockWaitingConnections": self.max_lock_waiting,
            "maxLocks": self.max_locks,
            "maxUngrantedLocks": self.max_ungranted_locks,
            "samplerError": self.error,
        }

    def _run(self) -> None:
        try:
            with psycopg.connect(
                self.database_url,
                autocommit=True,
                application_name="biddingflow-load-sampler",
            ) as connection:
                while not self.stop_event.is_set():
                    activity = connection.execute(
                        """
                        SELECT count(*),
                               count(*) FILTER (WHERE state = 'active'),
                               count(*) FILTER (
                                   WHERE state = 'active'
                                     AND wait_event_type = 'Lock'
                               )
                        FROM pg_stat_activity
                        WHERE datname = current_database()
                        """
                    ).fetchone()
                    locks = connection.execute(
                        """
                        SELECT count(*),
                               count(*) FILTER (WHERE NOT locks.granted)
                        FROM pg_locks AS locks
                        JOIN pg_database AS databases
                          ON databases.oid = locks.database
                        WHERE databases.datname = current_database()
                        """
                    ).fetchone()
                    self.samples += 1
                    self.max_connections = max(
                        self.max_connections,
                        int(activity[0] or 0),
                    )
                    self.max_active = max(
                        self.max_active,
                        int(activity[1] or 0),
                    )
                    self.max_lock_waiting = max(
                        self.max_lock_waiting,
                        int(activity[2] or 0),
                    )
                    self.max_locks = max(
                        self.max_locks,
                        int(locks[0] or 0),
                    )
                    self.max_ungranted_locks = max(
                        self.max_ungranted_locks,
                        int(locks[1] or 0),
                    )
                    self.stop_event.wait(0.1)
        except Exception as exc:
            self.error = exc.__class__.__name__


def main() -> int:
    load_env(ROOT)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=18083)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--concurrency", type=int, default=32)
    parser.add_argument("--duration", type=float, default=30)
    parser.add_argument(
        "--application-root",
        type=Path,
        default=ROOT,
        help="Runnable source or extracted production tree used by Uvicorn.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Optional JSON result path; defaults to data/logs/load-rehearsal-result.json.",
    )
    args = parser.parse_args()
    application_root = _resolve_application_root(args.application_root)
    database_url = os.environ.get("LOAD_TEST_DATABASE_URL", "").strip()
    if not database_url:
        raise RuntimeError("LOAD_TEST_DATABASE_URL is required")
    _assert_port_available("127.0.0.1", args.port)
    load_identity = _database_identity(database_url)
    runtime_url = os.environ.get("DATABASE_URL", "").strip()
    runtime_identity = _database_identity(runtime_url) if runtime_url else None
    _validate_rehearsal_database_identity(load_identity, runtime_identity)
    with psycopg.connect(database_url, autocommit=True) as connection:
        connection.execute("DROP SCHEMA IF EXISTS public CASCADE")
        connection.execute("CREATE SCHEMA public")
    statement_statistics = _install_statement_statistics(database_url)

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
            "PYTHONPATH": str(application_root),
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
            cwd=application_root,
            env=environment,
            stdout=stdout,
            stderr=stderr,
            **popen_group_options(),
        )
        try:
            _wait_ready(process, base_url)
            _reset_statement_statistics(
                database_url,
                bool(statement_statistics["enabled"]),
            )
            observability_start = _database_observability_start(database_url)
            database_before = _database_counter_snapshot(database_url)
            postgres_sampler = _PostgresSampler(database_url)
            postgres_sampler.start()
            result = asyncio.run(
                run_benchmark(base_url, args.concurrency, args.duration)
            )
            result["postgresConcurrency"] = postgres_sampler.stop()
            database_after = _database_counter_snapshot(database_url)
            result["postgresCounters"] = {
                field: round(database_after[field] - database_before[field], 3)
                for field in _DATABASE_COUNTER_FIELDS
            }
            result["databaseObservability"] = {
                **statement_statistics,
                **_database_observability_finish(
                    database_url,
                    observability_start,
                    bool(statement_statistics["enabled"]),
                ),
            }
            result["workers"] = args.workers
            result["runtimeTree"] = (
                "source" if application_root == ROOT.resolve() else "extracted-production"
            )
            metric_snapshots = asyncio.run(
                _collect_worker_metrics(
                    base_url,
                    max(1, min(16, args.workers)),
                )
            )
            result["observedWorkerMetrics"] = len(metric_snapshots)
            result["databasePhases"] = _summarize_database_phases(
                metric_snapshots
            )
            output_path = (
                args.output or (log_directory / "load-rehearsal-result.json")
            ).resolve()
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_text(
                json.dumps(result, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 1 if result["errors"] else 0
        finally:
            terminate_process_tree(process, timeout=20)


if __name__ == "__main__":
    raise SystemExit(main())
