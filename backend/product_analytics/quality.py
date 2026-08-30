"""Bounded data-quality diagnostics for analytics source and read models."""
# ruff: noqa: S608 -- IN lists contain only code-owned taxonomy placeholders.

from __future__ import annotations

import time

from backend.usage_analytics.service import FEATURE_KEYS as LEGACY_FEATURE_KEYS

from .taxonomy import COMMERCIAL_EVENT_KEYS, MEANINGFUL_FEATURE_KEYS


def run_data_quality_checks(cursor, *, now=None):
    current = int(time.time() if now is None else now)
    checks = []

    def scalar(code, severity, sql, parameters=()):
        count = int(cursor.execute(sql, parameters).fetchone()[0] or 0)
        checks.append({"code": code, "severity": severity, "count": count, "ok": count == 0})

    scalar(
        "future_commercial_events", "error",
        "SELECT COUNT(*) FROM commercial_analytics_events WHERE occurred_at > ?",
        (current + 300,),
    )
    scalar(
        "missing_release_attribution", "error",
        "SELECT COUNT(*) FROM commercial_analytics_events WHERE commercial_release_id IS NULL OR trim(commercial_release_id)=''",
    )
    placeholders = ",".join("?" for _ in COMMERCIAL_EVENT_KEYS)
    scalar(
        "unknown_commercial_event", "error",
        f"SELECT COUNT(*) FROM commercial_analytics_events WHERE event_name NOT IN ({placeholders})",
        tuple(sorted(COMMERCIAL_EVENT_KEYS)),
    )
    features = sorted(set(MEANINGFUL_FEATURE_KEYS) | set(LEGACY_FEATURE_KEYS))
    placeholders = ",".join("?" for _ in features)
    scalar(
        "unknown_feature_key", "warning",
        f"""SELECT COUNT(*) FROM product_usage_hourly
             WHERE metric_key='feature.used' AND feature_key NOT IN ({placeholders})""",
        tuple(features),
    )
    scalar(
        "invalid_credit_accounting", "error",
        """SELECT COUNT(*) FROM usage_credit_grants
            WHERE total<=0 OR remaining<0 OR remaining>total OR reserved<0 OR reserved>remaining""",
    )
    scalar(
        "payment_activation_mismatch", "error",
        """SELECT COUNT(*) FROM billing_orders
            WHERE (payment_state='verified_paid' AND activation_state NOT IN ('pending','applied','retry','review_required'))
               OR (activation_state='applied' AND payment_state!='verified_paid')""",
    )
    scalar(
        "negative_aggregate", "error",
        """SELECT COUNT(*) FROM workspace_usage_daily
            WHERE active_seats<0 OR meaningful_actions<0 OR successful_fetches<0
               OR included_credits_consumed<0 OR purchased_credits<0""",
    )
    scalar(
        "duplicate_commercial_event_id", "error",
        """SELECT COUNT(*) FROM (SELECT event_id FROM commercial_analytics_events
            GROUP BY event_id HAVING COUNT(*)>1) AS duplicate""",
    )
    return {
        "ok": all(item["ok"] or item["severity"] == "warning" for item in checks),
        "checks": checks,
    }
