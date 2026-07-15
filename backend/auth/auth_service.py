import os
import time
import secrets
import hashlib
import sqlite3
from dataclasses import dataclass
from starlette.responses import JSONResponse
from backend.db.id_utils import stable_org_id
from backend.auth.roles import (
    effective_access_roles,
    normalize_organization_role,
    normalize_platform_role,
)
from backend.shared.client_ip import get_client_ip


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
    """Check a persistent fixed-window bucket using an atomic DB transaction.

    Mac dinh van ghi nhan attempt de giu tuong thich voi cac flow OTP.
    Login dung consume_attempt=False de chi ghi nhan khi xac thuc that bai.
    """
    now = int(time.time())
    max_attempts = max(1, int(max_attempts))
    window_seconds = max(1, int(window_seconds))
    bucket_key = hashlib.sha256(str(bucket or "unknown").encode("utf-8")).hexdigest()
    conn = None
    try:
        conn = _get_rate_limit_database().get_connection()
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("DELETE FROM rate_limit_buckets WHERE expires_at <= ?", (now,))
        row = conn.execute(
            "SELECT attempt_count, expires_at FROM rate_limit_buckets WHERE bucket_key = ?",
            (bucket_key,),
        ).fetchone()
        attempt_count = int(row[0]) if row is not None else 0
        expires_at = int(row[1]) if row is not None else now + window_seconds
        if attempt_count >= max_attempts:
            conn.commit()
            return RateLimitDecision(False, max(1, expires_at - now), 0)
        if consume_attempt:
            conn.execute(
                """
                INSERT INTO rate_limit_buckets (
                    bucket_key, window_started_at, attempt_count, expires_at
                ) VALUES (?, ?, 1, ?)
                ON CONFLICT(bucket_key) DO UPDATE SET
                    attempt_count = rate_limit_buckets.attempt_count + 1
                """,
                (bucket_key, now, now + window_seconds),
            )
            attempt_count += 1
        conn.commit()
        return RateLimitDecision(
            True,
            0,
            max(0, max_attempts - attempt_count),
        )
    except Exception as rate_limit_error:
        if conn is not None:
            try:
                conn.rollback()
            except sqlite3.Error:
                pass
        from backend.shared.logging_utils import log_error
        log_error(rate_limit_error, "rate_limit", level="WARN")
        return RateLimitDecision(False, window_seconds, 0, storage_failed=True)
    finally:
        if conn is not None:
            conn.close()


def check_rate_limit(
    bucket: str,
    consume_attempt: bool = True,
    *,
    max_attempts: int = RATE_LIMIT_MAX,
    window_seconds: int = RATE_LIMIT_WINDOW,
) -> bool:
    return get_rate_limit_decision(
        bucket,
        consume_attempt,
        max_attempts=max_attempts,
        window_seconds=window_seconds,
    ).allowed


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

def record_rate_limit_failure(ip: str) -> bool:
    """Ghi nhan mot lan that bai vao rate limiter."""
    return check_rate_limit(ip, consume_attempt=True)

def generate_otp() -> str:
    """Tạo OTP cryptographically secure."""
    return str(secrets.randbelow(900000) + 100000)

def get_user_organizations(cursor, user_id):
    """Return server-owned organization identities and membership roles."""

    cursor.execute(
        """
        SELECT tc.id, tc.ten_to_chuc, tc.scope_type,
               tc.trang_thai AS organization_status,
               tvtc.vai_tro_trong_to_chuc,
               sub.package_id, sub.status AS subscription_status,
               sub.starts_at, sub.expires_at, sub.member_quota, sub.revision,
               pkg.trang_thai AS package_status,
               (SELECT count(*) FROM thanh_vien_to_chuc members
                WHERE members.organization_id = tc.id) AS member_count
        FROM thanh_vien_to_chuc AS tvtc
        JOIN to_chuc AS tc ON tc.id = tvtc.organization_id
        LEFT JOIN organization_subscriptions AS sub ON sub.organization_id = tc.id
        LEFT JOIN goi_dich_vu AS pkg ON pkg.id = sub.package_id
        WHERE tvtc.user_id = ?
          AND (
              tc.scope_type = 'organization'
              OR NOT EXISTS (
                  SELECT 1
                  FROM thanh_vien_to_chuc business_membership
                  JOIN to_chuc business_org
                    ON business_org.id = business_membership.organization_id
                  WHERE business_membership.user_id = tvtc.user_id
                    AND business_org.scope_type = 'organization'
              )
          )
        ORDER BY CASE tc.scope_type WHEN 'organization' THEN 0 ELSE 1 END,
                 CASE lower(trim(tvtc.vai_tro_trong_to_chuc))
                    WHEN 'owner' THEN 0
                    WHEN 'manager' THEN 1
                    WHEN 'employee' THEN 2
                    ELSE 3
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
        subscription_status = str(row['subscription_status'] or 'missing').strip().lower()
        expires_at = int(row['expires_at']) if row['expires_at'] is not None else None
        if expires_at is not None and expires_at <= now:
            subscription_status = 'expired'
        organization_status = str(row['organization_status'] or '').strip().lower()
        package_status = str(row['package_status'] or '').strip().lower()
        effective_status = 'active'
        if organization_status != 'active' or subscription_status == 'suspended':
            effective_status = 'suspended'
        elif subscription_status != 'active':
            effective_status = subscription_status
        elif package_status != 'active':
            effective_status = 'package_inactive'
        starts_at = int(row['starts_at']) if row['starts_at'] is not None else None
        subscription = {
            "package_id": row['package_id'],
            "status": subscription_status,
            "starts_at": starts_at,
            "expires_at": expires_at,
            "start_date": time.strftime('%Y-%m-%d', time.gmtime(starts_at)) if starts_at else None,
            "end_date": time.strftime('%Y-%m-%d', time.gmtime(expires_at)) if expires_at else None,
            "member_quota": int(row['member_quota'] or 0),
            "member_count": int(row['member_count'] or 0),
            "revision": int(row['revision'] or 0),
        }
        organizations.append(
            {
                "id": str(row['id']),
                "name": str(row['ten_to_chuc']),
                "scope_type": str(row['scope_type']),
                "role": membership_role,
                "status": effective_status,
                "subscription": subscription,
            }
        )
    return organizations


def build_user_access_payload(cursor, user_id, platform_role, active_org_hint=None):
    organizations = get_user_organizations(cursor, user_id)
    active_organizations = [org for org in organizations if org["status"] == "active"]
    hint = str(active_org_hint or '').strip()
    selected = next(
        (org for org in active_organizations if org["id"] == hint),
        None,
    ) if hint else None
    if selected is None and active_organizations:
        selected = active_organizations[0]

    platform_role = normalize_platform_role(platform_role)
    membership_role = selected["role"] if selected else None
    subscription = selected.get("subscription") if selected else None
    display_role = "super_admin" if platform_role == "super_admin" else membership_role
    return {
        "role": display_role or "employee",
        "platform_role": platform_role,
        "membership_role": membership_role,
        "effective_roles": effective_access_roles(platform_role, membership_role),
        "active_org_id": selected["id"] if selected else None,
        "organizations": organizations,
        "subscription": subscription,
        "package_id": subscription.get("package_id") if subscription else None,
        "package_start_date": subscription.get("start_date") if subscription else None,
        "package_end_date": subscription.get("end_date") if subscription else None,
    }


def provision_user_organization(cursor, user_id, display_name):
    """Create the private workspace owned by a user in the same transaction."""

    cursor.execute(
        "SELECT 1 FROM thanh_vien_to_chuc WHERE user_id = ? LIMIT 1",
        (user_id,),
    )
    if cursor.fetchone():
        return None
    org_id = stable_org_id(f"user:{user_id}")
    label = str(display_name or "Người dùng").strip() or "Người dùng"
    org_name = f"Không gian cá nhân của {label} ({str(user_id)[-8:]})"
    cursor.execute(
        """INSERT INTO to_chuc (
               id, ten_to_chuc, scope_type, personal_owner_user_id, trang_thai
           ) VALUES (?, ?, 'personal', ?, 'active')""",
        (org_id, org_name, user_id),
    )
    cursor.execute(
        """
        INSERT INTO thanh_vien_to_chuc
            (user_id, organization_id, vai_tro_trong_to_chuc)
        VALUES (?, ?, 'owner')
        """,
        (user_id, org_id),
    )
    now = int(time.time())
    cursor.execute(
        """
        INSERT INTO organization_subscriptions (
            organization_id, package_id, status, starts_at, expires_at, member_quota
        ) VALUES (?, 'silver', 'active', ?, ?, 5)
        """,
        (org_id, now, now + 365 * 24 * 60 * 60),
    )
    cursor.execute(
        "INSERT OR IGNORE INTO sync_metadata (organization_id, current_version) VALUES (?, 1)",
        (org_id,),
    )
    return org_id
