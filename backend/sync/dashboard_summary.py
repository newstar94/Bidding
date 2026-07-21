"""Dashboard projections derived from synchronized records."""

import calendar
from datetime import date, datetime, timedelta
import re
import unicodedata

from backend.shared.access_policy import can_read_table, is_organization_manager
from backend.sync.mapper import map_db_to_json
from backend.shared.domain_enums import enum_label
from backend.documents.docx_formula_service import (
    _add_working_days,
    _diff_working_days,
    _load_holidays,
)
from backend.shared.date_utils import vietnam_today


EVALUATION_REPORT_DELAY_DAYS = 7
CONTRACT_EXPIRY_WARNING_DAYS = 10
PLAN_STATUS_LABELS = ("Chưa triển khai", "Đang thực hiện", "Hoàn thành")
ALERT_COUNT_KEYS = (
    "closingToday", "closingSoon", "overdueOpening", "delayedEvaluation",
    "contractExpired", "contractExpiring", "planPublishingWarning", "planPublishingOverdue",
)
ALERT_PRIORITY = {
    "overdueOpening": 0,
    "contractExpired": 1,
    "planPublishingOverdue": 2,
    "closingToday": 3,
    "delayedEvaluation": 4,
    "contractExpiring": 5,
    "planPublishingWarning": 6,
    "closingSoon": 7,
}


def _parse_iso_date(value):
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        try:
            return datetime.strptime(text[:10], "%d/%m/%Y").date()
        except ValueError:
            return None


def _business_days_elapsed(start_date, end_date, holidays_data=None):
    """Count configured working days strictly after start_date through end_date."""
    if not start_date or not end_date or end_date <= start_date:
        return 0
    return _diff_working_days(start_date, end_date, holidays_data or _load_holidays())


def _add_business_days(start_date, days, holidays_data=None):
    return _add_working_days(start_date, days, holidays_data or _load_holidays())


def _normalize_search_text(value):
    text = unicodedata.normalize("NFD", str(value or ""))
    return "".join(char for char in text if unicodedata.category(char) != "Mn").lower().replace("đ", "d")


def _contract_expiry_date(signed_date, raw_duration):
    normalized = _normalize_search_text(raw_duration)
    match = re.search(r"\d+(?:[.,]\d+)?", normalized)
    if not signed_date or not match:
        return None
    amount = int(float(match.group(0).replace(",", ".")))
    if amount <= 0:
        return None
    if "thang" in normalized:
        month_index = signed_date.month - 1 + amount
        year = signed_date.year + month_index // 12
        month = month_index % 12 + 1
        day = min(signed_date.day, calendar.monthrange(year, month)[1])
        return date(year, month, day)
    if "nam" in normalized:
        year = signed_date.year + amount
        day = min(signed_date.day, calendar.monthrange(year, signed_date.month)[1])
        return date(year, signed_date.month, day)
    days = amount * 7 if "tuan" in normalized else amount
    return signed_date + timedelta(days=days)


def _select_alert_items(items, limit=8):
    ordered = sorted(items, key=lambda item: (ALERT_PRIORITY.get(item.get("alertKey"), 99), str(item.get("deadline") or "")))
    selected = []
    for target_type in ("contract", "plan", "package"):
        item = next((candidate for candidate in ordered if candidate.get("targetType") == target_type), None)
        if item is not None:
            selected.append(item)
    for item in ordered:
        if len(selected) < limit and item not in selected:
            selected.append(item)
    return sorted(selected, key=lambda item: (ALERT_PRIORITY.get(item.get("alertKey"), 99), str(item.get("deadline") or "")))


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
    total_contract_value_all = "0"
    contract_total_count = 0
    status_counts = {}
    plan_status_counts = {label: 0 for label in PLAN_STATUS_LABELS}
    contract_status_counts = {}
    contract_value_by_status = {}
    alert_counts = {key: 0 for key in ALERT_COUNT_KEYS}
    alert_items = []
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

    if can_read_plans:
        plan_visibility_sql = ""
        package_access_sql = ""
        plan_status_params = [organization_id, organization_id]
        if not manager:
            package_access_sql = """
                AND EXISTS (
                    SELECT 1 FROM phan_cong_nhan_su pc_pkg
                    WHERE pc_pkg.organization_id = gt.organization_id
                      AND pc_pkg.id_nhan_vien = ?
                      AND pc_pkg.id_muc_tieu = gt.id
                      AND pc_pkg.loai_doi_tuong = 'goithau'
                )
            """
            plan_status_params.append(user_id)
            plan_visibility_sql = """
                AND (
                    EXISTS (
                        SELECT 1 FROM phan_cong_nhan_su pc_plan
                        WHERE pc_plan.organization_id = ?
                          AND pc_plan.id_nhan_vien = ?
                          AND pc_plan.loai_doi_tuong = 'kehoach'
                          AND pc_plan.id_muc_tieu = kh.id
                    )
                    OR EXISTS (
                        SELECT 1 FROM goi_thau gt_assigned
                        JOIN phan_cong_nhan_su pc_assigned
                          ON pc_assigned.organization_id = gt_assigned.organization_id
                         AND pc_assigned.id_muc_tieu = gt_assigned.id
                         AND pc_assigned.loai_doi_tuong = 'goithau'
                        WHERE gt_assigned.organization_id = ?
                          AND gt_assigned.ke_hoach_id = kh.id
                          AND pc_assigned.id_nhan_vien = ?
                    )
                )
            """
            plan_status_params.extend((organization_id, user_id, organization_id, user_id))

        cursor.execute(f"""
            SELECT kh.id, kh.ma_ke_hoach, kh.ten_ke_hoach,
                   kh.ngay_phe_duyet, kh.thoi_gian_dang_tai,
                   COUNT(gt.id) AS package_count,
                   SUM(CASE WHEN gt.id IS NOT NULL AND gt.trang_thai != 'PREPARING' THEN 1 ELSE 0 END) AS started_count,
                   SUM(CASE WHEN gt.id IS NOT NULL AND gt.trang_thai NOT IN ('AWARDED', 'CANCELLED') THEN 1 ELSE 0 END) AS unfinished_count
            FROM ({latest_cte("ke_hoach_lcnt")}) kh
            LEFT JOIN ({latest_cte("goi_thau")}) gt
              ON gt.ke_hoach_id = kh.id
             AND gt.organization_id = kh.organization_id
             {package_access_sql}
            WHERE 1 = 1 {plan_visibility_sql}
            GROUP BY kh.id, kh.ma_ke_hoach, kh.ten_ke_hoach,
                     kh.ngay_phe_duyet, kh.thoi_gian_dang_tai
        """, tuple(plan_status_params))
        for row in cursor.fetchall():
            package_count = int(row[5] or 0)
            started_count = int(row[6] or 0)
            unfinished_count = int(row[7] or 0)
            if package_count == 0 or started_count == 0:
                plan_status_counts["Chưa triển khai"] += 1
            elif unfinished_count > 0:
                plan_status_counts["Đang thực hiện"] += 1
            else:
                plan_status_counts["Hoàn thành"] += 1

            approval_date = _parse_iso_date(row[3])
            published_at = str(row[4] or "").strip()
            business_days = _business_days_elapsed(approval_date, vietnam_today())
            if published_at or not approval_date or business_days < 3:
                continue
            alert_key = "planPublishingOverdue" if business_days > 5 else "planPublishingWarning"
            alert_counts[alert_key] += 1
            alert_items.append({
                "targetType": "plan",
                "id": str(row[0] or ""),
                "maKeHoach": str(row[1] or ""),
                "tenKeHoach": str(row[2] or ""),
                "ngayPheDuyet": approval_date.isoformat(),
                "deadline": _add_business_days(approval_date, 5).isoformat(),
                "workdaysElapsed": business_days,
                "alertKey": alert_key,
            })
        counts["kehoach"] = sum(plan_status_counts.values())

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
            ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
            LIMIT 4
        """, tuple(package_params))
        recent_packages = [map_db_to_json("goi_thau", dict(row)) for row in cursor.fetchall()]

        visible_packages_sql = f"""
            SELECT latest_rows.*
            FROM ({latest_cte("goi_thau")}) latest_rows
            WHERE 1 = 1 {package_filter_sql}
        """
        delayed_evaluation_condition = f"""
            vp.trang_thai IN ('OPENED', 'EVALUATING')
            AND COALESCE(vp.thoi_gian_mo_thau, vp.thoi_gian_dong_thau)
                <= CURRENT_TIMESTAMP - INTERVAL '{EVALUATION_REPORT_DELAY_DAYS} days'
            AND NOT EXISTS (
                SELECT 1 FROM vong_danh_gia vd
                WHERE vd.organization_id = vp.organization_id
                  AND vd.goi_thau_id = vp.id
                  AND (COALESCE(trim(vd.so_bao_cao), '') <> '' OR vd.ngay_bao_cao IS NOT NULL)
            )
        """
        alert_conditions = {
            "closingToday": "vp.trang_thai = 'INVITED' AND (vp.thoi_gian_dong_thau AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date",
            "closingSoon": "vp.trang_thai = 'INVITED' AND vp.thoi_gian_dong_thau > CURRENT_TIMESTAMP AND vp.thoi_gian_dong_thau <= CURRENT_TIMESTAMP + INTERVAL '7 days' AND (vp.thoi_gian_dong_thau AT TIME ZONE 'Asia/Ho_Chi_Minh')::date > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date",
            "overdueOpening": "vp.trang_thai = 'INVITED' AND (vp.thoi_gian_dong_thau AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date",
            "delayedEvaluation": delayed_evaluation_condition,
        }
        union_parts = [
            f"SELECT '{key}' AS alert_key, COUNT(*) AS total FROM visible_packages vp WHERE {condition}"
            for key, condition in alert_conditions.items()
        ]
        cursor.execute(
            f"WITH visible_packages AS ({visible_packages_sql}) " + " UNION ALL ".join(union_parts),
            tuple(package_params),
        )
        for row in cursor.fetchall():
            alert_counts[str(row[0])] = int(row[1] or 0)

        cursor.execute(f"""
            WITH visible_packages AS ({visible_packages_sql}),
            alert_packages AS (
                SELECT vp.*,
                       CASE
                           WHEN {alert_conditions["overdueOpening"]} THEN 'overdueOpening'
                           WHEN {alert_conditions["closingToday"]} THEN 'closingToday'
                           WHEN {alert_conditions["delayedEvaluation"]} THEN 'delayedEvaluation'
                           WHEN {alert_conditions["closingSoon"]} THEN 'closingSoon'
                           ELSE ''
                       END AS alert_key
                FROM visible_packages vp
            )
            SELECT *
            FROM alert_packages
            WHERE alert_key != ''
            ORDER BY CASE alert_key
                        WHEN 'overdueOpening' THEN 1
                        WHEN 'closingToday' THEN 2
                        WHEN 'delayedEvaluation' THEN 3
                        ELSE 4
                     END,
                     COALESCE(thoi_gian_dong_thau, thoi_gian_mo_thau, updated_at, created_at) ASC
            LIMIT 8
        """, tuple(package_params))
        for row in cursor.fetchall():
            raw_item = dict(row)
            alert_key = str(raw_item.pop("alert_key", ""))
            item = map_db_to_json("goi_thau", raw_item)
            item["targetType"] = "package"
            item["alertKey"] = alert_key
            item["deadline"] = (
                item.get("thoiGianMoThau")
                if alert_key == "delayedEvaluation"
                else item.get("thoiGianDongThau")
            ) or ""
            alert_items.append(item)

    if can("hopdong", "hop_dong"):
        latest_contracts_sql = latest_cte("hop_dong")
        if manager:
            cursor.execute(
                f"""SELECT id, gia_tri, trang_thai_hop_dong
                    FROM ({latest_contracts_sql}) latest_rows
                    """,
                (organization_id,),
            )
        else:
            cursor.execute(f"""
                SELECT hd.id, hd.gia_tri, hd.trang_thai_hop_dong
                FROM ({latest_contracts_sql}) hd
                WHERE EXISTS (
                    SELECT 1 FROM phan_cong_nhan_su pc
                    WHERE pc.organization_id = hd.organization_id
                      AND pc.id_nhan_vien = ?
                      AND pc.id_muc_tieu = hd.id
                      AND pc.loai_doi_tuong = 'hopdong'
                )
            """, (organization_id, user_id))
        all_contract_rows = cursor.fetchall()
        contract_total_count = len(all_contract_rows)
        total_contract_value_all = str(sum(int(row[1] or 0) for row in all_contract_rows))
        for row in all_contract_rows:
            status = str(enum_label("hop_dong", "trang_thai_hop_dong", row[2]) or "")
            contract_status_counts[status] = contract_status_counts.get(status, 0) + 1
            contract_value_by_status[status] = str(
                int(contract_value_by_status.get(status, "0")) + int(row[1] or 0)
            )
        contract_rows = list(all_contract_rows)
        counts["hopdong"] = len(contract_rows)
        total_contract_value = str(sum(int(row[1] or 0) for row in contract_rows))

        contract_alert_filter_sql = ""
        contract_alert_params = [organization_id]
        if not manager:
            contract_alert_filter_sql = """
                AND EXISTS (
                    SELECT 1 FROM phan_cong_nhan_su pc
                    WHERE pc.organization_id = hd.organization_id
                      AND pc.id_nhan_vien = ?
                      AND pc.id_muc_tieu = hd.id
                      AND pc.loai_doi_tuong = 'hopdong'
                )
            """
            contract_alert_params.append(user_id)
        cursor.execute(f"""
            SELECT hd.id, hd.so_hop_dong, hd.ten_hop_dong, hd.ngay_ky,
                   hd.thoi_gian_thuc_hien, hd.trang_thai_hop_dong,
                   hd.ngay_thanh_ly
            FROM ({latest_contracts_sql}) hd
            WHERE hd.ngay_thanh_ly IS NULL
              {contract_alert_filter_sql}
        """, tuple(contract_alert_params))
        today = vietnam_today()
        warning_limit = today + timedelta(days=CONTRACT_EXPIRY_WARNING_DAYS)
        for row in cursor.fetchall():
            deadline = _contract_expiry_date(_parse_iso_date(row[3]), row[4])
            if not deadline or deadline > warning_limit:
                continue
            missing_liquidation = not str(row[6] or "").strip()
            if not missing_liquidation:
                continue
            alert_key = "contractExpired" if deadline < today else "contractExpiring"
            missing_steps = []
            if missing_liquidation:
                missing_steps.append("Chưa thanh lý")
            alert_counts[alert_key] += 1
            alert_items.append({
                "targetType": "contract",
                "id": str(row[0] or ""),
                "soHopDong": str(row[1] or ""),
                "tenHopDong": str(row[2] or ""),
                "deadline": deadline.isoformat(),
                "alertKey": alert_key,
                "alertDetail": " · ".join(missing_steps),
            })

        cursor.execute(f"""
            SELECT COUNT(*), COUNT(*)
            FROM ({latest_contracts_sql}) hd
            WHERE EXISTS (
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

    alert_items = _select_alert_items(alert_items)

    return {
        "counts": counts,
        "statusCounts": status_counts,
        "planStatusCounts": plan_status_counts,
        "contractStatusCounts": contract_status_counts,
        "contractValueByStatus": contract_value_by_status,
        "contractTotalCount": contract_total_count,
        "recentPackages": recent_packages,
        "totalContractValue": total_contract_value,
        "totalContractValueAll": total_contract_value_all,
        "alertCounts": alert_counts,
        "alertItems": alert_items,
        "evaluationDelayDays": EVALUATION_REPORT_DELAY_DAYS,
    }
