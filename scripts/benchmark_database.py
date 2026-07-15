"""Repeatable SQLite benchmark against the clean production schema."""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import tempfile
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.db import db_utils
from backend.db.db_helper import SQLiteDatabase


def percentile(values, percentage=0.95):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, int(len(ordered) * percentage) - 1))]


def measure(connection, sql, params=(), rounds=30):
    durations = []
    row_count = 0
    for _ in range(rounds):
        started = time.perf_counter()
        rows = connection.execute(sql, params).fetchall()
        durations.append((time.perf_counter() - started) * 1_000)
        row_count = len(rows)
    return {
        "p50Ms": round(statistics.median(durations), 3),
        "p95Ms": round(percentile(durations), 3),
        "maxMs": round(max(durations), 3),
        "rows": row_count,
    }


def seed(connection, organization_id, plans, packages):
    connection.execute(
        "INSERT INTO chu_dau_tu (id, organization_id, ma_chu_dau_tu, ten_chu_dau_tu) VALUES (?,?,?,?)",
        ("benchmark-investor", organization_id, "CDT-BENCH", "Chủ đầu tư benchmark"),
    )
    connection.executemany(
        """INSERT INTO ke_hoach_lcnt
        (id, organization_id, id_goc, ma_ke_hoach, ten_ke_hoach, ten_du_an_du_toan,
         loai_hinh_mua_sam, chu_dau_tu_id, ngay_phe_duyet, quyet_dinh_phe_duyet, sync_version)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        ((f"plan-{index}", organization_id, f"plan-{index}", f"KH-{index:06d}",
          f"Kế hoạch mua sắm {index}", f"Dự toán {index}", "Dự án",
          "benchmark-investor", "2026-01-15", f"QD-{index}", index + 1)
         for index in range(plans)),
    )
    statuses = ("PREPARING", "INVITED", "OPENED", "EVALUATING", "CANCELLED")
    connection.executemany(
        """INSERT INTO goi_thau
        (id, organization_id, id_goc, ma_goi_thau, ke_hoach_id, ten_goi_thau,
         gia_goi_thau, thoi_gian_thuc_hien, nguon_von, thoi_gian_to_chuc,
         thoi_gian_bat_dau_to_chuc, trang_thai, sync_version)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        ((f"package-{index}", organization_id, f"package-{index}", f"GT-{index:07d}",
          f"plan-{index % plans}", f"Gói thầu thiết bị benchmark {index}",
          1_000_000 + index, "90 ngày", "Ngân sách", "Quý III/2026",
          "2026-07-01", statuses[index % len(statuses)], plans + index + 1)
         for index in range(packages)),
    )
    connection.commit()
    connection.execute("PRAGMA optimize")


def run_benchmark(database_path, plans, packages, rounds):
    os.environ.setdefault("ADMIN_PASSWORD", "Benchmark-only-password-123!")
    database = SQLiteDatabase(database_path)
    original_database = db_utils.database
    db_utils.database = database
    try:
        db_utils.khoi_tao_va_di_tru_he_thong()
    finally:
        db_utils.database = original_database
    connection = database.get_connection()
    organization_id = connection.execute("SELECT id FROM to_chuc LIMIT 1").fetchone()[0]
    seed_started = time.perf_counter()
    seed(connection, organization_id, plans, packages)
    results = {
        "dataset": {"plans": plans, "packages": packages},
        "seedSeconds": round(time.perf_counter() - seed_started, 3),
        "databaseMiB": round(Path(database.db_path).stat().st_size / 1024 / 1024, 2),
        "measurements": {
            "dashboard": measure(connection, "SELECT trang_thai, COUNT(*), SUM(gia_goi_thau) FROM goi_thau WHERE organization_id=? AND archived_at IS NULL AND is_latest=1 GROUP BY trang_thai", (organization_id,), rounds),
            "search": measure(connection, "SELECT g.id FROM fts_goi_thau f JOIN goi_thau g ON g.rowid=f.rowid WHERE fts_goi_thau MATCH ? AND g.organization_id=? LIMIT 50", ('\"thiet bi\"', organization_id), rounds),
            "keysetPage": measure(connection, "SELECT id, ma_goi_thau, ten_goi_thau FROM goi_thau WHERE organization_id=? AND ma_goi_thau>? ORDER BY ma_goi_thau, id LIMIT 50", (organization_id, "GT-0050000"), rounds),
            "detail": measure(connection, "SELECT * FROM goi_thau WHERE organization_id=? AND id=?", (organization_id, f"package-{packages // 2}"), rounds),
            "syncDelta": measure(connection, "SELECT id, sync_version FROM goi_thau WHERE organization_id=? AND sync_version>? ORDER BY sync_version LIMIT 500", (organization_id, plans + packages - 500), rounds),
            "fullBootstrapPage": measure(connection, "SELECT id, sync_version FROM goi_thau WHERE organization_id=? ORDER BY sync_version LIMIT 500", (organization_id,), rounds),
        },
    }
    connection.close()
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plans", type=int, default=20_000)
    parser.add_argument("--packages", type=int, default=100_000)
    parser.add_argument("--rounds", type=int, default=30)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="biddingflow-benchmark-") as directory:
        result = run_benchmark(Path(directory) / "benchmark.db", args.plans, args.packages, args.rounds)
    rendered = json.dumps(result, ensure_ascii=False, indent=2)
    print(rendered)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
