"""Dashboard projections derived from synchronized records."""

from backend.shared.access_policy import can_read_table, is_organization_manager
from backend.sync.mapper import map_db_to_json
from backend.shared.domain_enums import enum_label


def build_dashboard_summary(cursor, organization_id, role_str, user_id):
    manager = is_organization_manager(cursor, role_str, user_id, organization_id)

    def can(payload_key, table_name):
        return can_read_table(cursor, role_str, user_id, organization_id, payload_key, table_name)

    def latest_cte(table_name):
        if table_name == "goi_thau":
            # Package latest-ness is scoped to a plan snapshot. Only packages
            # belonging to the latest plan snapshot contribute to the global
            # dashboard; historical snapshots remain queryable by plan ID.
            return """
                SELECT gt.*
                FROM goi_thau AS gt
                JOIN ke_hoach_lcnt AS kh
                  ON kh.id = gt.ke_hoach_id
                 AND kh.organization_id = gt.organization_id
                 AND kh.is_latest = 1
                 AND kh.archived_at IS NULL
                WHERE gt.organization_id = ?
                  AND gt.is_latest = 1
                  AND gt.archived_at IS NULL
            """
        return f"""
            SELECT *
            FROM {table_name}
            WHERE organization_id = ?
              AND is_latest = 1
              AND archived_at IS NULL
        """

    counts = {
        "kehoach": 0,
        "goithau": 0,
        "chudautu": 0,
        "nhathau": 0,
        "chuyengia": 0,
        "hopdong": 0,
        "assignedHopdong": 0,
        "activeAssignedHopdong": 0,
        "activeGoithau": 0,
    }
    total_contract_value = "0"
    status_counts = {}
    recent_packages = []

    simple_count_specs = []
    for payload_key, table_name in [
        ("chudautu", "chu_dau_tu"),
        ("nhathau", "nha_thau"),
        ("chuyengia", "chuyen_gia"),
    ]:
        if can(payload_key, table_name):
            simple_count_specs.append((payload_key, table_name))

    can_read_plans = can("kehoach", "ke_hoach_lcnt")
    if manager and can_read_plans:
        simple_count_specs.append(("kehoach", "ke_hoach_lcnt"))

    if simple_count_specs:
        cursor.execute(
            "SELECT " + ", ".join(
                f"(SELECT COUNT(*) FROM ({latest_cte(table_name)}) latest_rows)"
                for _payload_key, table_name in simple_count_specs
            ),
            tuple(organization_id for _spec in simple_count_specs),
        )
        simple_count_row = cursor.fetchone()
        for index, (payload_key, _table_name) in enumerate(simple_count_specs):
            counts[payload_key] = int(simple_count_row[index] or 0)

    if can_read_plans and not manager:
        cursor.execute(f"""
            SELECT COUNT(*)
            FROM ({latest_cte("ke_hoach_lcnt")}) kh
            WHERE EXISTS (
                SELECT 1 FROM phan_cong_nhan_su pc
                WHERE pc.organization_id = ?
                  AND pc.id_nhan_vien = ?
                  AND pc.loai_doi_tuong = 'kehoach'
                  AND pc.id_muc_tieu = kh.id
            )
            OR EXISTS (
                SELECT 1 FROM goi_thau gt
                JOIN phan_cong_nhan_su pc
                  ON pc.organization_id = gt.organization_id
                 AND pc.id_muc_tieu = gt.id
                 AND pc.loai_doi_tuong = 'goithau'
                WHERE gt.organization_id = ?
                  AND gt.ke_hoach_id = kh.id
                  AND pc.id_nhan_vien = ?
            )
        """, (organization_id, organization_id, user_id, organization_id, user_id))
        counts["kehoach"] = int(cursor.fetchone()[0] or 0)

    package_filter_sql = ""
    package_params = [organization_id]
    if not manager:
        package_filter_sql = """
            AND EXISTS (
                SELECT 1 FROM phan_cong_nhan_su pc
                WHERE pc.organization_id = latest_rows.organization_id
                  AND pc.id_nhan_vien = ?
                  AND pc.id_muc_tieu = latest_rows.id
                  AND pc.loai_doi_tuong = 'goithau'
            )
        """
        package_params.append(user_id)

    if can("goithau", "goi_thau"):
        cursor.execute(f"""
            SELECT COALESCE(trang_thai, '') AS status_name, COUNT(*) AS total
            FROM ({latest_cte("goi_thau")}) latest_rows
            WHERE 1 = 1 {package_filter_sql}
            GROUP BY COALESCE(trang_thai, '')
        """, tuple(package_params))
        for row in cursor.fetchall():
            status_counts[str(enum_label("goi_thau", "trang_thai", row[0]) or "")] = int(row[1] or 0)
        counts["goithau"] = sum(status_counts.values())
        counts["activeGoithau"] = sum(
            count for status, count in status_counts.items()
            if status == "Đang mời thầu"
        )

        cursor.execute(f"""
            SELECT *
            FROM ({latest_cte("goi_thau")}) latest_rows
            WHERE 1 = 1 {package_filter_sql}
            ORDER BY COALESCE(updated_at, created_at, '') DESC, id DESC
            LIMIT 4
        """, tuple(package_params))
        recent_packages = [map_db_to_json("goi_thau", dict(row)) for row in cursor.fetchall()]

    if can("hopdong", "hop_dong"):
        latest_contracts_sql = latest_cte("hop_dong")
        if manager:
            cursor.execute(
                f"""SELECT id, gia_tri, trang_thai_hop_dong
                    FROM ({latest_contracts_sql}) latest_rows
                    WHERE trang_thai_hop_dong NOT IN ('NOT_EFFECTIVE', 'CANCELLED')""",
                (organization_id,),
            )
        else:
            cursor.execute(f"""
                SELECT hd.id, hd.gia_tri, hd.trang_thai_hop_dong
                FROM ({latest_contracts_sql}) hd
                WHERE hd.trang_thai_hop_dong NOT IN ('NOT_EFFECTIVE', 'CANCELLED')
                  AND EXISTS (
                    SELECT 1 FROM phan_cong_nhan_su pc
                    WHERE pc.organization_id = hd.organization_id
                      AND pc.id_nhan_vien = ?
                      AND pc.id_muc_tieu = hd.id
                      AND pc.loai_doi_tuong = 'hopdong'
                )
            """, (organization_id, user_id))
        contract_rows = cursor.fetchall()
        counts["hopdong"] = len(contract_rows)
        total_contract_value = str(sum(int(row[1] or 0) for row in contract_rows))

        cursor.execute(f"""
            SELECT COUNT(*),
                   SUM(CASE WHEN hd.trang_thai_hop_dong = 'ACTIVE' THEN 1 ELSE 0 END)
            FROM ({latest_contracts_sql}) hd
            WHERE hd.trang_thai_hop_dong NOT IN ('NOT_EFFECTIVE', 'CANCELLED')
              AND EXISTS (
                SELECT 1 FROM phan_cong_nhan_su pc
                WHERE pc.organization_id = hd.organization_id
                  AND pc.id_nhan_vien = ?
                  AND pc.id_muc_tieu = hd.id
                  AND pc.loai_doi_tuong = 'hopdong'
            )
        """, (organization_id, user_id))
        assigned_row = cursor.fetchone()
        counts["assignedHopdong"] = int(assigned_row[0] or 0)
        counts["activeAssignedHopdong"] = int(assigned_row[1] or 0)

    return {
        "counts": counts,
        "statusCounts": status_counts,
        "recentPackages": recent_packages,
        "totalContractValue": total_contract_value,
    }
