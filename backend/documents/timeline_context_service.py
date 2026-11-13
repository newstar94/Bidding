"""Build the normalized context used by package timeline Word exports.

The pure rule module is shared conceptually with the browser evaluator through
``shared/timeline_rules.json``. This adapter only loads tenant-scoped records
and projects the effective rows into the existing document context contract.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime

from backend.documents.docx_context_policy import project_docx_context
from backend.shared.date_utils import vietnam_now, vietnam_today
from backend.shared.helpers import database
from backend.sync.deadline_alerts import timeline_row_is_overdue
from backend.timeline.effective_timeline import (
    CATALOG,
    TIMELINE_TEMPLATE_VERSION,
    assign_timeline_display_codes,
    build_effective_timeline,
)
from backend.timeline.ehsmt_decisions import (
    EHSMT_DECISION_LIST_ROOT,
    build_ehsmt_decisions,
)
from backend.timeline.word_fields import (
    PLAN_SECTION_MILESTONE_KEYS,
    merge_first_filled,
    milestone_values_from_rows,
    timeline_word_context,
    with_original_version_values,
)
from backend.versioning.relation_policy import load_contracts_for_package_lineage


def _row_dict(row):
    return dict(row) if row is not None else {}


def _date_only(value):
    raw = str(value or "").strip()
    if not raw:
        return ""
    if len(raw) >= 10 and raw[4:5] == "-" and raw[7:8] == "-":
        return raw[:10]
    for pattern in ("%d/%m/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(raw[:10], pattern).date().isoformat()
        except ValueError:
            continue
    return ""


def _display_date(value):
    normalized = _date_only(value)
    if not normalized:
        return ""
    return datetime.strptime(normalized, "%Y-%m-%d").strftime("%d/%m/%Y")


def _load_related(cursor, organization_id, package_id):
    related = {}
    related["contracts"] = load_contracts_for_package_lineage(
        cursor, organization_id, package_id
    )
    related["ehsmtAdjustments"] = [
        _row_dict(row)
        for row in cursor.execute(
            "SELECT * FROM goi_thau_dieu_chinh_hsmt WHERE organization_id = ? AND goi_thau_id = ? ORDER BY sequence, approval_decision_date, id",
            (organization_id, package_id),
        ).fetchall()
    ] if cursor.execute(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'goi_thau_dieu_chinh_hsmt'"
    ).fetchone() else []
    related["extensions"] = [
        _row_dict(row)
        for row in cursor.execute(
            "SELECT * FROM goi_thau_gia_han WHERE organization_id = ? AND goi_thau_id = ? ORDER BY sort_order, id",
            (organization_id, package_id),
        ).fetchall()
    ]
    clarification_rows = [
        _row_dict(row)
        for row in cursor.execute(
            "SELECT * FROM goi_thau_lam_ro WHERE organization_id = ? AND goi_thau_id = ? ORDER BY loai, sort_order, id",
            (organization_id, package_id),
        ).fetchall()
    ]
    related["clarificationRequests"] = [row for row in clarification_rows if row.get("loai") == "yeu_cau"]
    related["clarificationResponses"] = [row for row in clarification_rows if row.get("loai") == "tra_loi"]
    teams = [
        _row_dict(row)
        for row in cursor.execute(
            "SELECT * FROM goi_thau_chuyen_gia WHERE organization_id = ? AND goi_thau_id = ?",
            (organization_id, package_id),
        ).fetchall()
    ]
    related["expertTeam"] = [row for row in teams if row.get("loai") in {"chuyen_gia", "expert", "to_chuyen_gia"}]
    related["appraisalTeam"] = [row for row in teams if row.get("loai") in {"tham_dinh", "appraisal", "to_tham_dinh"}]

    technical = {}
    financial = {}
    result = {}
    rounds = cursor.execute(
        """SELECT loai_vong, so_bao_cao, ngay_bao_cao, extension_json
           FROM vong_danh_gia WHERE organization_id = ? AND goi_thau_id = ? ORDER BY thu_tu""",
        (organization_id, package_id),
    ).fetchall()
    import json
    for raw_row in rounds:
        row = _row_dict(raw_row)
        try:
            extension = json.loads(row.get("extension_json") or "{}")
        except (TypeError, ValueError):
            extension = {}
        target = technical if row.get("loai_vong") in {"single", "technical"} else financial if row.get("loai_vong") == "financial" else result
        target.update({
            "soBaoCao": row.get("so_bao_cao") or "",
            "ngayBaoCao": row.get("ngay_bao_cao") or "",
            **extension,
        })
    related["technicalEvaluation"] = technical
    related["financialEvaluation"] = financial
    related["resultEvaluation"] = result
    return related


def _project_item(item):
    value = deepcopy(item)
    date = value.get("ngay_thuc_te") or value.get("ngay_du_kien") or ""
    value.update({
        "display_date": _display_date(date),
        "is_planned_date": bool(not value.get("ngay_thuc_te") and value.get("ngay_du_kien")),
        # One overdue rule for Word exports and the dashboard alert (ADR 0103).
        "is_overdue": timeline_row_is_overdue(value, vietnam_today()),
    })
    return value


def _load_package_and_plan(cursor, organization_id, package_id):
    package = _row_dict(cursor.execute(
        "SELECT * FROM goi_thau WHERE organization_id = ? AND id = ?",
        (organization_id, package_id),
    ).fetchone())
    if not package:
        return {}, {}
    plan = _row_dict(cursor.execute(
        "SELECT * FROM ke_hoach_lcnt WHERE organization_id = ? AND id = ?",
        (organization_id, package.get("ke_hoach_id")),
    ).fetchone())
    return package, plan


def _load_saved_rows(cursor, organization_id, package_id):
    return [
        _row_dict(row)
        for row in cursor.execute(
            "SELECT * FROM goi_thau_moc_tien_do WHERE organization_id = ? AND goi_thau_id = ? ORDER BY sort_order, ma_moc, id",
            (organization_id, package_id),
        ).fetchall()
    ]


def _evaluate_timeline(cursor, organization_id, package_id):
    package, plan = _load_package_and_plan(cursor, organization_id, package_id)
    if not package:
        return {}, [], {}
    saved_rows = _load_saved_rows(cursor, organization_id, package_id)
    related = _load_related(cursor, organization_id, package_id)
    related["plan"] = plan
    return package, build_effective_timeline(package, related, saved_rows), related


def load_effective_timeline_rows(cursor, organization_id, package_id):
    """Evaluate one package timeline with the caller's tenant-scoped cursor."""

    return _evaluate_timeline(cursor, organization_id, package_id)[1]


def _version_order(package):
    version = str(package.get("phien_ban") or "").strip()
    return (
        (0, int(version)) if version.isdigit() else (1, 0),
        str(package.get("created_at") or ""),
        str(package.get("id") or ""),
    )


def _first_lineage_package_id(cursor, organization_id, package):
    """Return the first live version of the package's lineage (ADR 0102)."""

    package_id = str(package.get("id") or "")
    root_id = str(package.get("id_goc") or "").strip() or package_id
    versions = [
        _row_dict(row)
        for row in cursor.execute(
            """SELECT id, phien_ban, created_at FROM goi_thau
                WHERE organization_id = ? AND archived_at IS NULL
                  AND (id = ? OR id_goc = ?)""",
            (organization_id, root_id, root_id),
        ).fetchall()
    ]
    if not versions:
        return package_id
    return str(min(versions, key=_version_order)["id"])


def load_timeline_word_context(cursor, organization_id, package_id):
    """Return the timeline-derived Word values of one package export.

    ADR 0099 milestone scalars come from the exported version's effective
    timeline.  ADR 0102: the E-HSMT approval scalars and the first item of
    ``qd_hsmt_list`` come from the first version of the lineage, and the list
    continues with every applicable adjustment decision of the exported
    version.
    """

    package, rows, related = _evaluate_timeline(cursor, organization_id, package_id)
    original_rows = rows
    if package:
        first_id = _first_lineage_package_id(cursor, organization_id, package)
        if first_id != str(package_id):
            original_rows = load_effective_timeline_rows(
                cursor, organization_id, first_id
            )
    values = with_original_version_values(
        milestone_values_from_rows(rows),
        milestone_values_from_rows(original_rows),
    )
    return {
        **timeline_word_context(values),
        EHSMT_DECISION_LIST_ROOT: build_ehsmt_decisions(
            original_rows,
            rows,
            related.get("ehsmtAdjustments") or [],
        ),
    }


def _package_order(package):
    return (str(package.get("created_at") or ""), str(package.get("id") or ""))


def load_plan_timeline_word_context(cursor, organization_id, packages):
    """Return plan-section milestone scalars for a plan Word export.

    Plan-level milestones are stored per package.  The first package of the
    plan (oldest first, then ID) that has a number or a date for a milestone
    supplies that milestone; package-specific sections stay empty.
    """

    values = [
        milestone_values_from_rows(
            load_effective_timeline_rows(cursor, organization_id, package["id"]),
            PLAN_SECTION_MILESTONE_KEYS,
        )
        for package in sorted(
            (
                item for item in packages or ()
                if isinstance(item, dict) and item.get("id")
            ),
            key=_package_order,
        )
    ]
    return timeline_word_context(merge_first_filled(values))


def build_timeline_context(package_id, user_id, organization_id):
    """Return a complete, presentation-ready effective timeline context."""

    del user_id  # Access is enforced by the route; context stays tenant-scoped.
    conn = database.get_connection()
    try:
        cursor = conn.cursor()
        package, plan = _load_package_and_plan(cursor, organization_id, package_id)
        if not package:
            raise ValueError("Không tìm thấy gói thầu trong tổ chức hiện hành.")
        investor = _row_dict(cursor.execute(
            "SELECT * FROM chu_dau_tu WHERE organization_id = ? AND id = ?",
            (organization_id, plan.get("chu_dau_tu_id")),
        ).fetchone()) if plan else {}
        organization = _row_dict(cursor.execute(
            "SELECT * FROM to_chuc WHERE id = ?", (organization_id,)
        ).fetchone())
        saved_rows = _load_saved_rows(cursor, organization_id, package_id)
        related = _load_related(cursor, organization_id, package_id)
        related["plan"] = plan
    finally:
        conn.close()

    # Official document export excludes provisional and excluded rows.
    items = [
        item for item in build_effective_timeline(package, related, saved_rows)
        if item["applicability"] == "APPLICABLE"
    ]
    assign_timeline_display_codes(items)
    sections = []
    section_order = []
    for item in items:
        section = item["section_key"]
        if section not in section_order:
            section_order.append(section)
    for section_key in section_order:
        section = next(item for item in CATALOG["sections"] if item["sectionKey"] == section_key)
        raw_section_items = [item for item in items if item["section_key"] == section_key]
        section_items = [_project_item(item) for item in raw_section_items]
        sections.append({"code": raw_section_items[0]["display_group_code"], "title": section["title"], "items": section_items})

    context = {
        "goi_thau": package,
        "ke_hoach": plan,
        "chu_dau_tu": investor,
        "to_chuc": organization,
        "timeline_sections": sections,
        "timeline_template_version": TIMELINE_TEMPLATE_VERSION,
        "generated_date": vietnam_now().strftime("%d/%m/%Y"),
        "planned_date_note": "Ngày màu đỏ là ngày dự kiến/chưa xác nhận.",
    }
    return project_docx_context("timeline", context)
