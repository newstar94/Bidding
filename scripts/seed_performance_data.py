"""Seed a disposable PostgreSQL database with production-shaped search rows."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import sys

import psycopg


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.env_utils import load_env


def main() -> int:
    load_env(ROOT)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url-env", default="PERFORMANCE_DATABASE_URL")
    parser.add_argument("--rows", type=int, default=100_000)
    parser.add_argument(
        "--confirm-disposable",
        action="store_true",
        help="Required because this writes synthetic records",
    )
    args = parser.parse_args()
    if not args.confirm_disposable:
        raise RuntimeError("--confirm-disposable is required")
    database_url = str(os.environ.get(args.url_env, "")).strip()
    if not database_url:
        raise RuntimeError(f"{args.url_env} is required")
    rows = max(1_000, min(2_000_000, args.rows))

    with psycopg.connect(
        database_url,
        autocommit=False,
        application_name="biddingflow-performance-seed",
    ) as connection:
        database_name = connection.execute(
            "SELECT current_database()"
        ).fetchone()[0]
        if not any(
            marker in str(database_name).lower()
            for marker in ("test", "load", "perf", "dev")
        ):
            raise RuntimeError(
                "Refusing to seed a database whose name is not test/load/perf/dev"
            )
        organization_id = connection.execute(
            "SELECT id FROM to_chuc ORDER BY id LIMIT 1"
        ).fetchone()
        if not organization_id:
            raise RuntimeError("Initialize the application database first")
        organization_id = organization_id[0]
        connection.execute(
            """
            INSERT INTO chu_dau_tu (
                id, organization_id, owner_type, id_goc, phien_ban,
                is_latest, archived_at, ngay_ap_dung, ma_chu_dau_tu,
                ten_chu_dau_tu, ten_viet_tat, ma_so_thue, sync_version
            )
            SELECT 'perf-cdt-' || series, %s, 'organization',
                   'perf-cdt-' || series, '00', 1, NULL, DATE '2026-01-01',
                   'CDT-' || lpad(series::text, 8, '0'),
                   'Chủ đầu tư performance ' || series,
                   'PERF ' || series,
                   lpad(series::text, 10, '0'),
                   series
            FROM generate_series(1, %s) AS series
            ON CONFLICT DO NOTHING
            """,
            (organization_id, rows),
        )
        connection.execute(
            """
            INSERT INTO nha_thau (
                id, organization_id, owner_type, id_goc, phien_ban,
                is_latest, archived_at, ngay_ap_dung, ma_nha_thau,
                ten_nha_thau, ten_viet_tat, ma_so_thue, sync_version
            )
            SELECT 'perf-nt-' || series, %s, 'organization',
                   'perf-nt-' || series, '00', 1, NULL, DATE '2026-01-01',
                   'NT-' || lpad(series::text, 8, '0'),
                   'Nhà thầu performance ' || series,
                   'PERF NT ' || series,
                   '9' || lpad(series::text, 9, '0'),
                   %s + series
            FROM generate_series(1, %s) AS series
            ON CONFLICT DO NOTHING
            """,
            (organization_id, rows, rows),
        )
        connection.commit()
        connection.execute("ANALYZE chu_dau_tu")
        connection.execute("ANALYZE nha_thau")
        counts = connection.execute(
            """
            SELECT
              (SELECT count(*) FROM chu_dau_tu WHERE organization_id = %s),
              (SELECT count(*) FROM nha_thau WHERE organization_id = %s)
            """,
            (organization_id, organization_id),
        ).fetchone()
        connection.commit()
    print(
        f"Seeded organization {organization_id}: "
        f"chu_dau_tu={counts[0]}, nha_thau={counts[1]}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
