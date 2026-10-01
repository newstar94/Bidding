"""Current organization authority for short billing transactions."""

from backend.commercial_policy.errors import CommercialPolicyError
from backend.shared.access_principals import organization_membership_role


def authorize_organization_buyer(cursor, actor, organization_id, *, lock_owner=True):
    """Serialize checkout/quote authority with membership revocation.

    Role selection remains a restriction, not evidence of current membership.
    Checkout retains its existing organization lock. Quotes lock only the
    membership row: acquiring an organization lock after session/account locks
    would deadlock with membership administration's organization/account order.
    Keep the existing platform-admin billing authority unchanged.
    """

    active_role = str(getattr(actor, "active_role", "") or actor)
    platform_admin = str(actor.platform_role) == "super_admin"
    if (
        str(organization_id) != str(actor.active_role_organization_id or "")
        or (not platform_admin and active_role not in {"manager", "super_admin"})
    ):
        raise CommercialPolicyError(
            "BUYER_NOT_AUTHORIZED", "Không có thẩm quyền mua cho tổ chức.",
            status_code=403,
        )
    statement = "SELECT id, trang_thai FROM to_chuc WHERE id = ?"
    if lock_owner:
        statement += " FOR UPDATE"
    owner = cursor.execute(
        statement,
        (organization_id,),
    ).fetchone()
    if not owner or str(owner[1]) != "active":
        raise CommercialPolicyError(
            "OWNER_INACTIVE", "Owner không còn hoạt động.", status_code=409,
        )
    if not platform_admin:
        cursor.execute(
            """SELECT user_id FROM thanh_vien_to_chuc
                WHERE user_id = ? AND organization_id = ? FOR SHARE""",
            (actor.user_id, organization_id),
        ).fetchone()
        if organization_membership_role(cursor, actor.user_id, organization_id) != "manager":
            raise CommercialPolicyError(
                "BUYER_NOT_AUTHORIZED", "Không có thẩm quyền mua cho tổ chức.",
                status_code=403,
            )
