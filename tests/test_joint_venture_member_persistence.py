import uuid

from backend.sync.mapper import attach_child_rows_to_items, save_child_payloads
from tests.test_sync_conflict_authorization import _seed_denied_package, _test_database


def _member(contractor_id, role):
    return {
        "id": contractor_id,
        "thanhVienNhaThauId": contractor_id,
        "tenNhaThau": f"Contractor {contractor_id}",
        "maNhaThau": contractor_id,
        "vaiTro": role,
    }


def test_same_joint_venture_members_round_trip_in_different_lots():
    database = _test_database()
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        organization_id, employee_id, package_id = _seed_denied_package(cursor)
        suffix = uuid.uuid4().hex
        contractor_ids = [f"contractor-{suffix}-1", f"contractor-{suffix}-2"]
        for contractor_id in contractor_ids:
            cursor.execute(
                """INSERT INTO nha_thau
                   (id, organization_id, id_goc, ma_nha_thau, ten_nha_thau)
                   VALUES (?, ?, ?, ?, ?)""",
                (
                    contractor_id,
                    organization_id,
                    contractor_id,
                    contractor_id,
                    f"Contractor {contractor_id}",
                ),
            )

        opening_ids = [f"opening-{suffix}-lot-1", f"opening-{suffix}-lot-2"]
        for opening_id, lot_code in zip(opening_ids, ("L1", "L2"), strict=True):
            cursor.execute(
                """INSERT INTO thong_tin_mo_thau
                   (id, organization_id, goi_thau_id, nha_thau_id,
                    ma_phan_lo, ma_phan_lo_normalized, loai_nha_thau)
                   VALUES (?, ?, ?, ?, ?, ?, 'Liên danh')""",
                (
                    opening_id,
                    organization_id,
                    package_id,
                    contractor_ids[0],
                    lot_code,
                    lot_code.casefold(),
                ),
            )

        members = [
            _member(contractor_ids[0], "Đứng đầu liên danh"),
            _member(contractor_ids[1], "Thành viên liên danh"),
        ]
        for opening_id in opening_ids:
            save_child_payloads(
                cursor,
                "thong_tin_mo_thau",
                {"id": opening_id, "thanhVienLienDanh": members},
                organization_id,
                "organization",
                11,
                "2026-08-08 12:00:00",
                employee_id,
            )

        projected = [{"id": opening_id} for opening_id in opening_ids]
        attach_child_rows_to_items(
            cursor,
            "thong_tin_mo_thau",
            projected,
            organization_id=organization_id,
        )

        first_ids = {member["id"] for member in projected[0]["thanhVienLienDanh"]}
        second_ids = {member["id"] for member in projected[1]["thanhVienLienDanh"]}
        assert first_ids.isdisjoint(second_ids)
        assert [
            {member["thanhVienNhaThauId"] for member in item["thanhVienLienDanh"]}
            for item in projected
        ] == [set(contractor_ids), set(contractor_ids)]

        for item in projected:
            save_child_payloads(
                cursor,
                "thong_tin_mo_thau",
                item,
                organization_id,
                "organization",
                12,
                "2026-08-08 12:01:00",
                employee_id,
            )
        reloaded = [{"id": opening_id} for opening_id in opening_ids]
        attach_child_rows_to_items(
            cursor,
            "thong_tin_mo_thau",
            reloaded,
            organization_id=organization_id,
        )
        assert [
            {member["id"] for member in item["thanhVienLienDanh"]}
            for item in reloaded
        ] == [first_ids, second_ids]
    finally:
        connection.rollback()
        connection.close()
        database.close()
