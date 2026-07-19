"""Persistent, revocable multi-device authentication sessions."""

from backend.db.db_helper import OperationalError
from backend.auth.mfa_service import is_mfa_required_for_role

import hashlib
import time
import uuid

from backend.observability.metrics import record_database_phase


def hash_session_token(token):
    return hashlib.sha256(str(token or "").encode("utf-8")).hexdigest()


def create_session(cursor, *, user_id, token, absolute_expires_at,
                   idle_timeout_seconds, remember=False, device_info=None,
                   mfa_verified=False, now=None):
    current = int(time.time() if now is None else now)
    absolute = int(absolute_expires_at)
    idle_expiry = min(absolute, current + max(60, int(idle_timeout_seconds)))
    session_id = str(uuid.uuid4())
    cursor.execute(
        """
        INSERT INTO auth_sessions (
            id, user_id, token_hash, created_at, last_seen_at,
            idle_expires_at, absolute_expires_at, revoked_at,
            remember_me, device_info, privileged_reauth_at, mfa_verified_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?)
        """,
        (
            session_id, user_id, hash_session_token(token), current, current,
            idle_expiry, absolute, 1 if remember else 0, device_info,
            current if mfa_verified else None,
        ),
    )
    return session_id


def load_session_user(database, token):
    raw_token = str(token or "").strip()
    if not raw_token:
        return None
    started_at = time.perf_counter()
    outcome = "ok"
    conn = database.get_connection()
    try:
        row = conn.execute(
            """
            SELECT accounts.id, accounts.ten_dang_nhap, accounts.mat_khau,
                   accounts.ho_ten, accounts.vai_tro, accounts.email,
                   accounts.anh_dai_dien,
                   EXISTS (
                       SELECT 1
                       FROM dinh_danh_ngoai AS identities
                       WHERE identities.user_id = accounts.id
                   ) AS has_external_identity,
                   sessions.id AS session_id,
                   sessions.created_at AS session_created_at,
                   sessions.last_seen_at, sessions.idle_expires_at,
                   sessions.absolute_expires_at, sessions.revoked_at,
                   sessions.remember_me, sessions.device_info,
                   sessions.privileged_reauth_at, sessions.mfa_verified_at,
                   COALESCE(mfa.enabled, 0) AS mfa_enabled
            FROM auth_sessions AS sessions
            JOIN tai_khoan AS accounts ON accounts.id = sessions.user_id
            LEFT JOIN account_mfa AS mfa ON mfa.user_id = accounts.id
            WHERE sessions.token_hash = ?
            LIMIT 1
            """,
            (hash_session_token(raw_token),),
        ).fetchone()
        if not row:
            outcome = "not_found"
            return None
        return dict(row)
    except Exception:
        outcome = "error"
        raise
    finally:
        conn.close()
        record_database_phase(
            "auth",
            "session_lookup",
            time.perf_counter() - started_at,
            outcome=outcome,
        )


def session_invalid_reason(user, now=None, allow_pending_mfa=False):
    if not user:
        return "user_not_found"
    current = int(time.time() if now is None else now)
    if user.get("revoked_at") is not None:
        return "session_revoked"
    if current >= int(user.get("absolute_expires_at") or 0):
        return "token_expired"
    if current >= int(user.get("idle_expires_at") or 0):
        return "session_idle_expired"
    if (
        not allow_pending_mfa
        and is_mfa_required_for_role(user.get("vai_tro"))
        and not user.get("mfa_verified_at")
    ):
        return "mfa_verification_required"
    return None


def touch_session(database, user, *, idle_timeout_seconds, now=None):
    current = int(time.time() if now is None else now)
    absolute = int(user.get("absolute_expires_at") or 0)
    idle_expiry = min(absolute, current + max(60, int(idle_timeout_seconds)))
    conn = database.get_connection()
    try:
        conn.execute(
            """
            UPDATE auth_sessions
            SET last_seen_at = ?, idle_expires_at = ?
            WHERE id = ? AND revoked_at IS NULL
            """,
            (current, idle_expiry, user["session_id"]),
        )
        conn.commit()
    except OperationalError as exc:
        if getattr(exc, "sqlstate", None) not in {"55P03", "57014", "40001", "40P01"}:
            raise
        conn.rollback()
        return False
    finally:
        conn.close()
    user.update({
        "last_seen_at": current,
        "idle_expires_at": idle_expiry,
        "absolute_expires_at": absolute,
    })
    return True


def revoke_session(cursor, token, now=None):
    current = int(time.time() if now is None else now)
    row = cursor.execute(
        "SELECT user_id FROM auth_sessions WHERE token_hash = ?",
        (hash_session_token(token),),
    ).fetchone()
    cursor.execute(
        "UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE token_hash = ?",
        (current, hash_session_token(token)),
    )
    return row[0] if row else None


def revoke_user_sessions(cursor, user_id, *, except_session_id=None, now=None):
    current = int(time.time() if now is None else now)
    if except_session_id:
        cursor.execute(
            "UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ? AND id != ?",
            (current, user_id, except_session_id),
        )
    else:
        cursor.execute(
            "UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ?",
            (current, user_id),
        )


def set_session_reauthentication(cursor, token, reauthenticated_at):
    cursor.execute(
        "UPDATE auth_sessions SET privileged_reauth_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
        (int(reauthenticated_at), hash_session_token(token)),
    )
    return cursor.rowcount == 1
