"""One-time password reset token persistence and redemption."""

import hashlib
import secrets
import time
import uuid

from backend.auth.auth_helper import hash_password


RESET_TOKEN_TTL_SECONDS = 30 * 60


class InvalidResetToken(ValueError):
    """Raised for missing, expired, already-used or unknown reset tokens."""


def _token_hash(token):
    return hashlib.sha256(str(token).encode("utf-8")).hexdigest()


def create_password_reset(database, username, email, requested_ip, now=None):
    """Create a reset token when the identity matches, otherwise return None.

    The caller must always return the same public response for both outcomes.
    The raw token exists only in the returned email payload and is never stored.
    """
    normalized_username = str(username or "").strip().lower()
    normalized_email = str(email or "").strip().lower()
    current_time = int(time.time() if now is None else now)
    conn = database.get_connection()
    try:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(
            "DELETE FROM password_reset_tokens WHERE expires_at <= ? OR used_at IS NOT NULL",
            (current_time,),
        )
        row = conn.execute(
            """
            SELECT id, ho_ten, ten_dang_nhap, email
            FROM tai_khoan
            WHERE lower(ten_dang_nhap) = ? AND lower(email) = ?
            LIMIT 1
            """,
            (normalized_username, normalized_email),
        ).fetchone()
        if row is None:
            conn.commit()
            return None

        user = dict(row)
        conn.execute(
            "UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL",
            (current_time, user["id"]),
        )
        raw_token = secrets.token_urlsafe(32)
        conn.execute(
            """
            INSERT INTO password_reset_tokens (
                id, user_id, token_hash, expires_at, used_at, requested_ip, created_at
            ) VALUES (?, ?, ?, ?, NULL, ?, ?)
            """,
            (
                str(uuid.uuid4()),
                user["id"],
                _token_hash(raw_token),
                current_time + RESET_TOKEN_TTL_SECONDS,
                str(requested_ip or "")[:128],
                current_time,
            ),
        )
        conn.commit()
        return {
            "token": raw_token,
            "email": user["email"],
            "name": user["ho_ten"],
            "username": user["ten_dang_nhap"],
        }
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def redeem_password_reset(database, token, new_password, now=None):
    """Atomically consume a token, change the password and revoke sessions."""
    raw_token = str(token or "")
    if not raw_token or len(raw_token) > 512:
        raise InvalidResetToken("Reset token is invalid.")

    current_time = int(time.time() if now is None else now)
    conn = database.get_connection()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            """
            SELECT id, user_id, expires_at, used_at
            FROM password_reset_tokens
            WHERE token_hash = ?
            LIMIT 1
            """,
            (_token_hash(raw_token),),
        ).fetchone()
        if row is None or row["used_at"] is not None or int(row["expires_at"]) <= current_time:
            raise InvalidResetToken("Reset token is invalid or expired.")

        consumed = conn.execute(
            """
            UPDATE password_reset_tokens
            SET used_at = ?
            WHERE id = ? AND used_at IS NULL AND expires_at > ?
            """,
            (current_time, row["id"], current_time),
        )
        if consumed.rowcount != 1:
            raise InvalidResetToken("Reset token has already been used.")

        user_id = row["user_id"]
        updated = conn.execute(
            """
            UPDATE tai_khoan
            SET mat_khau = ?, token_phien = NULL, han_su_dung_token = NULL
            WHERE id = ?
            """,
            (hash_password(new_password), user_id),
        )
        if updated.rowcount != 1:
            raise InvalidResetToken("Reset token user no longer exists.")

        conn.execute(
            "UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL",
            (current_time, user_id),
        )
        conn.commit()
        return user_id
    except InvalidResetToken:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
