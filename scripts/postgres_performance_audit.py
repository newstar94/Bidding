"""Audit PostgreSQL query performance and operational health without secrets."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sys
from typing import Any

import psycopg
from psycopg.rows import dict_row


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.load_test import _load_env


def _database_url(env_name: str) -> str:
    _load_env()
    value = str(os.environ.get(env_name, "")).strip()
    if not value:
        raise RuntimeError(f"{env_name} is required")
    if not value.startswith(("postgresql://", "postgres://")):
        raise RuntimeError(f"{env_name} must be a PostgreSQL URL")
    return value


def _rows(connection, statement: str, parameters=()) -> list[dict[str, Any]]:
    return [
        dict(row)
        for row in connection.execute(statement, parameters).fetchall()
    ]


def _scalar(connection, statement: str, parameters=()):
    row = connection.execute(statement, parameters).fetchone()
    if not row:
        return None
    if isinstance(row, dict):
        return next(iter(row.values()))
    return row[0]


def _missing_foreign_key_indexes(connection) -> list[dict[str, Any]]:
    return _rows(
        connection,
        """
        SELECT conrelid::regclass::text AS table_name,
               conname AS constraint_name,
               ARRAY(
                   SELECT attributes.attname
                   FROM unnest(constraints.conkey)
                        WITH ORDINALITY AS keys(attnum, ordinality)
                   JOIN pg_attribute AS attributes
                     ON attributes.attrelid = constraints.conrelid
                    AND attributes.attnum = keys.attnum
                   ORDER BY keys.ordinality
               ) AS columns
        FROM pg_constraint AS constraints
        WHERE constraints.contype = 'f'
          AND constraints.connamespace = current_schema()::regnamespace
          AND NOT EXISTS (
              SELECT 1
              FROM pg_index AS indexes
              WHERE indexes.indrelid = constraints.conrelid
                AND indexes.indisvalid
                AND (indexes.indkey::smallint[])[
                    0:cardinality(constraints.conkey) - 1
                ] = constraints.conkey
          )
        ORDER BY 1, 2
        """,
    )


def _statement_rows(connection, limit: int) -> list[dict[str, Any]]:
    rows = _rows(
        connection,
        """
        SELECT queryid::text AS query_id, calls,
               round(total_exec_time::numeric, 3) AS total_exec_ms,
               round(mean_exec_time::numeric, 3) AS mean_exec_ms,
               rows, shared_blks_hit, shared_blks_read,
               temp_blks_read, temp_blks_written,
               round(wal_bytes::numeric, 0) AS wal_bytes,
               query
        FROM pg_stat_statements
        WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND userid <> 0
        ORDER BY total_exec_time DESC
        LIMIT %s
        """,
        (limit,),
    )
    for row in rows:
        query = re.sub(r"\s+", " ", str(row.pop("query", "")).strip())
        row["query_sha256"] = hashlib.sha256(query.encode("utf-8")).hexdigest()
        row["query"] = query[:1000]
    return rows


def _walk_plan(node: dict[str, Any]):
    yield node
    for child in node.get("Plans", ()):
        yield from _walk_plan(child)


def _explain(connection, name: str, statement: str, parameters=()) -> dict[str, Any]:
    payload = _scalar(
        connection,
        "EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON) " + statement,
        parameters,
    )
    report = payload[0]
    nodes = list(_walk_plan(report["Plan"]))
    return {
        "name": name,
        "planningMs": round(float(report.get("Planning Time", 0)), 3),
        "executionMs": round(float(report.get("Execution Time", 0)), 3),
        "rootNode": report["Plan"].get("Node Type"),
        "actualRows": int(report["Plan"].get("Actual Rows", 0)),
        "sharedHitBlocks": sum(int(node.get("Shared Hit Blocks", 0)) for node in nodes),
        "sharedReadBlocks": sum(int(node.get("Shared Read Blocks", 0)) for node in nodes),
        "tempReadBlocks": sum(int(node.get("Temp Read Blocks", 0)) for node in nodes),
        "tempWrittenBlocks": sum(int(node.get("Temp Written Blocks", 0)) for node in nodes),
        "sequentialScans": [
            str(node.get("Relation Name"))
            for node in nodes
            if node.get("Node Type") == "Seq Scan"
        ],
        "indexes": sorted({
            str(node["Index Name"])
            for node in nodes
            if node.get("Index Name")
        }),
    }


def _hot_query_plans(connection) -> list[dict[str, Any]]:
    organization_id = _scalar(
        connection,
        """
        SELECT organization_id
        FROM (
            SELECT organization_id, count(*) AS row_count
            FROM chu_dau_tu
            GROUP BY organization_id
        ) AS sizes
        ORDER BY row_count DESC
        LIMIT 1
        """,
    )
    if not organization_id:
        return []
    plans = [
        _explain(
            connection,
            "sync_delta_chu_dau_tu",
            """
            SELECT id, sync_version
            FROM chu_dau_tu
            WHERE organization_id = %s
              AND sync_version > %s
              AND archived_at IS NULL
            ORDER BY sync_version, id
            LIMIT 200
            """,
            (organization_id, 0),
        ),
        _explain(
            connection,
            "latest_chu_dau_tu_page",
            """
            SELECT id, ten_chu_dau_tu
            FROM chu_dau_tu
            WHERE organization_id = %s
              AND archived_at IS NULL
              AND is_latest = 1
            ORDER BY COALESCE(ten_chu_dau_tu, ''), id
            LIMIT 50
            """,
            (organization_id,),
        ),
        _explain(
            connection,
            "trigram_chu_dau_tu_search",
            """
            SELECT id, ten_chu_dau_tu
            FROM chu_dau_tu
            WHERE organization_id = %s
              AND archived_at IS NULL
              AND is_latest = 1
              AND bf_unaccent(lower(
                  COALESCE(ma_chu_dau_tu, '') || ' ' ||
                  COALESCE(ten_chu_dau_tu, '') || ' ' ||
                  COALESCE(ten_viet_tat, '') || ' ' ||
                  COALESCE(ma_so_thue, '')
              )) LIKE '%%' || bf_unaccent(lower(%s)) || '%%'
            LIMIT 50
            """,
            (organization_id, "performance 49999"),
        ),
    ]
    return plans


def build_report(connection, *, top: int, explain: bool) -> dict[str, Any]:
    preload = str(_scalar(connection, "SHOW shared_preload_libraries") or "")
    installed = bool(_scalar(
        connection,
        "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements')",
    ))
    statement_ready = installed and "pg_stat_statements" in {
        item.strip() for item in preload.split(",")
    }
    database_stats = _rows(
        connection,
        """
        SELECT datname, numbackends, xact_commit, xact_rollback,
               blks_read, blks_hit, temp_files, temp_bytes, deadlocks,
               round(active_time::numeric, 3) AS active_time_ms,
               round(idle_in_transaction_time::numeric, 3)
                   AS idle_in_transaction_time_ms
        FROM pg_stat_database
        WHERE datname = current_database()
        """,
    )[0]
    tables = _rows(
        connection,
        """
        SELECT relname AS table_name, n_live_tup, n_dead_tup,
               seq_scan, idx_scan,
               last_autovacuum, last_autoanalyze,
               pg_total_relation_size(relid) AS total_bytes
        FROM pg_stat_user_tables
        ORDER BY pg_total_relation_size(relid) DESC
        """,
    )
    indexes = _rows(
        connection,
        """
        SELECT schemaname, relname AS table_name, indexrelname AS index_name,
               idx_scan, pg_relation_size(indexrelid) AS index_bytes
        FROM pg_stat_user_indexes
        WHERE pg_relation_size(indexrelid) >= 1048576
        ORDER BY idx_scan, pg_relation_size(indexrelid) DESC
        LIMIT 100
        """,
    )
    settings = {
        name: _scalar(connection, f"SHOW {name}")
        for name in (
            "max_connections",
            "track_io_timing",
            "track_wal_io_timing",
            "autovacuum",
            "autovacuum_max_workers",
            "autovacuum_vacuum_scale_factor",
            "autovacuum_analyze_scale_factor",
        )
    }
    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "serverVersion": _scalar(connection, "SHOW server_version"),
        "databaseBytes": int(_scalar(
            connection,
            "SELECT pg_database_size(current_database())",
        )),
        "settings": settings,
        "pgStatStatements": {
            "preloaded": "pg_stat_statements" in preload,
            "installed": installed,
            "ready": statement_ready,
            "top": _statement_rows(connection, top) if statement_ready else [],
        },
        "databaseStats": database_stats,
        "tables": tables,
        "largeLowUseIndexes": indexes,
        "missingForeignKeyIndexes": _missing_foreign_key_indexes(connection),
        "hotQueryPlans": _hot_query_plans(connection) if explain else [],
    }
    report["findings"] = [
        finding
        for condition, finding in (
            (not statement_ready, "pg_stat_statements is not ready"),
            (settings["track_io_timing"] != "on", "track_io_timing is disabled"),
            (bool(report["missingForeignKeyIndexes"]), "foreign keys are missing leading indexes"),
            (database_stats["deadlocks"] > 0, "database has recorded deadlocks"),
            (database_stats["temp_bytes"] > 0, "queries have written temporary data"),
        )
        if condition
    ]
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--url-env",
        default="PERFORMANCE_DATABASE_URL",
        help="Environment variable containing the database URL",
    )
    parser.add_argument("--top", type=int, default=20)
    parser.add_argument("--enable-extension", action="store_true")
    parser.add_argument("--require-pg-stat-statements", action="store_true")
    parser.add_argument("--explain", action="store_true")
    parser.add_argument("--output")
    args = parser.parse_args()

    with psycopg.connect(
        _database_url(args.url_env),
        autocommit=True,
        row_factory=dict_row,
        application_name="biddingflow-performance-audit",
    ) as connection:
        if args.enable_extension:
            preload = str(
                _scalar(connection, "SHOW shared_preload_libraries") or ""
            )
            if "pg_stat_statements" not in {
                item.strip() for item in preload.split(",")
            }:
                raise RuntimeError(
                    "Configure shared_preload_libraries and restart PostgreSQL first"
                )
            connection.execute(
                "CREATE EXTENSION IF NOT EXISTS pg_stat_statements"
            )
        report = build_report(
            connection,
            top=max(1, min(100, args.top)),
            explain=args.explain,
        )

    text = json.dumps(report, ensure_ascii=False, indent=2, default=str)
    if args.output:
        Path(args.output).write_text(text + "\n", encoding="utf-8")
    print(text)
    if args.require_pg_stat_statements and not report["pgStatStatements"]["ready"]:
        return 2
    return 1 if report["missingForeignKeyIndexes"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
