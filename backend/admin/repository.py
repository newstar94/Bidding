"""Bounded aggregate reads for the platform administration dashboard."""

from __future__ import annotations


class AdminOverviewRepository:
    """Load the overview with a fixed number of database queries."""

    RECENT_ORGANIZATION_LIMIT = 8

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

