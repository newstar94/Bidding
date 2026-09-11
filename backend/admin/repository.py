"""Bounded aggregate reads for the platform administration dashboard."""

from __future__ import annotations


class AdminOverviewRepository:
    """Load the overview with a fixed number of database queries."""

    RECENT_ORGANIZATION_LIMIT = 8
    ACTIVITY_FEED_LIMIT = 20

    def __init__(self, cursor):
        self.cursor = cursor

    def load_metrics(self, *, new_since: str, period_since: str, now_epoch: int) -> dict:
        row = self.cursor.execute(
            """
            SELECT
                (SELECT COUNT(*) FROM to_chuc) AS organization_total,
                (SELECT COUNT(*) FROM to_chuc WHERE trang_thai = 'active')
                    AS organization_active,
                (SELECT COUNT(*) FROM to_chuc WHERE created_at >= ?)
                    AS organization_new,
                (SELECT COUNT(*) FROM tai_khoan) AS user_total,
                (SELECT COUNT(*) FROM tai_khoan WHERE trang_thai = 'active')
                    AS account_active,
                (SELECT COUNT(*) FROM tai_khoan WHERE created_at >= ?)
                    AS user_new,
                (SELECT COUNT(*) FROM organization_subscriptions
                  WHERE status = 'active'
                    AND (expires_at IS NULL OR expires_at > ?))
                +
                (SELECT COUNT(*) FROM account_subscriptions
                  WHERE status = 'active'
                    AND (expires_at IS NULL OR expires_at > ?))
                    AS subscription_active,
                (SELECT COALESCE(SUM(verified_paid_amount), 0)
                   FROM payment_transactions
                  WHERE transaction_type = 'payment'
                    AND status IN ('verified', 'settled')
                    AND created_at >= ?) AS period_revenue
            """,
            (new_since, new_since, now_epoch, now_epoch, period_since),
        ).fetchone()
        return dict(row)

    def load_recent_organizations(self) -> list[dict]:
        rows = self.cursor.execute(
            """
            SELECT organization.id,
                   organization.ten_to_chuc AS name,
                   organization.trang_thai AS status,
                   organization.created_at,
                   COUNT(membership.user_id) AS member_count,
                   subscription.status AS subscription_status
              FROM to_chuc AS organization
              LEFT JOIN thanh_vien_to_chuc AS membership
                ON membership.organization_id = organization.id
               AND COALESCE(membership.trang_thai_thanh_vien, 'active') = 'active'
              LEFT JOIN organization_subscriptions AS subscription
                ON subscription.organization_id = organization.id
             GROUP BY organization.id,
                      organization.ten_to_chuc,
                      organization.trang_thai,
                      organization.created_at,
                      subscription.status
             ORDER BY organization.created_at DESC, organization.id DESC
             LIMIT ?
            """,
            (self.RECENT_ORGANIZATION_LIMIT,),
        ).fetchall()
        return [dict(row) for row in rows]

    def load_activity_feed(self) -> list[dict]:
        """Return a bounded, newest-first feed from authoritative platform facts."""

        rows = self.cursor.execute(
            """
            SELECT activity_id, kind, title, occurred_at, status, detail
              FROM (
                SELECT organization.id || ':created' AS activity_id,
                       'organization.created' AS kind,
                       organization.ten_to_chuc AS title,
                       organization.created_at AS occurred_at,
                       organization.trang_thai AS status,
                       NULL AS detail
                  FROM to_chuc organization
                UNION ALL
                SELECT 'organization:' || subscription.organization_id || ':subscription',
                       'subscription.created', organization.ten_to_chuc,
                       subscription.created_at, subscription.status,
                       subscription.package_id
                  FROM organization_subscriptions subscription
                  JOIN to_chuc organization
                    ON organization.id = subscription.organization_id
                UNION ALL
                SELECT 'account:' || subscription.user_id || ':subscription',
                       'subscription.created',
                       COALESCE(account.ho_ten, account.email, account.id),
                       subscription.created_at, subscription.status,
                       subscription.package_id
                  FROM account_subscriptions subscription
                  JOIN tai_khoan account ON account.id = subscription.user_id
                UNION ALL
                SELECT invoice.id || ':payment', 'invoice.payment_verified',
                       COALESCE(invoice.provider_reference, orders.public_id),
                       transaction.created_at, transaction.status,
                       orders.public_id
                  FROM billing_invoice_requests invoice
                  JOIN payment_transactions transaction
                    ON transaction.id = invoice.payment_transaction_id
                  JOIN billing_orders orders ON orders.id = invoice.order_id
                 WHERE transaction.transaction_type = 'payment'
                   AND transaction.status IN ('verified', 'settled')
                UNION ALL
                SELECT 'audit:' || CAST(audit.id AS TEXT),
                       CASE
                         WHEN lower(audit.action) LIKE '%%subscription%%'
                           THEN 'subscription.changed'
                         ELSE 'admin.security'
                       END,
                       audit.action, audit.created_at,
                       CASE
                         WHEN lower(audit.action) LIKE '%%failed%%'
                           OR lower(audit.action) LIKE '%%denied%%'
                           OR lower(audit.action) LIKE '%%rejected%%'
                           OR lower(audit.action) LIKE '%%forbidden%%'
                           THEN 'attention'
                         ELSE 'recorded'
                       END,
                       COALESCE(audit.target_id, audit.target_type)
                  FROM audit_log audit
                 WHERE lower(audit.action) LIKE 'admin.%%'
                    OR lower(audit.action) LIKE '%%subscription%%'
                    OR lower(audit.action) LIKE '%%login_failed%%'
                    OR lower(audit.action) LIKE '%%reauth_failed%%'
                    OR lower(audit.action) LIKE '%%suspicious%%'
                    OR lower(audit.action) LIKE '%%denied%%'
                    OR lower(audit.action) LIKE '%%forbidden%%'
              ) activity
             ORDER BY occurred_at DESC, activity_id DESC
             LIMIT ?
            """,
            (self.ACTIVITY_FEED_LIMIT,),
        ).fetchall()
        return [dict(row) for row in rows]

    def load_chart_points(self, *, since: str) -> list[dict]:
        """Return bounded chart aggregates without exposing row-level records."""

        rows = self.cursor.execute(
            """
            SELECT series_key, bucket, SUM(value) AS value
              FROM (
                SELECT 'newOrganizations' AS series_key,
                       SUBSTR(CAST(created_at AS TEXT), 1, 10) AS bucket,
                       1 AS value
                  FROM to_chuc
                 WHERE created_at >= ?
                UNION ALL
                SELECT 'newUsers', SUBSTR(CAST(created_at AS TEXT), 1, 10), 1
                  FROM tai_khoan
                 WHERE created_at >= ?
                UNION ALL
                SELECT 'revenue', SUBSTR(CAST(created_at AS TEXT), 1, 10),
                       verified_paid_amount
                  FROM payment_transactions
                 WHERE transaction_type = 'payment'
                   AND status IN ('verified', 'settled')
                   AND created_at >= ?
                UNION ALL
                SELECT 'subscriptionDistribution', status, 1
                  FROM organization_subscriptions
                UNION ALL
                SELECT 'subscriptionDistribution', status, 1
                  FROM account_subscriptions
                UNION ALL
                SELECT 'invoiceStatus', status, 1
                  FROM billing_invoice_requests
              ) chart_points
             WHERE bucket IS NOT NULL AND bucket <> ''
             GROUP BY series_key, bucket
             ORDER BY series_key ASC, bucket ASC
            """,
            (since, since, since),
        ).fetchall()
        return [dict(row) for row in rows]
