"""Subscription-derived feature entitlements for personal and organization scopes."""

import time

from backend.auth.auth_helper import get_effective_roles
from backend.shared.workspace_scope import is_personal_scope_for_user
from backend.shared.date_utils import vietnam_date_from_epoch


_QUERY_CHUNK_SIZE = 500


def _normalized_subscription(row, *, include_quota=False):
    if not row:
        return None
    starts_at = int(row["starts_at"]) if row["starts_at"] is not None else None
    expires_at = int(row["expires_at"]) if row["expires_at"] is not None else None
    status = str(row["status"] or "missing").strip().lower()
    if expires_at is not None and expires_at <= int(time.time()):
        status = "expired"
    package_status = str(row["package_status"] or "").strip().lower()
    effective_status = status
    if status == "active" and package_status != "active":
        effective_status = "package_inactive"
    payload = {
        "package_id": row["package_id"],
        "status": effective_status,
        "starts_at": starts_at,
        "expires_at": expires_at,
        "start_date": vietnam_date_from_epoch(starts_at),
        "end_date": vietnam_date_from_epoch(expires_at),
        "revision": int(row["revision"] or 0),
    }
    if include_quota:
        payload["member_quota"] = int(row["member_quota"] or 0)
    return payload


def get_account_subscription(cursor, user_id):
    row = cursor.execute(
        """SELECT subscription.package_id, subscription.status,
                  subscription.starts_at, subscription.expires_at,
                  subscription.revision, package.trang_thai AS package_status
           FROM account_subscriptions AS subscription
           JOIN goi_dich_vu AS package ON package.id = subscription.package_id
           WHERE subscription.user_id = ?
           LIMIT 1""",
        (user_id,),
    ).fetchone()
    return _normalized_subscription(row)


def get_account_subscriptions_by_user_ids(cursor, user_ids):
    """Return normalized account subscriptions keyed by user ID in bounded batches."""

    unique_user_ids = list(dict.fromkeys(user_ids))
    subscriptions = {}
    for offset in range(0, len(unique_user_ids), _QUERY_CHUNK_SIZE):
        chunk = unique_user_ids[offset:offset + _QUERY_CHUNK_SIZE]
        placeholders = ", ".join("?" for _ in chunk)
        rows = cursor.execute(
            f"""SELECT subscription.user_id, subscription.package_id,
                       subscription.status, subscription.starts_at,
                       subscription.expires_at, subscription.revision,
                       package.trang_thai AS package_status
                FROM account_subscriptions AS subscription
                JOIN goi_dich_vu AS package ON package.id = subscription.package_id
                WHERE subscription.user_id IN ({placeholders})""",
            tuple(chunk),
        ).fetchall()
        for row in rows:
            subscriptions[row["user_id"]] = _normalized_subscription(row)
    return subscriptions


def get_organization_subscription(cursor, organization_id):
    row = cursor.execute(
        """SELECT subscription.package_id, subscription.status,
                  subscription.starts_at, subscription.expires_at,
                  subscription.member_quota, subscription.revision,
                  package.trang_thai AS package_status
           FROM organization_subscriptions AS subscription
           JOIN goi_dich_vu AS package ON package.id = subscription.package_id
           JOIN to_chuc AS organization ON organization.id = subscription.organization_id
           WHERE subscription.organization_id = ?
             AND organization.trang_thai = 'active'
           LIMIT 1""",
        (organization_id,),
    ).fetchone()
    return _normalized_subscription(row, include_quota=True)


def subscription_is_active(subscription):
    return bool(subscription and subscription.get("status") == "active")


def can_use_word_export(cursor, role_str, user_id, organization_id):
    """Resolve Word export from the package owned by the active data scope."""

    if "super_admin" in get_effective_roles(str(role_str or "")):
        return True
    if is_personal_scope_for_user(organization_id, user_id):
        return subscription_is_active(get_account_subscription(cursor, user_id))
    membership = cursor.execute(
        """SELECT 1 FROM thanh_vien_to_chuc
           WHERE user_id = ? AND organization_id = ?
             AND COALESCE(trang_thai_thanh_vien, 'active') = 'active'
           LIMIT 1""",
        (user_id, organization_id),
    ).fetchone()
    return bool(
        membership
        and subscription_is_active(
            get_organization_subscription(cursor, organization_id)
        )
    )
