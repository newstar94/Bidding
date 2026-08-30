"""Refresh Product Analytics read models and optionally prune raw UI events."""
# ruff: noqa: S608 -- retention identifiers come from fixed tuples.

from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone
import json
import os
from pathlib import Path
import sys

import psycopg

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.db.db_helper import PostgresCursor, compat_row_factory
from backend.product_analytics.aggregation import refresh_product_analytics
from backend.product_analytics.quality import run_data_quality_checks
from scripts.env_utils import load_env


def main():
    load_env(ROOT)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL", ""))
    parser.add_argument("--from", dest="from_date")
    parser.add_argument("--to", dest="to_date")
    parser.add_argument("--days", type=int, default=90)
    parser.add_argument("--diagnostics", action="store_true")
    parser.add_argument("--prune-raw-events", action="store_true")
    parser.add_argument("--prune-expired-analytics", action="store_true")
    parser.add_argument("--raw-retention-days", type=int, default=180)
    args = parser.parse_args()
    if not args.database_url:
        parser.error("DATABASE_URL is required")
    end = date.fromisoformat(args.to_date) if args.to_date else date.today()
    start = date.fromisoformat(args.from_date) if args.from_date else end - timedelta(days=max(1, args.days) - 1)
    if (end - start).days > 366:
        parser.error("range cannot exceed 366 days")
    key = os.environ.get("ANALYTICS_HMAC_KEY", "")
    with psycopg.connect(args.database_url, row_factory=compat_row_factory) as connection:
        cursor = PostgresCursor(connection.cursor())
        result = refresh_product_analytics(cursor, from_date=start, to_date=end, hmac_key=key)
        if args.prune_raw_events:
            cutoff_day = date.today() - timedelta(days=max(90, args.raw_retention_days))
            cutoff = int(datetime.combine(cutoff_day, datetime.min.time(), timezone.utc).timestamp())
            result["prunedRawEvents"] = cursor.execute(
                "DELETE FROM commercial_analytics_events WHERE received_at < ?", (cutoff,)
            ).rowcount
            result["prunedCommercialFeedback"] = cursor.execute(
                "DELETE FROM commercial_feedback WHERE received_at < ?", (cutoff,)
            ).rowcount
        if args.prune_expired_analytics:
            hourly_cutoff_day = date.today() - timedelta(days=365)
            hourly_cutoff = int(datetime.combine(hourly_cutoff_day, datetime.min.time(), timezone.utc).timestamp())
            aggregate_cutoff = (date.today() - timedelta(days=3 * 365)).isoformat()
            pruned = {
                "product_usage_hourly": cursor.execute(
                    "DELETE FROM product_usage_hourly WHERE window_started_at < ?", (hourly_cutoff,)
                ).rowcount,
            }
            for table, column in (
                ("workspace_usage_daily", "usage_date"),
                ("workspace_feature_daily", "usage_date"),
                ("workspace_feature_user_daily", "usage_date"),
                ("workspace_seat_daily", "usage_date"),
                ("commercial_funnel_daily", "usage_date"),
                ("commercial_funnel_workspace_daily", "usage_date"),
                ("credit_pack_purchase_daily", "purchase_date"),
                ("revenue_daily", "usage_date"),
                ("cost_usage_daily", "usage_date"),
                ("retention_cohort_weekly", "cohort_week"),
                ("plan_fit_monthly", "snapshot_month"),
            ):
                pruned[table] = cursor.execute(  # noqa: S608 - fixed table/column pairs.
                    f"DELETE FROM {table} WHERE {column} < ?", (aggregate_cutoff,)
                ).rowcount
            result["prunedExpiredAnalytics"] = pruned
        if args.diagnostics:
            result["quality"] = run_data_quality_checks(cursor)
        connection.commit()
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0 if result.get("quality", {}).get("ok", True) else 1


if __name__ == "__main__":
    raise SystemExit(main())
