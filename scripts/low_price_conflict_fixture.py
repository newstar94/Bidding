"""Seed, inspect, and remove the isolated LP-25 concurrency fixture."""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.auth.auth_helper import hash_password


ORGANIZATION_CLEANUP_TABLES = (
    "websocket_events",
    "nhat_ky_thuc_hien",
    "record_edit_ownership",
    "sync_mutations",
    "ket_qua_danh_gia_nha_thau",
    "thong_tin_mo_thau_lien_danh_thanh_vien",
    "thong_tin_mo_thau",
    "goi_thau",
    "nha_thau",
    "ke_hoach_lcnt",
    "chu_dau_tu",
    "sync_metadata",
    "deleted_records",
)
DEFAULT_LP25_DATABASE_ALLOWLIST = frozenset({
    "biddingflow_test",
    "biddingflow_ci_test",
    "biddingflow_ci_unit_test",
    "biddingflow_ci_api_test",
})


def _database_url() -> str:
    if str(os.environ.get("APP_ENV") or "").strip().casefold() != "test":
        raise RuntimeError("LP-25 fixture requires APP_ENV=test")
    value = str(os.environ.get("DATABASE_URL") or "").strip()
    if not value:
        raise RuntimeError("DATABASE_URL is required")
    database_name = str(conninfo_to_dict(value).get("dbname") or "").strip()
    configured_allowlist = {
        item.strip()
        for item in str(os.environ.get("LP25_DATABASE_ALLOWLIST") or "").split(",")
        if item.strip()
    }
    allowed_names = DEFAULT_LP25_DATABASE_ALLOWLIST | configured_allowlist
    if not database_name or database_name not in allowed_names:
        raise RuntimeError(
            "LP-25 fixture database is outside the allowlist: "
            f"{database_name or '<missing>'}"
        )
    return value


def _payload() -> dict:
    return json.loads(sys.stdin.buffer.read().decode("utf-8"))


def _setup(data: dict) -> dict:
    run_id = str(data["runId"])
    organization_id = str(data["organizationId"])
    password_hash = hash_password(str(data["password"]))
    owner_id = f"{run_id}-owner"
    plan_id = f"{run_id}-plan"
    package_id = f"{run_id}-package"
    contractor_id = f"{run_id}-contractor"
    opening_id = f"{run_id}-opening"
    with psycopg.connect(_database_url()) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (%s, %s)",
                (organization_id, f"LP conflict {run_id}"),
            )
            for account in data["accounts"]:
                cursor.execute(
                    """INSERT INTO tai_khoan (
                           id, ten_dang_nhap, username_norm, mat_khau, ho_ten,
                           vai_tro, email, email_norm, da_xac_minh, username_da_dat
                       ) VALUES (%s, %s, %s, %s, %s, 'user', %s, %s, 1, 1)""",
                    (
                        account["id"], account["username"], account["username"],
                        password_hash, account["name"], account["email"], account["email"],
                    ),
                )
                cursor.execute(
                    """INSERT INTO thanh_vien_to_chuc (
                           user_id, organization_id, vai_tro_trong_to_chuc,
                           ten_nhan_su, trang_thai_thanh_vien
                       ) VALUES (%s, %s, 'manager', %s, 'active')""",
                    (account["id"], organization_id, account["name"]),
                )
            cursor.execute(
                """INSERT INTO chu_dau_tu (
                       id, organization_id, owner_type, id_goc,
                       ma_chu_dau_tu, ma_so_thue, ten_chu_dau_tu, sync_version
                   ) VALUES (%s, %s, 'organization', %s, %s, '0100000101', %s, 1)""",
                (owner_id, organization_id, owner_id, f"{run_id}-CDT", f"Chủ đầu tư {run_id}"),
            )
            cursor.execute(
                """INSERT INTO ke_hoach_lcnt (
                       id, organization_id, owner_type, id_goc, ma_ke_hoach,
                       ten_ke_hoach, ten_du_an_du_toan, loai_hinh_mua_sam,
                       chu_dau_tu_id, ngay_phe_duyet, quyet_dinh_phe_duyet, sync_version
                   ) VALUES (%s, %s, 'organization', %s, %s, %s, %s,
                             'Mua sắm hàng hóa', %s, '2026-07-01', %s, 1)""",
                (
                    plan_id, organization_id, plan_id, f"{run_id}-KH",
                    f"Kế hoạch {run_id}", f"Dự toán {run_id}", owner_id, f"{run_id}/QD-KH",
                ),
            )
            cursor.execute(
                """INSERT INTO nha_thau (
                       id, organization_id, owner_type, id_goc,
                       ma_nha_thau, ten_nha_thau, ma_so_thue, loai_nha_thau, sync_version
                   ) VALUES (%s, %s, 'organization', %s, %s, %s, '0100000202', 'Độc lập', 1)""",
                (contractor_id, organization_id, contractor_id, f"{run_id}-NT", f"Nhà thầu {run_id}"),
            )
            cursor.execute(
                """INSERT INTO goi_thau (
                       id, organization_id, owner_type, id_goc, ma_goi_thau,
                       ke_hoach_id, ten_goi_thau, gia_goi_thau, linh_vuc,
                       hinh_thuc_lua_chon, phuong_thuc_lua_chon, phuong_phap_danh_gia,
                       thoi_gian_thuc_hien, nguon_von, thoi_gian_to_chuc,
                       thoi_gian_bat_dau_to_chuc, phan_lo, trang_thai, sync_version
                   ) VALUES (%s, %s, 'organization', %s, %s, %s, %s, 1000000,
                             'Hàng hóa', 'Đấu thầu rộng rãi',
                             'Một giai đoạn một túi hồ sơ', 'Giá thấp nhất',
                             '90 ngày', 'Ngân sách', '30 ngày', 'Quý III/2026',
                             'Không', 'OPENED', 1)""",
                (package_id, organization_id, package_id, f"{run_id}-GT", plan_id, f"Gói {run_id}"),
            )
            cursor.execute(
                """INSERT INTO thong_tin_mo_thau (
                       id, organization_id, owner_type, goi_thau_id, nha_thau_id,
                       ma_phan_lo, ma_dinh_danh, gia_du_thau, ty_le_giam_gia,
                       gia_sau_giam_gia, hieu_luc_hsdt, gia_tri_dam_bao,
                       hieu_luc_bao_dam_ngay, thoi_gian_thuc_hien,
                       ten_nha_thau, loai_nha_thau, sync_version
                   ) VALUES (%s, %s, 'organization', %s, %s, '', %s, 400000, 0,
                             400000, 90, 10000, 120, '90 ngày', %s, 'Độc lập', 1)""",
                (opening_id, organization_id, package_id, contractor_id, f"{run_id}-NT", f"Nhà thầu {run_id}"),
            )
            cursor.execute(
                """INSERT INTO ket_qua_danh_gia_nha_thau (
                       id, organization_id, owner_type, goi_thau_id,
                       thong_tin_mo_thau_id, danh_gia_hop_le, danh_gia_nang_luc,
                       danh_gia_ky_thuat, danh_gia_tai_chinh, gia_xep_hang,
                       gia_de_nghi_trung_thau, chap_thuan_gia_de_nghi_trung_thau_duoi_50,
                       danh_gia_ket_luan, sync_version
                   ) VALUES (%s, %s, 'organization', %s, %s, 'Đạt', 'Đạt', 'Đạt',
                             'Xếp hạng 1', 400000, 400000, NULL, 'Đạt', 1)""",
                (f"{opening_id}-result", organization_id, package_id, opening_id),
            )
            cursor.execute(
                """INSERT INTO sync_metadata (organization_id, current_version, min_available_version)
                   VALUES (%s, 1, 0)
                   ON CONFLICT (organization_id) DO UPDATE SET current_version = 1, min_available_version = 0""",
                (organization_id,),
            )
            cursor.execute("DELETE FROM rate_limit_buckets")
    return {
        "openingId": opening_id,
        "packageId": package_id,
        "packageCode": f"{run_id}-GT",
    }


def _verify(data: dict) -> dict:
    with psycopg.connect(_database_url()) as connection:
        with connection.cursor() as cursor:
            row = cursor.execute(
                """SELECT result.chap_thuan_gia_de_nghi_trung_thau_duoi_50,
                          opening.row_version
                     FROM thong_tin_mo_thau AS opening
                     JOIN ket_qua_danh_gia_nha_thau AS result
                       ON result.organization_id = opening.organization_id
                      AND result.thong_tin_mo_thau_id = opening.id
                    WHERE opening.organization_id = %s AND opening.id = %s""",
                (data["organizationId"], data["openingId"]),
            ).fetchone()
            if not row:
                raise AssertionError("LP-25 opening/result was not found")
            return {
                "decision": None if row[0] is None else bool(row[0]),
                "rowVersion": int(row[1]),
            }


def _cleanup(data: dict) -> dict:
    organization_id = str(data["organizationId"])
    account_ids = [str(account["id"]) for account in data["accounts"]]
    with psycopg.connect(_database_url()) as connection:
        with connection.cursor() as cursor:
            deleted_rows = 0
            for table_name in ORGANIZATION_CLEANUP_TABLES:
                cursor.execute(
                    sql.SQL("DELETE FROM {} WHERE organization_id = %s").format(
                        sql.Identifier(table_name)
                    ),
                    (organization_id,),
                )
                deleted_rows += cursor.rowcount
            cursor.execute(
                """DELETE FROM websocket_connection_leases
                    WHERE organization_id = %s OR user_id = ANY(%s)""",
                (organization_id, account_ids),
            )
            deleted_rows += cursor.rowcount
            cursor.execute(
                "DELETE FROM auth_sessions WHERE user_id = ANY(%s)",
                (account_ids,),
            )
            deleted_rows += cursor.rowcount
            cursor.execute(
                "DELETE FROM thanh_vien_to_chuc WHERE organization_id = %s",
                (organization_id,),
            )
            deleted_rows += cursor.rowcount
            cursor.execute("DELETE FROM to_chuc WHERE id = %s", (organization_id,))
            deleted_orgs = cursor.rowcount
            cursor.execute("DELETE FROM tai_khoan WHERE id = ANY(%s)", (account_ids,))
            deleted_accounts = cursor.rowcount

            residue = {}
            for table_name in ORGANIZATION_CLEANUP_TABLES:
                residue[table_name] = cursor.execute(
                    sql.SQL("SELECT count(*) FROM {} WHERE organization_id = %s").format(
                        sql.Identifier(table_name)
                    ),
                    (organization_id,),
                ).fetchone()[0]
            residue.update({
                "websocket_connection_leases": cursor.execute(
                    """SELECT count(*) FROM websocket_connection_leases
                        WHERE organization_id = %s OR user_id = ANY(%s)""",
                    (organization_id, account_ids),
                ).fetchone()[0],
                "auth_sessions": cursor.execute(
                    "SELECT count(*) FROM auth_sessions WHERE user_id = ANY(%s)",
                    (account_ids,),
                ).fetchone()[0],
                "thanh_vien_to_chuc": cursor.execute(
                    """SELECT count(*) FROM thanh_vien_to_chuc
                        WHERE organization_id = %s OR user_id = ANY(%s)""",
                    (organization_id, account_ids),
                ).fetchone()[0],
                "to_chuc": cursor.execute(
                    "SELECT count(*) FROM to_chuc WHERE id = %s",
                    (organization_id,),
                ).fetchone()[0],
                "tai_khoan": cursor.execute(
                    "SELECT count(*) FROM tai_khoan WHERE id = ANY(%s)",
                    (account_ids,),
                ).fetchone()[0],
            })
            remaining_rows = sum(int(count) for count in residue.values())
            if remaining_rows:
                raise AssertionError(
                    "LP-25 fixture cleanup left rows: "
                    + json.dumps(residue, sort_keys=True)
                )
            retained_audit_rows = cursor.execute(
                "SELECT count(*) FROM audit_log WHERE organization_id = %s",
                (organization_id,),
            ).fetchone()[0]
    return {
        "deletedOrganizations": deleted_orgs,
        "deletedAccounts": deleted_accounts,
        "deletedRows": deleted_rows + deleted_orgs + deleted_accounts,
        "remainingRows": 0,
        "retainedAuditRows": int(retained_audit_rows),
    }


def main() -> None:
    if len(sys.argv) != 2:
        raise RuntimeError("Expected one action: setup, verify, cleanup")
    data = _payload()
    action = sys.argv[1]
    if action == "setup":
        result = _setup(data)
    elif action == "verify":
        result = _verify(data)
    elif action == "cleanup":
        result = _cleanup(data)
    else:
        raise RuntimeError(f"Unknown action: {action}")
    sys.stdout.write(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
