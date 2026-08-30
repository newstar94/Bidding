"""Idempotent analytics refresh from authoritative first-party facts."""
# ruff: noqa: S608 -- dynamic identifiers are selected from code-owned tuples.

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
import json
import math
import os
from zoneinfo import ZoneInfo

from .plan_fit import classify_plan_fit
from .privacy import analytics_identifier

PRODUCT_TIMEZONE = ZoneInfo("Asia/Ho_Chi_Minh")


def _local_date(value):
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(PRODUCT_TIMEZONE).date()
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, timezone.utc).astimezone(PRODUCT_TIMEZONE).date()
    return date.fromisoformat(str(value)[:10])


def _epoch(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return int(value.timestamp())
    if isinstance(value, (int, float)):
        return int(value)
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp())


def _month_start(value):
    return value.replace(day=1)


def _week_start(value):
    return value - timedelta(days=value.weekday())


def _bucket(seats):
    seats = max(0, int(seats or 0))
    if seats == 1:
        return "1"
    if seats <= 5:
        return "2_5"
    if seats <= 15:
        return "6_15"
    if seats <= 50:
        return "16_50"
    return "over_50"


def _owner_kind(value):
    return "account" if str(value or "").lower() in {"account", "personal"} else "organization"


def _owner(item):
    kind = _owner_kind(item.get("owner_kind") or item.get("owner_type"))
    raw_id = item.get("account_user_id") if kind == "account" else item.get("organization_id")
    return kind, str(raw_id or item.get("user_id") or "")


def _workspace_hash(kind, raw_id, key):
    raw = f"personal:{raw_id}" if kind == "account" and not str(raw_id).startswith("personal:") else raw_id
    return analytics_identifier("workspace", raw, key)


def _subscriptions(cursor):
    output = []
    for table, id_column, kind, quota in (
        ("organization_subscriptions", "organization_id", "organization", "subscription.member_quota"),
        ("account_subscriptions", "user_id", "account", "1"),
    ):
        rows = cursor.execute(  # noqa: S608 - identifiers come from fixed tuples above.
            f"""SELECT subscription.{id_column} AS owner_id, subscription.status,
                       subscription.starts_at, subscription.expires_at,
                       {quota} AS member_quota,
                       COALESCE(plan.release_id, '') AS release_id,
                       COALESCE(plan.logical_package_code, subscription.package_id, '') AS plan_code,
                       COALESCE(plan.variant, '') AS variant
                  FROM {table} AS subscription
                  LEFT JOIN billing_plan_versions AS plan
                    ON plan.id = subscription.plan_version_id"""
        ).fetchall()
        output.extend({**dict(row), "owner_kind": kind} for row in rows)
    return output


def _subscription_at(rows, kind, raw_id, day):
    epoch = int(datetime.combine(day, datetime.min.time(), PRODUCT_TIMEZONE).timestamp())
    for row in rows:
        if row["owner_kind"] != kind or str(row["owner_id"]) != str(raw_id):
            continue
        if row["status"] != "active" or int(row["starts_at"] or 0) > epoch:
            continue
        if row.get("expires_at") is not None and int(row["expires_at"]) < epoch:
            continue
        return row
    return None


def _empty_state():
    return {
        "feature_uses": 0, "word_exports": 0, "meaningful_actions": 0,
        "daily_users": defaultdict(lambda: defaultdict(int)),
        "feature_users": defaultdict(set), "feature_counts": defaultdict(int),
        "feature_user_counts": defaultdict(lambda: defaultdict(int)),
        "procurement_actions": 0, "successful_fetches": 0,
        "fetch_attempted": 0, "fetch_failures": 0, "fetch_cancelled": 0,
        "cache_hits": 0, "credits_reserved": 0, "credits_released": 0,
        "included_credits_granted": 0, "included_credits_consumed": 0,
        "purchased_credits": 0, "purchased_credits_unused": 0,
        "expired_unused_credits": 0,
        "topup_spend_vnd": 0, "ai_requests": 0, "ai_input_tokens": 0,
        "ai_output_tokens": 0, "ai_tool_calls": 0, "ai_estimated_cost_vnd": 0,
        "ai_cost_status": "not_configured",
        "ai_feedback_up": 0, "ai_feedback_down": 0,
        "ai_feedback_too_slow": 0, "ai_feedback_incorrect_source": 0,
        "document_jobs": 0,
    }


def _upsert_cost(
    cursor, key, *, release_id="", quantity=0, estimated=0,
    status="available",
):
    day, kind, workspace_id, plan, variant, cost_type, source = key
    if status not in {"available", "not_configured"}:
        raise ValueError("Analytics cost status is invalid.")
    cursor.execute(
        """INSERT INTO cost_usage_daily
           (usage_date, commercial_release_id, owner_kind, analytics_workspace_id,
            plan_code, variant, cost_type, quantity, estimated_cost_vnd, cost_status, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (usage_date, owner_kind, analytics_workspace_id, plan_code,
                        variant, cost_type, source) DO UPDATE SET
             commercial_release_id=excluded.commercial_release_id,
             quantity=excluded.quantity, estimated_cost_vnd=excluded.estimated_cost_vnd,
             cost_status=excluded.cost_status,
             updated_at=CURRENT_TIMESTAMP""",
        (day, release_id or None, kind, workspace_id, plan, variant, cost_type,
         max(0, int(quantity)), max(0, int(estimated)), status, source),
    )


def refresh_product_analytics(cursor, *, from_date, to_date, hmac_key):
    """Refresh a bounded, inclusive business-date range; caller owns commit."""

    if not hmac_key or len(str(hmac_key)) < 16:
        raise ValueError("ANALYTICS_HMAC_KEY must be configured for aggregation.")
    start = date.fromisoformat(str(from_date)[:10])
    end = date.fromisoformat(str(to_date)[:10])
    if end < start or (end - start).days > 366:
        raise ValueError("Analytics refresh range is invalid or too broad.")
    rolling_start = start - timedelta(days=29)
    rolling_epoch = int(datetime.combine(rolling_start, datetime.min.time(), PRODUCT_TIMEZONE).timestamp())
    start_epoch = int(datetime.combine(start, datetime.min.time(), PRODUCT_TIMEZONE).timestamp())
    end_epoch = int(datetime.combine(end + timedelta(days=1), datetime.min.time(), PRODUCT_TIMEZONE).timestamp())

    for table, column in (
        ("workspace_usage_daily", "usage_date"), ("workspace_feature_daily", "usage_date"),
        ("workspace_feature_user_daily", "usage_date"),
        ("workspace_seat_daily", "usage_date"), ("commercial_funnel_daily", "usage_date"),
        ("commercial_funnel_workspace_daily", "usage_date"),
        ("subscription_snapshot_daily", "snapshot_date"),
        ("revenue_daily", "usage_date"), ("cost_usage_daily", "usage_date"),
        ("credit_pack_purchase_daily", "purchase_date"),
    ):
        cursor.execute(  # noqa: S608 - table/column pairs are fixed above.
            f"DELETE FROM {table} WHERE {column} >= ? AND {column} < ?",
            (start.isoformat(), (end + timedelta(days=1)).isoformat()),
        )
    cursor.execute("DELETE FROM plan_fit_monthly WHERE snapshot_month >= ? AND snapshot_month <= ?", (_month_start(start).isoformat(), _month_start(end).isoformat()))

    subscriptions = _subscriptions(cursor)
    workspace = defaultdict(_empty_state)
    raw_meta = {}

    def state_for(day, kind, raw_id):
        workspace_id = _workspace_hash(kind, raw_id, hmac_key)
        raw_meta[workspace_id] = (kind, raw_id)
        return workspace[(day, workspace_id, kind)], workspace_id

    usage_rows = cursor.execute(
        """SELECT window_started_at, user_id, organization_id, owner_type,
                  metric_key, feature_key, event_count FROM product_usage_hourly
            WHERE window_started_at >= ? AND window_started_at < ?""",
        (rolling_epoch, end_epoch),
    ).fetchall()
    for source in usage_rows:
        item = dict(source)
        day = _local_date(item["window_started_at"])
        kind = _owner_kind(item["owner_type"])
        raw_id = item["user_id"] if kind == "account" else item["organization_id"]
        state, _ = state_for(day, kind, raw_id)
        count = max(0, int(item.get("event_count") or 0))
        user = analytics_identifier("user", item["user_id"], hmac_key)
        metric = item.get("metric_key")
        if metric != "presence.heartbeat":
            state["daily_users"][day][user] += count
            state["meaningful_actions"] += count
        if metric == "feature.used":
            feature = str(item.get("feature_key") or "")
            state["feature_uses"] += count
            state["feature_users"][feature].add(user)
            state["feature_counts"][feature] += count
            state["feature_user_counts"][feature][user] += count
        elif metric == "word_export.completed":
            state["word_exports"] += count

    activity_rows = cursor.execute(
        """SELECT occurred_at, organization_id, owner_type, actor_user_id, action
             FROM nhat_ky_thuc_hien
            WHERE occurred_at >= to_timestamp(?) AND occurred_at < to_timestamp(?)
              AND actor_user_id IS NOT NULL""",
        (rolling_epoch, end_epoch),
    ).fetchall()
    for source in activity_rows:
        item = dict(source)
        day = _local_date(item["occurred_at"])
        kind = _owner_kind(item.get("owner_type"))
        raw_id = item["actor_user_id"] if kind == "account" else item["organization_id"]
        state, _ = state_for(day, kind, raw_id)
        user = analytics_identifier("user", item["actor_user_id"], hmac_key)
        state["meaningful_actions"] += 1
        state["daily_users"][day][user] += 1
        if str(item.get("action") or "").startswith(("goithau", "hopdong", "assignment")):
            state["procurement_actions"] += 1

    _collect_procurement(cursor, state_for, start_epoch, end_epoch)
    _collect_ai(cursor, state_for, start, end)
    _collect_document_jobs(cursor, state_for, start_epoch, end_epoch)
    written_usage = _write_workspace_rows(cursor, workspace, raw_meta, subscriptions, start, end)
    subscription_rows = _write_subscription_snapshots(cursor, subscriptions, start, end, hmac_key)
    activation_rows = _refresh_activation_facts(cursor, hmac_key)
    funnel_rows = _refresh_funnel(cursor, start_epoch, end_epoch, hmac_key)
    revenue_rows = _refresh_revenue(cursor, start_epoch, end_epoch)
    credit_pack_rows = _refresh_credit_pack_purchases(cursor, start_epoch, end_epoch, hmac_key)
    _refresh_retention(cursor, hmac_key=hmac_key, observation_end=end)
    plan_fit_rows = _refresh_plan_fit(cursor, start, end)
    return {"from": start.isoformat(), "to": end.isoformat(), "workspaceRows": written_usage,
            "subscriptionRows": subscription_rows, "funnelRows": funnel_rows,
            "revenueRows": revenue_rows, "creditPackRows": credit_pack_rows,
            "activationRows": activation_rows, "planFitRows": plan_fit_rows}


def _write_subscription_snapshots(cursor, subscriptions, start, end, hmac_key):
    written = 0
    for row in subscriptions:
        started = _local_date(int(row["starts_at"]))
        expires = _local_date(int(row["expires_at"])) if row.get("expires_at") is not None else None
        first = max(start, started)
        last = min(end, expires) if expires else end
        if last < first:
            continue
        workspace_id = _workspace_hash(row["owner_kind"], str(row["owner_id"]), hmac_key)
        for offset in range((last - first).days + 1):
            day = first + timedelta(days=offset)
            cursor.execute(
                """INSERT INTO subscription_snapshot_daily
                   (snapshot_date,analytics_workspace_id,owner_kind,commercial_release_id,
                    plan_code,variant,member_quota,status,activated_today)
                   VALUES (?,?,?,?,?,?,?,?,?)
                   ON CONFLICT (snapshot_date,analytics_workspace_id) DO UPDATE SET
                    owner_kind=excluded.owner_kind,
                    commercial_release_id=excluded.commercial_release_id,
                    plan_code=excluded.plan_code,variant=excluded.variant,
                    member_quota=excluded.member_quota,status=excluded.status,
                    activated_today=excluded.activated_today,updated_at=CURRENT_TIMESTAMP""",
                (day.isoformat(), workspace_id, row["owner_kind"], row.get("release_id") or None,
                 row.get("plan_code") or "", row.get("variant") or "",
                 max(0, int(row.get("member_quota") or 0)), row["status"], int(day == started)),
            )
            written += 1
    return written


def _collect_procurement(cursor, state_for, start_epoch, end_epoch):
    rows = cursor.execute(
        """SELECT reservation.*, credit_grant.source AS grant_source,
                  ledger.entry_type, ledger.quantity, ledger.metadata_json,
                  ledger.created_at AS ledger_created_at
             FROM usage_reservations AS reservation
             JOIN usage_credit_grants AS credit_grant ON credit_grant.id = reservation.grant_id
             JOIN usage_ledger AS ledger ON ledger.reservation_id = reservation.id
            WHERE ledger.created_at >= to_timestamp(?) AND ledger.created_at < to_timestamp(?)
              AND ledger.entry_type IN ('reserve', 'consume', 'release')""",
        (start_epoch, end_epoch),
    ).fetchall()
    for source in rows:
        item = dict(source)
        kind, raw_id = _owner(item)
        if not raw_id:
            continue
        state, _ = state_for(_local_date(item["ledger_created_at"]), kind, raw_id)
        entry = item["entry_type"]
        if entry == "reserve":
            state["fetch_attempted"] += 1
            state["credits_reserved"] += abs(int(item.get("quantity") or 0))
        elif entry == "consume":
            state["successful_fetches"] += 1
            state["included_credits_consumed"] += int(item.get("grant_source") == "plan")
        else:
            state["credits_released"] += abs(int(item.get("quantity") or 0))
            try:
                reason = str(json.loads(item.get("metadata_json") or "{}").get("reason") or "")
            except (TypeError, ValueError):
                reason = ""
            state["fetch_cancelled" if "cancel" in reason else "fetch_failures"] += 1
    grants = cursor.execute(
        """SELECT credit_grant.*, price.total_amount
             FROM usage_credit_grants AS credit_grant
             LEFT JOIN billing_order_items AS item ON item.id = credit_grant.order_item_id
             LEFT JOIN billing_prices AS price ON price.id = item.price_id
            WHERE credit_grant.issued_at >= ? AND credit_grant.issued_at < ?""",
        (start_epoch, end_epoch),
    ).fetchall()
    for source in grants:
        item = dict(source)
        kind, raw_id = _owner(item)
        if not raw_id:
            continue
        state, _ = state_for(_local_date(item["issued_at"]), kind, raw_id)
        total = max(0, int(item.get("total") or 0))
        if item.get("source") == "plan":
            state["included_credits_granted"] += total
        elif item.get("source") == "purchase":
            state["purchased_credits"] += total
            state["purchased_credits_unused"] += max(0, int(item.get("remaining") or 0))
            state["topup_spend_vnd"] += max(0, int(item.get("total_amount") or 0))
    expired_grants = cursor.execute(
        """SELECT * FROM usage_credit_grants
            WHERE source='purchase' AND expires_at>=? AND expires_at<?""",
        (start_epoch, end_epoch),
    ).fetchall()
    for source in expired_grants:
        item = dict(source)
        kind, raw_id = _owner(item)
        if not raw_id:
            continue
        state, _ = state_for(_local_date(item["expires_at"]), kind, raw_id)
        state["expired_unused_credits"] += max(0, int(item.get("remaining") or 0))


def _collect_ai(cursor, state_for, start, end):
    configured_multiplier = str(os.environ.get("ANALYTICS_AI_COST_VND_MULTIPLIER") or "").strip()
    try:
        cost_multiplier = float(configured_multiplier) if configured_multiplier else 0.0
        cost_configured = (
            bool(configured_multiplier) and math.isfinite(cost_multiplier)
            and cost_multiplier >= 0
        )
    except ValueError:
        cost_multiplier = 0.0
        cost_configured = False
    cost_multiplier = cost_multiplier if cost_configured else 0.0
    for source in cursor.execute("SELECT * FROM ai_usage_daily WHERE usage_date >= ? AND usage_date <= ?", (start.isoformat(), end.isoformat())).fetchall():
        item = dict(source)
        organization_id = str(item["organization_id"])
        kind = "account" if organization_id.startswith("personal:") else "organization"
        raw_id = organization_id.removeprefix("personal:") if kind == "account" else organization_id
        state, _ = state_for(_local_date(item["usage_date"]), kind, raw_id)
        state["ai_requests"] += max(0, int(item.get("request_count") or 0))
        state["ai_input_tokens"] += max(0, int(item.get("input_tokens") or 0))
        state["ai_output_tokens"] += max(0, int(item.get("output_tokens") or 0))
        state["ai_tool_calls"] += max(0, int(item.get("tool_call_count") or 0))
        state["ai_cost_status"] = "available" if cost_configured else "not_configured"
        state["ai_estimated_cost_vnd"] += max(
            0, round(float(item.get("estimated_cost") or 0) * cost_multiplier)
        )
    feedback_rows = cursor.execute(
        """SELECT organization_id,rating,category,created_at FROM ai_feedback
            WHERE created_at>=? AND created_at<?""",
        (start.isoformat(), (end + timedelta(days=1)).isoformat()),
    ).fetchall()
    for source in feedback_rows:
        item = dict(source)
        organization_id = str(item["organization_id"])
        kind = "account" if organization_id.startswith("personal:") else "organization"
        raw_id = organization_id.removeprefix("personal:") if kind == "account" else organization_id
        state, _ = state_for(_local_date(item["created_at"]), kind, raw_id)
        state["ai_feedback_up" if item.get("rating") == "up" else "ai_feedback_down"] += 1
        if item.get("category") == "too_slow":
            state["ai_feedback_too_slow"] += 1
        if item.get("category") in {"incorrect_data", "missing_source"}:
            state["ai_feedback_incorrect_source"] += 1


def _collect_document_jobs(cursor, state_for, start_epoch, end_epoch):
    rows = cursor.execute(
        """SELECT completed_at, organization_id, user_id, COUNT(*) AS job_count
             FROM document_jobs WHERE status='completed' AND completed_at >= ? AND completed_at < ?
            GROUP BY completed_at, organization_id, user_id""", (start_epoch, end_epoch)).fetchall()
    for source in rows:
        item = dict(source)
        kind = "account" if str(item["organization_id"]).startswith("personal:") else "organization"
        raw_id = item["user_id"] if kind == "account" else item["organization_id"]
        state, _ = state_for(_local_date(item["completed_at"]), kind, raw_id)
        state["document_jobs"] += max(0, int(item.get("job_count") or 0))


def _write_workspace_rows(cursor, workspace, raw_meta, subscriptions, start, end):
    registered = {str(row["organization_id"]): int(row["member_count"] or 0) for row in cursor.execute(
        """SELECT organization_id, COUNT(*) AS member_count FROM thanh_vien_to_chuc
            WHERE trang_thai_thanh_vien='active' GROUP BY organization_id""").fetchall()}
    workspace_ids = {key[1] for key in workspace}
    written = 0
    for offset in range((end - start).days + 1):
        day = start + timedelta(days=offset)
        for workspace_id in workspace_ids:
            kind, raw_id = raw_meta[workspace_id]
            current = workspace.get((day, workspace_id, kind))
            rolling, active_days = defaultdict(int), defaultdict(set)
            for lookback in range(30):
                source_day = day - timedelta(days=lookback)
                historical = workspace.get((source_day, workspace_id, kind))
                if historical:
                    for user, count in historical["daily_users"].get(source_day, {}).items():
                        rolling[user] += count
                        active_days[user].add(source_day)
            if not current and not rolling:
                continue
            state = current or workspace[(day, workspace_id, kind)]
            subscription = _subscription_at(subscriptions, kind, raw_id, day) or {}
            registered_seats = 1 if kind == "account" else registered.get(str(raw_id), 0)
            release_id = str(subscription.get("release_id") or "")
            plan = str(subscription.get("plan_code") or "")
            variant = str(subscription.get("variant") or "")
            active = len(rolling)
            values = (
                day.isoformat(), workspace_id, kind, release_id or None, plan, variant,
                _bucket(active), registered_seats, active,
                sum(len(days) >= 8 for days in active_days.values()), state["meaningful_actions"],
                state["procurement_actions"], state["fetch_attempted"], state["fetch_failures"],
                state["fetch_cancelled"], state["cache_hits"], state["credits_reserved"],
                state["credits_released"], state["successful_fetches"], state["feature_uses"],
                state["word_exports"], state["included_credits_granted"],
                state["included_credits_consumed"], state["purchased_credits"],
                state["purchased_credits_unused"], state["expired_unused_credits"],
                state["topup_spend_vnd"],
                state["meaningful_actions"], state["ai_requests"], state["ai_input_tokens"],
                state["ai_output_tokens"], state["ai_tool_calls"], state["ai_feedback_up"],
                state["ai_feedback_down"], state["ai_feedback_too_slow"],
                state["ai_feedback_incorrect_source"], state["ai_estimated_cost_vnd"],
            )
            cursor.execute(
                """INSERT INTO workspace_usage_daily
                   (usage_date,analytics_workspace_id,owner_kind,commercial_release_id,plan_code,variant,
                    size_bucket,registered_seats,active_seats,power_seats,meaningful_actions,
                    procurement_actions,fetch_attempted,fetch_failures,fetch_cancelled,cache_hits,
                    credits_reserved,credits_released,successful_fetches,feature_uses,word_exports,
                    included_credits_granted,included_credits_consumed,purchased_credits,
                    purchased_credits_unused,expired_unused_credits,topup_spend_vnd,
                    workflow_volume,ai_requests,
                    ai_input_tokens,ai_output_tokens,ai_tool_calls,ai_feedback_up,ai_feedback_down,
                    ai_feedback_too_slow,ai_feedback_incorrect_source,ai_estimated_cost_vnd)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT (usage_date,analytics_workspace_id) DO UPDATE SET
                    owner_kind=excluded.owner_kind,commercial_release_id=excluded.commercial_release_id,
                    plan_code=excluded.plan_code,variant=excluded.variant,size_bucket=excluded.size_bucket,
                    registered_seats=excluded.registered_seats,active_seats=excluded.active_seats,
                    power_seats=excluded.power_seats,meaningful_actions=excluded.meaningful_actions,
                    procurement_actions=excluded.procurement_actions,fetch_attempted=excluded.fetch_attempted,
                    fetch_failures=excluded.fetch_failures,fetch_cancelled=excluded.fetch_cancelled,
                    cache_hits=excluded.cache_hits,credits_reserved=excluded.credits_reserved,
                    credits_released=excluded.credits_released,successful_fetches=excluded.successful_fetches,
                    feature_uses=excluded.feature_uses,word_exports=excluded.word_exports,
                    included_credits_granted=excluded.included_credits_granted,
                    included_credits_consumed=excluded.included_credits_consumed,
                    purchased_credits=excluded.purchased_credits,purchased_credits_unused=excluded.purchased_credits_unused,
                    expired_unused_credits=excluded.expired_unused_credits,
                    topup_spend_vnd=excluded.topup_spend_vnd,workflow_volume=excluded.workflow_volume,
                    ai_requests=excluded.ai_requests,ai_input_tokens=excluded.ai_input_tokens,
                    ai_output_tokens=excluded.ai_output_tokens,ai_tool_calls=excluded.ai_tool_calls,
                    ai_feedback_up=excluded.ai_feedback_up,ai_feedback_down=excluded.ai_feedback_down,
                    ai_feedback_too_slow=excluded.ai_feedback_too_slow,
                    ai_feedback_incorrect_source=excluded.ai_feedback_incorrect_source,
                    ai_estimated_cost_vnd=excluded.ai_estimated_cost_vnd,updated_at=CURRENT_TIMESTAMP""", values)
            written += 1
            for user, count in state["daily_users"].get(day, {}).items():
                cursor.execute("""INSERT INTO workspace_seat_daily
                    (usage_date,analytics_workspace_id,analytics_user_id,meaningful_actions)
                    VALUES (?,?,?,?) ON CONFLICT (usage_date,analytics_workspace_id,analytics_user_id)
                    DO UPDATE SET meaningful_actions=excluded.meaningful_actions,updated_at=CURRENT_TIMESTAMP""",
                               (day.isoformat(), workspace_id, user, count))
            for feature, users in state["feature_users"].items():
                if feature:
                    cursor.execute("""INSERT INTO workspace_feature_daily
                        (usage_date,analytics_workspace_id,feature_key,active_users,event_count)
                        VALUES (?,?,?,?,?) ON CONFLICT (usage_date,analytics_workspace_id,feature_key)
                        DO UPDATE SET active_users=excluded.active_users,event_count=excluded.event_count,
                                      updated_at=CURRENT_TIMESTAMP""",
                                   (day.isoformat(), workspace_id, feature, len(users), state["feature_counts"][feature]))
                    for user in users:
                        cursor.execute(
                            """INSERT INTO workspace_feature_user_daily
                               (usage_date,analytics_workspace_id,feature_key,analytics_user_id,event_count)
                               VALUES (?,?,?,?,?) ON CONFLICT
                               (usage_date,analytics_workspace_id,feature_key,analytics_user_id)
                               DO UPDATE SET event_count=excluded.event_count,updated_at=CURRENT_TIMESTAMP""",
                            (day.isoformat(), workspace_id, feature, user,
                             state["feature_user_counts"][feature][user]),
                        )
            if state["ai_requests"]:
                _upsert_cost(cursor, (day.isoformat(), kind, workspace_id, plan, variant, "ai", "ai_usage_daily"),
                             release_id=release_id, quantity=state["ai_requests"],
                             estimated=state["ai_estimated_cost_vnd"],
                             status=state["ai_cost_status"])
            if state["document_jobs"]:
                _upsert_cost(cursor, (day.isoformat(), kind, workspace_id, plan, variant, "document_worker", "document_jobs"),
                             release_id=release_id, quantity=state["document_jobs"],
                             estimated=0, status="not_configured")
    return written


def _refresh_funnel(cursor, start_epoch, end_epoch, hmac_key):
    grouped = defaultdict(lambda: [0, set()])
    workspace_grouped = defaultdict(
        lambda: {"event_count": 0, "first_occurred_at": None, "last_occurred_at": None}
    )

    def record(key, workspace_id, occurred_at):
        occurred_epoch = _epoch(occurred_at)
        grouped[key][0] += 1
        grouped[key][1].add(workspace_id)
        target = workspace_grouped[(*key, workspace_id)]
        target["event_count"] += 1
        target["first_occurred_at"] = (
            occurred_epoch
            if target["first_occurred_at"] is None
            else min(target["first_occurred_at"], occurred_epoch)
        )
        target["last_occurred_at"] = (
            occurred_epoch
            if target["last_occurred_at"] is None
            else max(target["last_occurred_at"], occurred_epoch)
        )

    rows = cursor.execute("""SELECT event_name,analytics_workspace_id,owner_kind,size_bucket,
        COALESCE(sku_code,'') AS sku_code,commercial_release_id,occurred_at
        FROM commercial_analytics_events WHERE occurred_at>=? AND occurred_at<?""", (start_epoch, end_epoch)).fetchall()
    for source in rows:
        item = dict(source)
        key = (_local_date(item["occurred_at"]).isoformat(), item["commercial_release_id"], item["event_name"],
               item["owner_kind"], item["size_bucket"], item["sku_code"])
        record(key, item["analytics_workspace_id"], item["occurred_at"])
    authoritative_sources = (
        ("quote.created", """SELECT quote.created_at AS occurred_at, quote.owner_kind,
            quote.account_user_id, quote.organization_id, quote.release_id AS commercial_release_id,
            COALESCE(sku.sku_code,'') AS sku_code
            FROM billing_quotes AS quote
            LEFT JOIN billing_orders AS orders ON orders.quote_id=quote.id
            LEFT JOIN billing_order_items AS item ON item.id=(SELECT first_item.id
                FROM billing_order_items AS first_item WHERE first_item.order_id=orders.id
                ORDER BY first_item.id LIMIT 1)
            LEFT JOIN billing_skus AS sku ON sku.id=item.sku_id
            WHERE quote.created_at>=to_timestamp(?) AND quote.created_at<to_timestamp(?)"""),
        ("checkout.created", """SELECT orders.created_at AS occurred_at, orders.owner_kind,
            orders.account_user_id, orders.organization_id, orders.release_id AS commercial_release_id,
            COALESCE(sku.sku_code,'') AS sku_code
            FROM billing_orders AS orders
            LEFT JOIN billing_order_items AS item ON item.id=(SELECT first_item.id
                FROM billing_order_items AS first_item WHERE first_item.order_id=orders.id
                ORDER BY first_item.id LIMIT 1)
            LEFT JOIN billing_skus AS sku ON sku.id=item.sku_id
            WHERE orders.created_at>=to_timestamp(?) AND orders.created_at<to_timestamp(?)"""),
        ("payment.verified", """SELECT COALESCE(payment.provider_occurred_at,
                EXTRACT(EPOCH FROM payment.created_at)::BIGINT) AS occurred_at,
            orders.owner_kind,orders.account_user_id,orders.organization_id,
            orders.release_id AS commercial_release_id,COALESCE(sku.sku_code,'') AS sku_code
            FROM payment_transactions AS payment
            JOIN billing_orders AS orders ON orders.id=payment.order_id
            LEFT JOIN billing_order_items AS item ON item.id=(SELECT first_item.id
                FROM billing_order_items AS first_item WHERE first_item.order_id=orders.id
                ORDER BY first_item.id LIMIT 1)
            LEFT JOIN billing_skus AS sku ON sku.id=item.sku_id
            WHERE payment.transaction_type='payment' AND payment.status IN ('verified','settled')
              AND COALESCE(payment.provider_occurred_at,EXTRACT(EPOCH FROM payment.created_at)::BIGINT)>=?
              AND COALESCE(payment.provider_occurred_at,EXTRACT(EPOCH FROM payment.created_at)::BIGINT)<?"""),
        ("payment.failed", """SELECT COALESCE(payment.provider_occurred_at,
                EXTRACT(EPOCH FROM payment.created_at)::BIGINT) AS occurred_at,
            orders.owner_kind,orders.account_user_id,orders.organization_id,
            orders.release_id AS commercial_release_id,COALESCE(sku.sku_code,'') AS sku_code
            FROM payment_transactions AS payment
            JOIN billing_orders AS orders ON orders.id=payment.order_id
            LEFT JOIN billing_order_items AS item ON item.id=(SELECT first_item.id
                FROM billing_order_items AS first_item WHERE first_item.order_id=orders.id
                ORDER BY first_item.id LIMIT 1)
            LEFT JOIN billing_skus AS sku ON sku.id=item.sku_id
            WHERE payment.transaction_type='payment' AND payment.status='failed'
              AND COALESCE(payment.provider_occurred_at,EXTRACT(EPOCH FROM payment.created_at)::BIGINT)>=?
              AND COALESCE(payment.provider_occurred_at,EXTRACT(EPOCH FROM payment.created_at)::BIGINT)<?"""),
        ("subscription.activated", """SELECT activation.updated_at AS occurred_at,
            orders.owner_kind,orders.account_user_id,orders.organization_id,
            orders.release_id AS commercial_release_id,COALESCE(sku.sku_code,'') AS sku_code
            FROM billing_subscription_activations AS activation
            JOIN billing_orders AS orders ON orders.id=activation.order_id
            LEFT JOIN billing_order_items AS item ON item.id=(SELECT first_item.id
                FROM billing_order_items AS first_item WHERE first_item.order_id=orders.id
                ORDER BY first_item.id LIMIT 1)
            LEFT JOIN billing_skus AS sku ON sku.id=item.sku_id
            WHERE activation.state='applied' AND activation.updated_at>=to_timestamp(?)
              AND activation.updated_at<to_timestamp(?)"""),
        ("subscription.activation_failed", """SELECT activation.updated_at AS occurred_at,
            orders.owner_kind,orders.account_user_id,orders.organization_id,
            orders.release_id AS commercial_release_id,COALESCE(sku.sku_code,'') AS sku_code
            FROM billing_subscription_activations AS activation
            JOIN billing_orders AS orders ON orders.id=activation.order_id
            LEFT JOIN billing_order_items AS item ON item.id=(SELECT first_item.id
                FROM billing_order_items AS first_item WHERE first_item.order_id=orders.id
                ORDER BY first_item.id LIMIT 1)
            LEFT JOIN billing_skus AS sku ON sku.id=item.sku_id
            WHERE activation.state IN ('retry','review_required','reversed')
              AND activation.updated_at>=to_timestamp(?) AND activation.updated_at<to_timestamp(?)"""),
        ("refund.succeeded", """SELECT refund.updated_at AS occurred_at,
            orders.owner_kind,orders.account_user_id,orders.organization_id,
            orders.release_id AS commercial_release_id,COALESCE(sku.sku_code,'') AS sku_code
            FROM billing_refund_intents AS refund
            JOIN billing_orders AS orders ON orders.id=refund.order_id
            LEFT JOIN billing_order_items AS item ON item.id=(SELECT first_item.id
                FROM billing_order_items AS first_item WHERE first_item.order_id=orders.id
                ORDER BY first_item.id LIMIT 1)
            LEFT JOIN billing_skus AS sku ON sku.id=item.sku_id
            WHERE refund.state='succeeded' AND refund.updated_at>=to_timestamp(?)
              AND refund.updated_at<to_timestamp(?)"""),
    )
    for event_name, statement in authoritative_sources:
        for source in cursor.execute(statement, (start_epoch, end_epoch)).fetchall():
            item = dict(source)
            kind, raw_id = _owner(item)
            if not raw_id:
                continue
            workspace_id = _workspace_hash(kind, raw_id, hmac_key)
            key = (_local_date(item["occurred_at"]).isoformat(), item["commercial_release_id"],
                   event_name, kind, "unknown", item["sku_code"])
            record(key, workspace_id, item["occurred_at"])
    for source in cursor.execute(
        """SELECT first_paid_value_at AS occurred_at,analytics_workspace_id,owner_kind,
                  size_bucket,commercial_release_id
             FROM workspace_activation_facts
            WHERE first_paid_value_at>=? AND first_paid_value_at<?""",
        (start_epoch, end_epoch),
    ).fetchall():
        item = dict(source)
        if not item.get("commercial_release_id"):
            continue
        key = (
            _local_date(item["occurred_at"]).isoformat(), item["commercial_release_id"],
            "first_paid_value", item["owner_kind"], item["size_bucket"], "",
        )
        record(key, item["analytics_workspace_id"], item["occurred_at"])
    for key, (count, workspaces) in grouped.items():
        cursor.execute("""INSERT INTO commercial_funnel_daily
            (usage_date,commercial_release_id,event_name,owner_kind,size_bucket,sku_code,event_count,unique_workspaces)
            VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (usage_date,commercial_release_id,event_name,owner_kind,size_bucket,sku_code)
            DO UPDATE SET event_count=excluded.event_count,unique_workspaces=excluded.unique_workspaces,
                          updated_at=CURRENT_TIMESTAMP""", (*key, count, len(workspaces)))
    for key, facts in workspace_grouped.items():
        cursor.execute(
            """INSERT INTO commercial_funnel_workspace_daily
               (usage_date,commercial_release_id,event_name,owner_kind,size_bucket,
                sku_code,analytics_workspace_id,event_count,first_occurred_at,last_occurred_at)
               VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT
               (usage_date,commercial_release_id,event_name,owner_kind,size_bucket,
                sku_code,analytics_workspace_id) DO UPDATE SET
                event_count=excluded.event_count,
                first_occurred_at=excluded.first_occurred_at,
                last_occurred_at=excluded.last_occurred_at""",
            (
                *key, facts["event_count"], facts["first_occurred_at"],
                facts["last_occurred_at"],
            ),
        )
    return len(grouped)


def _refresh_revenue(cursor, start_epoch, end_epoch):
    grouped = defaultdict(lambda: {"gross": 0, "net": 0, "refund": 0, "fee": 0, "orders": set()})
    rows = cursor.execute("""SELECT transaction.*,orders.release_id,orders.owner_kind,
        COALESCE(plan.logical_package_code,'') AS plan_code,COALESCE(plan.variant,'') AS variant,
        COALESCE(sku.sku_code,'') AS sku_code
        FROM payment_transactions AS transaction JOIN billing_orders AS orders ON orders.id=transaction.order_id
        LEFT JOIN billing_order_items AS item ON item.id=(SELECT first_item.id FROM billing_order_items AS first_item
            WHERE first_item.order_id=orders.id ORDER BY first_item.id LIMIT 1)
        LEFT JOIN billing_skus AS sku ON sku.id=item.sku_id
        LEFT JOIN billing_plan_versions AS plan ON plan.id=item.plan_version_id
        WHERE transaction.status IN ('verified','settled')
          AND COALESCE(transaction.provider_occurred_at,EXTRACT(EPOCH FROM transaction.created_at)::BIGINT)>=?
          AND COALESCE(transaction.provider_occurred_at,EXTRACT(EPOCH FROM transaction.created_at)::BIGINT)<?""",
                          (start_epoch, end_epoch)).fetchall()
    for source in rows:
        item = dict(source)
        day = _local_date(item.get("provider_occurred_at") or item["created_at"])
        key = (day.isoformat(), item["release_id"], item["owner_kind"], item["plan_code"], item["variant"], item["sku_code"])
        target, amount = grouped[key], max(0, int(item.get("verified_paid_amount") or 0))
        if item["transaction_type"] == "refund":
            target["refund"] += amount
        else:
            target["gross"] += amount
            target["net"] += max(0, int(item.get("net_settled_amount") or amount))
            target["fee"] += max(0, int(item.get("fee_amount") or 0))
            target["orders"].add(item["order_id"])
    for key, values in grouped.items():
        cursor.execute("""INSERT INTO revenue_daily
            (usage_date,commercial_release_id,owner_kind,plan_code,variant,sku_code,gross_revenue_vnd,
             net_settled_revenue_vnd,refund_amount_vnd,payment_fee_vnd,paid_orders)
            VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT
            (usage_date,commercial_release_id,owner_kind,plan_code,variant,sku_code) DO UPDATE SET
             gross_revenue_vnd=excluded.gross_revenue_vnd,net_settled_revenue_vnd=excluded.net_settled_revenue_vnd,
             refund_amount_vnd=excluded.refund_amount_vnd,payment_fee_vnd=excluded.payment_fee_vnd,
             paid_orders=excluded.paid_orders,updated_at=CURRENT_TIMESTAMP""",
                       (*key, values["gross"], max(0, values["net"] - values["refund"]), values["refund"], values["fee"], len(values["orders"])))
        if values["fee"]:
            _upsert_cost(cursor, (key[0], key[2], "", key[3], key[4], "payment_fee", "payment_transactions"),
                         release_id=key[1], quantity=len(values["orders"]), estimated=values["fee"])
    return len(grouped)


def _refresh_credit_pack_purchases(cursor, start_epoch, end_epoch, hmac_key):
    grouped = defaultdict(lambda: {"count": 0, "credits": 0, "revenue": 0, "unused": 0})
    rows = cursor.execute(
        """SELECT credit_grant.*, sku.sku_code, price.total_amount
             FROM usage_credit_grants AS credit_grant
             JOIN billing_order_items AS item ON item.id=credit_grant.order_item_id
             JOIN billing_skus AS sku ON sku.id=item.sku_id
             JOIN billing_prices AS price ON price.id=item.price_id
            WHERE credit_grant.source='purchase'
              AND sku.item_type='procurement_credit_pack'
              AND credit_grant.issued_at>=? AND credit_grant.issued_at<?""",
        (start_epoch, end_epoch),
    ).fetchall()
    for source in rows:
        item = dict(source)
        kind, raw_id = _owner(item)
        if not raw_id:
            continue
        workspace_id = _workspace_hash(kind, raw_id, hmac_key)
        pack_size = max(0, int(item.get("total") or 0))
        if pack_size <= 0:
            continue
        key = (
            _local_date(item["issued_at"]).isoformat(), workspace_id, kind,
            str(item.get("release_id") or ""), str(item.get("sku_code") or ""), pack_size,
        )
        target = grouped[key]
        target["count"] += 1
        target["credits"] += pack_size
        target["revenue"] += max(0, int(item.get("total_amount") or 0))
        target["unused"] += max(0, int(item.get("remaining") or 0))
    for key, values in grouped.items():
        cursor.execute(
            """INSERT INTO credit_pack_purchase_daily
               (purchase_date,analytics_workspace_id,owner_kind,commercial_release_id,
                sku_code,pack_size,purchase_count,credits_purchased,gross_revenue_vnd,unused_credits)
               VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT
               (purchase_date,analytics_workspace_id,commercial_release_id,sku_code,pack_size)
               DO UPDATE SET owner_kind=excluded.owner_kind,
                 purchase_count=excluded.purchase_count,credits_purchased=excluded.credits_purchased,
                 gross_revenue_vnd=excluded.gross_revenue_vnd,unused_credits=excluded.unused_credits,
                 updated_at=CURRENT_TIMESTAMP""",
            (*key, values["count"], values["credits"], values["revenue"], values["unused"]),
        )
    return len(grouped)


def _refresh_activation_facts(cursor, hmac_key):
    """Rebuild privacy-safe milestone facts from authoritative timestamps."""

    subscriptions = _subscriptions(cursor)
    candidates = defaultdict(list)
    first_features = {}

    for source in cursor.execute(
        """SELECT first_seen_at,user_id,organization_id,owner_type,metric_key,feature_key
             FROM product_usage_hourly
            WHERE metric_key!='presence.heartbeat'"""
    ).fetchall():
        item = dict(source)
        kind = _owner_kind(item.get("owner_type"))
        raw_id = item.get("user_id") if kind == "account" else item.get("organization_id")
        if not raw_id:
            continue
        key = (kind, str(raw_id))
        when = _epoch(item.get("first_seen_at"))
        if when:
            candidates[key].append((when, str(item.get("feature_key") or "")))
            if item.get("metric_key") == "feature.used":
                current = first_features.get(key)
                if current is None or when < current[0]:
                    first_features[key] = (when, str(item.get("feature_key") or ""))
    for source in cursor.execute(
        """SELECT occurred_at,organization_id,owner_type,actor_user_id
             FROM nhat_ky_thuc_hien WHERE actor_user_id IS NOT NULL"""
    ).fetchall():
        item = dict(source)
        kind = _owner_kind(item.get("owner_type"))
        raw_id = item.get("actor_user_id") if kind == "account" else item.get("organization_id")
        when = _epoch(item.get("occurred_at"))
        if raw_id and when:
            candidates[(kind, str(raw_id))].append((when, ""))

    procurement_or_export = {}
    for source in cursor.execute(
        """SELECT credit_grant.owner_kind,credit_grant.account_user_id,
                  credit_grant.organization_id,ledger.created_at
             FROM usage_ledger ledger
             JOIN usage_credit_grants credit_grant ON credit_grant.id=ledger.grant_id
            WHERE ledger.entry_type='consume'"""
    ).fetchall():
        item = dict(source)
        kind, raw_id = _owner(item)
        if raw_id:
            key, when = (kind, raw_id), _epoch(item.get("created_at"))
            if when and (key not in procurement_or_export or when < procurement_or_export[key]):
                procurement_or_export[key] = when
    for source in cursor.execute(
        """SELECT organization_id,user_id,completed_at FROM document_jobs
            WHERE status='completed' AND completed_at IS NOT NULL"""
    ).fetchall():
        item = dict(source)
        kind = "account" if str(item.get("organization_id") or "").startswith("personal:") else "organization"
        raw_id = str(item.get("user_id")) if kind == "account" else str(item.get("organization_id"))
        key, when = (kind, raw_id), _epoch(item.get("completed_at"))
        if raw_id and when and (key not in procurement_or_export or when < procurement_or_export[key]):
            procurement_or_export[key] = when

    owners = []
    for source in cursor.execute(
        """SELECT id,created_at,da_xac_minh,registration_verified_at
             FROM tai_khoan"""
    ).fetchall():
        item = dict(source)
        owners.append(("account", str(item["id"]), _epoch(item["created_at"]), item))
    for source in cursor.execute("SELECT id,created_at FROM to_chuc").fetchall():
        item = dict(source)
        owners.append(("organization", str(item["id"]), _epoch(item["created_at"]), item))

    cursor.execute("DELETE FROM workspace_activation_facts")
    written = 0
    for kind, raw_id, signup_at, owner_row in owners:
        if not signup_at:
            continue
        workspace_id = _workspace_hash(kind, raw_id, hmac_key)
        first_login = None
        if kind == "account":
            row = cursor.execute("SELECT MIN(created_at) FROM auth_sessions WHERE user_id=?", (raw_id,)).fetchone()
            first_login = _epoch(row[0]) if row and row[0] is not None else None
        else:
            row = cursor.execute(
                """SELECT MIN(session.created_at)
                     FROM thanh_vien_to_chuc member
                     JOIN auth_sessions session ON session.user_id=member.user_id
                    WHERE member.organization_id=? AND session.created_at>=?""",
                (raw_id, signup_at),
            ).fetchone()
            first_login = _epoch(row[0]) if row and row[0] is not None else None
        if first_login is not None and first_login < signup_at:
            first_login = None
        verification_at = _epoch(owner_row.get("registration_verified_at")) if kind == "account" else None
        if verification_at is not None and verification_at < signup_at:
            verification_at = None
        if kind == "organization":
            verification_observation = "historical_timestamp_unavailable"
        elif verification_at:
            verification_observation = "observed"
        elif owner_row.get("da_xac_minh"):
            verification_observation = "historical_timestamp_unavailable"
        else:
            verification_observation = "not_verified"
        milestone_candidates = sorted(candidates.get((kind, raw_id), []))
        milestone_candidates = [candidate for candidate in milestone_candidates if candidate[0] >= signup_at]
        first_value_at = milestone_candidates[0][0] if milestone_candidates else None
        first_feature = first_features.get((kind, raw_id), (None, ""))[1]
        owner_subscriptions = [
            row for row in subscriptions
            if row["owner_kind"] == kind and str(row["owner_id"]) == raw_id
        ]
        first_subscription = min(owner_subscriptions, key=lambda row: int(row["starts_at"]), default=None)
        activated_at = int(first_subscription["starts_at"]) if first_subscription else None
        if activated_at is not None and activated_at < signup_at:
            activated_at = None
        first_paid_value = next((when for when, _ in milestone_candidates if activated_at and when >= activated_at), None)
        cursor.execute(
            """INSERT INTO workspace_activation_facts
               (analytics_workspace_id,owner_kind,signup_at,verification_at,verification_observation,
                first_login_at,first_value_at,first_feature_key,first_plan_at,
                first_procurement_or_export_at,subscription_activated_at,first_paid_value_at,
                commercial_release_id,plan_code,variant,size_bucket)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (workspace_id, kind, signup_at, verification_at, verification_observation,
             first_login, first_value_at, first_feature,
             activated_at, procurement_or_export.get((kind, raw_id)), activated_at,
             first_paid_value, first_subscription.get("release_id") if first_subscription else None,
             first_subscription.get("plan_code") if first_subscription else "",
             first_subscription.get("variant") if first_subscription else "",
             _bucket(1) if kind == "account" else "unknown"),
        )
        written += 1
    return written


def _refresh_retention(cursor, *, hmac_key, observation_end):
    """Rebuild mature signup, first-value and paid-activation cohorts."""

    metadata = {}
    usage_rows = cursor.execute(
        """SELECT usage_date,analytics_workspace_id,owner_kind,commercial_release_id,
                  variant,size_bucket,procurement_actions,meaningful_actions,
                  active_seats,ai_requests
             FROM workspace_usage_daily
            ORDER BY usage_date,analytics_workspace_id"""
    ).fetchall()
    activity_weeks = defaultdict(set)
    collaboration_days = defaultdict(int)
    procurement_total = defaultdict(int)
    ai_total = defaultdict(int)
    first_value = {}
    for source in usage_rows:
        item = dict(source)
        workspace_id = str(item["analytics_workspace_id"])
        metadata.setdefault(workspace_id, item)
        procurement_total[workspace_id] += max(0, int(item.get("procurement_actions") or 0))
        ai_total[workspace_id] += max(0, int(item.get("ai_requests") or 0))
        if int(item.get("active_seats") or 0) >= 2:
            collaboration_days[workspace_id] += 1
        if int(item.get("meaningful_actions") or 0) > 0:
            day = _local_date(item["usage_date"])
            activity_weeks[workspace_id].add(_week_start(day))
            first_value.setdefault(workspace_id, day)

    def segment_for(workspace_id):
        item = metadata.get(workspace_id, {})
        procurement = procurement_total.get(workspace_id, 0)
        intensity = "none" if procurement == 0 else "low" if procurement < 5 else "high"
        collaboration = "none" if collaboration_days.get(workspace_id, 0) == 0 else "active"
        ai = "adopted" if ai_total.get(workspace_id, 0) > 0 else "not_adopted"
        return (
            f"variant={item.get('variant') or 'unknown'}|"
            f"size={item.get('size_bucket') or 'unknown'}|"
            f"procurement={intensity}|collaboration={collaboration}|ai={ai}"
        )

    memberships = []
    for source in cursor.execute("SELECT id,created_at FROM tai_khoan").fetchall():
        item = dict(source)
        workspace_id = _workspace_hash("account", str(item["id"]), hmac_key)
        memberships.append((workspace_id, "account", "signup", _local_date(item["created_at"])))
    for source in cursor.execute("SELECT id,created_at FROM to_chuc").fetchall():
        item = dict(source)
        workspace_id = _workspace_hash("organization", str(item["id"]), hmac_key)
        memberships.append((workspace_id, "organization", "signup", _local_date(item["created_at"])))
    for workspace_id, first_day in first_value.items():
        item = metadata.get(workspace_id, {})
        memberships.append((workspace_id, item.get("owner_kind") or "organization", "first_value", first_day))
    for source in _subscriptions(cursor):
        if source.get("status") != "active":
            continue
        workspace_id = _workspace_hash(source["owner_kind"], str(source["owner_id"]), hmac_key)
        memberships.append((workspace_id, source["owner_kind"], "paid_activation", _local_date(int(source["starts_at"]))))
        metadata.setdefault(workspace_id, {
            "variant": source.get("variant") or "",
            "size_bucket": "unknown",
            "commercial_release_id": source.get("release_id") or "",
        })

    cursor.execute("DELETE FROM retention_cohort_weekly")
    cohorts = defaultdict(set)
    for workspace_id, owner_kind, cohort_kind, cohort_day in memberships:
        week = _week_start(cohort_day)
        item = metadata.get(workspace_id, {})
        key = (
            week, cohort_kind, segment_for(workspace_id),
            str(item.get("commercial_release_id") or ""), owner_kind,
        )
        cohorts[key].add(workspace_id)
    latest_mature_week = _week_start(_local_date(observation_end)) - timedelta(days=7)
    for (week, cohort_kind, segment, release_id, owner_kind), members in cohorts.items():
        for number in (0, 1, 2, 4, 8, 12):
            observation_week = week + timedelta(days=number * 7)
            if observation_week > latest_mature_week:
                continue
            retained = sum(observation_week in activity_weeks.get(workspace_id, set()) for workspace_id in members)
            cursor.execute("""INSERT INTO retention_cohort_weekly
                (cohort_week,cohort_kind,segment_key,commercial_release_id,owner_kind,workspace_count,week_number,retained_workspaces)
                VALUES (?,?,?,?,?,?,?,?) ON CONFLICT
                (cohort_week,cohort_kind,segment_key,commercial_release_id,owner_kind,week_number) DO UPDATE SET
                workspace_count=excluded.workspace_count,retained_workspaces=excluded.retained_workspaces,
                updated_at=CURRENT_TIMESTAMP""",
                (week.isoformat(), cohort_kind, segment, release_id, owner_kind,
                 len(members), number, retained),
            )


def _refresh_plan_fit(cursor, start, end):
    written, month = 0, _month_start(start)
    while month <= end:
        next_month = (month.replace(day=28) + timedelta(days=4)).replace(day=1)
        rows = cursor.execute("""SELECT analytics_workspace_id,owner_kind,
            MAX(commercial_release_id) AS commercial_release_id,MAX(plan_code) AS plan_code,
            MAX(variant) AS variant,MAX(size_bucket) AS size_bucket,MAX(active_seats) AS active_seats,
            MAX(registered_seats) AS registered_seats,SUM(included_credits_consumed) AS consumed,
            SUM(included_credits_granted) AS granted,SUM(topup_spend_vnd) AS topup_spend,
            SUM(successful_fetches) AS procurement_usage,
            COUNT(*) FILTER (WHERE purchased_credits>0) AS repeat_topups,
            COUNT(*) FILTER (WHERE procurement_actions>0) AS connected_feature_days,
            SUM(workflow_volume) AS workflow_volume,MAX(workflow_depth) AS workflow_depth,
            SUM(word_exports) AS export_intensity,SUM(ai_requests) AS ai_intensity
            FROM workspace_usage_daily WHERE usage_date>=? AND usage_date<?
            GROUP BY analytics_workspace_id,owner_kind""", (month.isoformat(), next_month.isoformat())).fetchall()
        for source in rows:
            item = dict(source)
            cost_row = cursor.execute(
                """SELECT COUNT(*) AS available_rows,
                          COALESCE(SUM(estimated_cost_vnd),0) AS estimated_cost
                     FROM cost_usage_daily
                    WHERE usage_date>=? AND usage_date<?
                      AND analytics_workspace_id=? AND cost_status='available'""",
                (month.isoformat(), next_month.isoformat(), item["analytics_workspace_id"]),
            ).fetchone()
            cost_item = dict(cost_row) if cost_row else {}
            estimated_cost = max(0, int(cost_item.get("estimated_cost") or 0))
            cost_status = (
                "available" if int(cost_item.get("available_rows") or 0) > 0
                else "not_configured"
            )
            active, registered = max(0, int(item.get("active_seats") or 0)), max(0, int(item.get("registered_seats") or 0))
            consumed, granted = max(0, int(item.get("consumed") or 0)), max(0, int(item.get("granted") or 0))
            signals = {"active_seats": active, "seat_utilization": active / registered if registered else 0,
                       "quota_utilization": consumed / granted if granted else 0,
                       "topup_spend": int(item.get("topup_spend") or 0),
                       "repeat_topups": int(item.get("repeat_topups") or 0),
                       "workflow_volume": int(item.get("workflow_volume") or 0),
                       "variant": item.get("variant"), "pressure_months": 1}
            previous = cursor.execute(
                """SELECT seat_utilization,quota_utilization,workflow_volume
                     FROM plan_fit_monthly
                    WHERE analytics_workspace_id=? AND snapshot_month<?
                    ORDER BY snapshot_month DESC LIMIT 1""",
                (item["analytics_workspace_id"], month.isoformat()),
            ).fetchone()
            if previous:
                previous = dict(previous)
                current_pressure = signals["seat_utilization"] >= 0.8 or signals["quota_utilization"] >= 0.8
                previous_pressure = float(previous.get("seat_utilization") or 0) >= 0.8 or float(previous.get("quota_utilization") or 0) >= 0.8
                current_oversized = signals["seat_utilization"] < 0.3 and signals["quota_utilization"] < 0.2 and signals["workflow_volume"] == 0
                previous_oversized = float(previous.get("seat_utilization") or 0) < 0.3 and float(previous.get("quota_utilization") or 0) < 0.2 and int(previous.get("workflow_volume") or 0) == 0
                if (current_pressure and previous_pressure) or (current_oversized and previous_oversized):
                    signals["pressure_months"] = 2
            result = classify_plan_fit(signals)
            cursor.execute("""INSERT INTO plan_fit_monthly
                (snapshot_month,analytics_workspace_id,commercial_release_id,owner_kind,plan_code,variant,
                 size_bucket,active_seats,seat_utilization,quota_utilization,topup_spend_vnd,
                 procurement_usage,repeat_topups,connected_feature_days,workflow_volume,workflow_depth,
                 export_intensity,ai_intensity,estimated_cost_vnd,cost_status,revenue_vnd,revenue_status,
                 price_gap_to_connected_vnd,days_to_break_even,classification,rule_version)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,'not_available',NULL,NULL,?,?)
                ON CONFLICT (snapshot_month,analytics_workspace_id)
                DO UPDATE SET commercial_release_id=excluded.commercial_release_id,owner_kind=excluded.owner_kind,
                 plan_code=excluded.plan_code,variant=excluded.variant,size_bucket=excluded.size_bucket,
                 active_seats=excluded.active_seats,seat_utilization=excluded.seat_utilization,
                 quota_utilization=excluded.quota_utilization,topup_spend_vnd=excluded.topup_spend_vnd,
                 procurement_usage=excluded.procurement_usage,repeat_topups=excluded.repeat_topups,
                 connected_feature_days=excluded.connected_feature_days,workflow_volume=excluded.workflow_volume,
                 workflow_depth=excluded.workflow_depth,export_intensity=excluded.export_intensity,
                 ai_intensity=excluded.ai_intensity,estimated_cost_vnd=excluded.estimated_cost_vnd,
                 cost_status=excluded.cost_status,
                 revenue_status=excluded.revenue_status,price_gap_to_connected_vnd=excluded.price_gap_to_connected_vnd,
                 days_to_break_even=excluded.days_to_break_even,
                 classification=excluded.classification,rule_version=excluded.rule_version,updated_at=CURRENT_TIMESTAMP""",
                           (month.isoformat(), item["analytics_workspace_id"], item.get("commercial_release_id") or None,
                            item["owner_kind"], item.get("plan_code") or "", item.get("variant") or "",
                            item.get("size_bucket") or "unknown", active, signals["seat_utilization"],
                            signals["quota_utilization"], signals["topup_spend"],
                            int(item.get("procurement_usage") or 0), int(item.get("repeat_topups") or 0),
                            int(item.get("connected_feature_days") or 0), signals["workflow_volume"],
                            int(item.get("workflow_depth") or 0), int(item.get("export_intensity") or 0),
                            int(item.get("ai_intensity") or 0), estimated_cost, cost_status,
                            result["classification"], result["ruleVersion"]))
            written += 1
        month = next_month
    return written
