"""Seed deterministic, synthetic Product Analytics aggregates in a dev database."""

from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
import os
from pathlib import Path
import sys

import psycopg

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.db.db_helper import PostgresCursor, compat_row_factory
from scripts.env_utils import load_env


def _id(index):
    return sha256(f"biddingflow-product-analytics-demo:{index}".encode()).hexdigest()


def main():
    load_env(ROOT)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL", ""))
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--end-date", default=date.today().isoformat())
    parser.add_argument("--confirm-dev-seed", action="store_true")
    args = parser.parse_args()
    environment = str(os.environ.get("APP_ENV", "development")).strip().casefold()
    if environment in {"prod", "production"}:
        parser.error("demo analytics seed is forbidden in production")
    if not args.confirm_dev_seed:
        parser.error("--confirm-dev-seed is required")
    if not args.database_url:
        parser.error("DATABASE_URL is required")
    end = date.fromisoformat(args.end_date)
    start = end - timedelta(days=89)
    with psycopg.connect(args.database_url, row_factory=compat_row_factory) as connection:
        cursor = PostgresCursor(connection.cursor())
        release = cursor.execute("SELECT id FROM commercial_releases WHERE id=?", (args.release_id,)).fetchone()
        if not release:
            parser.error("--release-id must reference an existing immutable commercial release")
        for index in range(24):
            workspace_id = _id(index)
            owner_kind = "account" if index % 3 == 0 else "organization"
            variant = "connected" if index % 2 else "internal"
            plan = ("personal", "silver", "gold", "diamond")[index % 4]
            registered = (1, 2, 5, 8, 15, 22, 40, 55)[index % 8]
            quota = (1, 5, 15, 50)[index % 4]
            signup = datetime.combine(start - timedelta(days=index % 21), datetime.min.time(), timezone.utc)
            signup_epoch = int(signup.timestamp())
            first_value_epoch = signup_epoch + (index % 12 + 1) * 3600
            activation_epoch = signup_epoch + 2 * 86400 if index % 2 else None
            cursor.execute(
                """INSERT INTO workspace_activation_facts
                   (analytics_workspace_id,owner_kind,signup_at,verification_at,verification_observation,
                    first_login_at,first_value_at,first_feature_key,first_plan_at,
                    first_procurement_or_export_at,subscription_activated_at,first_paid_value_at,
                    commercial_release_id,plan_code,variant,size_bucket)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(analytics_workspace_id) DO UPDATE SET updated_at=CURRENT_TIMESTAMP""",
                (workspace_id, owner_kind, signup_epoch, signup_epoch + 1800 if owner_kind == "account" else None,
                 "observed" if owner_kind == "account" else "historical_timestamp_unavailable",
                 signup_epoch + 2400, first_value_epoch, "planning.create", activation_epoch,
                 first_value_epoch + 3600, activation_epoch,
                 activation_epoch + 7200 if activation_epoch else None,
                 args.release_id, plan, variant,
                 "1" if registered == 1 else "2_5" if registered <= 5 else "6_15" if registered <= 15 else "16_50" if registered <= 50 else "over_50"),
            )
            for day_offset in range(90):
                day = start + timedelta(days=day_offset)
                active = min(registered, 1 + ((index + day_offset) % max(1, registered)))
                meaningful = 0 if (index + day_offset) % 5 == 0 else 1 + (index % 7)
                fetches = (index + day_offset) % 4 if variant == "connected" else 0
                ai_requests = (index * day_offset) % 5
                cursor.execute(
                    """INSERT INTO workspace_usage_daily
                       (usage_date,analytics_workspace_id,owner_kind,commercial_release_id,plan_code,variant,
                        size_bucket,registered_seats,active_seats,power_seats,meaningful_actions,
                        procurement_actions,fetch_attempted,successful_fetches,credits_reserved,
                        included_credits_granted,included_credits_consumed,feature_uses,workflow_volume,
                        ai_requests,ai_input_tokens,ai_output_tokens,ai_tool_calls,topup_spend_vnd)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                       ON CONFLICT(usage_date,analytics_workspace_id) DO NOTHING""",
                    (day.isoformat(), workspace_id, owner_kind, args.release_id, plan, variant,
                     "1" if active <= 1 else "2_5" if active <= 5 else "6_15" if active <= 15 else "16_50" if active <= 50 else "over_50",
                     registered, active, active if day_offset % 4 else 0, meaningful, fetches,
                     fetches, fetches, fetches, quota if day.day == 1 else 0, min(fetches, quota),
                     meaningful, meaningful, ai_requests, ai_requests * 120, ai_requests * 60,
                     ai_requests // 2, 0),
                )
                if meaningful:
                    feature = ("planning.create", "package.create", "procurement.fetch", "ai.request")[index % 4]
                    cursor.execute(
                        """INSERT INTO workspace_feature_daily
                           (usage_date,analytics_workspace_id,feature_key,active_users,event_count)
                           VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING""",
                        (day.isoformat(), workspace_id, feature, active, meaningful),
                    )
                    for user_index in range(active):
                        cursor.execute(
                            """INSERT INTO workspace_feature_user_daily
                               (usage_date,analytics_workspace_id,feature_key,analytics_user_id,event_count)
                               VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING""",
                            (day.isoformat(), workspace_id, feature, _id(f"{index}:user:{user_index}"), meaningful),
                        )
                if activation_epoch:
                    cursor.execute(
                        """INSERT INTO subscription_snapshot_daily
                           (snapshot_date,analytics_workspace_id,owner_kind,commercial_release_id,
                            plan_code,variant,member_quota,status,activated_today)
                           VALUES (?,?,?,?,?,?,?,'active',?) ON CONFLICT DO NOTHING""",
                        (day.isoformat(), workspace_id, owner_kind, args.release_id, plan, variant,
                         quota, int(day == datetime.fromtimestamp(activation_epoch, timezone.utc).date())),
                    )
                cursor.execute(
                    """INSERT INTO cost_usage_daily
                       (usage_date,commercial_release_id,owner_kind,analytics_workspace_id,
                        plan_code,variant,cost_type,quantity,estimated_cost_vnd,source)
                       VALUES (?,?,?,?,?,?,'ai',?,?,'demo_seed') ON CONFLICT DO NOTHING""",
                    (day.isoformat(), args.release_id, owner_kind, workspace_id, plan, variant,
                     ai_requests, ai_requests * 25),
                )
            if activation_epoch:
                revenue_day = start + timedelta(days=10 + index % 20)
                gross = 500_000 + index * 25_000
                cursor.execute(
                    """INSERT INTO revenue_daily
                       (usage_date,commercial_release_id,owner_kind,plan_code,variant,sku_code,
                        gross_revenue_vnd,net_settled_revenue_vnd,refund_amount_vnd,payment_fee_vnd,paid_orders)
                       VALUES (?,?,?,?,?,?,?,?,?,?,1) ON CONFLICT DO NOTHING""",
                    (revenue_day.isoformat(), args.release_id, owner_kind, plan, variant,
                     f"demo-plan-{index}", gross, gross - gross // 50, 0, gross // 50),
                )
            if index % 2:
                for purchase_number in range(1 + index % 5):
                    purchase_day = start + timedelta(days=5 + purchase_number * 12)
                    pack_size = (20, 100, 500, 2000)[index % 4]
                    cursor.execute(
                        """INSERT INTO credit_pack_purchase_daily
                           (purchase_date,analytics_workspace_id,owner_kind,commercial_release_id,sku_code,
                            pack_size,purchase_count,credits_purchased,gross_revenue_vnd,unused_credits)
                           VALUES (?,?,?,?,?,?,1,?,?,?) ON CONFLICT DO NOTHING""",
                        (purchase_day.isoformat(), workspace_id, owner_kind, args.release_id,
                         f"demo-pack-{pack_size}", pack_size, pack_size, pack_size * 1000, pack_size // 4),
                    )
                    cursor.execute(
                        """UPDATE workspace_usage_daily SET
                             purchased_credits=purchased_credits+?,
                             purchased_credits_unused=purchased_credits_unused+?,
                             topup_spend_vnd=topup_spend_vnd+?
                           WHERE usage_date=? AND analytics_workspace_id=?""",
                        (pack_size, pack_size // 4, pack_size * 1000,
                         purchase_day.isoformat(), workspace_id),
                    )
            month = end.replace(day=1)
            cursor.execute(
                """INSERT INTO plan_fit_monthly
                   (snapshot_month,analytics_workspace_id,commercial_release_id,owner_kind,plan_code,
                    variant,size_bucket,active_seats,seat_utilization,quota_utilization,
                    topup_spend_vnd,workflow_volume,estimated_cost_vnd,revenue_vnd,
                    classification,rule_version)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING""",
                (month.isoformat(), workspace_id, args.release_id, owner_kind, plan, variant,
                 "1" if registered == 1 else "2_5" if registered <= 5 else "6_15" if registered <= 15 else "16_50" if registered <= 50 else "over_50",
                 min(registered, quota), min(1, registered / quota), (index % 10) / 10,
                 (index % 5) * 20_000, 90 + index, index * 2500, 0,
                 "ENTERPRISE_CANDIDATE" if registered > 50 else "GOOD_FIT", "demo-v1"),
            )
        cohort_week = start - timedelta(days=start.weekday())
        for cohort_kind in ("signup", "first_value", "paid_activation"):
            for owner_kind, count in (("account", 8), ("organization", 16)):
                for week_number in (0, 1, 2, 4, 8, 12):
                    cursor.execute(
                        """INSERT INTO retention_cohort_weekly
                           (cohort_week,cohort_kind,segment_key,commercial_release_id,owner_kind,
                            workspace_count,week_number,retained_workspaces)
                           VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING""",
                        (cohort_week.isoformat(), cohort_kind,
                         "variant=demo|size=demo|procurement=low|collaboration=active|ai=adopted",
                         args.release_id, owner_kind, count, week_number,
                         max(0, count - week_number // 2)),
                    )
        for event_index, event_name in enumerate((
            "pricing.viewed", "pricing.size_selected", "pricing.variant_compared",
            "pricing.offer_selected", "quote.created", "checkout.created",
            "payment.verified", "subscription.activated", "first_paid_value",
        )):
            unique_count = max(10, 24 - event_index * 2)
            cursor.execute(
                """INSERT INTO commercial_funnel_daily
                   (usage_date,commercial_release_id,event_name,owner_kind,size_bucket,sku_code,
                    event_count,unique_workspaces)
                   VALUES (?,?,?,?,?,'demo',?,?) ON CONFLICT DO NOTHING""",
                (end.isoformat(), args.release_id, event_name, "organization", "6_15",
                 unique_count * 2, unique_count),
            )
            for workspace_index in range(unique_count):
                cursor.execute(
                    """INSERT INTO commercial_funnel_workspace_daily
                       (usage_date,commercial_release_id,event_name,owner_kind,size_bucket,
                        sku_code,analytics_workspace_id,event_count)
                       VALUES (?,?,?,?,?,'demo',?,2) ON CONFLICT DO NOTHING""",
                    (end.isoformat(), args.release_id, event_name, "organization", "6_15",
                     _id(workspace_index)),
                )
        connection.commit()
    print(f"Seeded 24 deterministic synthetic workspaces for {start}..{end}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
