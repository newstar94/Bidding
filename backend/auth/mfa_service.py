"""Encrypted TOTP MFA with replay protection and one-use recovery codes."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import struct
import time
import urllib.parse

from cryptography.fernet import Fernet, InvalidToken


TOTP_PERIOD_SECONDS = 30
TOTP_DIGITS = 6
TOTP_WINDOW = 1
RECOVERY_CODE_COUNT = 10


class MfaConfigurationError(RuntimeError):
    pass


class MfaStateError(ValueError):
    pass


def _mfa_key_bytes() -> bytes:
    raw = str(os.environ.get("MFA_ENCRYPTION_KEY", "")).strip()
    if not raw:
        raise MfaConfigurationError("MFA_ENCRYPTION_KEY is not configured.")
    try:
        decoded = base64.urlsafe_b64decode(raw.encode("ascii"))
    except (ValueError, UnicodeEncodeError) as exc:
        raise MfaConfigurationError("MFA_ENCRYPTION_KEY is not valid base64.") from exc
    if len(decoded) != 32:
        raise MfaConfigurationError("MFA_ENCRYPTION_KEY must decode to 32 bytes.")
    return decoded


def _fernet() -> Fernet:
    raw = str(os.environ.get("MFA_ENCRYPTION_KEY", "")).strip()
    _mfa_key_bytes()
    return Fernet(raw.encode("ascii"))


def validate_mfa_configuration(environ=None, *, required=False) -> None:
    environ = os.environ if environ is None else environ
    raw = str(environ.get("MFA_ENCRYPTION_KEY", "")).strip()
    if not raw:
        if required:
            raise MfaConfigurationError("MFA_ENCRYPTION_KEY is required.")
        return
    try:
        decoded = base64.urlsafe_b64decode(raw.encode("ascii"))
        Fernet(raw.encode("ascii"))
    except (ValueError, UnicodeEncodeError) as exc:
        raise MfaConfigurationError("MFA_ENCRYPTION_KEY is invalid.") from exc
    if len(decoded) != 32:
        raise MfaConfigurationError("MFA_ENCRYPTION_KEY must decode to 32 bytes.")


def _recovery_pepper() -> bytes:
    return hashlib.sha256(
        _mfa_key_bytes() + b"\0BiddingFlow MFA recovery v1"
    ).digest()


def _normalize_code(value: str) -> str:
    return "".join(char for char in str(value or "").upper() if char.isalnum())


def _recovery_digest(code: str) -> str:
    return hmac.new(
        _recovery_pepper(), _normalize_code(code).encode("ascii"), hashlib.sha256
    ).hexdigest()


def generate_totp_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def totp_code(secret: str, counter: int) -> str:
    padded = secret + "=" * ((8 - len(secret) % 8) % 8)
    key = base64.b32decode(padded, casefold=True)
    digest = hmac.new(key, struct.pack(">Q", int(counter)), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    binary = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(binary % (10**TOTP_DIGITS)).zfill(TOTP_DIGITS)


def current_totp_code(secret: str, now=None) -> str:
    timestamp = int(time.time() if now is None else now)
    return totp_code(secret, timestamp // TOTP_PERIOD_SECONDS)


def is_mfa_enabled(cursor, user_id: str) -> bool:
    row = cursor.execute(
        "SELECT enabled FROM account_mfa WHERE user_id = ?", (user_id,)
    ).fetchone()
    return bool(row and row[0])


def get_mfa_status(cursor, user_id: str, role: str | None = None) -> dict:
    row = cursor.execute(
        """SELECT enabled, enabled_at, last_used_at
           FROM account_mfa WHERE user_id = ?""",
        (user_id,),
    ).fetchone()
    enabled = bool(row and row[0])
    normalized_role = str(role or "").strip().casefold()
    return {
        "enabled": enabled,
        "required": normalized_role == "super_admin",
        "recommended": normalized_role in {"manager", "super_admin"},
        "enabled_at": int(row[1]) if row and row[1] is not None else None,
        "last_used_at": int(row[2]) if row and row[2] is not None else None,
    }


def begin_mfa_enrollment(cursor, *, user_id: str, account_label: str) -> dict:
    existing = cursor.execute(
        "SELECT enabled FROM account_mfa WHERE user_id = ? FOR UPDATE", (user_id,)
    ).fetchone()
    if existing and bool(existing[0]):
        raise MfaStateError("MFA đã được bật cho tài khoản này.")

    secret = generate_totp_secret()
    ciphertext = _fernet().encrypt(secret.encode("ascii")).decode("ascii")
    now = int(time.time())
    cursor.execute(
        """INSERT INTO account_mfa (
               user_id, secret_ciphertext, enabled, last_counter,
               recovery_codes_json, created_at, updated_at, enabled_at, last_used_at
           ) VALUES (?, ?, 0, -1, '[]', ?, ?, NULL, NULL)
           ON CONFLICT(user_id) DO UPDATE SET
               secret_ciphertext = excluded.secret_ciphertext,
               enabled = 0,
               last_counter = -1,
               recovery_codes_json = '[]',
               updated_at = excluded.updated_at,
               enabled_at = NULL,
               last_used_at = NULL""",
        (user_id, ciphertext, now, now),
    )
    label = urllib.parse.quote(str(account_label or user_id), safe="")
    issuer = urllib.parse.quote("BiddingFlow", safe="")
    uri = (
        f"otpauth://totp/BiddingFlow:{label}?secret={secret}"
        f"&issuer={issuer}&algorithm=SHA1&digits={TOTP_DIGITS}"
        f"&period={TOTP_PERIOD_SECONDS}"
    )
    return {"secret": secret, "otpauth_uri": uri}


def _decrypt_secret(ciphertext: str) -> str:
    try:
        return _fernet().decrypt(str(ciphertext).encode("ascii")).decode("ascii")
    except (InvalidToken, UnicodeError, ValueError) as exc:
        raise MfaConfigurationError("Stored MFA secret cannot be decrypted.") from exc


def _matching_counter(secret: str, code: str, *, now=None, last_counter=-1):
    normalized = _normalize_code(code)
    if len(normalized) != TOTP_DIGITS or not normalized.isdigit():
        return None
    current = int(time.time() if now is None else now) // TOTP_PERIOD_SECONDS
    for offset in range(-TOTP_WINDOW, TOTP_WINDOW + 1):
        candidate = current + offset
        if candidate <= int(last_counter):
            continue
        if hmac.compare_digest(totp_code(secret, candidate), normalized):
            return candidate
    return None


def _new_recovery_codes() -> list[str]:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return [
        "-".join(
            "".join(secrets.choice(alphabet) for _ in range(5))
            for _ in range(2)
        )
        for _ in range(RECOVERY_CODE_COUNT)
    ]


def confirm_mfa_enrollment(cursor, *, user_id: str, code: str, now=None) -> list[str]:
    row = cursor.execute(
        """SELECT secret_ciphertext, enabled, last_counter
           FROM account_mfa WHERE user_id = ? FOR UPDATE""",
        (user_id,),
    ).fetchone()
    if not row:
        raise MfaStateError("Chưa bắt đầu thiết lập MFA.")
    if bool(row[1]):
        raise MfaStateError("MFA đã được bật.")
    timestamp = int(time.time() if now is None else now)
    secret = _decrypt_secret(row[0])
    counter = _matching_counter(
        secret, code, now=timestamp, last_counter=int(row[2] or -1)
    )
    if counter is None:
        raise MfaStateError("Mã xác thực không đúng hoặc đã được sử dụng.")
    recovery_codes = _new_recovery_codes()
    recovery_hashes = [_recovery_digest(value) for value in recovery_codes]
    cursor.execute(
        """UPDATE account_mfa
           SET enabled = 1, last_counter = ?, recovery_codes_json = ?,
               enabled_at = ?, updated_at = ?, last_used_at = ?
           WHERE user_id = ?""",
        (
            counter,
            json.dumps(recovery_hashes, separators=(",", ":")),
            timestamp,
            timestamp,
            timestamp,
            user_id,
        ),
    )
    return recovery_codes


def consume_mfa_code(cursor, *, user_id: str, code: str, now=None) -> bool:
    row = cursor.execute(
        """SELECT secret_ciphertext, enabled, last_counter, recovery_codes_json
           FROM account_mfa WHERE user_id = ? FOR UPDATE""",
        (user_id,),
    ).fetchone()
    if not row or not bool(row[1]):
        return False
    timestamp = int(time.time() if now is None else now)
    secret = _decrypt_secret(row[0])
    counter = _matching_counter(
        secret, code, now=timestamp, last_counter=int(row[2] or -1)
    )
    if counter is not None:
        cursor.execute(
            """UPDATE account_mfa
               SET last_counter = ?, last_used_at = ?, updated_at = ?
               WHERE user_id = ?""",
            (counter, timestamp, timestamp, user_id),
        )
        return True

    normalized = _normalize_code(code)
    candidate_hash = _recovery_digest(normalized) if normalized else ""
    try:
        stored_hashes = json.loads(row[3] or "[]")
    except (TypeError, json.JSONDecodeError):
        stored_hashes = []
    matched_index = next(
        (
            index
            for index, stored in enumerate(stored_hashes)
            if hmac.compare_digest(str(stored), candidate_hash)
        ),
        None,
    )
    if matched_index is None:
        return False
    del stored_hashes[matched_index]
    cursor.execute(
        """UPDATE account_mfa
           SET recovery_codes_json = ?, last_used_at = ?, updated_at = ?
           WHERE user_id = ?""",
        (
            json.dumps(stored_hashes, separators=(",", ":")),
            timestamp,
            timestamp,
            user_id,
        ),
    )
    return True


def disable_mfa(cursor, *, user_id: str) -> None:
    cursor.execute("DELETE FROM account_mfa WHERE user_id = ?", (user_id,))
