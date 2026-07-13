"""Dashboard projections derived from synchronized records."""

from helpers_py.access_policy import can_read_table, is_manager_role


def build_dashboard_summary(cursor, owner_id, role_str, user_id):
    manager = is_manager_role(role_str)

    def can(payload_key, table_name):
        return can_read_table(cursor, role_str, user_id, owner_id, payload_key, table_name)

    def scalar(sql, params=()):
        cursor.execute(sql, params)
        row = cursor.fetchone()
        return row[0] if row and row[0] is not None else 0

    def latest_cte(table_name):
        return f"""
            WITH ranked AS (
                SELECT *,
                       ROW_NUMBER() OVER (
                           PARTITION BY COALESCE(NULLIF(id_goc, ''), id)
                           ORDER BY CAST(COALESCE(phien_ban, 0) AS INTEGER) DESC,
                                    COALESCE(updated_at, created_at, '') DESC,
                                    id DESC
                       ) AS rn
                FROM {table_name}
                WHERE owner_id = ?
            )
            SELECT * FROM ranked WHERE rn = 1
        """

    def count_latest(payload_key, table_name):
        if not can(payload_key, table_name):
            return 0
        return int(scalar(f"SELECT COUNT(*) FROM ({latest_cte(table_name)}) latest_rows", (owner_id,)))

    counts = {
        "kehoach": 0,
        "goithau": 0,
        "chudautu": 0,
        "nhathau": 0,
        "chuyengia": 0,
        "hopdong": 0,
        "activeGoithau": 0,
    }
    total_contract_value = 0
    status_counts = {}
    recent_packages = []

    if can("chudautu", "chu_dau_tu"):
        counts["chudautu"] = count_latest("chudautu", "chu_dau_tu")
    if can("nhathau", "nha_thau"):
        counts["nhathau"] = count_latest("nhathau", "nha_thau")
    if can("chuyengia", "chuyen_gia"):
        counts["chuyengia"] = count_latest("chuyengia", "chuyen_gia")

    if can("kehoach", "ke_hoach_lcnt"):
        if manager:
            counts["kehoach"] = count_latest("kehoach", "ke_hoach_lcnt")
        else:
            cursor.execute(f"""
                SELECT COUNT(*)
                FROM ({latest_cte("ke_hoach_lcnt")}) kh
                WHERE EXISTS (
                    SELECT 1 FROM phan_cong_nhan_su pc
                    WHERE pc.owner_id = ?
                      AND pc.id_nhan_vien = ?
                      AND pc.loai_doi_tuong = 'kehoach'
                      AND pc.id_muc_tieu = kh.id
                )
                OR EXISTS (
                    SELECT 1 FROM goi_thau gt
                    JOIN phan_cong_nhan_su pc
                      ON pc.owner_id = gt.owner_id
                     AND pc.id_muc_tieu = gt.id
                     AND pc.loai_doi_tuong = 'goithau'
                    WHERE gt.owner_id = ?
                      AND gt.ke_hoach_id = kh.id
                      AND pc.id_nhan_vien = ?
                )
            """, (owner_id, owner_id, user_id, owner_id, user_id))
            counts["kehoach"] = int(cursor.fetchone()[0] or 0)

    package_filter_sql = ""
    package_params = [owner_id]
    if not manager:
        package_filter_sql = """
            AND EXISTS (
                SELECT 1 FROM phan_cong_nhan_su pc
                WHERE pc.owner_id = latest_rows.owner_id
                  AND pc.id_nhan_vien = ?
                  AND pc.id_muc_tieu = latest_rows.id
                  AND pc.loai_doi_tuong = 'goithau'
            )
        """
        package_params.append(user_id)

    if can("goithau", "goi_thau"):
        cursor.execute(f"""
            SELECT COUNT(*)
            FROM ({latest_cte("goi_thau")}) latest_rows
            WHERE 1 = 1 {package_filter_sql}
        """, tuple(package_params))
        counts["goithau"] = int(cursor.fetchone()[0] or 0)

        cursor.execute(f"""
            SELECT COALESCE(trang_thai, '') AS status_name, COUNT(*) AS total
            FROM ({latest_cte("goi_thau")}) latest_rows
            WHERE 1 = 1 {package_filter_sql}
            GROUP BY COALESCE(trang_thai, '')
        """, tuple(package_params))
        for row in cursor.fetchall():
            status_counts[str(row[0] or "")] = int(row[1] or 0)
        counts["activeGoithau"] = sum(
            count for status, count in status_counts.items()
            if "mời" in status.lower() and "thầu" in status.lower()
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
        if manager:
            cursor.execute("SELECT COUNT(*), COALESCE(SUM(gia_tri), 0) FROM hop_dong WHERE owner_id = ?", (owner_id,))
        else:
            cursor.execute("""
                SELECT COUNT(*), COALESCE(SUM(hd.gia_tri), 0)
                FROM hop_dong hd
                WHERE hd.owner_id = ?
                  AND EXISTS (
                      SELECT 1 FROM phan_cong_nhan_su pc
                      WHERE pc.owner_id = hd.owner_id
                        AND pc.id_nhan_vien = ?
                        AND pc.id_muc_tieu = hd.id
                        AND pc.loai_doi_tuong = 'hopdong'
                  )
            """, (owner_id, user_id))
        row = cursor.fetchone()
        counts["hopdong"] = int(row[0] or 0) if row else 0
        total_contract_value = float(row[1] or 0) if row else 0

    return {
        "counts": counts,
        "statusCounts": status_counts,
        "recentPackages": recent_packages,
        "totalContractValue": total_contract_value,
    }



