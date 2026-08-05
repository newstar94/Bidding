"""Seed, verify, and remove isolated bidder-goods browser E2E fixtures."""

from __future__ import annotations

import json
import os
import sys

import psycopg

from backend.shared.text_utils import normalize_lot_code


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
        """SELECT id
             FROM tai_khoan
            WHERE lower(COALESCE(username_norm, '')) = lower(%s)
               OR lower(COALESCE(ten_dang_nhap, '')) = lower(%s)
            ORDER BY created_at
            LIMIT 1""",
        (username, username),
    ).fetchone()
    if not row:
        raise RuntimeError(f"E2E account {username!r} does not exist")
    return str(row[0])


def _setup(data: dict) -> dict:
    organization_id = str(data["organizationId"])
    run_id = str(data["runId"])
    username = str(data["username"])
    owner_id = f"{run_id}-owner"
    plan_id = f"{run_id}-plan"
    bidder_id = f"{run_id}-bidder"
    with psycopg.connect(_database_url()) as connection:
        with connection.cursor() as cursor:
            user_id = _account_id(cursor, username)
            cursor.execute(
                "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (%s, %s)",
                (organization_id, f"Bidder goods E2E {run_id}"),
            )
            cursor.execute(
                """INSERT INTO thanh_vien_to_chuc (
                       user_id, organization_id, vai_tro_trong_to_chuc,
                       ten_nhan_su, trang_thai_thanh_vien
                   ) VALUES (%s, %s, 'manager', %s, 'active')""",
                (user_id, organization_id, "Quản lý E2E"),
            )
            cursor.execute(
                """INSERT INTO chu_dau_tu (
                       id, organization_id, owner_type, id_goc,
                       ma_chu_dau_tu, ma_so_thue, ten_chu_dau_tu
                   ) VALUES (%s, %s, 'organization', %s, %s, %s, %s)""",
                (
                    owner_id,
                    organization_id,
                    owner_id,
                    f"{run_id}-CDT",
                    f"01{str(abs(hash(run_id)))[:8]:0<8}",
                    f"Chủ đầu tư E2E {run_id}",
                ),
            )
            cursor.execute(
                """INSERT INTO ke_hoach_lcnt (
                       id, organization_id, owner_type, id_goc, ma_ke_hoach,
                       ten_ke_hoach, ten_du_an_du_toan, loai_hinh_mua_sam,
                       chu_dau_tu_id, ngay_phe_duyet, quyet_dinh_phe_duyet
                   ) VALUES (%s, %s, 'organization', %s, %s, %s, %s, %s, %s, %s, %s)""",
                (
                    plan_id,
                    organization_id,
                    plan_id,
                    f"{run_id}-KH",
                    f"Kế hoạch E2E {run_id}",
                    f"Dự án E2E {run_id}",
                    "Mua sắm hàng hóa",
                    owner_id,
                    "2026-07-01",
                    f"{run_id}/QD-KH",
                ),
            )
            cursor.execute(
                """INSERT INTO nha_thau (
                       id, organization_id, owner_type, id_goc,
                       ma_nha_thau, ten_nha_thau, ma_so_thue
                   ) VALUES (%s, %s, 'organization', %s, %s, %s, %s)""",
                (
                    bidder_id,
                    organization_id,
                    bidder_id,
                    f"{run_id}-NT",
                    f"Nhà thầu E2E {run_id}",
                    f"02{str(abs(hash(run_id + 'bidder')))[:8]:0<8}",
                ),
            )

            for package in data["packages"]:
                package_id = str(package["id"])
                cursor.execute(
                    """INSERT INTO goi_thau (
                           id, organization_id, owner_type, id_goc, ma_goi_thau,
                           ke_hoach_id, ten_goi_thau, gia_goi_thau, linh_vuc,
                           phuong_thuc_lua_chon, phuong_phap_danh_gia,
                           thoi_gian_thuc_hien, nguon_von,
                           thoi_gian_to_chuc, thoi_gian_bat_dau_to_chuc,
                           thoi_gian_dang_tai, thoi_gian_dong_thau,
                           thoi_gian_mo_thau, phan_lo, trang_thai
                       ) VALUES (
                           %s, %s, 'organization', %s, %s, %s, %s, %s,
                           'Hàng hóa', %s, 'Giá thấp nhất',
                           '30 ngày', 'Nguồn vốn E2E',
                           '30 ngày', '2026-07-01', '2026-07-01 08:00:00',
                           '2026-07-05 08:00:00', '2026-07-05 08:05:00', %s,
                           'EVALUATING'
                       )""",
                    (
                        package_id,
                        organization_id,
                        package_id,
                        package["code"],
                        plan_id,
                        package["name"],
                        int(package["packagePrice"]),
                        package["method"],
                        "Có" if package["lots"] else "Không",
                    ),
                )
                for lot in package["lots"]:
                    cursor.execute(
                        """INSERT INTO goi_thau_phan_lo (
                               id, organization_id, owner_type, goi_thau_id,
                               ma_phan_lo, ma_phan_lo_normalized, ten_phan_lo,
                               gia_tri_phan_lo, sort_order
                           ) VALUES (%s, %s, 'organization', %s, %s, %s, %s, %s, %s)""",
                        (
                            lot["id"],
                            organization_id,
                            package_id,
                            lot["code"],
                            normalize_lot_code(lot["code"]),
                            lot["name"],
                            int(lot["price"]),
                            int(lot["order"]),
                        ),
                    )
                for requirement in package["requirements"]:
                    cursor.execute(
                        """INSERT INTO goi_thau_hang_hoa (
                               id, organization_id, owner_type, goi_thau_id,
                               phan_lo_id, ma_hang_hoa, ten_hang_hoa, don_vi_tinh,
                               so_luong, sort_order
                           ) VALUES (%s, %s, 'organization', %s, %s, %s, %s, %s, %s, %s)""",
                        (
                            requirement["id"],
                            organization_id,
                            package_id,
                            requirement.get("lotId"),
                            requirement["code"],
                            requirement["name"],
                            requirement["unit"],
                            requirement["quantity"],
                            int(requirement["order"]),
                        ),
                    )
                for opening in package["openings"]:
                    cursor.execute(
                        """INSERT INTO thong_tin_mo_thau (
                               id, organization_id, owner_type, goi_thau_id,
                               nha_thau_id, ma_phan_lo, ma_phan_lo_normalized,
                               ten_phan_lo, ma_dinh_danh,
                               gia_du_thau, gia_sau_giam_gia, hieu_luc_hsdt,
                               thoi_gian_thuc_hien, ten_nha_thau, loai_nha_thau
                           ) VALUES (
                               %s, %s, 'organization', %s, %s, %s, %s, %s, %s,
                               %s, %s, 90, '30 ngày', %s, 'Độc lập'
                           )""",
                        (
                            opening["id"],
                            organization_id,
                            package_id,
                            bidder_id,
                            opening.get("lotCode") or "",
                            normalize_lot_code(opening.get("lotCode")),
                            opening.get("lotName") or "",
                            f"{run_id}-MST",
                            int(opening["bidPrice"]),
                            int(opening["bidPrice"]),
                            f"Nhà thầu E2E {run_id}",
                        ),
                    )
                    opening_id = opening["id"]
                    cursor.execute(
                        """INSERT INTO ket_qua_danh_gia_nha_thau (
                               id, organization_id, owner_type, goi_thau_id,
                               thong_tin_mo_thau_id, danh_gia_hop_le,
                               danh_gia_nang_luc, danh_gia_ky_thuat,
                               danh_gia_ket_luan
                           ) VALUES (
                               %s, %s, 'organization', %s, %s,
                               'Đạt', 'Đạt', 'Đạt', 'Đạt'
                           )""",
                        (
                            f"evaluation-result:{opening_id}",
                            organization_id,
                            package_id,
                            opening_id,
                        ),
                    )
                if not package.get("twoEnvelope"):
                    single_round_id = f"evaluation-round:{package_id}:single"
                    cursor.execute(
                        """INSERT INTO vong_danh_gia (
                               id, organization_id, owner_type, goi_thau_id,
                               loai_vong, thu_tu, trang_thai
                           ) VALUES (%s, %s, 'organization', %s, 'single', 0, 'draft')""",
                        (single_round_id, organization_id, package_id),
                    )
                    criterion_ids = {}
                    for order, group in enumerate(
                        ("validity", "capacity", "technical")
                    ):
                        criterion_id = f"{single_round_id}:{group}"
                        criterion_ids[group] = criterion_id
                        cursor.execute(
                            """INSERT INTO tieu_chi_danh_gia (
                                   id, organization_id, owner_type,
                                   vong_danh_gia_id, ma_tieu_chi,
                                   ten_tieu_chi, nhom_danh_gia,
                                   loai_ket_qua, bat_buoc, thu_tu
                               ) VALUES (
                                   %s, %s, 'organization', %s, %s, %s,
                                   %s, 'pass_fail', 1, %s
                               )""",
                            (
                                criterion_id,
                                organization_id,
                                single_round_id,
                                f"E2E_{group.upper()}",
                                f"Tiêu chí E2E {group}",
                                group,
                                order,
                            ),
                        )
                    extension = json.dumps({
                        "schemaVersion": 1,
                        "workflowVersion": 2,
                        "completedGroups": ["validity", "capacity", "technical"],
                        "groupResults": {
                            "validity": "Đạt",
                            "capacity": "Đạt",
                            "technical": "Đạt",
                        },
                    }, ensure_ascii=False)
                    for opening in package["openings"]:
                        opening_id = opening["id"]
                        report_id = (
                            f"detailed-evaluation:{opening_id}:{single_round_id}"
                        )
                        cursor.execute(
                            """INSERT INTO bao_cao_danh_gia_nha_thau (
                                   id, organization_id, owner_type,
                                   vong_danh_gia_id, thong_tin_mo_thau_id,
                                   trang_thai, ket_luan, extension_json
                               ) VALUES (%s, %s, 'organization', %s, %s, 'draft', '', %s)""",
                            (
                                report_id,
                                organization_id,
                                single_round_id,
                                opening_id,
                                extension,
                            ),
                        )
                        for group, criterion_id in criterion_ids.items():
                            cursor.execute(
                                """INSERT INTO chi_tiet_danh_gia_nha_thau (
                                       id, organization_id, owner_type,
                                       bao_cao_danh_gia_nha_thau_id,
                                       tieu_chi_danh_gia_id, ket_qua
                                   ) VALUES (
                                       %s, %s, 'organization', %s, %s, 'pass'
                                   )""",
                                (
                                    f"{report_id}:{group}",
                                    organization_id,
                                    report_id,
                                    criterion_id,
                                ),
                            )
                if package.get("twoEnvelope"):
                    technical_round_id = f"evaluation-round:{package_id}:technical"
                    cursor.execute(
                        """INSERT INTO vong_danh_gia (
                               id, organization_id, owner_type, goi_thau_id,
                               loai_vong, thu_tu, trang_thai, so_bao_cao,
                               ngay_bao_cao, da_luu_danh_sach_dat
                           ) VALUES (
                               %s, %s, 'organization', %s, 'technical', 0,
                               'completed', %s, '2026-07-10', 1
                           )""",
                        (
                            technical_round_id,
                            organization_id,
                            package_id,
                            f"{run_id}/BC-KT",
                        ),
                    )

            versioned_tables = (
                "chu_dau_tu",
                "ke_hoach_lcnt",
                "nha_thau",
                "goi_thau",
                "goi_thau_phan_lo",
                "goi_thau_hang_hoa",
                "thong_tin_mo_thau",
                "vong_danh_gia",
                "ket_qua_danh_gia_nha_thau",
            )
            for table_name in versioned_tables:
                cursor.execute(
                    f"UPDATE {table_name} SET sync_version = sync_version "
                    "WHERE organization_id = %s",
                    (organization_id,),
                )
        connection.commit()
    return {"organizationId": organization_id, "userId": user_id}


def _verify(data: dict) -> dict:
    organization_id = str(data["organizationId"])
    results = []
    with psycopg.connect(_database_url()) as connection:
        with connection.cursor() as cursor:
            for package in data["packages"]:
                row = cursor.execute(
                    """SELECT count(*),
                              COALESCE(sum(goods.thanh_tien_du_thau), 0),
                              COALESCE(sum(CASE WHEN goods.is_draft = 1 THEN 1 ELSE 0 END), 0),
                              count(DISTINCT goods.goi_thau_hang_hoa_id),
                              COALESCE(sum(CASE WHEN goods.trang_thai_uu_dai = 'ready' THEN 1 ELSE 0 END), 0),
                              COALESCE(sum(CASE WHEN goods.thanh_tien_sau_uu_dai IS NOT NULL THEN 1 ELSE 0 END), 0),
                              min(goods.ma_uu_dai),
                              max(goods.ma_uu_dai)
                         FROM hang_hoa_du_thau_nha_thau AS goods
                        WHERE goods.organization_id = %s
                          AND goods.goi_thau_id = %s""",
                    (organization_id, package["id"]),
                ).fetchone()
                actual_count = int(row[0])
                actual_total = int(row[1])
                draft_count = int(row[2])
                distinct_requirements = int(row[3])
                ready_count = int(row[4])
                calculated_count = int(row[5])
                minimum_code = int(row[6])
                maximum_code = int(row[7])
                expected_count = int(package["expectedCount"])
                expected_total = int(package["expectedTotal"])
                if actual_count != expected_count:
                    raise AssertionError(
                        f"{package['code']}: expected {expected_count} rows, got {actual_count}"
                    )
                if actual_total != expected_total:
                    raise AssertionError(
                        f"{package['code']}: expected total {expected_total}, got {actual_total}"
                    )
                if draft_count:
                    raise AssertionError(
                        f"{package['code']}: {draft_count} rows are still drafts"
                    )
                if distinct_requirements != expected_count:
                    raise AssertionError(
                        f"{package['code']}: duplicate or missing requirement mappings"
                    )
                if ready_count != expected_count or calculated_count != expected_count:
                    raise AssertionError(
                        f"{package['code']}: preference ready/calculated "
                        f"{ready_count}/{calculated_count}, expected {expected_count}"
                    )
                if not 0 <= minimum_code <= maximum_code <= 5:
                    raise AssertionError(
                        f"{package['code']}: invalid preference-code range "
                        f"{minimum_code}..{maximum_code}"
                    )
                opening_rows = cursor.execute(
                    """SELECT opening.id, opening.gia_du_thau,
                              count(goods.id),
                              COALESCE(sum(goods.thanh_tien_du_thau), 0),
                              opening.trang_thai_tinh_uu_dai,
                              opening.gia_so_sanh_sau_uu_dai
                         FROM thong_tin_mo_thau AS opening
                         LEFT JOIN hang_hoa_du_thau_nha_thau AS goods
                           ON goods.organization_id = opening.organization_id
                          AND goods.thong_tin_mo_thau_id = opening.id
                        WHERE opening.organization_id = %s
                          AND opening.goi_thau_id = %s
                        GROUP BY opening.id, opening.gia_du_thau,
                                 opening.trang_thai_tinh_uu_dai,
                                 opening.gia_so_sanh_sau_uu_dai
                        ORDER BY opening.id""",
                    (organization_id, package["id"]),
                ).fetchall()
                for opening_id, bid_price, count, total, preference_status, comparison_price in opening_rows:
                    if int(count) <= 0 or abs(int(total) - int(bid_price)) > 1:
                        raise AssertionError(
                            f"{package['code']}/{opening_id}: "
                            f"{count} rows total {total}, bid price {bid_price}"
                        )
                    if preference_status != "ready" or comparison_price is None:
                        raise AssertionError(
                            f"{package['code']}/{opening_id}: preference aggregate "
                            f"{preference_status}/{comparison_price}"
                        )
                results.append(
                    {
                        "code": package["code"],
                        "rows": actual_count,
                        "total": actual_total,
                        "openings": len(opening_rows),
                    }
                )
    return {"packages": results}


def _cleanup(data: dict) -> dict:
    organization_id = str(data["organizationId"])
    with psycopg.connect(_database_url()) as connection:
        with connection.cursor() as cursor:
            tables = (
                "chi_tiet_danh_gia_nha_thau",
                "bao_cao_danh_gia_nha_thau",
                "tieu_chi_danh_gia",
                "ket_qua_danh_gia_nha_thau",
                "vong_danh_gia",
                "hang_hoa_du_thau_nha_thau",
                "nha_thau_tham_du_mo_thau",
                "thong_tin_mo_thau_lien_danh_thanh_vien",
                "thong_tin_mo_thau",
                "goi_thau_hang_hoa",
                "goi_thau_phan_lo",
                "goi_thau",
                "nha_thau",
                "ke_hoach_lcnt",
                "chu_dau_tu",
                "record_edit_ownership",
                "sync_mutations",
                "deleted_records",
            )
            for table_name in tables:
                cursor.execute(
                    f"DELETE FROM {table_name} WHERE organization_id = %s",
                    (organization_id,),
                )
            cursor.execute(
                "DELETE FROM thanh_vien_to_chuc WHERE organization_id = %s",
                (organization_id,),
            )
            cursor.execute(
                "DELETE FROM sync_metadata WHERE organization_id = %s",
                (organization_id,),
            )
            cursor.execute("DELETE FROM to_chuc WHERE id = %s", (organization_id,))
        connection.commit()
    return {"removed": organization_id}


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in {"setup", "verify", "cleanup"}:
        raise SystemExit("Usage: bidder_goods_e2e_fixture.py setup|verify|cleanup")
    data = _payload()
    action = sys.argv[1]
    result = {"setup": _setup, "verify": _verify, "cleanup": _cleanup}[action](data)
    sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False).encode("utf-8"))


if __name__ == "__main__":
    main()
