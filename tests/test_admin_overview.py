import asyncio
import json
from datetime import datetime, timezone
from types import SimpleNamespace

from backend.admin import api
from backend.admin.repository import AdminOverviewRepository
from backend.admin.service import AdminOverviewService


class _Result:
    def __init__(self, *, one=None, many=None):
        self.one = one
        self.many = many or []

    def fetchone(self):
        return self.one

    def fetchall(self):
        return self.many


class _Cursor:
    def __init__(self):
        self.calls = []

    def execute(self, statement, params=()):
        self.calls.append((statement, params))
        if "organization_total" in statement:
            return _Result(
                one={
                    "organization_total": 12,
                    "organization_active": 10,
                    "organization_new": 2,
                    "user_total": 40,
                    "account_active": 35,
                    "user_new": 4,
                    "subscription_active": 9,
                    "period_revenue": 1_250_000,
                }
            )
        return _Result(
            many=[
                {
                    "id": "org-1",
                    "name": "Organization One",
                    "status": "active",
                    "created_at": "2026-09-01 08:00:00",
                    "member_count": 3,
                    "subscription_status": "active",
                }
            ]
        )


def _payload(response):
    return json.loads(response.body)


def test_overview_service_returns_real_aggregates_and_explicit_unavailable_metrics():
    cursor = _Cursor()
    payload = AdminOverviewService(AdminOverviewRepository(cursor)).build(
        now=datetime(2026, 9, 10, 1, 2, 3, tzinfo=timezone.utc)
    )

    assert payload["generatedAt"] == "2026-09-10T01:02:03Z"
    assert payload["metrics"]["organizations"] == 12
    assert payload["metrics"]["activeOrganizations"] == 10
    assert payload["metrics"]["newOrganizations30Days"] == 2
    assert payload["metrics"]["users"] == 40
    assert payload["metrics"]["activeAccounts"] == 35
    assert payload["metrics"]["activeUsers"] is None
    assert payload["metrics"]["newUsers30Days"] == 4
    assert payload["metrics"]["activeSubscriptions"] == 9
    assert payload["metrics"]["currentPeriodRevenue"] == {
        "value": 1_250_000,
        "currency": "VND",
        "period": "current_month",
    }
    assert payload["metrics"]["mrr"] is None
    assert payload["metrics"]["pendingJobs"] is None
    assert payload["recentOrganizations"] == [
        {
            "id": "org-1",
            "name": "Organization One",
            "status": "active",
            "createdAt": "2026-09-01 08:00:00",
            "memberCount": 3,
            "subscriptionStatus": "active",
        }
    ]
    assert payload["activityFeed"] == [{
        "id": "org-1",
        "kind": "organization.created",
        "title": "Organization One",
        "occurredAt": "2026-09-01 08:00:00",
        "status": "active",
        "memberCount": 3,
        "subscriptionStatus": "active",
    }]
    assert payload["alerts"] == [
        {
            "code": "INACTIVE_ORGANIZATIONS",
            "severity": "warning",
            "count": 2,
            "title": "Tổ chức cần rà soát",
            "message": "Tổ chức không ở trạng thái hoạt động.",
            "href": "/admin/organizations?status=suspended",
        },
        {
            "code": "INACTIVE_ACCOUNTS",
            "severity": "warning",
            "count": 5,
            "title": "Tài khoản cần rà soát",
            "message": "Tài khoản không ở trạng thái hoạt động.",
            "href": "/admin/users?status=inactive",
        },
    ]
    assert len(cursor.calls) == 2
    assert cursor.calls[1][1] == (AdminOverviewRepository.RECENT_ORGANIZATION_LIMIT,)


def test_overview_api_denies_non_super_admin_before_reading_data(monkeypatch):
    overview_reads = []
    monkeypatch.setattr(
        api,
        "verify_session",
        lambda _request, _role: (False, "Bạn không có quyền thực hiện thao tác này!"),
    )

    async def database_read(function, *args, **kwargs):
        if function is api._read_overview:
            overview_reads.append(True)
        return function(*args)

    monkeypatch.setattr(api, "run_database_read", database_read)
    response = asyncio.run(api.admin_overview_api(SimpleNamespace()))

    assert response.status_code == 403
    assert _payload(response)["code"] == "SUPER_ADMIN_REQUIRED"
    assert response.headers["cache-control"] == "private, no-store"
    assert overview_reads == []


def test_overview_api_authorizes_super_admin_and_returns_no_store_payload(monkeypatch):
    authorization_calls = []

    def verify(request, role):
        authorization_calls.append((request, role))
        return True, SimpleNamespace(user_id="admin-1")

    async def database_read(function, *args, **kwargs):
        if function is api._read_overview:
            return {
                "generatedAt": "2026-09-10T01:02:03Z",
                "metrics": {},
                "recentOrganizations": [],
            }
        return function(*args)

    monkeypatch.setattr(api, "verify_session", verify)
    monkeypatch.setattr(api, "run_database_read", database_read)
    request = SimpleNamespace()
    response = asyncio.run(api.admin_overview_api(request))

    assert response.status_code == 200
    assert authorization_calls == [(request, "super_admin")]
    assert response.headers["cache-control"] == "private, no-store"
    assert _payload(response)["recentOrganizations"] == []


def test_overview_route_is_get_only():
    class _Route:
        def __init__(self, path, endpoint, methods):
            self.path = path
            self.endpoint = endpoint
            self.methods = methods

    routes = api.admin_routes(_Route)

    assert len(routes) == 1
    assert routes[0].path == "/api/admin/overview"
    assert routes[0].endpoint is api.admin_overview_api
    assert routes[0].methods == ["GET"]
