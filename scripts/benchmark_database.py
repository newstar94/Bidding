"""Repeatable SQLite benchmark against the clean production schema."""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
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
         loai_hinh_mua_sam, chu_dau_tu_id, ngay_phe_duyet, quyet_dinh_phe_duyet,
         is_tong_muc_tu_dong, sync_version)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        ((f"plan-{index}", organization_id, f"plan-{index}", f"KH-{index:06d}",
          f"Kế hoạch mua sắm {index}", f"Dự toán {index}", "Dự án",
          "benchmark-investor", "2026-01-15", f"QD-{index}", 1, index + 1)
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


def _current_sync_version(connection, organization_id):
    row = connection.execute(
        "SELECT current_version FROM sync_metadata WHERE organization_id = ?",
        (organization_id,),
    ).fetchone()
    return int(row[0] if row else 0)


def _wal_snapshot(connection, database_path):
    busy, frames, checkpointed = connection.execute(
        "PRAGMA wal_checkpoint(PASSIVE)"
    ).fetchone()
    wal_path = Path(str(database_path) + "-wal")
    return {
        "busy": int(busy),
        "frames": int(frames),
        "checkpointedFrames": int(checkpointed),
        "bytes": wal_path.stat().st_size if wal_path.exists() else 0,
    }


def _prepare_write_measurement(connection, organization_id):
    target = connection.execute(
        """SELECT id, COALESCE(NULLIF(id_goc, ''), id), ke_hoach_id
           FROM goi_thau
           WHERE organization_id = ?
           ORDER BY id
           LIMIT 1""",
        (organization_id,),
    ).fetchone()
    connection.execute(
        "UPDATE goi_thau SET is_latest = 0 WHERE organization_id = ? AND id = ?",
        (organization_id, target[0]),
    )
    connection.commit()
    connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    return {
        "packageId": target[0],
        "rootId": target[1],
        "planId": target[2],
    }


def _measurement_result(
    connection,
    database_path,
    organization_id,
    before_total_changes,
    before_sync_version,
    started_at,
    *,
    package_updates,
    plan_updates,
):
    connection.commit()
    elapsed_ms = (time.perf_counter() - started_at) * 1_000
    after_sync_version = _current_sync_version(connection, organization_id)
    wal = _wal_snapshot(connection, database_path)
    return {
        "elapsedMs": round(elapsed_ms, 3),
        "baseRowsMatched": int(package_updates + plan_updates),
        "packageRowsMatched": int(package_updates),
        "planRowsMatched": int(plan_updates),
        "sqliteTotalChangesIncludingTriggers": int(
            connection.total_changes - before_total_changes
        ),
        "syncVersionAllocated": int(after_sync_version - before_sync_version),
        "wal": wal,
    }


def measure_targeted_write_amplification(
    connection, database_path, organization_id, target
):
    before_changes = connection.total_changes
    before_version = _current_sync_version(connection, organization_id)
    started_at = time.perf_counter()
    connection.execute("BEGIN IMMEDIATE")
    package_updates = db_utils.recalculate_is_latest(
        connection.cursor(),
        "goi_thau",
        organization_id=organization_id,
        affected_families={(target["rootId"], target["planId"])},
    )
    plan_updates = db_utils.recalculate_tong_muc_dau_tu(
        connection.cursor(),
        organization_id=organization_id,
        plan_ids={target["planId"]},
    )
    return _measurement_result(
        connection,
        database_path,
        organization_id,
        before_changes,
        before_version,
        started_at,
        package_updates=package_updates,
        plan_updates=plan_updates,
    )


def measure_legacy_write_amplification(
    connection, database_path, organization_id
):
    """Execute the pre-P0 whole-tenant recalculation for an actual comparison."""
    before_changes = connection.total_changes
    before_version = _current_sync_version(connection, organization_id)
    started_at = time.perf_counter()
    cursor = connection.cursor()
    connection.execute("BEGIN IMMEDIATE")
    cursor.execute(
        "UPDATE goi_thau SET is_latest = 0 WHERE organization_id = ?",
        (organization_id,),
    )
    package_updates = max(0, cursor.rowcount)
    cursor.execute(
        """UPDATE goi_thau SET is_latest = 1
           WHERE organization_id = ? AND id IN (
               SELECT id FROM (
                   SELECT id, ROW_NUMBER() OVER (
                       PARTITION BY CASE
                           WHEN id_goc IS NOT NULL AND id_goc != '' THEN id_goc
                           ELSE id
                       END, COALESCE(ke_hoach_id, '')
                       ORDER BY CAST(phien_ban AS INTEGER) DESC,
                                updated_at DESC, id DESC
                   ) AS rn
                   FROM goi_thau
                   WHERE organization_id = ? AND archived_at IS NULL
               ) AS ranked WHERE rn = 1
           )""",
        (organization_id, organization_id),
    )
    package_updates += max(0, cursor.rowcount)

    plan_updates = 0
    plans = cursor.execute(
        """SELECT id, loai_hinh_mua_sam
           FROM ke_hoach_lcnt
           WHERE organization_id = ? AND is_tong_muc_tu_dong = 1""",
        (organization_id,),
    ).fetchall()
    for plan_id, procurement_type in plans:
        package_total = sum(
            int(row[0] or 0)
            for row in cursor.execute(
                """SELECT gia_goi_thau FROM goi_thau
                   WHERE ke_hoach_id = ? AND is_latest = 1
                     AND archived_at IS NULL AND is_rebid = 0""",
                (plan_id,),
            ).fetchall()
        )
        work_totals = {}
        for work_type, value in cursor.execute(
            "SELECT loai, gia_tri FROM ke_hoach_cong_viec WHERE ke_hoach_id = ?",
            (plan_id,),
        ).fetchall():
            work_totals[work_type] = work_totals.get(work_type, 0) + int(value or 0)
        total = (
            work_totals.get("khong_ap_dung", 0)
            + work_totals.get("chua_du_dieu_kien", 0)
            + package_total
        )
        if procurement_type == "Dự án":
            total += work_totals.get("da_thuc_hien", 0)
        cursor.execute(
            "UPDATE ke_hoach_lcnt SET tong_muc_dau_tu = ? WHERE id = ?",
            (total, plan_id),
        )
        plan_updates += max(0, cursor.rowcount)

    return _measurement_result(
        connection,
        database_path,
        organization_id,
        before_changes,
        before_version,
        started_at,
        package_updates=package_updates,
        plan_updates=plan_updates,
    )


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
    target = _prepare_write_measurement(connection, organization_id)
    legacy_path = Path(str(database.db_path) + ".legacy")
    legacy_connection = sqlite3.connect(legacy_path)
    try:
        connection.backup(legacy_connection)
    finally:
        legacy_connection.close()
    legacy_database = SQLiteDatabase(legacy_path)
    legacy_connection = legacy_database.get_connection()
    legacy_connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")

    targeted_write = measure_targeted_write_amplification(
        connection, database.db_path, organization_id, target
    )
    legacy_write = measure_legacy_write_amplification(
        legacy_connection, legacy_database.db_path, organization_id
    )
    legacy_connection.close()
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
            "writeAmplification": {
                "target": target,
                "optimized": targeted_write,
                "legacyWholeTenant": legacy_write,
            },
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
