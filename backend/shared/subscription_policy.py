"""Subscription-derived feature entitlements for personal and organization scopes."""

import time

from backend.auth.auth_helper import get_effective_roles
from backend.shared.workspace_scope import is_personal_scope_for_user
from backend.shared.date_utils import vietnam_date_from_epoch


_QUERY_CHUNK_SIZE = 500

# Compatibility-only term used by legacy subscription administration while
# baseTerm/renewalAnchor remain BLOCKED_DECISION in commercial policy.  Keep
# this value out of callers so a future approved policy replaces one seam.
LEGACY_SUBSCRIPTION_TERM_DAYS = 365
SECONDS_PER_DAY = 24 * 60 * 60


def legacy_subscription_expiry(starts_at):
    return int(starts_at) + LEGACY_SUBSCRIPTION_TERM_DAYS * SECONDS_PER_DAY


def _row_value(row, key, default=None):
    if row is None:
        return default
    try:
        return row[key]
    except (KeyError, TypeError, IndexError):
        return default


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
        "entitlements": {
            "document.export.word": bool(
                int(_row_value(row, "document_export_word", 1) or 0)
            ),
            "document.export.excel": bool(
                int(_row_value(row, "document_export_excel", 1) or 0)
            ),
            "document.export.award_result_excel": bool(
                int(
                    _row_value(
                        row,
                        "document_export_award_result_excel",
                        1,
                    )
                    or 0
                )
            ),
        },
    }
    if include_quota:
        payload["member_quota"] = int(row["member_quota"] or 0)
    return payload


def get_account_subscription(cursor, user_id):
    row = cursor.execute(
        """SELECT subscription.package_id, subscription.status,
                  subscription.starts_at, subscription.expires_at,
                  subscription.revision, package.trang_thai AS package_status
                  , package.document_export_word
                  , package.document_export_excel
                  , package.document_export_award_result_excel
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
                       , package.document_export_word
                       , package.document_export_excel
                       , package.document_export_award_result_excel
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
                  , package.document_export_word
                  , package.document_export_excel
                  , package.document_export_award_result_excel
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


def subscription_has_capability(subscription, capability):
    return bool(
        subscription_is_active(subscription)
        and subscription.get("entitlements", {}).get(capability, False)
    )


def can_use_document_export(
    cursor,
    role_str,
    user_id,
    organization_id,
    *,
    format,
    feature=None,
):
    """Resolve a format-specific export capability for the active data scope.

    Existing subscriptions predate per-format grants and therefore retain both
    DOCX and XLSX access.  The explicit format/feature boundary prevents a new
    Excel route from depending on a Word-named policy.
    """

    normalized_format = str(format or "").strip().casefold()
    if normalized_format not in {"docx", "xlsx"}:
        return False
    if feature is not None and not str(feature).strip():
        return False
    capability = (
        "document.export.word"
        if normalized_format == "docx"
        else "document.export.award_result_excel"
        if str(feature or "").strip().casefold() == "award_result"
        else "document.export.excel"
    )

    if "super_admin" in get_effective_roles(str(role_str or "")):
        return True
    if is_personal_scope_for_user(organization_id, user_id):
        return subscription_has_capability(
            get_account_subscription(cursor, user_id), capability
        )
    membership = cursor.execute(
        """SELECT 1 FROM thanh_vien_to_chuc
           WHERE user_id = ? AND organization_id = ?
             AND COALESCE(trang_thai_thanh_vien, 'active') = 'active'
           LIMIT 1""",
        (user_id, organization_id),
    ).fetchone()
    return bool(
        membership
        and subscription_has_capability(
            get_organization_subscription(cursor, organization_id), capability
        )
    )


def can_use_word_export(cursor, role_str, user_id, organization_id):
    """Compatibility wrapper for existing Word callers."""

    return can_use_document_export(
        cursor,
        role_str,
        user_id,
        organization_id,
        format="docx",
    )


def can_use_award_result_excel_export(
    cursor, role_str, user_id, organization_id
):
    return can_use_document_export(
        cursor,
        role_str,
        user_id,
        organization_id,
        format="xlsx",
        feature="award_result",
    )
