"""Benchmark critical PostgreSQL query plans on an isolated scratch database.

The command always creates and later drops a randomly named database. It never
seeds or mutates the database named in ``BIDDING_TEST_POSTGRESQL_URL``.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import time
import uuid
from urllib.parse import urlsplit, urlunsplit

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.db.postgresql import PostgreSQLDatabase
from backend.db.postgresql_migrations import initialize_postgresql_database


DEFAULT_BUDGET_PATH = PROJECT_ROOT / "load" / "postgresql-query-budgets.json"
SCRATCH_PREFIX = "bidding_benchmark_"


def _database_url(base_url, database_name):
    parsed = urlsplit(base_url)
    return urlunsplit(
        (parsed.scheme, parsed.netloc, f"/{database_name}", parsed.query, parsed.fragment)
    )


def _walk_plan(node):
    yield node
    for child in node.get("Plans", []):
        yield from _walk_plan(child)


def summarize_explain(document):
    payload = document[0] if isinstance(document, list) else document
    plan = payload["Plan"]
    nodes = list(_walk_plan(plan))
    node_types = [node.get("Node Type", "") for node in nodes]
    return {
        "planningMs": round(float(payload.get("Planning Time", 0.0)), 3),
        "executionMs": round(float(payload.get("Execution Time", 0.0)), 3),
        "actualRows": int(plan.get("Actual Rows", 0)),
        "sharedHitBlocks": sum(int(node.get("Shared Hit Blocks", 0)) for node in nodes),
        "sharedReadBlocks": sum(int(node.get("Shared Read Blocks", 0)) for node in nodes),
        "nodeTypes": node_types,
        "usesIndex": any("Index" in node_type or "Bitmap" in node_type for node_type in node_types),
    }


def evaluate_budget(name, measurement, budget):
    failures = []
    maximum = float(budget["maxExecutionMs"])
    if measurement["executionMs"] > maximum:
        failures.append(
            f"{name}: execution {measurement['executionMs']} ms exceeds {maximum} ms"
        )
    if budget.get("requireIndex") and not measurement["usesIndex"]:
        failures.append(f"{name}: plan does not use an index")
    return failures


def _seed(connection, organization_id, plans, packages):
    connection.execute("ALTER TABLE ke_hoach_lcnt DISABLE TRIGGER USER")
    connection.execute("ALTER TABLE goi_thau DISABLE TRIGGER USER")
    connection.execute(
        """
        INSERT INTO chu_dau_tu (
            id, organization_id, ma_chu_dau_tu, ten_chu_dau_tu
        ) VALUES (?, ?, ?, ?)
        """,
        ("benchmark-investor", organization_id, "CDT-BENCH", "Chủ đầu tư benchmark"),
    )
    batch_size = 5_000
    for start in range(0, plans, batch_size):
        end = min(plans, start + batch_size)
        connection.executemany(
            """
            INSERT INTO ke_hoach_lcnt (
                id, organization_id, id_goc, ma_ke_hoach, ten_ke_hoach,
                ten_du_an_du_toan, loai_hinh_mua_sam, chu_dau_tu_id,
                ngay_phe_duyet, quyet_dinh_phe_duyet,
                is_tong_muc_tu_dong, sync_version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                (
                    f"plan-{index}",
                    organization_id,
                    f"plan-{index}",
                    f"KH-{index:06d}",
                    f"Kế hoạch mua sắm {index}",
                    f"Dự toán {index}",
                    "Dự án",
                    "benchmark-investor",
                    "2026-01-15",
                    f"QD-{index}",
                    1,
                    index + 1,
                )
                for index in range(start, end)
            ),
        )
    statuses = ("PREPARING", "INVITED", "OPENED", "EVALUATING", "CANCELLED")
    for start in range(0, packages, batch_size):
        end = min(packages, start + batch_size)
        connection.executemany(
            """
            INSERT INTO goi_thau (
                id, organization_id, id_goc, ma_goi_thau, ke_hoach_id,
                ten_goi_thau, gia_goi_thau, thoi_gian_thuc_hien, nguon_von,
                thoi_gian_to_chuc, thoi_gian_bat_dau_to_chuc,
                trang_thai, sync_version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                (
                    f"package-{index}",
                    organization_id,
                    f"package-{index}",
                    f"GT-{index:07d}",
                    f"plan-{index % plans}",
                    f"Gói thầu thiết bị benchmark {index}",
                    1_000_000 + index,
                    "90 ngày",
                    "Ngân sách",
                    "Quý III/2026",
                    "2026-07-01",
                    statuses[index % len(statuses)],
                    plans + index + 1,
                )
                for index in range(start, end)
            ),
        )
    connection.execute("ALTER TABLE ke_hoach_lcnt ENABLE TRIGGER USER")
    connection.execute("ALTER TABLE goi_thau ENABLE TRIGGER USER")
    connection.commit()
    connection.execute("ANALYZE ke_hoach_lcnt")
    connection.execute("ANALYZE goi_thau")
    connection.commit()


def _query_contracts(organization_id, plans, packages):
    middle_package = packages // 2
    return {
        "dashboard": (
            """
            SELECT trang_thai, COUNT(*), SUM(gia_goi_thau)
            FROM goi_thau
            WHERE organization_id = ? AND archived_at IS NULL AND is_latest = 1
            GROUP BY trang_thai
            """,
            (organization_id,),
        ),
        "pagination": (
            """
            SELECT id, ma_goi_thau, ten_goi_thau
            FROM goi_thau
            WHERE organization_id = ?
              AND (ma_goi_thau, id) > (?, ?)
            ORDER BY ma_goi_thau, id
            LIMIT 50
            """,
            (organization_id, f"GT-{middle_package:07d}", f"package-{middle_package}"),
        ),
        "deltaSync": (
            """
            SELECT id, sync_version
            FROM goi_thau
            WHERE organization_id = ? AND sync_version > ?
            ORDER BY sync_version, id
            LIMIT 500
            """,
            (organization_id, plans + packages - 500),
        ),
        "exportPackage": (
            """
            SELECT package.*, plan.ma_ke_hoach, plan.ten_ke_hoach,
                   investor.ten_chu_dau_tu
            FROM goi_thau AS package
            JOIN ke_hoach_lcnt AS plan
              ON plan.organization_id = package.organization_id
             AND plan.id = package.ke_hoach_id
            LEFT JOIN chu_dau_tu AS investor
              ON investor.organization_id = plan.organization_id
             AND investor.id = plan.chu_dau_tu_id
            WHERE package.organization_id = ? AND package.id = ?
            """,
            (organization_id, f"package-{middle_package}"),
        ),
    }


def _explain(connection, sql, parameters):
    row = connection.execute(
        f"EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {sql}", parameters
    ).fetchone()
    return summarize_explain(row[0])


def run_benchmark(base_url, budgets, plans, packages):
    import psycopg
    from psycopg import sql

    database_name = f"{SCRATCH_PREFIX}{uuid.uuid4().hex[:12]}"
    maintenance_url = _database_url(base_url, "postgres")
    scratch_url = _database_url(base_url, database_name)
    with psycopg.connect(maintenance_url, autocommit=True) as connection:
        connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database_name)))

    environment = {
        "ADMIN_PASSWORD": "PostgreSQL-benchmark-only-2026!",  # pragma: allowlist secret -- disposable scratch DB
        "ADMIN_USERNAME": "postgresbenchmark",
        "ADMIN_NAME": "PostgreSQL Benchmark",
        "ADMIN_EMAIL": "postgres-benchmark@example.test",
        "DEFAULT_ORG_NAME": "PostgreSQL Benchmark",
        "POSTGRES_POOL_MIN_SIZE": "0",
        "POSTGRES_POOL_MAX_SIZE": "2",
    }
    database = PostgreSQLDatabase(scratch_url, environ=environment)
    started = time.perf_counter()
    try:
        initialize_postgresql_database(database, environment)
        connection = database.get_connection()
        try:
            organization_id = connection.execute("SELECT id FROM to_chuc LIMIT 1").fetchone()[0]
            _seed(connection, organization_id, plans, packages)
            measurements = {
                name: _explain(connection, query, parameters)
                for name, (query, parameters) in _query_contracts(
                    organization_id, plans, packages
                ).items()
            }
        finally:
            connection.close()
    finally:
        database.close()
        with psycopg.connect(maintenance_url, autocommit=True) as connection:
            connection.execute(
                sql.SQL("DROP DATABASE {} WITH (FORCE)").format(
                    sql.Identifier(database_name)
                )
            )

    failures = []
    for name, budget in budgets["queries"].items():
        failures.extend(evaluate_budget(name, measurements[name], budget))
    return {
        "dataset": {"plans": plans, "packages": packages},
        "durationSeconds": round(time.perf_counter() - started, 3),
        "measurements": measurements,
        "budgets": budgets["queries"],
        "passed": not failures,
        "failures": failures,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=os.environ.get("BIDDING_TEST_POSTGRESQL_URL", ""))
    parser.add_argument("--budgets", type=Path, default=DEFAULT_BUDGET_PATH)
    parser.add_argument("--plans", type=int)
    parser.add_argument("--packages", type=int)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not args.url:
        parser.error("--url or BIDDING_TEST_POSTGRESQL_URL is required")
    budgets = json.loads(args.budgets.read_text(encoding="utf-8"))
    plans = args.plans or int(budgets["dataset"]["plans"])
    packages = args.packages or int(budgets["dataset"]["packages"])
    if plans <= 0 or packages <= 0:
        parser.error("plans and packages must be positive")
    result = run_benchmark(args.url, budgets, plans, packages)
    rendered = json.dumps(result, ensure_ascii=False, indent=2)
    print(rendered)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    raise SystemExit(0 if result["passed"] else 1)


if __name__ == "__main__":
    main()
