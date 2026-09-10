"""Application service for the platform administration overview."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from backend.admin.repository import AdminOverviewRepository


class AdminOverviewService:
    def __init__(self, repository: AdminOverviewRepository):
        self.repository = repository

    def build(self, *, now: datetime | None = None) -> dict:
        current = now or datetime.now(timezone.utc)
        if current.tzinfo is None:
            current = current.replace(tzinfo=timezone.utc)
        current = current.astimezone(timezone.utc)
        new_since = current - timedelta(days=30)
        period_since = current.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        metrics = self.repository.load_metrics(
            new_since=new_since.strftime("%Y-%m-%d %H:%M:%S"),
            period_since=period_since.strftime("%Y-%m-%d %H:%M:%S"),
            now_epoch=int(current.timestamp()),
        )
        recent_organizations = [
            {
                "id": row["id"],
                "name": row["name"],
                "status": row["status"],
                "createdAt": row["created_at"],
                "memberCount": int(row["member_count"]),
                "subscriptionStatus": row["subscription_status"],
            }
            for row in self.repository.load_recent_organizations()
        ]
        organization_total = int(metrics["organization_total"])
        organization_active = int(metrics["organization_active"])
        user_total = int(metrics["user_total"])
        account_active = int(metrics["account_active"])
        alerts = []
        inactive_organizations = max(0, organization_total - organization_active)
        if inactive_organizations:
            alerts.append({
                "code": "INACTIVE_ORGANIZATIONS",
                "severity": "warning",
                "count": inactive_organizations,
                "title": "Tổ chức cần rà soát",
                "message": "Tổ chức không ở trạng thái hoạt động.",
                "href": "/admin/organizations?status=suspended",
            })
        inactive_accounts = max(0, user_total - account_active)
        if inactive_accounts:
            alerts.append({
                "code": "INACTIVE_ACCOUNTS",
                "severity": "warning",
                "count": inactive_accounts,
                "title": "Tài khoản cần rà soát",
                "message": "Tài khoản không ở trạng thái hoạt động.",
                "href": "/admin/users?status=inactive",
            })
        return {
            "generatedAt": current.isoformat().replace("+00:00", "Z"),
            "metrics": {
                "organizations": organization_total,
                "activeOrganizations": organization_active,
                "newOrganizations30Days": int(metrics["organization_new"]),
                "users": user_total,
                "activeAccounts": account_active,
                "activeUsers": None,
                "newUsers30Days": int(metrics["user_new"]),
                "activeSubscriptions": int(metrics["subscription_active"]),
                "currentPeriodRevenue": {
                    "value": int(metrics["period_revenue"]),
                    "currency": "VND",
                    "period": "current_month",
                },
                "mrr": None,
                "arr": None,
                "unpaidInvoices": None,
                "overdueInvoices": None,
                "pendingJobs": None,
            },
            "recentOrganizations": recent_organizations,
            "activityFeed": [
                {
                    "id": item["id"],
                    "kind": "organization.created",
                    "title": item["name"],
                    "occurredAt": item["createdAt"],
                    "status": item["status"],
                    "memberCount": item["memberCount"],
                    "subscriptionStatus": item["subscriptionStatus"],
                }
                for item in recent_organizations
            ],
            "alerts": alerts,
        }
