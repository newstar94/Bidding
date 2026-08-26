"""Low-cardinality commercial health snapshot and alert thresholds."""

from __future__ import annotations

import time


def _scalar(cursor, statement, parameters=()):
    row = cursor.execute(statement, parameters).fetchone()
    return int((row[0] if row else 0) or 0)


def commercial_health_snapshot(cursor, *, clock=None):
    now = int((clock or time.time)())
    webhook_backlog = _scalar(
        cursor,
        "SELECT COUNT(*) FROM payment_webhook_events WHERE status IN ('pending', 'retry', 'processing')",
    )
    oldest_webhook = _scalar(
        cursor,
        """SELECT COALESCE(MIN(available_at), 0) FROM payment_webhook_events
            WHERE status IN ('pending', 'retry', 'processing')""",
    )
    paid_not_applied = _scalar(
        cursor,
        """SELECT COUNT(*) FROM billing_orders
            WHERE payment_state = 'verified_paid'
              AND activation_state IN ('not_ready', 'pending', 'retry')""",
    )
    paid_oldest = _scalar(
        cursor,
        """SELECT COALESCE(MIN(tx.provider_occurred_at), 0)
              FROM payment_transactions AS tx
              JOIN billing_orders AS orders ON orders.id = tx.order_id
             WHERE tx.transaction_type = 'payment' AND tx.status IN ('verified', 'settled')
               AND orders.activation_state IN ('not_ready', 'pending', 'retry')""",
    )
    pending_expired = _scalar(
        cursor,
        """SELECT COUNT(*) FROM billing_orders
            WHERE checkout_state IN ('creating', 'open')
              AND checkout_expires_at IS NOT NULL AND checkout_expires_at < ?""",
        (now,),
    )
    negative_invariant = _scalar(
        cursor,
        """SELECT COUNT(*) FROM usage_credit_grants
            WHERE remaining < 0 OR reserved < 0 OR reserved > remaining""",
    )
    webhook_review = _scalar(
        cursor,
        "SELECT COUNT(*) FROM payment_webhook_events WHERE status = 'review'",
    )
    webhook_age = max(0, now - oldest_webhook) if oldest_webhook else 0
    paid_age = max(0, now - paid_oldest) if paid_oldest else 0
    alerts = []
    if webhook_age > 30:
        alerts.append({"code": "WEBHOOK_BACKLOG_OLD", "severity": "critical", "value": webhook_age, "threshold": 30})
    if paid_age > 60:
        alerts.append({"code": "PAID_NOT_APPLIED_OLD", "severity": "critical", "value": paid_age, "threshold": 60})
    if pending_expired:
        alerts.append({"code": "PENDING_ORDER_EXPIRED", "severity": "warning", "value": pending_expired, "threshold": 0})
    if negative_invariant:
        alerts.append({"code": "USAGE_NEGATIVE_INVARIANT", "severity": "critical", "value": negative_invariant, "threshold": 0})
    if webhook_review:
        alerts.append({"code": "WEBHOOK_REVIEW_REQUIRED", "severity": "critical", "value": webhook_review, "threshold": 0})
    return {
        "webhook": {"backlog": webhook_backlog, "oldestAgeSeconds": webhook_age, "reviewRequired": webhook_review},
        "activation": {"paidNotApplied": paid_not_applied, "oldestAgeSeconds": paid_age},
        "orders": {"pendingPastExpiry": pending_expired},
        "usage": {"negativeInvariantViolations": negative_invariant},
        "alerts": alerts,
    }
