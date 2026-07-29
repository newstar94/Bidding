"""Seed and remove isolated authentication/RBAC browser E2E fixtures."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import sys
import time

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.auth.auth_helper import hash_password


def _database_url() -> str:
    value = str(os.environ.get("DATABASE_URL") or "").strip()
    if not value:
        raise RuntimeError("DATABASE_URL is required")
    return value


def _payload() -> dict:
    raw = sys.stdin.buffer.read()
    if not raw:
        raise RuntimeError("Fixture payload is required on stdin")
    return json.loads(raw.decode("utf-8"))


def _account_id(cursor, username: str) -> str:
    row = cursor.execute(
        "SELECT id FROM tai_khoan WHERE username_norm = %s",
        (username.lower(),),
    ).fetchone()
    if not row:
        raise RuntimeError(f"Unknown fixture account: {username}")
    return str(row[0])


def _setup(data: dict) -> dict:
    run_id = str(data["runId"])
    password_hash = hash_password(str(data["password"]))
    organization_id = str(data["organizationId"])
    other_organization_id = str(data["otherOrganizationId"])
    suspended_organization_id = str(data["suspendedOrganizationId"])
    accounts = data["accounts"]
    with psycopg.connect(_database_url()) as connection:
        with connection.cursor() as cursor:
            cursor.executemany(
                """INSERT INTO to_chuc (id, ten_to_chuc, trang_thai)
                   VALUES (%s, %s, %s)""",
                [
                    (organization_id, f"Auth E2E {run_id}", "active"),
                    (other_organization_id, f"Auth E2E other {run_id}", "active"),
                    (suspended_organization_id, f"Auth E2E suspended {run_id}", "suspended"),
                ],
            )
            now = int(time.time())
            cursor.executemany(
                """INSERT INTO organization_subscriptions (
                       organization_id, package_id, status, starts_at,
                       expires_at, member_quota
                   ) VALUES (%s, 'diamond', 'active', %s, %s, 999)""",
                [
                    (organization_id, now, now + 86400),
                    (other_organization_id, now, now + 86400),
                ],
            )
            for key, account in accounts.items():
                user_id = str(account["id"])
                username = str(account["username"]).lower()
                email = str(account["email"]).lower()
                cursor.execute(
                    """INSERT INTO tai_khoan (
                           id, ten_dang_nhap, username_norm, mat_khau, ho_ten,
                           vai_tro, email, email_norm, da_xac_minh, username_da_dat
                       ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 1)""",
                    (
                        user_id,
                        username,
                        username,
                        password_hash,
                        f"Auth E2E {key}",
                        account.get("platformRole", "user"),
                        email,
                        email,
                        1 if account.get("verified", True) else 0,
                    ),
                )
                membership = account.get("membership")
                if membership:
                    cursor.execute(
                        """INSERT INTO thanh_vien_to_chuc (
                               user_id, organization_id, vai_tro_trong_to_chuc,
                               ten_nhan_su, trang_thai_thanh_vien, left_at
                           ) VALUES (%s, %s, %s, %s, %s, %s)""",
                        (
                            user_id,
                            membership.get("organizationId", organization_id),
                            membership["role"],
                            f"Nhân sự {key}",
                            membership.get("status", "active"),
                            "2026-07-29 00:00:00" if membership.get("status") == "left" else None,
                        ),
                    )
            manager = accounts["manager"]
            cursor.execute(
                """INSERT INTO thanh_vien_to_chuc (
                       user_id, organization_id, vai_tro_trong_to_chuc,
                       ten_nhan_su, trang_thai_thanh_vien
                   ) VALUES (%s, %s, 'manager', %s, 'active')""",
                (manager["id"], other_organization_id, "Nhân sự manager workspace phụ"),
            )
            employee = accounts["employee"]
            cursor.execute(
                """INSERT INTO ma_tran_phan_quyen (
                       id, organization_id, owner_type, emp_id,
                       kehoach, goithau, chudautu, nhathau,
                       chuyengia, hopdong, thongtinmothau, sync_version
                   ) VALUES (%s, %s, 'organization', %s,
                             'edit', 'edit', 'edit', 'edit',
                             'edit', 'edit', 'edit', 1)""",
                (f"auth-e2e-{run_id}-employee-permissions", organization_id, employee["id"]),
            )
            cursor.execute(
                "DELETE FROM rate_limit_buckets"
            )
    return {
        "accounts": {key: account["id"] for key, account in accounts.items()},
        "organizations": [organization_id, other_organization_id, suspended_organization_id],
    }


def _session_action(data: dict, *, expire: bool = False) -> dict:
    username = str(data["username"]).lower()
    with psycopg.connect(_database_url()) as connection:
        with connection.cursor() as cursor:
            user_id = _account_id(cursor, username)
            now = int(time.time())
            if expire:
                cursor.execute(
                    """UPDATE auth_sessions
                          SET absolute_expires_at = %s, idle_expires_at = %s
                        WHERE user_id = %s AND revoked_at IS NULL""",
                    (now - 1, now - 1, user_id),
                )
            else:
                cursor.execute(
                    """UPDATE auth_sessions SET revoked_at = %s
                        WHERE user_id = %s AND revoked_at IS NULL""",
                    (now, user_id),
                )
            return {"updated": cursor.rowcount}


def _seed_reset(data: dict) -> dict:
    username = str(data["username"]).lower()
    token = str(data["token"])
    now = int(time.time())
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    with psycopg.connect(_database_url()) as connection:
        with connection.cursor() as cursor:
            user_id = _account_id(cursor, username)
            cursor.execute(
                "UPDATE password_reset_tokens SET used_at = %s WHERE user_id = %s AND used_at IS NULL",
                (now, user_id),
            )
            cursor.execute(
                """INSERT INTO password_reset_tokens (
                       id, user_id, token_hash, expires_at, used_at, requested_ip, created_at
                   ) VALUES (%s, %s, %s, %s, NULL, %s, %s)""",
                (f"reset-{data['runId']}", user_id, token_hash, now + 1800, "127.0.0.1", now),
            )
    return {"seeded": True}


def _cleanup(data: dict) -> dict:
    account_ids = [str(account["id"]) for account in data["accounts"].values()]
    organization_ids = [
        str(data["organizationId"]),
        str(data["otherOrganizationId"]),
        str(data["suspendedOrganizationId"]),
    ]
    with psycopg.connect(_database_url()) as connection:
        with connection.cursor() as cursor:
            registered_username = str(data.get("registeredUsername") or "").lower()
            if registered_username:
                cursor.execute(
                    "DELETE FROM tai_khoan WHERE username_norm = %s",
                    (registered_username,),
                )
                deleted_registered = cursor.rowcount
            else:
                deleted_registered = 0
            cursor.execute(
                "DELETE FROM tai_khoan WHERE username_norm LIKE %s",
                (f"auth-e2e-{data['runId'].lower()}-%",),
            )
            deleted_prefixed = cursor.rowcount
            cursor.execute("DELETE FROM tai_khoan WHERE id = ANY(%s)", (account_ids,))
            deleted_accounts = deleted_registered + deleted_prefixed + cursor.rowcount
            cursor.execute("DELETE FROM to_chuc WHERE id = ANY(%s)", (organization_ids,))
            deleted_organizations = cursor.rowcount
    return {
        "deletedAccounts": deleted_accounts,
        "deletedOrganizations": deleted_organizations,
    }


def main() -> None:
    if len(sys.argv) != 2:
        raise RuntimeError("Expected one action: setup, revoke, expire, seed-reset, cleanup")
    action = sys.argv[1]
    data = _payload()
    if action == "setup":
        result = _setup(data)
    elif action == "revoke":
        result = _session_action(data)
    elif action == "expire":
        result = _session_action(data, expire=True)
    elif action == "seed-reset":
        result = _seed_reset(data)
    elif action == "cleanup":
        result = _cleanup(data)
    else:
        raise RuntimeError(f"Unknown action: {action}")
    sys.stdout.write(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
