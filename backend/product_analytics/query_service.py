"""Aggregate-only analytics query helpers."""
# ruff: noqa: S608 -- dynamic predicates use allowlisted columns and parameters.

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta
import math
from zoneinfo import ZoneInfo

SMALL_COHORT_THRESHOLD = 10
PRICING_RECOMMENDATION_THRESHOLD = 20

FUNNEL_STAGE_ORDER = (
    "pricing.viewed", "pricing.size_selected", "pricing.variant_compared",
    "pricing.offer_selected", "quote.created", "checkout.created",
    "payment.verified", "subscription.activated", "first_paid_value",
)
SEAT_BUCKETS = ("1", "2", "3_5", "6_10", "11_15", "16_25", "26_50", "over_50")
PRODUCT_TIMEZONE = ZoneInfo("Asia/Ho_Chi_Minh")


def suppress_small_cohorts(rows, *, threshold=SMALL_COHORT_THRESHOLD):
    dimension_keys = {
        "segment", "cohort", "cohortKind", "weekNumber", "feature", "variant",
        "plan", "classification", "stage", "releaseId", "ownerKind",
        "sizeBucket", "skuCode", "currentTier", "label",
    }
    output = []
    for source in rows:
        row = dict(source)
        count = int(row.get("workspaceCount") or row.get("workspace_count") or 0)
        if count < threshold:
            output.append({
                **{key: value for key, value in row.items() if key in dimension_keys},
                "segment": row.get("segment") or row.get("cohort") or "Other",
                "workspaceCount": None,
                "suppressed": True,
                "status": "insufficient_sample",
            })
        else:
            output.append(row)
    return output


VIEWS = frozenset({
    "overview", "activation", "features", "seats", "procurement",
    "credits", "funnel", "retention", "economics", "plan-fit",
})


def _cohort_count(value, *, threshold=SMALL_COHORT_THRESHOLD):
    count = max(0, int(value or 0))
    return count if count >= threshold else None


def _row_dict(row):
    return dict(row) if hasattr(row, "keys") else row


def _date_range(from_date: str, to_date: str):
    start = date.fromisoformat(str(from_date))
    end = date.fromisoformat(str(to_date))
    if end < start or (end - start).days > 366:
        raise ValueError("Analytics date range is invalid or too broad.")
    return start, end


def _month_start(value):
    return value.replace(day=1)


def _where(filters, *, alias=""):
    prefix = f"{alias}." if alias else ""
    clauses = [f"{prefix}usage_date >= ?", f"{prefix}usage_date < ?"]
    params = [filters["from"], filters["to"]]
    if filters.get("ownerKind") in {"account", "organization"}:
        clauses.append(f"{prefix}owner_kind = ?")
        params.append(filters["ownerKind"])
    if filters.get("variant") in {"internal", "connected"}:
        clauses.append(f"{prefix}variant = ?")
        params.append(filters["variant"])
    if filters.get("sizeBucket"):
        clauses.append(f"{prefix}size_bucket = ?")
        params.append(filters["sizeBucket"])
    if filters.get("releaseId"):
        clauses.append(f"{prefix}commercial_release_id = ?")
        params.append(filters["releaseId"])
    release_mode = _release_mode_condition(f"{prefix}commercial_release_id", filters.get("releaseMode"))
    if release_mode:
        clauses.append(release_mode)
    if filters.get("plan"):
        clauses.append(f"{prefix}plan_code = ?")
        params.append(filters["plan"])
    if filters.get("paidState") == "paid":
        clauses.append(f"{prefix}plan_code != ''")
    elif filters.get("paidState") == "free":
        clauses.append(f"{prefix}plan_code = ''")
    return " AND ".join(clauses), tuple(params)


def _release_mode_condition(column, value):
    if value == "shadow":
        return f"{column} IN (SELECT id FROM commercial_releases WHERE mode='shadow')"
    if value == "live":
        return f"{column} IN (SELECT id FROM commercial_releases WHERE mode IN ('pilot','production'))"
    return ""


def _append_funnel_catalog_filters(
    clauses, params, filters, *, fact_table="commercial_funnel_workspace_daily",
):
    if fact_table not in {"commercial_funnel_workspace_daily", "credit_pack_purchase_daily"}:
        raise ValueError("Analytics catalog fact table is not supported.")
    conditions = []
    if filters.get("variant") in {"internal", "connected"}:
        conditions.append("catalog_plan.variant=?")
        params.append(filters["variant"])
    if filters.get("plan"):
        conditions.append("catalog_plan.logical_package_code=?")
        params.append(filters["plan"])
    if not conditions:
        return
    clauses.append(
        "EXISTS (SELECT 1 FROM billing_skus catalog_sku "
        "JOIN billing_plan_versions catalog_plan ON catalog_plan.id=catalog_sku.plan_version_id "
        f"WHERE catalog_sku.release_id={fact_table}.commercial_release_id "
        f"AND catalog_sku.sku_code={fact_table}.sku_code AND "
        + " AND ".join(conditions) + ")"
    )


def _auxiliary_data_count(cursor, filters):
    """Count non-usage facts only when every requested dimension is attributable."""

    start, end = filters["from"], filters["to"]
    counts = []

    if not filters.get("sizeBucket"):
        clauses = ["usage_date>=?", "usage_date<?"]
        params = [start, end]
        for value, column in (
            (filters.get("ownerKind"), "owner_kind"),
            (filters.get("releaseId"), "commercial_release_id"),
            (filters.get("variant"), "variant"),
            (filters.get("plan"), "plan_code"),
        ):
            if value:
                clauses.append(f"{column}=?")
                params.append(value)
        release_mode = _release_mode_condition("commercial_release_id", filters.get("releaseMode"))
        if release_mode:
            clauses.append(release_mode)
        if filters.get("paidState") == "paid":
            clauses.append("plan_code!=''")
        elif filters.get("paidState") == "free":
            clauses.append("plan_code=''")
        counts.append(cursor.execute(
            f"SELECT COUNT(*) FROM revenue_daily WHERE {' AND '.join(clauses)}", tuple(params)
        ).fetchone()[0])

        clauses[0:2] = ["snapshot_date>=?", "snapshot_date<?"]
        counts.append(cursor.execute(
            f"SELECT COUNT(*) FROM subscription_snapshot_daily WHERE {' AND '.join(clauses)}",
            tuple(params),
        ).fetchone()[0])

    if not filters.get("paidState"):
        clauses = ["usage_date>=?", "usage_date<?"]
        params = [start, end]
        for value, column in (
            (filters.get("ownerKind"), "owner_kind"),
            (filters.get("releaseId"), "commercial_release_id"),
            (filters.get("sizeBucket"), "size_bucket"),
        ):
            if value:
                clauses.append(f"{column}=?")
                params.append(value)
        release_mode = _release_mode_condition("commercial_release_id", filters.get("releaseMode"))
        if release_mode:
            clauses.append(release_mode)
        _append_funnel_catalog_filters(clauses, params, filters)
        counts.append(cursor.execute(
            f"SELECT COUNT(*) FROM commercial_funnel_workspace_daily WHERE {' AND '.join(clauses)}",
            tuple(params),
        ).fetchone()[0])

    clauses = [
        "signup_at>=EXTRACT(EPOCH FROM ?::date)",
        "signup_at<EXTRACT(EPOCH FROM ?::date)",
    ]
    params = [start, end]
    for value, column in (
        (filters.get("ownerKind"), "owner_kind"),
        (filters.get("releaseId"), "commercial_release_id"),
        (filters.get("variant"), "variant"),
        (filters.get("plan"), "plan_code"),
        (filters.get("sizeBucket"), "size_bucket"),
    ):
        if value:
            clauses.append(f"{column}=?")
            params.append(value)
    release_mode = _release_mode_condition("commercial_release_id", filters.get("releaseMode"))
    if release_mode:
        clauses.append(release_mode)
    if filters.get("paidState") == "paid":
        clauses.append("subscription_activated_at IS NOT NULL")
    elif filters.get("paidState") == "free":
        clauses.append("subscription_activated_at IS NULL")
    counts.append(cursor.execute(
        f"SELECT COUNT(*) FROM workspace_activation_facts WHERE {' AND '.join(clauses)}",
        tuple(params),
    ).fetchone()[0])

    if not filters.get("sizeBucket") and filters.get("paidState") != "free":
        clauses = ["purchase_date>=?", "purchase_date<?"]
        params = [start, end]
        for value, column in (
            (filters.get("ownerKind"), "owner_kind"),
            (filters.get("releaseId"), "commercial_release_id"),
        ):
            if value:
                clauses.append(f"{column}=?")
                params.append(value)
        release_mode = _release_mode_condition("commercial_release_id", filters.get("releaseMode"))
        if release_mode:
            clauses.append(release_mode)
        _append_funnel_catalog_filters(
            clauses, params, filters, fact_table="credit_pack_purchase_daily",
        )
        counts.append(cursor.execute(
            f"SELECT COUNT(*) FROM credit_pack_purchase_daily WHERE {' AND '.join(clauses)}",
            tuple(params),
        ).fetchone()[0])

    return sum(max(0, int(count or 0)) for count in counts)


def _sum(rows, key):
    return sum(max(0, int(_row_dict(row).get(key) or 0)) for row in rows)


def _percentile_summary(values, percentiles):
    """Return discrete nearest-rank percentiles for count distributions."""

    ordered = sorted(max(0, int(value or 0)) for value in values)
    if not ordered:
        return {**{f"P{percentile}": None for percentile in percentiles}, "Max": None}
    result = {}
    for percentile in percentiles:
        rank = max(1, math.ceil((float(percentile) / 100.0) * len(ordered)))
        result[f"P{percentile}"] = ordered[min(rank, len(ordered)) - 1]
    result["Max"] = ordered[-1]
    return result


def _seat_bucket_exact(value):
    seats = max(0, int(value or 0))
    if seats <= 1:
        return "1"
    if seats == 2:
        return "2"
    if seats <= 5:
        return "3_5"
    if seats <= 10:
        return "6_10"
    if seats <= 15:
        return "11_15"
    if seats <= 25:
        return "16_25"
    if seats <= 50:
        return "26_50"
    return "over_50"


def _ordered_funnel(rows):
    by_stage = {str(_row_dict(row).get("event_name") or _row_dict(row).get("stage") or ""): _row_dict(row) for row in rows}
    present = [stage for stage in FUNNEL_STAGE_ORDER if stage in by_stage]
    output = []
    first = None
    previous = None
    for stage in present:
        source = by_stage[stage]
        count = max(0, int(source.get("event_count") or source.get("count") or 0))
        workspaces = max(0, int(source.get("unique_workspaces") or source.get("uniqueWorkspaces") or 0))
        if first is None:
            first = workspaces
        step_rate = None if previous is None or previous <= 0 else min(1.0, workspaces / previous)
        overall_rate = None if first is None or first <= 0 else min(1.0, workspaces / first)
        output.append({
            "stage": stage,
            "count": count,
            "uniqueWorkspaces": workspaces,
            "stepConversionRate": step_rate,
            "abandonmentRate": None if step_rate is None else 1.0 - step_rate,
            "overallConversionRate": overall_rate,
            "medianSecondsFromPriorStage": None,
        })
        previous = workspaces
    return output


def _association_summary(total, adopters, outcome_total, adopter_outcomes):
    """Describe an association; intentionally does not estimate causality."""

    total = max(0, int(total or 0))
    adopters = min(total, max(0, int(adopters or 0)))
    outcome_total = min(total, max(0, int(outcome_total or 0)))
    adopter_outcomes = min(adopters, max(0, int(adopter_outcomes or 0)))
    if total < SMALL_COHORT_THRESHOLD or adopters < SMALL_COHORT_THRESHOLD or total - adopters < SMALL_COHORT_THRESHOLD:
        return {"status": "insufficient_sample", "workspaceCount": None}
    adopter_rate = adopter_outcomes / adopters
    non_adopter_outcomes = max(0, outcome_total - adopter_outcomes)
    non_adopter_rate = non_adopter_outcomes / (total - adopters)
    return {
        "status": "available",
        "workspaceCount": total,
        "adopterRate": adopter_rate,
        "nonAdopterRate": non_adopter_rate,
        "percentagePointDifference": (adopter_rate - non_adopter_rate) * 100,
        "causalClaim": False,
    }


def _duration_percentiles(values):
    summary = _percentile_summary(values, (50, 75, 90))
    return {"medianSeconds": summary["P50"], "p75Seconds": summary["P75"], "p90Seconds": summary["P90"]}


def _funnel_stage_timings(rows):
    """Calculate ordered journey timing from pseudonymous aggregate facts."""

    journeys = defaultdict(dict)
    for source in rows:
        row = _row_dict(source)
        stage = str(row.get("event_name") or "")
        occurred_at = row.get("first_occurred_at")
        workspace_id = str(row.get("analytics_workspace_id") or "")
        release_id = str(row.get("commercial_release_id") or "")
        if stage not in FUNNEL_STAGE_ORDER or not workspace_id or occurred_at is None:
            continue
        key = (workspace_id, release_id)
        timestamp = int(occurred_at)
        current = journeys[key].get(stage)
        journeys[key][stage] = timestamp if current is None else min(current, timestamp)

    output = []
    for prior_stage, stage in zip(FUNNEL_STAGE_ORDER, FUNNEL_STAGE_ORDER[1:]):
        durations = []
        for journey in journeys.values():
            prior_at = journey.get(prior_stage)
            occurred_at = journey.get(stage)
            if prior_at is None or occurred_at is None or occurred_at < prior_at:
                continue
            durations.append(occurred_at - prior_at)
        if not durations:
            status = "not_available"
        elif len(durations) < SMALL_COHORT_THRESHOLD:
            status = "insufficient_sample"
        else:
            status = "available"
        output.append({
            "fromStage": prior_stage,
            "toStage": stage,
            "medianSeconds": (
                _duration_percentiles(durations)["medianSeconds"]
                if status == "available" else None
            ),
            "observedJourneys": len(durations) if status == "available" else None,
            "status": status,
        })
    return output


def _trend(rows, key):
    grouped = {}
    for row in rows:
        item = _row_dict(row)
        day = str(item.get("usage_date") or "")
        grouped[day] = grouped.get(day, 0) + max(0, int(item.get(key) or 0))
    return [{"date": day, "value": grouped[day]} for day in sorted(grouped)]


def _latest_usage_snapshot(rows):
    """Return rolling-30-day workspace metrics from the latest observed day."""

    normalized = [_row_dict(row) for row in rows]
    latest_day = max((str(row.get("usage_date") or "") for row in normalized), default="")
    latest = [row for row in normalized if str(row.get("usage_date") or "") == latest_day]
    return {
        "date": latest_day or None,
        "monthlyActiveWorkspaces": len({row.get("analytics_workspace_id") for row in latest}),
        "monthlyActiveSeats": sum(max(0, int(row.get("active_seats") or 0)) for row in latest),
        "registeredSeats": sum(max(0, int(row.get("registered_seats") or 0)) for row in latest),
        "powerSeats": sum(max(0, int(row.get("power_seats") or 0)) for row in latest),
    }


def _workspace_count_trend(rows):
    by_day = defaultdict(set)
    for source in rows:
        row = _row_dict(source)
        by_day[str(row.get("usage_date") or "")].add(row.get("analytics_workspace_id"))
    return [
        {"date": day, "value": len(by_day[day])}
        for day in sorted(day for day in by_day if day)
    ]


def _relative_change(current, previous):
    if current is None or previous is None or float(previous) == 0:
        return None
    return (float(current) - float(previous)) / abs(float(previous))


def _change_state(change, direction):
    if change is None or change == 0 or direction == "neutral":
        return "neutral"
    beneficial = change > 0 if direction == "increase_positive" else change < 0
    return "positive" if beneficial else "negative"


def _retention_proxy(cursor, start, end, filters):
    clauses = ["cohort_kind='paid_activation'", "week_number=4", "cohort_week>=?", "cohort_week<=?"]
    params = [start.isoformat(), end.isoformat()]
    if filters.get("ownerKind") in {"account", "organization"}:
        clauses.append("owner_kind=?")
        params.append(filters["ownerKind"])
    if filters.get("releaseId"):
        clauses.append("commercial_release_id=?")
        params.append(filters["releaseId"])
    release_mode = _release_mode_condition("commercial_release_id", filters.get("releaseMode"))
    if release_mode:
        clauses.append(release_mode)
    for value, dimension in (
        (filters.get("variant"), "variant"),
        (filters.get("sizeBucket"), "size"),
        (filters.get("procurementIntensity"), "procurement"),
        (filters.get("collaborationIntensity"), "collaboration"),
        (filters.get("aiAdoption"), "ai"),
    ):
        if value:
            clauses.append("segment_key LIKE ?")
            params.append(f"%{dimension}={value}%")
    row = cursor.execute(
        f"""SELECT COALESCE(SUM(workspace_count),0) AS workspace_count,
                   COALESCE(SUM(retained_workspaces),0) AS retained_workspaces
              FROM retention_cohort_weekly WHERE {' AND '.join(clauses)}""",
        tuple(params),
    ).fetchone()
    item = _row_dict(row) if row else {}
    total = max(0, int(item.get("workspace_count") or 0))
    retained = min(total, max(0, int(item.get("retained_workspaces") or 0)))
    if total < SMALL_COHORT_THRESHOLD:
        return {"status": "insufficient_sample", "workspaceCount": None, "value": None}
    return {"status": "available", "workspaceCount": total, "value": retained / total}


def _overview_period_values(cursor, start, end, filters):
    """Compute one comparable overview period from aggregate/read-model tables."""

    query_filters = {**filters, "from": start.isoformat(), "to": (end + timedelta(days=1)).isoformat()}
    usage_where, usage_params = _where(query_filters)
    usage = [
        _row_dict(row) for row in cursor.execute(
            f"SELECT * FROM workspace_usage_daily WHERE {usage_where}", usage_params
        ).fetchall()
    ]
    snapshot = _latest_usage_snapshot(usage)

    subscription_clauses = ["snapshot_date>=?", "snapshot_date<?"]
    subscription_params = [query_filters["from"], query_filters["to"]]
    for parameter, column in (
        (filters.get("ownerKind"), "owner_kind"),
        (filters.get("releaseId"), "commercial_release_id"),
        (filters.get("variant"), "variant"),
        (filters.get("plan"), "plan_code"),
    ):
        if parameter:
            subscription_clauses.append(f"{column}=?")
            subscription_params.append(parameter)
    release_mode = _release_mode_condition("commercial_release_id", filters.get("releaseMode"))
    if release_mode:
        subscription_clauses.append(release_mode)
    subscription = cursor.execute(
        f"""SELECT COUNT(DISTINCT analytics_workspace_id) FILTER (WHERE status='active') AS paid,
                   COUNT(DISTINCT analytics_workspace_id) FILTER (WHERE activated_today=1) AS new_paid
              FROM subscription_snapshot_daily WHERE {' AND '.join(subscription_clauses)}""",
        tuple(subscription_params),
    ).fetchone()
    subscription = _row_dict(subscription) if subscription else {}

    revenue_clauses = ["usage_date>=?", "usage_date<?"]
    revenue_params = [query_filters["from"], query_filters["to"]]
    for parameter, column in (
        (filters.get("ownerKind"), "owner_kind"),
        (filters.get("releaseId"), "commercial_release_id"),
        (filters.get("variant"), "variant"),
        (filters.get("plan"), "plan_code"),
    ):
        if parameter:
            revenue_clauses.append(f"{column}=?")
            revenue_params.append(parameter)
    release_mode = _release_mode_condition("commercial_release_id", filters.get("releaseMode"))
    if release_mode:
        revenue_clauses.append(release_mode)
    if filters.get("paidState") == "paid":
        revenue_clauses.append("plan_code!=''")
    elif filters.get("paidState") == "free":
        revenue_clauses.append("plan_code=''")
    revenue = cursor.execute(
        f"""SELECT COALESCE(SUM(gross_revenue_vnd),0) AS gross,
                   COALESCE(SUM(net_settled_revenue_vnd),0) AS net,
                   COALESCE(SUM(refund_amount_vnd),0) AS refunds
              FROM revenue_daily WHERE {' AND '.join(revenue_clauses)}""",
        tuple(revenue_params),
    ).fetchone()
    revenue = _row_dict(revenue) if revenue else {}
    cost = cursor.execute(
        f"""SELECT COUNT(*) AS source_rows,
                   COALESCE(SUM(estimated_cost_vnd),0) AS estimated_cost
              FROM cost_usage_daily WHERE {' AND '.join(revenue_clauses)}
               AND cost_status='available'""",
        tuple(revenue_params),
    ).fetchone()
    cost = _row_dict(cost) if cost else {}

    funnel_clauses = ["usage_date>=?", "usage_date<?"]
    funnel_params = [query_filters["from"], query_filters["to"]]
    for parameter, column, allowed in (
        (filters.get("ownerKind"), "owner_kind", {"account", "organization"}),
        (filters.get("releaseId"), "commercial_release_id", None),
        (filters.get("sizeBucket"), "size_bucket", None),
    ):
        if parameter and (allowed is None or parameter in allowed):
            funnel_clauses.append(f"{column}=?")
            funnel_params.append(parameter)
    release_mode = _release_mode_condition("commercial_release_id", filters.get("releaseMode"))
    if release_mode:
        funnel_clauses.append(release_mode)
    _append_funnel_catalog_filters(funnel_clauses, funnel_params, filters)
    funnel_rows = cursor.execute(
        f"""SELECT event_name,SUM(event_count) AS event_count,
                   COUNT(DISTINCT analytics_workspace_id) AS unique_workspaces
              FROM commercial_funnel_workspace_daily WHERE {' AND '.join(funnel_clauses)}
             GROUP BY event_name""",
        tuple(funnel_params),
    ).fetchall()
    funnel = _ordered_funnel(funnel_rows)
    pricing_conversion = next(
        (row["overallConversionRate"] for row in funnel if row["stage"] == "subscription.activated"),
        None,
    )
    paid = max(0, int(subscription.get("paid") or 0))
    net = max(0, int(revenue.get("net") or 0))
    estimated_cost = max(0, int(cost.get("estimated_cost") or 0))
    cost_available = int(cost.get("source_rows") or 0) > 0
    retention = _retention_proxy(cursor, start, end, filters)
    variant_counts = {
        variant: _cohort_count(len({
            row.get("analytics_workspace_id") for row in usage if row.get("variant") == variant
        }))
        for variant in ("internal", "connected")
    }
    topup_workspaces = len({
        row.get("analytics_workspace_id") for row in usage
        if int(row.get("purchased_credits") or 0) > 0
    })
    return {
        **snapshot,
        "paidWorkspaces": paid,
        "newPaidWorkspaces": max(0, int(subscription.get("new_paid") or 0)),
        "grossRevenueVnd": max(0, int(revenue.get("gross") or 0)),
        "netSettledRevenueVnd": net,
        "topupRevenueVnd": _sum(usage, "topup_spend_vnd"),
        "refundAmountVnd": max(0, int(revenue.get("refunds") or 0)),
        "arpaVnd": net / paid if paid else None,
        "successfulProcurementFetches": _sum(usage, "successful_fetches"),
        "estimatedVariableCostVnd": estimated_cost if cost_available else None,
        "contributionMarginVnd": net - estimated_cost if cost_available else None,
        "pricingToPaidConversionRate": pricing_conversion,
        "d30PaidRetentionProxy": retention["value"],
        "d30PaidRetentionSample": retention,
        "variantCounts": variant_counts,
        "topupAttachRate": (
            topup_workspaces / paid if paid >= SMALL_COHORT_THRESHOLD else None
        ),
    }


def build_dashboard(
    cursor, *, from_date, to_date, view="overview", filters=None, page=1, page_size=50,
):
    start, end = _date_range(from_date, to_date)
    page = int(page)
    page_size = int(page_size)
    if page < 1 or page_size < 1 or page_size > 100:
        raise ValueError("Analytics pagination is invalid.")
    view = str(view or "overview").strip().lower()
    if view not in VIEWS:
        raise ValueError("Analytics view is not supported.")
    normalized = {"from": start.isoformat(), "to": end.isoformat(), **(filters or {})}
    # SQL uses an exclusive upper bound while the API exposes inclusive dates.
    query_filters = {**normalized, "to": (end + timedelta(days=1)).isoformat()}
    where, params = _where(query_filters)
    usage_rows = cursor.execute(  # noqa: S608 - where uses fixed columns and placeholders.
        f"SELECT * FROM workspace_usage_daily WHERE {where}",
        params,
    ).fetchall()
    rows = [_row_dict(row) for row in usage_rows]
    # Revenue and commercial funnel facts may exist before a workspace reaches
    # a meaningful product action, so usage alone does not decide empty state.
    auxiliary_count = _auxiliary_data_count(cursor, query_filters)
    if not rows and not int(auxiliary_count or 0):
        return {
            "view": view, "hasData": False,
            "message": "Chưa đủ dữ liệu trong khoảng thời gian này.",
            "filters": normalized,
            "timezone": "Asia/Ho_Chi_Minh",
            "updatedAt": None,
            "kpis": [], "series": [], "segments": [], "table": [],
            "insufficientSample": False,
        }
    workspace_count = len({row.get("analytics_workspace_id") for row in rows})
    latest_snapshot = _latest_usage_snapshot(rows)
    seat_where, seat_params = _where(query_filters, alias="u")
    active_seats_row = cursor.execute(  # noqa: S608 - where uses fixed columns and placeholders.
        f"""SELECT COUNT(DISTINCT seat.analytics_workspace_id || ':' || seat.analytics_user_id) AS active_seats
               FROM workspace_seat_daily AS seat
               JOIN workspace_usage_daily AS u
                 ON u.usage_date=seat.usage_date
                AND u.analytics_workspace_id=seat.analytics_workspace_id
              WHERE {seat_where}""",
        seat_params,
    ).fetchone()
    active_seats = int((_row_dict(active_seats_row) if active_seats_row else {}).get("active_seats") or 0)
    meaningful = _sum(rows, "meaningful_actions")
    feature_uses = _sum(rows, "feature_uses")
    fetches = _sum(rows, "successful_fetches")
    exports = _sum(rows, "word_exports")
    subscription_clauses = ["snapshot_date >= ?", "snapshot_date < ?"]
    subscription_params = [query_filters["from"], query_filters["to"]]
    for parameter, column in (
        (normalized.get("ownerKind"), "owner_kind"),
        (normalized.get("releaseId"), "commercial_release_id"),
        (normalized.get("variant"), "variant"),
        (normalized.get("plan"), "plan_code"),
    ):
        if parameter:
            subscription_clauses.append(f"{column} = ?")
            subscription_params.append(parameter)
    release_mode = _release_mode_condition("commercial_release_id", normalized.get("releaseMode"))
    if release_mode:
        subscription_clauses.append(release_mode)
    paid_summary = cursor.execute(
        f"""SELECT COUNT(DISTINCT analytics_workspace_id) FILTER (WHERE status='active') AS paid,
                   COUNT(DISTINCT analytics_workspace_id) FILTER (WHERE activated_today=1) AS new_paid
              FROM subscription_snapshot_daily
             WHERE {' AND '.join(subscription_clauses)}""",
        tuple(subscription_params),
    ).fetchone()
    paid_item = _row_dict(paid_summary) if paid_summary else {}
    response = {
        "view": view,
        "hasData": True,
        "message": None,
        "filters": normalized,
        "timezone": "Asia/Ho_Chi_Minh",
        "updatedAt": max((str(row.get("updated_at") or "") for row in rows), default=None),
        "kpis": [
            {"key": "monthlyActiveWorkspaces", "label": "Monthly Active Workspaces", "value": latest_snapshot["monthlyActiveWorkspaces"],
             "definition": "Workspaces with a meaningful action in the rolling 30-day snapshot."},
            {"key": "monthlyActiveSeats", "label": "Monthly Active Seats", "value": latest_snapshot["monthlyActiveSeats"],
             "definition": "Distinct meaningful-action users in the latest rolling 30-day snapshot."},
            {"key": "meaningfulActions", "label": "Meaningful Actions", "value": meaningful},
            {"key": "successfulProcurementFetches", "label": "Successful Procurement Fetches", "value": fetches},
            {"key": "wordExports", "label": "Word Exports", "value": exports},
            {"key": "featureUses", "label": "Feature Uses", "value": feature_uses},
            {"key": "registeredSeats", "label": "Registered Seats", "value": latest_snapshot["registeredSeats"]},
            {"key": "powerSeats", "label": "Power Seats", "value": latest_snapshot["powerSeats"]},
            {"key": "paidWorkspaces", "label": "Paid Workspaces", "value": int(paid_item.get("paid") or 0)},
            {"key": "newPaidWorkspaces", "label": "New Paid Workspaces", "value": int(paid_item.get("new_paid") or 0)},
        ],
        "series": [
            {"key": "monthlyActiveWorkspaces", "label": "Monthly active workspaces", "points": _workspace_count_trend(rows)},
            {"key": "activeSeats", "label": "Active seats", "points": _trend(rows, "active_seats")},
            {"key": "meaningfulActions", "label": "Meaningful actions", "points": _trend(rows, "meaningful_actions")},
        ],
        "segments": [],
        "table": [],
        "insufficientSample": workspace_count < SMALL_COHORT_THRESHOLD,
        "correlationDisclaimer": "Correlation does not imply causation.",
        "dataQuality": {
            "procurementCacheHits": "not_available",
            "procurementAttempts": "billable_ledger_only",
            "costs": "estimated_or_not_configured",
            "planFitRevenue": "not_attributable_to_workspace",
        },
    }

    if view == "overview":
        mix_rows = cursor.execute(
            f"""SELECT COALESCE(NULLIF(variant,''),'unknown') AS variant,
                       COUNT(DISTINCT analytics_workspace_id) AS workspace_count
                  FROM workspace_usage_daily WHERE {where}
                 GROUP BY COALESCE(NULLIF(variant,''),'unknown') ORDER BY variant""",
            params,
        ).fetchall()
        plan_rows = cursor.execute(
            f"""SELECT COALESCE(NULLIF(plan_code,''),'Unassigned') AS plan,
                       COUNT(DISTINCT analytics_workspace_id) AS workspace_count
                  FROM workspace_usage_daily WHERE {where}
                 GROUP BY COALESCE(NULLIF(plan_code,''),'Unassigned') ORDER BY workspace_count DESC, plan""",
            params,
        ).fetchall()
        response["mix"] = suppress_small_cohorts([
            {"segment": str(_row_dict(row).get("variant")), "variant": str(_row_dict(row).get("variant")),
             "workspaceCount": int(_row_dict(row).get("workspace_count") or 0)}
            for row in mix_rows
        ])
        response["planDistribution"] = suppress_small_cohorts([
            {"segment": str(_row_dict(row).get("plan")), "plan": str(_row_dict(row).get("plan")),
             "workspaceCount": int(_row_dict(row).get("workspace_count") or 0)}
            for row in plan_rows
        ])
        response["topupRevenueTrend"] = _trend(rows, "topup_spend_vnd")

    if view in {"features", "overview"}:
        feature_where, feature_params = _where(query_filters, alias="u")
        retention_cutoff = max(start, end - timedelta(days=29)).isoformat()
        feature_rows = cursor.execute(  # noqa: S608 - where uses fixed columns and placeholders.
            f"""WITH feature_workspace AS (
                    SELECT f.feature_key, f.analytics_workspace_id,
                           SUM(f.event_count) AS workspace_events
                      FROM workspace_feature_daily f
                      JOIN workspace_usage_daily u
                        ON u.usage_date=f.usage_date
                       AND u.analytics_workspace_id=f.analytics_workspace_id
                     WHERE {feature_where}
                     GROUP BY f.feature_key, f.analytics_workspace_id
                  ), feature_users AS (
                    SELECT feature_user.feature_key,
                           COUNT(DISTINCT feature_user.analytics_user_id) AS active_users
                      FROM workspace_feature_user_daily feature_user
                      JOIN workspace_usage_daily u
                        ON u.usage_date=feature_user.usage_date
                       AND u.analytics_workspace_id=feature_user.analytics_workspace_id
                     WHERE {feature_where}
                     GROUP BY feature_user.feature_key
                  )
                  SELECT feature.feature_key,
                         SUM(feature.workspace_events) AS event_count,
                         MAX(COALESCE(feature_users.active_users,0)) AS active_users,
                         COUNT(*) AS workspace_count,
                         PERCENTILE_DISC(0.5) WITHIN GROUP
                           (ORDER BY feature.workspace_events) AS median_usage_per_workspace,
                         COUNT(*) FILTER (WHERE EXISTS (
                           SELECT 1 FROM workspace_usage_daily retained
                            WHERE retained.analytics_workspace_id=feature.analytics_workspace_id
                              AND retained.usage_date>=? AND retained.usage_date<?
                              AND retained.meaningful_actions>0
                         )) AS retained_adopters,
                         COUNT(*) FILTER (WHERE EXISTS (
                           SELECT 1 FROM subscription_snapshot_daily paid
                            WHERE paid.analytics_workspace_id=feature.analytics_workspace_id
                              AND paid.snapshot_date>=? AND paid.snapshot_date<?
                              AND paid.status='active'
                         )) AS paid_adopters
                    FROM feature_workspace feature
                    LEFT JOIN feature_users ON feature_users.feature_key=feature.feature_key
                   GROUP BY feature.feature_key
                   ORDER BY event_count DESC, feature.feature_key LIMIT 50""",
            (*feature_params, *feature_params, retention_cutoff, query_filters["to"],
             query_filters["from"], query_filters["to"]),
        ).fetchall()
        retained_total = len({
            row.get("analytics_workspace_id") for row in rows
            if str(row.get("usage_date") or "") >= retention_cutoff
            and int(row.get("meaningful_actions") or 0) > 0
        })
        response["segments"] = suppress_small_cohorts([
            {"feature": str(_row_dict(row).get("feature_key") or ""),
            "eventCount": int(_row_dict(row).get("event_count") or 0),
            "activeUsers": int(_row_dict(row).get("active_users") or 0),
            "workspaceCount": int(_row_dict(row).get("workspace_count") or 0),
            "usageFrequency": (
                int(_row_dict(row).get("event_count") or 0)
                / int(_row_dict(row).get("workspace_count") or 0)
                if int(_row_dict(row).get("workspace_count") or 0) else None
            ),
            "adoptionRate": int(_row_dict(row).get("workspace_count") or 0) / workspace_count if workspace_count else 0,
             "medianUsagePerWorkspace": int(_row_dict(row).get("median_usage_per_workspace") or 0),
             "d30RetentionAssociation": _association_summary(
                 workspace_count,
                 int(_row_dict(row).get("workspace_count") or 0),
                 retained_total,
                 int(_row_dict(row).get("retained_adopters") or 0),
             ),
             "paidConversionAssociation": _association_summary(
                 workspace_count,
                 int(_row_dict(row).get("workspace_count") or 0),
                 int(paid_item.get("paid") or 0),
                 int(_row_dict(row).get("paid_adopters") or 0),
             ),
             "segment": str(_row_dict(row).get("feature_key") or "")}
            for row in feature_rows
        ])
        if view == "features":
            response["table"] = response["segments"]
            feature_trend_rows = cursor.execute(
                f"""SELECT f.usage_date,f.feature_key,SUM(f.event_count) AS event_count
                      FROM workspace_feature_daily f
                      JOIN workspace_usage_daily u
                        ON u.usage_date=f.usage_date
                       AND u.analytics_workspace_id=f.analytics_workspace_id
                     WHERE {feature_where}
                     GROUP BY f.usage_date,f.feature_key
                     ORDER BY f.usage_date,f.feature_key""",
                feature_params,
            ).fetchall()
            feature_plan_rows = cursor.execute(
                f"""SELECT COALESCE(NULLIF(u.plan_code,''),'Unassigned') AS plan,
                           f.feature_key,COUNT(DISTINCT f.analytics_workspace_id) AS workspace_count
                      FROM workspace_feature_daily f
                      JOIN workspace_usage_daily u
                        ON u.usage_date=f.usage_date
                       AND u.analytics_workspace_id=f.analytics_workspace_id
                     WHERE {feature_where}
                     GROUP BY COALESCE(NULLIF(u.plan_code,''),'Unassigned'),f.feature_key
                     ORDER BY workspace_count DESC,plan,f.feature_key LIMIT 100""",
                feature_params,
            ).fetchall()
            trend_by_feature = defaultdict(list)
            for row in feature_trend_rows:
                item = _row_dict(row)
                trend_by_feature[str(item.get("feature_key") or "unknown")].append({
                    "date": str(item.get("usage_date") or ""),
                    "value": int(item.get("event_count") or 0),
                })
            plan_points = suppress_small_cohorts([
                {
                    "segment": f"{_row_dict(row).get('plan')} / {_row_dict(row).get('feature_key')}",
                    "workspaceCount": int(_row_dict(row).get("workspace_count") or 0),
                }
                for row in feature_plan_rows
            ])
            response["viewCharts"] = [
                {"key": "feature_adoption", "label": "Top adopted features", "series": [{
                    "key": "adoption", "label": "Adoption", "points": [
                        {"label": row.get("feature"), "value": None if row.get("suppressed") else row.get("adoptionRate"),
                         "status": row.get("status")}
                        for row in response["segments"]
                    ],
                }]},
                {"key": "feature_trend", "label": "Feature usage trend", "series": [
                    {"key": feature, "label": feature, "points": points}
                    for feature, points in list(sorted(trend_by_feature.items()))[:5]
                ]},
                {"key": "feature_by_plan", "label": "Feature usage by plan", "series": [{
                    "key": "workspaces", "label": "Active workspaces", "points": [
                        {"label": row.get("segment"), "value": None if row.get("suppressed") else row.get("workspaceCount"),
                         "status": row.get("status")}
                        for row in plan_points
                    ],
                }]},
                {"key": "feature_retention", "label": "Feature adoption vs retention", "series": [{
                    "key": "association", "label": "Retention difference (percentage points)", "points": [
                        {"label": row.get("feature"),
                         "value": row.get("d30RetentionAssociation", {}).get("percentagePointDifference")
                         / 100 if row.get("d30RetentionAssociation", {}).get("status") == "available" else None,
                         "status": row.get("d30RetentionAssociation", {}).get("status")}
                        for row in response["segments"]
                    ],
                }]},
            ]
            response["associationMethod"] = {
                "retention": "Meaningful action in the last 30 days of the selected range.",
                "paid": "Active subscription observed in the selected range.",
                "disclaimer": "Correlation does not imply causation.",
            }
    if view in {"funnel", "overview"}:
        funnel_clauses = ["usage_date >= ?", "usage_date < ?"]
        funnel_params = [query_filters["from"], query_filters["to"]]
        for parameter, column, allowed in (
            (normalized.get("ownerKind"), "owner_kind", {"account", "organization"}),
            (normalized.get("releaseId"), "commercial_release_id", None),
            (normalized.get("sizeBucket"), "size_bucket", None),
        ):
            if parameter and (allowed is None or parameter in allowed):
                funnel_clauses.append(f"{column} = ?")
                funnel_params.append(parameter)
        release_mode = _release_mode_condition("commercial_release_id", normalized.get("releaseMode"))
        if release_mode:
            funnel_clauses.append(release_mode)
        _append_funnel_catalog_filters(funnel_clauses, funnel_params, normalized)
        funnel_rows = cursor.execute(
            f"""SELECT event_name, SUM(event_count) AS event_count,
                      COUNT(DISTINCT analytics_workspace_id) AS unique_workspaces
                 FROM commercial_funnel_workspace_daily
                WHERE {' AND '.join(funnel_clauses)}
                GROUP BY event_name ORDER BY event_name""",
            tuple(funnel_params),
        ).fetchall()
        response["funnel"] = _ordered_funnel(funnel_rows)
        timing_rows = cursor.execute(
            f"""SELECT analytics_workspace_id,commercial_release_id,event_name,
                       MIN(first_occurred_at) AS first_occurred_at
                  FROM commercial_funnel_workspace_daily
                 WHERE {' AND '.join(funnel_clauses)} AND first_occurred_at IS NOT NULL
                 GROUP BY analytics_workspace_id,commercial_release_id,event_name""",
            tuple(funnel_params),
        ).fetchall()
        stage_timings = _funnel_stage_timings(timing_rows)
        timings_by_stage = {row["toStage"]: row for row in stage_timings}
        for stage in response["funnel"]:
            timing = timings_by_stage.get(stage["stage"])
            stage["medianSecondsFromPriorStage"] = (
                timing.get("medianSeconds") if timing else None
            )
            stage["timingStatus"] = timing.get("status") if timing else "not_available"
        available_timing = any(row["status"] == "available" for row in stage_timings)
        observed_timing = any(row["status"] != "not_available" for row in stage_timings)
        response["funnelSummary"] = {
            "pricingToPaidConversionRate": next((
                row["overallConversionRate"] for row in response["funnel"]
                if row["stage"] == "subscription.activated"
            ), None),
            "stageTimingStatus": (
                "available" if available_timing else
                "insufficient_sample" if observed_timing else "not_available"
            ),
            "stageTimingReason": (
                None if available_timing else
                "Ordered aggregate journeys are below the reporting threshold."
                if observed_timing else
                "No ordered aggregate journey timestamps exist in the selected range."
            ),
            "stageTimings": stage_timings,
        }
        if view == "funnel":
            breakdown_rows = cursor.execute(
                f"""SELECT event_name,commercial_release_id,owner_kind,size_bucket,sku_code,
                           COALESCE((SELECT catalog_plan.variant FROM billing_skus catalog_sku
                             JOIN billing_plan_versions catalog_plan ON catalog_plan.id=catalog_sku.plan_version_id
                            WHERE catalog_sku.release_id=commercial_funnel_workspace_daily.commercial_release_id
                              AND catalog_sku.sku_code=commercial_funnel_workspace_daily.sku_code
                            LIMIT 1),'unknown') AS variant,
                           COALESCE((SELECT catalog_plan.logical_package_code FROM billing_skus catalog_sku
                             JOIN billing_plan_versions catalog_plan ON catalog_plan.id=catalog_sku.plan_version_id
                            WHERE catalog_sku.release_id=commercial_funnel_workspace_daily.commercial_release_id
                              AND catalog_sku.sku_code=commercial_funnel_workspace_daily.sku_code
                            LIMIT 1),'Unassigned') AS plan_code,
                           COUNT(DISTINCT analytics_workspace_id) AS workspace_count,
                           SUM(event_count) AS event_count
                      FROM commercial_funnel_workspace_daily
                     WHERE {' AND '.join(funnel_clauses)}
                     GROUP BY event_name,commercial_release_id,owner_kind,size_bucket,sku_code
                     ORDER BY event_name,commercial_release_id,owner_kind,size_bucket,sku_code
                     LIMIT 500""",
                tuple(funnel_params),
            ).fetchall()
            response["funnelBreakdown"] = suppress_small_cohorts([
                {
                    "segment": " / ".join((
                        str(_row_dict(row).get("event_name") or "unknown"),
                        str(_row_dict(row).get("commercial_release_id") or "unknown"),
                        str(_row_dict(row).get("owner_kind") or "unknown"),
                        str(_row_dict(row).get("size_bucket") or "unknown"),
                        str(_row_dict(row).get("sku_code") or "no-sku"),
                        str(_row_dict(row).get("variant") or "unknown"),
                    )),
                    "stage": str(_row_dict(row).get("event_name") or ""),
                    "releaseId": str(_row_dict(row).get("commercial_release_id") or ""),
                    "ownerKind": str(_row_dict(row).get("owner_kind") or ""),
                    "sizeBucket": str(_row_dict(row).get("size_bucket") or ""),
                    "skuCode": str(_row_dict(row).get("sku_code") or ""),
                    "variant": str(_row_dict(row).get("variant") or "unknown"),
                    "plan": str(_row_dict(row).get("plan_code") or "Unassigned"),
                    "workspaceCount": int(_row_dict(row).get("workspace_count") or 0),
                    "eventCount": int(_row_dict(row).get("event_count") or 0),
                }
                for row in breakdown_rows
            ])
            response["table"] = response["funnelBreakdown"]
            outcomes = {
                str(_row_dict(row).get("event_name") or ""): int(_row_dict(row).get("unique_workspaces") or 0)
                for row in funnel_rows
            }
            response["funnelOutcomes"] = {
                "paymentFailures": outcomes.get("payment.failed", 0),
                "activationFailures": outcomes.get("subscription.activation_failed", 0),
                "refunds": outcomes.get("refund.succeeded", 0),
            }
            activation_clauses = ["subscription_activated_at>=?", "subscription_activated_at<?"]
            activation_params = [
                int(datetime.combine(start, time.min, PRODUCT_TIMEZONE).timestamp()),
                int(datetime.combine(end + timedelta(days=1), time.min, PRODUCT_TIMEZONE).timestamp()),
            ]
            for parameter, column in (
                (normalized.get("ownerKind"), "owner_kind"),
                (normalized.get("releaseId"), "commercial_release_id"),
                (normalized.get("variant"), "variant"),
                (normalized.get("plan"), "plan_code"),
                (normalized.get("sizeBucket"), "size_bucket"),
            ):
                if parameter:
                    activation_clauses.append(f"{column}=?")
                    activation_params.append(parameter)
            activation_release_mode = _release_mode_condition(
                "commercial_release_id", normalized.get("releaseMode")
            )
            if activation_release_mode:
                activation_clauses.append(activation_release_mode)
            paid_ttfv_rows = cursor.execute(
                f"""SELECT subscription_activated_at,first_paid_value_at
                       FROM workspace_activation_facts
                      WHERE {' AND '.join(activation_clauses)}
                        AND first_paid_value_at IS NOT NULL
                        AND first_paid_value_at>=subscription_activated_at""",
                tuple(activation_params),
            ).fetchall()
            paid_ttfv_values = [
                int(_row_dict(row)["first_paid_value_at"])
                - int(_row_dict(row)["subscription_activated_at"])
                for row in paid_ttfv_rows
            ]
            response["funnelOutcomes"]["paidTtfv"] = {
                **_duration_percentiles(paid_ttfv_values),
                "observedWorkspaces": len(paid_ttfv_values),
                "status": "available" if paid_ttfv_values else "not_available",
            }
            response["kpis"] = [
                {"key": "paymentFailures", "label": "Payment failures", "value": response["funnelOutcomes"]["paymentFailures"]},
                {"key": "activationFailures", "label": "Activation failures", "value": response["funnelOutcomes"]["activationFailures"]},
                {"key": "refunds", "label": "Refunds", "value": response["funnelOutcomes"]["refunds"]},
                {"key": "medianPaidTtfvSeconds", "label": "Median paid TTFV", "value": response["funnelOutcomes"]["paidTtfv"]["medianSeconds"]},
                {"key": "pricingToPaidConversionRate", "label": "Pricing → paid", "value": response["funnelSummary"]["pricingToPaidConversionRate"]},
            ]
            response["viewCharts"] = [{
                "key": "commercial_funnel", "label": "Commercial funnel conversion", "series": [
                    {"key": "workspaces", "label": "Unique workspaces", "points": [
                        {"label": row["stage"], "value": row["uniqueWorkspaces"]}
                        for row in response["funnel"]
                    ]},
                    {"key": "conversion", "label": "Step conversion", "points": [
                        {"label": row["stage"], "value": row["stepConversionRate"]}
                        for row in response["funnel"] if row["stepConversionRate"] is not None
                    ]},
                ],
            }]
    if view in {"economics", "overview"}:
        revenue_clauses = ["usage_date >= ?", "usage_date < ?"]
        revenue_params = [query_filters["from"], query_filters["to"]]
        for parameter, column in (
            (normalized.get("ownerKind"), "owner_kind"),
            (normalized.get("releaseId"), "commercial_release_id"),
            (normalized.get("variant"), "variant"),
            (normalized.get("plan"), "plan_code"),
        ):
            if parameter:
                revenue_clauses.append(f"{column} = ?")
                revenue_params.append(parameter)
        release_mode = _release_mode_condition("commercial_release_id", normalized.get("releaseMode"))
        if release_mode:
            revenue_clauses.append(release_mode)
        if normalized.get("paidState") == "paid":
            revenue_clauses.append("plan_code != ''")
        elif normalized.get("paidState") == "free":
            revenue_clauses.append("plan_code = ''")
        revenue_rows = cursor.execute(
            f"""SELECT COALESCE(SUM(gross_revenue_vnd), 0) AS gross,
                      COALESCE(SUM(net_settled_revenue_vnd), 0) AS net,
                      COALESCE(SUM(refund_amount_vnd), 0) AS refunds,
                      COALESCE(SUM(payment_fee_vnd), 0) AS fees,
                      COALESCE(SUM(net_settled_revenue_vnd) FILTER (WHERE plan_code=''), 0) AS topup
                 FROM revenue_daily
                WHERE {' AND '.join(revenue_clauses)}""",
            tuple(revenue_params),
        ).fetchone()
        item = _row_dict(revenue_rows) if revenue_rows else {}
        cost = cursor.execute(
            f"""SELECT COUNT(*) AS source_rows,
                       COALESCE(SUM(estimated_cost_vnd), 0) AS estimated_cost
                 FROM cost_usage_daily
                WHERE {' AND '.join(revenue_clauses)} AND cost_status='available'""",
            tuple(revenue_params),
        ).fetchone()
        cost_item = _row_dict(cost) if cost else {}
        ai_cost = cursor.execute(
            f"""SELECT COUNT(*) AS source_rows,
                       COALESCE(SUM(estimated_cost_vnd), 0) AS estimated_cost
                  FROM cost_usage_daily
                 WHERE {' AND '.join(revenue_clauses)}
                   AND cost_type='ai' AND cost_status='available'""",
            tuple(revenue_params),
        ).fetchone()
        ai_cost_item = _row_dict(ai_cost) if ai_cost else {}
        net = int(item.get("net") or 0)
        estimated_cost = int(cost_item.get("estimated_cost") or 0)
        cost_available = int(cost_item.get("source_rows") or 0) > 0
        response["economics"] = {
            "grossRevenueVnd": int(item.get("gross") or 0),
            "netSettledRevenueVnd": net,
            "refundAmountVnd": int(item.get("refunds") or 0),
            "topupRevenueVnd": _sum(rows, "topup_spend_vnd"),
            "paymentFeeVnd": int(item.get("fees") or 0),
            "estimatedVariableCostVnd": estimated_cost if cost_available else None,
            "contributionMarginVnd": net - estimated_cost if cost_available else None,
            "contributionMarginRate": (net - estimated_cost) / net if cost_available and net else None,
            "costPerWorkspaceVnd": estimated_cost / workspace_count if cost_available and workspace_count else None,
            "costPerActiveSeatVnd": estimated_cost / active_seats if cost_available and active_seats else None,
            "costPerSuccessfulFetchVnd": estimated_cost / fetches if cost_available and fetches else None,
            "aiCostPerActiveWorkspaceVnd": (
                int(ai_cost_item.get("estimated_cost") or 0) /
                len({row.get("analytics_workspace_id") for row in rows if int(row.get("ai_requests") or 0) > 0})
                if int(ai_cost_item.get("source_rows") or 0) > 0
                and any(int(row.get("ai_requests") or 0) > 0 for row in rows) else None
            ),
            "paymentFeeRate": int(item.get("fees") or 0) / int(item.get("gross") or 0) if int(item.get("gross") or 0) else None,
            "costLabel": "Estimated" if cost_available else "Not configured",
            "costStatus": "available" if cost_available else "not_configured",
        }
        if view == "economics":
            tier_revenue_rows = cursor.execute(
                f"""SELECT COALESCE(NULLIF(plan_code,''),'Unassigned') AS tier,
                           COALESCE(SUM(gross_revenue_vnd),0) AS gross,
                           COALESCE(SUM(refund_amount_vnd),0) AS refunds,
                           COALESCE(SUM(net_settled_revenue_vnd),0) AS net,
                           COALESCE(SUM(payment_fee_vnd),0) AS payment_fee
                      FROM revenue_daily
                     WHERE {' AND '.join(revenue_clauses)}
                     GROUP BY COALESCE(NULLIF(plan_code,''),'Unassigned')""",
                tuple(revenue_params),
            ).fetchall()
            tier_cost_rows = cursor.execute(
                f"""SELECT COALESCE(NULLIF(plan_code,''),'Unassigned') AS tier,
                           COALESCE(SUM(estimated_cost_vnd),0) AS variable_cost
                      FROM cost_usage_daily
                     WHERE {' AND '.join(revenue_clauses)} AND cost_status='available'
                     GROUP BY COALESCE(NULLIF(plan_code,''),'Unassigned')""",
                tuple(revenue_params),
            ).fetchall()
            tiers = {}
            for row in tier_revenue_rows:
                source = _row_dict(row)
                tiers[str(source.get("tier"))] = {
                    "tier": str(source.get("tier")), "grossRevenueVnd": int(source.get("gross") or 0),
                    "refundAmountVnd": int(source.get("refunds") or 0),
                    "netRevenueVnd": int(source.get("net") or 0),
                    "paymentFeeVnd": int(source.get("payment_fee") or 0), "variableCostVnd": None,
                    "costStatus": "not_configured",
                }
            for row in tier_cost_rows:
                source = _row_dict(row)
                target = tiers.setdefault(str(source.get("tier")), {
                    "tier": str(source.get("tier")), "grossRevenueVnd": 0,
                    "refundAmountVnd": 0, "netRevenueVnd": 0, "paymentFeeVnd": 0,
                    "variableCostVnd": None, "costStatus": "not_configured",
                })
                target["variableCostVnd"] = int(source.get("variable_cost") or 0)
                target["costStatus"] = "available"
            response["economicsByTier"] = []
            for target in sorted(tiers.values(), key=lambda value: value["tier"]):
                margin = (
                    target["netRevenueVnd"] - target["variableCostVnd"]
                    if target["costStatus"] == "available" else None
                )
                response["economicsByTier"].append({
                    **target, "contributionMarginVnd": margin,
                    "contributionMarginRate": margin / target["netRevenueVnd"] if margin is not None and target["netRevenueVnd"] else None,
                    "costLabel": "Estimated" if target["costStatus"] == "available" else "Not configured",
                })
            response["table"] = response["economicsByTier"]
            response["viewCharts"] = [{
                "key": "economics_by_tier", "label": "Revenue vs cost by tier", "series": [
                    {"key": "revenue", "label": "Net revenue", "points": [
                        {"label": row["tier"], "value": row["netRevenueVnd"]}
                        for row in response["economicsByTier"]
                    ]},
                    {"key": "cost", "label": "Estimated variable cost", "points": [
                        {"label": row["tier"], "value": row["variableCostVnd"]}
                        for row in response["economicsByTier"]
                    ]},
                ],
            }]
        if view == "overview":
            revenue_trend_rows = cursor.execute(
                f"""SELECT usage_date,
                           COALESCE(SUM(net_settled_revenue_vnd),0) AS net_revenue_vnd
                      FROM revenue_daily WHERE {' AND '.join(revenue_clauses)}
                     GROUP BY usage_date ORDER BY usage_date""",
                tuple(revenue_params),
            ).fetchall()
            cost_trend_rows = cursor.execute(
                f"""SELECT usage_date,
                           COALESCE(SUM(estimated_cost_vnd),0) AS estimated_cost_vnd
                      FROM cost_usage_daily WHERE {' AND '.join(revenue_clauses)}
                       AND cost_status='available'
                     GROUP BY usage_date ORDER BY usage_date""",
                tuple(revenue_params),
            ).fetchall()
            paid_trend_rows = cursor.execute(
                f"""SELECT snapshot_date,
                           COUNT(DISTINCT analytics_workspace_id)
                             FILTER (WHERE status='active') AS paid_workspaces
                      FROM subscription_snapshot_daily
                     WHERE {' AND '.join(subscription_clauses)}
                     GROUP BY snapshot_date ORDER BY snapshot_date""",
                tuple(subscription_params),
            ).fetchall()
            response["paidWorkspaceTrend"] = [
                {"date": str(_row_dict(row).get("snapshot_date") or ""),
                 "value": int(_row_dict(row).get("paid_workspaces") or 0)}
                for row in paid_trend_rows
            ]
            response["revenueCostTrend"] = {
                "revenue": [
                    {"date": str(_row_dict(row).get("usage_date") or ""),
                     "value": int(_row_dict(row).get("net_revenue_vnd") or 0)}
                    for row in revenue_trend_rows
                ],
                "cost": [
                    {"date": str(_row_dict(row).get("usage_date") or ""),
                     "value": int(_row_dict(row).get("estimated_cost_vnd") or 0)}
                    for row in cost_trend_rows
                ],
            }
            response["kpis"].extend([
                {"key": "grossRevenueVnd", "label": "Gross Revenue", "value": int(item.get("gross") or 0)},
                {"key": "netSettledRevenueVnd", "label": "Net Settled Revenue", "value": net},
                {"key": "refundAmountVnd", "label": "Refund Amount", "value": int(item.get("refunds") or 0)},
                {"key": "topupRevenueVnd", "label": "Top-up Revenue", "value": _sum(rows, "topup_spend_vnd")},
                {"key": "arpaVnd", "label": "ARPA", "value": net // max(1, int(paid_item.get("paid") or 0))},
                {"key": "estimatedVariableCostVnd", "label": "Estimated Variable Cost", "value": estimated_cost if cost_available else None},
                {"key": "contributionMarginVnd", "label": "Contribution Margin", "value": net - estimated_cost if cost_available else None},
            ])
        feedback_total = _sum(rows, "ai_feedback_up") + _sum(rows, "ai_feedback_down")
        all_workspace_ids = {row.get("analytics_workspace_id") for row in rows}
        ai_workspace_ids = {
            row.get("analytics_workspace_id") for row in rows if int(row.get("ai_requests") or 0) > 0
        }
        ai_cost_available = int(ai_cost_item.get("source_rows") or 0) > 0
        ai_retention_cutoff = max(start, end - timedelta(days=29)).isoformat()
        retained_workspace_ids = {
            row.get("analytics_workspace_id") for row in rows
            if str(row.get("usage_date") or "") >= ai_retention_cutoff
            and int(row.get("meaningful_actions") or 0) > 0
        }
        paid_workspace_rows = cursor.execute(
            f"""SELECT DISTINCT analytics_workspace_id
                  FROM subscription_snapshot_daily
                 WHERE {' AND '.join(subscription_clauses)} AND status='active'""",
            tuple(subscription_params),
        ).fetchall()
        paid_workspace_ids = {
            _row_dict(row).get("analytics_workspace_id") for row in paid_workspace_rows
        } & all_workspace_ids
        response["ai"] = {
            "activeWorkspaces": len(ai_workspace_ids),
            "requests": _sum(rows, "ai_requests"),
            "requestsPerActiveWorkspace": (
                _sum(rows, "ai_requests") / len(ai_workspace_ids) if ai_workspace_ids else None
            ),
            "inputTokens": _sum(rows, "ai_input_tokens"),
            "outputTokens": _sum(rows, "ai_output_tokens"),
            "toolCalls": _sum(rows, "ai_tool_calls"),
            "estimatedCostVnd": (
                int(ai_cost_item.get("estimated_cost") or 0)
                if ai_cost_available else None
            ),
            "estimatedCostStatus": "available" if ai_cost_available else "not_configured",
            "helpfulRate": _sum(rows, "ai_feedback_up") / feedback_total if feedback_total else None,
            "tooSlowRate": _sum(rows, "ai_feedback_too_slow") / feedback_total if feedback_total else None,
            "incorrectOrMissingSourceRate": _sum(rows, "ai_feedback_incorrect_source") / feedback_total if feedback_total else None,
            "retentionAssociation": _association_summary(
                workspace_count, len(ai_workspace_ids), len(retained_workspace_ids),
                len(ai_workspace_ids & retained_workspace_ids),
            ),
            "paidConversionAssociation": _association_summary(
                workspace_count, len(ai_workspace_ids), len(paid_workspace_ids),
                len(ai_workspace_ids & paid_workspace_ids),
            ),
        }
    if view == "retention":
        retention_clauses = ["cohort_week >= ?", "cohort_week <= ?"]
        retention_params = [normalized["from"], normalized["to"]]
        if normalized.get("cohortKind") in {"signup", "first_value", "paid_activation"}:
            retention_clauses.append("cohort_kind = ?")
            retention_params.append(normalized["cohortKind"])
        if normalized.get("ownerKind") in {"account", "organization"}:
            retention_clauses.append("owner_kind = ?")
            retention_params.append(normalized["ownerKind"])
        if normalized.get("releaseId"):
            retention_clauses.append("commercial_release_id = ?")
            retention_params.append(normalized["releaseId"])
        release_mode = _release_mode_condition("commercial_release_id", normalized.get("releaseMode"))
        if release_mode:
            retention_clauses.append(release_mode)
        for value, dimension in (
            (normalized.get("variant"), "variant"),
            (normalized.get("sizeBucket"), "size"),
            (normalized.get("procurementIntensity"), "procurement"),
            (normalized.get("collaborationIntensity"), "collaboration"),
            (normalized.get("aiAdoption"), "ai"),
        ):
            if value:
                retention_clauses.append("segment_key LIKE ?")
                retention_params.append(f"%{dimension}={value}%")
        cohort_rows = cursor.execute(
            f"""SELECT cohort_week,cohort_kind,week_number,
                       SUM(workspace_count) AS workspace_count,
                       SUM(retained_workspaces) AS retained_workspaces
                  FROM retention_cohort_weekly
                 WHERE {' AND '.join(retention_clauses)}
                 GROUP BY cohort_week,cohort_kind,week_number
                 ORDER BY cohort_week,cohort_kind,week_number""",
            tuple(retention_params),
        ).fetchall()
        normalized_cohorts = []
        for row in cohort_rows:
            item = _row_dict(row)
            total = int(item.get("workspace_count") or 0)
            retained = int(item.get("retained_workspaces") or 0)
            normalized_cohorts.append({
                "segment": f"{item.get('cohort_kind')} / {item.get('cohort_week')} / W{item.get('week_number')}",
                "cohort": str(item.get("cohort_week") or ""),
                "cohortKind": str(item.get("cohort_kind") or ""),
                "weekNumber": int(item.get("week_number") or 0),
                "workspaceCount": total,
                "retainedWorkspaces": retained,
                "retentionRate": retained / total if total else 0,
                "mature": True,
            })
        response["cohorts"] = suppress_small_cohorts(normalized_cohorts)
        response["retentionWeeks"] = [1, 2, 4, 8, 12]
        response["cohortKinds"] = ["signup", "first_value", "paid_activation"]
        cohort_series = defaultdict(list)
        for row in response["cohorts"]:
            if row.get("suppressed"):
                continue
            cohort_series[str(row.get("cohort"))].append({
                "label": f"W{row.get('weekNumber')}", "value": row.get("retentionRate"),
            })
        response["viewCharts"] = [{
            "key": "retention_heatmap", "label": "Mature retention cohorts",
            "series": [
                {"key": cohort, "label": cohort, "points": points}
                for cohort, points in sorted(cohort_series.items())
            ],
        }]
    if view == "plan-fit":
        plan_fit_clauses = ["snapshot_month >= ?", "snapshot_month <= ?"]
        plan_fit_params = [_month_start(start).isoformat(), _month_start(end).isoformat()]
        for parameter, column in (
            (normalized.get("ownerKind"), "owner_kind"), (normalized.get("releaseId"), "commercial_release_id"),
            (normalized.get("variant"), "variant"), (normalized.get("plan"), "plan_code"),
            (normalized.get("sizeBucket"), "size_bucket"),
        ):
            if parameter:
                plan_fit_clauses.append(f"{column} = ?")
                plan_fit_params.append(parameter)
        release_mode = _release_mode_condition("commercial_release_id", normalized.get("releaseMode"))
        if release_mode:
            plan_fit_clauses.append(release_mode)
        response["planFit"] = cursor.execute(
            f"""SELECT classification, COUNT(*) AS workspace_count
                  FROM plan_fit_monthly WHERE {' AND '.join(plan_fit_clauses)}
                 GROUP BY classification ORDER BY classification""",
            tuple(plan_fit_params),
        ).fetchall()
        response["planFit"] = suppress_small_cohorts([
            {"classification": str(_row_dict(row).get("classification")),
             "segment": str(_row_dict(row).get("classification")),
             "workspaceCount": int(_row_dict(row).get("workspace_count") or 0)}
            for row in response["planFit"]
        ], threshold=PRICING_RECOMMENDATION_THRESHOLD)
        response["segments"] = response["planFit"]
        detail_count = cursor.execute(
            f"SELECT COUNT(*) AS row_count FROM plan_fit_monthly WHERE {' AND '.join(plan_fit_clauses)}",
            tuple(plan_fit_params),
        ).fetchone()
        detail_total = int((_row_dict(detail_count) if detail_count else {}).get("row_count") or 0)
        detail_rows = cursor.execute(
            f"""SELECT snapshot_month,analytics_workspace_id,plan_code,variant,size_bucket,
                       active_seats,seat_utilization,procurement_usage,quota_utilization,
                       topup_spend_vnd,repeat_topups,connected_feature_days,workflow_volume,
                       workflow_depth,export_intensity,ai_intensity,estimated_cost_vnd,cost_status,
                       revenue_vnd,revenue_status,price_gap_to_connected_vnd,days_to_break_even,
                       classification,rule_version
                  FROM plan_fit_monthly WHERE {' AND '.join(plan_fit_clauses)}
                 ORDER BY snapshot_month DESC,classification,analytics_workspace_id LIMIT ? OFFSET ?""",
            (*plan_fit_params, page_size, (page - 1) * page_size),
        ).fetchall()
        response["planFitDetails"] = [_row_dict(row) for row in detail_rows]
        response["table"] = response["planFitDetails"]
        response["pagination"] = _pagination_metadata(page, page_size, detail_total)
        response["viewCharts"] = [{
            "key": "plan_fit", "label": "Plan fit classifications", "series": [{
                "key": "workspaces", "label": "Workspaces", "points": [
                    {"label": row.get("classification") or row.get("segment"),
                     "value": None if row.get("suppressed") else row.get("workspaceCount"),
                     "status": row.get("status")}
                    for row in response["planFit"]
                ],
            }],
        }]
    if view == "seats":
        by_workspace = {}
        for row in rows:
            key = row.get("analytics_workspace_id")
            current = by_workspace.get(key)
            if current is None or str(row.get("usage_date") or "") > current["usageDate"]:
                by_workspace[key] = {
                    "usageDate": str(row.get("usage_date") or ""),
                    "registered": int(row.get("registered_seats") or 0),
                    "active": int(row.get("active_seats") or 0),
                    "power": int(row.get("power_seats") or 0),
                    "plan": row.get("plan_code") or "Unassigned",
                }
        quota_rows = cursor.execute(
            f"""SELECT DISTINCT ON (analytics_workspace_id)
                       analytics_workspace_id, member_quota
                  FROM subscription_snapshot_daily
                 WHERE {' AND '.join(subscription_clauses)}
                 ORDER BY analytics_workspace_id, snapshot_date DESC""",
            tuple(subscription_params),
        ).fetchall()
        quotas = {
            str(_row_dict(row).get("analytics_workspace_id")): max(0, int(_row_dict(row).get("member_quota") or 0))
            for row in quota_rows
        }
        histogram = {key: 0 for key in SEAT_BUCKETS}
        for item in by_workspace.values():
            histogram_key = _seat_bucket_exact(item["active"])
            histogram[histogram_key] += 1
        response["segments"] = [
            {"segment": key,
             "workspaceCount": None if count < SMALL_COHORT_THRESHOLD else count,
             "eventCount": None if count < SMALL_COHORT_THRESHOLD else count,
             "suppressed": count < SMALL_COHORT_THRESHOLD,
             "status": "insufficient_sample" if count < SMALL_COHORT_THRESHOLD else "available"}
            for key, count in histogram.items()
        ]
        response["seatDistribution"] = response["segments"]
        response["seatPercentiles"] = _percentile_summary(
            [item["active"] for item in by_workspace.values()],
            (10, 25, 50, 60, 75, 80, 90, 95, 99),
        )
        response["tierMarkers"] = [1, 5, 15, 50]
        tier_groups = {}
        for workspace_id, item in by_workspace.items():
            quota = quotas.get(str(workspace_id), 0)
            tier = str(quota) if quota else item["plan"]
            target = tier_groups.setdefault(tier, [])
            target.append({**item, "quota": quota})
        response["tierTable"] = []
        for tier, items in sorted(tier_groups.items()):
            if len(items) < SMALL_COHORT_THRESHOLD:
                response["tierTable"].append({
                    "currentTier": tier,
                    "workspaceCount": None,
                    "suppressed": True,
                    "status": "insufficient_sample",
                })
                continue
            active_values = [item["active"] for item in items]
            utilizations = [item["active"] / item["quota"] for item in items if item["quota"] > 0]
            active_summary = _percentile_summary(active_values, (50, 90))
            utilization_summary = _percentile_summary(
                [round(value * 10_000) for value in utilizations], (50,)
            )
            response["tierTable"].append({
                "currentTier": tier,
                "workspaceCount": len(items),
                "medianActiveSeats": active_summary["P50"],
                "p90ActiveSeats": active_summary["P90"],
                "medianSeatUtilization": (
                    utilization_summary["P50"] / 10_000
                    if utilization_summary["P50"] is not None else None
                ),
                "atOrAbove80Percent": (
                    sum(value >= 0.8 for value in utilizations) / len(utilizations)
                    if utilizations else None
                ),
                "overLimit": (
                    sum(value > 1 for value in utilizations) / len(utilizations)
                    if utilizations else None
                ),
            })
        total_with_quota = sum(1 for workspace_id in by_workspace if quotas.get(str(workspace_id), 0) > 0)
        pressure_80 = sum(
            item["active"] / quotas[str(workspace_id)] >= 0.8
            for workspace_id, item in by_workspace.items() if quotas.get(str(workspace_id), 0) > 0
        )
        over_quota = sum(
            item["active"] > quotas[str(workspace_id)]
            for workspace_id, item in by_workspace.items() if quotas.get(str(workspace_id), 0) > 0
        )
        total_quota = sum(
            quotas[str(workspace_id)]
            for workspace_id in by_workspace if quotas.get(str(workspace_id), 0) > 0
        )
        active_with_quota = sum(
            item["active"] for workspace_id, item in by_workspace.items()
            if quotas.get(str(workspace_id), 0) > 0
        )
        response["kpis"] = [
            {"key": "registeredSeats", "label": "Registered seats", "value": sum(item["registered"] for item in by_workspace.values())},
            {"key": "monthlyActiveSeats", "label": "Monthly active seats", "value": sum(item["active"] for item in by_workspace.values())},
            {"key": "powerSeats", "label": "Power seats", "value": sum(item["power"] for item in by_workspace.values())},
            {"key": "workspacesAt80Percent", "label": "Workspaces ≥80% quota", "value": pressure_80},
            {"key": "workspacesOverQuota", "label": "Workspaces over quota", "value": over_quota},
            {"key": "seatUtilization", "label": "Seat utilization", "value": active_with_quota / total_quota if total_quota else None},
            {"key": "seatUtilizationCoverage", "label": "Quota coverage", "value": total_with_quota},
        ]
        response["viewCharts"] = [{
            "key": "seat_histogram", "label": "Monthly active seat distribution", "series": [{
                "key": "workspaces", "label": "Workspaces", "points": [
                    {"label": row["segment"], "value": None if row.get("suppressed") else row["workspaceCount"],
                     "status": row.get("status")}
                    for row in response["seatDistribution"]
                ],
            }],
        }]
    if view in {"procurement", "credits"}:
        metric_keys = (
            ("fetchAttempted", "Fetch attempted", "fetch_attempted"),
            ("successfulFetches", "Fetch succeeded", "successful_fetches"),
            ("uniqueBillableFetches", "Unique billable fetches", "successful_fetches"),
            ("fetchFailures", "Failures", "fetch_failures"),
            ("fetchCancelled", "Cancelled", "fetch_cancelled"),
            ("creditsReserved", "Credits reserved", "credits_reserved"),
            ("creditsReleased", "Credits released", "credits_released"),
            ("includedCreditsConsumed", "Included credits consumed", "included_credits_consumed"),
            ("purchasedCredits", "Purchased credits", "purchased_credits"),
            ("unusedPurchasedCredits", "Unused purchased credits", "purchased_credits_unused"),
            ("expiredUnusedCredits", "Expired unused credits", "expired_unused_credits"),
        )
        response["kpis"] = [{"key": key, "label": label, "value": _sum(rows, column)} for key, label, column in metric_keys]
        workspace_usage = {}
        for row in rows:
            workspace_id = str(row.get("analytics_workspace_id") or "")
            target = workspace_usage.setdefault(workspace_id, {
                "fetches": 0, "attempts": 0, "consumed": 0, "granted": 0,
                "purchased": 0, "unused": 0, "topupSpend": 0, "topupDates": [],
                "plan": row.get("plan_code") or "Unassigned",
                "variant": row.get("variant") or "unknown",
            })
            target["fetches"] += max(0, int(row.get("successful_fetches") or 0))
            target["attempts"] += max(0, int(row.get("fetch_attempted") or 0))
            target["consumed"] += max(0, int(row.get("included_credits_consumed") or 0))
            target["granted"] += max(0, int(row.get("included_credits_granted") or 0))
            target["purchased"] += max(0, int(row.get("purchased_credits") or 0))
            target["unused"] = max(target["unused"], max(0, int(row.get("purchased_credits_unused") or 0)))
            target["topupSpend"] += max(0, int(row.get("topup_spend_vnd") or 0))
            if int(row.get("purchased_credits") or 0) > 0:
                target["topupDates"].append(date.fromisoformat(str(row.get("usage_date"))))
        if view == "procurement":
            percentiles = _percentile_summary(
                [item["fetches"] for item in workspace_usage.values()],
                (25, 50, 70, 75, 80, 90, 95, 99),
            )
            utilization = [
                item["consumed"] / item["granted"]
                for item in workspace_usage.values() if item["granted"] > 0
            ]
            cost_clauses = ["usage_date >= ?", "usage_date < ?"]
            cost_params = [query_filters["from"], query_filters["to"]]
            for parameter, column in (
                (normalized.get("ownerKind"), "owner_kind"),
                (normalized.get("releaseId"), "commercial_release_id"),
                (normalized.get("variant"), "variant"),
                (normalized.get("plan"), "plan_code"),
            ):
                if parameter:
                    cost_clauses.append(f"{column} = ?")
                    cost_params.append(parameter)
            release_mode = _release_mode_condition("commercial_release_id", normalized.get("releaseMode"))
            if release_mode:
                cost_clauses.append(release_mode)
            if normalized.get("paidState") == "paid":
                cost_clauses.append("plan_code != ''")
            elif normalized.get("paidState") == "free":
                cost_clauses.append("plan_code = ''")
            procurement_cost_row = cursor.execute(
                f"""SELECT COUNT(*) FILTER (WHERE cost_status='available') AS available_rows,
                           COALESCE(SUM(quantity),0) AS quantity,
                           COALESCE(SUM(estimated_cost_vnd)
                             FILTER (WHERE cost_status='available'),0) AS estimated_cost
                      FROM cost_usage_daily
                     WHERE {' AND '.join(cost_clauses)} AND cost_type='procurement_fetch'""",
                tuple(cost_params),
            ).fetchone()
            procurement_cost = _row_dict(procurement_cost_row) if procurement_cost_row else {}
            annualized_values = [
                round(item["fetches"] * 365 / max(1, (end - start).days + 1))
                for item in workspace_usage.values()
            ]
            annualized_bins = {
                "0": 0, "1_10": 0, "11_50": 0, "51_100": 0,
                "101_250": 0, "251_500": 0, "over_500": 0,
            }
            for value in annualized_values:
                key = (
                    "0" if value == 0 else "1_10" if value <= 10 else
                    "11_50" if value <= 50 else "51_100" if value <= 100 else
                    "101_250" if value <= 250 else "251_500" if value <= 500 else "over_500"
                )
                annualized_bins[key] += 1
            plan_utilization = defaultdict(lambda: {"workspaceCount": 0, "consumed": 0, "granted": 0})
            variant_usage = defaultdict(lambda: {"workspaceCount": 0, "fetches": 0})
            for item in workspace_usage.values():
                plan_target = plan_utilization[item["plan"]]
                plan_target["workspaceCount"] += 1
                plan_target["consumed"] += item["consumed"]
                plan_target["granted"] += item["granted"]
                variant_target = variant_usage[item["variant"]]
                variant_target["workspaceCount"] += 1
                variant_target["fetches"] += item["fetches"]
            plan_utilization_rows = suppress_small_cohorts([
                {
                    "segment": plan, "workspaceCount": value["workspaceCount"],
                    "utilization": value["consumed"] / value["granted"] if value["granted"] else None,
                }
                for plan, value in sorted(plan_utilization.items())
            ])
            variant_usage_rows = suppress_small_cohorts([
                {"segment": variant, **value}
                for variant, value in sorted(variant_usage.items())
            ])
            cost_trend_rows = cursor.execute(
                f"""SELECT usage_date,COALESCE(SUM(estimated_cost_vnd),0) AS estimated_cost
                      FROM cost_usage_daily
                     WHERE {' AND '.join(cost_clauses)} AND cost_type='procurement_fetch'
                       AND cost_status='available'
                     GROUP BY usage_date ORDER BY usage_date""",
                tuple(cost_params),
            ).fetchall()
            response["procurement"] = {
                "fetchesPerWorkspacePercentiles": percentiles,
                "annualizedFetchesHistogram": suppress_small_cohorts([
                    {"segment": key, "workspaceCount": value}
                    for key, value in annualized_bins.items()
                ]),
                "quotaUtilization": {
                    "workspaceCount": len(utilization),
                    "median": (
                        _percentile_summary([round(value * 10_000) for value in utilization], (50,))["P50"] / 10_000
                        if utilization else None
                    ),
                    "atOrAbove80Percent": sum(value >= 0.8 for value in utilization),
                    "over100Percent": sum(value > 1 for value in utilization),
                },
                "cacheHits": {"status": "not_available", "reason": "No complete durable cache-hit fact exists."},
                "externalCost": {
                    "status": "available" if int(procurement_cost.get("available_rows") or 0) else "not_configured",
                    "quantity": int(procurement_cost.get("quantity") or 0),
                    "estimatedCostVnd": (
                        int(procurement_cost.get("estimated_cost") or 0)
                        if int(procurement_cost.get("available_rows") or 0) else None
                    ),
                    "label": "Estimated" if int(procurement_cost.get("available_rows") or 0) else "Not configured",
                },
            }
            response["viewCharts"] = [
                {"key": "fetch_distribution", "label": "Successful fetches/workspace distribution", "series": [{
                    "key": "percentile", "label": "Successful fetches", "points": [
                        {"label": key, "value": value} for key, value in percentiles.items() if key != "Max"
                    ],
                }]},
                {"key": "annualized_histogram", "label": "Annualized usage histogram", "series": [{
                    "key": "workspaces", "label": "Workspaces", "points": [
                        {"label": row["segment"], "value": None if row.get("suppressed") else row["workspaceCount"],
                         "status": row.get("status")}
                        for row in response["procurement"]["annualizedFetchesHistogram"]
                    ],
                }]},
                {"key": "quota_by_plan", "label": "Quota utilization by plan", "series": [{
                    "key": "utilization", "label": "Utilization", "points": [
                        {"label": row["segment"], "value": None if row.get("suppressed") else row.get("utilization"),
                         "status": row.get("status")}
                        for row in plan_utilization_rows
                    ],
                }]},
                {"key": "procurement_trend", "label": "Procurement usage trend", "series": [{
                    "key": "fetches", "label": "Successful fetches", "points": _trend(rows, "successful_fetches"),
                }]},
                {"key": "external_cost", "label": "External cost trend", "series": [{
                    "key": "cost", "label": "Estimated external cost", "points": [
                        {"date": str(_row_dict(row).get("usage_date") or ""),
                         "value": int(_row_dict(row).get("estimated_cost") or 0)}
                        for row in cost_trend_rows
                    ],
                }]},
                {"key": "variant_usage", "label": "Internal vs Connected usage", "series": [{
                    "key": "fetches", "label": "Successful fetches", "points": [
                        {"label": row["segment"], "value": None if row.get("suppressed") else row.get("fetches"),
                         "status": row.get("status")}
                        for row in variant_usage_rows
                    ],
                }]},
            ]
            response["table"] = [
                {"metric": label, "value": percentiles[label]}
                for label in ("P25", "P50", "P70", "P75", "P80", "P90", "P95", "P99")
            ]
        else:
            pack_clauses = ["pack.purchase_date >= ?", "pack.purchase_date < ?"]
            pack_params = [query_filters["from"], query_filters["to"]]
            if normalized.get("ownerKind"):
                pack_clauses.append("pack.owner_kind = ?")
                pack_params.append(normalized["ownerKind"])
            if normalized.get("releaseId"):
                pack_clauses.append("pack.commercial_release_id = ?")
                pack_params.append(normalized["releaseId"])
            release_mode = _release_mode_condition("pack.commercial_release_id", normalized.get("releaseMode"))
            if release_mode:
                pack_clauses.append(release_mode)
            usage_predicates = []
            for parameter, column in (
                (normalized.get("variant"), "variant"),
                (normalized.get("plan"), "plan_code"),
                (normalized.get("sizeBucket"), "size_bucket"),
            ):
                if parameter:
                    usage_predicates.append(f"usage.{column} = ?")
                    pack_params.append(parameter)
            if usage_predicates:
                pack_clauses.append(
                    "EXISTS (SELECT 1 FROM workspace_usage_daily usage "
                    "WHERE usage.analytics_workspace_id=pack.analytics_workspace_id "
                    "AND usage.usage_date=pack.purchase_date AND " + " AND ".join(usage_predicates) + ")"
                )
            pack_rows = [
                _row_dict(row) for row in cursor.execute(
                    f"""SELECT pack.* FROM credit_pack_purchase_daily pack
                         WHERE {' AND '.join(pack_clauses)}
                         ORDER BY pack.analytics_workspace_id,pack.purchase_date,pack.pack_size""",
                    tuple(pack_params),
                ).fetchall()
            ]
            purchase_dates = defaultdict(list)
            for pack in pack_rows:
                purchase_dates[str(pack["analytics_workspace_id"])].extend(
                    [date.fromisoformat(str(pack["purchase_date"]))] * int(pack.get("purchase_count") or 0)
                )
            intervals = []
            for dates in purchase_dates.values():
                ordered_dates = sorted(dates)
                intervals.extend((right - left).days for left, right in zip(ordered_dates, ordered_dates[1:]))
            repeat_workspaces = sum(len(dates) >= 2 for dates in purchase_dates.values())
            topup_workspaces = len(purchase_dates)
            median_interval = _percentile_summary(intervals, (50,))["P50"] if intervals else None
            mix = defaultdict(lambda: {"purchaseCount": 0, "creditsPurchased": 0, "revenueVnd": 0, "unusedCredits": 0})
            for pack in pack_rows:
                target = mix[int(pack["pack_size"])]
                target["purchaseCount"] += int(pack.get("purchase_count") or 0)
                target["creditsPurchased"] += int(pack.get("credits_purchased") or 0)
                target["revenueVnd"] += int(pack.get("gross_revenue_vnd") or 0)
                target["unusedCredits"] += int(pack.get("unused_credits") or 0)
            small_pack_signals = []
            for workspace_id, dates in purchase_dates.items():
                workspace_pack_rows = [pack for pack in pack_rows if str(pack["analytics_workspace_id"]) == workspace_id]
                for pack_size in sorted({int(pack["pack_size"]) for pack in workspace_pack_rows}):
                    pack_dates = []
                    for pack in workspace_pack_rows:
                        if int(pack["pack_size"]) == pack_size:
                            pack_dates.extend([date.fromisoformat(str(pack["purchase_date"]))] * int(pack["purchase_count"]))
                    pack_dates.sort()
                    qualifying = any(
                        sum(current <= other <= current + timedelta(days=44) for other in pack_dates) >= 4
                        for current in pack_dates
                    )
                    if qualifying:
                        small_pack_signals.append({"packSize": pack_size, "workspaceId": workspace_id})
            signals_by_pack = defaultdict(set)
            for signal in small_pack_signals:
                signals_by_pack[signal["packSize"]].add(signal["workspaceId"])
            aggregated_signals = suppress_small_cohorts([
                {
                    "segment": str(pack_size), "packSize": pack_size,
                    "workspaceCount": len(workspace_ids),
                    "signal": "four_purchases_within_45_days",
                }
                for pack_size, workspace_ids in sorted(signals_by_pack.items())
            ])
            credits_purchased = sum(int(pack.get("credits_purchased") or 0) for pack in pack_rows)
            unused_purchased = sum(int(pack.get("unused_credits") or 0) for pack in pack_rows)
            response["credits"] = {
                "creditsPurchased": credits_purchased,
                "unusedPurchasedCredits": unused_purchased,
                "purchasedCreditsConsumed": max(0, credits_purchased - unused_purchased),
                "topupRevenueVnd": sum(int(pack.get("gross_revenue_vnd") or 0) for pack in pack_rows),
                "topupWorkspaceCount": topup_workspaces,
                "repeatTopupWorkspaceCount": repeat_workspaces,
                "repeatTopupRate": repeat_workspaces / topup_workspaces if topup_workspaces else None,
                "medianDaysBetweenTopups": median_interval,
                "topupAttachRate": topup_workspaces / int(paid_item.get("paid") or 0) if int(paid_item.get("paid") or 0) else None,
                "packSalesMix": [{"packSize": pack_size, **values} for pack_size, values in sorted(mix.items())],
                "smallPack45DaySignals": aggregated_signals,
                "upgradeEquivalentSpend": {"status": "not_available", "reason": "No authoritative workspace-level catalog price-gap attribution."},
                "expiredUnusedCredits": {
                    "status": "available",
                    "value": _sum(rows, "expired_unused_credits"),
                },
            }
            response["table"] = response["credits"]["packSalesMix"]
            response["viewCharts"] = [
                {"key": "pack_mix", "label": "Credit pack sales mix", "series": [{
                    "key": "purchases", "label": "Purchases", "points": [
                        {"label": str(row["packSize"]), "value": row["purchaseCount"]}
                        for row in response["credits"]["packSalesMix"]
                    ],
                }]},
                {"key": "pack_revenue", "label": "Credit pack revenue", "series": [{
                    "key": "revenue", "label": "Revenue", "points": [
                        {"label": str(row["packSize"]), "value": row["revenueVnd"]}
                        for row in response["credits"]["packSalesMix"]
                    ],
                }]},
            ]
    if view == "activation":
        activation_clauses = ["signup_at >= ?", "signup_at < ?"]
        activation_params = [
            int(datetime.combine(start, time.min, PRODUCT_TIMEZONE).timestamp()),
            int(datetime.combine(end + timedelta(days=1), time.min, PRODUCT_TIMEZONE).timestamp()),
        ]
        for parameter, column in (
            (normalized.get("ownerKind"), "owner_kind"),
            (normalized.get("releaseId"), "commercial_release_id"),
            (normalized.get("variant"), "variant"),
            (normalized.get("plan"), "plan_code"),
            (normalized.get("sizeBucket"), "size_bucket"),
        ):
            if parameter:
                activation_clauses.append(f"{column} = ?")
                activation_params.append(parameter)
        release_mode = _release_mode_condition("commercial_release_id", normalized.get("releaseMode"))
        if release_mode:
            activation_clauses.append(release_mode)
        if normalized.get("paidState") == "paid":
            activation_clauses.append("subscription_activated_at IS NOT NULL")
        elif normalized.get("paidState") == "free":
            activation_clauses.append("subscription_activated_at IS NULL")
        activation_rows = [
            _row_dict(row) for row in cursor.execute(
                f"SELECT * FROM workspace_activation_facts WHERE {' AND '.join(activation_clauses)}",
                tuple(activation_params),
            ).fetchall()
        ]
        signup_count = len(activation_rows)
        account_rows = [row for row in activation_rows if row.get("owner_kind") == "account"]
        verified_count = sum(row.get("verification_observation") in {"observed", "historical_timestamp_unavailable"} for row in account_rows)
        verification_durations = [
            int(row["verification_at"]) - int(row["signup_at"])
            for row in account_rows if row.get("verification_at") is not None
        ]
        ttfv = [
            int(row["first_value_at"]) - int(row["signup_at"])
            for row in activation_rows if row.get("first_value_at") is not None
        ]
        paid_ttfv = [
            int(row["first_paid_value_at"]) - int(row["subscription_activated_at"])
            for row in activation_rows if row.get("first_paid_value_at") is not None
            and row.get("subscription_activated_at") is not None
        ]
        last_observed_day = end
        retention = {}
        for day_number in (1, 7, 30):
            eligible = []
            retained = 0
            for row in activation_rows:
                signup_day = datetime.fromtimestamp(int(row["signup_at"]), PRODUCT_TIMEZONE).date()
                observation_day = signup_day + timedelta(days=day_number)
                if observation_day > last_observed_day:
                    continue
                eligible.append(row)
                retained += any(
                    usage.get("analytics_workspace_id") == row.get("analytics_workspace_id")
                    and str(usage.get("usage_date")) == observation_day.isoformat()
                    and int(usage.get("meaningful_actions") or 0) > 0
                    for usage in rows
                )
            retention[f"D{day_number}"] = {
                "eligibleWorkspaces": (
                    len(eligible) if len(eligible) >= SMALL_COHORT_THRESHOLD else None
                ),
                "retainedWorkspaces": (
                    retained if len(eligible) >= SMALL_COHORT_THRESHOLD else None
                ),
                "rate": retained / len(eligible) if len(eligible) >= SMALL_COHORT_THRESHOLD else None,
                "status": "available" if len(eligible) >= SMALL_COHORT_THRESHOLD else "insufficient_sample",
            }
        ordered_stages = (
            ("signup", lambda row: True),
            ("verified", lambda row: row.get("verification_observation") in {"observed", "historical_timestamp_unavailable"}),
            ("first_login", lambda row: row.get("first_login_at") is not None),
            ("first_meaningful_value", lambda row: row.get("first_value_at") is not None),
            ("first_plan", lambda row: row.get("first_plan_at") is not None),
            ("first_procurement_or_export", lambda row: row.get("first_procurement_or_export_at") is not None),
        )
        activation_funnel = [
            {"stage": stage, "workspaceCount": sum(predicate(row) for row in activation_rows)}
            for stage, predicate in ordered_stages
        ]
        for day_number in (7, 30):
            retention_item = retention[f"D{day_number}"]
            activation_funnel.append({
                "stage": f"D{day_number}_retained",
                "workspaceCount": retention_item["retainedWorkspaces"],
                "status": retention_item["status"],
            })
        response["activation"] = {
            "funnel": activation_funnel,
            "verification": {
                "eligibleAccounts": len(account_rows),
                "verifiedAccounts": verified_count,
                "rate": verified_count / len(account_rows) if account_rows else None,
                "timing": _duration_percentiles(verification_durations),
                "timingCoverage": len(verification_durations),
                "historicalTimestampUnavailable": sum(row.get("verification_observation") == "historical_timestamp_unavailable" for row in account_rows),
            },
            "ttfv": {**_duration_percentiles(ttfv), "observedWorkspaces": len(ttfv)},
            "paidTtfv": {**_duration_percentiles(paid_ttfv), "observedWorkspaces": len(paid_ttfv)},
            "neverActivated": {
                "workspaceCount": sum(row.get("first_value_at") is None for row in activation_rows),
                "rate": sum(row.get("first_value_at") is None for row in activation_rows) / signup_count if signup_count else None,
            },
            "retention": retention,
        }
        response["kpis"] = [
            {"key": "signups", "label": "Signups", "value": signup_count},
            {"key": "firstValueWorkspaces", "label": "First value", "value": len(ttfv)},
            {"key": "medianTtfvSeconds", "label": "Median TTFV", "value": response["activation"]["ttfv"]["medianSeconds"]},
            {"key": "p90TtfvSeconds", "label": "P90 TTFV", "value": response["activation"]["ttfv"]["p90Seconds"]},
            {"key": "neverActivatedRate", "label": "Never activated", "value": response["activation"]["neverActivated"]["rate"]},
        ]
        response["viewCharts"] = [{
            "key": "activation_funnel", "label": "Activation journey", "series": [{
                "key": "workspaces", "label": "Workspaces", "points": [
                    {"label": stage["stage"], "value": stage["workspaceCount"],
                     "status": stage.get("status")}
                    for stage in response["activation"]["funnel"]
                ],
            }],
        }]
        breakdown = defaultdict(lambda: {"workspaceCount": 0, "activated": 0})
        for row in activation_rows:
            signup_day = datetime.fromtimestamp(int(row["signup_at"]), PRODUCT_TIMEZONE).date()
            acquisition_week = signup_day - timedelta(days=signup_day.weekday())
            key = f"{row.get('owner_kind')} / {acquisition_week.isoformat()} / {row.get('first_feature_key') or 'unknown'}"
            breakdown[key]["workspaceCount"] += 1
            breakdown[key]["activated"] += int(row.get("first_value_at") is not None)
        response["segments"] = suppress_small_cohorts([
            {"segment": key, **value, "activationRate": value["activated"] / value["workspaceCount"]}
            for key, value in sorted(breakdown.items())
        ])
    if view == "retention":
        response["segments"] = response.get("cohorts", [])
    if view == "overview":
        _finalize_overview(
            cursor, response, rows, start, end, normalized,
            subscription_clauses, tuple(subscription_params),
        )
    if response.get("table") and "pagination" not in response:
        table = response["table"]
        response["pagination"] = _pagination_metadata(page, page_size, len(table))
        response["table"] = table[(page - 1) * page_size:page * page_size]
    return response


def _pagination_metadata(page, page_size, total_rows):
    page_count = max(1, math.ceil(max(0, int(total_rows)) / page_size))
    return {
        "page": page, "pageSize": page_size, "totalRows": max(0, int(total_rows)),
        "pageCount": page_count, "hasPrevious": page > 1,
        "hasNext": page < page_count,
    }


def _finalize_overview(
    cursor, response, rows, start, end, filters, subscription_clauses, subscription_params,
):
    """Complete the executive read model after all source sections are available."""

    pricing_conversion = response.get("funnelSummary", {}).get("pricingToPaidConversionRate")
    retention = _retention_proxy(cursor, start, end, filters)
    response["kpis"].extend([
        {"key": "pricingToPaidConversionRate", "label": "Pricing → Paid Conversion",
         "value": pricing_conversion,
         "definition": "Pricing viewers reaching an authoritative subscription activation."},
        {"key": "d30PaidRetentionProxy", "label": "D30 Paid Retention Proxy",
         "value": retention["value"], "sampleStatus": retention["status"],
         "sampleSize": retention.get("workspaceCount"),
         "definition": "Paid-activation cohort active in mature W4 (28-day proxy)."},
    ])

    required_order = (
        "monthlyActiveWorkspaces", "monthlyActiveSeats", "paidWorkspaces", "newPaidWorkspaces",
        "grossRevenueVnd", "netSettledRevenueVnd", "topupRevenueVnd", "refundAmountVnd",
        "arpaVnd", "successfulProcurementFetches", "estimatedVariableCostVnd",
        "contributionMarginVnd", "pricingToPaidConversionRate", "d30PaidRetentionProxy",
    )
    by_key = {item["key"]: item for item in response["kpis"]}

    period_days = (end - start).days + 1
    previous_end = start - timedelta(days=1)
    previous_start = previous_end - timedelta(days=period_days - 1)
    previous = _overview_period_values(cursor, previous_start, previous_end, filters)
    directions = {
        "monthlyActiveWorkspaces": "neutral", "monthlyActiveSeats": "neutral",
        "paidWorkspaces": "increase_positive", "newPaidWorkspaces": "increase_positive",
        "grossRevenueVnd": "increase_positive", "netSettledRevenueVnd": "increase_positive",
        "topupRevenueVnd": "neutral", "refundAmountVnd": "increase_negative",
        "arpaVnd": "neutral", "successfulProcurementFetches": "neutral",
        "estimatedVariableCostVnd": "increase_negative",
        "contributionMarginVnd": "increase_positive",
        "pricingToPaidConversionRate": "increase_positive",
        "d30PaidRetentionProxy": "increase_positive",
    }
    rate_keys = {"pricingToPaidConversionRate", "d30PaidRetentionProxy"}
    overview_kpis = []
    for key in required_order:
        item = dict(by_key[key])
        prior = previous.get(key)
        change = (
            None if item.get("value") is None or prior is None
            else float(item["value"]) - float(prior)
            if key in rate_keys else _relative_change(item["value"], prior)
        )
        item.update({
            "previousValue": prior,
            "change": change,
            "changeKind": "percentage_point" if key in rate_keys else "relative",
            "changeState": _change_state(change, directions[key]),
            "directionality": directions[key],
        })
        overview_kpis.append(item)
    response["kpis"] = overview_kpis
    response["comparisonPeriod"] = {
        "from": previous_start.isoformat(), "to": previous_end.isoformat(),
        "days": period_days,
    }

    latest_day = max((str(row.get("usage_date") or "") for row in rows), default="")
    latest_rows = [row for row in rows if str(row.get("usage_date") or "") == latest_day]
    quota_rows = cursor.execute(
        f"""SELECT DISTINCT ON (analytics_workspace_id)
                   analytics_workspace_id,member_quota
              FROM subscription_snapshot_daily
             WHERE {' AND '.join(subscription_clauses)}
             ORDER BY analytics_workspace_id,snapshot_date DESC""",
        subscription_params,
    ).fetchall()
    quotas = {
        str(_row_dict(row).get("analytics_workspace_id")): max(0, int(_row_dict(row).get("member_quota") or 0))
        for row in quota_rows
    }
    pressure_groups = defaultdict(list)
    for row in latest_rows:
        workspace_id = str(row.get("analytics_workspace_id") or "")
        quota = quotas.get(workspace_id, 0)
        tier = str(quota) if quota else str(row.get("plan_code") or "Unassigned")
        if quota:
            pressure_groups[tier].append(max(0, int(row.get("active_seats") or 0)) / quota)
    response["overviewTierPressure"] = suppress_small_cohorts([
        {
            "segment": tier, "currentTier": tier, "workspaceCount": len(values),
            "atOrAbove80Percent": sum(value >= 0.8 for value in values) / len(values),
        }
        for tier, values in sorted(pressure_groups.items())
    ])

    paid = int(by_key.get("paidWorkspaces", {}).get("value") or 0)
    topup_workspaces = len({
        row.get("analytics_workspace_id") for row in rows
        if int(row.get("purchased_credits") or 0) > 0
    })
    response["comparisonSignals"] = {
        "current": {
            "variantCounts": {
                variant: _cohort_count(len({
                    row.get("analytics_workspace_id") for row in rows if row.get("variant") == variant
                }))
                for variant in ("internal", "connected")
            },
            "topupAttachRate": (
                topup_workspaces / paid if paid >= SMALL_COHORT_THRESHOLD else None
            ),
        },
        "previous": {
            "variantCounts": previous.get("variantCounts", {}),
            "topupAttachRate": previous.get("topupAttachRate"),
        },
    }
    response["overviewCharts"] = [
        {"key": "maw", "label": "MAW trend", "series": [
            {"key": "maw", "label": "MAW", "points": _workspace_count_trend(rows)},
        ]},
        {"key": "paid", "label": "Paid workspaces trend", "series": [
            {"key": "paid", "label": "Paid workspaces", "points": response.get("paidWorkspaceTrend", [])},
        ]},
        {"key": "revenue_cost", "label": "Revenue vs variable cost", "series": [
            {"key": "revenue", "label": "Net settled revenue", "points": response.get("revenueCostTrend", {}).get("revenue", [])},
            {"key": "cost", "label": "Estimated variable cost", "points": response.get("revenueCostTrend", {}).get("cost", [])},
        ]},
        {"key": "variant_mix", "label": "Internal vs Connected mix", "series": [
            {"key": "variant", "label": "Workspaces", "points": [
                {"label": row.get("variant") or row.get("segment"),
                 "value": None if row.get("suppressed") else row.get("workspaceCount"),
                 "status": row.get("status")}
                for row in response.get("mix", [])
            ]},
        ]},
        {"key": "plan_distribution", "label": "Plan distribution", "series": [
            {"key": "plan", "label": "Workspaces", "points": [
                {"label": row.get("plan") or row.get("segment"),
                 "value": None if row.get("suppressed") else row.get("workspaceCount"),
                 "status": row.get("status")}
                for row in response.get("planDistribution", [])
            ]},
        ]},
        {"key": "topup", "label": "Top-up revenue trend", "series": [
            {"key": "topup", "label": "Top-up revenue", "points": response.get("topupRevenueTrend", [])},
        ]},
    ]
    response["insights"] = _threshold_insights(response)


def _threshold_insights(response):
    """Generate deterministic, non-LLM observations from aggregate thresholds."""

    insights = []
    signals = response.get("comparisonSignals", {})
    current_variants = signals.get("current", {}).get("variantCounts", {})
    previous_variants = signals.get("previous", {}).get("variantCounts", {})
    connected_change = _relative_change(
        current_variants.get("connected"), previous_variants.get("connected")
    )
    if connected_change is not None and abs(connected_change) >= 0.05:
        direction = "increased" if connected_change > 0 else "decreased"
        insights.append({
            "key": "connected_mix",
            "message": f"Connected workspaces {direction} {abs(connected_change) * 100:.1f}% versus the comparable period.",
            "basis": "fixed 5% threshold; distinct workspace mix",
            "status": "descriptive",
        })
    else:
        mix = {
            row.get("variant"): int(row.get("workspaceCount") or 0)
            for row in response.get("mix", []) if not row.get("suppressed")
        }
        if mix.get("connected", 0) and mix.get("internal", 0):
            ratio = mix["connected"] / max(1, mix["internal"])
            insights.append({
                "key": "connected_mix",
                "message": f"Connected workspaces are {ratio:.1f}× Internal in the selected range.",
                "basis": "workspace mix; comparable-period change below threshold or unavailable",
                "status": "descriptive",
            })
    current_attach = signals.get("current", {}).get("topupAttachRate")
    previous_attach = signals.get("previous", {}).get("topupAttachRate")
    if current_attach is not None and previous_attach is not None:
        attach_delta = float(current_attach) - float(previous_attach)
        if abs(attach_delta) >= 0.05:
            direction = "increased" if attach_delta > 0 else "decreased"
            insights.append({
                "key": "topup_attach",
                "message": f"Top-up attach rate {direction} {abs(attach_delta) * 100:.1f} percentage points.",
                "basis": "fixed 5 percentage-point threshold",
                "status": "descriptive",
            })
    topup = sum(int(row.get("value") or 0) for row in response.get("topupRevenueTrend", []))
    if topup > 0:
        insights.append({"key": "topup_revenue", "message": "Top-up revenue is present in the selected range.", "basis": "workspace usage aggregate", "status": "descriptive"})
    pressure_rows = response.get("overviewTierPressure") or response.get("tierTable", [])
    pressure = sum(
        1 for row in pressure_rows
        if not row.get("suppressed") and float(row.get("atOrAbove80Percent") or 0) >= 0.5
    )
    if pressure:
        insights.append({"key": "seat_pressure", "message": f"Seat pressure appears in {pressure} tier segment(s).", "basis": "≥50% workspaces at ≥80% quota", "status": "descriptive"})
    return insights
