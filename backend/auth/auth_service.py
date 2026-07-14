import os
import time
import secrets
import hashlib
from dataclasses import dataclass
from starlette.responses import JSONResponse
from backend.shared.helpers import (
    _org_cache_invalidate_by_user_id
)
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
            except Exception:
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

def get_user_org_names(cursor, user_id):
    """Lấy danh sách tên các tổ chức của user."""
    cursor.execute("""
        SELECT tc.ten_to_chuc
        FROM thanh_vien_to_chuc tvtc
        JOIN to_chuc tc ON tvtc.organization_id = tc.id
        WHERE tvtc.user_id = ?
    """, (user_id,))
    rows = cursor.fetchall()
    return ", ".join(row['ten_to_chuc'] for row in rows)


def get_user_organizations(cursor, user_id):
    """Return server-owned organization identities and membership roles."""

    cursor.execute(
        """
        SELECT tc.id, tc.ten_to_chuc, tc.trang_thai,
               tvtc.vai_tro_trong_to_chuc
        FROM thanh_vien_to_chuc AS tvtc
        JOIN to_chuc AS tc ON tc.id = tvtc.organization_id
        WHERE tvtc.user_id = ?
        ORDER BY CASE lower(trim(tvtc.vai_tro_trong_to_chuc))
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
    for row in cursor.fetchall():
        membership_role = normalize_organization_role(row['vai_tro_trong_to_chuc'])
        if membership_role is None:
            continue
        organizations.append(
            {
                "id": str(row['id']),
                "name": str(row['ten_to_chuc']),
                "role": membership_role,
                "status": str(row['trang_thai'] or '').strip().lower(),
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
    display_role = "super_admin" if platform_role == "super_admin" else membership_role
    return {
        "role": display_role or "viewer",
        "platform_role": platform_role,
        "membership_role": membership_role,
        "effective_roles": effective_access_roles(platform_role, membership_role),
        "active_org_id": selected["id"] if selected else None,
        "organizations": organizations,
        # Compatibility-only display field; never use this value as an auth key.
        "organization_name": ", ".join(org["name"] for org in organizations),
    }


def provision_user_organization(cursor, user_id, display_name):
    """Create the initial organization and its owner in the same transaction."""

    cursor.execute(
        "SELECT 1 FROM thanh_vien_to_chuc WHERE user_id = ? LIMIT 1",
        (user_id,),
    )
    if cursor.fetchone():
        return None
    org_id = stable_org_id(f"user:{user_id}")
    label = str(display_name or "Người dùng").strip() or "Người dùng"
    org_name = f"Tổ chức của {label} ({str(user_id)[-8:]})"
    cursor.execute(
        "INSERT INTO to_chuc (id, ten_to_chuc, quan_ly_id, trang_thai) VALUES (?, ?, ?, 'active')",
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
    cursor.execute(
        "INSERT OR IGNORE INTO sync_metadata (organization_id, current_version) VALUES (?, 1)",
        (org_id,),
    )
    return org_id


def update_user_organizations(cursor, user_id, organization_name):
    """Cập nhật tổ chức của người dùng."""
    new_orgs = [o.strip() for o in organization_name.split(',') if o.strip()]

    cursor.execute("""
        SELECT tc.id, tc.ten_to_chuc
        FROM thanh_vien_to_chuc tvtc
        JOIN to_chuc tc ON tvtc.organization_id = tc.id
        WHERE tvtc.user_id = ?
    """, (user_id,))
    current_assoc = {row['ten_to_chuc']: row['id'] for row in cursor.fetchall()}


    for org_name in new_orgs:
        if org_name not in current_assoc:
            cursor.execute("SELECT id FROM to_chuc WHERE ten_to_chuc = ?", (org_name,))
            org_row = cursor.fetchone()
            created_org = org_row is None
            if org_row:
                org_id = org_row['id']
            else:
                org_id = stable_org_id(org_name)
                cursor.execute(
                    "INSERT OR IGNORE INTO to_chuc (id, ten_to_chuc, quan_ly_id) VALUES (?, ?, ?)",
                    (org_id, org_name, user_id)
                )

            # A newly-created organization must have an owner.  Joining an
            # existing organization never derives membership power from the
            # account-level role.
            role_in_org = 'owner' if created_org else 'employee'
            cursor.execute(
                "INSERT OR IGNORE INTO thanh_vien_to_chuc (user_id, organization_id, vai_tro_trong_to_chuc) VALUES (?, ?, ?)",
                (user_id, org_id, role_in_org)
            )


    removed_any = False
    for org_name, org_id in current_assoc.items():
        if org_name not in new_orgs:
            cursor.execute(
                """
                SELECT lower(trim(vai_tro_trong_to_chuc))
                FROM thanh_vien_to_chuc
                WHERE user_id = ? AND organization_id = ?
                """,
                (user_id, org_id),
            )
            membership = cursor.fetchone()
            if membership and str(membership[0] or '').strip().lower() == 'owner':
                cursor.execute(
                    """
                    SELECT count(*) FROM thanh_vien_to_chuc
                    WHERE organization_id = ?
                      AND lower(trim(vai_tro_trong_to_chuc)) = 'owner'
                    """,
                    (org_id,),
                )
                if int(cursor.fetchone()[0]) <= 1:
                    raise ValueError("Không thể xóa chủ sở hữu cuối cùng khỏi tổ chức.")
            cursor.execute(
                "DELETE FROM thanh_vien_to_chuc WHERE user_id = ? AND organization_id = ?",
                (user_id, org_id)
            )
            removed_any = True

    if removed_any:
        _org_cache_invalidate_by_user_id(user_id)
