import asyncio
import json
from datetime import date, datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

from backend.documents import document_worker, routes_docx
from backend.usage_analytics import routes
from backend.usage_analytics.service import (
    FEATURE_EVENT_HOURLY_CAP,
    FEATURE_METRIC,
    PRODUCT_TIMEZONE_NAME,
    PRESENCE_METRIC,
    UsageAnalyticsInputError,
    build_usage_summary,
    parse_summary_window,
    record_client_event,
)


@pytest.fixture(autouse=True)
def _fresh_usage_rate_limiter(monkeypatch):
    monkeypatch.setattr(routes, "_rate_limiter", routes._UsageAnalyticsRateLimiter())


class _Request:
    def __init__(self, payload=None, *, query_params=None):
        self._payload = payload
        self.query_params = query_params or {}

    async def json(self):
        return self._payload


def _payload(response):
    return json.loads(response.body)


def test_event_endpoint_requires_an_authenticated_session_before_accepting_data(
    monkeypatch,
):
    database_writes = []

    monkeypatch.setattr(
        routes,
        "verify_session",
        lambda _request: (False, "Phiên đăng nhập không hợp lệ."),
    )

    async def database_read(function, *args, **kwargs):
        assert kwargs == {"timeout_seconds": 5}
        return function(*args)

    async def database_write(*args, **kwargs):
        database_writes.append((args, kwargs))

    monkeypatch.setattr(routes, "run_database_read", database_read)
    monkeypatch.setattr(routes, "run_database_write", database_write)

    response = asyncio.run(
        routes.usage_analytics_event_api(_Request({"eventType": "heartbeat"}))
    )

    assert response.status_code == 403
    assert _payload(response)["code"] == "SESSION_REQUIRED"
    assert database_writes == []


@pytest.mark.parametrize(
    "payload",
    [
        {"eventType": "page_view", "feature": "dashboard"},
        {"eventType": "feature_used"},
        {"eventType": "feature_used", "feature": "not-registered"},
        {"eventType": "feature_used", "feature": 123},
        {"eventType": "heartbeat", "recordId": "record-sensitive"},
        {
            "eventType": "feature_used",
            "feature": "plans",
            "url": "/kehoach?id=record-sensitive",
        },
    ],
)
def test_event_endpoint_rejects_values_outside_the_code_owned_allowlist(
    monkeypatch,
    payload,
):
    database_writes = []
    monkeypatch.setattr(
        routes,
        "verify_session",
        lambda _request: (True, SimpleNamespace(user_id="user-1")),
    )

    async def database_read(function, *args, **kwargs):
        return function(*args)

    async def database_write(*args, **kwargs):
        database_writes.append((args, kwargs))

    monkeypatch.setattr(routes, "run_database_read", database_read)
    monkeypatch.setattr(routes, "run_database_write", database_write)

    response = asyncio.run(routes.usage_analytics_event_api(_Request(payload)))

    assert response.status_code == 400
    assert _payload(response)["code"] == "USAGE_ANALYTICS_EVENT_INVALID"
    assert database_writes == []


@pytest.mark.parametrize(
    ("payload", "expected_event", "expected_feature"),
    [
        ({"eventType": "heartbeat"}, "heartbeat", None),
        (
            {"eventType": "feature_used", "feature": "  PLANS  "},
            "feature_used",
            "plans",
        ),
    ],
)
def test_event_endpoint_accepts_only_bounded_registered_signals(
    monkeypatch,
    payload,
    expected_event,
    expected_feature,
):
    writes = []
    session = SimpleNamespace(user_id="user-1")
    monkeypatch.setattr(routes, "verify_session", lambda _request: (True, session))

    async def database_read(function, *args, **kwargs):
        return function(*args)

    async def database_write(function, *args, **kwargs):
        writes.append((function, args, kwargs))

    monkeypatch.setattr(routes, "run_database_read", database_read)
    monkeypatch.setattr(routes, "run_database_write", database_write)

    response = asyncio.run(routes.usage_analytics_event_api(_Request(payload)))

    assert response.status_code == 202
    assert _payload(response) == {"accepted": True}
    assert len(writes) == 1
    assert writes[0][0] is routes._write_event
    assert writes[0][1][1:] == (session, expected_event, expected_feature)


def test_summary_window_uses_inclusive_vietnam_dates_and_a_half_open_epoch_range():
    window = parse_summary_window(
        {"from": "2026-02-28", "to": "2026-03-01", "bucket": "hour"}
    )
    vietnam = ZoneInfo(PRODUCT_TIMEZONE_NAME)

    assert window.from_date == date(2026, 2, 28)
    assert window.to_date == date(2026, 3, 1)
    assert window.start_epoch == int(datetime(2026, 2, 28, tzinfo=vietnam).timestamp())
    assert window.end_epoch == int(datetime(2026, 3, 2, tzinfo=vietnam).timestamp())
    assert window.end_epoch - window.start_epoch == 2 * 86_400
    assert window.bucket == "hour"
    assert window.bucket_seconds == 3_600


@pytest.mark.parametrize(
    "params",
    [
        {"from": "2026-02-30", "to": "2026-03-01"},
        {"from": "30-08-2026", "to": "2026-08-30"},
        {"from": "2026-08-31", "to": "2026-08-30"},
        {"from": "2025-01-01", "to": "2026-01-02"},
        {"from": "2026-08-01", "to": "2026-08-30", "bucket": "week"},
    ],
)
def test_summary_window_rejects_invalid_or_unbounded_ranges(params):
    with pytest.raises(UsageAnalyticsInputError):
        parse_summary_window(params)


def test_client_event_rollups_are_hourly_bounded_and_use_code_owned_dimensions():
    class Cursor:
        def __init__(self):
            self.calls = []

        def execute(self, statement, params=()):
            self.calls.append((" ".join(statement.split()), tuple(params)))
            return self

    cursor = Cursor()
    record_client_event(
        cursor,
        event_type="heartbeat",
        user_id="user-1",
        organization_id="personal:user-1",
        now=3_661,
    )
    record_client_event(
        cursor,
        event_type="feature_used",
        feature="plans",
        user_id="user-1",
        organization_id="org-1",
        now=7_299,
    )

    heartbeat_sql, heartbeat_params = cursor.calls[0]
    assert heartbeat_params == (
        3_600,
        "user-1",
        "personal:user-1",
        "personal",
        PRESENCE_METRIC,
        3_661,
        3_661,
    )
    assert "event_count =" not in heartbeat_sql.split("DO UPDATE SET", 1)[1]
    feature_sql, feature_params = cursor.calls[1]
    assert feature_params[:6] == (
        7_200,
        "user-1",
        "org-1",
        "organization",
        FEATURE_METRIC,
        "plans",
    )
    assert feature_params[-1] == FEATURE_EVENT_HOURLY_CAP
    assert "event_count = LEAST" in feature_sql


def test_client_event_rejects_cross_user_personal_workspace():
    with pytest.raises(UsageAnalyticsInputError):
        record_client_event(
            SimpleNamespace(execute=lambda *_args, **_kwargs: None),
            event_type="heartbeat",
            user_id="user-1",
            organization_id="personal:user-2",
            now=3_661,
        )


class _Result:
    def __init__(self, value):
        self.value = value

    def fetchone(self):
        return self.value

    def fetchall(self):
        return self.value


class _ScriptedCursor:
    def __init__(self, results):
        self.results = list(results)
        self.calls = []

    def execute(self, statement, parameters=()):
        self.calls.append((statement, parameters))
        if not self.results:
            raise AssertionError("Aggregation executed an unexpected query")
        return _Result(self.results.pop(0))


def test_usage_summary_aggregates_distinct_users_counts_averages_and_earliest_peak():
    window = parse_summary_window(
        {"from": "2026-08-30", "to": "2026-08-30", "bucket": "hour"}
    )
    cursor = _ScriptedCursor(
        [
            {"online_now": 3},
            {"telemetry_started_at": window.start_epoch},
            [
                {"bucket_start": window.start_epoch, "user_count": 5},
                {"bucket_start": window.start_epoch + 3_600, "user_count": 5},
                {"bucket_start": window.start_epoch + 7_200, "user_count": 2},
            ],
            [
                {"feature_key": "plans", "event_count": 7, "unique_users": 3},
                {
                    "feature_key": "contracts",
                    "event_count": 2,
                    "unique_users": 1,
                },
                {
                    "feature_key": "unregistered-feature",
                    "event_count": 99,
                    "unique_users": 99,
                },
            ],
            {
                "active_users": 4,
                "feature_uses": 9,
                "work_activities": 6,
                "word_exports": 2,
            },
        ]
    )

    summary = build_usage_summary(cursor, window, now=window.end_epoch + 120)

    assert summary["timezone"] == "Asia/Ho_Chi_Minh"
    assert summary["onlineNow"] == 3
    assert summary["coverage"] == {
        "hasData": True,
        "startedAt": summary["concurrencySeries"][0]["timestamp"],
        "partial": False,
    }
    assert summary["activeUsers"] == 4
    assert summary["featureUseCount"] == 9
    assert summary["workActivityCount"] == 6
    assert summary["wordExportCount"] == 2
    assert summary["eventCount"] == 17
    assert summary["averages"] == {
        "jobsPerActiveUser": 1.5,
        "wordExportsPerActiveUser": 0.5,
    }
    assert [item["feature"] for item in summary["topFeatures"]] == [
        "plans",
        "contracts",
    ]
    assert summary["topFeatures"][0] == {
        "feature": "plans",
        "label": "Kế hoạch lựa chọn nhà thầu",
        "count": 7,
        "uniqueUsers": 3,
    }
    assert summary["peakConcurrency"] == {
        "count": 5,
        "start": summary["concurrencySeries"][0]["timestamp"],
        "end": summary["concurrencySeries"][1]["timestamp"],
    }
    assert summary["definitions"]["eventCountExcludesPresence"] is True
    assert summary["definitions"]["activeUsersExcludePresenceOnly"] is True
    assert len(cursor.calls) == 5
    assert cursor.results == []


def test_usage_summary_returns_zero_averages_when_nobody_was_active():
    window = parse_summary_window(
        {"from": "2026-08-30", "to": "2026-08-30", "bucket": "day"}
    )
    cursor = _ScriptedCursor(
        [
            {"online_now": 0},
            {"telemetry_started_at": window.start_epoch},
            [],
            [],
            {
                "active_users": 0,
                "feature_uses": 0,
                "work_activities": 0,
                "word_exports": 0,
            },
        ]
    )

    summary = build_usage_summary(cursor, window, now=window.end_epoch)

    assert summary["averages"] == {
        "jobsPerActiveUser": 0,
        "wordExportsPerActiveUser": 0,
    }
    assert summary["peakConcurrency"] == {"count": 0, "start": None, "end": None}
    assert summary["eventCount"] == 0


def test_usage_summary_does_not_present_pre_rollout_history_as_zero_usage():
    window = parse_summary_window(
        {"from": "2026-08-01", "to": "2026-08-29", "bucket": "day"}
    )
    cursor = _ScriptedCursor(
        [
            {"online_now": 2},
            {"telemetry_started_at": window.end_epoch + 3_600},
        ]
    )

    summary = build_usage_summary(cursor, window, now=window.end_epoch + 7_200)

    assert summary["coverage"] == {
        "hasData": False,
        "startedAt": None,
        "partial": False,
    }
    assert summary["concurrencySeries"] == []
    assert summary["topFeatures"] == []
    assert summary["eventCount"] == 0
    assert len(cursor.calls) == 2


def test_usage_summary_marks_partial_coverage_and_clamps_activity_history():
    window = parse_summary_window(
        {"from": "2026-08-29", "to": "2026-08-30", "bucket": "hour"}
    )
    telemetry_started_at = window.start_epoch + 26 * 3_600 + 17
    cursor = _ScriptedCursor(
        [
            {"online_now": 1},
            {"telemetry_started_at": telemetry_started_at},
            [],
            [],
            {
                "active_users": 1,
                "feature_uses": 1,
                "work_activities": 1,
                "word_exports": 0,
            },
        ]
    )

    summary = build_usage_summary(cursor, window, now=window.end_epoch)

    assert summary["coverage"]["hasData"] is True
    assert summary["coverage"]["partial"] is True
    assert summary["coverage"]["startedAt"].endswith("Z")
    series_params = cursor.calls[2][1]
    assert series_params[3] == telemetry_started_at - 17
    totals_params = cursor.calls[4][1]
    assert totals_params[4] == telemetry_started_at
    assert totals_params[9] == telemetry_started_at
    assert summary["concurrencySeries"][0]["timestamp"].endswith("Z")


def test_event_endpoint_rate_limits_authenticated_user_with_bounded_memory(
    monkeypatch,
):
    limiter = routes._UsageAnalyticsRateLimiter(limit=1, max_keys=16)
    monkeypatch.setattr(routes, "_rate_limiter", limiter)
    monkeypatch.setattr(
        routes,
        "verify_session",
        lambda _request: (True, SimpleNamespace(user_id="user-rate-limited")),
    )

    async def database_read(function, *args, **kwargs):
        return function(*args)

    async def database_write(*_args, **_kwargs):
        return None

    monkeypatch.setattr(routes, "run_database_read", database_read)
    monkeypatch.setattr(routes, "run_database_write", database_write)

    accepted = asyncio.run(
        routes.usage_analytics_event_api(_Request({"eventType": "heartbeat"}))
    )
    limited = asyncio.run(
        routes.usage_analytics_event_api(_Request({"eventType": "heartbeat"}))
    )

    assert accepted.status_code == 202
    assert limited.status_code == 429
    assert limited.headers["Retry-After"] == "60"


def test_event_endpoint_drops_missing_workspace_signal_without_stopping_tracker(
    monkeypatch,
):
    monkeypatch.setattr(
        routes,
        "verify_session",
        lambda _request: (True, SimpleNamespace(user_id="platform-admin")),
    )

    async def database_read(function, *args, **kwargs):
        return function(*args)

    async def database_write(*_args, **_kwargs):
        raise routes.OrgPermissionError("no customer workspace")

    monkeypatch.setattr(routes, "run_database_read", database_read)
    monkeypatch.setattr(routes, "run_database_write", database_write)
    monkeypatch.setattr(routes, "log_error", lambda *_args, **_kwargs: None)

    response = asyncio.run(
        routes.usage_analytics_event_api(_Request({"eventType": "heartbeat"}))
    )

    assert response.status_code == 202
    assert _payload(response) == {"accepted": True}


def test_summary_endpoint_requires_super_admin_and_rejects_bad_dates_before_reading(
    monkeypatch,
):
    required_roles = []
    database_reads = []

    def verify(_request, required_role):
        required_roles.append(required_role)
        return True, SimpleNamespace(user_id="admin-1")

    async def database_read(function, *args, **kwargs):
        database_reads.append((function, args, kwargs))
        return function(*args)

    monkeypatch.setattr(routes, "verify_session", verify)
    monkeypatch.setattr(routes, "run_database_read", database_read)

    response = asyncio.run(
        routes.usage_analytics_summary_api(
            _Request(query_params={"from": "2026-02-30", "to": "2026-03-01"})
        )
    )

    assert required_roles == ["super_admin"]
    assert response.status_code == 400
    assert _payload(response)["code"] == "USAGE_ANALYTICS_RANGE_INVALID"
    assert len(database_reads) == 1
    assert database_reads[0][0] is verify


def test_summary_endpoint_denies_a_non_super_admin_before_reading_analytics(
    monkeypatch,
):
    database_reads = []

    def verify(_request, required_role):
        assert required_role == "super_admin"
        return False, "Không có quyền quản trị nền tảng."

    async def database_read(function, *args, **kwargs):
        database_reads.append((function, args, kwargs))
        return function(*args)

    monkeypatch.setattr(routes, "verify_session", verify)
    monkeypatch.setattr(routes, "run_database_read", database_read)

    response = asyncio.run(
        routes.usage_analytics_summary_api(
            _Request(query_params={"from": "2026-08-01", "to": "2026-08-30"})
        )
    )

    assert response.status_code == 403
    assert _payload(response)["code"] == "SUPER_ADMIN_REQUIRED"
    assert len(database_reads) == 1
    assert database_reads[0][0] is verify


def test_direct_word_success_is_recorded_in_the_required_audit_transaction(
    monkeypatch,
):
    cursor = object()
    observed = {"began": False, "committed": False, "closed": False}

    class Connection:
        def execute(self, statement, _params=()):
            if statement == "BEGIN":
                observed["began"] = True
            return SimpleNamespace(rowcount=1)

        def cursor(self):
            return cursor

        def commit(self):
            observed["committed"] = True

        def rollback(self):
            observed["rolled_back"] = True

        def close(self):
            observed["closed"] = True

    monkeypatch.setattr(
        routes_docx,
        "database",
        SimpleNamespace(get_connection=lambda: Connection()),
    )
    monkeypatch.setattr(
        routes_docx,
        "log_audit",
        lambda action, **kwargs: observed.update(
            audit_action=action,
            audit_cursor=kwargs["cursor"],
        ),
    )
    monkeypatch.setattr(
        routes_docx,
        "record_word_export_success_best_effort",
        lambda value, **kwargs: observed.update(
            metric_cursor=value,
            metric=kwargs,
        ),
    )

    routes_docx._commit_word_export_audit(
        request=SimpleNamespace(),
        actor_user_id="user-1",
        organization_id="org-1",
        target_type="goi_thau",
        target_id="package-1",
        record_row_version=7,
        document_type="evaluation",
        publication_type="",
        template_count=1,
        sensitive_groups=[],
        rendered_artifacts=[],
    )

    assert observed["audit_action"] == "document.word_exported"
    assert observed["audit_cursor"] is cursor
    assert observed["metric_cursor"] is cursor
    assert observed["metric"] == {
        "user_id": "user-1",
        "organization_id": "org-1",
    }
    assert observed["began"] is True
    assert observed["committed"] is True
    assert observed["closed"] is True
    assert "rolled_back" not in observed


@pytest.mark.parametrize(
    ("operation", "rowcount", "error", "expected_metric_count"),
    [
        ("render_docx", 1, None, 1),
        ("render_docx_batch", 0, None, 0),
        ("export_excel", 1, None, 0),
        ("render_docx", 1, RuntimeError("failed"), 0),
    ],
)
def test_durable_word_metric_requires_the_unique_completed_transition(
    monkeypatch,
    operation,
    rowcount,
    error,
    expected_metric_count,
):
    metric_calls = []

    class Connection:
        def execute(self, statement, _params=()):
            assert "UPDATE document_jobs" in statement
            return SimpleNamespace(rowcount=rowcount)

        def cursor(self):
            return self

        def commit(self):
            return None

        def rollback(self):
            return None

        def close(self):
            return None

    database = SimpleNamespace(get_connection=lambda: Connection())
    monkeypatch.setattr(
        document_worker,
        "validate_document_job_policy_snapshot",
        lambda *_args, **_kwargs: {},
    )
    monkeypatch.setattr(
        document_worker,
        "record_word_export_success_best_effort",
        lambda cursor, **kwargs: metric_calls.append((cursor, kwargs)),
    )
    claimed = {
        "id": "job-1",
        "operation": operation,
        "organization_id": "org-1",
        "user_id": "user-1",
        "record_type": "goi_thau",
        "record_id": "package-1",
        "policy_json": {},
        "policy_hash": "hash",
        "attempt_count": 1,
        "lock_token": "worker-1",
        "progress_total_items": 1,
        "progress_completed_items": 0,
    }

    document_worker._finish_durable_document_job(
        database,
        claimed,
        error=error,
        result=b"rendered" if error is None else None,
    )

    assert len(metric_calls) == expected_metric_count
    if metric_calls:
        assert metric_calls[0][1]["user_id"] == "user-1"
        assert metric_calls[0][1]["organization_id"] == "org-1"
