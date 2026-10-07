"""Pre-payment checks for the approved end-of-term renewal operation."""

from backend.commercial_policy.errors import CommercialPolicyError


def validate_renewal_checkout(cursor, quote, projection):
    if quote["operation"] != "renew":
        return
    owner_column = "user_id" if quote["owner_kind"] == "account" else "organization_id"
    table = "account_subscriptions" if quote["owner_kind"] == "account" else "organization_subscriptions"
    owner_id = quote["account_user_id"] if quote["owner_kind"] == "account" else quote["organization_id"]
    current = cursor.execute(
        f"SELECT status, expires_at, revision, plan_version_id FROM {table} WHERE {owner_column} = ? FOR UPDATE",  # noqa: S608 - fixed owner table/column
        (owner_id,),
    ).fetchone()
    if not current or current["status"] not in {"active", "expired"} or not current["expires_at"]:
        raise CommercialPolicyError("RENEWAL_BASE_SUBSCRIPTION_REQUIRED", "Không có kỳ gói phù hợp để gia hạn.", status_code=409)
    expected = quote.get("expected_subscription_revision")
    if expected is not None and int(current["revision"]) != int(expected):
        raise CommercialPolicyError("SUBSCRIPTION_REVISION_MISMATCH", "Gói đang dùng đã thay đổi; vui lòng lấy báo giá mới.", status_code=409)
    same_plan = cursor.execute(
        """SELECT 1 FROM billing_plan_versions AS current_plan
             JOIN billing_plan_versions AS next_plan
               ON current_plan.logical_package_code = next_plan.logical_package_code
              AND current_plan.owner_kind = next_plan.owner_kind
              AND current_plan.tier = next_plan.tier AND current_plan.variant = next_plan.variant
            WHERE current_plan.id = ? AND next_plan.id = ?""",
        (current["plan_version_id"], projection.get("plan_version_id")),
    ).fetchone()
    if not same_plan:
        raise CommercialPolicyError("RENEWAL_PLAN_TRANSITION_REVIEW_REQUIRED", "Gia hạn cần chọn đúng gói đang dùng. Chuyển sang gói khác cần chính sách chuyển gói.", status_code=409)
