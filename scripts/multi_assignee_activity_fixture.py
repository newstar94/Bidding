"""PostgreSQL fixtures and assertions for the multi-assignee browser scenario."""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.auth.auth_helper import hash_password


def _payload():
    return json.loads(sys.stdin.buffer.read().decode("utf-8"))


def _database_url():
    value = str(os.environ.get("DATABASE_URL") or "").strip()
    if not value:
        raise RuntimeError("DATABASE_URL is required")
    return value


def _insert_account(cursor, account, password):
    cursor.execute(
        """INSERT INTO tai_khoan (
               id, ten_dang_nhap, username_norm, mat_khau, ho_ten,
               vai_tro, email, email_norm, da_xac_minh, username_da_dat
           ) VALUES (%s, %s, %s, %s, %s, 'user', %s, %s, 1, 1)""",
        (
            account["id"], account["username"], account["username"],
            hash_password(password), account["name"],
            account["email"], account["email"],
        ),
    )


def setup(data):
    run_id = data["runId"]
    organization_id = data["organizationId"]
    outsider_org_id = data["outsiderOrganizationId"]
    owner_id = f"{run_id}-owner"
    contractor_id = f"{run_id}-contractor"
    plan_id = f"{run_id}-plan"
    with psycopg.connect(_database_url()) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (%s, %s), (%s, %s)",
                (organization_id, f"Multi {run_id}", outsider_org_id, f"Outsider {run_id}"),
            )
            cursor.execute(
                """INSERT INTO danh_muc_trang_thai_hop_dong
                       (id, organization_id, owner_type, name, color)
                   VALUES (%s, %s, 'organization', 'Đang thực hiện', '#2563eb')""",
                (f"{run_id}-status", organization_id),
            )
            for account in [data["manager"], *data["employees"], data["outsider"]]:
                _insert_account(cursor, account, data["password"])
            cursor.execute(
                """INSERT INTO thanh_vien_to_chuc (
                       user_id, organization_id, vai_tro_trong_to_chuc,
                       ten_nhan_su, trang_thai_thanh_vien
                   ) VALUES (%s, %s, 'manager', %s, 'active')""",
                (data["manager"]["id"], organization_id, data["manager"]["name"]),
            )
            for employee in data["employees"]:
                cursor.execute(
                    """INSERT INTO thanh_vien_to_chuc (
                           user_id, organization_id, vai_tro_trong_to_chuc,
                           ten_nhan_su, trang_thai_thanh_vien
                       ) VALUES (%s, %s, 'employee', %s, 'active')""",
                    (employee["id"], organization_id, employee["name"]),
                )
                cursor.execute(
                    """INSERT INTO ma_tran_phan_quyen (
                           id, organization_id, owner_type, emp_id,
                           kehoach, goithau, hopdong, chudautu, nhathau, chuyengia
                       ) VALUES (%s, %s, 'organization', %s,
                                 'view', 'edit', 'edit', 'view', 'view', 'view')""",
                    (f"{run_id}-permission-{employee['id']}", organization_id, employee["id"]),
                )
            cursor.execute(
                """INSERT INTO thanh_vien_to_chuc (
                       user_id, organization_id, vai_tro_trong_to_chuc,
                       ten_nhan_su, trang_thai_thanh_vien
                   ) VALUES (%s, %s, 'manager', %s, 'active')""",
                (data["outsider"]["id"], outsider_org_id, data["outsider"]["name"]),
            )
            cursor.execute(
                """INSERT INTO chu_dau_tu (
                       id, organization_id, owner_type, id_goc,
                       ma_chu_dau_tu, ma_so_thue, ten_chu_dau_tu, sync_version
                   ) VALUES (%s, %s, 'organization', %s, %s, '0100000303', %s, 1)""",
                (owner_id, organization_id, owner_id, f"{run_id}-CDT", f"Chủ đầu tư {run_id}"),
            )
            cursor.execute(
                """INSERT INTO nha_thau (
                       id, organization_id, owner_type, id_goc,
                       ma_nha_thau, ten_nha_thau, sync_version
                   ) VALUES (%s, %s, 'organization', %s, %s, %s, 1)""",
                (contractor_id, organization_id, contractor_id, f"{run_id}-NT", f"Nhà thầu {run_id}"),
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
                """INSERT INTO phan_cong_nhan_su (
                       id, organization_id, owner_type, id_nhan_vien,
                       id_muc_tieu, loai_doi_tuong
                   ) VALUES (%s, %s, 'organization', %s, %s, 'kehoach')""",
                (f"{run_id}-plan-assignment", organization_id, data["manager"]["id"], plan_id),
            )
            for index in range(2):
                expert_id = f"{run_id}-expert-{index}"
                cursor.execute(
                    """INSERT INTO chuyen_gia (
                           id, organization_id, owner_type, id_goc,
                           ho_ten, so_chung_chi, so_cccd, sync_version
                       ) VALUES (%s, %s, 'organization', %s, %s, %s, %s, 1)""",
                    (expert_id, organization_id, expert_id, f"Chuyên gia {index} {run_id}", f"CC-{run_id}-{index}", f"07900000000{index}"),
                )
            for org_id in (organization_id, outsider_org_id):
                cursor.execute(
                    """INSERT INTO sync_metadata (organization_id, current_version, min_available_version)
                       VALUES (%s, 1, 0)
                       ON CONFLICT (organization_id) DO UPDATE
                       SET current_version = 1, min_available_version = 0""",
                    (org_id,),
                )
            cursor.execute("DELETE FROM rate_limit_buckets")
    return {"ownerId": owner_id, "contractorId": contractor_id, "planId": plan_id}


def verify(data):
    with psycopg.connect(_database_url()) as connection:
        with connection.cursor() as cursor:
            package = cursor.execute(
                """SELECT id, row_version, ten_goi_thau
                   FROM goi_thau WHERE organization_id = %s AND id = %s""",
                (data["organizationId"], f"{data['runId']}-package"),
            ).fetchone()
            contract = cursor.execute(
                """SELECT id, row_version, ten_hop_dong
                   FROM hop_dong
                   WHERE organization_id = %s AND id = %s AND is_latest = 1""",
                (data["organizationId"], f"{data['runId']}-contract"),
            ).fetchone()
            if not package:
                diagnostic = cursor.execute(
                    """SELECT id, organization_id, ma_goi_thau
                       FROM goi_thau
                       WHERE id = %s OR ma_goi_thau = %s""",
                    (f"{data['runId']}-package", data["packageCode"]),
                ).fetchall()
                raise RuntimeError(
                    "Package was not persisted in the expected organization: "
                    + json.dumps(diagnostic, ensure_ascii=False)
                )
            result = {
                "packageId": package[0],
                "packageRowVersion": package[1],
                "packageName": package[2],
                "contractId": contract[0] if contract else None,
                "contractRowVersion": contract[1] if contract else None,
                "contractName": contract[2] if contract else None,
                "contractAssignments": [],
                "versionAssignments": [],
            }
            targets = [("packageAssignments", package[0], "goithau")]
            if contract:
                targets.append(("contractAssignments", contract[0], "hopdong"))
            for key, target_id, target_type in targets:
                result[key] = [
                    {"id": row[0], "userId": row[1], "rowVersion": row[2]}
                    for row in cursor.execute(
                        """SELECT id, id_nhan_vien, row_version
                           FROM phan_cong_nhan_su
                           WHERE organization_id = %s AND id_muc_tieu = %s
                             AND loai_doi_tuong = %s
                           ORDER BY id_nhan_vien""",
                        (data["organizationId"], target_id, target_type),
                    ).fetchall()
                ]
            version_id = f"{data['runId']}-package-v2"
            result["versionAssignments"] = [
                {"id": row[0], "userId": row[1], "rowVersion": row[2]}
                for row in cursor.execute(
                    """SELECT id, id_nhan_vien, row_version
                       FROM phan_cong_nhan_su
                       WHERE organization_id = %s AND id_muc_tieu = %s
                         AND loai_doi_tuong = 'goithau'
                       ORDER BY id_nhan_vien""",
                    (data["organizationId"], version_id),
                ).fetchall()
            ]
            root_ids = [package[0], *([contract[0]] if contract else [])]
            result["activityActions"] = [
                row[0] for row in cursor.execute(
                    """SELECT action FROM nhat_ky_thuc_hien
                       WHERE organization_id = %s
                         AND target_root_id = ANY(%s)
                       ORDER BY occurred_at, id""",
                    (data["organizationId"], root_ids),
                ).fetchall()
            ]
            result["activityEvents"] = [
                {
                    "action": str(row[0]),
                    "actorUserId": str(row[1]) if row[1] is not None else None,
                    "metadata": json.loads(row[2] or "{}"),
                }
                for row in cursor.execute(
                    """SELECT action, actor_user_id, metadata_json
                       FROM nhat_ky_thuc_hien
                       WHERE organization_id = %s
                         AND target_root_id = ANY(%s)
                       ORDER BY occurred_at, id""",
                    (data["organizationId"], root_ids),
                ).fetchall()
            ]
            result["documentCount"] = cursor.execute(
                """SELECT count(*) FROM tai_lieu_goi_thau
                   WHERE organization_id = %s AND goi_thau_id = %s""",
                (data["organizationId"], package[0]),
            ).fetchone()[0]
            result["notificationKinds"] = [
                (row[0], row[1]) for row in cursor.execute(
                    """SELECT user_id, kind FROM user_notifications
                       WHERE organization_id = %s
                       ORDER BY user_id, kind""",
                    (data["organizationId"],),
                ).fetchall()
            ]
            result["employeeStatuses"] = {
                str(row[0]): str(row[1])
                for row in cursor.execute(
                    """SELECT user_id, trang_thai_thanh_vien
                       FROM thanh_vien_to_chuc
                       WHERE organization_id = %s
                         AND user_id = ANY(%s)""",
                    (
                        data["organizationId"],
                        [employee["id"] for employee in data["employees"]],
                    ),
                ).fetchall()
            }
            result["removalHistory"] = [
                {
                    "userId": str(row[0]),
                    "targetId": str(row[1]),
                    "targetType": str(row[2]),
                    "successorUserId": str(row[3]) if row[3] is not None else None,
                }
                for row in cursor.execute(
                    """SELECT id_nhan_vien, id_muc_tieu, loai_doi_tuong,
                              successor_user_id
                       FROM phan_cong_nhan_su_lich_su
                       WHERE organization_id = %s
                       ORDER BY id""",
                    (data["organizationId"],),
                ).fetchall()
            ]
            return result


def cleanup(data):
    organization_ids = [data["organizationId"], data["outsiderOrganizationId"]]
    account_ids = [data["manager"]["id"], *[item["id"] for item in data["employees"]], data["outsider"]["id"]]
    with psycopg.connect(_database_url()) as connection:
        with connection.cursor() as cursor:
            for table in (
                "hop_dong_goi_thau", "goi_thau_chuyen_gia", "goi_thau_phan_lo",
                "phan_cong_nhan_su_lich_su", "phan_cong_nhan_su", "hop_dong",
                "goi_thau", "nha_thau", "chuyen_gia", "ke_hoach_lcnt",
                "chu_dau_tu", "ma_tran_phan_quyen", "record_edit_ownership",
                "sync_mutations", "deleted_records", "danh_muc_trang_thai_hop_dong",
            ):
                cursor.execute(f"DELETE FROM {table} WHERE organization_id = ANY(%s)", (organization_ids,))
            cursor.execute("DELETE FROM sync_metadata WHERE organization_id = ANY(%s)", (organization_ids,))
            cursor.execute("DELETE FROM to_chuc WHERE id = ANY(%s)", (organization_ids,))
            cursor.execute("DELETE FROM tai_khoan WHERE id = ANY(%s)", (account_ids,))
    return {"cleaned": True, "activityRetained": True}


def main():
    action = sys.argv[1]
    data = _payload()
    result = {"setup": setup, "verify": verify, "cleanup": cleanup}[action](data)
    sys.stdout.buffer.write(
        (json.dumps(result, ensure_ascii=False) + "\n").encode("utf-8")
    )


if __name__ == "__main__":
    main()
