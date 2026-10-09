"""Apply existing pinned transition decisions before and after payment."""
from .errors import CommercialPolicyError, TRANSITION_NOT_ALLOWED


def current_subscription(cursor, owner_kind, owner_id, *, lock=False):
    table, column = (("account_subscriptions", "user_id") if owner_kind == "account"
                     else ("organization_subscriptions", "organization_id"))
    row = cursor.execute(
        f"SELECT status, expires_at, revision FROM {table} WHERE {column} = ?"  # noqa: S608 - fixed identifiers
        + (" FOR UPDATE" if lock else ""), (owner_id,),
    ).fetchone()
    return dict(row) if row else None


def transition_review_reason(operation, item_type, policy, current, now):
    if item_type == "procurement_credit_pack":
        return None if operation == "credit_pack" else "PRODUCT_OPERATION_MISMATCH"
    if item_type != "base_plan" or operation not in {"purchase", "renew", "upgrade", "downgrade"}:
        return "PRODUCT_OPERATION_MISMATCH"
    active = bool(current and current["status"] == "active" and (
        not current.get("expires_at") or int(current["expires_at"]) > int(now)))
    if operation == "purchase":
        return "ACTIVE_TERM_REQUIRES_TRANSITION_REVIEW" if active else None
    if operation == "renew":
        return None  # Dedicated renewal validation preserves its approved anchor/plan contract.
    rule = policy.get(operation) or {}
    if rule.get("kind") != "start_new_term":
        return "PLAN_TRANSITION_REVIEW_REQUIRED"
    if operation == "downgrade" and rule.get("selfService") is not True:
        return "PLAN_TRANSITION_REVIEW_REQUIRED"
    if active and rule.get("activeTerm") != "start_new_term":
        return "ACTIVE_TERM_REQUIRES_TRANSITION_REVIEW"
    return None


def require_self_service_transition(operation, item_type, policy, current, now):
    reason = transition_review_reason(operation, item_type, policy, current, now)
    # Preserve the existing purchase flow: paid purchases against an active
    # term go to activation review. This repair closes operation spoofing for
    # upgrade/downgrade without redefining purchase admission.
    if operation == "purchase" and reason == "ACTIVE_TERM_REQUIRES_TRANSITION_REVIEW":
        return
    if reason:
        raise CommercialPolicyError(TRANSITION_NOT_ALLOWED,
                                    "Thay đổi gói này cần xét duyệt trước khi thanh toán.",
                                    status_code=409, details={"reason": reason})
