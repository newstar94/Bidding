"""Dashboard projections derived from synchronized records."""

import calendar
from datetime import date, datetime, timedelta
import re
import unicodedata

from backend.shared.access_policy import can_read_table, is_organization_manager
from backend.sync.mapper import map_db_to_json
from backend.shared.domain_enums import CONTRACT_STATUS_LABELS, enum_label
from backend.documents.docx_formula_service import (
    _add_working_days,
    _diff_working_days,
    _load_holidays,
)
from backend.shared.date_utils import vietnam_today
from backend.shared.sql_identifiers import sql_identifier
from backend.sync.deadline_alerts import (
    bid_validity_alert,
    bid_validity_detail,
    calendar_day,
    latest_closing_datetime,
    milestone_overdue_detail,
    overdue_milestones,
)

# Tables whose latest snapshot rows are counted by build_dashboard_summary.
_DASHBOARD_LATEST_TABLES = frozenset({
    "chu_dau_tu",
    "nha_thau",
    "chuyen_gia",
    "ke_hoach_lcnt",
    "goi_thau",
    "hop_dong",
})


EVALUATION_REPORT_DELAY_DAYS = 7
CONTRACT_EXPIRY_WARNING_DAYS = 10
PLAN_STATUS_LABELS = ("Chưa triển khai", "Đang thực hiện", "Hoàn thành")
ALERT_COUNT_KEYS = (
    "closingToday", "closingSoon", "overdueOpening", "delayedEvaluation",
    "contractExpired", "contractExpiring", "planPublishingWarning", "planPublishingOverdue",
    "bidValidityExpiring", "milestoneOverdue",
)
ALERT_PRIORITY = {
    "overdueOpening": 0,
    "contractExpired": 1,
    "planPublishingOverdue": 2,
    "bidValidityExpiring": 3,
    "closingToday": 4,
    "delayedEvaluation": 5,
    "milestoneOverdue": 6,
    "contractExpiring": 7,
    "planPublishingWarning": 8,
    "closingSoon": 9,
}
# ADR 0103: a package can carry these alerts in addition to its status alert.
# Only this many packages with stored overdue-looking milestones are evaluated
# per dashboard build; the count is flagged as partial beyond the cap.
MILESTONE_ALERT_CANDIDATE_LIMIT = 200


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


def _effective_package_rows_sql(latest_packages_sql):
    """Project package status from authoritative official result data."""

    return f"""
        SELECT package_rows.*,
               CASE
                   WHEN package_rows.trang_thai = 'CANCELLED' THEN 'CANCELLED'
                   WHEN result_edit.edit_type = 'whole' THEN 'EVALUATING'
                   WHEN result_edit.edit_type = 'batch'
                    AND COALESCE(lot_progress.completed_lots, 0) = 0
                       THEN 'EVALUATING'
                   WHEN COALESCE(lot_progress.total_lots, 0) > 0
                    AND COALESCE(lot_progress.completed_lots, 0) = lot_progress.total_lots
                       THEN 'AWARDED'
                   WHEN COALESCE(lot_progress.completed_lots, 0) > 0
                       THEN 'PARTIALLY_AWARDED'
                   WHEN package_rows.trang_thai IN ('AWARDED', 'PARTIALLY_AWARDED')
                       THEN package_rows.trang_thai
                   WHEN COALESCE(trim(package_rows.so_quyet_dinh_ket_qua), '') <> ''
                    AND package_rows.ngay_quyet_dinh_ket_qua IS NOT NULL
                    AND package_rows.gia_trung_thau IS NOT NULL
                    AND (
                        package_rows.phan_lo = 'Có'
                        OR COALESCE(trim(package_rows.nha_thau_trung_thau_id), '') <> ''
                    )
                       THEN 'AWARDED'
                   ELSE package_rows.trang_thai
               END AS effective_status
        FROM ({latest_packages_sql}) package_rows
        LEFT JOIN (
            SELECT lots.organization_id,
                   lots.goi_thau_id,
                   COUNT(DISTINCT lots.id) AS total_lots,
                   COUNT(DISTINCT CASE
                       WHEN (
                           details.current_stage = 'RESULT_APPROVED'
                           OR legacy_official_results.lot_id IS NOT NULL
                       )
                        AND editing_batch_lots.lot_id IS NULL
                       THEN lots.id
                   END) AS completed_lots
            FROM goi_thau_phan_lo lots
            LEFT JOIN dot_xu_ly_phan_lo_chi_tiet details
              ON details.organization_id = lots.organization_id
             AND details.lot_id = lots.id
            LEFT JOIN (
                SELECT DISTINCT evaluation.organization_id,
                       evaluation.goi_thau_id,
                       legacy_lot.lot_id
                FROM vong_danh_gia evaluation
                CROSS JOIN LATERAL jsonb_each(
                    CASE
                        WHEN jsonb_typeof(evaluation.extension_json::jsonb -> 'lotBatches') = 'object'
                        THEN evaluation.extension_json::jsonb -> 'lotBatches'
                        ELSE '{{}}'::jsonb
                    END
                ) AS batch(key, value)
                CROSS JOIN LATERAL jsonb_array_elements_text(
                    CASE
                        WHEN jsonb_typeof(batch.value -> 'lotIds') = 'array'
                        THEN batch.value -> 'lotIds'
                        ELSE '[]'::jsonb
                    END
                ) AS legacy_lot(lot_id)
                WHERE COALESCE(batch.value -> 'result' ->> 'saved', 'false') = 'true'
            ) legacy_official_results
              ON legacy_official_results.organization_id = lots.organization_id
             AND legacy_official_results.goi_thau_id = lots.goi_thau_id
             AND legacy_official_results.lot_id = lots.id
            LEFT JOIN (
                SELECT DISTINCT evaluation.organization_id,
                       evaluation.goi_thau_id,
                       editing_lot.lot_id
                FROM vong_danh_gia evaluation
                CROSS JOIN LATERAL jsonb_array_elements_text(
                    CASE
                        WHEN evaluation.extension_json::jsonb -> 'resultEdit' ->> 'type' = 'batch'
                         AND jsonb_typeof(evaluation.extension_json::jsonb -> 'lotBatches') = 'object'
                         AND jsonb_typeof(
                             evaluation.extension_json::jsonb
                             -> 'lotBatches'
                             -> (evaluation.extension_json::jsonb -> 'resultEdit' ->> 'batchId')
                             -> 'lotIds'
                         ) = 'array'
                        THEN evaluation.extension_json::jsonb
                             -> 'lotBatches'
                             -> (evaluation.extension_json::jsonb -> 'resultEdit' ->> 'batchId')
                             -> 'lotIds'
                        ELSE '[]'::jsonb
                    END
                ) AS editing_lot(lot_id)
            ) editing_batch_lots
              ON editing_batch_lots.organization_id = lots.organization_id
             AND editing_batch_lots.goi_thau_id = lots.goi_thau_id
             AND editing_batch_lots.lot_id = lots.id
            WHERE lots.archived_at IS NULL
            GROUP BY lots.organization_id, lots.goi_thau_id
        ) lot_progress
          ON lot_progress.organization_id = package_rows.organization_id
         AND lot_progress.goi_thau_id = package_rows.id
        LEFT JOIN (
            SELECT evaluation.organization_id,
                   evaluation.goi_thau_id,
                   CASE
                       WHEN BOOL_OR(
                           evaluation.extension_json::jsonb -> 'resultEdit' ->> 'type' = 'whole'
                       ) THEN 'whole'
                       WHEN BOOL_OR(
                           evaluation.extension_json::jsonb -> 'resultEdit' ->> 'type' = 'batch'
                       ) THEN 'batch'
                       ELSE ''
                   END AS edit_type
            FROM vong_danh_gia evaluation
            WHERE jsonb_typeof(evaluation.extension_json::jsonb -> 'resultEdit') = 'object'
            GROUP BY evaluation.organization_id, evaluation.goi_thau_id
        ) result_edit
          ON result_edit.organization_id = package_rows.organization_id
         AND result_edit.goi_thau_id = package_rows.id
    """


def _bid_validity_alert_items(cursor, visible_packages_sql, package_params, today):
    """ADR 0103: bids or bid securities whose validity ends within 7 days."""

    cursor.execute(f"""
        WITH visible_packages AS ({visible_packages_sql})
        SELECT vp.id, vp.ma_goi_thau, vp.ten_goi_thau, vp.effective_status,
               vp.thoi_gian_dong_thau, vp.hieu_luc_hsdt, vp.hieu_luc_dam_bao_du_thau,
               (
                   SELECT MAX(extension.thoi_gian_dong_thau)
                   FROM goi_thau_gia_han extension
                   WHERE extension.organization_id = vp.organization_id
                     AND extension.goi_thau_id = vp.id
               ) AS latest_extension_closing
        FROM visible_packages vp
        WHERE vp.effective_status IN ('OPENED', 'EVALUATING', 'PARTIALLY_AWARDED')
          AND (COALESCE(vp.hieu_luc_hsdt, 0) > 0 OR COALESCE(vp.hieu_luc_dam_bao_du_thau, 0) > 0)
    """, tuple(package_params))
    items = []
    for row in cursor.fetchall():
        closing = latest_closing_datetime(row[4], (row[7],))
        result = bid_validity_alert(row[3], closing, row[5], row[6], today)
        if result is None:
            continue
        deadline, days_left = result
        items.append({
            "targetType": "package",
            "id": str(row[0] or ""),
            "maGoiThau": str(row[1] or ""),
            "tenGoiThau": str(row[2] or ""),
            "deadline": deadline.isoformat(),
            "alertKey": "bidValidityExpiring",
            "alertDetail": bid_validity_detail(days_left),
        })
    return items


def _milestone_overdue_alert_items(cursor, organization_id, visible_packages_sql, package_params, today):
    """ADR 0103: timeline milestones past their planned date without an actual date.

    Stored rows only pre-select candidates; each candidate is confirmed with the
    same effective-timeline evaluation the Timeline tab and Word export use, so
    automatic milestones whose date comes from other records are not flagged.
    """

    from backend.documents.timeline_context_service import load_effective_timeline_rows

    cursor.execute(f"""
        WITH visible_packages AS ({visible_packages_sql})
        SELECT vp.id, vp.ma_goi_thau, vp.ten_goi_thau
        FROM visible_packages vp
        JOIN goi_thau_moc_tien_do milestone
          ON milestone.organization_id = vp.organization_id
         AND milestone.goi_thau_id = vp.id
        WHERE vp.effective_status <> 'CANCELLED'
          AND milestone.ngay_du_kien IS NOT NULL
          AND milestone.ngay_du_kien < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
          AND COALESCE(milestone.trang_thai, 'PENDING') NOT IN ('DONE', 'NOT_APPLICABLE')
        GROUP BY vp.id, vp.ma_goi_thau, vp.ten_goi_thau
        ORDER BY MAX(milestone.ngay_du_kien) DESC, vp.id
        LIMIT ?
    """, (*package_params, MILESTONE_ALERT_CANDIDATE_LIMIT + 1))
    candidates = cursor.fetchall()
    partial = len(candidates) > MILESTONE_ALERT_CANDIDATE_LIMIT
    items = []
    for row in candidates[:MILESTONE_ALERT_CANDIDATE_LIMIT]:
        package_id = str(row[0] or "")
        overdue = overdue_milestones(
            load_effective_timeline_rows(cursor, organization_id, package_id),
            today,
        )
        if not overdue:
            continue
        items.append({
            "targetType": "package",
            "id": package_id,
            "maGoiThau": str(row[1] or ""),
            "tenGoiThau": str(row[2] or ""),
            "deadline": str(overdue[0].get("ngay_du_kien") or "")[:10],
            "alertKey": "milestoneOverdue",
            "alertDetail": milestone_overdue_detail(overdue),
        })
    return items, partial


# ADR 0104: staff coordination board for managers.
STAFF_STAGE_BY_STATUS = {
    "PREPARING": "preparing",
    "INVITED": "inviting",
    "OPENED": "evaluating",
    "EVALUATING": "evaluating",
    "PARTIALLY_AWARDED": "evaluating",
}
PACKAGE_STATUS_ALERT_KEYS = frozenset({"overdueOpening", "closingToday", "delayedEvaluation", "closingSoon"})
_STAFF_TARGET_TYPES = {"goithau": "package", "hopdong": "contract", "kehoach": "plan"}


def _empty_workload():
    return {
        "activePackages": 0,
        "preparing": 0,
        "inviting": 0,
        "evaluating": 0,
        "activeContracts": 0,
        "alerts": 0,
        "earliestDeadline": "",
    }


def _add_alert(workload, deadline):
    workload["alerts"] += 1
    day = calendar_day(deadline)
    if day and (not workload["earliestDeadline"] or day < workload["earliestDeadline"]):
        workload["earliestDeadline"] = day


def _staff_workload(
    cursor,
    organization_id,
    visible_packages_sql,
    package_params,
    status_alert_case_sql,
    other_alert_items,
    latest_contracts_sql=None,
):
    """Open work and alerts per active member, plus packages nobody is assigned to.

    Called only for managers, who already read every record and assignment of
    the organization; the board adds no record or field the manager cannot see.
    """

    cursor.execute("""
        SELECT tk.id,
               COALESCE(NULLIF(trim(tvtc.ten_nhan_su), ''), NULLIF(trim(tk.ho_ten), ''),
                        tk.ten_dang_nhap, tk.email) AS display_name,
               tvtc.vai_tro_trong_to_chuc,
               CASE WHEN tc.owner_user_id = tk.id THEN 1 ELSE 0 END AS is_owner
        FROM thanh_vien_to_chuc tvtc
        JOIN tai_khoan tk ON tk.id = tvtc.user_id
        JOIN to_chuc tc ON tc.id = tvtc.organization_id
        WHERE tvtc.organization_id = ?
          AND tk.trang_thai = 'active'
          AND COALESCE(tvtc.trang_thai_thanh_vien, 'active') = 'active'
    """, (organization_id,))
    members = {}
    for row in cursor.fetchall():
        user_id = str(row[0] or "")
        if not user_id:
            continue
        role = "owner" if int(row[3] or 0) else ("manager" if row[2] == "manager" else "employee")
        members[user_id] = {"userId": user_id, "name": str(row[1] or ""), "role": role, **_empty_workload()}

    cursor.execute("""
        SELECT id_nhan_vien, loai_doi_tuong, id_muc_tieu
        FROM phan_cong_nhan_su
        WHERE organization_id = ?
          AND loai_doi_tuong IN ('goithau', 'hopdong', 'kehoach')
    """, (organization_id,))
    assignees = {}
    for row in cursor.fetchall():
        user_id = str(row[0] or "")
        if user_id not in members:
            continue
        target = (_STAFF_TARGET_TYPES[str(row[1])], str(row[2] or ""))
        assignees.setdefault(target, set()).add(user_id)

    unassigned = _empty_workload()
    cursor.execute(f"""
        WITH visible_packages AS ({visible_packages_sql})
        SELECT vp.id, vp.effective_status, {status_alert_case_sql} AS alert_key,
               vp.thoi_gian_dong_thau, vp.thoi_gian_mo_thau
        FROM visible_packages vp
        WHERE COALESCE(vp.effective_status, '') NOT IN ('AWARDED', 'CANCELLED')
    """, tuple(package_params))
    for row in cursor.fetchall():
        package_id = str(row[0] or "")
        owners = [members[user_id] for user_id in assignees.get(("package", package_id), ())]
        targets = owners or [unassigned]
        stage = STAFF_STAGE_BY_STATUS.get(str(row[1] or "").upper())
        alert_key = str(row[2] or "")
        for workload in targets:
            workload["activePackages"] += 1
            if stage:
                workload[stage] += 1
            if alert_key:
                _add_alert(workload, row[4] if alert_key == "delayedEvaluation" else row[3])

    if latest_contracts_sql:
        cursor.execute(f"""
            SELECT hd.id
            FROM ({latest_contracts_sql}) hd
            WHERE hd.ngay_thanh_ly IS NULL
              AND hd.trang_thai_hop_dong IN (?, ?)
        """, (organization_id, "ACTIVE", CONTRACT_STATUS_LABELS["ACTIVE"]))
        for row in cursor.fetchall():
            for user_id in assignees.get(("contract", str(row[0] or "")), ()):
                members[user_id]["activeContracts"] += 1

    for item in other_alert_items:
        if item.get("alertKey") in PACKAGE_STATUS_ALERT_KEYS:
            continue  # counted from the full package query above
        target = (str(item.get("targetType") or ""), str(item.get("id") or ""))
        owners = assignees.get(target)
        if owners:
            for user_id in owners:
                _add_alert(members[user_id], item.get("deadline"))
        elif target[0] == "package":
            _add_alert(unassigned, item.get("deadline"))

    rows = sorted(
        members.values(),
        key=lambda row: (-row["alerts"], -row["activePackages"], -row["activeContracts"], row["name"].casefold()),
    )
    return {"rows": rows, "unassigned": unassigned}


def package_alert_conditions(alias="vp"):
    """Keep dashboard counts and package-list drilldowns on one definition."""
    return {
        "closingToday": f"{alias}.effective_status = 'INVITED' AND ({alias}.thoi_gian_dong_thau AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date",
        "closingSoon": f"{alias}.effective_status = 'INVITED' AND {alias}.thoi_gian_dong_thau > CURRENT_TIMESTAMP AND {alias}.thoi_gian_dong_thau <= CURRENT_TIMESTAMP + INTERVAL '7 days' AND ({alias}.thoi_gian_dong_thau AT TIME ZONE 'Asia/Ho_Chi_Minh')::date > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date",
        "overdueOpening": f"{alias}.effective_status = 'INVITED' AND ({alias}.thoi_gian_dong_thau AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date",
        "delayedEvaluation": f"""
            {alias}.effective_status IN ('OPENED', 'EVALUATING')
            AND COALESCE({alias}.thoi_gian_mo_thau, {alias}.thoi_gian_dong_thau)
                <= CURRENT_TIMESTAMP - INTERVAL '{EVALUATION_REPORT_DELAY_DAYS} days'
            AND NOT EXISTS (
                SELECT 1 FROM vong_danh_gia vd
                WHERE vd.organization_id = {alias}.organization_id
                  AND vd.goi_thau_id = {alias}.id
                  AND (COALESCE(trim(vd.so_bao_cao), '') <> '' OR vd.ngay_bao_cao IS NOT NULL)
            )
        """,
    }


def build_dashboard_summary(cursor, organization_id, role_str, user_id, *, alert_limit=8):
    manager = is_organization_manager(cursor, role_str, user_id, organization_id)

    def can(payload_key, table_name):
        return can_read_table(cursor, role_str, user_id, organization_id, payload_key, table_name)

    def latest_cte(table_name):
        table_name = sql_identifier(table_name, allowed=_DASHBOARD_LATEST_TABLES)
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
    milestone_alert_partial = False

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
                   SUM(CASE WHEN gt.id IS NOT NULL AND gt.effective_status != 'PREPARING' THEN 1 ELSE 0 END) AS started_count,
                   SUM(CASE WHEN gt.id IS NOT NULL AND gt.effective_status NOT IN ('AWARDED', 'CANCELLED') THEN 1 ELSE 0 END) AS unfinished_count
            FROM ({latest_cte("ke_hoach_lcnt")}) kh
            LEFT JOIN ({_effective_package_rows_sql(latest_cte("goi_thau"))}) gt
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
        effective_packages_sql = _effective_package_rows_sql(latest_cte("goi_thau"))
        cursor.execute(f"""
            SELECT COALESCE(effective_status, '') AS status_name, COUNT(*) AS total
            FROM ({effective_packages_sql}) latest_rows
            WHERE 1 = 1 {package_filter_sql}
            GROUP BY COALESCE(effective_status, '')
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
            FROM ({effective_packages_sql}) latest_rows
            WHERE 1 = 1 {package_filter_sql}
            ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
            LIMIT 4
        """, tuple(package_params))
        recent_packages = []
        for row in cursor.fetchall():
            raw_item = dict(row)
            raw_item["trang_thai"] = raw_item.pop(
                "effective_status",
                raw_item.get("trang_thai"),
            )
            recent_packages.append(map_db_to_json("goi_thau", raw_item))

        visible_packages_sql = f"""
            SELECT latest_rows.*
            FROM ({effective_packages_sql}) latest_rows
            WHERE 1 = 1 {package_filter_sql}
        """
        alert_conditions = package_alert_conditions("vp")
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

        status_alert_case_sql = f"""
                       CASE
                           WHEN {alert_conditions["overdueOpening"]} THEN 'overdueOpening'
                           WHEN {alert_conditions["closingToday"]} THEN 'closingToday'
                           WHEN {alert_conditions["delayedEvaluation"]} THEN 'delayedEvaluation'
                           WHEN {alert_conditions["closingSoon"]} THEN 'closingSoon'
                           ELSE ''
                       END"""
        cursor.execute(f"""
            WITH visible_packages AS ({visible_packages_sql}),
            alert_packages AS (
                SELECT vp.*,
                       {status_alert_case_sql} AS alert_key
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
            LIMIT ?
        """, (*package_params, max(1, int(alert_limit))))
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

        today = vietnam_today()
        validity_items = _bid_validity_alert_items(
            cursor, visible_packages_sql, package_params, today
        )
        alert_counts["bidValidityExpiring"] = len(validity_items)
        alert_items.extend(validity_items)

        milestone_items, milestone_alert_partial = _milestone_overdue_alert_items(
            cursor, organization_id, visible_packages_sql, package_params, today
        )
        alert_counts["milestoneOverdue"] = len(milestone_items)
        alert_items.extend(milestone_items)

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

        active_contract_code = "ACTIVE"
        cursor.execute(f"""
            SELECT COUNT(*),
                   COUNT(*) FILTER (
                       WHERE hd.trang_thai_hop_dong IN (?, ?)
                   )
            FROM ({latest_contracts_sql}) hd
            WHERE EXISTS (
                SELECT 1 FROM phan_cong_nhan_su pc
                WHERE pc.organization_id = hd.organization_id
                  AND pc.id_nhan_vien = ?
                  AND pc.id_muc_tieu = hd.id
                  AND pc.loai_doi_tuong = 'hopdong'
            )
        """, (
            active_contract_code,
            CONTRACT_STATUS_LABELS[active_contract_code],
            organization_id,
            user_id,
        ))
        assigned_row = cursor.fetchone()
        counts["assignedHopdong"] = int(assigned_row[0] or 0)
        counts["activeAssignedHopdong"] = int(assigned_row[1] or 0)

    staff_workload = None
    if manager and can("goithau", "goi_thau"):
        staff_workload = _staff_workload(
            cursor,
            organization_id,
            visible_packages_sql,
            package_params,
            status_alert_case_sql,
            alert_items,
            latest_cte("hop_dong") if can("hopdong", "hop_dong") else None,
        )

    alert_items = _select_alert_items(alert_items, limit=alert_limit)

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
        "milestoneAlertPartial": milestone_alert_partial,
        "staffWorkload": staff_workload,
    }
