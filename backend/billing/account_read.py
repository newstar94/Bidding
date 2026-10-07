"""Read-only projections for the signed-in account's billing information."""

from __future__ import annotations

import json
import math

from backend.commercial_policy.errors import CommercialPolicyError
from backend.shared.subscription_policy import get_account_subscription
from backend.usage_credits import UsageCreditService, UsageOwner


def _json_object(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            return {}
    return value if isinstance(value, dict) else {}


def history_pagination(request):
    """Preserve the old latest-100 response unless pagination is requested."""
    params = getattr(request, "query_params", {})
    if "page" not in params and "pageSize" not in params:
        return None
    try:
        page = int(params.get("page", "1"))
        page_size = int(params.get("pageSize", "10"))
    except (TypeError, ValueError, OverflowError):
        page = page_size = 0
    if not 1 <= page <= 1_000_000 or not 1 <= page_size <= 100:
        raise CommercialPolicyError(
            "BILLING_PAGINATION_INVALID",
            "Trang phải từ 1 và số giao dịch mỗi trang phải từ 1 đến 100.",
            status_code=400,
        )
    return page, page_size


def pagination_payload(page, page_size, total):
    return {
        "page": page,
        "pageSize": page_size,
        "total": total,
        "totalPages": math.ceil(total / page_size),
    }


def _term_details(snapshot):
    period = (_json_object(snapshot.get("price"))).get("period")
    if period not in {"monthly", "yearly"}:
        return period, None
    policy = _json_object(snapshot.get("policySnapshot"))
    term = _json_object(policy.get("monthlyBaseTerm" if period == "monthly" else "baseTerm"))
    days = term.get("days") if term.get("kind") == "fixed_days" else None
    return period, days if type(days) is int and days > 0 else None


def personal_order_item(row):
    """Describe the purchased immutable version, never the current catalog."""
    snapshot = _json_object(row.get("item_snapshot_json") or row.get("decision_json"))
    display = _json_object(row.get("item_display_json"))
    item_type = row.get("item_type") or snapshot.get("itemType")
    sku_code = row.get("item_sku_code") or snapshot.get("skuCode")
    if not item_type and not sku_code:
        return None
    period, days = _term_details(snapshot)
    benefits = _json_object(snapshot.get("benefits"))
    if item_type == "procurement_credit_pack":
        expiry = _json_object(benefits.get("expiryPolicy"))
        if not expiry:
            expiry = _json_object(_json_object(snapshot.get("policySnapshot")).get("creditPackExpiry"))
        expiry_days = expiry.get("days") if expiry.get("kind") == "fixed_days" else None
        days = expiry_days if type(expiry_days) is int and expiry_days > 0 else None
    credits = benefits.get("procurementCredits") if item_type == "procurement_credit_pack" else benefits.get("includedProcurementQuota")
    if credits is None and item_type == "procurement_credit_pack":
        credits = row.get("item_credit_quantity")
    name = display.get("name") or row.get("item_package_name")
    if not name and item_type == "procurement_credit_pack" and type(credits) is int:
        name = f"{credits:,} lượt Mua Sắm Công".replace(",", ".")
    return {
        "skuCode": sku_code,
        "itemType": item_type,
        "displayName": name or sku_code,
        "planCode": row.get("item_plan_code"),
        "variant": row.get("item_variant"),
        "billingCycle": period,
        "termDays": days,
        "credits": credits,
    }


def personal_account_summary(cursor, user_id):
    """Use account identity only; the selected organization is irrelevant."""
    normalized = get_account_subscription(cursor, user_id)
    subscription = None
    if normalized:
        row = cursor.execute(
            """SELECT subscription.plan_version_id, subscription.source,
                      package.ten_goi AS package_name,
                      plan.logical_package_code, plan.variant,
                      plan.display_json, orders.decision_json,
                      orders.public_id AS source_order_public_id,
                      orders.payment_state AS source_order_payment_state,
                      orders.activation_state AS source_order_activation_state
                 FROM account_subscriptions AS subscription
                 JOIN goi_dich_vu AS package ON package.id = subscription.package_id
                 LEFT JOIN billing_plan_versions AS plan ON plan.id = subscription.plan_version_id
                 LEFT JOIN billing_orders AS orders ON orders.id = subscription.source_order_id
                   AND orders.owner_kind = 'account' AND orders.account_user_id = subscription.user_id
                WHERE subscription.user_id = ? LIMIT 1""",
            (user_id,),
        ).fetchone()
        metadata = dict(row) if row else {}
        decision = _json_object(metadata.get("decision_json"))
        display = _json_object(metadata.get("display_json"))
        period, days = _term_details(decision)
        subscription = {
            "packageId": normalized["package_id"],
            "packageName": display.get("name") or metadata.get("package_name"),
            "status": normalized["status"],
            "startsAt": normalized["starts_at"],
            "expiresAt": normalized["expires_at"],
            "startDate": normalized["start_date"],
            "endDate": normalized["end_date"],
            "revision": normalized["revision"],
            "entitlements": normalized["entitlements"],
            "planVersionId": metadata.get("plan_version_id"),
            "source": metadata.get("source"),
            "skuCode": decision.get("skuCode"),
            "planCode": metadata.get("logical_package_code"),
            "variant": metadata.get("variant"),
            "billingCycle": period,
            "termDays": days,
            "sourceOrderPublicId": metadata.get("source_order_public_id"),
            "sourceOrderPaymentState": metadata.get("source_order_payment_state"),
            "sourceOrderActivationState": metadata.get("source_order_activation_state"),
        }
    return {
        "subscription": subscription,
        "usage": UsageCreditService(cursor).get_balance(UsageOwner("account", user_id)),
    }
