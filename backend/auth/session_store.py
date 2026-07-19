"""Persistent, revocable multi-device authentication sessions."""

from backend.db.db_helper import OperationalError

import hashlib
import time
import uuid


def hash_session_token(token):
    return hashlib.sha256(str(token or "").encode("utf-8")).hexdigest()


def create_session(cursor, *, user_id, token, absolute_expires_at,
                   idle_timeout_seconds, remember=False, device_info=None, now=None):
    current = int(time.time() if now is None else now)
    absolute = int(absolute_expires_at)
    idle_expiry = min(absolute, current + max(60, int(idle_timeout_seconds)))
    session_id = str(uuid.uuid4())
    cursor.execute(
        """
        INSERT INTO auth_sessions (
            id, user_id, token_hash, created_at, last_seen_at,
            idle_expires_at, absolute_expires_at, revoked_at,
            remember_me, device_info, privileged_reauth_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)
        """,
        (
            session_id, user_id, hash_session_token(token), current, current,
            idle_expiry, absolute, 1 if remember else 0, device_info,
        ),
    )
    return session_id


def load_session_user(database, token):
    raw_token = str(token or "").strip()
    if not raw_token:
        return None
    conn = database.get_connection()
    try:
        row = conn.execute(
            """
            SELECT accounts.*, sessions.id AS session_id,
                   sessions.created_at AS session_created_at,
                   sessions.last_seen_at, sessions.idle_expires_at,
                   sessions.absolute_expires_at, sessions.revoked_at,
                   sessions.remember_me, sessions.device_info,
                   sessions.privileged_reauth_at
            FROM auth_sessions AS sessions
            JOIN tai_khoan AS accounts ON accounts.id = sessions.user_id
            WHERE sessions.token_hash = ?
            LIMIT 1
            """,
            (hash_session_token(raw_token),),
        ).fetchone()
        if not row:
            return None
        return dict(row)
    finally:
        conn.close()


def session_invalid_reason(user, now=None):
    if not user:
        return "user_not_found"
    current = int(time.time() if now is None else now)
    if user.get("revoked_at") is not None:
        return "session_revoked"
    if current >= int(user.get("absolute_expires_at") or 0):
        return "token_expired"
    if current >= int(user.get("idle_expires_at") or 0):
        return "session_idle_expired"
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
