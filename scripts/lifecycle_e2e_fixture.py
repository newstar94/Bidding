"""Create and remove an organization isolated to one lifecycle browser run."""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys

import psycopg
from psycopg import sql

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.auth.auth_helper import hash_password


def _database_url() -> str:
    value = str(os.environ.get("DATABASE_URL") or "").strip()
    if not value:
        raise RuntimeError("DATABASE_URL is required")
    return value


def _payload() -> dict:
    return json.loads(sys.stdin.buffer.read().decode("utf-8"))


def _setup(data: dict) -> dict:
    run_id = str(data["runId"])
    organization_id = str(data["organizationId"])
    account = data["account"]
    membership_role = str(data.get("membershipRole", "manager"))
    if membership_role not in {"manager", "employee"}:
        raise ValueError("Unsupported fixture membership role")
    with psycopg.connect(_database_url()) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (%s, %s)",
                (organization_id, f"Lifecycle E2E {run_id}"),
            )
            cursor.execute(
                """INSERT INTO tai_khoan (
                       id, ten_dang_nhap, username_norm, mat_khau, ho_ten,
                       vai_tro, email, email_norm, da_xac_minh, username_da_dat
                   ) VALUES (%s, %s, %s, %s, %s, 'user', %s, %s, 1, 1)""",
                (
                    account["id"], account["username"], account["username"].lower(),
                    hash_password(str(data["password"])), account["name"],
                    account["email"], account["email"].lower(),
                ),
            )
            cursor.execute(
                """INSERT INTO thanh_vien_to_chuc (
                       user_id, organization_id, vai_tro_trong_to_chuc,
                       ten_nhan_su, trang_thai_thanh_vien
                   ) VALUES (%s, %s, %s, %s, 'active')""",
                (account["id"], organization_id, membership_role, account["name"]),
            )
            if membership_role == "employee":
                cursor.execute(
                    """INSERT INTO nha_thau (
                           id, organization_id, owner_type, id_goc,
                           ma_nha_thau, ten_nha_thau, sync_version
                       ) VALUES (%s, %s, 'organization', %s, %s, %s, 1)""",
                    (f"{run_id}-contractor", organization_id, f"{run_id}-contractor",
                     f"{run_id}-contractor", f"Nhà thầu mẫu {run_id}"),
                )
                for index in (1, 2):
                    expert_id = f"{run_id}-expert-{index}"
                    cursor.execute(
                        """INSERT INTO chuyen_gia (
                               id, organization_id, owner_type, id_goc, ho_ten,
                               so_chung_chi, so_cccd, sync_version
                           ) VALUES (%s, %s, 'organization', %s, %s, %s, %s, 1)""",
                        (expert_id, organization_id, expert_id,
                         f"Chuyên gia {index} {run_id}", f"CC-{run_id}-{index}",
                         f"07900000000{index}"),
                    )
                cursor.execute(
                    """INSERT INTO chu_dau_tu (
                           id, organization_id, owner_type, id_goc,
                           ma_chu_dau_tu, ten_chu_dau_tu, sync_version
                       ) VALUES (%s, %s, 'organization', %s, %s, %s, 1)""",
                    (f"{run_id}-owner", organization_id, f"{run_id}-owner",
                     f"{run_id}-owner", f"Chủ đầu tư {run_id}"),
                )
                cursor.execute(
                    """INSERT INTO ma_tran_phan_quyen (
                           id, organization_id, owner_type, emp_id,
                           kehoach, goithau, chudautu, nhathau,
                           chuyengia, hopdong, thongtinmothau, sync_version
                       ) VALUES (%s, %s, 'organization', %s,
                                 'view', 'view', 'view', 'view',
                                 'view', 'view', 'view', 1)""",
                    (f"{run_id}-permissions", organization_id, account["id"]),
                )
            if data.get("seedInvestor") and membership_role == "manager":
                cursor.execute(
                    """INSERT INTO chu_dau_tu (
                           id, organization_id, owner_type, id_goc,
                           ma_chu_dau_tu, ten_chu_dau_tu, sync_version
                       ) VALUES (%s, %s, 'organization', %s, %s, %s, 1)""",
                    (f"{run_id}-owner", organization_id, f"{run_id}-owner",
                     f"{run_id}-owner", f"Chủ đầu tư {run_id}"),
                )
            for key, name, color in (
                ("active", "Đang thực hiện", "#2563eb"),
                ("completed", "Đã hoàn thành", "#059669"),
                ("liquidated", "Đã thanh lý", "#64748b"),
            ):
                cursor.execute(
                    """INSERT INTO danh_muc_trang_thai_hop_dong
                           (id, organization_id, owner_type, name, color)
                       VALUES (%s, %s, 'organization', %s, %s)""",
                    (f"{run_id}-contract-status-{key}", organization_id, name, color),
                )
            cursor.execute(
                """INSERT INTO sync_metadata (organization_id, current_version, min_available_version)
                   VALUES (%s, %s, 0)
                   ON CONFLICT (organization_id) DO NOTHING""",
                (organization_id, 1 if membership_role == "employee" or data.get("seedInvestor") else 0),
            )
            cursor.execute("DELETE FROM rate_limit_buckets")
    return {"organizationId": organization_id, "accountId": account["id"]}


def _organization_tables(cursor) -> list[str]:
    rows = cursor.execute(
        """SELECT column_row.table_name
             FROM information_schema.columns AS column_row
             JOIN information_schema.tables AS table_row
               ON table_row.table_schema = column_row.table_schema
              AND table_row.table_name = column_row.table_name
            WHERE column_row.table_schema = 'public'
              AND column_row.column_name = 'organization_id'
              AND table_row.table_type = 'BASE TABLE'
              AND column_row.table_name NOT IN (
                    'to_chuc', 'thanh_vien_to_chuc', 'organization_subscriptions'
                  )
            GROUP BY column_row.table_name"""
    ).fetchall()
    return sorted(str(row[0]) for row in rows)


def _immutable_organization_tables(cursor) -> list[str]:
    """Return tenant tables whose DELETE trigger preserves audit history."""

    rows = cursor.execute(
        """SELECT table_row.relname
             FROM pg_trigger AS trigger_row
             JOIN pg_class AS table_row
               ON table_row.oid = trigger_row.tgrelid
             JOIN pg_namespace AS namespace_row
               ON namespace_row.oid = table_row.relnamespace
             JOIN pg_proc AS function_row
               ON function_row.oid = trigger_row.tgfoid
             JOIN information_schema.columns AS column_row
               ON column_row.table_schema = namespace_row.nspname
              AND column_row.table_name = table_row.relname
            WHERE namespace_row.nspname = 'public'
              AND NOT trigger_row.tgisinternal
              AND function_row.proname = 'bf_forbid_audit_mutation'
              AND (trigger_row.tgtype & 8) <> 0
              AND column_row.column_name = 'organization_id'
            GROUP BY table_row.relname"""
    ).fetchall()
    return sorted(str(row[0]) for row in rows)


def _organization_row_count(cursor, table_name: str, organization_id: str) -> int:
    row = cursor.execute(
        sql.SQL("SELECT COUNT(*) FROM {} WHERE organization_id = %s").format(
            sql.Identifier(table_name)
        ),
        (organization_id,),
    ).fetchone()
    return int(row[0]) if row else 0


def _cleanup(data: dict) -> dict:
    organization_id = str(data["organizationId"])
    account_id = str(data["account"]["id"])
    deleted_rows = 0
    with psycopg.connect(_database_url()) as connection:
        with connection.cursor() as cursor:
            immutable_tables = _immutable_organization_tables(cursor)
            preserved_immutable_rows = {
                table_name: row_count
                for table_name in immutable_tables
                if (
                    row_count := _organization_row_count(
                        cursor, table_name, organization_id
                    )
                )
            }
            pending = [
                table_name
                for table_name in _organization_tables(cursor)
                if table_name not in immutable_tables
            ]
            while pending:
                deferred: list[str] = []
                progress = False
                for table_name in pending:
                    cursor.execute("SAVEPOINT lifecycle_cleanup_table")
                    try:
                        cursor.execute(
                            sql.SQL("DELETE FROM {} WHERE organization_id = %s").format(
                                sql.Identifier(table_name)
                            ),
                            (organization_id,),
                        )
                    except psycopg.Error as error:
                        cursor.execute("ROLLBACK TO SAVEPOINT lifecycle_cleanup_table")
                        if isinstance(error, psycopg.errors.ForeignKeyViolation):
                            deferred.append(table_name)
                        else:
                            raise
                    else:
                        deleted_rows += max(cursor.rowcount, 0)
                        progress = True
                    finally:
                        cursor.execute("RELEASE SAVEPOINT lifecycle_cleanup_table")
                if deferred and not progress:
                    raise RuntimeError(
                        f"Organization cleanup could not resolve dependencies: {deferred}"
                    )
                pending = deferred
            cursor.execute(
                "DELETE FROM organization_subscriptions WHERE organization_id = %s",
                (organization_id,),
            )
            deleted_rows += max(cursor.rowcount, 0)
            cursor.execute(
                "DELETE FROM thanh_vien_to_chuc WHERE organization_id = %s",
                (organization_id,),
            )
            deleted_rows += max(cursor.rowcount, 0)
            cursor.execute("DELETE FROM to_chuc WHERE id = %s", (organization_id,))
            deleted_organizations = cursor.rowcount
            cursor.execute("DELETE FROM tai_khoan WHERE id = %s", (account_id,))
            deleted_accounts = cursor.rowcount
    return {
        "deletedOrganizations": deleted_organizations,
        "deletedAccounts": deleted_accounts,
        "deletedRows": deleted_rows,
        "preservedAuditRows": preserved_immutable_rows.get("audit_log", 0),
        "preservedImmutableRows": sum(preserved_immutable_rows.values()),
        "preservedImmutableRowsByTable": preserved_immutable_rows,
    }


def _verify_assignments(data: dict) -> dict:
    with psycopg.connect(_database_url()) as connection:
        rows = connection.execute(
            """SELECT loai_doi_tuong, id_muc_tieu, id_nhan_vien
                 FROM phan_cong_nhan_su WHERE organization_id = %s
                 ORDER BY loai_doi_tuong, id_muc_tieu, id_nhan_vien""",
            (str(data["organizationId"]),),
        ).fetchall()
    return {"assignments": [
        {"type": row[0], "targetId": row[1], "empId": row[2]} for row in rows
    ]}


def main() -> None:
    actions = {"setup": _setup, "cleanup": _cleanup, "verify_assignments": _verify_assignments}
    if len(sys.argv) != 2 or sys.argv[1] not in actions:
        raise SystemExit("Usage: lifecycle_e2e_fixture.py setup|cleanup|verify_assignments")
    data = _payload()
    result = actions[sys.argv[1]](data)
    sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False).encode("utf-8"))


if __name__ == "__main__":
    main()
