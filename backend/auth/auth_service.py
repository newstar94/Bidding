from backend.db.db_helper import DatabaseError
import os
import time
import secrets
import hashlib
from dataclasses import dataclass
from starlette.responses import JSONResponse
from backend.auth.roles import (
    effective_access_roles,
    normalize_organization_role,
    normalize_platform_role,
)
from backend.shared.workspace_scope import personal_workspace_payload
from backend.shared.subscription_policy import get_account_subscription
from backend.shared.date_utils import vietnam_date_from_epoch
from backend.shared.client_ip import get_client_ip as get_client_ip


_SECURE_COOKIES = os.environ.get("APP_SECURE_COOKIES", "False").lower() == "true"
SESSION_EXPIRY_HOURS = int(os.environ.get("SESSION_EXPIRY_HOURS", "12"))
SESSION_REMEMBER_EXPIRY_HOURS = int(os.environ.get("SESSION_REMEMBER_EXPIRY_HOURS", "720"))
SESSION_INACTIVITY_TIMEOUT_HOURS = int(os.environ.get("SESSION_INACTIVITY_TIMEOUT_HOURS", "10"))


RATE_LIMIT_MAX = max(1, int(os.environ.get("RATE_LIMIT_MAX_ATTEMPTS", "5")))
RATE_LIMIT_WINDOW = max(1, int(os.environ.get("RATE_LIMIT_WINDOW_SECONDS", "60")))


@dataclass(frozen=True)
class RateLimitDecision:
    allowed: bool
    retry_after: int
    remaining: int
    storage_failed: bool = False


def _get_rate_limit_database():
    from backend.shared.helpers import database as rate_limit_database
    return rate_limit_database


def get_rate_limit_decision(
    bucket: str,
    consume_attempt: bool = True,
    *,
    max_attempts: int = RATE_LIMIT_MAX,
    window_seconds: int = RATE_LIMIT_WINDOW,
) -> RateLimitDecision:
    """Check or atomically consume a persistent fixed-window bucket."""
    now = int(time.time())
    max_attempts = max(1, int(max_attempts))
    window_seconds = max(1, int(window_seconds))
    bucket_key = hashlib.sha256(str(bucket or "unknown").encode("utf-8")).hexdigest()
    conn = None
    try:
        conn = _get_rate_limit_database().get_connection()
        if consume_attempt:
            row = conn.execute(
                """
                INSERT INTO rate_limit_buckets (
                    bucket_key, window_started_at, attempt_count, expires_at
                ) VALUES (?, ?, 1, ?)
                ON CONFLICT(bucket_key) DO UPDATE SET
                    window_started_at = CASE
                        WHEN rate_limit_buckets.expires_at <= excluded.window_started_at
                        THEN excluded.window_started_at
                        ELSE rate_limit_buckets.window_started_at
                    END,
                    attempt_count = CASE
                        WHEN rate_limit_buckets.expires_at <= excluded.window_started_at
                        THEN 1
                        ELSE LEAST(rate_limit_buckets.attempt_count + 1, ?)
                    END,
                    expires_at = CASE
                        WHEN rate_limit_buckets.expires_at <= excluded.window_started_at
                        THEN excluded.expires_at
                        ELSE rate_limit_buckets.expires_at
                    END
                RETURNING attempt_count, expires_at
                """,
                (bucket_key, now, now + window_seconds, max_attempts + 1),
            ).fetchone()
        else:
            row = conn.execute(
                """SELECT attempt_count, expires_at
                   FROM rate_limit_buckets
                   WHERE bucket_key = ? AND expires_at > ?""",
                (bucket_key, now),
            ).fetchone()
        attempt_count = int(row[0]) if row is not None else 0
        expires_at = int(row[1]) if row is not None else now + window_seconds
        conn.commit()
        return RateLimitDecision(
            attempt_count <= max_attempts,
            max(1, expires_at - now) if attempt_count > max_attempts else 0,
            max(0, max_attempts - attempt_count),
        )
    except Exception as rate_limit_error:
        if conn is not None:
            try:
                conn.rollback()
            except DatabaseError:
                pass
        from backend.shared.logging_utils import log_error
        log_error(rate_limit_error, "rate_limit", level="WARN")
        return RateLimitDecision(False, window_seconds, 0, storage_failed=True)
    finally:
        if conn is not None:
            conn.close()


def rate_limit_response(message, decision=None):
    retry_after = max(1, int(getattr(decision, "retry_after", RATE_LIMIT_WINDOW)))
    return JSONResponse(
        {
            "error": message,
            "code": "rate_limit_exceeded",
            "retry_after": retry_after,
        },
        status_code=429,
        headers={"Retry-After": str(retry_after)},
    )

def rate_limit_bucket_hash(bucket: str) -> str:
    """Return the opaque database key for one logical rate-limit bucket."""

    return hashlib.sha256(str(bucket or "unknown").encode("utf-8")).hexdigest()


def clear_rate_limit_buckets(cursor, *buckets: str) -> None:
    """Clear successful-authentication buckets inside the caller's transaction."""

    for bucket in {str(value) for value in buckets if value}:
        cursor.execute(
            "DELETE FROM rate_limit_buckets WHERE bucket_key = ?",
            (rate_limit_bucket_hash(bucket),),
        )


def generate_otp() -> str:
    """Tạo OTP cryptographically secure."""
    return str(secrets.randbelow(900000) + 100000)

def get_user_organizations(cursor, user_id):
    """Return server-owned organization identities and membership roles."""

    cursor.execute(
        """
        SELECT tc.id, tc.ten_to_chuc,
               tc.trang_thai AS organization_status,
               tvtc.vai_tro_trong_to_chuc,
               sub.package_id, sub.status AS subscription_status,
               sub.starts_at, sub.expires_at, sub.member_quota, sub.revision,
               pkg.trang_thai AS package_status,
               (SELECT count(*) FROM thanh_vien_to_chuc members
                WHERE members.organization_id = tc.id
                  AND COALESCE(members.trang_thai_thanh_vien, 'active') = 'active') AS member_count
        FROM thanh_vien_to_chuc AS tvtc
        JOIN to_chuc AS tc ON tc.id = tvtc.organization_id
        LEFT JOIN organization_subscriptions AS sub ON sub.organization_id = tc.id
        LEFT JOIN goi_dich_vu AS pkg ON pkg.id = sub.package_id
        WHERE tvtc.user_id = ?
          AND COALESCE(tvtc.trang_thai_thanh_vien, 'active') = 'active'
        ORDER BY CASE lower(trim(tvtc.vai_tro_trong_to_chuc))
                    WHEN 'manager' THEN 0
                    WHEN 'employee' THEN 1
                    ELSE 2
                 END,
                 lower(tc.ten_to_chuc), tc.id
        """,
        (user_id,),
    )
    organizations = []
    now = int(time.time())
    for row in cursor.fetchall():
        membership_role = normalize_organization_role(row['vai_tro_trong_to_chuc'])
        if membership_role is None:
            continue
        has_subscription = row['package_id'] is not None
        subscription_status = (
            str(row['subscription_status'] or 'missing').strip().lower()
            if has_subscription
            else None
        )
        expires_at = int(row['expires_at']) if row['expires_at'] is not None else None
        if subscription_status and expires_at is not None and expires_at <= now:
            subscription_status = 'expired'
        organization_status = str(row['organization_status'] or '').strip().lower()
        package_status = str(row['package_status'] or '').strip().lower()
        workspace_status = 'active' if organization_status == 'active' else 'suspended'
        word_export_enabled = bool(
            workspace_status == 'active'
            and subscription_status == 'active'
            and package_status == 'active'
        )
        starts_at = int(row['starts_at']) if row['starts_at'] is not None else None
        subscription = {
            "package_id": row['package_id'],
            "status": subscription_status,
            "starts_at": starts_at,
            "expires_at": expires_at,
            "start_date": vietnam_date_from_epoch(starts_at),
            "end_date": vietnam_date_from_epoch(expires_at),
            "member_quota": int(row['member_quota'] or 0),
            "member_count": int(row['member_count'] or 0),
            "revision": int(row['revision'] or 0),
        } if has_subscription else None
        organizations.append(
            {
                "id": str(row['id']),
                "name": str(row['ten_to_chuc']),
                "scope_type": "organization",
                "role": membership_role,
                "status": workspace_status,
                "subscription": subscription,
                "entitlements": {
                    "word_export": word_export_enabled,
                    "source": "organization_subscription",
                },
            }
        )
    return organizations


def build_user_access_payload(cursor, user_id, platform_role, active_org_hint=None, display_name=None):
    platform_role = normalize_platform_role(platform_role)
    organizations = get_user_organizations(cursor, user_id)
    if platform_role != "super_admin":
        from backend.documents.word_defaults import ensure_personal_word_workspace
        ensure_personal_word_workspace(cursor, user_id)
        organizations.append(
            personal_workspace_payload(
                user_id,
                display_name,
                get_account_subscription(cursor, user_id),
            )
        )
    active_organizations = [org for org in organizations if org["status"] == "active"]
    hint = str(active_org_hint or '').strip()
    selected = next(
        (org for org in active_organizations if org["id"] == hint),
        None,
    ) if hint else None
    if selected is None and active_organizations:
        selected = active_organizations[0]

    membership_role = selected["role"] if selected else None
    subscription = selected.get("subscription") if selected else None
    entitlements = dict(selected.get("entitlements") or {}) if selected else {}
    if platform_role == "super_admin":
        entitlements["word_export"] = True
        entitlements["source"] = "platform"
    display_role = "super_admin" if platform_role == "super_admin" else membership_role
    return {
        "role": display_role or "employee",
        "platform_role": platform_role,
        "membership_role": membership_role,
        "effective_roles": effective_access_roles(platform_role, membership_role),
        "active_org_id": selected["id"] if selected else None,
        "organizations": organizations,
        "subscription": subscription,
        "entitlements": entitlements,
        "package_id": subscription.get("package_id") if subscription else None,
        "package_start_date": subscription.get("start_date") if subscription else None,
        "package_end_date": subscription.get("end_date") if subscription else None,
    }
