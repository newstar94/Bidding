import asyncio
import json
from types import SimpleNamespace

import pytest

from backend.product_analytics.events import (
    AnalyticsEventError,
    normalize_commercial_event,
    normalize_commercial_feedback,
)
from backend.product_analytics import routes
from backend.product_analytics.plan_fit import classify_plan_fit
from backend.product_analytics.privacy import analytics_identifier
from backend.product_analytics.quality import run_data_quality_checks
from backend.product_analytics.query_service import (
    _association_summary,
    _date_range,
    _funnel_stage_timings,
    _ordered_funnel,
    _percentile_summary,
    _relative_change,
    _seat_bucket_exact,
    _latest_usage_snapshot,
    _workspace_count_trend,
    _threshold_insights,
    suppress_small_cohorts,
)
from backend.product_analytics.taxonomy import (
    COMMERCIAL_EVENT_KEYS,
    MEANINGFUL_FEATURE_KEYS,
)


def test_taxonomy_contains_only_reviewed_product_and_commercial_keys():
    assert "planning.create" in MEANINGFUL_FEATURE_KEYS
    assert "document.word_export" in MEANINGFUL_FEATURE_KEYS
    assert "pricing.offer_selected" in COMMERCIAL_EVENT_KEYS
    assert "payment.verified" not in COMMERCIAL_EVENT_KEYS
    assert all(" " not in key and key == key.lower() for key in MEANINGFUL_FEATURE_KEYS)


def test_commercial_event_is_strict_pseudonymous_and_release_pinned():
    event = normalize_commercial_event(
        {
            "event": "pricing.offer_selected",
            "eventId": "0d242159-5007-4d15-b6d5-a496918d2757",
            "ownerKind": "organization",
            "sizeBucket": "6_15",
            "skuCode": "gold-connected-yearly",
            "commercialReleaseId": "release-2026-pilot",
            "source": "pricing_page",
            "occurredAt": 1_788_112_345,
        },
        user_id="user-1",
        workspace_id="org-1",
        hmac_key="analytics-test-key-with-enough-entropy",
        now=1_788_112_400,
    )

    assert event["event_name"] == "pricing.offer_selected"
    assert event["analytics_user_id"] != "user-1"
    assert event["analytics_workspace_id"] != "org-1"
    assert len(event["analytics_user_id"]) == 64
    assert event["commercial_release_id"] == "release-2026-pilot"
    assert set(event) == {
        "event_id", "event_name", "analytics_user_id",
        "analytics_workspace_id", "owner_kind", "size_bucket",
        "sku_code", "commercial_release_id", "source", "occurred_at",
        "received_at",
    }


@pytest.mark.parametrize(
    "payload",
    [
        {"event": "payment.verified", "commercialReleaseId": "r1"},
        {"event": "pricing.viewed", "commercialReleaseId": "r1", "email": "x@y.vn"},
        {"event": "pricing.viewed"},
        {"event": "pricing.viewed", "commercialReleaseId": "r1", "occurredAt": 9_999_999_999},
    ],
)
def test_commercial_event_rejects_authoritative_unknown_sensitive_or_invalid_data(payload):
    with pytest.raises(AnalyticsEventError):
        normalize_commercial_event(
            payload,
            user_id="user-1",
            workspace_id="personal:user-1",
            hmac_key="analytics-test-key-with-enough-entropy",
            now=1_788_112_400,
        )


def test_optional_commercial_feedback_is_structured_and_has_no_free_text():
    feedback = normalize_commercial_feedback(
        {
            "moment": "checkout_abandoned", "reason": "too_expensive",
            "commercialReleaseId": "release-1", "ownerKind": "organization",
        },
        workspace_id="org-1", hmac_key="analytics-test-key-with-enough-entropy",
        now=1_788_112_400,
    )
    assert feedback["analytics_workspace_id"] != "org-1"
    assert feedback["moment"] == "checkout_abandoned"
    assert feedback["reason"] == "too_expensive"
    with pytest.raises(AnalyticsEventError):
        normalize_commercial_feedback(
            {"moment": "checkout_abandoned", "reason": "other", "comment": "raw text",
             "commercialReleaseId": "release-1"},
            workspace_id="org-1", hmac_key="analytics-test-key-with-enough-entropy",
            now=1_788_112_400,
        )


def test_analytics_hmac_is_stable_namespaced_and_not_raw_hashing():
    first = analytics_identifier("user", "same-id", "analytics-key-123456789")
    second = analytics_identifier("workspace", "same-id", "analytics-key-123456789")
    assert first == analytics_identifier("user", "same-id", "analytics-key-123456789")
    assert first != second


def test_small_cohorts_are_suppressed_without_changing_large_aggregates():
    rows = [
        {"segment": "small", "workspaceCount": 9, "retention": 0.8},
        {"segment": "large", "workspaceCount": 10, "retention": 0.6},
    ]
    assert suppress_small_cohorts(rows) == [
        {
            "segment": "small",
            "workspaceCount": None,
            "suppressed": True,
            "status": "insufficient_sample",
        },
        {"segment": "large", "workspaceCount": 10, "retention": 0.6},
    ]


def test_plan_fit_is_analysis_only_and_uses_versioned_evidence_rules():
    result = classify_plan_fit({
        "seat_utilization": 0.91,
        "quota_utilization": 0.84,
        "pressure_months": 2,
        "topup_spend": 400_000,
        "price_gap_to_next_plan": 1_000_000,
        "active_seats": 12,
        "variant": "connected",
    })
    assert result["classification"] == "UNDER_SIZED"
    assert result["strength"] == "strong"
    assert result["ruleVersion"] == "plan-fit-v1"
    assert result["automaticAction"] is None

    enterprise = classify_plan_fit({"active_seats": 51, "pressure_months": 1})
    assert enterprise["classification"] == "ENTERPRISE_CANDIDATE"
    assert enterprise["automaticAction"] is None

    repeated_seat_pressure = classify_plan_fit({
        "active_seats": 4, "seat_utilization": 0.85,
        "quota_utilization": 0.1, "pressure_months": 2,
    })
    assert repeated_seat_pressure["classification"] == "UNDER_SIZED"
    assert repeated_seat_pressure["strength"] == "candidate"


def test_analytics_date_range_is_inclusive_and_bounded():
    assert _date_range("2026-08-01", "2026-08-30")[1].isoformat() == "2026-08-30"
    with pytest.raises(ValueError):
        _date_range("2026-08-30", "2026-08-01")
    with pytest.raises(ValueError):
        _date_range("2025-01-01", "2026-08-30")


def test_seat_distribution_uses_pricing_review_bins_and_required_percentiles():
    values = [1, 2, 3, 5, 6, 10, 11, 15, 16, 25, 26, 50, 51, 99]
    assert [_seat_bucket_exact(value) for value in values] == [
        "1", "2", "3_5", "3_5", "6_10", "6_10", "11_15", "11_15",
        "16_25", "16_25", "26_50", "26_50", "over_50", "over_50",
    ]
    summary = _percentile_summary(values, (10, 25, 50, 60, 75, 80, 90, 95, 99))
    assert list(summary) == ["P10", "P25", "P50", "P60", "P75", "P80", "P90", "P95", "P99", "Max"]
    assert summary["P50"] == 11
    assert summary["P90"] == 51
    assert summary["Max"] == 99


def test_funnel_is_ordered_and_conversion_never_claims_more_than_prior_stage():
    result = _ordered_funnel([
        {"event_name": "payment.verified", "event_count": 25, "unique_workspaces": 20},
        {"event_name": "pricing.viewed", "event_count": 100, "unique_workspaces": 80},
        {"event_name": "checkout.created", "event_count": 45, "unique_workspaces": 40},
    ])
    assert [row["stage"] for row in result] == [
        "pricing.viewed", "checkout.created", "payment.verified",
    ]
    assert result[0]["stepConversionRate"] is None
    assert result[1]["stepConversionRate"] == 0.5
    assert result[1]["abandonmentRate"] == 0.5
    assert result[2]["overallConversionRate"] == 0.25


def test_funnel_stage_timing_uses_ordered_aggregate_journeys_and_suppresses_small_samples():
    rows = []
    for index in range(10):
        workspace = f"workspace-{index}"
        rows.extend((
            {
                "analytics_workspace_id": workspace,
                "commercial_release_id": "release-1",
                "event_name": "pricing.viewed",
                "first_occurred_at": 1_000 + index,
            },
            {
                "analytics_workspace_id": workspace,
                "commercial_release_id": "release-1",
                "event_name": "pricing.size_selected",
                "first_occurred_at": 1_060 + index,
            },
        ))
    rows.extend((
        {
            "analytics_workspace_id": "out-of-order",
            "commercial_release_id": "release-1",
            "event_name": "pricing.viewed",
            "first_occurred_at": 2_000,
        },
        {
            "analytics_workspace_id": "out-of-order",
            "commercial_release_id": "release-1",
            "event_name": "pricing.size_selected",
            "first_occurred_at": 1_999,
        },
    ))

    timing = _funnel_stage_timings(rows)[0]
    assert timing == {
        "fromStage": "pricing.viewed",
        "toStage": "pricing.size_selected",
        "medianSeconds": 60,
        "observedJourneys": 10,
        "status": "available",
    }
    insufficient = _funnel_stage_timings(rows[:18])[0]
    assert insufficient["status"] == "insufficient_sample"
    assert insufficient["medianSeconds"] is None
    assert insufficient["observedJourneys"] is None


def test_feature_association_is_descriptive_suppressed_and_not_causal():
    insufficient = _association_summary(9, 7, 2, 2)
    assert insufficient == {"status": "insufficient_sample", "workspaceCount": None}

    result = _association_summary(30, 18, 18, 16)
    assert result["status"] == "available"
    assert result["adopterRate"] == pytest.approx(16 / 18)
    assert result["nonAdopterRate"] == pytest.approx(2 / 12)
    assert result["percentagePointDifference"] == pytest.approx((16 / 18 - 2 / 12) * 100)
    assert result["causalClaim"] is False


def test_overview_insights_are_deterministic_and_ignore_suppressed_mix():
    result = _threshold_insights({
        "mix": [
            {"variant": "connected", "workspaceCount": 30},
            {"variant": "internal", "workspaceCount": 15},
            {"variant": "unknown", "workspaceCount": 2, "suppressed": True},
        ],
        "topupRevenueTrend": [{"date": "2026-08-30", "value": 250_000}],
        "tierTable": [{"atOrAbove80Percent": 0.5}],
    })
    assert [item["key"] for item in result] == [
        "connected_mix", "topup_revenue", "seat_pressure",
    ]
    assert all(item["status"] == "descriptive" for item in result)


def test_overview_snapshot_and_comparison_use_latest_rolling_day():
    rows = [
        {"usage_date": "2026-08-29", "analytics_workspace_id": "a", "active_seats": 8,
         "registered_seats": 10, "power_seats": 3},
        {"usage_date": "2026-08-30", "analytics_workspace_id": "a", "active_seats": 5,
         "registered_seats": 10, "power_seats": 2},
        {"usage_date": "2026-08-30", "analytics_workspace_id": "b", "active_seats": 2,
         "registered_seats": 4, "power_seats": 1},
    ]
    assert _latest_usage_snapshot(rows) == {
        "date": "2026-08-30", "monthlyActiveWorkspaces": 2,
        "monthlyActiveSeats": 7, "registeredSeats": 14, "powerSeats": 3,
    }
    assert _workspace_count_trend(rows) == [
        {"date": "2026-08-29", "value": 1},
        {"date": "2026-08-30", "value": 2},
    ]
    assert _relative_change(120, 100) == pytest.approx(0.2)
    assert _relative_change(10, 0) is None


class _QualityCursor:
    def __init__(self, counts):
        self.counts = iter(counts)

    def execute(self, _sql, _parameters=()):
        return self

    def fetchone(self):
        return (next(self.counts),)


def test_data_quality_report_separates_errors_and_warnings():
    report = run_data_quality_checks(_QualityCursor([0, 0, 0, 3, 0, 0, 0, 0]))
    assert report["ok"] is True
    assert next(item for item in report["checks"] if item["code"] == "unknown_feature_key") == {
        "code": "unknown_feature_key", "severity": "warning", "count": 3, "ok": False,
    }

    report = run_data_quality_checks(_QualityCursor([1, 0, 0, 0, 0, 0, 0, 0]))
    assert report["ok"] is False


class _Request:
    def __init__(self, payload=None, query_params=None):
        self._payload = payload
        self.query_params = query_params or {}

    async def json(self):
        return self._payload


def _body(response):
    return json.loads(response.body)


def test_dashboard_api_requires_super_admin_before_querying_aggregates(monkeypatch):
    calls = []
    monkeypatch.setattr(routes, "verify_session", lambda *_args: (False, "forbidden"))

    async def database_read(function, *args, **kwargs):
        calls.append((function, args, kwargs))
        return function(*args)

    monkeypatch.setattr(routes, "run_database_read", database_read)
    response = asyncio.run(routes.commercial_analytics_dashboard_api(_Request()))
    assert response.status_code == 403
    assert _body(response)["code"] == "SUPER_ADMIN_REQUIRED"
    assert len(calls) == 1


def test_dashboard_api_passes_bounded_filters_to_aggregate_query(monkeypatch):
    session = SimpleNamespace(user_id="super-1")
    monkeypatch.setattr(routes, "verify_session", lambda *_args: (True, session))
    captured = {}

    async def database_read(function, *args, **kwargs):
        if function is routes.verify_session:
            return function(*args)
        captured.update(args[0])
        return {"hasData": False, "view": args[0]["view"]}

    monkeypatch.setattr(routes, "run_database_read", database_read)
    request = _Request(query_params={
        "from": "2026-08-01", "to": "2026-08-30", "view": "plan-fit",
        "ownerKind": "organization", "variant": "connected",
        "releaseId": "release-1", "releaseMode": "live", "sizeBucket": "6_15", "plan": "gold",
        "paidState": "paid",
    })
    response = asyncio.run(routes.commercial_analytics_dashboard_api(request))
    assert response.status_code == 200
    assert captured == {
        "from_date": "2026-08-01", "to_date": "2026-08-30", "view": "plan-fit",
        "page": 1, "page_size": 50,
        "filters": {"ownerKind": "organization", "variant": "connected",
                    "sizeBucket": "6_15", "releaseId": "release-1",
                    "releaseMode": "live",
                    "plan": "gold", "paidState": "paid", "cohortKind": None,
                    "procurementIntensity": None, "collaborationIntensity": None,
                    "aiAdoption": None},
    }


def test_event_collector_is_best_effort_when_hmac_secret_is_absent(monkeypatch):
    monkeypatch.delenv("ANALYTICS_HMAC_KEY", raising=False)
    monkeypatch.setattr(
        routes, "verify_session", lambda *_args: (True, SimpleNamespace(user_id="user-1"))
    )

    async def database_read(function, *args, **_kwargs):
        return function(*args)

    monkeypatch.setattr(routes, "run_database_read", database_read)
    response = asyncio.run(routes.commercial_analytics_event_api(_Request({
        "event": "pricing.viewed", "commercialReleaseId": "release-1",
    })))
    assert response.status_code == 202
    assert _body(response) == {"accepted": True, "recorded": False}
