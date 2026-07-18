"""Exercise bounded PostgreSQL pools with a reproducible mixed workload."""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import copy
import json
import os
from pathlib import Path
import statistics
import sys
import time
import uuid


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.db.postgresql import PostgreSQLDatabase
from backend.db.postgresql_migrations import initialize_postgresql_database
from scripts.benchmark_postgresql_queries import _database_url, _seed


DEFAULT_BUDGET_PATH = PROJECT_ROOT / "load" / "postgresql-pool-budgets.json"
SCRATCH_PREFIX = "bidding_pool_benchmark_"


def percentile(values, percentile_value):
    ordered = sorted(float(value) for value in values)
    if not ordered:
        return 0.0
    rank = max(0, min(len(ordered) - 1, int(len(ordered) * percentile_value) - 1))
    return round(ordered[rank], 3)


def evaluate_pool_result(result, thresholds):
    failures = []
    if result["errorRate"] > float(thresholds["maxErrorRate"]):
        failures.append(
            f"pool {result['poolSize']}: error rate {result['errorRate']} exceeds "
            f"{thresholds['maxErrorRate']}"
        )
    if result["pool"]["acquire_timeouts"] > int(
        thresholds["maxAcquireTimeouts"]
    ):
        failures.append(
            f"pool {result['poolSize']}: acquire timeouts exceed budget"
        )
    if result["latencyMs"]["p95"] > float(thresholds["maxP95Ms"]):
        failures.append(f"pool {result['poolSize']}: p95 exceeds budget")
    if result["latencyMs"]["p99"] > float(thresholds["maxP99Ms"]):
        failures.append(f"pool {result['poolSize']}: p99 exceeds budget")
    if result["counterActual"] != result["counterExpected"]:
        failures.append(f"pool {result['poolSize']}: lost counter updates")
    if result["pool"]["in_use"] or result["pool"]["waiting"]:
        failures.append(f"pool {result['poolSize']}: connection leak detected")
    if result["pool"]["available"] != result["pool"]["size"]:
        failures.append(f"pool {result['poolSize']}: not every connection returned")
    return failures


def wait_for_pool_quiescence(database, timeout_seconds=5.0):
    started = time.perf_counter()
    deadline = started + timeout_seconds
    stats = database.pool_stats()
    while time.perf_counter() < deadline:
        if (
            stats["in_use"] == 0
            and stats["waiting"] == 0
            and stats["available"] == stats["size"]
        ):
            break
        time.sleep(0.01)
        stats = database.pool_stats()
    return stats, round((time.perf_counter() - started) * 1000, 3)


def _operation(database, organization_id, operation_index, write_every):
    started = time.perf_counter()
    connection = database.get_connection()
    operation_type = "pagination"
    try:
        if operation_index % write_every == 0:
            operation_type = "write"
            with database.transaction(connection):
                connection.execute(
                    "UPDATE pool_benchmark_counter SET value = value + 1 WHERE id = 1"
                )
        elif operation_index % 3 == 0:
            operation_type = "dashboard"
            connection.execute(
                """SELECT COUNT(*), COALESCE(SUM(gia_goi_thau), 0)
                   FROM goi_thau
                   WHERE organization_id = ? AND is_latest = 1
                     AND archived_at IS NULL""",
                (organization_id,),
            ).fetchone()
            connection.rollback()
        else:
            connection.execute(
                """SELECT id, ma_goi_thau, ten_goi_thau
                   FROM goi_thau
                   WHERE organization_id = ? AND archived_at IS NULL
                   ORDER BY ma_goi_thau, id LIMIT 25""",
                (organization_id,),
            ).fetchall()
            connection.rollback()
    finally:
        connection.close()
    return operation_type, (time.perf_counter() - started) * 1000


def run_pool_workload(scratch_url, organization_id, pool_size, workload, thresholds):
    operations = int(workload["operations"])
    concurrency = int(workload["concurrency"])
    write_every = int(workload["writeEveryOperations"])
    environment = {
        "POSTGRES_POOL_MIN_SIZE": "0",
        "POSTGRES_POOL_MAX_SIZE": str(pool_size),
        "POSTGRES_POOL_TIMEOUT_SECONDS": "10",
        "POSTGRES_POOL_MAX_WAITING": str(concurrency * 2),
        "POSTGRES_STATEMENT_TIMEOUT_MS": "15000",
    }
    database = PostgreSQLDatabase(scratch_url, environ=environment)
    latencies = []
    errors = []
    operation_counts = {"pagination": 0, "dashboard": 0, "write": 0}
    started = time.perf_counter()
    try:
        with ThreadPoolExecutor(max_workers=concurrency) as executor:
            futures = [
                executor.submit(
                    _operation,
                    database,
                    organization_id,
                    operation_index,
                    write_every,
                )
                for operation_index in range(operations)
            ]
            for future in as_completed(futures):
                try:
                    operation_type, latency_ms = future.result()
                    operation_counts[operation_type] += 1
                    latencies.append(latency_ms)
                except Exception as error:  # pragma: no cover - exercised by real DB
                    errors.append(type(error).__name__)
        verification = database.get_connection()
        try:
            counter_actual = verification.execute(
                "SELECT value FROM pool_benchmark_counter WHERE id = 1"
            ).fetchone()[0]
            verification.rollback()
        finally:
            verification.close()
        pool, quiescence_ms = wait_for_pool_quiescence(database)
    finally:
        database.close()

    counter_expected = len(range(0, operations, write_every))
    result = {
        "poolSize": pool_size,
        "operations": operations,
        "operationCounts": operation_counts,
        "durationSeconds": round(time.perf_counter() - started, 3),
        "throughputPerSecond": round(
            operations / max(time.perf_counter() - started, 0.001), 3
        ),
        "latencyMs": {
            "mean": round(statistics.fmean(latencies), 3) if latencies else 0.0,
            "p95": percentile(latencies, 0.95),
            "p99": percentile(latencies, 0.99),
            "max": round(max(latencies), 3) if latencies else 0.0,
        },
        "errors": sorted(errors),
        "errorRate": round(len(errors) / operations, 6),
        "counterExpected": counter_expected,
        "counterActual": int(counter_actual),
        "pool": pool,
        "poolQuiescenceMs": quiescence_ms,
    }
    failures = evaluate_pool_result(result, thresholds)
    return result, failures


def run_benchmark(base_url, budgets):
    import psycopg
    from psycopg import sql

    database_name = f"{SCRATCH_PREFIX}{uuid.uuid4().hex[:12]}"
    maintenance_url = _database_url(base_url, "postgres")
    scratch_url = _database_url(base_url, database_name)
    with psycopg.connect(maintenance_url, autocommit=True) as connection:
        connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database_name)))

    bootstrap_environment = {
        "ADMIN_PASSWORD": "PostgreSQL-pool-benchmark-only-2026!",  # pragma: allowlist secret -- disposable scratch DB
        "ADMIN_USERNAME": "postgrespoolbenchmark",
        "ADMIN_NAME": "PostgreSQL Pool Benchmark",
        "ADMIN_EMAIL": "postgres-pool-benchmark@example.test",
        "DEFAULT_ORG_NAME": "PostgreSQL Pool Benchmark",
        "POSTGRES_POOL_MIN_SIZE": "0",
        "POSTGRES_POOL_MAX_SIZE": "2",
    }
    bootstrap_database = PostgreSQLDatabase(
        scratch_url, environ=bootstrap_environment
    )
    started = time.perf_counter()
    results = []
    failures = []
    try:
        initialize_postgresql_database(bootstrap_database, bootstrap_environment)
        connection = bootstrap_database.get_connection()
        try:
            organization_id = connection.execute("SELECT id FROM to_chuc LIMIT 1").fetchone()[0]
            _seed(
                connection,
                organization_id,
                int(budgets["dataset"]["plans"]),
                int(budgets["dataset"]["packages"]),
            )
            connection.execute(
                "CREATE TABLE pool_benchmark_counter (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)"
            )
            connection.execute(
                "INSERT INTO pool_benchmark_counter (id, value) VALUES (1, 0)"
            )
            connection.commit()
        finally:
            connection.close()
        bootstrap_database.close()

        for pool_size in budgets["workload"]["poolSizes"]:
            with psycopg.connect(scratch_url, autocommit=True) as connection:
                connection.execute("UPDATE pool_benchmark_counter SET value = 0 WHERE id = 1")
            result, pool_failures = run_pool_workload(
                scratch_url,
                organization_id,
                int(pool_size),
                budgets["workload"],
                budgets["thresholds"],
            )
            results.append(result)
            failures.extend(pool_failures)
    finally:
        bootstrap_database.close()
        with psycopg.connect(maintenance_url, autocommit=True) as connection:
            connection.execute(
                sql.SQL("DROP DATABASE {} WITH (FORCE)").format(
                    sql.Identifier(database_name)
                )
            )

    return {
        "contractVersion": budgets["contractVersion"],
        "dataset": budgets["dataset"],
        "workload": budgets["workload"],
        "thresholds": budgets["thresholds"],
        "durationSeconds": round(time.perf_counter() - started, 3),
        "results": results,
        "passed": not failures,
        "failures": failures,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--url", default=os.environ.get("BIDDING_TEST_POSTGRESQL_URL", "")
    )
    parser.add_argument("--budgets", type=Path, default=DEFAULT_BUDGET_PATH)
    parser.add_argument("--operations", type=int)
    parser.add_argument(
        "--pool-sizes",
        help="comma-separated positive pool sizes overriding the budget file",
    )
    parser.add_argument("--output", type=Path)
    arguments = parser.parse_args(argv)
    if not arguments.url:
        parser.error("--url or BIDDING_TEST_POSTGRESQL_URL is required")
    budgets = copy.deepcopy(
        json.loads(arguments.budgets.read_text(encoding="utf-8"))
    )
    if arguments.operations is not None:
        if arguments.operations < 1:
            parser.error("--operations must be positive")
        budgets["workload"]["operations"] = arguments.operations
    if arguments.pool_sizes:
        try:
            pool_sizes = [
                int(value.strip())
                for value in arguments.pool_sizes.split(",")
                if value.strip()
            ]
        except ValueError:
            parser.error("--pool-sizes must contain integers")
        if not pool_sizes or any(value < 1 for value in pool_sizes):
            parser.error("--pool-sizes must contain positive integers")
        budgets["workload"]["poolSizes"] = pool_sizes
    result = run_benchmark(arguments.url, budgets)
    rendered = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    print(rendered, end="")
    if arguments.output:
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        arguments.output.write_text(rendered, encoding="utf-8")
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
