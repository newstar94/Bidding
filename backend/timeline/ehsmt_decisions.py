"""ADR 0102: E-HSMT approval and adjustment decisions as one Word list.

The list starts with the original approval decision, read from the effective
timeline of the first version of the package lineage, followed by every
applicable "QĐ phê duyệt điều chỉnh E-HSMT" instance of the exported version
in timeline order.  Numbers and dates come from the evaluated timeline rows, so
manual edits on the Tiến độ tab are honoured; the submission, appraisal report
and reason of an adjustment come from its ``goi_thau_dieu_chinh_hsmt`` record.
This module is pure: callers load rows and records.
"""

from __future__ import annotations

EHSMT_DECISION_LIST_ROOT = "qd_hsmt_list"

APPROVAL_KEY = "E_HSMT_APPROVAL"
SUBMISSION_KEY = "E_HSMT_SUBMISSION"
APPRAISAL_REPORT_KEY = "E_HSMT_APPRAISAL_REPORT"
ADJUSTMENT_KEY = "E_HSMT_ADJUSTMENT_APPROVAL"

EHSMT_DECISION_FIELD_LABELS = {
    "lan": "Lần (0 là QĐ phê duyệt gốc)",
    "loai": "Loại quyết định E-HSMT",
    "so_quyet_dinh": "Số QĐ phê duyệt/điều chỉnh E-HSMT",
    "ngay_quyet_dinh": "Ngày QĐ phê duyệt/điều chỉnh E-HSMT",
    "so_to_trinh": "Số tờ trình E-HSMT",
    "ngay_to_trinh": "Ngày tờ trình E-HSMT",
    "so_bao_cao_tham_dinh": "Số báo cáo thẩm định E-HSMT",
    "ngay_bao_cao_tham_dinh": "Ngày báo cáo thẩm định E-HSMT",
    "ly_do": "Lý do điều chỉnh E-HSMT",
}
EHSMT_DECISION_FIELDS = tuple(EHSMT_DECISION_FIELD_LABELS)


def _text(value):
    return str(value or "").strip()


def _date_only(value):
    return _text(value)[:10]


def _row_number_date(row):
    row = row or {}
    return (
        _text(row.get("so_van_ban")),
        _date_only(row.get("ngay_thuc_te") or row.get("ngay_du_kien")),
    )


def _first(record, *names):
    for name in names:
        value = (record or {}).get(name)
        if value not in (None, ""):
            return value
    return ""


def _applicable(rows, key, *, repeatable):
    return [
        row for row in rows or ()
        if row.get("milestone_key") == key
        and row.get("applicability") == "APPLICABLE"
        and bool(row.get("is_repeatable")) is repeatable
    ]


def _sequence(record):
    try:
        return int(_first(record, "sequence") or 0)
    except (TypeError, ValueError):
        return 0


def build_ehsmt_decisions(original_rows, version_rows, adjustments=()):
    """Return the ordered ``qd_hsmt_list`` items (all values are strings/ints)."""

    items = []
    approval = _applicable(original_rows, APPROVAL_KEY, repeatable=False)
    if approval:
        by_key = {
            row.get("milestone_key"): row
            for row in original_rows or ()
            if row.get("applicability") == "APPLICABLE" and not row.get("is_repeatable")
        }
        number, date = _row_number_date(approval[0])
        submission_number, submission_date = _row_number_date(by_key.get(SUBMISSION_KEY))
        report_number, report_date = _row_number_date(by_key.get(APPRAISAL_REPORT_KEY))
        items.append({
            "lan": 0,
            "loai": "Phê duyệt E-HSMT",
            "so_quyet_dinh": number,
            "ngay_quyet_dinh": date,
            "so_to_trinh": submission_number,
            "ngay_to_trinh": submission_date,
            "so_bao_cao_tham_dinh": report_number,
            "ngay_bao_cao_tham_dinh": report_date,
            "ly_do": "",
        })

    records = {
        _text(_first(record, "id")): record
        for record in adjustments or ()
        if isinstance(record, dict) and _text(_first(record, "id"))
    }
    adjustment_rows = sorted(
        _applicable(version_rows, ADJUSTMENT_KEY, repeatable=True),
        key=lambda row: float(row.get("sort_order") or 0),
    )
    for ordinal, row in enumerate(adjustment_rows, start=1):
        record = records.get(_text(row.get("source_entity_id"))) or {}
        lan = _sequence(record) or ordinal
        number, date = _row_number_date(row)
        items.append({
            "lan": lan,
            "loai": f"Điều chỉnh E-HSMT lần {lan}",
            "so_quyet_dinh": number,
            "ngay_quyet_dinh": date,
            "so_to_trinh": _text(_first(record, "submission_number", "submissionNumber")),
            "ngay_to_trinh": _date_only(_first(record, "submission_date", "submissionDate")),
            "so_bao_cao_tham_dinh": _text(_first(
                record, "appraisal_report_number", "appraisalReportNumber",
            )),
            "ngay_bao_cao_tham_dinh": _date_only(_first(
                record, "appraisal_report_date", "appraisalReportDate",
            )),
            "ly_do": _text(_first(record, "reason")),
        })
    return items
