"""Seed, verify, and remove isolated package pairwise browser fixtures."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import sys

import psycopg

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
    owner_id = f"{run_id}-owner"
    plan_id = f"{run_id}-plan"
    with psycopg.connect(_database_url()) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (%s, %s)",
                (organization_id, f"Pairwise {run_id}"),
            )
            cursor.execute(
                """INSERT INTO danh_muc_trang_thai_hop_dong
                       (id, organization_id, owner_type, name, color)
                   VALUES (%s, %s, 'organization', 'Đang thực hiện', '#2563eb')""",
                (f"{run_id}-contract-status-active", organization_id),
            )
            cursor.execute(
                """INSERT INTO tai_khoan (
                       id, ten_dang_nhap, username_norm, mat_khau, ho_ten,
                       vai_tro, email, email_norm, da_xac_minh, username_da_dat
                   ) VALUES (%s, %s, %s, %s, %s, 'user', %s, %s, 1, 1)""",
                (
                    account["id"], account["username"], account["username"],
                    hash_password(data["password"]), account["name"],
                    account["email"], account["email"],
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
                   ) VALUES (%s, %s, 'organization', %s, %s, '0100000303', %s, 1)""",
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
                """INSERT INTO phan_cong_nhan_su (
                       id, organization_id, owner_type, id_nhan_vien,
                       id_muc_tieu, loai_doi_tuong
                   ) VALUES (%s, %s, 'organization', %s, %s, 'kehoach')""",
                (f"{run_id}-plan-assignment", organization_id, account["id"], plan_id),
            )
            for index in range(1, 3):
                expert_id = f"{run_id}-expert-{index}"
                cursor.execute(
                    """INSERT INTO chuyen_gia (
                           id, organization_id, owner_type, id_goc,
                           ho_ten, so_chung_chi, so_cccd, sync_version
                       ) VALUES (%s, %s, 'organization', %s, %s, %s, %s, 1)""",
                    (
                        expert_id, organization_id, expert_id,
                        f"Chuyên gia {index} {run_id}", f"CC-{run_id}-{index}", f"07900000000{index}",
                    ),
                )
            cursor.execute(
                """INSERT INTO sync_metadata (organization_id, current_version, min_available_version)
                   VALUES (%s, 1, 0)
                   ON CONFLICT (organization_id) DO UPDATE SET current_version = 1, min_available_version = 0""",
                (organization_id,),
            )
            cursor.execute("DELETE FROM rate_limit_buckets")
    return {"ownerId": owner_id, "planId": plan_id}


def _verify(data: dict) -> dict:
    run_id = str(data["runId"])
    with psycopg.connect(_database_url()) as connection:
        with connection.cursor() as cursor:
            rows = cursor.execute(
                """SELECT package.ma_goi_thau, package.ten_goi_thau, package.linh_vuc,
                          package.hinh_thuc_lua_chon, package.phuong_thuc_lua_chon,
                          COALESCE(package.phuong_phap_danh_gia, ''), package.phan_lo,
                          count(lot.id), package.row_version
                     FROM goi_thau AS package
                     LEFT JOIN goi_thau_phan_lo AS lot
                       ON lot.organization_id = package.organization_id
                      AND lot.goi_thau_id = package.id
                      AND lot.archived_at IS NULL
                    WHERE package.organization_id = %s
                      AND package.ten_goi_thau LIKE %s
                      AND package.archived_at IS NULL
                    GROUP BY package.id, package.ma_goi_thau, package.ten_goi_thau, package.linh_vuc,
                             package.hinh_thuc_lua_chon, package.phuong_thuc_lua_chon,
                             package.phuong_phap_danh_gia, package.phan_lo, package.row_version
                    ORDER BY package.ma_goi_thau""",
                (data["organizationId"], f"Pairwise %{run_id}"),
            ).fetchall()
            return {
                "count": len(rows),
                "packages": [
                    {
                        "code": row[0], "title": row[1], "field": row[2], "form": row[3],
                        "procedure": row[4], "method": row[5], "lot": row[6],
                        "lotCount": int(row[7]), "rowVersion": int(row[8]),
                    }
                    for row in rows
                ],
            }


def _verify_crud_absent(data: dict) -> dict:
    organization_id = str(data["organizationId"])
    codes = data["crudCodes"]
    checks = (
        ("chu_dau_tu", "ma_chu_dau_tu", codes["investor"]),
        ("nha_thau", "ma_nha_thau", codes["contractor"]),
        ("chuyen_gia", "ho_ten", codes["expert"]),
        ("ke_hoach_lcnt", "ma_ke_hoach", codes["plan"]),
        ("goi_thau", "ma_goi_thau", codes["package"]),
        ("hop_dong", "so_hop_dong", codes["contract"]),
    )
    counts = {}
    with psycopg.connect(_database_url()) as connection:
        with connection.cursor() as cursor:
            for table_name, column_name, expected in checks:
                total_count, active_count = cursor.execute(
                    f"""SELECT count(*),
                               count(*) FILTER (
                                   WHERE COALESCE(is_latest, 1) = 1
                                     AND archived_at IS NULL
                               )
                          FROM {table_name}
                         WHERE organization_id = %s
                           AND lower({column_name}) = lower(%s)""",
                    (organization_id, expected),
                ).fetchone()
                counts[table_name] = {
                    "active": int(active_count),
                    "history": int(total_count) - int(active_count),
                }
    if any(item["active"] for item in counts.values()):
        raise AssertionError(f"CRUD records remain in PostgreSQL: {counts}")
    return counts


def _create_document_fixtures(data: dict) -> dict:
    output_dir = Path(str(data["documentFixtureDirectory"])).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = output_dir / "tai-lieu-thau-hop-le.pdf"
    invalid_path = output_dir / "tai-lieu-khong-hop-le.txt"
    objects = (
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>",
        b"<< /Length 0 >>\nstream\n\nendstream",
    )
    content = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for index, body in enumerate(objects, start=1):
        offsets.append(len(content))
        content.extend(f"{index} 0 obj\n".encode("ascii"))
        content.extend(body)
        content.extend(b"\nendobj\n")
    xref_offset = len(content)
    content.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    content.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        content.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    content.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n".encode("ascii")
    )
    pdf_path.write_bytes(content)
    invalid_path.write_text("not an allowed package document", encoding="utf-8")
    return {
        "pdfPath": str(pdf_path),
        "invalidPath": str(invalid_path),
        "pdfSize": pdf_path.stat().st_size,
    }


def _seed_catalog_pagination(data: dict) -> dict:
    run_id = str(data["runId"])
    organization_id = str(data["organizationId"])
    with psycopg.connect(_database_url()) as connection:
        with connection.cursor() as cursor:
            for index in range(1, 16):
                expert_id = f"{run_id}-pagination-expert-{index}"
                cursor.execute(
                    """INSERT INTO chuyen_gia (
                           id, organization_id, owner_type, id_goc,
                           ho_ten, so_chung_chi, so_cccd, sync_version
                       ) VALUES (%s, %s, 'organization', %s, %s, %s, %s, 1)""",
                    (
                        expert_id,
                        organization_id,
                        expert_id,
                        f"Phân trang {run_id} {index:02d}",
                        f"PAG-{run_id}-{index:02d}",
                        f"078{index:09d}",
                    ),
                )
    return {"inserted": 15, "search": f"Phân trang {run_id}"}


def _cleanup(data: dict) -> dict:
    organization_id = str(data["organizationId"])
    owner_ids = [organization_id, str(data["account"]["id"])]
    with psycopg.connect(_database_url()) as connection:
        with connection.cursor() as cursor:
            for table_name in (
                "hop_dong_goi_thau",
                "goi_thau_moc_tien_do",
                "goi_thau_chuyen_gia",
                "goi_thau_hang_hoa",
                "goi_thau_phan_lo",
                "phan_cong_nhan_su",
                "hop_dong",
                "goi_thau",
                "nha_thau_lien_danh_thanh_vien",
                "nha_thau",
                "chuyen_gia",
                "ke_hoach_lcnt",
                "chu_dau_tu",
                "record_edit_ownership",
                "sync_mutations",
                "deleted_records",
            ):
                cursor.execute(f"DELETE FROM {table_name} WHERE organization_id = ANY(%s)", (owner_ids,))
            cursor.execute("DELETE FROM sync_metadata WHERE organization_id = ANY(%s)", (owner_ids,))
            cursor.execute("DELETE FROM danh_muc_trang_thai_hop_dong WHERE organization_id = %s", (organization_id,))
            cursor.execute("DELETE FROM to_chuc WHERE id = %s", (organization_id,))
            deleted_orgs = cursor.rowcount
            cursor.execute("DELETE FROM tai_khoan WHERE id = %s", (data["account"]["id"],))
            deleted_accounts = cursor.rowcount
    fixture_directory = str(data.get("documentFixtureDirectory") or "").strip()
    if fixture_directory:
        shutil.rmtree(fixture_directory, ignore_errors=True)
    return {"deletedOrganizations": deleted_orgs, "deletedAccounts": deleted_accounts}


def main() -> None:
    if len(sys.argv) != 2:
        raise RuntimeError("Expected setup, verify, verify_crud_absent, seed_catalog_pagination, create_document_fixtures, or cleanup")
    data = _payload()
    action = sys.argv[1]
    result = {
        "setup": _setup,
        "verify": _verify,
        "verify_crud_absent": _verify_crud_absent,
        "seed_catalog_pagination": _seed_catalog_pagination,
        "create_document_fixtures": _create_document_fixtures,
        "cleanup": _cleanup,
    }[action](data)
    sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False).encode("utf-8"))


if __name__ == "__main__":
    main()
