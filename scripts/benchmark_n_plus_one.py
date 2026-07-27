"""Benchmark the batched N+1 regression paths against PostgreSQL.

The script seeds rollback-only owner-scoped data, measures query counts and
timings for 1/10/50/100 records, then rolls the entire transaction back.
"""

from __future__ import annotations

import argparse
from collections import Counter
import json
import os
from pathlib import Path
import re
import sys
import time
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import psycopg

from backend.db.db_helper import PostgresCursor, compat_row_factory
from backend.shared import access_policy
from backend.sync import delete_policy, ownership, uniqueness
from scripts.env_utils import load_env


DEFAULT_SIZES = (1, 10, 50, 100)


def _normalize_sql(statement: object) -> str:
    normalized = " ".join(str(statement).split())
    normalized = re.sub(r"\?(?:\s*,\s*\?)+", "?", normalized)
    return re.sub(r"\(\?\)(?:\s*,\s*\(\?\))+", "(?)", normalized)


class QueryTraceCursor:
    """Transparent cursor proxy that records normalized SQL and DB time."""

    def __init__(self, cursor: PostgresCursor):
        self._cursor = cursor
        self.reset()

    def reset(self) -> None:
        self.patterns: list[str] = []
        self.database_seconds = 0.0

    def execute(self, statement, parameters=()):
        started_at = time.perf_counter()
        try:
            self._cursor.execute(statement, parameters)
        finally:
            self.database_seconds += time.perf_counter() - started_at
            self.patterns.append(_normalize_sql(statement))
        return self

    def executemany(self, statement, parameters_seq):
        started_at = time.perf_counter()
        try:
            self._cursor.executemany(statement, parameters_seq)
        finally:
            self.database_seconds += time.perf_counter() - started_at
            self.patterns.append(f"executemany: {_normalize_sql(statement)}")
        return self

    def fetchone(self):
        return self._cursor.fetchone()

    def fetchall(self):
        return self._cursor.fetchall()

    def __getattr__(self, name):
        return getattr(self._cursor, name)


def _seed_records(cursor: PostgresCursor, record_count: int):
    prefix = f"__n1_benchmark_{uuid4().hex}"
    organization_id = f"{prefix}_organization"
    cursor.execute(
        "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (?, ?)",
        (organization_id, "N+1 rollback-only benchmark organization"),
    )

    investors = []
    plans = []
    packages = []
    for index in range(record_count):
        investor_id = f"{prefix}_investor_{index}"
        plan_id = f"{prefix}_plan_{index}"
        package_id = f"{prefix}_package_{index}"
        investors.append({
            "id": investor_id,
            "rootId": investor_id,
            "maChuDauTu": f"N1-CDT-{index}-{prefix}",
            "maSoThue": f"N1-MST-{index}-{prefix}",
        })
        plans.append({
            "id": plan_id,
            "rootId": plan_id,
            "chuDauTuId": investor_id,
        })
        packages.append({
            "id": package_id,
            "rootId": package_id,
            "maGoiThau": f"N1-GT-{index}-{prefix}",
            "keHoachId": plan_id,
        })

    cursor.executemany(
        """INSERT INTO chu_dau_tu (
               id, organization_id, id_goc, ma_chu_dau_tu, ma_so_thue,
               ten_chu_dau_tu
           ) VALUES (?, ?, ?, ?, ?, ?)""",
        [
            (
                item["id"],
                organization_id,
                item["rootId"],
                item["maChuDauTu"],
                item["maSoThue"],
                f"N+1 benchmark investor {index}",
            )
            for index, item in enumerate(investors)
        ],
    )
    cursor.executemany(
        """INSERT INTO ke_hoach_lcnt (
               id, organization_id, id_goc, ma_ke_hoach, ten_ke_hoach,
               ten_du_an_du_toan, loai_hinh_mua_sam, chu_dau_tu_id,
               ngay_phe_duyet, quyet_dinh_phe_duyet
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        [
            (
                item["id"],
                organization_id,
                item["rootId"],
                f"N1-KH-{index}-{prefix}",
                f"N+1 benchmark plan {index}",
                f"N+1 benchmark project {index}",
                "Mua sắm hàng hóa",
                item["chuDauTuId"],
                "2026-07-27",
                f"QD-{index}-{prefix}",
            )
            for index, item in enumerate(plans)
        ],
    )
    cursor.executemany(
        """INSERT INTO goi_thau (
               id, organization_id, id_goc, ma_goi_thau, ke_hoach_id,
               ten_goi_thau, gia_goi_thau, thoi_gian_thuc_hien,
               nguon_von, thoi_gian_to_chuc, thoi_gian_bat_dau_to_chuc
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        [
            (
                item["id"],
                organization_id,
                item["rootId"],
                item["maGoiThau"],
                item["keHoachId"],
                f"N+1 benchmark package {index}",
                1_000_000 + index,
                "30 ngày",
                "Ngân sách thử nghiệm",
                "30 ngày",
                "2026-07-27",
            )
            for index, item in enumerate(packages)
        ],
    )
    return organization_id, investors, plans, packages


def _measure(cursor: QueryTraceCursor, case_name: str, size: int, operation):
    cursor.reset()
    started_at = time.perf_counter()
    operation()
    elapsed_seconds = time.perf_counter() - started_at
    counts = Counter(cursor.patterns)
    return {
        "case": case_name,
        "size": size,
        "queries": len(cursor.patterns),
        "patterns": len(counts),
        "elapsed_ms": round(elapsed_seconds * 1000, 3),
        "database_ms": round(cursor.database_seconds * 1000, 3),
        "repeated_pattern_count": sum(1 for count in counts.values() if count > 1),
        "repeated_patterns": [
            {"count": count, "sql": pattern}
            for pattern, count in counts.most_common()
            if count > 1
        ],
    }


def _run_matrix(database_url: str, sizes: tuple[int, ...]):
    connection = psycopg.connect(
        database_url,
        connect_timeout=5,
        row_factory=compat_row_factory,
    )
    try:
        base_cursor = PostgresCursor(connection.cursor())
        organization_id, investors, _plans, packages = _seed_records(
            base_cursor,
            max(sizes),
        )
        cursor = QueryTraceCursor(base_cursor)
        results = []
        for size in sizes:
            selected_investors = investors[:size]
            selected_packages = packages[:size]
            investor_ids = [item["id"] for item in selected_investors]
            package_ids = [item["id"] for item in selected_packages]
            results.extend((
                _measure(
                    cursor,
                    "delete_references",
                    size,
                    lambda ids=investor_ids: (
                        delete_policy.find_blocking_delete_references_by_record_ids(
                            cursor,
                            organization_id,
                            "chu_dau_tu",
                            ids,
                        )
                    ),
                ),
                _measure(
                    cursor,
                    "delete_impacts",
                    size,
                    lambda ids=package_ids: delete_policy.build_delete_impacts_by_record_ids(
                        cursor,
                        organization_id,
                        "goi_thau",
                        ids,
                    ),
                ),
                _measure(
                    cursor,
                    "owner_references",
                    size,
                    lambda items=selected_packages: ownership.build_owner_reference_context(
                        cursor,
                        organization_id,
                        {"goi_thau": items},
                        {},
                    ),
                ),
                _measure(
                    cursor,
                    "uniqueness",
                    size,
                    lambda items=selected_investors: uniqueness.build_domain_uniqueness_context(
                        cursor,
                        organization_id,
                        {"chu_dau_tu": items},
                    ),
                ),
                _measure(
                    cursor,
                    "authorization",
                    size,
                    lambda items=selected_packages: access_policy.build_batch_write_authorization_context(
                        cursor,
                        "super_admin",
                        "__n1_benchmark_actor__",
                        organization_id,
                        {"goi_thau": items},
                    ),
                ),
            ))
        return results
    finally:
        connection.rollback()
        connection.close()


def _parse_sizes(value: str) -> tuple[int, ...]:
    try:
        sizes = tuple(int(part.strip()) for part in value.split(",") if part.strip())
    except ValueError as error:
        raise argparse.ArgumentTypeError("sizes must be comma-separated integers") from error
    if not sizes or any(size <= 0 for size in sizes):
        raise argparse.ArgumentTypeError("sizes must contain positive integers")
    return sizes


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database-url",
        help="PostgreSQL URL; defaults to TEST_DATABASE_URL from the environment/.env",
    )
    parser.add_argument(
        "--sizes",
        type=_parse_sizes,
        default=DEFAULT_SIZES,
        help="comma-separated record counts (default: 1,10,50,100)",
    )
    parser.add_argument("--json", action="store_true", help="emit JSON")
    args = parser.parse_args()

    load_env(ROOT)
    database_url = args.database_url or os.environ.get("TEST_DATABASE_URL")
    if not database_url:
        parser.error("TEST_DATABASE_URL is not configured; pass --database-url")

    results = _run_matrix(database_url, tuple(args.sizes))
    if args.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
        return 0

    print(
        "case                 size  queries  patterns  repeated  elapsed_ms  database_ms"
    )
    for result in results:
        print(
            f"{result['case']:<20} {result['size']:>4} "
            f"{result['queries']:>8} {result['patterns']:>9} "
            f"{result['repeated_pattern_count']:>9} "
            f"{result['elapsed_ms']:>11.3f} {result['database_ms']:>12.3f}"
        )
        for repeated in result["repeated_patterns"]:
            print(f"  repeated x{repeated['count']}: {repeated['sql']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
