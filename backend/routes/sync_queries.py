import re

from helpers_py.access_policy import can_read_table, is_manager_role
from helpers_py.sync_mapper import map_db_to_json


TABLE_KEYS = {
    "chudautu": "chu_dau_tu",
    "kehoach": "ke_hoach_lcnt",
    "goithau": "goi_thau",
    "chuyengia": "chuyen_gia",
    "nhathau": "nha_thau",
    "hopdong": "hop_dong",
    "assignments": "phan_cong_nhan_su",
    "custompaperstatuses": "trang_thai_ho_so_giay",
    "thongtinmothau": "thong_tin_mo_thau",
    "permissionmatrix": "ma_tran_phan_quyen"
}

FTS_SEARCH_TABLES = {
    "ke_hoach_lcnt",
    "goi_thau",
    "chu_dau_tu",
    "nha_thau",
    "hop_dong",
}

SYNCED_TABLES = set(TABLE_KEYS.values())
ALLOWED_ORPHAN_TABLES = {
    "goi_thau",
    "thong_tin_mo_thau",
}

OWNER_TYPES = {"organization", "user"}
DELETED_RECORD_UPSERT_SQL = """
    INSERT INTO deleted_records (table_name, record_id, owner_id, deleted_at, delete_version)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(owner_id, table_name, record_id) DO UPDATE SET
        deleted_at = excluded.deleted_at,
        delete_version = MAX(COALESCE(deleted_records.delete_version, 0), COALESCE(excluded.delete_version, 0))
"""


def next_sync_version(cursor, owner_id):
    cursor.execute(
        "INSERT OR IGNORE INTO sync_metadata (owner_id, current_version) VALUES (?, 0)",
        (owner_id,)
    )
    cursor.execute(
        "UPDATE sync_metadata SET current_version = current_version + 1, updated_at = datetime('now', 'localtime') WHERE owner_id = ?",
        (owner_id,)
    )
    cursor.execute("SELECT current_version FROM sync_metadata WHERE owner_id = ?", (owner_id,))
    row = cursor.fetchone()
    return int(row[0] if row else 0)


def get_current_sync_version(cursor, owner_id):
    cursor.execute("SELECT current_version FROM sync_metadata WHERE owner_id = ?", (owner_id,))
    row = cursor.fetchone()
    return int(row[0] if row else 0)


def build_fts_match_query(search_text):
    tokens = re.findall(r"[\w]+", str(search_text or ""), flags=re.UNICODE)
    tokens = [token for token in tokens if token]
    if not tokens:
        return ""
    return " ".join(f"{token}*" for token in tokens[:8])


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


def get_expert_relations_for_packages(cursor, gt_ids, owner_id=None):
    if not gt_ids:
        return {}
    placeholders = ", ".join(["?"] * len(gt_ids))
    owner_filter = " AND owner_id = ?" if owner_id is not None else ""
    params = list(gt_ids)
    if owner_id is not None:
        params.append(owner_id)
    cursor.execute(f"""
        SELECT goi_thau_id, chuyen_gia_id, loai, chuc_vu, cong_viec
        FROM goi_thau_chuyen_gia
        WHERE goi_thau_id IN ({placeholders}){owner_filter}
    """, tuple(params))
    relations_map = {}
    for rel_row in cursor.fetchall():
        gt_id = rel_row[0]
        entry = {
            "chuyenGiaId": rel_row[1],
            "id": rel_row[1],
            "chucVu": rel_row[3] or "Tổ viên",
            "congViec": rel_row[4] or ""
        }
        if gt_id not in relations_map:
            relations_map[gt_id] = {"to_cg": [], "to_td": [], "cg_ids": []}
        if rel_row[2] == "chuyen_gia":
            relations_map[gt_id]["to_cg"].append(entry)
            relations_map[gt_id]["cg_ids"].append(rel_row[1])
        else:
            relations_map[gt_id]["to_td"].append(entry)
    return relations_map


def get_contract_package_ids(cursor, hd_ids, owner_id=None):
    if not hd_ids:
        return {}
    placeholders = ", ".join(["?"] * len(hd_ids))
    owner_filter = " AND owner_id = ?" if owner_id is not None else ""
    params = list(hd_ids)
    if owner_id is not None:
        params.append(owner_id)
    cursor.execute(
        f"SELECT hop_dong_id, goi_thau_id FROM hop_dong_goi_thau WHERE hop_dong_id IN ({placeholders}){owner_filter}",
        tuple(params)
    )
    result = {}
    for row in cursor.fetchall():
        hd_id = row[0]
        gt_id = row[1]
        if gt_id:
            result.setdefault(hd_id, []).append(gt_id)
    return result
